import UIKit
import PencilKit
import CryptoKit
import UniformTypeIdentifiers
import PDFKit
import AVFoundation

@main final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        let window = UIWindow(frame: UIScreen.main.bounds); window.rootViewController = UINavigationController(rootViewController: DrawingController()); window.makeKeyAndVisible(); self.window = window; return true
    }
}

final class PaperView: UIView {
    var paper = "dots" { didSet { setNeedsDisplay() } }
    var images: [(CGRect, UIImage)] = [] { didSet { setNeedsDisplay() } }
    override func draw(_ rect: CGRect) {
        UIColor(red: 1, green: 0.995, blue: 0.985, alpha: 1).setFill(); UIRectFill(bounds)
        let path = UIBezierPath(); UIColor(red: 0.84, green: 0.89, blue: 0.92, alpha: 1).setStroke(); path.lineWidth = 0.6
        if paper == "grid" || paper == "lines" { for y in stride(from: 32, to: 1584, by: 32) { path.move(to: CGPoint(x: 0, y: y)); path.addLine(to: CGPoint(x: 1120, y: y)) }; if paper == "grid" { for x in stride(from: 32, to: 1120, by: 32) { path.move(to: CGPoint(x: x, y: 0)); path.addLine(to: CGPoint(x: x, y: 1584)) } }; path.stroke() }
        if paper == "dots" { UIColor.systemGray3.setFill(); for x in stride(from: 32, to: 1120, by: 32) { for y in stride(from: 32, to: 1584, by: 32) { UIBezierPath(ovalIn: CGRect(x: Double(x), y: Double(y), width: 1.5, height: 1.5)).fill() } } }
        for (frame, image) in images { image.draw(in: frame) }
    }
}

