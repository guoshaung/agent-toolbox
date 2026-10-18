// papervid —— 不依赖 ffmpeg 的原生出片引擎（macOS / AVFoundation + AppKit）
// 两个子命令：
//   slide  out.png W H speaker title subtitle [figure.png]   画一张幻灯片
//   mux    manifest.json out.mp4                             把 [{image,audio}] 合成 mp4
import Foundation
import AVFoundation
import AppKit

// V3: research editorial theme. One stable composition per teaching page.
func rgb(_ hex: UInt32) -> NSColor {
    NSColor(srgbRed: CGFloat((hex >> 16) & 255) / 255, green: CGFloat((hex >> 8) & 255) / 255, blue: CGFloat(hex & 255) / 255, alpha: 1)
}
let ink = rgb(0x162D43), blue = rgb(0x245B87), teal = rgb(0x087F82)
let secondary = rgb(0x526678), muted = rgb(0x6E8293), ruleColor = rgb(0xDCE6EE)
let paperColor = rgb(0xF7FAFC)

func fill(_ box: NSRect, _ color: NSColor) { color.setFill(); box.fill() }
func rule(_ x: CGFloat, _ y: CGFloat, _ width: CGFloat, _ color: NSColor = ruleColor) {
    fill(NSRect(x: x, y: y, width: width, height: 1.5), color)
}

@discardableResult
func textBlock(_ text: String, x: CGFloat, top: CGFloat, width: CGFloat, height: CGFloat,
               size: CGFloat, bold: Bool = false, color: NSColor = ink) -> CGFloat {
    let para = NSMutableParagraphStyle(); para.lineSpacing = 5
    for fontSize in stride(from: size, through: max(17, size - 3), by: -1) {
        let font = NSFont(name: bold ? "PingFangSC-Semibold" : "PingFangSC-Regular", size: fontSize) ?? NSFont.systemFont(ofSize: fontSize, weight: bold ? .semibold : .regular)
        let attr: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: color, .paragraphStyle: para]
        let s = NSAttributedString(string: text, attributes: attr)
        let measured = s.boundingRect(with: NSSize(width: width, height: 10000), options: [.usesLineFragmentOrigin, .usesFontLeading]).height
        if measured <= height {
            s.draw(with: NSRect(x: x, y: top - measured, width: width, height: measured + 2), options: [.usesLineFragmentOrigin, .usesFontLeading])
            return ceil(measured)
        }
    }
    FileHandle.standardError.write("layout overflow: \(text.prefix(70))\n".data(using: .utf8)!); exit(2)
}

