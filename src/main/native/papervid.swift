// papervid —— 不依赖 ffmpeg 的原生出片引擎（macOS / AVFoundation + AppKit）
// 两个子命令：
//   slide  out.png W H speaker title subtitle [figure.png]   画一张幻灯片
//   mux    manifest.json out.mp4                             把 [{image,audio}] 合成 mp4
import Foundation
import AVFoundation
import AppKit

// V2: complete teaching pages. Narration turns share a page; only emphasis changes.
let ink = NSColor(srgbRed: 0.13, green: 0.18, blue: 0.24, alpha: 1)
let blue = NSColor(srgbRed: 0.08, green: 0.38, blue: 0.66, alpha: 1)

@discardableResult
func textBlock(_ text: String, x: CGFloat, top: CGFloat, width: CGFloat, height: CGFloat,
               size: CGFloat, bold: Bool = false, color: NSColor = ink) -> CGFloat {
    let para = NSMutableParagraphStyle(); para.lineSpacing = 6
    for fontSize in stride(from: size, through: max(17, size - 3), by: -1) {
        let font = NSFont.systemFont(ofSize: fontSize, weight: bold ? .semibold : .regular)
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
    NSColor.white.setFill(); NSRect(x: 0, y: 0, width: W, height: H).fill()
    NSColor(srgbRed: 0.18, green: 0.23, blue: 0.30, alpha: 1).setFill()
    NSRect(x: 0, y: H - 105, width: W, height: 105).fill()
    let chapter = s["chapter"] as? String ?? "论文讲解"
    textBlock("【\(chapter)】\(s["title"] as? String ?? "")", x: 54, top: H - 28, width: 1450, height: 67, size: 39, bold: true, color: .white)
    textBlock(s["takeaway"] as? String ?? "", x: 60, top: H - 135, width: 1480, height: 90, size: 29, bold: true, color: blue)

    let points = s["points"] as? [[String: String]] ?? []
    let focus = s["focus"] as? Int ?? -1
    let layout = s["layout"] as? String ?? "outline"
    let top: CGFloat = 670, bottom: CGFloat = 175, contentH = top - bottom
    let figurePath = s["figurePath"] as? String ?? ""
    let figure = figurePath.isEmpty ? nil : NSImage(contentsOfFile: figurePath)

    func drawPoints(x: CGFloat, width: CGFloat, start: Int = 0, end: Int? = nil, yTop: CGFloat = 670, availableH: CGFloat = 495) {
        let stop = min(end ?? points.count, points.count)
        guard stop > start else { return }
        let rowH = availableH / CGFloat(stop - start)
        for i in start..<stop {
            let y = yTop - CGFloat(i - start) * rowH
            let active = i == focus
            if active {
                blue.setFill(); NSRect(x: x - 16, y: y - rowH + 18, width: 4, height: rowH - 23).fill()
            }
            let label = "\(i + 1). " + (points[i]["heading"] ?? "")
            let hh = textBlock(label, x: x, top: y, width: width, height: rowH * 0.45, size: 26, bold: true, color: active ? blue : ink)
            textBlock(points[i]["detail"] ?? "", x: x + 30, top: y - hh - 11, width: width - 30, height: rowH - hh - 23, size: 23,
                      color: NSColor(srgbRed: 0.27, green: 0.31, blue: 0.36, alpha: 1))
        }
    }

    if layout == "table", let table = s["table"] as? [String: Any], let cols = table["columns"] as? [String], let rows = table["rows"] as? [[String]], !cols.isEmpty {
        let x: CGFloat = 55, width: CGFloat = 980, rowH = contentH / CGFloat(rows.count + 1), colW = width / CGFloat(cols.count)
        for r in 0...rows.count {
            let y = top - CGFloat(r) * rowH
            if r == 0 { blue.setFill() } else { (r % 2 == 0 ? NSColor(white: 0.96, alpha: 1) : NSColor.white).setFill() }
            NSRect(x: x, y: y - rowH, width: width, height: rowH).fill()
            let values = r == 0 ? cols : rows[r - 1]
            for c in 0..<cols.count {
                textBlock(values[c], x: x + CGFloat(c) * colW + 12, top: y - 12, width: colW - 24, height: rowH - 22, size: r == 0 ? 23 : 21, bold: r == 0, color: r == 0 ? .white : ink)
            }
        }
        drawPoints(x: 1080, width: 455)
    } else if let fig = figure, fig.size.width / fig.size.height > 2.2 {
        let box = NSRect(x: 60, y: 355, width: 1480, height: 315)
        let scale = min(box.width / fig.size.width, box.height / fig.size.height)
        let size = NSSize(width: fig.size.width * scale, height: fig.size.height * scale)
        fig.draw(in: NSRect(x: box.midX - size.width / 2, y: box.midY - size.height / 2, width: size.width, height: size.height))
        let colW = 1480 / CGFloat(max(points.count, 1))
        for i in 0..<points.count { drawPoints(x: 65 + CGFloat(i) * colW, width: colW - 35, start: i, end: i + 1, yTop: 325, availableH: 150) }
    } else if let fig = figure {
        let box = NSRect(x: 55, y: bottom + 5, width: 930, height: contentH - 10)
        let scale = min(box.width / fig.size.width, box.height / fig.size.height)
        let size = NSSize(width: fig.size.width * scale, height: fig.size.height * scale)
        fig.draw(in: NSRect(x: box.midX - size.width / 2, y: box.midY - size.height / 2, width: size.width, height: size.height))
        drawPoints(x: 1050, width: 485)
    } else if layout == "comparison", points.count == 4 {
        NSColor(white: 0.85, alpha: 1).setFill(); NSRect(x: 795, y: bottom, width: 1, height: contentH).fill()
        drawPoints(x: 65, width: 665, start: 0, end: 2)
        drawPoints(x: 860, width: 665, start: 2, end: 4)
    } else {
        drawPoints(x: 75, width: 1440)
    }
    let source = s["source"] as? String ?? ""
    let pos = s["pageLabel"] as? String ?? ""
    textBlock("来源：\(source)", x: 55, top: 146, width: 1340, height: 48, size: 17, color: .gray)
    textBlock(pos, x: 1430, top: 146, width: 120, height: 48, size: 18, color: .gray)
    NSColor(white: 0.96, alpha: 1).setFill(); NSRect(x: 0, y: 0, width: W, height: 88).fill()
    let speaker = s["speaker"] as? String ?? ""
    textBlock(speaker, x: 55, top: 64, width: 150, height: 43, size: 23, bold: true, color: blue)
    textBlock(s["caption"] as? String ?? "", x: 220, top: 66, width: 1320, height: 50, size: 25)
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
func pixelBuffer(_ path: String, _ w: Int, _ h: Int) -> CVPixelBuffer {
    let attrs: [String: Any] = [kCVPixelBufferCGImageCompatibilityKey as String: true,
                                kCVPixelBufferCGBitmapContextCompatibilityKey as String: true]
    var pb: CVPixelBuffer?
    CVPixelBufferCreate(kCFAllocatorDefault, w, h, kCVPixelFormatType_32ARGB, attrs as CFDictionary, &pb)
    let buf = pb!
    CVPixelBufferLockBaseAddress(buf, [])
    let ctx = CGContext(data: CVPixelBufferGetBaseAddress(buf), width: w, height: h, bitsPerComponent: 8,
                        bytesPerRow: CVPixelBufferGetBytesPerRow(buf), space: CGColorSpaceCreateDeviceRGB(),
                        bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue)!
    if let img = NSImage(contentsOfFile: path), let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) {
        ctx.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
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
    let total = cursor

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
    var t = CMTime.zero
    for (i, seg) in segs.enumerated() {
        while !vinput.isReadyForMoreMediaData { usleep(5000) }
        adaptor.append(pixelBuffer(seg["image"]!, w, h), withPresentationTime: t)
        t = t + durs[i]
    }
    // 收尾再补一帧，保证最后一段完整显示
    while !vinput.isReadyForMoreMediaData { usleep(5000) }
    adaptor.append(pixelBuffer(segs.last!["image"]!, w, h), withPresentationTime: CMTimeSubtract(total, CMTime(value: 1, timescale: 30)))
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
    print("papervid 2")
case "page":
    teachingPage(specPath: a[2], out: a[3])
case "duration":
    let asset = AVURLAsset(url: URL(fileURLWithPath: a[2]))
    print(asset.duration.seconds)
case "slide":
    renderSlide(out: a[2], w: Int(a[3])!, h: Int(a[4])!, speaker: a[5], title: a[6], subtitle: a[7],
                figure: a.count > 8 && !a[8].isEmpty ? a[8] : nil)
    print("OK \(a[2])")
case "mux":
    mux(manifestPath: a[2], outPath: a[3])
default:
    print("usage: papervid slide out.png W H speaker title subtitle [fig.png] | papervid mux manifest.json out.mp4")
}
