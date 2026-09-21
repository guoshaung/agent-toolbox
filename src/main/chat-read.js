'use strict';

/**
 * 读聊天窗口：截某个应用的窗口 → OCR → 带坐标的文本行。
 *
 * 为什么要坐标：微信里对方的话贴左边、自己的话贴右边，只有拿到每行文字的位置
 * 才分得出谁说的。现成的 ocr.js 只吐纯文本，这里另起一个带 boundingBox 的。
 *
 * 全程只读屏幕，不碰微信进程、不注入、不发消息 —— 和截图软件一个性质。
 * macOS 上需要「屏幕录制」权限，没有的话 CGWindowListCreateImage 只会返回桌面背景，
 * 所以先用 CGPreflightScreenCaptureAccess 明确问一次。
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFile, execFileSync } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

const SWIFT_SOURCE = `
import Foundation
import Vision
import AppKit
import CoreGraphics

// 两个子命令：
//   list <应用名关键词>  → {"ok":true,"id":123,"app":"微信","w":1200,"h":800}
//   ocr  <图片路径>      → {"ok":true,"lines":[{"t":"文字","x":0.1,"y":0.2,"w":0.3,"h":0.02}]}
// 截图本身交给系统的 screencapture —— macOS 15 把 CGWindowListCreateImage 废掉了，
// 而 ScreenCaptureKit 要一整套异步样板，系统自带的命令行工具最省事也最稳。

func emit(_ obj: [String: Any]) -> Never {
    let data = try! JSONSerialization.data(withJSONObject: obj)
    FileHandle.standardOutput.write(data)
    exit(0)
}
func fail(_ code: String, _ msg: String) -> Never {
    emit(["ok": false, "code": code, "error": msg])
}

guard CommandLine.arguments.count > 2 else { fail("usage", "用法: chat-read list|ocr <参数>") }
let cmd = CommandLine.arguments[1]
let arg = CommandLine.arguments[2]

if cmd == "list" {
    let needle = arg.lowercased()
    let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
    var bestArea: CGFloat = 0
    var found: [String: Any]? = nil
    for item in windows {
        guard let layer = item[kCGWindowLayer as String] as? Int, layer == 0,
              let owner = item[kCGWindowOwnerName as String] as? String,
              let wid = item[kCGWindowNumber as String] as? Int,
              let b = item[kCGWindowBounds as String] as? [String: CGFloat],
              let w = b["Width"], let h = b["Height"] else { continue }
        guard owner.lowercased().contains(needle) else { continue }
        // 同一个应用可能开好几个窗口，取面积最大的那个（主聊天窗）
        if w * h > bestArea {
            bestArea = w * h
            let frontApp = NSWorkspace.shared.frontmostApplication?.localizedName ?? ""
            found = ["ok": true, "id": wid, "app": owner,
                     "x": Int(b["X"] ?? 0), "y": Int(b["Y"] ?? 0),
                     "w": Int(w), "h": Int(h),
                     "front": frontApp == owner]
        }
    }
    guard let result = found else { fail("no-window", "没找到这个应用的窗口") }
    emit(result)
}

if cmd == "ocr" {
    guard let img = NSImage(contentsOfFile: arg),
          let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
        fail("bad-image", "图片读不了")
    }
    if cg.width < 50 || cg.height < 50 { fail("capture-empty", "截出来是空的") }
    let req = VNRecognizeTextRequest()
    req.recognitionLevel = .accurate
    req.recognitionLanguages = ["zh-Hans", "en-US"]
    req.usesLanguageCorrection = true
    let handler = VNImageRequestHandler(cgImage: cg, options: [:])
    do { try handler.perform([req]) } catch { fail("ocr-failed", "\\(error)") }
    var lines: [[String: Any]] = []
    for ob in (req.results ?? []) {
        guard let c = ob.topCandidates(1).first else { continue }
        let bb = ob.boundingBox            // 原点在左下，归一化
        lines.append([
            "t": c.string,
            "x": Double(bb.origin.x),
            "y": Double(1.0 - bb.origin.y - bb.size.height),   // 换成从上往下
            "w": Double(bb.size.width),
            "h": Double(bb.size.height),
        ])
    }
    emit(["ok": true, "w": cg.width, "h": cg.height, "lines": lines])
}

fail("usage", "未知子命令 \\(cmd)")
`;

function binPath(userDataDir) {
  return path.join(userDataDir, 'bin', 'chat-read');
}

/** 首次用的时候编译，之后直接跑二进制 */
function ensureBin(userDataDir) {
  const bin = binPath(userDataDir);
  try {
    fs.accessSync(bin, fs.constants.X_OK);
    return { ok: true, bin };
  } catch { /* 要编译 */ }
  try {
    execFileSync('which', ['swiftc'], { encoding: 'utf8' });
  } catch {
    return { ok: false, error: '系统没有 swiftc（Xcode 命令行工具）。终端里跑一下 xcode-select --install。' };
  }
  fs.mkdirSync(path.dirname(bin), { recursive: true });
  const src = path.join(os.tmpdir(), `toolbox-chat-read-${Date.now()}.swift`);
  fs.writeFileSync(src, SWIFT_SOURCE, 'utf8');
  try {
    execFileSync('swiftc', ['-O', src, '-o', bin], { timeout: 240000, encoding: 'utf8' });
  } catch (error) {
    return { ok: false, error: `编译失败：${String(error.stderr || error.message).slice(0, 300)}` };
  } finally {
    try { fs.rmSync(src, { force: true }); } catch { /* 临时文件 */ }
  }
  return { ok: true, bin };
}