func teachingPage(specPath: String, out: String) {
    let data = try! Data(contentsOf: URL(fileURLWithPath: specPath))
    let s = try! JSONSerialization.jsonObject(with: data) as! [String: Any]
    let W: CGFloat = 1600, H: CGFloat = 900
    let img = NSImage(size: NSSize(width: W, height: H)); img.lockFocus()
    fill(NSRect(x: 0, y: 0, width: W, height: H), paperColor)
    let chapter = s["chapter"] as? String ?? "论文讲解"
    let title = s["title"] as? String ?? ""
    let takeaway = s["takeaway"] as? String ?? ""
    let pos = s["pageLabel"] as? String ?? ""
    textBlock(chapter, x: 70, top: 858, width: 1100, height: 30, size: 18, bold: true, color: teal)
    rule(70, 812, 1460)
    let points = s["points"] as? [[String: String]] ?? []
    let focus = s["focus"] as? Int ?? -1
    let layout = s["layout"] as? String ?? "outline"
    let top: CGFloat = 615, bottom: CGFloat = 185, contentH = top - bottom
    let figurePath = s["figurePath"] as? String ?? ""
    let figure = figurePath.isEmpty ? nil : NSImage(contentsOfFile: figurePath)
    let introductory = pos.split(separator: "/").first?.trimmingCharacters(in: .whitespaces) == "1" && figure == nil && layout != "table"
    if !introductory {
        textBlock(title, x: 70, top: 787, width: 1460, height: 77, size: 41, bold: true)
        textBlock(takeaway, x: 73, top: 710, width: 1450, height: 75, size: 26, bold: true, color: blue)
    }

    func point(_ i: Int, x: CGFloat, y: CGFloat, width: CGFloat, height: CGFloat, compact: Bool = false) {
        let active = i == focus
        let heading = points[i]["heading"] ?? "", detail = points[i]["detail"] ?? ""
        let font: CGFloat = compact ? 23 : 28
        let headingH = textBlock(heading, x: x, top: y, width: width, height: min(height * 0.42, 90), size: font, bold: true, color: active ? teal : ink)
        let underlineW = min(width, CGFloat(heading.count) * font)
        if active { fill(NSRect(x: x, y: y - headingH - 6, width: underlineW, height: 3), teal.withAlphaComponent(0.5)) }
        let gap: CGFloat = compact ? 9 : 18
        textBlock(detail, x: x, top: y - headingH - gap, width: width, height: height - headingH - gap - 3, size: compact ? 21 : 25, color: secondary)
    }
    func drawPoints(x: CGFloat, width: CGFloat, start: Int = 0, end: Int? = nil, yTop: CGFloat = 615, availableH: CGFloat = 430) {
        let stop = min(end ?? points.count, points.count)
        guard stop > start else { return }
        let rowH = availableH / CGFloat(stop - start)
        for i in start..<stop {
            let y = yTop - CGFloat(i - start) * rowH
            point(i, x: x, y: y, width: width, height: rowH - 7, compact: true)
            if i < stop - 1 { rule(x, y - rowH + 3, width) }
        }
    }
    func drawFigure(_ fig: NSImage, _ box: NSRect) {
        fill(box, .white)
        let inner = box.insetBy(dx: 16, dy: 12)
        let scale = min(inner.width / fig.size.width, inner.height / fig.size.height)
        let size = NSSize(width: fig.size.width * scale, height: fig.size.height * scale)
        fig.draw(in: NSRect(x: inner.midX - size.width / 2, y: inner.midY - size.height / 2, width: size.width, height: size.height))
    }

    if introductory {
        // Title and explanatory points form one composition, rather than an empty cover.
        textBlock(title, x: 72, top: 748, width: 700, height: 230, size: 55, bold: true)
        textBlock(takeaway, x: 74, top: 482, width: 700, height: 200, size: 32, color: blue)
        fill(NSRect(x: 850, y: 198, width: 2, height: 545), ruleColor)
        drawPoints(x: 910, width: 620, yTop: 743, availableH: 545)
    } else if layout == "table", let table = s["table"] as? [String: Any], let cols = table["columns"] as? [String], let rows = table["rows"] as? [[String]], !cols.isEmpty {
        let x: CGFloat = 70, width: CGFloat = 960, rowH = contentH / CGFloat(rows.count + 1), colW = width / CGFloat(cols.count)
        for r in 0...rows.count {
            let y = top - CGFloat(r) * rowH
            fill(NSRect(x: x, y: y - rowH, width: width, height: rowH), r == 0 ? blue : r % 2 == 0 ? rgb(0xEDF3F8) : .white)
            let values = r == 0 ? cols : rows[r - 1]
            for c in 0..<cols.count {
                textBlock(values[c], x: x + CGFloat(c) * colW + 16, top: y - 14, width: colW - 32, height: rowH - 25, size: r == 0 ? 22 : 21, bold: r == 0, color: r == 0 ? .white : ink)
            }
        }
        drawPoints(x: 1080, width: 450)
    } else if let fig = figure, fig.size.width / fig.size.height > 2.2 {
        drawFigure(fig, NSRect(x: 70, y: 370, width: 1460, height: 225))
        let colW = 1490 / CGFloat(max(points.count, 1))
        for i in 0..<points.count { point(i, x: 70 + CGFloat(i) * colW, y: 334, width: colW - 30, height: 155, compact: true) }
    } else if let fig = figure {
        drawFigure(fig, NSRect(x: 70, y: bottom, width: 920, height: contentH + 10))
        drawPoints(x: 1050, width: 480)
    } else if points.count == 4 {
        let colW: CGFloat = 680, rowH: CGFloat = 205
        for i in 0..<4 {
            let col = layout == "comparison" ? i / 2 : i % 2
            let row = layout == "comparison" ? i % 2 : i / 2
            let x: CGFloat = col == 0 ? 70 : 850
            let y = top - CGFloat(row) * rowH
            if row == 1 { rule(x, y + 23, colW) }
            point(i, x: x, y: y, width: colW, height: rowH - 32)
        }
    } else {
        let count = max(points.count, 1), colW = 1490 / CGFloat(count)
        for i in 0..<points.count {
            let x = 70 + CGFloat(i) * colW
            point(i, x: x, y: 565, width: colW - 50, height: 335)
        }
    }
    let source = s["source"] as? String ?? ""
    rule(70, 157, 1460)
    textBlock("来源：\(source)", x: 70, top: 143, width: 1460, height: 45, size: 17, color: muted)
    // No static caption, speaker badge, or empty subtitle band on a teaching page.
    // Spoken subtitles are composited later from the speech provider's timestamps.
    img.unlockFocus()
    guard let tiff = img.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff), let png = rep.representation(using: .png, properties: [:]) else { exit(1) }
    try! png.write(to: URL(fileURLWithPath: out))
    print("OK \(out)")
}

