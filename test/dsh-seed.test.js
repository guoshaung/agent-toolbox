'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SEED_PLUGINS, seedTgzPath, webProfileNeedsSeed, seedWebProfile } = require('../src/main/dsh-service');

const REAL_SEED = path.join(__dirname, '..', 'dsh-seed', 'dsh-web-profile.tgz');
const tmpHome = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dshseed-'));
const writeProfile = (home, bundles) => {
  const dir = path.join(home, 'profiles', 'web');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ dsh: { profile: { bundles } } }));
};

test('DSH 种子：没有 profile / 解析不了 / 缺任一内置插件 都判定要种；配齐了就不动', () => {
  const home = tmpHome();
  assert.deepEqual(webProfileNeedsSeed(home), { needed: true, reason: 'no-profile' });
  writeProfile(home, ['@deepseek-ai/dsh-base']);
  assert.deepEqual(webProfileNeedsSeed(home), { needed: true, reason: `missing:${SEED_PLUGINS.join(',')}` });
  writeProfile(home, ['@deepseek-ai/dsh-base', 'ds-bot']);
  assert.deepEqual(webProfileNeedsSeed(home), { needed: true, reason: `missing:${SEED_PLUGINS.filter((n) => n !== 'ds-bot').join(',')}` });
  // 0.46.9 种出来的 profile（有免费模型 + ds-bot、没逆向包）升级后要判成「缺」，才会补种
  writeProfile(home, ['@deepseek-ai/dsh-base', 'dsh-our-free-model', 'ds-bot']);
  assert.deepEqual(webProfileNeedsSeed(home), { needed: true, reason: 'missing:@dhicoc/dsh-reverse-skill' });
  writeProfile(home, ['@deepseek-ai/dsh-base', ...SEED_PLUGINS]);
  assert.deepEqual(webProfileNeedsSeed(home), { needed: false, reason: 'complete' });
  fs.writeFileSync(path.join(home, 'profiles', 'web', 'package.json'), '{not json');
  assert.deepEqual(webProfileNeedsSeed(home), { needed: true, reason: 'bad-profile' });
  fs.rmSync(home, { recursive: true, force: true });
});

test('DSH 种子：种子包不存在时什么都不做、不建目录、也不报错', () => {
  const home = tmpHome();
  assert.deepEqual(seedWebProfile(path.join(home, 'nope.tgz'), home), { ok: false, seeded: false, reason: 'no-seed' });
  assert.equal(fs.existsSync(path.join(home, 'profiles')), false);
  fs.rmSync(home, { recursive: true, force: true });
});

