'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SKILL_FILE = 'SKILL.md';
const MAX_SKILL_BYTES = 512 * 1024;

function skillRoots({ homeDir = os.homedir(), projectDir = process.cwd() } = {}) {
  return [
    { id: 'project-cursor', label: '当前项目 · .cursor/skills', path: path.join(projectDir, '.cursor', 'skills') },
    { id: 'project-agents', label: '当前项目 · .agents/skills', path: path.join(projectDir, '.agents', 'skills') },
    { id: 'personal-cursor', label: '个人目录 · ~/.cursor/skills', path: path.join(homeDir, '.cursor', 'skills') },
    { id: 'personal-agents', label: '个人目录 · ~/.agents/skills', path: path.join(homeDir, '.agents', 'skills') },
    { id: 'personal-codex', label: '个人目录 · ~/.codex/skills', path: path.join(homeDir, '.codex', 'skills') },
  ];
}

function sanitizeSkillName(value) {
  const name = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || name.length > 64) {
    throw new Error('Skill 名称只能使用小写字母、数字和连字符，长度不超过 64 个字符。');
  }
  return name;
}

function yamlText(value) {
  return JSON.stringify(String(value || '').trim().replace(/\s+/g, ' '));
}

function titleFromName(name) {
  return name.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

function stripFrontmatter(markdown) {
  const text = String(markdown || '').trim();
  return text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim();
}

function buildSkillMarkdown({ name, description, body = '' }) {
  const safeName = sanitizeSkillName(name);
  const safeDescription = String(description || '').trim();
  if (!safeDescription) throw new Error('Skill 描述不能为空。');
  const cleanBody = stripFrontmatter(body);
  const content = cleanBody || '## Instructions\n\nDescribe the workflow step by step.\n';
  const heading = /^#\s+/.test(content) ? '' : `# ${titleFromName(safeName)}\n\n`;
  return [
    '---',
    `name: ${safeName}`,
    `description: ${yamlText(safeDescription)}`,
    'disable-model-invocation: true',
    '---',
    '',
    heading.trimEnd(),
    heading ? '' : undefined,
    content,
    '',
  ].filter((line) => line !== undefined).join('\n');
}

function parseFrontmatter(markdown) {
  const match = String(markdown || '').match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const fields = {};
  if (!match) return fields;
  for (const line of match[1].split(/\r?\n/)) {
    const field = line.match(/^([a-z][a-z0-9-]*):\s*(.*)$/i);
    if (!field) continue;
    fields[field[1]] = field[2].replace(/^['"]|['"]$/g, '').trim();
  }
  return fields;
}

function listSkills(options = {}) {
  const roots = skillRoots(options);
  const results = [];
  const seen = new Set();
  for (const root of roots) {
    let entries;
    try { entries = fs.readdirSync(root.path, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const filePath = path.join(root.path, entry.name, SKILL_FILE);
      if (seen.has(filePath)) continue;
      try {
        const stat = fs.statSync(filePath);
        const content = fs.readFileSync(filePath, 'utf8');
        const meta = parseFrontmatter(content);
        results.push({
          name: meta.name || entry.name,
          description: meta.description || '没有描述',
          path: filePath,
          scope: root.label,
          updatedAt: stat.mtimeMs,
          bytes: stat.size,
        });
        seen.add(filePath);
      } catch { /* 单个 Skill 损坏不影响其他条目 */ }
    }
  }
  return results.sort((a, b) => b.updatedAt - a.updatedAt);
}

function readSkill(filePath) {
  if (typeof filePath !== 'string' || path.basename(filePath) !== SKILL_FILE) {
    throw new Error('只能读取 SKILL.md。');
  }
  const stat = fs.statSync(filePath);
  if (stat.size > MAX_SKILL_BYTES) throw new Error('SKILL.md 超过 512KB，暂不加载。');
  return fs.readFileSync(filePath, 'utf8');
}

function writeSkill({ directory, name, description, content, overwrite = false }) {
  if (typeof directory !== 'string' || !directory.trim()) throw new Error('请先选择 Skill 输出目录。');
  const safeName = sanitizeSkillName(name);
  const targetDir = path.resolve(directory, safeName);
  const targetPath = path.join(targetDir, SKILL_FILE);
  if (fs.existsSync(targetPath) && !overwrite) return { ok: false, code: 'exists', path: targetPath };
  const markdown = buildSkillMarkdown({ name: safeName, description, body: content });
  if (Buffer.byteLength(markdown, 'utf8') > MAX_SKILL_BYTES) throw new Error('Skill 内容超过 512KB。');
  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(targetPath, markdown, 'utf8');
  return { ok: true, path: targetPath, name: safeName, bytes: Buffer.byteLength(markdown, 'utf8') };
}

module.exports = {
  SKILL_FILE,
  buildSkillMarkdown,
  listSkills,
  parseFrontmatter,
  readSkill,
  sanitizeSkillName,
  skillRoots,
  writeSkill,
};