// ---------- 画幻灯片 ----------
func wrap(_ s: String, font: NSFont, maxW: CGFloat) -> [String] {
    var lines: [String] = []; var cur = ""
    for ch in s {
        let trial = cur + String(ch)
        let w = (trial as NSString).size(withAttributes: [.font: font]).width
        if w > maxW && !cur.isEmpty { lines.append(cur); cur = String(ch) } else { cur = trial }
    }
    if !cur.isEmpty { lines.append(cur) }
    return lines
}

func renderSlide(out: String, w: Int, h: Int, speaker: String, title: String, subtitle: String, figure: String?) {
    let img = NSImage(size: NSSize(width: w, height: h))
    img.lockFocus()
    let W = CGFloat(w), H = CGFloat(h)
    // 深色底
    NSColor(srgbRed: 0.059, green: 0.068, blue: 0.09, alpha: 1).setFill()
    NSRect(x: 0, y: 0, width: W, height: H).fill()
    // 顶部一条 B 站粉→蓝 的装饰带
    let grad = NSGradient(colors: [NSColor(srgbRed: 0.984, green: 0.447, blue: 0.6, alpha: 1),
                                   NSColor(srgbRed: 0.0, green: 0.682, blue: 0.925, alpha: 1)])!
    grad.draw(in: NSRect(x: 0, y: H - 10, width: W, height: 10), angle: 0)

    let margin: CGFloat = 70
    // speaker 徽标
    if !speaker.isEmpty {
        let isF = speaker.contains("乙") || speaker.lowercased().contains("f")
        let tag = speaker as NSString
        let tagFont = NSFont.boldSystemFont(ofSize: 30)
        let tagColor = isF ? NSColor(srgbRed: 0.0, green: 0.682, blue: 0.925, alpha: 1)
                           : NSColor(srgbRed: 0.984, green: 0.447, blue: 0.6, alpha: 1)
        tag.draw(at: NSPoint(x: margin, y: H - 70),
                 withAttributes: [.font: tagFont, .foregroundColor: tagColor])
    }
    // 标题
    let titleFont = NSFont.boldSystemFont(ofSize: 46)
    var y = H - 150
    for line in wrap(title, font: titleFont, maxW: W - margin * 2) {
        (line as NSString).draw(at: NSPoint(x: margin, y: y),
            withAttributes: [.font: titleFont, .foregroundColor: NSColor(white: 0.96, alpha: 1)])
        y -= 60
    }
    // 配图（如有），放中部
    if let f = figure, let fig = NSImage(contentsOfFile: f) {
        let maxFigH = H * 0.42, maxFigW = W - margin * 2
        var fw = fig.size.width, fh = fig.size.height
        let scale = min(maxFigW / fw, maxFigH / fh, 1)
        fw *= scale; fh *= scale
        let fx = (W - fw) / 2, fy = (H - fh) / 2 - 40
        NSColor.white.setFill(); NSRect(x: fx - 12, y: fy - 12, width: fw + 24, height: fh + 24).fill()
        fig.draw(in: NSRect(x: fx, y: fy, width: fw, height: fh))
    }
    // 底部字幕条
    let subFont = NSFont.systemFont(ofSize: 34, weight: .medium)
    let subLines = wrap(subtitle, font: subFont, maxW: W - margin * 2)
    let barH = CGFloat(subLines.count) * 46 + 50
    NSColor(srgbRed: 0.09, green: 0.1, blue: 0.14, alpha: 0.96).setFill()
    NSBezierPath(roundedRect: NSRect(x: margin - 20, y: 36, width: W - (margin - 20) * 2, height: barH), xRadius: 18, yRadius: 18).fill()
    var sy = 36 + barH - 54
    for line in subLines {
        (line as NSString).draw(at: NSPoint(x: margin, y: sy),
            withAttributes: [.font: subFont, .foregroundColor: NSColor(white: 0.93, alpha: 1)])
        sy -= 46
    }
    img.unlockFocus()
    guard let tiff = img.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
          let png = rep.representation(using: .png, properties: [:]) else { fatalError("png fail") }
    try! png.write(to: URL(fileURLWithPath: out))
}

