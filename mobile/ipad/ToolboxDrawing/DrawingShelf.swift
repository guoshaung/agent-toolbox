import UIKit
import PencilKit
import PhotosUI
import ImageIO
import UniformTypeIdentifiers

struct ShelfAsset: Codable {
    let asset: String
    let width: Double
    let height: Double
}

@MainActor final class ImageLibrary {
    private(set) var scope = ""
    private(set) var items = [ShelfAsset]()
    private let thumbnails = NSCache<NSString, UIImage>()
    private var directory: URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("ImageShelf", isDirectory: true).appendingPathComponent(scope, isDirectory: true)
    }
    func open(_ id: String) throws {
        guard id != scope, id.range(of: "^[A-Za-z0-9_-]{1,80}$", options: .regularExpression) != nil else { return }
        let previous = scope; scope = id
        do {
            let file = directory.appendingPathComponent("library.json")
            let saved = FileManager.default.fileExists(atPath: file.path) ? try JSONDecoder().decode([ShelfAsset].self, from: Data(contentsOf: file)) : []
            items = Array(saved.filter { valid($0.asset) && $0.width > 0 && $0.height > 0 }.prefix(200))
            thumbnails.removeAllObjects()
        } catch { scope = previous; throw error }
    }
    private func valid(_ asset: String) -> Bool { asset.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil }
    private func persist() throws {
        guard !scope.isEmpty else { throw DrawingError.message("请先配对电脑，再使用图片素材栏") }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try JSONEncoder().encode(items).write(to: directory.appendingPathComponent("library.json"), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
    @discardableResult func add(_ item: ShelfAsset) throws -> Bool {
        guard valid(item.asset), item.width > 0, item.height > 0 else { throw DrawingError.message("图片素材无效") }
        if items.contains(where: { $0.asset == item.asset }) { return false }
        let old = items; items.append(item); if items.count > 200 { items.removeFirst() }
        do { try persist() } catch { items = old; throw error }; return true
    }
    func remove(_ asset: String) throws {
        let old = items; items.removeAll { $0.asset == asset }
        do { try persist() } catch { items = old; throw error }
    }
    func cache(_ data: Data, asset: String) throws {
        guard valid(asset), !scope.isEmpty else { return }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try data.write(to: directory.appendingPathComponent(asset + ".png"), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        thumbnails.removeObject(forKey: asset as NSString)
    }
    func image(_ asset: String) -> UIImage? {
        guard valid(asset), !scope.isEmpty else { return nil }
        return UIImage(contentsOfFile: directory.appendingPathComponent(asset + ".png").path)
    }
    func thumbnail(_ asset: String) -> UIImage? {
        guard valid(asset), !scope.isEmpty else { return nil }
        if let value = thumbnails.object(forKey: asset as NSString) { return value }
        guard let source = CGImageSourceCreateWithURL(directory.appendingPathComponent(asset + ".png") as CFURL, nil),
              let cg = CGImageSourceCreateThumbnailAtIndex(source, 0, [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceThumbnailMaxPixelSize: 180, kCGImageSourceCreateThumbnailWithTransform: true] as CFDictionary) else { return nil }
        let value = UIImage(cgImage: cg); thumbnails.setObject(value, forKey: asset as NSString); return value
    }
}

@MainActor final class ShelfCell: UICollectionViewCell {
    let imageView = UIImageView(), number = UILabel()
    override init(frame: CGRect) {
        super.init(frame: frame); contentView.backgroundColor = .secondarySystemGroupedBackground; contentView.layer.cornerRadius = 10
        contentView.layer.borderColor = UIColor.separator.cgColor; contentView.layer.borderWidth = 0.5
        imageView.contentMode = .scaleAspectFit; imageView.translatesAutoresizingMaskIntoConstraints = false
        number.font = .systemFont(ofSize: 10); number.textColor = .secondaryLabel; number.textAlignment = .center; number.translatesAutoresizingMaskIntoConstraints = false
        contentView.addSubview(imageView); contentView.addSubview(number)
        NSLayoutConstraint.activate([imageView.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 5), imageView.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 5), imageView.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -5), imageView.bottomAnchor.constraint(equalTo: number.topAnchor, constant: -2), number.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -4), number.centerXAnchor.constraint(equalTo: contentView.centerXAnchor)])
        isAccessibilityElement = true
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
}

