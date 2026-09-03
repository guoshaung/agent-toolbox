'use strict';
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

/**
 * 聊天记录桥：读本机各 AI 工具的本地会话文件，导出成通用格式。
 *
 * 每个来源一个 adapter：{ id, label, list(), load(id) }。
 * 会话统一成 { id, source, title, createdAt, updatedAt, cwd, model, path, count, messages[], note? }
 * 消息统一成 { role, content, createdAt?, model? }
 *
 * 已支持：
 * - codex    ~/.codex/sessions/**＼/rollout-*.jsonl（CLI 与桌面版两种事件格式）
 * - claude   ~/.claude/history.jsonl（只有用户输入历史，回复在桌面端加密存储）
 * - opencode ~/.local/share/opencode/opencode.db（SQLite：session/message/part）
 * - omp      ~/.omp/agent/sessions/<项目>/<时间>_<uuid>.jsonl
 * - dsh      ~/.dsh/sessions/<项目>/session-*＼/session.jsonl.zstd（zstd 压缩 JSONL）
 * - qwen     ~/.qwen/projects/<项目>/chats/*.jsonl
 * - gemini   ~/.gemini/tmp/<项目>/chats/*.jsonl（$set 补丁式 JSONL）
 */

const PREVIEW_LIMIT = 120; // 会话预览最多返回多少条消息，导出不受限

// ---------- 小工具 ----------

function* walk(dir, match) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full, match);
    else if (match.test(entry.name)) yield full;
  }
}

/** 分块同步读行：再大的文件也不会撞上 Node 单字符串 512MB 上限。maxBytes 用于列表模式只读文件头。 */
function* readLines(filePath, { maxBytes = Infinity } = {}) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
  } catch {
    return;
  }
  try {
    const CHUNK = 4 * 1024 * 1024;
    const buf = Buffer.allocUnsafe(Math.min(CHUNK, maxBytes));
    let pending = '';
    let offset = 0;
    while (offset < maxBytes) {
      const want = Math.min(buf.length, maxBytes - offset);
      const bytesRead = fs.readSync(fd, buf, 0, want, offset);
      if (bytesRead <= 0) break;
      offset += bytesRead;
      const text = pending + buf.toString('utf8', 0, bytesRead);
      let start = 0;
      let idx = text.indexOf('\n');
      while (idx !== -1) {
        yield text.slice(start, idx);
        start = idx + 1;
        idx = text.indexOf('\n', start);
      }
      pending = text.slice(start);
    }
    if (pending) yield pending;
  } finally {
    fs.closeSync(fd);
  }
}

function readZstdLines(filePath) {
  try {
    return execFileSync('zstd', ['-d', '-c', filePath], { maxBuffer: 256 * 1024 * 1024 })
      .toString('utf8')
      .split('\n');
  } catch {
    return [];
  }
}

function parseJsonLine(line) {
  if (!line || !line.trim()) return null;
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function extractText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object') return item.text || item.value || '';
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

function makeTitle(text, maxLen = 40) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > maxLen ? `${t.slice(0, maxLen)}…` : t;
}

/** 同一句话在不同事件里可能各出现一次，相邻去重。 */
function dedupe(messages) {
  const out = [];
  for (const m of messages) {
    const prev = out[out.length - 1];
    if (prev && prev.role === m.role && prev.content === m.content) continue;
    out.push(m);
  }
  return out;
}

function isoFromMs(ms) {
  const n = Number(ms);
  return Number.isFinite(n) && n > 0 ? new Date(n).toISOString() : null;
}