// ---------- 合成 mp4 ----------
func pixelBuffer(_ path: String, _ w: Int, _ h: Int, cached: CGImage? = nil, caption: String = "", previous: String = "", progress: Double = 1) -> CVPixelBuffer {
    let attrs: [String: Any] = [kCVPixelBufferCGImageCompatibilityKey as String: true,
                                kCVPixelBufferCGBitmapContextCompatibilityKey as String: true]
    var pb: CVPixelBuffer?
    CVPixelBufferCreate(kCFAllocatorDefault, w, h, kCVPixelFormatType_32ARGB, attrs as CFDictionary, &pb)
    let buf = pb!
    CVPixelBufferLockBaseAddress(buf, [])
    let ctx = CGContext(data: CVPixelBufferGetBaseAddress(buf), width: w, height: h, bitsPerComponent: 8,
                        bytesPerRow: CVPixelBufferGetBytesPerRow(buf), space: CGColorSpaceCreateDeviceRGB(),
                        bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue)!
    let cg = cached ?? NSImage(contentsOfFile: path)?.cgImage(forProposedRect: nil, context: nil, hints: nil)
    if let cg = cg {
        ctx.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
    }
    if !caption.isEmpty {
        ctx.saveGState(); ctx.scaleBy(x: CGFloat(w) / 1600, y: CGFloat(h) / 900)
        ctx.clip(to: CGRect(x: 0, y: 0, width: 1600, height: 88))
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(cgContext: ctx, flipped: false)
        fill(NSRect(x: 0, y: 0, width: 1600, height: 88), rgb(0xEAF1F6))
        let amount = CGFloat(min(1, max(0, progress)))
        if !previous.isEmpty && amount < 1 {
            textBlock(previous, x: 80, top: 63 + amount * 56, width: 1440, height: 60, size: 28, color: muted)
        }
        textBlock(caption, x: 80, top: 63 - (previous.isEmpty ? 0 : (1 - amount) * 56), width: 1440, height: 60, size: 28)
        NSGraphicsContext.restoreGraphicsState(); ctx.restoreGState()
    }
    CVPixelBufferUnlockBaseAddress(buf, [])
    return buf
}

func mux(manifestPath: String, outPath: String) {
    let data = try! Data(contentsOf: URL(fileURLWithPath: manifestPath))
    let obj = try! JSONSerialization.jsonObject(with: data) as! [String: Any]
    let w = obj["w"] as? Int ?? 1280, h = obj["h"] as? Int ?? 720
    let segs = obj["segments"] as! [[String: String]]

    let comp = AVMutableComposition()
    let aTrack = comp.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid)!
    var cursor = CMTime.zero; var durs: [CMTime] = []
    for seg in segs {
        let asset = AVURLAsset(url: URL(fileURLWithPath: seg["audio"]!))
        let dur = asset.duration
        if let at = asset.tracks(withMediaType: .audio).first {
            try! aTrack.insertTimeRange(CMTimeRange(start: .zero, duration: dur), of: at, at: cursor)
        }
        durs.append(dur); cursor = cursor + dur
    }
    exportVideo(comp: comp, segs: segs, durs: durs, total: cursor, w: w, h: h, outPath: outPath, subtitles: obj["subtitles"] as? [[String: Any]] ?? [])
}