@MainActor final class ImageShelfView: UIView, UICollectionViewDataSource, UICollectionViewDelegate, UICollectionViewDragDelegate {
    var items = [ShelfAsset]() { didSet { collection.reloadData(); empty.isHidden = !items.isEmpty } }
    var thumbnail: ((String) -> UIImage?)?, tapped: ((ShelfAsset) -> Void)?, addPhotos: (() -> Void)?, addFiles: (() -> Void)?, remove: ((String) -> Void)?
    let collection: UICollectionView
    let empty = UILabel()
    override init(frame: CGRect) {
        let layout = UICollectionViewFlowLayout(); layout.scrollDirection = .horizontal; layout.itemSize = CGSize(width: 88, height: 78); layout.minimumLineSpacing = 10; layout.sectionInset = UIEdgeInsets(top: 9, left: 10, bottom: 9, right: 10)
        collection = UICollectionView(frame: .zero, collectionViewLayout: layout)
        super.init(frame: frame); backgroundColor = .secondarySystemGroupedBackground
        let photos = UIButton(type: .system), files = UIButton(type: .system)
        photos.configuration = .tinted(); photos.setTitle("＋ 相册", for: .normal); photos.addAction(UIAction { [weak self] _ in self?.addPhotos?() }, for: .touchUpInside)
        files.configuration = .plain(); files.setTitle("文件", for: .normal); files.addAction(UIAction { [weak self] _ in self?.addFiles?() }, for: .touchUpInside)
        let buttons = UIStackView(arrangedSubviews: [photos, files]); buttons.axis = .vertical; buttons.spacing = 4; buttons.translatesAutoresizingMaskIntoConstraints = false
        collection.backgroundColor = .clear; collection.dataSource = self; collection.delegate = self; collection.dragDelegate = self; collection.dragInteractionEnabled = true; collection.translatesAutoresizingMaskIntoConstraints = false; collection.register(ShelfCell.self, forCellWithReuseIdentifier: "asset")
        empty.text = "从相册加入图片，轻点居中插入，按住拖到画纸"; empty.textColor = .secondaryLabel; empty.font = .systemFont(ofSize: 13); empty.translatesAutoresizingMaskIntoConstraints = false; empty.isUserInteractionEnabled = false
        addSubview(buttons); addSubview(collection); addSubview(empty)
        let height = heightAnchor.constraint(equalToConstant: 98); height.priority = .defaultHigh; height.isActive = true
        NSLayoutConstraint.activate([buttons.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 12), buttons.centerYAnchor.constraint(equalTo: centerYAnchor), buttons.widthAnchor.constraint(equalToConstant: 88), collection.leadingAnchor.constraint(equalTo: buttons.trailingAnchor, constant: 8), collection.trailingAnchor.constraint(equalTo: trailingAnchor), collection.topAnchor.constraint(equalTo: topAnchor), collection.bottomAnchor.constraint(equalTo: bottomAnchor), empty.leadingAnchor.constraint(equalTo: collection.leadingAnchor, constant: 12), empty.centerYAnchor.constraint(equalTo: centerYAnchor)])
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    func collectionView(_ collectionView: UICollectionView, numberOfItemsInSection section: Int) -> Int { items.count }
    func collectionView(_ collectionView: UICollectionView, cellForItemAt indexPath: IndexPath) -> UICollectionViewCell {
        let cell = collectionView.dequeueReusableCell(withReuseIdentifier: "asset", for: indexPath) as! ShelfCell
        cell.imageView.image = thumbnail?(items[indexPath.item].asset) ?? UIImage(systemName: "photo")
        cell.number.text = "图片 \(indexPath.item + 1)"; cell.accessibilityLabel = "图片 \(indexPath.item + 1)，轻点居中插入，按住拖到画纸"; return cell
    }
    func collectionView(_ collectionView: UICollectionView, didSelectItemAt indexPath: IndexPath) { tapped?(items[indexPath.item]) }
    func collectionView(_ collectionView: UICollectionView, itemsForBeginning session: UIDragSession, at indexPath: IndexPath) -> [UIDragItem] {
        let item = items[indexPath.item], drag = UIDragItem(itemProvider: NSItemProvider(object: (item.asset as NSString)))
        drag.localObject = item; return [drag]
    }
}

