'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { BeautyNativePreview, previewCapability, previewSpec } = require('../src/main/beauty-native-preview');
const profile = { name: '我的主题', effect: 'mica', tint: '#203040', accent: '#8fb4ff', opacity: 72 };

function fixture(options = {}) {
  const windows = [];
  class FakeWindow extends EventEmitter {
    constructor(settings) {
      super(); this.settings = settings; this.destroyed = false; this.materials = []; this.loads = []; this.shown = false;
      this.webContents = new EventEmitter();
      this.webContents.setWindowOpenHandler = handler => { this.openHandler = handler; };
      this.webContents.session = { setPermissionRequestHandler: handler => { this.permission = handler; }, setPermissionCheckHandler: handler => { this.permissionCheck = handler; } };
      windows.push(this);
    }
    isDestroyed() { return this.destroyed; }
    setBackgroundMaterial(material) { this.materials.push(material); }
    async loadFile(file, options) { this.loads.push({ file, options }); if (this.fail) throw new Error('load failure'); }
    show() { this.shown = true; }
    focus() { this.focused = true; }
    destroy() { this.destroyed = true; this.emit('closed'); }
    close() { this.destroy(); }
  }
  return { windows, preview: new BeautyNativePreview({ getBrowserWindow: () => FakeWindow, platform: 'win32', release: '10.0.22621', ...options }) };
}

test('native materials are available only on supported Windows versions', async () => {
  for (const [platform, release] of [['darwin', '24.0.0'], ['linux', '6.1.0'], ['win32', '10.0.19045'], ['win32', 'invalid']]) {
    assert.equal(previewCapability(platform, release).supported, false);
    const { windows, preview } = fixture({ platform, release });
    await assert.rejects(preview.open(profile), /Windows 11/);
    assert.equal(windows.length, 0);
  }
  assert.equal(previewCapability('win32', '10.0.26200').supported, true);
});

test('material mapping and query whitelist never forward files, scripts or system choices', () => {
  const spec = previewSpec({ ...profile, name: '<script>alert(1)</script>', backgroundId: 'private', windows: { apps: 'dark' }, secret: 'key' });
  assert.equal(spec.name, '<script>alert(1)</script>');
  assert.equal(spec.backgroundId, undefined); assert.equal(spec.secret, undefined); assert.equal(spec.windows, undefined);
  assert.equal(previewSpec({ ...profile, effect: 'glass' }).material, 'acrylic');
  assert.equal(previewSpec({ ...profile, effect: 'solid' }).material, 'none');
  for (const invalid of [{ effect: '__proto__' }, { effect: 'constructor' }, { tint: 'url(file://private)' }, { accent: '<script>' }, { opacity: Infinity }]) assert.throws(() => previewSpec({ ...profile, ...invalid }), /无效/);
});

test('preview opens a sandboxed window, blocks navigation/permissions and closes independently', async () => {
  const { preview, windows } = fixture();
  assert.equal(preview.window, null);
  assert.equal((await preview.open(profile)).scope, 'toolbox-preview-window');
  const win = windows[0];
  assert.equal(win.settings.show, false); assert.equal(win.settings.backgroundMaterial, 'mica');
  assert.equal(win.settings.backgroundColor, '#00000000');
  assert.deepEqual(win.settings.webPreferences, { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, partition: 'beauty-native-preview' });
  assert.equal(win.settings.webPreferences.preload, undefined);
  assert.equal(win.shown, true); assert.equal(win.focused, true);
  assert.deepEqual(win.openHandler({ url: 'https://example.com' }), { action: 'deny' });
  let blocked = 0;
  win.webContents.emit('will-navigate', { preventDefault() { blocked++; } });
  win.webContents.emit('will-attach-webview', { preventDefault() { blocked++; } });
  win.permission(null, 'camera', granted => assert.equal(granted, false));
  assert.equal(win.permissionCheck(), false); assert.equal(blocked, 2);
  preview.close(); assert.equal(win.destroyed, true); assert.equal(preview.window, null);
});

test('concurrent previews reuse one owned window and apply the latest normalized theme', async () => {
  const { preview, windows } = fixture({ show: false });
  await Promise.all([preview.open(profile), preview.open({ ...profile, effect: 'acrylic', name: 'second' })]);
  assert.equal(windows.length, 1);
  assert.deepEqual(windows[0].materials, ['mica', 'acrylic']);
  assert.equal(windows[0].loads.at(-1).options.query.name, 'second');
  assert.equal(windows[0].shown, false);
  preview.close(); await preview.open(profile); assert.equal(windows.length, 2);
});

test('failed preview loads destroy only the preview window and later requests can retry', async () => {
  const { preview, windows } = fixture();
  await preview.open(profile); windows[0].fail = true;
  await assert.rejects(preview.open(profile), /load failure/);
  assert.equal(preview.window, null); assert.equal(windows[0].destroyed, true);
  await preview.open(profile); assert.equal(windows.length, 2);
  preview.close();
});
