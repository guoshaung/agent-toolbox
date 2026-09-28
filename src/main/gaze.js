'use strict';

/**
 * 守望：桌宠的「看着你」模式。
 *
 * 三个窗口：后台摄像头页（永远不显示）、视线光圈层（全屏透明、鼠标穿透）、校准页（全屏，只在校准时开）。
 * 主进程在这里做数学：特征 → 回归 → 滤波 → 注意力状态；把光圈坐标推给覆盖层，把状态和提醒推给桌宠。
 * 画面不出电脑：后台页只发十几个关键点坐标过来，主进程连图都没见过。
 */

const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { featuresFrom, fitRidge, predict, residual, OneEuro, Attention } = require('./gaze-model');

const NUDGES = {
  distracted: ['眼睛跑哪去了，回来～', '走神 %s 了，屏幕在这边', '再看一眼刚才做到哪了'],
  phone: ['手机放下啦', '刷了 %s 了，先把手上这件做完', '手机不会跑，任务会拖'],
  away: ['人呢？', '走开 %s 了，回来接着做', '休息够了就回来'],
  tired: ['眼睛累了，看远处 20 秒', '眨眨眼，望一下窗外', '眼皮在打架，站起来活动一下'],
};
const STATE_LABEL = { looking: '在看屏幕', distracted: '走神', phone: '看手机', away: '不在', tired: '眼睛累了' };

class GazeService {
  constructor({ app, screen, BrowserWindow, store, rootDir, preload, getPetWindow, log }) {
    Object.assign(this, { app, screen, BrowserWindow, store, rootDir, preload, getPetWindow, log: log || (() => {}) });
    this.worker = null; this.overlay = null; this.calibWin = null;
    this.calib = null;          // { display, samples, target, collecting }
    this.model = this._loadModel();
    this.fx = new OneEuro({ minCutoff: 0.9, beta: 0.03 }); this.fy = new OneEuro({ minCutoff: 0.9, beta: 0.03 });
    this.attention = new Attention();
    this.lastState = 'looking'; this.lastNudge = {}; this.nudgeCount = {};
    this.lastPetPush = 0; this.lastSample = 0; this.cameraError = ''; this.ready = false;
    this.statsBuffer = {}; this.lastStatsFlush = Date.now();
  }

  // ---------- 状态 ----------
  enabled() { return Boolean(this.store.get('pet.gaze', false)); }
  haloOn() { return this.store.get('pet.gazeHalo', true) !== false; }
  running() { return Boolean(this.worker && !this.worker.isDestroyed()); }

  status() {
    const m = this.model;
    return {
      enabled: this.enabled(), running: this.running(), ready: this.ready, haloOn: this.haloOn(),
      calibrated: Boolean(m?.W), errorPx: m?.errorPx || 0, calibratedAt: m?.at || 0, samples: m?.samples || 0,
      cameraError: this.cameraError, state: this.lastState, stateLabel: STATE_LABEL[this.lastState] || '',
      lastSampleAgo: this.lastSample ? Date.now() - this.lastSample : -1,
      today: this.todayStats(),
    };
  }

  _loadModel() { const m = this.store.get('pet.gazeModel'); return m && Array.isArray(m.W) ? m : null; }