@MainActor extension DrawingController: PHPickerViewControllerDelegate, UIDropInteractionDelegate, UIColorPickerViewControllerDelegate, UIPencilInteractionDelegate {
    func setupDrawingTools() {
        let toolNames = [("钢笔", "pencil.tip", "pen"), ("铅笔", "pencil", "pencil"), ("荧光", "highlighter", "marker"), ("套索", "lasso", "lasso"), ("橡皮", "eraser", "eraser")]
        for (title, icon, id) in toolNames {
            let button = UIButton(type: .system); button.configuration = .bordered(); button.configuration?.title = title; button.configuration?.image = UIImage(systemName: icon); button.configuration?.imagePadding = 5
            button.accessibilityIdentifier = "tool-" + id; button.addAction(UIAction { [weak self] _ in self?.selectTool(id) }, for: .touchUpInside)
            toolButtons[id] = button; toolRow.addArrangedSubview(button)
        }
        colorButton.configuration = .bordered(); colorButton.setTitle("颜色", for: .normal); colorButton.addAction(UIAction { [weak self] _ in self?.chooseColor() }, for: .touchUpInside)
        widthButton.configuration = .bordered(); widthButton.setTitle("粗细", for: .normal); widthButton.showsMenuAsPrimaryAction = true
        widthButton.menu = UIMenu(children: [("细", 1.5), ("标准", 3.0), ("粗", 6.0), ("加粗", 12.0)].map { title, width in UIAction(title: title) { [weak self] _ in guard let self else { return }; inkWidth = width; selectTool(selectedInkKind) } })
        let spacer = UIView(); spacer.setContentHuggingPriority(.defaultLow, for: .horizontal)
        galleryButton.configuration = .tinted(); galleryButton.configuration?.title = "图片素材"; galleryButton.configuration?.image = UIImage(systemName: "photo.on.rectangle"); galleryButton.configuration?.imagePadding = 5; galleryButton.accessibilityIdentifier = "image-shelf"
        galleryButton.addAction(UIAction { [weak self] _ in guard let self else { return }; shelfView.isHidden.toggle(); galleryButton.isSelected = !shelfView.isHidden; if !shelfView.isHidden { refreshShelf() } }, for: .touchUpInside)
        [colorButton, widthButton, spacer].forEach { toolRow.addArrangedSubview($0) }
        toolRow.spacing = 7; toolRow.alignment = .center
        shelfView.isHidden = true
        shelfView.addPhotos = { [weak self] in self?.openPhotos() }
        shelfView.addFiles = { [weak self] in self?.openImageFiles() }
        shelfView.tapped = { [weak self] item in guard let self else { return }; do { try place(item, at: visibleCenter(), on: page) } catch { fail(error) } }
        shelfView.thumbnail = { [weak self] asset in
            guard let self else { return nil }
            if let thumb = library.thumbnail(asset) { return thumb }
            loadShelfImage(asset); return nil
        }
        shelfView.remove = { [weak self] asset in guard let self else { return }; do { try library.remove(asset); shelfView.items = library.items } catch { fail(error) } }
        canvas.addInteraction(UIDropInteraction(delegate: self))
        let pencil = UIPencilInteraction(); pencil.delegate = self; canvas.addInteraction(pencil)
        selectTool("pen")
    }
    func selectTool(_ id: String) {
        if id == "eraser" { canvas.tool = PKEraserTool(.vector) }
        else if id == "lasso" { canvas.tool = PKLassoTool() }
        else {
            selectedInkKind = id
            let type: PKInk.InkType = id == "pencil" ? .pencil : id == "marker" ? .marker : .pen
            canvas.tool = PKInkingTool(type, color: inkColor, width: id == "marker" ? max(12, inkWidth * 4) : inkWidth)
        }
        picker.selectedTool = canvas.tool; canvas.becomeFirstResponder(); refreshToolButtons()
    }
    func refreshToolButtons() {
        let selected: String
        if let ink = canvas.tool as? PKInkingTool { selected = ink.inkType == .pencil ? "pencil" : ink.inkType == .marker ? "marker" : "pen" }
        else { selected = canvas.tool is PKEraserTool ? "eraser" : "lasso" }
        for (id, button) in toolButtons {
            let old = button.configuration
            var config = UIButton.Configuration.filled(); config.title = old?.title; config.image = old?.image; config.imagePadding = 5
            config.baseBackgroundColor = id == selected ? UIColor(red: 0, green: 0.32, blue: 0.78, alpha: 1) : .tertiarySystemFill
            config.baseForegroundColor = id == selected ? .white : .label
            button.isSelected = id == selected; button.configuration = config
        }
        colorButton.tintColor = inkColor
        navigationItem.rightBarButtonItems?.first { $0.title == "撤销" }?.isEnabled = !undoEdits.isEmpty
        navigationItem.rightBarButtonItems?.first { $0.title == "重做" }?.isEnabled = !redoEdits.isEmpty
    }
    func chooseColor() { let vc = UIColorPickerViewController(); vc.selectedColor = inkColor; vc.supportsAlpha = false; vc.delegate = self; present(vc, animated: true) }
    func colorPickerViewControllerDidSelectColor(_ viewController: UIColorPickerViewController) { inkColor = viewController.selectedColor; selectTool(selectedInkKind) }
    func pencilInteractionDidTap(_ interaction: UIPencilInteraction) { selectTool(canvas.tool is PKEraserTool ? selectedInkKind : "eraser") }
    func visibleCenter() -> CGPoint {
        let rect = stage.convert(scroll.bounds, from: scroll).intersection(stage.bounds)
        return rect.isNull || rect.isEmpty ? CGPoint(x: 560, y: 792) : CGPoint(x: rect.midX, y: rect.midY)
    }
    func refreshShelf() {
        guard !store.notebookID.isEmpty else { return }
        do {
            try library.open(store.notebookID)
            for value in store.objects.values.sorted(by: { ($0["revision"] as? Int ?? 0) < ($1["revision"] as? Int ?? 0) }) where value["type"] as? String == "image" && value["background"] as? Bool != true {
                if let asset = value["asset"] as? String, let w = value["w"] as? Double, let h = value["h"] as? Double { try library.add(ShelfAsset(asset: asset, width: w, height: h)) }
            }
            if shelfView.items.map(\.asset) != library.items.map(\.asset) { shelfView.items = library.items }
        } catch { statusLabel.text = error.localizedDescription }
    }
    func loadShelfImage(_ asset: String) {
        guard !shelfLoads.contains(asset), store.online else { return }; shelfLoads.insert(asset)
        let notebook = store.notebookID
        Task { [weak self] in guard let self else { return }; defer { shelfLoads.remove(asset) }
            do { let data = try await store.image(asset); guard store.notebookID == notebook else { return }; try library.cache(data, asset: asset); shelfView.collection.reloadData() } catch { statusLabel.text = "素材图片等待连接电脑后加载" }
        }
    }
    func openPhotos() {
        guard store.online else { fail(DrawingError.message("请先连接电脑，再从相册加入新素材；已保存的素材可离线插入")); return }
        var configuration = PHPickerConfiguration(); configuration.filter = .images; configuration.selectionLimit = 10
        let picker = PHPickerViewController(configuration: configuration); picker.delegate = self; present(picker, animated: true)
    }
    func openImageFiles() { let vc = UIDocumentPickerViewController(forOpeningContentTypes: [.image, .pdf], asCopy: true); vc.delegate = self; present(vc, animated: true) }
    func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        picker.dismiss(animated: true)
        Task { [weak self] in guard let self else { return }
            for result in results {
                do {
                    let image: UIImage = try await withCheckedThrowingContinuation { continuation in
                        result.itemProvider.loadObject(ofClass: UIImage.self) { object, error in
                            if let image = object as? UIImage { continuation.resume(returning: image) }
                            else { continuation.resume(throwing: error ?? DrawingError.message("无法读取相册图片")) }
                        }
                    }
                    _ = try await saveToShelf(image)
                } catch { fail(error); break }
            }
            shelfView.isHidden = false; galleryButton.isSelected = true; shelfView.items = library.items
        }
    }
    func saveToShelf(_ image: UIImage) async throws -> ShelfAsset {
        let notebook = store.notebookID
        try library.open(store.notebookID)
        let scale = min(1, 2400 / max(image.size.width, image.size.height)), size = CGSize(width: max(1, image.size.width * scale), height: max(1, image.size.height * scale))
        let format = UIGraphicsImageRendererFormat(); format.scale = 1
        let normalized = UIGraphicsImageRenderer(size: size, format: format).image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
        guard var bytes = normalized.pngData() else { throw DrawingError.message("图片编码失败") }
        if bytes.count > 7 * 1024 * 1024, let jpeg = normalized.jpegData(compressionQuality: 0.85) { bytes = jpeg }
        let saved = try await store.upload(bytes)
        guard store.notebookID == notebook else { throw DrawingError.message("电脑连接已切换，请在当前绘图本重新加入图片") }
        guard let asset = saved["asset"] as? String else { throw DrawingError.message("图片保存失败") }
        let item = ShelfAsset(asset: asset, width: saved["width"] as? Double ?? size.width, height: saved["height"] as? Double ?? size.height)
        try library.add(item); try library.cache(bytes, asset: asset); shelfView.items = library.items; return item
    }
    func place(_ item: ShelfAsset, at center: CGPoint, on pageID: String) throws {
        guard store.pages[pageID] != nil else { throw DrawingError.message("请先连接电脑并选择一张纸") }
        let visible = stage.convert(scroll.bounds, from: scroll).intersection(stage.bounds)
        let maxW = min(700, visible.isEmpty || visible.isNull ? 650 : visible.width * 0.65)
        let maxH = min(900, visible.isEmpty || visible.isNull ? 850 : visible.height * 0.65)
        let scale = min(1, maxW / item.width, maxH / item.height), w = max(1, item.width * scale), h = max(1, item.height * scale)
        let value: [String: Any] = ["id": UUID().uuidString, "page": pageID, "type": "image", "asset": item.asset, "x": max(0, min(1120 - w, center.x - w / 2)), "y": max(0, min(1584 - h, center.y - h / 2)), "w": w, "h": h, "background": false]
        try commitEdit([["kind": "put", "value": value]])
        if let image = library.image(item.asset) { imageCache[item.asset] = image }; refresh()
    }
    func dropInteraction(_ interaction: UIDropInteraction, canHandle session: UIDropSession) -> Bool { session.items.contains { $0.localObject is ShelfAsset } || session.canLoadObjects(ofClass: UIImage.self) }
    func dropInteraction(_ interaction: UIDropInteraction, sessionDidUpdate session: UIDropSession) -> UIDropProposal { UIDropProposal(operation: .copy) }
    func dropInteraction(_ interaction: UIDropInteraction, performDrop session: UIDropSession) {
        let center = session.location(in: stage), pageID = page
        for drag in session.items {
            if let item = drag.localObject as? ShelfAsset { do { try place(item, at: center, on: pageID) } catch { fail(error) } }
            else if drag.itemProvider.canLoadObject(ofClass: UIImage.self) {
                drag.itemProvider.loadObject(ofClass: UIImage.self) { [weak self] object, error in
                    Task { @MainActor in guard let self else { return }; do { guard let image = object as? UIImage else { throw error ?? DrawingError.message("无法读取拖入图片") }; let item = try await self.saveToShelf(image); try self.place(item, at: center, on: pageID) } catch { self.fail(error) } }
                }
            }
        }
    }
    func commitEdit(_ changes: [[String: Any]]) throws {
        let reverse: [[String: Any]] = changes.reversed().compactMap { change in
            if change["kind"] as? String == "remove", let id = change["target"] as? String, let value = store.objects[id] { return ["kind": "put", "value": value] }
            if let value = change["value"] as? [String: Any], let id = value["id"] as? String { return ["kind": "remove", "target": id] }; return nil
        }
        try store.enqueue(changes); undoEdits.append(Edit(forward: changes, reverse: reverse)); if undoEdits.count > 100 { undoEdits.removeFirst() }; redoEdits.removeAll(); refreshToolButtons()
    }
    func eraseWithScribble(_ drawing: PKDrawing) throws -> Bool {
        guard scribbleEnabled, let ink = canvas.tool as? PKInkingTool, ink.inkType != .marker else { return false }
        let additions = drawing.strokes.filter { rendered[fingerprint($0)] == nil }
        guard additions.count == 1 else { return false }
        let added = additions[0], controls = Array(added.path.interpolatedPoints(by: .distance(4)))
        let points = controls.map { $0.location.applying(added.transform) }
        let duration = (controls.last?.timeOffset ?? 0) - (controls.first?.timeOffset ?? 0)
        guard ScribbleEraser.recognizes(points, zoom: scroll.zoomScale, duration: duration) else { return false }
        let region = ScribbleEraser.bounds(points).insetBy(dx: -18, dy: -18), ids = Set(rendered.values)
        var changes = [[String: Any]]()
        for object in values() where object["type"] as? String == "stroke" {
            guard let id = object["id"] as? String, ids.contains(id), let old = stroke(object), region.intersects(old.renderBounds) else { continue }
            let oldPoints = Array(old.path.interpolatedPoints(by: .distance(6))).map { $0.location.applying(old.transform) }
            if ScribbleEraser.touches(points, ink: oldPoints, radius: max(6 / scroll.zoomScale, (object["width"] as? Double ?? 3) / 2)) { changes.append(["kind": "remove", "target": id]) }
        }
        guard !changes.isEmpty else { return false }
        try commitEdit(changes); refresh(); statusLabel.text = "已涂划擦除 \(changes.count) 笔 · 点撤销可恢复"; return true
    }
}
