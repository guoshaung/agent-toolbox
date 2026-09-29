const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

/**
 * 守门：渲染层的 ES 模块图里，每个相对 import 都必须指向仓库里「已提交」的文件。
 *
 * 为什么要有它：89a7c1c 把工作区里一个没提交的 tools/game/index.js 的 import 带进了 app.js，
 * 本地跑没事（文件在工作区里），CI 打出来的包 app.js 整个加载失败，主窗口一片空白，
 * 连发了七个版本才被发现。这里读的是 HEAD 里的内容（不是工作区），所以检查的就是会被打包的那份。
 */
const ROOT = path.resolve(__dirname, '..');
const ENTRIES = ['src/renderer/app.js', 'src/renderer/core/registry.js'];

function git(args) {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  return r.status === 0 ? r.stdout : null;
}
const tracked = new Set((git(['ls-files', '-z', 'src']) || '').split('\0').filter(Boolean));
const haveGit = tracked.size > 0;
const readCommitted = (rel) => (haveGit ? git(['show', `HEAD:${rel}`]) : fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const exists = (rel) => (haveGit ? tracked.has(rel) : fs.existsSync(path.join(ROOT, rel)));

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s[^'";]*?\sfrom\s*['"](\.{1,2}\/[^'"]+)['"]|(?:^|\n)\s*import\s*['"](\.{1,2}\/[^'"]+)['"]/g;

test('渲染层：HEAD 里 app.js / registry.js 的整张相对 import 图都能解析到已提交文件', { skip: !haveGit && '不在 git 仓库里' }, () => {
  const seen = new Set(); const missing = []; const queue = [...ENTRIES];
  while (queue.length) {
    const rel = queue.shift();
    if (seen.has(rel)) continue; seen.add(rel);
    // 相对路径指进 node_modules 的（katex 之类）：它们打包时会带上但不进 git，只看磁盘上有没有，不往里走
    if (rel.startsWith('node_modules/')) { if (!fs.existsSync(path.join(ROOT, rel))) missing.push(rel); continue; }
    if (!exists(rel)) { missing.push(rel); continue; }
    const src = readCommitted(rel); if (src == null) { missing.push(rel); continue; }
    for (const m of src.matchAll(IMPORT_RE)) {
      const spec = m[1] || m[2]; if (!spec) continue;
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec));
      if (!seen.has(target)) queue.push(target);
    }
  }
  assert.ok(seen.size > 30, `import 图太小（${seen.size}），正则可能没匹配到东西`);
  assert.deepEqual(missing, [], `这些被 import 的文件不在仓库里（多半是别的会话没提交的模块被 import 进来了）：\n${missing.join('\n')}`);
});