  paths() {
    const unpacked = (p) => p.replace(/app\.asar([\/\\])/, 'app.asar.unpacked$1');
    const root = this.rootDir;
    return {
      wasm: pathToFileURL(unpacked(path.join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm'))).href,
      model: pathToFileURL(unpacked(path.join(root, 'assets', 'models', 'face_landmarker.task'))).href,
    };
  }

  // ---------- 开关 ----------
  setEnabled(on) {
    this.store.set('pet.gaze', Boolean(on));
    if (on) this.start(); else this.stop();
    return this.status();
  }

  setHalo(on) { this.store.set('pet.gazeHalo', Boolean(on)); if (!on) this._pushPoint({ visible: false }); return this.status(); }

  start() {
    if (this.running()) return;
    this.cameraError = ''; this.ready = false;
    const win = new this.BrowserWindow({ width: 320, height: 240, show: false, skipTaskbar: true, webPreferences: { preload: this.preload, contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
    win.loadFile(path.join(this.rootDir, 'src', 'gaze', 'index.html'));
    win.on('closed', () => { this.worker = null; this.ready = false; });
    this.worker = win;
    this.fx.reset(); this.fy.reset();
  }

  stop() {
    if (this.worker && !this.worker.isDestroyed()) { try { this.worker.webContents.send('gaze:control', 'stop'); } catch { /* 已关 */ } setTimeout(() => { try { this.worker?.destroy(); } catch { /* 已关 */ } }, 300); }
    this.worker = null; this.ready = false;
    this._pushPoint({ visible: false });
    this._flushStats();
    if (this.overlay && !this.overlay.isDestroyed()) { this.overlay.hide(); }
    this._pushPet({ state: 'off', label: '守望已关' });
  }

  // ---------- 覆盖层 ----------
  _ensureOverlay(display) {
    if (this.overlay && !this.overlay.isDestroyed()) { if (display) this.overlay.setBounds(display.bounds); return this.overlay; }
    const d = display || this.screen.getPrimaryDisplay();
    const win = new this.BrowserWindow({
      ...d.bounds, frame: false, transparent: true, resizable: false, movable: false, skipTaskbar: true, hasShadow: false, focusable: false, show: false,
      alwaysOnTop: true, acceptFirstMouse: false,
      webPreferences: { preload: this.preload, contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    win.setIgnoreMouseEvents(true, { forward: true });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.loadFile(path.join(this.rootDir, 'src', 'gaze', 'overlay.html'));
    win.on('closed', () => { this.overlay = null; });
    this.overlay = win;
    return win;
  }

  _pushPoint(payload) {
    const win = this.overlay;
    if (!win || win.isDestroyed()) return;
    if (payload.visible && !win.isVisible()) win.showInactive();
    try { win.webContents.send('gaze:point', payload); } catch { /* 页面还没好 */ }
  }

  _pushPet(payload) {
    const pet = this.getPetWindow?.();
    if (pet && !pet.isDestroyed()) { try { pet.webContents.send('pet:gaze', payload); } catch { /* 没开 */ } }
  }

  // ---------- 样本 ----------
  onSample(payload = {}) {
    if (payload.error) { this.cameraError = `${payload.name ? `${payload.name}: ` : ''}${payload.error}`; this.log(`[gaze] 摄像头：${this.cameraError}`); this._sendCalib({ type: 'camera', ok: false, text: this.cameraError }); return; }
    if (payload.ready) { this.ready = true; this._sendCalib({ type: 'camera', ok: true }); return; }
    const t = payload.t || Date.now();
    this.lastSample = t;
    let feat = null;
    if (payload.present && payload.pts) {
      const sparse = new Array(478).fill(null);
      for (const [i, p] of Object.entries(payload.pts)) sparse[Number(i)] = p;
      feat = featuresFrom(sparse, payload.matrix);
    }
    if (feat && !this.calibCameraOk) { this.calibCameraOk = true; this._sendCalib({ type: 'camera', ok: true }); }

    // 校准中：收集这一点的样本
    if (this.calib) {
      if (feat && this.calib.collecting && this.calib.target) this.calib.samples.push({ x: feat.vec, y: this.calib.target });
      return;
    }

    let gaze = null;
    if (feat && this.model?.W) {
      const raw = predict(this.model.W, feat.vec);
      gaze = [this.fx.filter(raw[0], t), this.fy.filter(raw[1], t)];
    } else { this.fx.reset(); this.fy.reset(); }

    const { state, sinceMs } = this.attention.update({ t, present: Boolean(feat), gaze, yaw: feat?.yaw, pitch: feat?.pitch, eyeOpen: feat?.eyeOpen });
    this._accumulate(state);

    // 光圈
    if (this.haloOn() && gaze && this.model?.displayId != null && state !== 'away' && state !== 'phone') {
      const display = this.screen.getAllDisplays().find((d) => d.id === this.model.displayId) || this.screen.getPrimaryDisplay();
      this._ensureOverlay(display);
      const b = display.bounds;
      const x = Math.max(-40, Math.min(b.width + 40, gaze[0] * b.width));
      const y = Math.max(-40, Math.min(b.height + 40, gaze[1] * b.height));
      this._pushPoint({ visible: true, x, y, state });
    } else this._pushPoint({ visible: false });

    // 桌宠状态 + 提醒
    if (state !== this.lastState || t - this.lastPetPush > 1500) {
      this.lastPetPush = t;
      this._pushPet({ state, label: STATE_LABEL[state], sinceSec: Math.round(sinceMs / 1000) });
    }
    if (state !== this.lastState) { this.lastState = state; if (state === 'looking') this.nudgeCount = {}; }
    this._maybeNudge(state, sinceMs, t);
  }

  _maybeNudge(state, sinceMs, t) {
    if (!NUDGES[state]) return;
    const thresholds = { distracted: 30000, phone: 20000, away: 120000, tired: 15000 };
    const cooldown = 60000;
    if (sinceMs < thresholds[state]) return;
    if (t - (this.lastNudge[state] || 0) < cooldown) return;
    const n = this.nudgeCount[state] || 0;
    const line = NUDGES[state][Math.min(n, NUDGES[state].length - 1)].replace('%s', this._fmt(sinceMs));
    this.nudgeCount[state] = n + 1; this.lastNudge[state] = t;
    this._pushPet({ state, label: STATE_LABEL[state], sinceSec: Math.round(sinceMs / 1000), say: line });
  }

  _fmt(ms) { const s = Math.round(ms / 1000); return s < 60 ? `${s} 秒` : `${Math.floor(s / 60)} 分${s % 60 ? `${s % 60} 秒` : ''}`; }

  // ---------- 统计（每种状态今天多少秒） ----------
  _accumulate(state) {
    const now = Date.now();
    if (this._accLast) { const dt = Math.min(2000, now - this._accLast); this.statsBuffer[state] = (this.statsBuffer[state] || 0) + dt; }
    this._accLast = now;
    if (now - this.lastStatsFlush > 15000) this._flushStats();
  }
  _flushStats() {
    const key = new Date().toISOString().slice(0, 10);
    const all = this.store.get('pet.gazeStats', {}) || {};
    const day = { ...(all[key] || {}) };
    for (const [s, ms] of Object.entries(this.statsBuffer)) day[s] = (day[s] || 0) + ms;
    all[key] = day;
    const keys = Object.keys(all).sort().slice(-30);
    this.store.set('pet.gazeStats', Object.fromEntries(keys.map((k) => [k, all[k]])));
    this.statsBuffer = {}; this.lastStatsFlush = Date.now();
  }
  todayStats() {
    const key = new Date().toISOString().slice(0, 10);
    const day = { ...((this.store.get('pet.gazeStats', {}) || {})[key] || {}) };
    for (const [s, ms] of Object.entries(this.statsBuffer)) day[s] = (day[s] || 0) + ms;
    return Object.fromEntries(Object.entries(day).map(([s, ms]) => [s, Math.round(ms / 1000)]));
  }

  // ---------- 校准 ----------
  calibrate() {
    if (!this.enabled()) this.setEnabled(true);
    if (this.calibWin && !this.calibWin.isDestroyed()) { this.calibWin.focus(); return { ok: true }; }
    const display = this.screen.getDisplayNearestPoint(this.screen.getCursorScreenPoint());
    this.calib = { display, samples: [], target: null, collecting: false };
    this.calibCameraOk = false;
    const win = new this.BrowserWindow({ ...display.bounds, frame: false, fullscreen: false, alwaysOnTop: true, skipTaskbar: true, resizable: false, movable: false, backgroundColor: '#0b0d12', webPreferences: { preload: this.preload, contextIsolation: true, nodeIntegration: false, sandbox: true } });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.loadFile(path.join(this.rootDir, 'src', 'gaze', 'calibrate.html'));
    win.on('closed', () => { this.calibWin = null; this.calib = null; });
    this.calibWin = win;
    if (this.overlay && !this.overlay.isDestroyed()) this.overlay.hide();
    if (this.ready) setTimeout(() => this._sendCalib({ type: 'camera', ok: true }), 800);
    return { ok: true };
  }

  _sendCalib(msg) { if (this.calibWin && !this.calibWin.isDestroyed()) { try { this.calibWin.webContents.send('gaze:calib', msg); } catch { /* 没开 */ } } }

  calibStep(step = {}) {
    if (!this.calib) return { ok: false, error: '没有在校准' };
    if (step.type === 'begin') { this.calib.samples = []; return { ok: true }; }
    if (step.type === 'collect') { this.calib.target = [Number(step.x), Number(step.y)]; this.calib.collecting = true; return { ok: true }; }
    if (step.type === 'pause') { this.calib.collecting = false; return { ok: true }; }
    if (step.type === 'cancel' || step.type === 'close') { const win = this.calibWin; this.calib = null; this.calibWin = null; if (win && !win.isDestroyed()) win.close(); this.fx.reset(); this.fy.reset(); return { ok: true }; }
    if (step.type === 'finish') {
      const samples = this.calib.samples;
      const W = fitRidge(samples, 1e-3);
      if (!W) return { ok: false, error: `只收到 ${samples.length} 个样本，摄像头没看清脸。光线亮一点、离屏幕 50～70 厘米再试。`, samples: samples.length };
      const res = residual(W, samples);
      const b = this.calib.display.bounds;
      const errorPx = Math.round(res * Math.hypot(b.width, b.height) / Math.SQRT2);
      this.model = { W, errorPx, at: Date.now(), samples: samples.length, displayId: this.calib.display.id };
      this.store.set('pet.gazeModel', this.model);
      this.fx.reset(); this.fy.reset();
      return { ok: true, samples: samples.length, errorPx };
    }
    return { ok: false, error: '未知步骤' };
  }

  clearModel() { this.model = null; this.store.set('pet.gazeModel', undefined); this._pushPoint({ visible: false }); return this.status(); }

  dispose() { try { this.stop(); } catch { /* 退出时不计较 */ } for (const w of [this.overlay, this.calibWin]) { try { w?.destroy(); } catch { /* 已关 */ } } }
}

module.exports = { GazeService, NUDGES, STATE_LABEL };
