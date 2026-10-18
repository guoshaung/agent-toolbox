import Foundation
import AppKit
import PDFKit

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8)); exit(2)
}
func document(_ file: String) -> PDFDocument {
    guard let doc = PDFDocument(url: URL(fileURLWithPath: file)) else { fail("PDF 文件损坏或无法读取") }
    if doc.isLocked { fail("PDF 已加密，请先在本机解锁后再上传") }
    if doc.pageCount < 1 || doc.pageCount > 200 { fail("仅支持 1–200 页的论文 PDF") }
    return doc
}
let args = CommandLine.arguments
switch args.count > 1 ? args[1] : "" {
case "version": print("paperpdf 1")
case "inspect":
    guard args.count == 3 else { fail("PDF 参数不完整") }
    let doc = document(args[2])
    var pages: [[String: Any]] = [], length = 0
    for index in 0..<doc.pageCount {
        let text = doc.page(at: index)?.string ?? ""
        length += text.utf8.count
        if length > 6_000_000 { fail("PDF 文字过多，请拆分为单篇论文后上传") }
        pages.append(["number": index + 1, "text": text])
    }
    let attrs = doc.documentAttributes ?? [:]
    let result: [String: Any] = ["title": attrs[PDFDocumentAttribute.titleAttribute] as? String ?? "", "authors": attrs[PDFDocumentAttribute.authorAttribute] as? String ?? "", "pages": pages]
    let json = try! JSONSerialization.data(withJSONObject: result)
    FileHandle.standardOutput.write(json)
case "pages":
    guard args.count == 5 else { fail("PDF 页面参数不完整") }
    let doc = document(args[2]), dir = URL(fileURLWithPath: args[3], isDirectory: true)
    let numbers = args[4].split(separator: ",").compactMap { Int($0) }
    guard numbers.count <= 8 else { fail("一次最多提取 8 张原文页图") }
    for number in numbers {
        guard number > 0, number <= doc.pageCount, let page = doc.page(at: number - 1) else { fail("PDF 页码超出范围") }
        let image = page.thumbnail(of: NSSize(width: 1500, height: 1900), for: .cropBox)
        guard let tiff = image.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff), let png = rep.representation(using: .png, properties: [:]) else { fail("原文页面渲染失败") }
        try! png.write(to: dir.appendingPathComponent("page-\(number).png"))
    }
    print("OK")
default: fail("usage: paperpdf inspect file.pdf | pages file.pdf output-dir 2,3")
}