/** 截一次窗口并 OCR，返回带坐标的文本行 */
async function readWindow(userDataDir, appName, { timeout = 30000, bounds = false } = {}) {
  if (process.platform !== 'darwin') return { ok: false, error: '目前只做了 macOS。' };
  const ensured = ensureBin(userDataDir);
  if (!ensured.ok) return ensured;

  let win;
  try {
    const { stdout } = await execFileAsync(ensured.bin, ['list', String(appName || '')], { timeout: 10000, encoding: 'utf8' });
    win = JSON.parse(stdout);
  } catch (error) {
    return { ok: false, error: `列窗口失败：${String(error.stderr || error.message).slice(0, 160)}` };
  }
  if (!win.ok) return win;
  if (bounds) return win;         // 只要窗口位置，不截图（跟踪窗口移动时每秒都要问）

  // 截图走系统的 screencapture：-x 不出快门声，-o 不要窗口阴影，-l 指定窗口
  const shot = path.join(os.tmpdir(), `toolbox-chat-${Date.now()}.png`);
  try {
    await execFileAsync('/usr/sbin/screencapture', ['-x', '-o', `-l${win.id}`, shot], { timeout: 15000 });
    const stat = fs.statSync(shot);
    // 没给屏幕录制权限时 screencapture 会产出一个几乎空的文件
    if (stat.size < 2048) {
      return { ok: false, code: 'no-permission', error: '截到的是空图，多半是没给屏幕录制权限：系统设置 → 隐私与安全性 → 屏幕录制，勾上「Agent 工具箱」（或终端），然后重启。' };
    }
    const { stdout } = await execFileAsync(ensured.bin, ['ocr', shot], { timeout, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
    const result = JSON.parse(stdout);
    return result.ok ? { ...result, app: win.app, windowId: win.id } : result;
  } catch (error) {
    const raw = String(error.stderr || error.message || '');
    // 没给屏幕录制权限时 screencapture 就抛这句，原文完全看不懂在说什么
    if (/could not create image from window|not authoriz|permission/i.test(raw)) {
      return { ok: false, code: 'no-permission', error: '需要「屏幕录制」权限才能读窗口。' };
    }
    return { ok: false, error: `截图或 OCR 失败：${raw.slice(0, 200)}` };
  } finally {
    try { fs.rmSync(shot, { force: true }); } catch { /* 临时文件 */ }
  }
}

/**
 * 把 OCR 行拼成对话。
 *
 * 微信窗口不是只有聊天：最左是一条窄图标栏，然后是会话列表，右边才是聊天区。
 * 所以要先把 chatLeft 左边的整片切掉 —— 不切的话会话列表会被当成「对方说的话」
 * （实测就是这么翻车的：把「张俊挥 16:30」这种列表项当成了消息）。
 *
 * 切出聊天区之后，区内再分左右：对方的气泡贴聊天区左边，自己的贴右边，
 * 分界取聊天区的中线。同一条消息常被 OCR 拆成多行，y 挨着且同一边的合并回去。
 *
 * @param {{t:string,x:number,y:number,w:number,h:number}[]} lines
 * @param {{chatLeft?:number, gap?:number, skipTop?:number, skipBottom?:number}} options
 *   chatLeft   聊天区从哪里开始（占窗口宽的比例，默认 0.3）
 *   chatRight  聊天区到哪里结束（默认 1；右边还有面板时往左收）
 *   gap        两行 y 差小于这个算同一条（默认 0.028）
 *   skipTop    顶部去掉多少（标题栏），默认 0.06
 *   skipBottom 底部去掉多少（输入框、工具条），默认 0.18
 */
function toMessages(lines, { chatLeft = 0.3, chatRight = 1, gap = 0.028, skipTop = 0.06, skipBottom = 0.18 } = {}) {
  const usable = (lines || [])
    .filter((l) => l && String(l.t).trim())
    .map((l) => ({ ...l, t: String(l.t).trim() }))
    .filter((l) => { const mid = l.x + l.w / 2; return mid > chatLeft && mid < chatRight && l.y > skipTop && l.y < 1 - skipBottom; })
    .sort((a, b) => a.y - b.y);

  const messages = [];
  for (const line of usable) {
    // 看气泡贴哪一边，不看中点：长消息的中点会跑到右半边，按中点判会把对方
    // 的长回复认成自己发的（实测就是这么错的）。左边缘离聊天区左沿更近 = 对方。
    const distLeft = line.x - chatLeft;
    const distRight = chatRight - (line.x + line.w);
    const side = distLeft <= distRight ? 'them' : 'me';
    const last = messages[messages.length - 1];
    if (last && last.side === side && Math.abs(line.y - last.yEnd) < gap) {
      last.text += line.t;
      last.yEnd = line.y;
    } else {
      messages.push({ side, text: line.t, y: line.y, yEnd: line.y });
    }
  }
  return messages;
}

/** 最新一条对方说的话（列表最下面那条 them） */
function latestIncoming(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].side === 'them') return messages[i];
  }
  return null;
}

/** 只问窗口在哪、是不是前台，不截图 —— 跟踪窗口用，很轻 */
const windowBounds = (userDataDir, appName) => readWindow(userDataDir, appName, { bounds: true });

module.exports = { readWindow, windowBounds, toMessages, latestIncoming, ensureBin, binPath };
