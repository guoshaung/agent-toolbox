'use strict';
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

/**
 * 把打包在 assets/coach-extension 里的「AI Code Reading Coach」插件
 * 装进本机的 VSCode / Cursor，并把默认 API 配置写进编辑器的 settings.json。
 *
 * - 插件已打补丁：优先读 settings.json 里的 aiCodeReadingCoach.apiKey，没有再弹窗问
 * - 默认配置来自 defaults.local.json（gitignore 了，不会进仓库）；没有就跳过写配置
 * - settings.json 是 JSONC（可能有注释/尾逗号），合并时做了容错解析
 */

const EXT_ID = 'local.ai-code-reading-coach-0.1.0';

const EDITORS = [
  {
    name: 'VSCode',
    appPath: '/Applications/Visual Studio Code.app',
    extDir: () => path.join(os.homedir(), '.vscode', 'extensions', EXT_ID),
    settingsPath: () => path.join(os.homedir(), 'Library', 'Application Support', 'Code', 'User', 'settings.json'),
  },
  {
    name: 'Cursor',
    appPath: '/Applications/Cursor.app',
    extDir: () => path.join(os.homedir(), '.cursor', 'extensions', EXT_ID),
    settingsPath: () => path.join(os.homedir(), 'Library', 'Application Support', 'Cursor', 'User', 'settings.json'),
  },
];

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

/** 去掉 JSONC 的注释和尾逗号（只在字符串外面动刀） */
function jsoncToJson(text) {
  let out = '';
  let inString = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (inString) {
      out += c;
      if (c === '\\') { out += text[i + 1] || ''; i += 2; continue; }
      if (c === '"') inString = false;
      i += 1;
      continue;
    }
    if (c === '"') { inString = true; out += c; i += 1; continue; }
    if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    out += c;
    i += 1;
  }
  // 尾逗号：,} 或 ,]（此时字符串已不在考虑范围的概率仍非零，但 settings.json 里极少见）
  return out.replace(/,\s*([}\]])/g, '$1');
}

function readSettings(settingsPath) {
  try {
    const raw = fs.readFileSync(settingsPath, 'utf8');
    const parsed = JSON.parse(jsoncToJson(raw));
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function loadDefaults(sourceDir) {
  try {
    const raw = fs.readFileSync(path.join(sourceDir, 'defaults.local.json'), 'utf8');
    const parsed = JSON.parse(raw);
    return {
      apiBaseUrl: String(parsed.apiBaseUrl || ''),
      apiKey: String(parsed.apiKey || ''),
      model: String(parsed.model || ''),
    };
  } catch {
    return null;
  }
}

function installCoachExtension() {
  const sourceDir = path.join(__dirname, '..', '..', 'assets', 'coach-extension');
  if (!fs.existsSync(path.join(sourceDir, 'package.json'))) {
    return { ok: false, error: '工具箱里没找到打包的插件（assets/coach-extension 缺失）。' };
  }
  const defaults = loadDefaults(sourceDir);
  const installed = [];

  for (const editor of EDITORS) {
    const hostExists = fs.existsSync(editor.appPath) || fs.existsSync(path.dirname(editor.extDir()));
    if (!hostExists) continue;

    copyDir(sourceDir, editor.extDir());
    // 别把本地默认配置文件拷进编辑器扩展目录
    for (const junk of ['defaults.local.json', 'defaults.example.json']) {
      try { fs.rmSync(path.join(editor.extDir(), junk)); } catch { /* 不存在 */ }
    }

    let configured = false;
    if (defaults && (defaults.apiBaseUrl || defaults.apiKey || defaults.model)) {
      const settingsPath = editor.settingsPath();
      const settings = readSettings(settingsPath);
      if (defaults.apiBaseUrl) settings['aiCodeReadingCoach.apiBaseUrl'] = defaults.apiBaseUrl;
      if (defaults.model) settings['aiCodeReadingCoach.model'] = defaults.model;
      if (defaults.apiKey) settings['aiCodeReadingCoach.apiKey'] = defaults.apiKey;
      fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
      configured = true;
    }
    installed.push({ editor: editor.name, configured });
  }

  if (!installed.length) {
    return { ok: false, error: '没找到 VSCode 或 Cursor，插件没地方装。' };
  }
  return { ok: true, installed, withDefaults: Boolean(defaults) };
}

module.exports = { installCoachExtension };