@MainActor final class DrawingController: UIViewController, PKCanvasViewDelegate, UIScrollViewDelegate, UIDocumentPickerDelegate, PKToolPickerObserver {
    let store = SyncStore(), canvas = PKCanvasView(), scroll = UIScrollView(), stage = UIView(), paper = PaperView(), picker = PKToolPicker()
    let pageControl = UIButton(type: .system), statusLabel = UILabel()
    var page = "first", renderedPage = "", rendered = [String: String](), drawingActive = false, applying = false, refreshAfterDrawing = false
    var saveWork: DispatchWorkItem?, imageCache = [String: UIImage](), imageLoads = Set<String>(), oldTool: PKTool?
    override func viewDidLoad() {
        super.viewDidLoad(); title = "Toolbox 绘图本"; view.backgroundColor = .systemGroupedBackground
        navigationItem.leftBarButtonItem = UIBarButtonItem(title: "配对", style: .plain, target: self, action: #selector(pair))
        navigationItem.rightBarButtonItems = [UIBarButtonItem(title: "更多", style: .plain, target: self, action: #selector(more)), UIBarButtonItem(title: "重做", style: .plain, target: self, action: #selector(redo)), UIBarButtonItem(title: "撤销", style: .plain, target: self, action: #selector(undo))]
        pageControl.setTitle("纸张 ▾", for: .normal); pageControl.addTarget(self, action: #selector(pages), for: .touchUpInside)
        statusLabel.font = .systemFont(ofSize: 12); statusLabel.textColor = .secondaryLabel
        let bar = UIStackView(arrangedSubviews: [pageControl, statusLabel]); bar.spacing = 20; bar.translatesAutoresizingMaskIntoConstraints = false; view.addSubview(bar)
        scroll.translatesAutoresizingMaskIntoConstraints = false; scroll.backgroundColor = UIColor(white: 0.93, alpha: 1); scroll.delegate = self; scroll.minimumZoomScale = 0.2; scroll.maximumZoomScale = 4; scroll.panGestureRecognizer.minimumNumberOfTouches = 2; scroll.delaysContentTouches = false; scroll.canCancelContentTouches = false
        view.addSubview(scroll); NSLayoutConstraint.activate([bar.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 8), bar.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20), bar.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20), bar.heightAnchor.constraint(equalToConstant: 32), scroll.topAnchor.constraint(equalTo: bar.bottomAnchor, constant: 8), scroll.leadingAnchor.constraint(equalTo: view.leadingAnchor), scroll.trailingAnchor.constraint(equalTo: view.trailingAnchor), scroll.bottomAnchor.constraint(equalTo: view.bottomAnchor)])
        stage.frame = CGRect(x: 0, y: 0, width: 1120, height: 1584); scroll.addSubview(stage); scroll.contentSize = stage.bounds.size
        paper.frame = stage.bounds; paper.isUserInteractionEnabled = false; stage.addSubview(paper)
        canvas.frame = stage.bounds; canvas.backgroundColor = .clear; canvas.isOpaque = false; canvas.isScrollEnabled = false; canvas.drawingPolicy = .pencilOnly; canvas.delegate = self; stage.addSubview(canvas)
        picker.addObserver(canvas); picker.addObserver(self); picker.setVisible(true, forFirstResponder: canvas)
        store.changed = { [weak self] in self?.refresh() }
        NotificationCenter.default.addObserver(self, selector: #selector(background), name: UIApplication.willResignActiveNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(foreground), name: UIApplication.didBecomeActiveNotification, object: nil)
        refresh(); store.start()
    }
    override func viewDidAppear(_ animated: Bool) { super.viewDidAppear(animated); canvas.becomeFirstResponder(); picker.setVisible(true, forFirstResponder: canvas); if store.base == nil { pair() } }
    override func viewDidLayoutSubviews() { super.viewDidLayoutSubviews(); if scroll.zoomScale == 1 && renderedPage.isEmpty { fit() } }
    func viewForZooming(in scrollView: UIScrollView) -> UIView? { stage }
    func fit() { scroll.zoomScale = max(0.2, min(1, (scroll.bounds.width - 24) / 1120)); scroll.contentOffset = .zero }
    func fail(_ error: Error) { let alert = UIAlertController(title: "绘图本", message: error.localizedDescription, preferredStyle: .alert); alert.addAction(UIAlertAction(title: "好", style: .default)); if presentedViewController == nil { present(alert, animated: true) }; statusLabel.text = error.localizedDescription }
    func hash(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }
    func values() -> [[String: Any]] { store.objects.values.filter { $0["page"] as? String == page } }
    func color(_ hex: String) -> UIColor { let value = UInt32(hex.dropFirst(), radix: 16) ?? 0x26384d; return UIColor(red: CGFloat((value >> 16) & 255) / 255, green: CGFloat((value >> 8) & 255) / 255, blue: CGFloat(value & 255) / 255, alpha: 1) }
    func stroke(_ object: [String: Any]) -> PKStroke? {
        if let ink = object["ink"] as? [String: Any], let encoded = ink["data"] as? String, let data = Data(base64Encoded: encoded), let drawing = try? PKDrawing(data: data), drawing.strokes.count == 1 { return drawing.strokes[0] }
        guard let points = object["points"] as? [[Double]], !points.isEmpty else { return nil }
        let x = object["x"] as? Double ?? 0, y = object["y"] as? Double ?? 0, width = object["width"] as? Double ?? 3, marker = object["tool"] as? String == "marker"
        let controls = points.enumerated().map { i, p in PKStrokePoint(location: CGPoint(x: p[0] + x, y: p[1] + y), timeOffset: Double(i) / 120, size: CGSize(width: width * (marker ? 3 : 0.25 + p[2] * 0.75), height: width * (marker ? 3 : 0.25 + p[2] * 0.75)), opacity: marker ? 0.22 : 1, force: p[2], azimuth: 0, altitude: .pi / 2) }
        return PKStroke(ink: PKInk(marker ? .marker : .pen, color: color(object["color"] as? String ?? "#26384d")), path: PKStrokePath(controlPoints: controls, creationDate: Date(timeIntervalSince1970: 0)))
    }
    func refresh() {
        statusLabel.text = "\(store.identity) · \(store.note) · 待同步 \(store.pending.count)"
        pageControl.isEnabled = !drawingActive
        guard !drawingActive else { refreshAfterDrawing = true; return }
        if store.pages[page] == nil { page = store.pages.keys.sorted().first ?? "first" }
        pageControl.setTitle((store.pages[page]?["name"] as? String ?? "纸张") + " ▾", for: .normal); paper.paper = store.pages[page]?["paper"] as? String ?? "dots"
        let objects = values().sorted { ($0["id"] as? String ?? "") < ($1["id"] as? String ?? "") }
        var strokes = [PKStroke](), mapping = [String: String]()
        for object in objects where object["type"] as? String == "stroke" { if let stroke = stroke(object), let id = object["id"] as? String { strokes.append(stroke); mapping[hash(PKDrawing(strokes: [stroke]).dataRepresentation())] = id } }
        let drawing = PKDrawing(strokes: strokes)
        if canvas.drawing.dataRepresentation() != drawing.dataRepresentation() { applying = true; canvas.drawing = drawing; applying = false }
        rendered = mapping
        if renderedPage != page { canvas.undoManager?.removeAllActions(); renderedPage = page; fit() }
        var backgrounds = [(CGRect, UIImage)]()
        for object in objects.filter({ $0["type"] as? String == "image" }).sorted(by: { ($0["background"] as? Bool ?? false) && !($1["background"] as? Bool ?? false) }) {
            guard let asset = object["asset"] as? String else { continue }
            if let image = imageCache[asset] { backgrounds.append((CGRect(x: object["x"] as? Double ?? 0, y: object["y"] as? Double ?? 0, width: object["w"] as? Double ?? 100, height: object["h"] as? Double ?? 100), image)) }
            else if !imageLoads.contains(asset) { imageLoads.insert(asset); Task { [weak self] in guard let self else { return }; defer { imageLoads.remove(asset) }; do { let data = try await store.image(asset); if let image = UIImage(data: data) { imageCache[asset] = image; refresh() } } catch { statusLabel.text = "图片等待连接电脑后加载" } } }
        }
        paper.images = backgrounds
    }
    func canvasViewDidBeginUsingTool(_ canvasView: PKCanvasView) { drawingActive = true; saveWork?.cancel(); pageControl.isEnabled = false }
    func canvasViewDidEndUsingTool(_ canvasView: PKCanvasView) { drawingActive = false; scheduleSave() }
    func canvasViewDrawingDidChange(_ canvasView: PKCanvasView) { if !applying { scheduleSave() } }
    func scheduleSave() { saveWork?.cancel(); let work = DispatchWorkItem { [weak self] in guard let self, !drawingActive else { return }; publish() }; saveWork = work; DispatchQueue.main.asyncAfter(deadline: .now() + 0.18, execute: work) }
    func publish() {
        let drawing = canvas.drawing; var next = [String: String](), changes = [[String: Any]]()
        do {
            for stroke in drawing.strokes {
                let data = PKDrawing(strokes: [stroke]).dataRepresentation(), fingerprint = hash(data)
                if let old = rendered[fingerprint] { next[fingerprint] = old; continue }
                guard data.count <= 520000 else { throw DrawingError.message("单笔过长，请分成较短的笔迹") }
                let id = UUID().uuidString, controls = Array(stroke.path.interpolatedPoints(by: .distance(2)))
                guard !controls.isEmpty, controls.count <= 19000 else { throw DrawingError.message("单笔过长，请分段书写") }
                let maxWidth = max(0.2, min(60, controls.map { Double(max($0.size.width, $0.size.height)) }.max() ?? 3))
                let samples = controls.map { point -> [Double] in let p = point.location.applying(stroke.transform); return [Double(p.x), Double(p.y), max(0, min(1, (Double(point.size.width) / maxWidth - 0.18) / 0.82))] }
                var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0; stroke.ink.color.getRed(&r, green: &g, blue: &b, alpha: &a)
                let color = String(format: "#%02x%02x%02x", Int(r * 255), Int(g * 255), Int(b * 255))
                let object: [String: Any] = ["id": id, "page": page, "type": "stroke", "tool": stroke.ink.inkType == .marker ? "marker" : "pen", "color": color, "x": 0, "y": 0, "width": stroke.ink.inkType == .marker ? maxWidth / 3 : maxWidth, "points": samples, "style": ["engine": "ribbon-v1", "smoothing": 0.0, "sensitivity": 1.0], "ink": ["format": "pencilkit-v1", "data": data.base64EncodedString()]]
                changes.append(["kind": "put", "value": object]); next[fingerprint] = id
            }
            let retained = Set(next.values)
            for id in rendered.values where !retained.contains(id) { changes.append(["kind": "remove", "target": id]) }
            // Enqueue before changing the baseline, so disk/network failures cannot erase the local draft.
            if !changes.isEmpty { let previous = rendered; rendered = next; do { try store.enqueue(changes) } catch { rendered = previous; throw error } }
            if refreshAfterDrawing { refreshAfterDrawing = false; refresh() }
        } catch { fail(error) }
    }
    func toolPickerSelectedToolDidChange(_ toolPicker: PKToolPicker) {
        // Keep erasing portable: PencilKit bitmap masks cannot be edited by the web renderer.
        if let eraser = toolPicker.selectedTool as? PKEraserTool, eraser.eraserType == .bitmap { toolPicker.selectedTool = PKEraserTool(.vector) }
    }
    @objc func background() { saveWork?.cancel(); drawingActive = false; publish(); store.stop() }
    @objc func foreground() { store.start() }
    @objc func undo() { canvas.undoManager?.undo() }
    @objc func redo() { canvas.undoManager?.redo() }
    @objc func pair() {
        let alert = UIAlertController(title: "连接电脑 Toolbox", message: "同一 Wi-Fi 下，粘贴电脑「同步绘图」里的完整配对地址，或扫描二维码。", preferredStyle: .alert)
        alert.addTextField { $0.placeholder = "http://电脑地址:43128/#id=…&token=…"; $0.autocapitalizationType = .none; $0.autocorrectionType = .no }
        alert.addAction(UIAlertAction(title: "连接", style: .default) { [weak self] _ in guard let self else { return }; do { try store.pair(alert.textFields?[0].text ?? ""); rendered = [:]; renderedPage = ""; imageCache = [:]; refresh() } catch { fail(error) } })
        alert.addAction(UIAlertAction(title: "扫描二维码", style: .default) { [weak self] _ in guard let self else { return }; let scanner = ScannerController(); scanner.scanned = { [weak self] text in guard let self else { return }; do { try store.pair(text); rendered = [:]; renderedPage = ""; imageCache = [:]; refresh() } catch { fail(error) } }; present(UINavigationController(rootViewController: scanner), animated: true) })
        alert.addAction(UIAlertAction(title: "稍后", style: .cancel)); present(alert, animated: true)
    }
    func sheet(_ title: String, choices: [(String, () -> Void)]) { let alert = UIAlertController(title: title, message: nil, preferredStyle: .actionSheet); for (name, action) in choices { alert.addAction(UIAlertAction(title: name, style: .default) { _ in action() }) }; alert.addAction(UIAlertAction(title: "取消", style: .cancel)); alert.popoverPresentationController?.sourceView = pageControl; present(alert, animated: true) }
    @objc func pages() {
        var choices = store.pages.values.sorted { ($0["name"] as? String ?? "") < ($1["name"] as? String ?? "") }.map { p -> (String, () -> Void) in ((p["name"] as? String) ?? "纸张", { [weak self] in guard let self, let id = p["id"] as? String else { return }; publish(); page = id; refresh() }) }
        choices.append(("＋ 新纸张", { [weak self] in guard let self else { return }; do { let id = UUID().uuidString; try store.enqueue([["kind": "page", "value": ["id": id, "name": "绘图本 · \(store.pages.count + 1)", "paper": "dots"]]]); page = id; refresh() } catch { fail(error) } })); sheet("我的纸张", choices: choices)
    }
    @objc func more() {
        sheet("绘图工具", choices: [
            (canvas.drawingPolicy == .pencilOnly ? "允许手指绘图" : "仅 Apple Pencil 绘图", { [weak self] in guard let self else { return }; canvas.drawingPolicy = canvas.drawingPolicy == .pencilOnly ? .anyInput : .pencilOnly }),
            ("导入图片 / PDF", { [weak self] in guard let self else { return }; let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.image, .pdf], asCopy: true); picker.delegate = self; present(picker, animated: true) }),
            ("导出本页 PNG", { [weak self] in self?.exportImage() }),
            ("导出本机同步备份", { [weak self] in guard let self else { return }; do { publish(); try store.persist(); share([store.backupURL]) } catch { fail(error) } }),
            ("空白纸", { [weak self] in self?.setPaper("plain") }), ("横线纸", { [weak self] in self?.setPaper("lines") }), ("方格纸", { [weak self] in self?.setPaper("grid") }), ("点阵纸", { [weak self] in self?.setPaper("dots") })
        ])
    }
    func setPaper(_ type: String) { guard var value = store.pages[page] else { return }; value["paper"] = type; do { try store.enqueue([["kind": "page", "value": value]]) } catch { fail(error) } }
    func share(_ items: [Any]) { let vc = UIActivityViewController(activityItems: items, applicationActivities: nil); vc.popoverPresentationController?.sourceView = pageControl; present(vc, animated: true) }
    func exportImage() { publish(); let renderer = UIGraphicsImageRenderer(size: stage.bounds.size); let image = renderer.image { context in paper.layer.render(in: context.cgContext); canvas.drawing.image(from: stage.bounds, scale: 1).draw(in: stage.bounds) }; share([image]) }
    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let url = urls.first else { return }; Task { do {
            let access = url.startAccessingSecurityScopedResource(); defer { if access { url.stopAccessingSecurityScopedResource() } }
            let bytes = try Data(contentsOf: url)
            if url.pathExtension.lowercased() == "pdf" {
                guard bytes.count <= 20 * 1024 * 1024, let pdf = PDFDocument(data: bytes), pdf.pageCount <= 30, store.pages.count + pdf.pageCount <= 100 else { throw DrawingError.message("PDF 最多 20 MB / 30 页，绘图本最多 100 页") }
                for n in 0..<pdf.pageCount { guard let pdfPage = pdf.page(at: n) else { continue }; let bounds = pdfPage.bounds(for: .mediaBox); let scale = min(1120 / bounds.width, 1584 / bounds.height); let size = CGSize(width: bounds.width * scale, height: bounds.height * scale)
                    let image = UIGraphicsImageRenderer(size: size).image { c in UIColor.white.setFill(); c.fill(CGRect(origin: .zero, size: size)); c.cgContext.translateBy(x: 0, y: size.height); c.cgContext.scaleBy(x: scale, y: -scale); pdfPage.draw(with: .mediaBox, to: c.cgContext) }
                    let id = UUID().uuidString; try store.enqueue([["kind": "page", "value": ["id": id, "name": url.deletingPathExtension().lastPathComponent.prefix(55) + " · \(n + 1)", "paper": "plain"]]]); try await insert(image, page: id, background: true); page = id
                }
            } else { guard let image = UIImage(data: bytes) else { throw DrawingError.message("无法读取图片") }; try await insert(image, page: page, background: false) }; refresh()
        } catch { fail(error) } }
    }
    func insert(_ image: UIImage, page: String, background: Bool) async throws {
        let scale = min(1, 2400 / max(image.size.width, image.size.height)), size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
        let normalized = UIGraphicsImageRenderer(size: size).image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
        guard let bytes = normalized.pngData() else { throw DrawingError.message("图片编码失败") }; let saved = try await store.upload(bytes)
        let width = background ? min(1120, size.width) : min(700, size.width), height = size.height * width / size.width
        guard let asset = saved["asset"] as? String else { throw DrawingError.message("图片保存失败") }; imageCache[asset] = normalized
        try store.enqueue([["kind": "put", "value": ["id": UUID().uuidString, "page": page, "type": "image", "asset": asset, "x": background ? (1120 - width) / 2 : 100, "y": background ? 0 : 120, "w": width, "h": height, "background": background]]])
    }
}

