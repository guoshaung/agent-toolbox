'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

const HELPER_SOURCE = String.raw`import Cocoa
import ApplicationServices

func printJSON(_ value: [String: Any]) {
  let data = try! JSONSerialization.data(withJSONObject: value, options: [])
  print(String(data: data, encoding: .utf8)!)
}

func trusted(prompt: Bool) -> Bool {
  let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: prompt] as CFDictionary
  return AXIsProcessTrustedWithOptions(options)
}

func value<T>(_ element: AXUIElement, _ attribute: CFString, _ type: T.Type) -> T? {
  var output: CFTypeRef?
  guard AXUIElementCopyAttributeValue(element, attribute, &output) == .success else { return nil }
  return output as? T
}

func windows(_ app: AXUIElement) -> [AXUIElement] {
  return value(app, kAXWindowsAttribute as CFString, [AXUIElement].self) ?? []
}

func selectedWindow(_ app: AXUIElement, title: String?) -> AXUIElement? {
  if let title, !title.isEmpty {
    if let match = windows(app).first(where: {
      (value($0, kAXTitleAttribute as CFString, String.self) ?? "") == title
    }) { return match }
  }
  if let focused = value(app, kAXFocusedWindowAttribute as CFString, AXUIElement.self) { return focused }
  if let main = value(app, kAXMainWindowAttribute as CFString, AXUIElement.self) { return main }
  return windows(app).first
}

func frame(_ window: AXUIElement) -> [String: Double]? {
  guard let positionValue = value(window, kAXPositionAttribute as CFString, AXValue.self),
        let sizeValue = value(window, kAXSizeAttribute as CFString, AXValue.self) else { return nil }
  var point = CGPoint.zero
  var size = CGSize.zero
  guard AXValueGetValue(positionValue, .cgPoint, &point),
        AXValueGetValue(sizeValue, .cgSize, &size) else { return nil }
  return ["x": point.x, "y": point.y, "width": size.width, "height": size.height]
}

func setFrame(_ window: AXUIElement, x: Double, y: Double, width: Double, height: Double) -> Bool {
  var point = CGPoint(x: x, y: y)
  var size = CGSize(width: width, height: height)
  guard let pointValue = AXValueCreate(.cgPoint, &point),
        let sizeValue = AXValueCreate(.cgSize, &size) else { return false }
  let moved = AXUIElementSetAttributeValue(window, kAXPositionAttribute as CFString, pointValue) == .success
  let resized = AXUIElementSetAttributeValue(window, kAXSizeAttribute as CFString, sizeValue) == .success
  return moved && resized
}

let args = CommandLine.arguments
guard args.count >= 2 else {
  printJSON(["ok": false, "error": "missing command"])
  exit(1)
}

let command = args[1]
if command == "permission" {
  let shouldPrompt = args.count < 3 || args[2] != "false"
  printJSON(["ok": true, "trusted": trusted(prompt: shouldPrompt)])
  exit(0)
}

guard trusted(prompt: false) else {
  printJSON(["ok": false, "code": "permission", "error": "需要在系统设置中授予辅助功能权限"])
  exit(2)
}

if command == "frontmost" {
  guard let running = NSWorkspace.shared.frontmostApplication else {
    printJSON(["ok": false, "error": "没有找到前台应用"])
    exit(3)
  }
  let app = AXUIElementCreateApplication(running.processIdentifier)
  guard let window = selectedWindow(app, title: nil), let bounds = frame(window) else {
    printJSON(["ok": false, "error": "前台应用没有可控制的窗口"])
    exit(4)
  }
  let title = value(window, kAXTitleAttribute as CFString, String.self) ?? ""
  printJSON([
    "ok": true,
    "pid": Int(running.processIdentifier),
    "name": running.localizedName ?? "应用",
    "bundleId": running.bundleIdentifier ?? "",
    "title": title,
    "bounds": bounds,
    "buttons": CGEventSource.buttonState(.combinedSessionState, button: .left) ? 1 : 0,
  ])
  exit(0)
}

if command == "point" && args.count >= 4 {
  let point = CGPoint(x: Double(args[2]) ?? 0, y: Double(args[3]) ?? 0)
  let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
  for item in windows {
    guard let ownerPid = item[kCGWindowOwnerPID as String] as? Int32, ownerPid != getpid(),
          let layer = item[kCGWindowLayer as String] as? Int, layer == 0,
          let boundsDictionary = item[kCGWindowBounds as String] as? [String: CGFloat] else { continue }
    let rect = CGRect(x: boundsDictionary["X"] ?? 0, y: boundsDictionary["Y"] ?? 0,
                      width: boundsDictionary["Width"] ?? 0, height: boundsDictionary["Height"] ?? 0)
    guard rect.width > 120, rect.height > 80, rect.contains(point) else { continue }
    let name = item[kCGWindowOwnerName as String] as? String ?? "应用"
    let title = item[kCGWindowName as String] as? String ?? ""
    let app = NSRunningApplication(processIdentifier: ownerPid)
    let bundleId = app?.bundleIdentifier ?? ""
    let identity = "\(name) \(bundleId)".lowercased()
    if bundleId == "com.github.Electron" || bundleId == "com.openai.agent-toolbox" || identity.contains("agent-toolbox") || identity.contains("electron") { continue }
    printJSON(["ok": true, "pid": Int(ownerPid), "name": name, "bundleId": bundleId, "title": title,
               "bounds": ["x": rect.origin.x, "y": rect.origin.y, "width": rect.width, "height": rect.height],
               "buttons": CGEventSource.buttonState(.combinedSessionState, button: .left) ? 1 : 0])
    exit(0)
  }
  printJSON(["ok": false, "error": "鼠标位置没有可识别的窗口"])
  exit(7)
}

if command == "set" && args.count >= 8 {
  let pid = pid_t(Int(args[2]) ?? 0)
  let title = args[3]
  let numbers = args[4...7].map { Double($0) ?? 0 }
  let app = AXUIElementCreateApplication(pid)
  guard let window = selectedWindow(app, title: title) else {
    printJSON(["ok": false, "error": "目标窗口已关闭"])
    exit(5)
  }
  let ok = setFrame(window, x: numbers[0], y: numbers[1], width: numbers[2], height: numbers[3])
  printJSON(["ok": ok, "error": ok ? "" : "目标窗口拒绝移动或缩放"])
  exit(ok ? 0 : 6)
}

printJSON(["ok": false, "error": "unknown command"])
exit(1)
`;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