test('DSH 种子：仓库自带的真种子包能解到任意 DSH_HOME，插件齐、全树无软链（Windows 可用）、不带登录态；再调一次幂等', () => {
  assert.ok(fs.existsSync(REAL_SEED), 'dsh-seed/dsh-web-profile.tgz 必须随仓库提交');
  const home = tmpHome();
  const first = seedWebProfile(REAL_SEED, home);
  assert.equal(first.ok, true, `种子没解开：${first.reason}`);
  assert.equal(first.seeded, true);
  assert.equal(first.reason, 'no-profile');
  assert.equal(first.backup, '');
  const web = path.join(home, 'profiles', 'web');
  const pkg = JSON.parse(fs.readFileSync(path.join(web, 'package.json'), 'utf8'));
  for (const name of SEED_PLUGINS) assert.ok(pkg.dsh.profile.bundles.includes(name), `bundles 里要有 ${name}`);
  // 免费模型插件不在 npm 上：node_modules 里放的是真目录（不是软链——Windows 上 tar 解出的软链一 stat 就 EPERM，CI 栽过），
  // plugins/ 下另留一份给 package.json 里的 link: 依赖用；那条 link: 必须是相对路径，换机器 pnpm 才解析得了
  const plugin = path.join(web, 'node_modules', 'dsh-our-free-model');
  assert.ok(fs.lstatSync(plugin).isDirectory(), '应是真目录，不是软链');
  assert.ok(fs.existsSync(path.join(plugin, 'index.js')), '插件代码要在');
  assert.ok(fs.existsSync(path.join(home, 'plugins', 'dsh-our-free-model', 'index.js')), 'plugins/ 下的那份也要在');
  assert.equal(pkg.dependencies['dsh-our-free-model'], 'link:../../plugins/dsh-our-free-model', 'link: 依赖必须是相对路径');
  assert.ok(fs.existsSync(path.join(web, 'node_modules', 'ds-bot', 'package.json')));
  assert.equal(JSON.parse(fs.readFileSync(path.join(web, 'node_modules', 'ds-bot', 'package.json'), 'utf8')).version, '0.2.1', 'Chief 新会话应使用修复模型路由的 DS Bot 版本');
  assert.equal(fs.existsSync(path.join(web, 'node_modules', '.bin')), false, '.bin 全是软链，Windows 解不出来，不该随种子走');
  // 逆向整合包：从 GitHub 装的真目录，88 个 SKILL.md 随插件走
  const reverse = path.join(web, 'node_modules', '@dhicoc', 'dsh-reverse-skill');
  assert.ok(fs.lstatSync(reverse).isDirectory(), '逆向插件应是真目录');
  assert.ok(fs.existsSync(path.join(reverse, 'cordis.patch.yml')) && fs.existsSync(path.join(reverse, 'lib')), '逆向插件要有 bundle patch 和 lib/');
  const countSkillMd = (dir) => fs.readdirSync(dir, { withFileTypes: true })
    .reduce((n, d) => n + (d.isDirectory() ? countSkillMd(path.join(dir, d.name)) : d.name === 'SKILL.md' ? 1 : 0), 0);
  assert.ok(countSkillMd(reverse) >= 80, `逆向插件 SKILL.md 应 ≥80，实际 ${countSkillMd(reverse)}`);
  // 用户级 skills 根：Superpowers / taste / mattpocock / Anatomy 摊平成 <名字>/SKILL.md，DSH 只认这两层
  const skills = path.join(home, 'skills');
  const skillDirs = fs.readdirSync(skills, { withFileTypes: true }).filter((d) => d.isDirectory());
  assert.ok(skillDirs.length >= 60, `skills/ 应 ≥60 个，实际 ${skillDirs.length}`);
  for (const d of skillDirs) {
    const head = fs.readFileSync(path.join(skills, d.name, 'SKILL.md'), 'utf8').slice(0, 4000);
    const fm = head.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] || '';   // name 可能就在 --- 的下一行，别要求中间有空行
    assert.ok(/^name:/m.test(fm) && /^description:/m.test(fm), `${d.name}/SKILL.md 要有带 name+description 的 frontmatter，否则 DSH 会忽略`);
  }
  for (const must of ['anatomy', 'systematic-debugging', 'test-driven-development', 'taste-skill', 'tdd', 'reverse-engineer-anything']) assert.ok(fs.existsSync(path.join(skills, must, 'SKILL.md')), `应包含 ${must}`);
  // skill-explorer 面板被 web-all 默认关掉，profile patch 里要把它打开，用户才看得见这些 skill
  assert.match(fs.readFileSync(path.join(web, 'cordis.patch.yml'), 'utf8'), /id: web-ui-skill-explorer\n\s+disabled: false/);
  // 整棵树不能有任何软链——Windows 可移植的硬要求
  const symlinks = (dir) => fs.readdirSync(dir, { withFileTypes: true })
    .flatMap((d) => d.isSymbolicLink() ? [path.join(dir, d.name)] : d.isDirectory() ? symlinks(path.join(dir, d.name)) : []);
  assert.deepEqual(symlinks(home), [], '种子解出来的树里不能有软链');
  assert.equal(fs.existsSync(path.join(web, '.plugin-manager')), false, '登录态/运行态不能跟着种子发出去');
  assert.equal(fs.existsSync(path.join(home, '.dsh')), false, 'tgz 里的 .dsh/ 前缀必须被剥掉，不能嵌套出 $DSH_HOME/.dsh');
  assert.deepEqual(seedWebProfile(REAL_SEED, home), { ok: true, seeded: false, reason: 'complete' });
  fs.rmSync(home, { recursive: true, force: true });
});

test('DSH 种子：已有但不完整的 profile 先整个备份再替换，用户原来的东西不丢', () => {
  const home = tmpHome();
  writeProfile(home, ['@deepseek-ai/dsh-base']);
  fs.writeFileSync(path.join(home, 'profiles', 'web', 'user-note.txt'), 'mine');
  const result = seedWebProfile(REAL_SEED, home);
  assert.equal(result.seeded, true, `种子没解开：${result.reason}`);
  assert.match(path.basename(result.backup), /^web\.bak-/);
  assert.equal(fs.readFileSync(path.join(result.backup, 'user-note.txt'), 'utf8'), 'mine');
  assert.equal(webProfileNeedsSeed(home).needed, false);
  fs.rmSync(home, { recursive: true, force: true });
});

test('DSH 种子：种子包路径——开发时在仓库根，打包后在 resources', () => {
  assert.equal(seedTgzPath({ isPackaged: false }), path.join(__dirname, '..', 'dsh-seed', 'dsh-web-profile.tgz'));
  const saved = process.resourcesPath;          // 纯 node 里没有这个属性，Electron 主进程里一定有
  process.resourcesPath = path.join(os.tmpdir(), 'fake-Resources');
  try {
    assert.equal(seedTgzPath({ isPackaged: true }), path.join(os.tmpdir(), 'fake-Resources', 'dsh-seed', 'dsh-web-profile.tgz'));
  } finally {
    if (saved === undefined) delete process.resourcesPath; else process.resourcesPath = saved;
  }
});