final class ScannerController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
    var scanned: ((String) -> Void)?, session = AVCaptureSession(), preview: AVCaptureVideoPreviewLayer?, finished = false
    override func viewDidLoad() { super.viewDidLoad(); title = "扫描 Toolbox 绘图二维码"; view.backgroundColor = .black; navigationItem.leftBarButtonItem = UIBarButtonItem(barButtonSystemItem: .cancel, target: self, action: #selector(close)); AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in DispatchQueue.main.async { guard let self else { return }; if granted { self.setup() } else { self.title = "相机未授权，请返回后粘贴配对地址" } } } }
    func setup() { guard let device = AVCaptureDevice.default(for: .video), let input = try? AVCaptureDeviceInput(device: device), session.canAddInput(input) else { return }; session.addInput(input); let output = AVCaptureMetadataOutput(); guard session.canAddOutput(output) else { return }; session.addOutput(output); output.setMetadataObjectsDelegate(self, queue: .main); output.metadataObjectTypes = [.qr]; let layer = AVCaptureVideoPreviewLayer(session: session); layer.videoGravity = .resizeAspectFill; layer.frame = view.bounds; view.layer.insertSublayer(layer, at: 0); preview = layer; DispatchQueue.global(qos: .userInitiated).async { [session] in session.startRunning() } }
    override func viewDidLayoutSubviews() { super.viewDidLayoutSubviews(); preview?.frame = view.bounds }
    override func viewDidDisappear(_ animated: Bool) { super.viewDidDisappear(animated); session.stopRunning() }
    @objc func close() { dismiss(animated: true) }
    func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput metadataObjects: [AVMetadataObject], from connection: AVCaptureConnection) { guard !finished, let code = metadataObjects.first as? AVMetadataMachineReadableCodeObject, let text = code.stringValue else { return }; finished = true; dismiss(animated: true) { [weak self] in self?.scanned?(text) } }
}