class WindowDock {
  constructor({ app, BrowserWindow, screen, store, getMainWindow }) {
    this.app = app;
    this.BrowserWindow = BrowserWindow;
    this.screen = screen;
    this.store = store;
    this.getMainWindow = getMainWindow;
    this.helperPath = path.join(app.getPath('userData'), 'bin', 'agent-toolbox-window-dock');
    this.sourcePath = `${this.helperPath}.swift`;
    this.dividerWindow = null;
    this.target = null;
    this.originalMainBounds = null;
    this.ratio = clamp(Number(store.get('dock.ratio', 0.58)), 0.28, 0.72);
    this.side = store.get('dock.side', 'left') === 'right' ? 'right' : 'left';
    this.captureTimer = null;
    this.layoutBusy = false;
    this.armed = false;
    this.armTimer = null;
    this.pollBusy = false;
    this.dragSeenAt = 0;
    this.dragCandidate = null;
  }

  async ensureHelper() {
    if (process.platform !== 'darwin') return false;
    fs.mkdirSync(path.dirname(this.helperPath), { recursive: true });
    let current = '';
    try { current = fs.readFileSync(this.sourcePath, 'utf8'); } catch {}
    if (current === HELPER_SOURCE && fs.existsSync(this.helperPath)) return true;
    fs.writeFileSync(this.sourcePath, HELPER_SOURCE, 'utf8');
    await execFileAsync('xcrun', ['swiftc', '-O', this.sourcePath, '-o', this.helperPath], { timeout: 120000 });
    return true;
  }

  async run(args) {
    if (process.platform !== 'darwin') return { ok: false, code: 'unsupported', error: '窗口吸附目前仅支持 macOS' };
    try {
      await this.ensureHelper();
      const { stdout } = await execFileAsync(this.helperPath, args.map(String), { timeout: 15000 });
      return JSON.parse(stdout.trim() || '{}');
    } catch (err) {
      try { return JSON.parse(String(err.stdout || '').trim()); } catch {}
      return { ok: false, error: err.message };
    }
  }

  status() {
    return {
      supported: process.platform === 'darwin',
      active: Boolean(this.target),
      armed: this.armed,
      target: this.target ? { name: this.target.name, title: this.target.title, bundleId: this.target.bundleId } : null,
      ratio: this.ratio,
      side: this.side,
      shortcut: process.platform === 'darwin' ? '⌥⇧D' : 'Ctrl+Alt+Shift+D',
    };
  }

  emitStatus() {
    const mainWindow = this.getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('dock:status', this.status());
  }

  async requestPermission() {
    const result = await this.run(['permission', 'true']);
    return { ...result, ...this.status() };
  }

