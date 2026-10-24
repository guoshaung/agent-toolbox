'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { toggleBundle, botEnabled, setBundleEnabled, readProfileBundles, BOT_BUNDLE, SEED_PLUGINS } = require('../src/main/dsh-service');

const tmpHome = () => fs.mkdtempSync(path.join(os.tmpdir(), 'botsw-'));
const writeProfile = (home, bundles) => {
  const dir = path.join(home, 'profiles', 'web');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'web', dependencies: { x: '1' }, dsh: { profile: { bundles } } }, null, 2) + '\n');
};

test('ds-bot 不再是种子完整性标志——关掉它不会触发「种子还原」', () => {
  assert.ok(!SEED_PLUGINS.includes(BOT_BUNDLE), 'SEED_PLUGINS 不能含 ds-bot');
  assert.deepEqual(SEED_PLUGINS, ['dsh-our-free-model', '@dhicoc/dsh-reverse-skill']);
});

test('toggleBundle：开→末尾追加且去重，关→过滤掉，其余顺序不变，幂等', () => {
  assert.deepEqual(toggleBundle(['a', 'b'], 'ds-bot', true), ['a', 'b', 'ds-bot']);
  assert.deepEqual(toggleBundle(['a', 'ds-bot', 'b'], 'ds-bot', true), ['a', 'b', 'ds-bot'], '已在也只留一个、挪到末尾');
  assert.deepEqual(toggleBundle(['a', 'ds-bot', 'b'], 'ds-bot', false), ['a', 'b']);
  assert.deepEqual(toggleBundle(['a', 'b'], 'ds-bot', false), ['a', 'b'], '本来就没有，关是幂等');
  assert.deepEqual(toggleBundle(undefined, 'ds-bot', true), ['ds-bot']);
});

test('botEnabled / readProfileBundles：读 profile 判断开关；读不到按关处理，不抛', () => {
  const home = tmpHome();
  assert.equal(botEnabled(home), false, '没 profile 时按关');
  assert.deepEqual(readProfileBundles(home), []);
  writeProfile(home, ['@deepseek-ai/dsh-base', 'ds-bot']);
  assert.equal(botEnabled(home), true);
  writeProfile(home, ['@deepseek-ai/dsh-base']);
  assert.equal(botEnabled(home), false);
  fs.rmSync(home, { recursive: true, force: true });
});

test('setBundleEnabled：原子写回 package.json，保留其余字段，来回切可逆', () => {
  const home = tmpHome();
  writeProfile(home, ['@deepseek-ai/dsh-base', 'ds-bot', 'dsh-themes']);
  assert.equal(setBundleEnabled('ds-bot', false, home), false);
  let data = JSON.parse(fs.readFileSync(path.join(home, 'profiles', 'web', 'package.json'), 'utf8'));
  assert.deepEqual(data.dsh.profile.bundles, ['@deepseek-ai/dsh-base', 'dsh-themes'], 'ds-bot 被移除，其余不动');
  assert.deepEqual(data.dependencies, { x: '1' }, '其它字段原样保留');
  assert.equal(setBundleEnabled('ds-bot', true, home), true);
  data = JSON.parse(fs.readFileSync(path.join(home, 'profiles', 'web', 'package.json'), 'utf8'));
  assert.deepEqual(data.dsh.profile.bundles, ['@deepseek-ai/dsh-base', 'dsh-themes', 'ds-bot'], '开回来追加到末尾');
  assert.equal(fs.readdirSync(path.join(home, 'profiles', 'web')).filter((n) => n.includes('.tmp-')).length, 0, '临时文件要清掉');
  fs.rmSync(home, { recursive: true, force: true });
});