// Restyle existing lessons without calling either the language or speech model again.
func restyle(manifestPath: String, outPath: String) {
    let obj = try! JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: manifestPath))) as! [String: Any]
    let original = obj["video"] as! String
    guard !FileManager.default.fileExists(atPath: outPath), URL(fileURLWithPath: original).standardizedFileURL != URL(fileURLWithPath: outPath).standardizedFileURL else {
        FileHandle.standardError.write(Data("restyle requires a new output path\n".utf8)); exit(2)
    }
    let frames = obj["frames"] as! [[String: Any]]
    let source = AVURLAsset(url: URL(fileURLWithPath: original))
    let total = source.duration
    guard !frames.isEmpty, let audio = source.tracks(withMediaType: .audio).first else { exit(2) }
    let comp = AVMutableComposition()
    let track = comp.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid)!
    try! track.insertTimeRange(CMTimeRange(start: .zero, duration: total), of: audio, at: .zero)
    var durs: [CMTime] = [], segs: [[String: String]] = []
    for (i, frame) in frames.enumerated() {
        let image = frame["image"] as! String
        guard FileManager.default.fileExists(atPath: image) else { exit(2) }
        let start = CMTime(seconds: frame["start"] as! Double, preferredTimescale: 60000)
        let end = i + 1 < frames.count ? CMTime(seconds: frames[i + 1]["start"] as! Double, preferredTimescale: 60000) : total
        guard CMTimeCompare(end, start) > 0 else { exit(2) }
        durs.append(CMTimeSubtract(end, start)); segs.append(["image": image])
    }
    exportVideo(comp: comp, segs: segs, durs: durs, total: total, w: 1600, h: 900, outPath: outPath)
}