function sortByUpdated(sessions) {
  return sessions.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

function finalize(session, { full }) {
  if (full) session.messages = dedupe(session.messages);
  if (!session.title) session.title = `${session.source} ${session.id.slice(0, 12)}`;
  return session;
}

/** 系统注入的上下文快照，不是用户手打的，导出去噪用。 */
function looksInjected(text) {
  // 先 trim：这些注入块前面常带换行，直接拿 ^ 匹配原文会漏掉。
  const t = String(text || '').trimStart();
  return /^Current runtime context\.|^<system-reminder>|^<environment_context>|^<user_instructions>|^# Files mentioned by the user:/.test(t);
}

// ---------- codex ----------

function parseCodexFile(filePath, { full = false } = {}) {
  if (!fs.existsSync(filePath)) return null;
  // 列表模式只读文件头拿标题/时间/目录；条数用文件大小估算，大文件才不会卡
  let headCap = Infinity;
  if (!full) {
    try {
      const size = fs.statSync(filePath).size;
      if (size > 4 * 1024 * 1024) headCap = 1024 * 1024;
    } catch { /* 忽略 */ }
  }
  const session = {
    id: path.basename(filePath, '.jsonl'),
    source: 'codex',
    title: '',
    createdAt: null,
    updatedAt: null,
    cwd: '',
    model: '',
    path: filePath,
    count: 0,
    messages: [],
  };
  for (const line of readLines(filePath, { maxBytes: full ? Infinity : headCap })) {
    // 列表模式先子串粗筛：大文件（有 500MB+ 的）逐行 parse 太慢
    if (!full &&
      !line.includes('session_meta') && !line.includes('task_started') &&
      !line.includes('user_message') && !line.includes('agent_message') &&
      !line.includes('"type":"message"') &&
      !line.includes('"role":"user"') && !line.includes('"role": "user"')) {
      if (line.includes('"role":"assistant"') || line.includes('"role": "assistant"')) session.count += 1;
      continue;
    }
    const record = parseJsonLine(line);
    if (!record) continue;
    const ts = typeof record.timestamp === 'string' ? record.timestamp : null;
    const payload = record.payload;
    if (!payload || typeof payload !== 'object') continue;

    if (record.type === 'session_meta') {
      if (!session.createdAt && payload.timestamp) session.createdAt = payload.timestamp;
      if (payload.cwd) session.cwd = payload.cwd;
      if (payload.id) session.id = payload.id;
      continue;
    }

    if (record.type === 'event_msg') {
      const et = payload.type;
      if (et === 'task_started' && !session.createdAt && payload.started_at) {
        session.createdAt = isoFromMs(payload.started_at * 1000);
      } else if (et === 'user_message' || et === 'agent_message') {
        const text = payload.message || '';
        const role = et === 'user_message' ? 'user' : 'assistant';
        if (text) {
          session.count += 1;
          if (role === 'user' && !session.title && !looksInjected(text)) session.title = makeTitle(text);
          if (full) session.messages.push({ role, content: text, createdAt: ts });
        }
        if (ts && (!session.updatedAt || ts > session.updatedAt)) session.updatedAt = ts;
      }
      continue;
    }

    if (record.type === 'response_item') {
      // 两种格式：老的把消息包在 payload.message 里，
      // 新的（带 ordinal 的那批）直接把 role/content 摊在 payload 上，
      // payload.type === 'message' 是它的标志。只认前者会把新会话整条读成空。
      const msg = (payload.message && typeof payload.message === 'object')
        ? payload.message
        : (payload.type === 'message' ? payload : null);
      if (!msg || typeof msg !== 'object') continue;
      if (['user', 'assistant', 'developer', 'system'].includes(msg.role)) {
        const content = extractText(msg.content);
        if (content) {
          session.count += 1;
          if (full) session.messages.push({ role: msg.role, content, createdAt: ts, model: msg.model || undefined });
          // 注入的环境上下文也是 role:user，拿它当标题的话列表里会是一片 <environment_context>
          if (msg.role === 'user' && !session.title && !looksInjected(content)) {
            session.title = makeTitle(content);
          }
          if (ts && (!session.updatedAt || ts > session.updatedAt)) session.updatedAt = ts;
        }
      }
      if (msg.model) session.model = msg.model;
    }
  }
  if (!full) {
    try {
      const stat = fs.statSync(filePath);
      session.updatedAt = stat.mtime.toISOString(); // 文件最后写入 = 会话最后活动
    } catch { /* 忽略 */ }
  }
  session.updatedAt = session.updatedAt || session.createdAt;
  return finalize(session, { full });
}

/** 文件名里找不到 id 时，读文件头 64KB 兜底（session_meta/header 里的真实 id 可能和文件名不同）。 */
function* filesWithIdInHead(files, id) {
  for (const f of files) {
    let found = false;
    for (const line of readLines(f, { maxBytes: 64 * 1024 })) {
      if (line.includes(id)) { found = true; break; }
    }
    if (found) yield f;
  }
}

const codex = {
  id: 'codex',
  label: 'Codex',
  *files() {
    const base = path.join(os.homedir(), '.codex');
    yield* walk(path.join(base, 'sessions'), /^rollout-.*\.jsonl$/);
    yield* walk(path.join(base, 'archived_sessions'), /^rollout-.*\.jsonl$/);
  },
  list() {
    const out = [];
    for (const f of this.files()) {
      const s = parseCodexFile(f, { full: false });
      if (s) out.push(s);
    }
    return sortByUpdated(out);
  },
  load(id) {
    for (const f of this.files()) {
      if (f.includes(id)) return parseCodexFile(f, { full: true });
    }
    for (const f of filesWithIdInHead(this.files(), id)) {
      return parseCodexFile(f, { full: true });
    }
    return null;
  },
};

// ---------- claude ----------

/**
 * Claude Code 的完整转录在 ~/.claude/projects/<项目 slug>/<会话 id>.jsonl，
 * 里面 user 和 assistant 都有。
 * （~/.claude/history.jsonl 只有用户输入，早先这里读的是那个，所以助手回复一直是空的。）
 */
const CLAUDE_PROJECTS = () => path.join(os.homedir(), '.claude', 'projects');

/** 转录里除了对话还混着 mode / attachment / file-history 这类事件，只挑真正的消息。 */
function claudeMessagesFrom(filePath, { full = false }) {
  const messages = [];
  let createdAt = null;
  let updatedAt = null;
  let cwd = '';
  let model = '';
  let title = '';

  for (const line of readLines(filePath, full ? {} : { maxBytes: 512 * 1024 })) {
    const record = parseJsonLine(line);
    if (!record) continue;
    if (record.cwd && !cwd) cwd = record.cwd;
    if (record.timestamp) {
      if (!createdAt) createdAt = record.timestamp;
      updatedAt = record.timestamp;
    }
    if (record.type !== 'user' && record.type !== 'assistant') continue;

    const message = record.message || {};
    if (message.model && !model) model = message.model;
    const text = extractText(message.content).trim();
    if (!text || looksInjected(text)) continue;
    // 工具调用/结果块被 extractText 抽成空串或极短片段，这里再兜一层
    if (record.type === 'user' && /^\[?tool_result/i.test(text)) continue;

    if (!title && record.type === 'user') title = makeTitle(text);
    messages.push({ role: record.type, content: text, createdAt: record.timestamp || null });
  }

  return { messages, createdAt, updatedAt, cwd, model, title };
}

function claudeSessionFiles() {
  return [...walk(CLAUDE_PROJECTS(), /\.jsonl$/)];
}

function parseClaudeFile(filePath, { full = false } = {}) {
  if (!fs.existsSync(filePath)) return null;
  const id = path.basename(filePath, '.jsonl');
  const parsed = claudeMessagesFrom(filePath, { full });
  let stat;
  try { stat = fs.statSync(filePath); } catch { stat = null; }

  return {
    id,
    source: 'claude',
    title: parsed.title || `claude ${id.slice(0, 12)}`,
    createdAt: parsed.createdAt || (stat ? stat.birthtime.toISOString() : null),
    // 列表模式只读了文件头，里面的最后一条时间不是会话的最后活动时间，
    // 拿它排序会把长会话排到很后面。列表用 mtime，载入时才用真实末条时间。
    updatedAt: (full ? parsed.updatedAt : null) || (stat ? stat.mtime.toISOString() : parsed.updatedAt),
    cwd: parsed.cwd,
    model: parsed.model,
    path: filePath,
    // 列表模式只读了文件头，条数是下限；载入时才是准数。
    count: parsed.messages.length,
    messages: parsed.messages,
  };
}

const claude = {
  id: 'claude',
  label: 'Claude',
  list() {
    const sessions = [];
    for (const file of claudeSessionFiles()) {
      const session = parseClaudeFile(file, { full: false });
      if (session && session.count) sessions.push(session);
    }
    return sortByUpdated(sessions);
  },
  load(id) {
    const file = claudeSessionFiles().find((f) => path.basename(f, '.jsonl') === id);
    if (!file) return null;
    return finalize(parseClaudeFile(file, { full: true }), { full: true });
  },
};

// ---------- opencode（SQLite） ----------

function sqliteJson(dbPath, sql) {
  try {
    const out = execFileSync('sqlite3', ['-json', dbPath, sql], { maxBuffer: 512 * 1024 * 1024 });
    const text = out.toString('utf8').trim();
    return text ? JSON.parse(text) : [];
  } catch {
    return [];
  }
}

function sqliteQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

const opencode = {
  id: 'opencode',
  label: 'OpenCode',
  dbPath: () => path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db'),
  list() {
    const rows = sqliteJson(
      this.dbPath(),
      'SELECT id, title, directory, time_created, time_updated FROM session ORDER BY time_updated DESC',
    );
    return rows.map((r) => ({
      id: r.id,
      source: 'opencode',
      title: makeTitle(r.title) || `OpenCode ${String(r.id).slice(4, 12)}`,
      createdAt: isoFromMs(r.time_created),
      updatedAt: isoFromMs(r.time_updated),
      cwd: r.directory || '',
      model: '',
      path: this.dbPath(),
      count: 0,
      messages: [],
    }));
  },
  load(id) {
    if (!/^ses_[A-Za-z0-9]+$/.test(id)) return null;
    const msgRows = sqliteJson(
      this.dbPath(),
      `SELECT id, data FROM message WHERE session_id = ${sqliteQuote(id)} ORDER BY time_created`,
    );
    const partRows = sqliteJson(
      this.dbPath(),
      `SELECT message_id, data FROM part WHERE session_id = ${sqliteQuote(id)} ORDER BY time_created`,
    );
    const partsByMsg = new Map();
    for (const p of partRows) {
      if (!partsByMsg.has(p.message_id)) partsByMsg.set(p.message_id, []);
      partsByMsg.get(p.message_id).push(p.data);
    }
    const messages = [];
    let model = '';
    for (const row of msgRows) {
      let meta;
      try {
        meta = JSON.parse(row.data);
      } catch {
        continue;
      }
      const role = meta.role;
      if (!['user', 'assistant'].includes(role)) continue;
      const texts = [];
      for (const pdata of partsByMsg.get(row.id) || []) {
        let part;
        try {
          part = JSON.parse(pdata);
        } catch {
          continue;
        }
        if (part.type === 'text' && part.text) texts.push(part.text);
      }
      const content = texts.join('\n').trim();
      if (!content) continue;
      if (meta.modelID) model = `${meta.providerID || ''}/${meta.modelID}`.replace(/^\//, '');
      messages.push({ role, content, createdAt: isoFromMs(meta.time?.created) });
    }
    const meta = this.list().find((s) => s.id === id);
    return {
      id,
      source: 'opencode',
      title: meta?.title || `OpenCode ${id.slice(4, 12)}`,
      createdAt: meta?.createdAt || messages[0]?.createdAt || null,
      updatedAt: meta?.updatedAt || messages[messages.length - 1]?.createdAt || null,
      cwd: meta?.cwd || '',
      model,
      path: this.dbPath(),
      count: messages.length,
      messages,
    };
  },
};

// ---------- omp ----------

function parseOmpFile(filePath, { full = false } = {}) {
  const session = {
    id: path.basename(filePath, '.jsonl'),
    source: 'omp',
    title: '',
    createdAt: null,
    updatedAt: null,
    cwd: '',
    model: '',
    path: filePath,
    count: 0,
    messages: [],
  };
  for (const line of readLines(filePath)) {
    const record = parseJsonLine(line);
    if (!record) continue;
    const ts = record.timestamp || record.updatedAt || null;
    if (record.type === 'title') {
      if (record.title) session.title = makeTitle(record.title);
      if (record.updatedAt) session.updatedAt = record.updatedAt;
      continue;
    }
    if (record.type === 'session') {
      if (record.id) session.id = record.id;
      if (record.timestamp) session.createdAt = record.timestamp;
      if (record.cwd) session.cwd = record.cwd;
      continue;
    }
    if (record.type === 'model_change' && record.model) {
      session.model = record.model;
      continue;
    }
    if (record.type === 'message' && record.message && typeof record.message === 'object') {
      const msg = record.message;
      const role = msg.role === 'user' ? 'user' : msg.role === 'assistant' ? 'assistant' : null;
      if (!role) continue;
      const content = extractText((msg.content || []).filter((c) => c && c.type === 'text'));
      if (!content) continue;
      session.count += 1;
      if (role === 'user' && !session.title) session.title = makeTitle(content);
      if (full) session.messages.push({ role, content, createdAt: ts, model: msg.model || undefined });
      if (ts && (!session.updatedAt || ts > session.updatedAt)) session.updatedAt = ts;
    }
  }
  session.updatedAt = session.updatedAt || session.createdAt;
  return finalize(session, { full });
}

const omp = {
  id: 'omp',
  label: 'OMP',
  *files() {
    yield* walk(path.join(os.homedir(), '.omp', 'agent', 'sessions'), /\.jsonl$/);
  },
  list() {
    const out = [];
    for (const f of this.files()) {
      const s = parseOmpFile(f, { full: false });
      if (s) out.push(s);
    }
    return sortByUpdated(out);
  },
  load(id) {
    for (const f of this.files()) {
      if (f.includes(id)) return parseOmpFile(f, { full: true });
    }
    return null;
  },
};

// ---------- dsh（zstd 压缩 JSONL） ----------

function parseDshFile(filePath, { full = false } = {}) {
  const session = {
    id: path.basename(path.dirname(filePath)),
    source: 'dsh',
    title: '',
    createdAt: null,
    updatedAt: null,
    cwd: '',
    model: '',
    path: filePath,
    count: 0,
    messages: [],
  };
  for (const line of readZstdLines(filePath)) {
    const record = parseJsonLine(line);
    if (!record) continue;
    const ts = isoFromMs(record.time);
    if (record.type === 'session') {
      if (record.id) session.id = record.id;
      if (record.createdAt) session.createdAt = isoFromMs(record.createdAt);
      if (record.cwd) session.cwd = record.cwd;
      continue;
    }
    if (record.type === 'session/title' && record.data?.title) {
      session.title = makeTitle(record.data.title);
      continue;
    }
    if (record.type === 'user/message' && record.data) {
      const content = extractText(record.data.content);
      if (!content || looksInjected(content)) continue;
      session.count += 1;
      if (!session.title) session.title = makeTitle(content);
      if (full) session.messages.push({ role: 'user', content, createdAt: ts });
    } else if (record.type === 'assistant/message' && record.data?.message) {
      const msg = record.data.message;
      const content = extractText((msg.content || []).filter((c) => c && c.type === 'text'));
      if (!content) continue;
      if (msg.source?.model) session.model = msg.source.model;
      session.count += 1;
      if (full) session.messages.push({ role: 'assistant', content, createdAt: ts, model: msg.source?.model });
    }
    if (ts && (!session.updatedAt || ts > session.updatedAt)) session.updatedAt = ts;
  }
  session.updatedAt = session.updatedAt || session.createdAt;
  return finalize(session, { full });
}

const dsh = {
  id: 'dsh',
  label: 'DSH',
  *files() {
    yield* walk(path.join(os.homedir(), '.dsh', 'sessions'), /^session\.jsonl\.zstd$/);
  },
  list() {
    const out = [];
    for (const f of this.files()) {
      const s = parseDshFile(f, { full: false });
      if (s) out.push(s);
    }
    return sortByUpdated(out);
  },
  load(id) {
    for (const f of this.files()) {
      if (f.includes(id)) return parseDshFile(f, { full: true });
    }
    return null;
  },
};

// ---------- qwen ----------

function parseQwenFile(filePath, { full = false } = {}) {
  const session = {
    id: path.basename(filePath, '.jsonl'),
    source: 'qwen',
    title: '',
    createdAt: null,
    updatedAt: null,
    cwd: '',
    model: '',
    path: filePath,
    count: 0,
    messages: [],
  };
  for (const line of readLines(filePath)) {
    const record = parseJsonLine(line);
    if (!record) continue;
    const ts = record.timestamp || null;
    if (record.sessionId) session.id = record.sessionId;
    if (record.cwd) session.cwd = record.cwd;
    const msg = record.message;
    if (!msg || typeof msg !== 'object') continue;
    const role = msg.role === 'user' && record.type === 'user'
      ? 'user'
      : msg.role === 'assistant' || record.type === 'assistant'
        ? 'assistant'
        : null;
    if (!role) continue;
    const content = extractText(msg.parts);
    if (!content) continue;
    session.count += 1;
    if (role === 'user' && !session.title) session.title = makeTitle(content);
    if (full) session.messages.push({ role, content, createdAt: ts, model: msg.model || undefined });
    if (ts && (!session.updatedAt || ts > session.updatedAt)) session.updatedAt = ts;
  }
  session.createdAt = session.createdAt || session.updatedAt;
  session.updatedAt = session.updatedAt || session.createdAt;
  return finalize(session, { full });
}

const qwen = {
  id: 'qwen',
  label: 'Qwen',
  *files() {
    yield* walk(path.join(os.homedir(), '.qwen', 'projects'), /\.jsonl$/);
  },
  list() {
    const out = [];
    for (const f of this.files()) {
      const s = parseQwenFile(f, { full: false });
      if (s) out.push(s);
    }
    return sortByUpdated(out);
  },
  load(id) {
    for (const f of this.files()) {
      if (f.includes(id)) return parseQwenFile(f, { full: true });
    }
    return null;
  },
};

// ---------- gemini（$set 补丁式 JSONL） ----------

function parseGeminiFile(filePath, { full = false } = {}) {
  const session = {
    id: path.basename(filePath, '.jsonl'),
    source: 'gemini',
    title: '',
    createdAt: null,
    updatedAt: null,
    cwd: '',
    model: '',
    path: filePath,
    count: 0,
    messages: [],
  };
  const pushMessage = (m) => {
    const role = m.type === 'user' ? 'user' : m.type === 'model' || m.type === 'assistant' ? 'assistant' : null;
    if (!role) return;
    const content = extractText(m.content);
    if (!content || looksInjected(content)) return;
    const ts = m.timestamp || null;
    session.count += 1;
    if (role === 'user' && !session.title) session.title = makeTitle(content);
    if (full) session.messages.push({ role, content, createdAt: ts });
    if (ts && (!session.updatedAt || ts > session.updatedAt)) session.updatedAt = ts;
  };
  for (const line of readLines(filePath)) {
    const record = parseJsonLine(line);
    if (!record) continue;
    if (record.sessionId) session.id = record.sessionId;
    if (record.startTime) session.createdAt = record.startTime;
    if (record.lastUpdated) session.updatedAt = record.lastUpdated;
    if (record.$set?.messages) for (const m of record.$set.messages) pushMessage(m);
    if (record.$push?.messages) for (const m of record.$push.messages) pushMessage(m);
    if (record.type && record.content !== undefined) pushMessage(record);
  }
  return finalize(session, { full });
}

const gemini = {
  id: 'gemini',
  label: 'Gemini',
  *files() {
    yield* walk(path.join(os.homedir(), '.gemini', 'tmp'), /\.jsonl$/);
  },
  list() {
    const out = [];
    for (const f of this.files()) {
      const s = parseGeminiFile(f, { full: false });
      if (s) out.push(s);
    }
    return sortByUpdated(out);
  },
  load(id) {
    for (const f of this.files()) {
      if (f.includes(id)) return parseGeminiFile(f, { full: true });
    }
    for (const f of filesWithIdInHead(this.files(), id)) {
      return parseGeminiFile(f, { full: true });
    }
    return null;
  },
};

// ---------- 汇总入口 ----------

const SOURCES = { codex, claude, opencode, omp, dsh, qwen, gemini };

function listSessions(source) {
  const adapter = SOURCES[source];
  if (!adapter) return [];
  return adapter.list().map((s) => ({
    id: s.id,
    source: s.source,
    title: s.title,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    cwd: s.cwd,
    model: s.model,
    path: s.path,
    count: s.count,
  }));
}

function loadSession(source, id, { previewOnly = true } = {}) {
  const adapter = SOURCES[source];
  if (!adapter) return null;
  const session = adapter.load(id);
  if (!session) return null;
  const total = session.messages.length;
  return {
    ...session,
    totalMessages: total,
    truncated: previewOnly && total > PREVIEW_LIMIT,
    messages: previewOnly ? session.messages.slice(0, PREVIEW_LIMIT) : session.messages,
  };
}

function loadFullSessions(source, ids) {
  const out = [];
  for (const id of ids) {
    const s = loadSession(source, id, { previewOnly: false });
    if (s) out.push(s);
  }
  return out;
}

// ---------- 导出格式 ----------

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('zh-CN', { hour12: false });
}

function toJSON(session) {
  return JSON.stringify(
    {
      session_id: session.id,
      source: session.source,
      title: session.title,
      created_at: session.createdAt,
      updated_at: session.updatedAt,
      cwd: session.cwd,
      model: session.model,
      note: session.note || undefined,
      messages: session.messages,
    },
    null,
    2,
  );
}

function toMarkdown(session) {
  const lines = [`# ${session.title || '未命名会话'}`, ''];
  lines.push(`- **来源**: ${SOURCES[session.source]?.label || session.source}`);
  lines.push(`- **会话 ID**: \`${session.id}\``);
  if (session.model) lines.push(`- **模型**: ${session.model}`);
  if (session.createdAt) lines.push(`- **创建时间**: ${fmtTime(session.createdAt)}`);
  if (session.cwd) lines.push(`- **工作目录**: \`${session.cwd}\``);
  if (session.note) lines.push(`- **说明**: ${session.note}`);
  lines.push('', '---', '');
  for (const m of session.messages) {
    lines.push(`## ${m.role === 'user' ? 'User' : m.role === 'assistant' ? 'Assistant' : m.role}`);
    if (m.createdAt) lines.push(`*${fmtTime(m.createdAt)}*`);
    lines.push('', m.content, '', '---', '');
  }
  return lines.join('\n');
}

function toText(session) {
  const lines = [`[${session.source}] ${session.title || '未命名会话'}`, `会话 ID: ${session.id}`, ''];
  for (const m of session.messages) {
    lines.push(`[${fmtTime(m.createdAt)}] ${m.role.toUpperCase()}`, m.content, '');
  }
  return lines.join('\n');
}

function toHTML(session) {
  const msgs = session.messages
    .map((m) => {
      const roleClass = m.role === 'user' ? 'user' : m.role === 'assistant' ? 'assistant' : 'other';
      return (
        `<div class="msg ${roleClass}"><div class="meta"><span class="role">${esc(m.role)}</span>` +
        `<span class="time">${esc(fmtTime(m.createdAt))}</span></div>` +
        `<div class="content">${esc(m.content)}</div></div>`
      );
    })
    .join('');
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>${esc(session.title || '会话')}</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;max-width:800px;margin:40px auto;padding:0 20px;background:#f7f7f8;color:#1a1a1a}
h1{font-size:1.4rem;border-bottom:1px solid #e5e5e5;padding-bottom:10px}
.meta-info{color:#666;font-size:.9rem;margin-bottom:20px}
.msg{margin:16px 0;padding:14px 18px;border-radius:12px;line-height:1.6}
.user{background:#e7f3ff}.assistant{background:#fff;border:1px solid #e5e5e5}.other{background:#f0f0f0;color:#555}
.meta{font-size:.78rem;color:#888;margin-bottom:6px;display:flex;justify-content:space-between}
.role{font-weight:600;text-transform:capitalize}
.content{white-space:pre-wrap;word-break:break-word}
</style></head><body>
<h1>${esc(session.title || '未命名会话')}</h1>
<div class="meta-info">
<p>来源: ${esc(SOURCES[session.source]?.label || session.source)} | 会话 ID: <code>${esc(session.id)}</code>${session.model ? ` | 模型: ${esc(session.model)}` : ''}</p>
${session.note ? `<p>说明: ${esc(session.note)}</p>` : ''}
</div>
${msgs}
</body></html>`;
}

const EXPORTERS = {
  md: { ext: 'md', build: toMarkdown, label: 'Markdown' },
  json: { ext: 'json', build: toJSON, label: 'JSON' },
  html: { ext: 'html', build: toHTML, label: 'HTML' },
  txt: { ext: 'txt', build: toText, label: '纯文本' },
};

function buildTransferPackage(sessions, note = '') {
  return JSON.stringify(
    {
      version: '1.0',
      kind: 'ai-chat-transfer',
      note,
      created_at: new Date().toISOString(),
      sessions: sessions.map((s) => ({
        session_id: s.id,
        source: s.source,
        title: s.title,
        created_at: s.createdAt,
        updated_at: s.updatedAt,
        cwd: s.cwd,
        model: s.model,
        messages: s.messages,
      })),
    },
    null,
    2,
  );
}

module.exports = {
  PREVIEW_LIMIT,
  SOURCES: Object.fromEntries(Object.entries(SOURCES).map(([id, a]) => [id, a.label])),
  listSessions,
  loadSession,
  loadFullSessions,
  EXPORTERS,
  buildTransferPackage,
};
