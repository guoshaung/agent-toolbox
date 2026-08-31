'use strict';
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFile, execFileSync } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

/**
 * OCR：macOS Vision 框架（本地、免费、中英双语、准确度高）。
 * 内嵌 Swift 源码，首次使用时编译到 userData/bin/ocr，之后直接跑二进制（~1.5s）。
 */

const SWIFT_SOURCE = `
import Foundation
import Vision
import AppKit

guard CommandLine.arguments.count > 1 else { exit(2) }
let path = CommandLine.arguments[1]
guard let img = NSImage(contentsOfFile: path),
      let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    FileHandle.standardError.write("bad image".data(using: .utf8)!); exit(1)
}
let req = VNRecognizeTextRequest()
req.recognitionLevel = .accurate
req.recognitionLanguages = ["en-US", "zh-Hans"]
req.usesLanguageCorrection = true
let handler = VNImageRequestHandler(cgImage: cg, options: [:])
try handler.perform([req])
let text = (req.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\\n")
print(text)
`;

function ocrBinPath(userDataDir) {
  return path.join(userDataDir, 'bin', 'ocr');
}

/** 确保 OCR 二进制存在；没有 swiftc（Xcode CLT）就报错提示 */
function ensureOcrBin(userDataDir) {
  const bin = ocrBinPath(userDataDir);
  try {
    fs.accessSync(bin, fs.constants.X_OK);
    return { ok: true, bin };
  } catch { /* 需要编译 */ }
  try {
    execFileSync('which', ['swiftc'], { encoding: 'utf8' });
  } catch {
    return { ok: false, error: '系统没有 swiftc（Xcode 命令行工具），跑不了本地 OCR。终端执行 xcode-select --install 装一下。' };
  }
  fs.mkdirSync(path.dirname(bin), { recursive: true });
  const src = path.join(os.tmpdir(), 'toolbox-ocr.swift');
  fs.writeFileSync(src, SWIFT_SOURCE, 'utf8');
  try {
    execFileSync('swiftc', ['-O', src, '-o', bin], { timeout: 180000, encoding: 'utf8' });
  } catch (err) {
    return { ok: false, error: `OCR 编译失败：${String(err.stderr || err.message).slice(0, 200)}` };
  } finally {
    try { fs.rmSync(src, { force: true }); } catch { /* 临时文件 */ }
  }
  return { ok: true, bin };
}

/** dataURL PNG → OCR 文本 */
async function ocrImage(userDataDir, dataUrl) {
  const ensured = ensureOcrBin(userDataDir);
  if (!ensured.ok) return ensured;
  const m = String(dataUrl || '').match(/^data:image\/png;base64,(.+)$/);
  if (!m) return { ok: false, error: '截图数据格式不对' };
  const tmp = path.join(os.tmpdir(), `toolbox-snip-${Date.now()}.png`);
  try {
    fs.writeFileSync(tmp, Buffer.from(m[1], 'base64'));
    const { stdout } = await execFileAsync(ensured.bin, [tmp], { timeout: 60000, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
    const text = stdout.trim();
    if (!text) return { ok: false, error: '圈里没识别出文字，圈大一点、对准文字试试。' };
    return { ok: true, text };
  } catch (err) {
    return { ok: false, error: `OCR 失败：${String(err.message).slice(0, 150)}` };
  } finally {
    try { fs.rmSync(tmp, { force: true }); } catch { /* 临时文件 */ }
  }
}

module.exports = { ocrImage };