  async arm() {
    if (this.target) return { ok: true, ...this.status() };
    const permission = await this.run(['permission', 'true']);
    if (!permission.trusted) {
      this.armed = false;
      this.emitStatus();
      return {
        ok: false,
        code: 'permission',
        error: '请先在“系统设置 → 隐私与安全性 → 辅助功能”中允许窗口控制器。授权后再点一次回形针。',
        ...this.status(),
      };
    }
    this.armed = true;
    this.dragSeenAt = 0;
    this.dragCandidate = null;
    clearInterval(this.armTimer);
    this.armTimer = setInterval(() => { this.pollArmedWindow(); }, 180);
    this.emitStatus();
    return { ok: true, ...this.status() };
  }

  cancelArm() {
    this.armed = false;
    this.dragSeenAt = 0;
    this.dragCandidate = null;
    clearInterval(this.armTimer);
    this.armTimer = null;
    this.emitStatus();
    return { ok: true, ...this.status() };
  }

  async togglePin() {
    if (this.target) return this.detach();
    if (this.armed) return this.cancelArm();
    return this.arm();
  }

  isCursorAtDockEdge(point) {
    const mainWindow = this.getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible()) return false;
    const bounds = mainWindow.getBounds();
    const edgeX = this.side === 'right' ? bounds.x + bounds.width : bounds.x;
    const withinY = point.y >= bounds.y - 44 && point.y <= bounds.y + bounds.height + 44;
    return withinY && Math.abs(point.x - edgeX) <= 120;
  }

  async pollArmedWindow() {
    if (!this.armed || this.pollBusy || this.target) return;
    this.pollBusy = true;
    try {
      const cursor = this.screen.getCursorScreenPoint();
      if (!this.isCursorAtDockEdge(cursor)) {
        if (!this.dragSeenAt || Date.now() - this.dragSeenAt > 2200) {
          this.dragSeenAt = 0;
          this.dragCandidate = null;
        }
        return;
      }
      const result = await this.run(['frontmost']);
      const pointed = await this.run(['point', cursor.x, cursor.y]);
      const candidate = pointed.ok ? pointed : result;
      if (candidate.ok && candidate.pid !== process.pid && !/agent.?toolbox|electron/i.test(`${candidate.name} ${candidate.bundleId}`)) {
        this.dragSeenAt ||= Date.now();
        this.dragCandidate = candidate;
      }
      if (!this.dragCandidate || !this.dragSeenAt || Date.now() - this.dragSeenAt > 2200) return;
      if (Date.now() - this.dragSeenAt < 360) return;
      const lockedCandidate = this.dragCandidate;
      this.cancelArm();
      await new Promise((resolve) => setTimeout(resolve, 220));
      await this.attachTarget(lockedCandidate);
    } finally {
      this.pollBusy = false;
    }
  }

  async captureAfter(delay = 3000) {
    clearTimeout(this.captureTimer);
    await new Promise((resolve) => {
      this.captureTimer = setTimeout(resolve, clamp(Number(delay) || 3000, 500, 10000));
    });
    return this.captureFrontmost();
  }

  async captureFrontmost() {
    const mainWindow = this.getMainWindow();
    const result = await this.run(['frontmost']);
    if (!result.ok) return { ...result, ...this.status() };
    if (result.pid === process.pid || /agent.?toolbox|electron/i.test(`${result.name} ${result.bundleId}`)) {
      return { ok: false, error: '当前前台仍是工具箱，请先切到 Edge/Chrome，再按 ⌥⇧D。', ...this.status() };
    }

    return this.attachTarget(result);
  }

  async attachTarget(result) {
    this.cancelArm();
    const mainWindow = this.getMainWindow();
    if (this.target) await this.detach({ restoreMain: false, restoreTarget: true });
    this.target = { ...result, originalBounds: result.bounds };
    this.originalMainBounds = mainWindow && !mainWindow.isDestroyed() ? mainWindow.getBounds() : null;
    await this.applyLayout();
    this.emitStatus();
    return { ok: true, ...this.status() };
  }

  displayForTarget() {
    const bounds = this.target?.bounds || this.target?.originalBounds;
    const point = bounds
      ? { x: Math.round(bounds.x + bounds.width / 2), y: Math.round(bounds.y + bounds.height / 2) }
      : this.screen.getCursorScreenPoint();
    return this.screen.getDisplayNearestPoint(point);
  }

  layoutBounds() {
    const area = this.displayForTarget().workArea;
    const divider = 10;
    const usable = area.width - divider;
    const targetWidth = Math.round(usable * this.ratio);
    const toolboxWidth = usable - targetWidth;
    if (this.side === 'right') {
      return {
        target: { x: area.x + toolboxWidth + divider, y: area.y, width: targetWidth, height: area.height },
        toolbox: { x: area.x, y: area.y, width: toolboxWidth, height: area.height },
        divider: { x: area.x + toolboxWidth, y: area.y, width: divider, height: area.height },
      };
    }
    return {
      target: { x: area.x, y: area.y, width: targetWidth, height: area.height },
      toolbox: { x: area.x + targetWidth + divider, y: area.y, width: toolboxWidth, height: area.height },
      divider: { x: area.x + targetWidth, y: area.y, width: divider, height: area.height },
    };
  }

  async applyLayout() {
    if (!this.target || this.layoutBusy) return { ok: false, error: '当前没有已吸附窗口' };
    this.layoutBusy = true;
    try {
      const mainWindow = this.getMainWindow();
      if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, error: '工具箱窗口不可用' };
      const layout = this.layoutBounds();
      const moved = await this.run([
        'set', this.target.pid, this.target.title || '',
        layout.target.x, layout.target.y, layout.target.width, layout.target.height,
      ]);
      if (!moved.ok) {
        await this.detach({ restoreMain: true, restoreTarget: false });
        return moved;
      }
      mainWindow.setMinimumSize(560, 620);
      mainWindow.setBounds(layout.toolbox, true);
      if (!mainWindow.isVisible()) mainWindow.show();
      this.target.bounds = layout.target;
      this.ensureDivider();
      this.dividerWindow.setBounds(layout.divider, false);
      if (!this.dividerWindow.isVisible()) this.dividerWindow.showInactive();
      return { ok: true, ...this.status() };
    } finally {
      this.layoutBusy = false;
    }
  }

  ensureDivider() {
    if (this.dividerWindow && !this.dividerWindow.isDestroyed()) return this.dividerWindow;
    this.dividerWindow = new this.BrowserWindow({
      width: 10,
      height: 600,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      show: false,
      focusable: false,
      alwaysOnTop: true,
      hasShadow: false,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: path.join(__dirname, 'dock-divider-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });
    this.dividerWindow.setAlwaysOnTop(true, 'floating');
    this.dividerWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    this.dividerWindow.loadFile(path.join(__dirname, '..', 'renderer', 'dock-divider.html'));
    this.dividerWindow.on('closed', () => { this.dividerWindow = null; });
    return this.dividerWindow;
  }

  async setRatio(value, { persist = true } = {}) {
    this.ratio = clamp(Number(value) || 0.58, 0.28, 0.72);
    if (persist) this.store.set('dock.ratio', this.ratio);
    if (this.target) await this.applyLayout();
    this.emitStatus();
    return { ok: true, ...this.status() };
  }

  async setRatioFromScreenX(screenX) {
    if (!this.target) return this.status();
    const area = this.displayForTarget().workArea;
    const relative = clamp((Number(screenX) - area.x) / area.width, 0.28, 0.72);
    return this.setRatio(this.side === 'left' ? relative : 1 - relative, { persist: false });
  }

  commitRatio() {
    this.store.set('dock.ratio', this.ratio);
    this.emitStatus();
    return this.status();
  }

  async setSide(side) {
    this.side = side === 'right' ? 'right' : 'left';
    this.store.set('dock.side', this.side);
    if (this.target) await this.applyLayout();
    this.emitStatus();
    return { ok: true, ...this.status() };
  }

  async detach({ restoreMain = true, restoreTarget = true } = {}) {
    clearTimeout(this.captureTimer);
    this.cancelArm();
    const target = this.target;
    this.target = null;
    if (this.dividerWindow && !this.dividerWindow.isDestroyed()) this.dividerWindow.hide();
    if (restoreTarget && target?.originalBounds) {
      const b = target.originalBounds;
      await this.run(['set', target.pid, target.title || '', b.x, b.y, b.width, b.height]);
    }
    const mainWindow = this.getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setMinimumSize(900, 620);
      if (restoreMain && this.originalMainBounds) mainWindow.setBounds(this.originalMainBounds, true);
    }
    this.originalMainBounds = null;
    this.emitStatus();
    return { ok: true, ...this.status() };
  }

  async dispose() {
    this.cancelArm();
    await this.detach({ restoreMain: false, restoreTarget: true });
    if (this.dividerWindow && !this.dividerWindow.isDestroyed()) this.dividerWindow.destroy();
  }
}

module.exports = { WindowDock, HELPER_SOURCE };
