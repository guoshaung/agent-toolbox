'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify, isDeepStrictEqual } = require('node:util');
const { previewCapability } = require('./beauty-native-preview');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const RANGES = { 20: 1, 33: 3, 38: 4 };

function windowPlan(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new Error('窗口外观选项无效');
  const values = {};
  for (const [name, attribute, choices] of [
    ['dark', 20, { off: 0, on: 1 }], ['corners', 33, { default: 0, square: 1, round: 2, small: 3 }],
    ['material', 38, { auto: 0, none: 1, mica: 2, acrylic: 3, tabbed: 4 }],
  ]) {
    const value = options[name] ?? 'keep';
    if (value === 'keep') continue;
    if (!Object.hasOwn(choices, value)) throw new Error('窗口外观选项无效');
    values[attribute] = choices[value];
  }
  return values;
}
function windowValues(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !Object.keys(input).length) throw new Error('窗口备份属性无效');
  const values = {};
  for (const [key, value] of Object.entries(input)) {
    if (!Object.hasOwn(RANGES, key) || !Number.isInteger(value) || value < 0 || value > RANGES[key]) throw new Error('窗口备份属性无效');
    values[key] = value;
  }
  return values;
}
function windowIdentity(input) {
  if (!input || typeof input.hwnd !== 'string' || !/^[1-9][0-9]{0,18}$/.test(input.hwnd) || BigInt(input.hwnd) > 0x7fffffffffffffffn ||
    !Number.isInteger(input.pid) || input.pid < 1 || input.pid > 0xffffffff || typeof input.started !== 'string' || !/^[1-9][0-9]{0,18}$/.test(input.started) ||
    typeof input.className !== 'string' || !input.className.length || input.className.length > 256 ||
    typeof input.processName !== 'string' || !input.processName.length || input.processName.length > 128) throw new Error('窗口身份无效');
  return { hwnd: input.hwnd, pid: input.pid, started: input.started, className: input.className,
    processName: input.processName, title: String(input.title || '').slice(0, 200) };
}
function validRecord(record) {
  if (!record || !UUID.test(record.id || '') || !Number.isInteger(record.marker) || record.marker < 1 || record.marker > 0x7ffffffe || !['pending', 'applied', 'restored'].includes(record.phase)) throw new Error('窗口恢复记录无效');
  return { ...record, target: windowIdentity(record.target), values: windowValues(record.values) };
}
function windowMarker(value) {
  if (!Number.isInteger(value) || value < 1 || value > 0x7ffffffe) throw new Error('窗口身份标记无效');
  return value;
}

class WindowAppearance {
  constructor({ root, native = new WindowAppearanceBridge(), platform = process.platform, release = os.release() } = {}) {
    this.root = root; this.file = path.join(root, 'windows.json'); this.native = native;
    this.capability = previewCapability(platform, release); this.candidates = new Map(); this.pending = Promise.resolve();
  }
  serial(fn) { const action = this.pending.then(fn); this.pending = action.catch(() => {}); return action; }
  read() {
    if (!fs.existsSync(this.file)) return { version: 1, records: [] };
    if (fs.statSync(this.file).size > 1024 * 1024) throw new Error('窗口恢复文件超过大小限制');
    const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    if (data.version !== 1 || !Array.isArray(data.records) || data.records.length > 32) throw new Error('窗口恢复文件格式无效');
    return data;
  }
  write(data) {
    fs.mkdirSync(this.root, { recursive: true });
    const temporary = `${this.file}.${crypto.randomUUID()}.tmp`;
    try { fs.writeFileSync(temporary, JSON.stringify(data, null, 2), { mode: 0o600 }); fs.renameSync(temporary, this.file); }
    finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  }
  list() {
    return { ...this.capability, candidates: [...this.candidates].map(([id, target]) => ({ id, title: target.title, processName: target.processName })),
      records: this.read().records.map(record => ({ id: record.id, title: record.target?.title || '窗口', processName: record.target?.processName || '', at: record.at, phase: record.phase })) };
  }
  refresh() {
    return this.serial(async () => {
      if (!this.capability.supported) throw new Error(this.capability.reason);
      const result = await this.native.enumerate();
      if (!Array.isArray(result) || result.length > 256) throw new Error('窗口列表无法识别');
      const previous = [...this.candidates], next = new Map();
      for (const entry of result) {
        const target = windowIdentity(entry);
        const found = previous.find(([, old]) => old.hwnd === target.hwnd && old.pid === target.pid && old.started === target.started && old.className === target.className);
        next.set(found?.[0] || crypto.randomUUID(), target);
      }
      this.candidates = next; return this.list();
    });
  }
  apply(id, options) {
    return this.serial(async () => {
      if (!this.capability.supported) throw new Error(this.capability.reason);
      const target = this.candidates.get(id), plan = windowPlan(options);
      if (!target) throw new Error('请刷新并选择目标窗口');
      if (!Object.keys(plan).length) throw new Error('请选择需要更改的窗口外观项');
      const data = this.read();
      let record = data.records.find(item => item.target?.hwnd === target.hwnd && item.target?.pid === target.pid && item.target?.started === target.started);
      if (record) {
        record = validRecord(record);
        if (record.phase !== 'applied') throw new Error('请先恢复该窗口未完成的更改');
      } else if (data.records.length >= 32) throw new Error('请先恢复或清理已有窗口记录');
      const snapshot = await this.native.capture(target, Object.keys(plan), record?.marker);
      const baseline = { ...(record?.values || {}) };
      const captured = windowValues(snapshot.values);
      for (const key of Object.keys(plan)) if (!Object.hasOwn(baseline, key)) baseline[key] = captured[key];
      const fresh = !record;
      if (!record) record = { id: crypto.randomUUID(), target, marker: crypto.randomInt(1, 0x7fffffff), at: new Date().toISOString(), phase: 'pending' };
      record.values = windowValues(baseline);
      data.records = data.records.filter(item => item.id !== record.id); data.records.push(record);
      this.write(data); // Baseline and marker intent must survive a crash before the first native mutation.
      await this.native.apply(record.target, plan, record.marker, fresh);
      record.phase = 'applied'; this.write(data);
      return this.list();
    });
  }
  restore(id) {
    return this.serial(async () => {
      if (!this.capability.supported) throw new Error(this.capability.reason);
      const data = this.read(), record = validRecord(data.records.find(item => item.id === id));
      if (record.phase === 'pending') {
        const snapshot = await this.native.capture(record.target, Object.keys(record.values));
        if (snapshot.marker === 0 && isDeepStrictEqual(windowValues(snapshot.values), record.values)) {
          data.records = data.records.filter(item => item.id !== id); this.write(data); return this.list();
        }
      }
      if (record.phase !== 'restored') {
        await this.native.restore(record.target, record.values, record.marker);
        record.phase = 'restored';
        data.records = data.records.map(item => item.id === id ? record : item); this.write(data);
      }
      // A durable restored phase makes marker removal and retry idempotent.
      await this.native.clearMarker(record.target, record.marker);
      data.records = data.records.filter(item => item.id !== id); this.write(data);
      return this.list();
    });
  }
  forgetClosed(id) {
    return this.serial(async () => {
      const data = this.read(), record = validRecord(data.records.find(item => item.id === id));
      if (await this.native.alive(record.target)) throw new Error('窗口仍在运行，恢复记录已保留');
      data.records = data.records.filter(item => item.id !== id); this.write(data); return this.list();
    });
  }
}

