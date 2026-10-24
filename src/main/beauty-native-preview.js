'use strict';
const os = require('node:os');
const path = require('node:path');

function previewCapability(platform = process.platform, release = os.release()) {
  const [major, , build] = String(release).split('.').map(Number);
  const supported = platform === 'win32' && major >= 10 && Number.isInteger(build) && build >= 22621;
  return { supported, reason: supported ? '' : '原生材质预览需要 Windows 11 22H2 或更新版本' };
}

function previewSpec(profile) {
  const materials = { glass: 'acrylic', acrylic: 'acrylic', mica: 'mica', solid: 'none' };
  if (!profile || !Object.hasOwn(materials, profile.effect) || !/^#[a-f0-9]{6}$/i.test(profile.tint) || !/^#[a-f0-9]{6}$/i.test(profile.accent) || !Number.isFinite(profile.opacity)) throw new Error('原生预览参数无效');
  return { material: materials[profile.effect], effect: profile.effect, tint: profile.tint, accent: profile.accent,
    opacity: String(Math.max(15, Math.min(100, profile.opacity))), name: String(profile.name || '我的主题').slice(0, 60) };
}

class BeautyNativePreview {
  constructor({ getBrowserWindow = () => require('electron').BrowserWindow, platform = process.platform, release = os.release(), show = true } = {}) {
    this.getBrowserWindow = getBrowserWindow;
    this.capability = previewCapability(platform, release);
    this.show = show;
    this.window = null;
    this.pending = Promise.resolve();
  }
  open(profile) {
    const action = this.pending.then(() => this.openWindow(profile));
    this.pending = action.catch(() => {});
    return action;
  }
  async openWindow(profile) {
    if (!this.capability.supported) throw new Error(this.capability.reason);
    const spec = previewSpec(profile);
    let win = this.window;
    try {
      if (!win || win.isDestroyed()) {
        const BrowserWindow = this.getBrowserWindow();
        win = new BrowserWindow({ width: 860, height: 600, minWidth: 580, minHeight: 420,
          title: 'Toolbox · 原生材质预览', show: false, autoHideMenuBar: true,
          backgroundColor: '#00000000', backgroundMaterial: spec.material,
          webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false,
            webSecurity: true, partition: 'beauty-native-preview' } });
        this.window = win;
        const current = win;
        win.on('closed', () => { if (this.window === current) this.window = null; });
        win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        win.webContents.on('will-navigate', event => event.preventDefault());
        win.webContents.on('will-attach-webview', event => event.preventDefault());
        win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
        win.webContents.session.setPermissionCheckHandler(() => false);
      }
      win.setBackgroundMaterial(spec.material);
      await win.loadFile(path.join(__dirname, '../renderer/beauty-native-preview/index.html'), { query: spec });
      if (win.isDestroyed()) throw new Error('原生预览窗口已关闭');
      if (this.show) { win.show(); win.focus(); }
      return { material: spec.material, scope: 'toolbox-preview-window' };
    } catch (error) {
      if (win && !win.isDestroyed()) win.destroy();
      throw error;
    }
  }
  close() { if (this.window && !this.window.isDestroyed()) this.window.close(); }
}

module.exports = { BeautyNativePreview, previewCapability, previewSpec };
