import Cocoa
import CoreGraphics

// 用法:
//   sideswitch --learn            只打印按下的鼠标键号(用来探明侧键的 buttonNumber)
//   sideswitch <backBtn> <fwdBtn> 把这两个鼠标键映射为 Cmd+Tab / Cmd+Shift+Tab
// 需要“辅助功能”权限(作为工具箱子进程时自动继承)。

let args = CommandLine.arguments
let learn = args.contains("--learn")
var backBtn: Int64 = 3   // 默认:后退键 -> Cmd+Tab
var fwdBtn: Int64 = 4    // 默认:前进键 -> Cmd+Shift+Tab
if !learn {
    if args.count >= 2, let b = Int64(args[1]) { backBtn = b }
    if args.count >= 3, let f = Int64(args[2]) { fwdBtn = f }
}

func cmdTab(shift: Bool) {
    let src = CGEventSource(stateID: .hidSystemState)
    let loc = CGEventTapLocation.cghidEventTap
    let cmd: CGKeyCode = 0x37, shiftK: CGKeyCode = 0x38, tab: CGKeyCode = 0x30
    var flags: CGEventFlags = .maskCommand
    if shift { flags.insert(.maskShift) }
    CGEvent(keyboardEventSource: src, virtualKey: cmd, keyDown: true)?.post(tap: loc)
    if shift {
        let e = CGEvent(keyboardEventSource: src, virtualKey: shiftK, keyDown: true)
        e?.flags = .maskCommand; e?.post(tap: loc)
    }
    let d = CGEvent(keyboardEventSource: src, virtualKey: tab, keyDown: true)
    d?.flags = flags; d?.post(tap: loc)
    let u = CGEvent(keyboardEventSource: src, virtualKey: tab, keyDown: false)
    u?.flags = flags; u?.post(tap: loc)
    if shift {
        let e = CGEvent(keyboardEventSource: src, virtualKey: shiftK, keyDown: false)
        e?.flags = .maskCommand; e?.post(tap: loc)
    }
    CGEvent(keyboardEventSource: src, virtualKey: cmd, keyDown: false)?.post(tap: loc)
}

var gTap: CFMachPort?

let callback: CGEventTapCallBack = { _, type, event, _ in
    if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
        if let t = gTap { CGEvent.tapEnable(tap: t, enable: true) }
        return Unmanaged.passUnretained(event)
    }
    if type == .otherMouseDown {
        let btn = event.getIntegerValueField(.mouseEventButtonNumber)
        if learn {
            FileHandle.standardOutput.write("mousebutton \(btn)\n".data(using: .utf8)!)
            return Unmanaged.passUnretained(event)   // learn 模式不吞,照常生效
        }
        if btn == backBtn { cmdTab(shift: false); return nil }   // 吞掉原事件,只做切换
        if btn == fwdBtn  { cmdTab(shift: true);  return nil }
    }
    return Unmanaged.passUnretained(event)
}

let mask = (1 << CGEventType.otherMouseDown.rawValue)
guard let tap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap,
                                  options: .defaultTap, eventsOfInterest: CGEventMask(mask),
                                  callback: callback, userInfo: nil) else {
    FileHandle.standardError.write("ERR_NO_TAP 没拿到事件 tap(多半是没给辅助功能权限)\n".data(using: .utf8)!)
    exit(2)
}
gTap = tap
let runSrc = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
CFRunLoopAddSource(CFRunLoopGetCurrent(), runSrc, .commonModes)
CGEvent.tapEnable(tap: tap, enable: true)
FileHandle.standardError.write("READY back=\(backBtn) fwd=\(fwdBtn) learn=\(learn)\n".data(using: .utf8)!)
CFRunLoopRun()