class WindowAppearanceBridge {
  constructor({ exec = promisify(execFile), platform = process.platform } = {}) { this.exec = exec; this.platform = platform; }
  async run(operation, payload = {}) {
    if (this.platform !== 'win32' || !['enumerate', 'describe', 'capture', 'apply', 'restore', 'clear-marker', 'alive'].includes(operation)) throw new Error('窗口原生操作不可用');
    const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
    // This helper is larger than Windows' command-line limit once UTF16/base64 encoded.
    // Materialize our own script from asar, with per-call temporary paths and data-only arguments.
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'toolbox-beauty-window-'));
    const script = path.join(directory, 'native.ps1');
    let stdout;
    try {
      fs.writeFileSync(script, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), fs.readFileSync(path.join(__dirname, 'beauty-window-native.ps1'))]), { mode: 0o600 });
      ({ stdout } = await this.exec('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Operation', operation, '-Payload', encoded], { windowsHide: true, timeout: 20000, maxBuffer: 1024 * 1024 }));
    } finally { try { if (fs.existsSync(script)) fs.unlinkSync(script); fs.rmdirSync(directory); } catch {} }
    const result = JSON.parse(stdout.replace(/^\uFEFF/, '').trim());
    if (!result.ok) {
      const messages = { WINDOW_GONE: '目标窗口已关闭，可清理记录', WINDOW_IDENTITY: '窗口身份已变化，请重新选择', WINDOW_MARKER: '窗口身份标记不匹配，已停止操作', WINDOW_ACCESS: '当前权限无法修改此窗口', ATTRIBUTE_READ: '无法备份所选窗口属性，已停止操作', ATTRIBUTE_WRITE: '窗口属性未完整应用，恢复记录已保留' };
      const error = new Error(messages[result.code] || result.error || '窗口原生操作失败'); error.code = result.code; throw error;
    }
    return result.data;
  }
  enumerate() { return this.run('enumerate'); }
  describe(hwnd) { if (!/^[1-9][0-9]{0,18}$/.test(hwnd)) throw new Error('窗口句柄无效'); return this.run('describe', { hwnd }); }
  capture(target, attributes, marker) { return this.run('capture', { target: windowIdentity(target), attributes: Object.keys(windowValues(Object.fromEntries(attributes.map(key => [key, 0])))), marker: marker === undefined ? undefined : windowMarker(marker) }); }
  apply(target, values, marker, bind) { if (typeof bind !== 'boolean') throw new Error('窗口绑定选项无效'); return this.run('apply', { target: windowIdentity(target), values: windowValues(values), marker: windowMarker(marker), bind }); }
  restore(target, values, marker) { return this.run('restore', { target: windowIdentity(target), values: windowValues(values), marker: windowMarker(marker) }); }
  clearMarker(target, marker) { return this.run('clear-marker', { target: windowIdentity(target), marker: windowMarker(marker) }); }
  alive(target) { return this.run('alive', { target: windowIdentity(target) }); }
}

module.exports = { WindowAppearance, WindowAppearanceBridge, windowPlan, windowValues, windowIdentity };