func exportVideo(comp: AVMutableComposition, segs: [[String: String]], durs: [CMTime], total: CMTime, w: Int, h: Int, outPath: String, subtitles: [[String: Any]] = []) {
    // 先写纯视频
    let vurl = URL(fileURLWithPath: NSTemporaryDirectory() + "pv_\(UUID().uuidString).mp4")
    let writer = try! AVAssetWriter(outputURL: vurl, fileType: .mp4)
    let vinput = AVAssetWriterInput(mediaType: .video, outputSettings: [
        AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: w, AVVideoHeightKey: h])
    vinput.expectsMediaDataInRealTime = false
    let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: vinput, sourcePixelBufferAttributes: [
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32ARGB,
        kCVPixelBufferWidthKey as String: w, kCVPixelBufferHeightKey as String: h])
    writer.add(vinput); writer.startWriting(); writer.startSession(atSourceTime: .zero)
    let ticks: Double = 60000, lastTick = max(Int64(0), Int64(total.seconds * ticks) - 1)
    var times = Set<Int64>([0, max(0, lastTick - 2000)]), starts: [Double] = [], cursor = 0.0
    for duration in durs { starts.append(cursor); times.insert(Int64((cursor * ticks).rounded())); cursor += duration.seconds }
    let cues = subtitles.filter { cue in
        guard let start = cue["start"] as? Double, let end = cue["end"] as? Double, let text = cue["text"] as? String else { return false }
        return start.isFinite && end.isFinite && start >= 0 && end > start && end <= total.seconds + 0.05 && !text.isEmpty && text.count <= 38
    }.sorted { ($0["start"] as! Double) < ($1["start"] as! Double) }
    for cue in cues {
        let start = cue["start"] as! Double, end = cue["end"] as! Double
        times.insert(Int64((start * ticks).rounded())); times.insert(Int64((end * ticks).rounded()))
        // Four transition frames move the previous spoken line up as the new line enters.
        for step in 1...4 { let at = start + Double(step) * 0.04; if at < end { times.insert(Int64((at * ticks).rounded())) } }
    }
    var segmentIndex = 0, cueIndex = -1, cachedPath = "", cachedImage: CGImage?
    for tick in times.filter({ $0 >= 0 && $0 <= lastTick }).sorted() {
        let seconds = Double(tick) / ticks
        while segmentIndex + 1 < starts.count && seconds >= starts[segmentIndex + 1] { segmentIndex += 1 }
        while cueIndex + 1 < cues.count && seconds + 0.00002 >= cues[cueIndex + 1]["start"] as! Double { cueIndex += 1 }
        let imagePath = segs[segmentIndex]["image"]!
        if imagePath != cachedPath { cachedImage = NSImage(contentsOfFile: imagePath)?.cgImage(forProposedRect: nil, context: nil, hints: nil); cachedPath = imagePath }
        var caption = "", previous = "", progress = 1.0
        if cueIndex >= 0, seconds < cues[cueIndex]["end"] as! Double {
            let start = cues[cueIndex]["start"] as! Double
            caption = cues[cueIndex]["text"] as! String
            if cueIndex > 0 && start - (cues[cueIndex - 1]["end"] as! Double) <= 0.25 && start > starts[segmentIndex] + 0.01 {
                previous = cues[cueIndex - 1]["text"] as! String
                progress = min(1, max(0, (seconds - start) / 0.16))
            }
        }
        while !vinput.isReadyForMoreMediaData { usleep(5000) }
        let appended = autoreleasepool { adaptor.append(pixelBuffer(imagePath, w, h, cached: cachedImage, caption: caption, previous: previous, progress: progress), withPresentationTime: CMTime(value: tick, timescale: 60000)) }
        if !appended { FileHandle.standardError.write(Data("subtitle frame encoding failed\n".utf8)); exit(2) }
    }
    writer.endSession(atSourceTime: total)
    vinput.markAsFinished()
    let sem1 = DispatchSemaphore(value: 0)
    writer.finishWriting { sem1.signal() }; sem1.wait()

    // 视频 + 音频 合成导出
    let vAsset = AVURLAsset(url: vurl)
    let vTrack = comp.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid)!
    try! vTrack.insertTimeRange(CMTimeRange(start: .zero, duration: total), of: vAsset.tracks(withMediaType: .video).first!, at: .zero)
    let export = AVAssetExportSession(asset: comp, presetName: AVAssetExportPresetHighestQuality)!
    try? FileManager.default.removeItem(atPath: outPath)
    export.outputURL = URL(fileURLWithPath: outPath); export.outputFileType = .mp4
    let sem2 = DispatchSemaphore(value: 0)
    export.exportAsynchronously { sem2.signal() }; sem2.wait()
    if export.status != .completed { FileHandle.standardError.write("export 失败: \(String(describing: export.error))\n".data(using: .utf8)!); exit(1) }
    try? FileManager.default.removeItem(at: vurl)
    print("OK \(outPath)")
}

// ---------- 入口 ----------
let a = CommandLine.arguments
switch a.count >= 2 ? a[1] : "" {
case "version":
    print("papervid 4")
case "page":
    teachingPage(specPath: a[2], out: a[3])
case "duration":
    let asset = AVURLAsset(url: URL(fileURLWithPath: a[2]))
    print(asset.duration.seconds)
case "frame":
    let asset = AVURLAsset(url: URL(fileURLWithPath: a[2]))
    let generator = AVAssetImageGenerator(asset: asset)
    generator.appliesPreferredTrackTransform = true
    generator.requestedTimeToleranceBefore = .zero
    generator.requestedTimeToleranceAfter = .zero
    let frame = try! generator.copyCGImage(at: CMTime(seconds: Double(a[3])!, preferredTimescale: 60000), actualTime: nil)
    let rep = NSBitmapImageRep(cgImage: frame)
    try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: a[4]))
case "slide":
    renderSlide(out: a[2], w: Int(a[3])!, h: Int(a[4])!, speaker: a[5], title: a[6], subtitle: a[7],
                figure: a.count > 8 && !a[8].isEmpty ? a[8] : nil)
    print("OK \(a[2])")
case "mux":
    mux(manifestPath: a[2], outPath: a[3])
case "restyle":
    restyle(manifestPath: a[2], outPath: a[3])
default:
    print("usage: papervid slide out.png W H speaker title subtitle [fig.png] | papervid mux manifest.json out.mp4")
}
