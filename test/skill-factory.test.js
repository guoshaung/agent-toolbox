'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildSkillMarkdown, listSkills, parseFrontmatter, sanitizeSkillName, writeSkill,
} = require('../src/main/skill-factory');

test('Skill 名称只接受规范的小写 slug', () => {
  assert.equal(sanitizeSkillName('  paper-review '), 'paper-review');
  assert.throws(() => sanitizeSkillName('论文评审'), /小写字母/);
  assert.throws(() => sanitizeSkillName('../unsafe'), /小写字母/);
});

test('生成规范 frontmatter，并保留正文结构', () => {
  const markdown = buildSkillMarkdown({
    name: 'paper-review',
    description: '审阅论文；用户要求看论文时使用。',
    body: '# 重复标题\n\n## Instructions\n\n1. 检查证据。',
  });
  assert.equal(parseFrontmatter(markdown).name, 'paper-review');
  assert.match(markdown, /disable-model-invocation: true/);
  assert.equal((markdown.match(/^# /gm) || []).length, 1);
  assert.match(markdown, /1\. 检查证据/);
});

test('写入 Skill 时保护已有文件，并可扫描读取', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-toolbox-skill-'));
  try {
    const skillRoot = path.join(tempDir, '.cursor', 'skills');
    const first = writeSkill({
      directory: skillRoot,
      name: 'daily-review',
      description: '整理每日工作；用户要求复盘时使用。',
      content: '## Instructions\n\n1. 汇总。',
    });
    assert.equal(first.ok, true);
    const blocked = writeSkill({
      directory: skillRoot,
      name: 'daily-review',
      description: '新的描述',
      content: '新的内容',
    });
    assert.equal(blocked.code, 'exists');
    const records = listSkills({ homeDir: tempDir, projectDir: tempDir });
    assert.equal(records.some((record) => record.name === 'daily-review'), true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('writeSkill：raw 原样写入，附属文件一起落盘，路径不许往上爬', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-fav-'));
  const md = '---\nname: teach\ndescription: x\n---\n\nbody';
  const r = writeSkill({ directory: dir, name: 'teach', description: 'x', content: md, raw: true, files: { 'MISSION-FORMAT.md': '# m', 'agents/openai.yaml': 'a: 1' } });
  assert.equal(r.ok, true);
  assert.equal(fs.readFileSync(path.join(dir, 'teach', 'SKILL.md'), 'utf8'), md);
  assert.equal(fs.readFileSync(path.join(dir, 'teach', 'agents', 'openai.yaml'), 'utf8'), 'a: 1');
  assert.deepEqual(r.extras.sort(), ['MISSION-FORMAT.md', 'agents/openai.yaml']);
  assert.throws(() => writeSkill({ directory: dir, name: 'evil', description: 'x', content: md, raw: true, overwrite: true, files: { '../escape.md': 'x' } }), /不合法/);
  assert.throws(() => writeSkill({ directory: dir, name: 'noraw', description: 'x', content: 'no frontmatter', raw: true }), /frontmatter/);
});
