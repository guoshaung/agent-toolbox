'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { TRACKS, validateCode } = require('../src/main/practice-runner');

test('项目挑战库：结构完整、轨道有效且代码不触发沙箱高风险拦截', async () => {
  const { PRACTICE_PROJECTS } = await import('../src/renderer/tools/study/data/projects.js');
  const ids = new Set();

  // 写死数量的话，每加一道题都要回来改一次数字，改着改着就只剩「改数字」
  // 这个动作本身、没人再看下面那些真正的检查了。这里只守住下限。
  assert.ok(PRACTICE_PROJECTS.length >= 10, `题库只剩 ${PRACTICE_PROJECTS.length} 道`);
  for (const project of PRACTICE_PROJECTS) {
    assert.ok(project.id && !ids.has(project.id), `项目 id 重复：${project.id}`);
    ids.add(project.id);
    assert.ok(TRACKS[project.trackId], `${project.id} 使用了未登记轨道`);
    assert.ok(project.summary && project.objective);
    assert.ok(project.skills.length >= 3);
    assert.ok(project.steps.length >= project.cells.length);
    assert.ok(project.cells.length >= 3);
    for (const cell of project.cells) {
      assert.ok(cell.title && cell.purpose && cell.code.trim(), `${project.id} 有不完整单元格`);
      assert.equal(validateCode(project.trackId, cell.code), '', `${project.id}/${cell.title} 被安全规则拦截`);
    }
  }
});
