import Cocoa
import CoreGraphics

// 鼠标侧键驱动 macOS 应用切换器(Cmd+Tab HUD)：
//   长按侧键        → 呼出切换器(按住 Command，HUD 常驻)，并移动一格
//   松开后一小段时间 → 切换器保持(Command 仍按住)，可继续点
//   点按侧键 fwd/back → 在 HUD 里向后 / 向前移动高亮
//   停顿 keepMs      → 松开 Command，真正切换过去
//   短按(不长按)     → 快速切一次(等于点一下 Cmd+Tab)
//
// 用法:
//   sideswitch --learn                     打印按下的鼠标键号
//   sideswitch <back> <fwd> [holdMs] [keepMs]
// 需要“辅助功能”权限(作工具箱子进程时自动继承)。

let argv = CommandLine.arguments
let learn = argv.contains("--learn")
var backBtn: Int64 = 3     // 向前一个应用(Shift+Tab)
var fwdBtn: Int64 = 4      // 向后一个应用(Tab)
var holdMs: Double = 250   // 长按阈值
var keepMs: Double = 900   // 停顿多久后落定
if !learn {
    if argv.count >= 2, let b = Int64(argv[1]) { backBtn = b }
    if argv.count >= 3, let f = Int64(argv[2]) { fwdBtn = f }
    if argv.count >= 4, let h = Double(argv[3]) { holdMs = h }
    if argv.count >= 5, let k = Double(argv[4]) { keepMs = k }
}

let CMD: CGKeyCode = 0x37, SHIFT: CGKeyCode = 0x38, TAB: CGKeyCode = 0x30
func src() -> CGEventSource? { CGEventSource(stateID: .hidSystemState) }
func postKey(_ k: CGKeyCode, down: Bool, flags: CGEventFlags) {
    let e = CGEvent(keyboardEventSource: src(), virtualKey: k, keyDown: down)
    e?.flags = flags
    e?.post(tap: .cghidEventTap)
}

var cmdDown = false
var active = false          // 切换器是否打开(Command 是否被我们按住)
var commitToken = 0
var pressToken = 0

func holdCmd() { if !cmdDown { postKey(CMD, down: true, flags: .maskCommand); cmdDown = true } }
func releaseCmd() { if cmdDown { postKey(CMD, down: false, flags: []); cmdDown = false } }

// 在 HUD 里走一格(shift=true 向前/上一个)
func step(shift: Bool) {
    holdCmd()
    var f: CGEventFlags = .maskCommand
    if shift { f.insert(.maskShift) }
    if shift { postKey(SHIFT, down: true, flags: f) }
    postKey(TAB, down: true, flags: f)
    postKey(TAB, down: false, flags: f)
    if shift { postKey(SHIFT, down: false, flags: .maskCommand) }
}

func commit() { releaseCmd(); active = false }

func scheduleCommit() {
    commitToken += 1
    let tok = commitToken
    DispatchQueue.main.asyncAfter(deadline: .now() + keepMs / 1000.0) {
        if tok == commitToken && active { commit() }
    }
}

// 短按：快速切一次(不进入保持态)
func quickToggle(shift: Bool) {
    step(shift: shift)
    releaseCmd()
}

func dirShift(_ btn: Int64) -> Bool { btn == backBtn }  // back=向前(shift)

var gTap: CFMachPort?
let callback: CGEventTapCallBack = { _, type, event, _ in
    if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
        if let t = gTap { CGEvent.tapEnable(tap: t, enable: true) }
        return Unmanaged.passUnretained(event)
    }
    let btn = event.getIntegerValueField(.mouseEventButtonNumber)
    let isOurs = (btn == backBtn || btn == fwdBtn)
    if learn {
        if type == .otherMouseDown {
            FileHandle.standardOutput.write("mousebutton \(btn)\n".data(using: .utf8)!)
        }
        return Unmanaged.passUnretained(event)
    }
    if !isOurs { return Unmanaged.passUnretained(event) }

    if type == .otherMouseDown {
        if active {
            step(shift: dirShift(btn)); scheduleCommit()          // HUD 已开，点一下走一格
        } else {
            pressToken += 1
            let tok = pressToken
            let shift = dirShift(btn)
            DispatchQueue.main.asyncAfter(deadline: .now() + holdMs / 1000.0) {
                if tok == pressToken && !active {                 // 按住到阈值 → 长按：开 HUD
                    active = true
                    step(shift: shift); scheduleCommit()
                }
            }
        }
        return nil  // 吞掉
    }
    if type == .otherMouseUp {
        pressToken += 1                                           // 作废未触发的长按计时
        if !active { quickToggle(shift: dirShift(btn)) }          // 短按 → 快速切一次
        return nil  // 吞掉
    }
    return Unmanaged.passUnretained(event)
}

let mask = (1 << CGEventType.otherMouseDown.rawValue) | (1 << CGEventType.otherMouseUp.rawValue)
guard let tap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap,
                                  options: .defaultTap, eventsOfInterest: CGEventMask(mask),
                                  callback: callback, userInfo: nil) else {
    FileHandle.standardError.write("ERR_NO_TAP 没拿到事件 tap(多半没给辅助功能权限)\n".data(using: .utf8)!)
    exit(2)
}
gTap = tap
// 被 kill 时(工具箱退出/关开关)兜底释放 Command，免得切换器卡在按住态
for sig in [SIGTERM, SIGINT] {
    signal(sig, SIG_IGN)
    let s = DispatchSource.makeSignalSource(signal: sig, queue: .main)
    s.setEventHandler { releaseCmd(); exit(0) }
    s.resume()
    _ = Unmanaged.passRetained(s as AnyObject)   // 常驻
}
let runSrc = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
CFRunLoopAddSource(CFRunLoopGetMain(), runSrc, .commonModes)
CGEvent.tapEnable(tap: tap, enable: true)
FileHandle.standardError.write("READY back=\(backBtn) fwd=\(fwdBtn) hold=\(holdMs) keep=\(keepMs) learn=\(learn)\n".data(using: .utf8)!)
CFRunLoopRun()
