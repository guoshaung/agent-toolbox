const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const model = import('../src/renderer/features/E028/model.mjs');
const config = (extra = {}) => ({ title: '测试故事', players: ['甲', '乙', '丙'], rounds: 2, mode: 'blind', openingId: 'C01', ...extra });
const immediate = { yieldControl: async () => {} };

test('E028: thirty immutable unique original cards and exact discovery metadata', async () => {
  const { OPENINGS } = await model; assert.equal(OPENINGS.length, 30); assert.ok(Object.isFrozen(OPENINGS));
  for (const key of ['id', 'title', 'text']) assert.equal(new Set(OPENINGS.map(card => card[key])).size, 30);
  assert.deepEqual(OPENINGS.map(card => card.id), Array.from({ length: 30 }, (_, i) => 'C' + String(i + 1).padStart(2, '0'))); assert.ok(OPENINGS.every(card => Object.isFrozen(card) && card.text.length < 150));
  const meta = JSON.parse(fs.readFileSync(require.resolve('../src/renderer/features/E028/meta.json'), 'utf8')); assert.deepEqual(Object.keys(meta).sort(), ['category', 'description', 'group', 'id', 'title']); assert.equal(meta.id, 'E028'); assert.equal(meta.category, '娱乐');
});
test('E028: three players two rounds produce exactly six segments in author order', async () => {
  const { createGame, currentTurn, submitTurn, finalReport } = await model; let game = createGame(config());
  for (let i = 0; i < 6; i++) { assert.equal(currentTurn(game).ordinal, i + 1); assert.equal(currentTurn(game).author, ['甲', '乙', '丙'][i % 3]); assert.equal(currentTurn(game).round, Math.floor(i / 3) + 1); assert.equal(currentTurn(game).isLast, i === 5); game = submitTurn(game, `段${i + 1}。`); }
  const report = finalReport(game); assert.equal(report.complete, true); assert.equal(report.submittedSegments, 6); assert.equal(report.plannedSegments, 6); assert.deepEqual(report.segments.map(s => [s.ordinal, s.round, s.author]), [[1, 1, '甲'], [2, 1, '乙'], [3, 1, '丙'], [4, 2, '甲'], [5, 2, '乙'], [6, 2, '丙']]); assert.throws(() => submitTurn(game, '第七段'), /结束/u);
});
test('E028: game snapshots locked settings and does not mutate previous state', async () => {
  const { createGame, submitTurn } = await model, input = config(), original = createGame(input); input.players[0] = '改名'; input.mode = 'full'; input.rounds = 1;
  assert.deepEqual(original.config.players, ['甲', '乙', '丙']); assert.equal(original.config.mode, 'blind'); assert.equal(original.config.rounds, 2); assert.ok(Object.isFrozen(original.config.players));
  const next = submitTurn(original, '一句。'); assert.equal(original.segments.length, 0); assert.equal(next.segments.length, 1); assert.ok(Object.isFrozen(next.segments[0]));
});
test('E028: rejects invalid counts, schema, duplicate NFC names and unknown modes/cards', async () => {
  const { createGame } = await model;
  for (const extra of [{ players: ['甲'] }, { players: Array(9).fill('甲') }, { players: ['甲', '甲'] }, { players: ['é', 'e\u0301'] }, { players: [' 甲', '乙'] }, { players: ['x'.repeat(41), '乙'] }, { players: ['\ud800', '乙'] }, { players: ['\n', '乙'] }, { title: '' }, { title: 'x'.repeat(81) }, { title: '故事 ' }, { title: '\u0000' }, { rounds: 0 }, { rounds: 11 }, { rounds: 1.5 }, { rounds: '2' }, { mode: 'auto' }, { openingId: 'external' }, { extra: true }]) assert.throws(() => createGame(config(extra)));
  assert.equal(createGame(config({ players: ['😀'.repeat(40), '乙'], title: '😀'.repeat(80) })).plannedSegments, 4);
});
test('E028: paragraph trims only edges, preserves internal newline and counts Unicode points', async () => {
  const { createGame, submitTurn, countCharacters } = await model; const next = submitTurn(createGame(config()), ' \n😀甲\n乙\t丙。 \n'); assert.equal(next.segments[0].text, '😀甲\n乙\t丙。'); assert.equal(next.segments[0].characters, 7); assert.equal(countCharacters('😀'), 1);
});
test('E028: single paragraph exact limits, blank/control/broken Unicode rejected without progress', async () => {
  const { createGame, submitTurn } = await model, game = createGame(config()); assert.equal(submitTurn(game, '😀'.repeat(1000)).segments[0].characters, 1000);
  for (const text of ['x'.repeat(1001), '😀'.repeat(1001), ' \n\t', '\u0000x', '\ud800', '\udfff', ' '.repeat(2001)]) assert.throws(() => submitTurn(game, text)); assert.equal(game.segments.length, 0);
});
test('E028: maximum eighty segments and80000 Unicode points fit both bounded complete exports', async () => {
  const { createGame, submitTurn, serializeGame, LIMITS } = await model; let game = createGame(config({ players: Array.from({ length: 8 }, (_, i) => `人${i + 1}`), rounds: 10 }));
  for (let i = 0; i < 80; i++) game = submitTurn(game, '😀'.repeat(1000)); assert.equal(game.status, 'completed'); assert.equal(game.totalCharacters, 80000);
  for (const format of ['json', 'md']) { const output = await serializeGame(game, format, immediate); assert.ok(new TextEncoder().encode(output).length < LIMITS.exportBytes); }
});
test('E028: active story has no final report/export; interrupt needs strict explicit confirmation', async () => {
  const { createGame, submitTurn, interruptGame, finalReport, serializeGame } = await model, empty = createGame(config()), game = submitTurn(empty, '秘密前文。公开末句。');
  assert.throws(() => finalReport(game), /未结束/u); await assert.rejects(serializeGame(game, 'json', immediate), /未结束/u); for (const value of [false, undefined, 'true', 1]) assert.throws(() => interruptGame(game, value), /确认/u);
  const report = finalReport(interruptGame(game, true)); assert.equal(report.complete, false); assert.equal(report.status, 'interrupted'); assert.equal(report.submittedSegments, 1); assert.equal(report.plannedSegments, 6); assert.equal(finalReport(interruptGame(empty, true)).submittedSegments, 0);
});
test('E028: Chinese punctuation clusters/quotes and final unfinished fragment have explicit extraction', async () => {
  const { endingHint } = await model; assert.equal(endingHint('秘密。她说：“公开！？”').text, '她说：“公开！？”'); assert.equal(endingHint('第一句。最后未完').text, '最后未完'); assert.equal(endingHint('第一句。\n最后一句！').text, '最后一句！'); assert.equal(endingHint('只有一句。').text, '只有一句。');
});
test('E028: English stops preserve decimals, declared dot rule and bounded no-punctuation fallback', async () => {
  const { endingHint } = await model; assert.equal(endingHint('Private. Cost is 3.14.').text, 'Cost is 3.14.'); assert.equal(endingHint('Mr. Smith arrived.').text, 'Smith arrived.'); assert.equal(endingHint('one\ntwo').text, 'one\ntwo'); assert.equal(endingHint('one\ntwo').fallback, true);
});
test('E028: thousand-point last sentence or no-stop string never leaks prefix and caps hint80', async () => {
  const { endingHint } = await model;
  for (const text of ['HIDDENPREFIX' + 'x'.repeat(989), 'HIDDENPREFIX' + 'x'.repeat(988) + '。', '😀'.repeat(1000)]) { const hint = endingHint(text); assert.equal([...hint.text].length, 80); assert.equal(hint.truncated, true); assert.ok(!hint.text.includes('HIDDENPREFIX')); assert.deepEqual(Object.keys(hint).sort(), ['characters', 'fallback', 'text', 'truncated']); }
});
test('E028: blind model exposes just hint, full mode exposes only preceding segment', async () => {
  const { createGame, visibleContext, submitTurn, OPENINGS } = await model; let blind = createGame(config()); assert.equal(visibleContext(blind).text, '今天，邮筒里第一次传来了敲门声。'); blind = submitTurn(blind, 'SECRET第一句。公开末句。'); assert.equal(visibleContext(blind).text, '公开末句。'); assert.equal(visibleContext(blind).source, 'segment');
  let full = createGame(config({ mode: 'full' })); assert.equal(visibleContext(full).text, OPENINGS[0].text); full = submitTurn(full, '第一段。'); full = submitTurn(full, '第二段。'); assert.equal(visibleContext(full).text, '第二段。'); assert.ok(!JSON.stringify(visibleContext(full)).includes('第一段'));
});
test('E028: ended JSON/Markdown retain order, authors, rules and escape content markup', async () => {
  const { createGame, submitTurn, interruptGame, serializeGame } = await model; let game = createGame(config({ title: '<b>*标题*' })); game = submitTurn(game, '<script>![x](https://x)\n一句。'); game = submitTurn(game, '第二段。'); game = interruptGame(game, true);
  const json = JSON.parse(await serializeGame(game, 'json', immediate)); assert.equal(json.feature, 'E028'); assert.equal(json.version, 1); assert.equal(json.complete, false); assert.equal(json.opening.id, 'C01'); assert.deepEqual(json.segments.map(s => s.author), ['甲', '乙']); assert.equal(json.segments[0].text, '<script>![x](https://x)\n一句。'); assert.ok(json.rules.privacy);
  const md = await serializeGame(game, 'md', immediate); assert.match(md, /主动中断.*2\/6段/u); assert.ok(md.indexOf('第1段') < md.indexOf('第2段')); assert.ok(md.includes('&lt;script&gt;\\!\\[x\\]\\(https://x\\)')); assert.ok(!md.includes('<script>'));
});
test('E028: export cancellation before/during yield and unsupported formats reject', async () => {
  const { createGame, interruptGame, serializeGame } = await model, game = interruptGame(createGame(config()), true), controller = new AbortController();
  await assert.rejects(serializeGame(game, 'json', { signal: controller.signal, yieldControl: async () => controller.abort() }), { name: 'AbortError' }); await assert.rejects(serializeGame(game, 'md', { signal: controller.signal }), { name: 'AbortError' }); await assert.rejects(serializeGame(game, 'html', immediate), /只支持/u);
});

// DOM fixture checks real module event wiring and cleanup; not native Electron/browser QA.
class Element {
  constructor(tag) { this.nodeType = 1; this.tagName = tag; this.children = []; this.attributes = {}; this.dataset = {}; this.style = {}; this.listeners = {}; this.value = ''; this.disabled = false; }
  get childNodes() { return this.children; }
  setAttribute(key, value) { this.attributes[key] = String(value); if (key === 'value') this.value = String(value); if (key === 'disabled') this.disabled = true; }
  addEventListener(type, callback) { (this.listeners[type] ||= []).push(callback); }
  removeEventListener(type, callback) { this.listeners[type] = (this.listeners[type] || []).filter(other => other !== callback); }
  append(...nodes) { this.children.push(...nodes.map(node => node.nodeType ? node : { nodeType: 3, textContent: String(node) })); if (this.tagName === 'select' && !this.value) this.value = this.children[0]?.value || ''; }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  get textContent() { return this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this.replaceChildren(String(value)); }
  querySelectorAll(selector) { return descendants(this).filter(node => selector === '[data-limit-disabled]' ? node.dataset.limitDisabled !== undefined : selector.split(',').includes(node.tagName)); }
  async fire(type) { if (this.disabled) return; for (const callback of [...(this.listeners[type] || [])]) await callback({ target: this, currentTarget: this }); }
}
function descendants(root) { return root.children.flatMap(child => child.nodeType === 1 ? [child, ...descendants(child)] : []); }
const button = (root, title) => descendants(root).find(node => node.tagName === 'button' && node.textContent === title);
const control = (root, title) => descendants(root).find(node => node.attributes['aria-label'] === title);
const domData = root => [root, ...descendants(root)].map(node => node.textContent + node.value + JSON.stringify(node.attributes) + JSON.stringify(node.dataset)).join('\n');
const safeFiles = saved => ({ saveTextSupportsCopyOnly: true, saveText: async payload => { saved.push(payload); return { ok: true, path: 'story-copy' }; } });
async function withUI(files, callback) {
  const previous = { document: global.document, window: global.window }; global.document = { createElement: tag => new Element(tag), createTextNode: text => ({ nodeType: 3, textContent: String(text) }) }; global.window = { toolbox: { files } };
  const root = new Element('main'), lifecycle = (await import('../src/renderer/features/E028/index.js')).default.create(root, {});
  try { await callback(root, lifecycle); } finally { lifecycle.destroy(); for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete global[key]; else global[key] = value; } }
}
const start = root => button(root, '建立本局并开始交接').fire('click');
const ready = (root, author) => button(root, `我是${author}，开始写作`).fire('click');
async function write(root, text) { const node = control(root, '当前玩家接龙正文'); node.value = text; await node.fire('input'); return node; }
const submit = root => (button(root, '提交本段并交接下一位') || button(root, '提交最后一段并揭晓作品')).fire('click');
async function end(root) { await button(root, '主动结束本局并揭晓').fire('click'); await button(root, '确认中断并揭晓已提交作品').fire('click'); }

test('E028 UI: three-player six-segment relay shields blind history until final reveal and exports order', async () => {
  const saved = []; await withUI(safeFiles(saved), async root => {
    assert.equal(control(root, '接龙开头卡').children.length, 30); await start(root); assert.equal(control(root, '接龙查看模式'), undefined);
    for (let i = 0; i < 6; i++) { assert.equal(control(root, '当前玩家接龙正文'), undefined); if (i) assert.ok(!domData(root).includes('SECRET')); await ready(root, ['甲', '乙', '丙'][i % 3]); if (i) assert.equal(control(root, '当前接龙提示').textContent, `公开末句${i}。`); assert.ok(!domData(root).includes('SECRET')); assert.equal(button(root, '保存完整 JSON 作品副本'), undefined);
      const old = await write(root, `SECRET${i + 1}。公开末句${i + 1}。`); await submit(root); assert.equal(old.value, ''); assert.equal(old.listeners.input.length, 0);
    }
    assert.match(root.textContent, /完整完成/u); assert.match(root.textContent, /已提交6\/6段/u); for (let i = 1; i <= 6; i++) assert.ok(domData(root).includes(`SECRET${i}`));
    for (const title of ['保存完整 JSON 作品副本', '保存完整 Markdown 作品副本']) await button(root, title).fire('click'); assert.deepEqual(saved.map(p => [p.extension, p.copyOnly]), [['json', true], ['md', true]]); const report = JSON.parse(saved[0].content); assert.deepEqual(report.segments.map(s => s.author), ['甲', '乙', '丙', '甲', '乙', '丙']); assert.equal(report.complete, true);
  });
});
test('E028 UI: long single last sentence truncates80 and removed DOM references scrub private data', async () => {
  await withUI(safeFiles([]), async root => { await start(root); await ready(root, '甲'); const oldHint = control(root, '当前接龙提示'), oldWriter = await write(root, 'HIDDENPREFIX' + 'x'.repeat(900) + '公开尾巴。'), oldSubmit = button(root, '提交本段并交接下一位'); await submit(root);
    assert.equal(oldWriter.value, ''); assert.equal(oldHint.textContent, ''); assert.equal(oldSubmit.textContent, ''); assert.equal(oldSubmit.listeners.click.length, 0); await ready(root, '乙'); assert.notEqual(control(root, '当前玩家接龙正文'), oldWriter); assert.equal([...control(root, '当前接龙提示').textContent].length, 80); assert.ok(!domData(root).includes('HIDDENPREFIX')); assert.match(root.textContent, /前文已省略/u);
  });
});
test('E028 UI: full previous paragraph mode shows only last segment before reveal', async () => {
  await withUI(safeFiles([]), async root => { const mode = control(root, '接龙查看模式'); mode.value = 'full'; await mode.fire('change'); await start(root); await ready(root, '甲'); assert.match(control(root, '当前接龙提示').textContent, /小镇的邮筒/u); await write(root, 'FIRST_FULL_PRIVATE。第一末句。'); await submit(root); await ready(root, '乙'); assert.equal(control(root, '当前接龙提示').textContent, 'FIRST_FULL_PRIVATE。第一末句。'); await write(root, 'SECOND_FULL_PRIVATE。第二末句。'); await submit(root); await ready(root, '丙'); assert.ok(!domData(root).includes('FIRST_FULL_PRIVATE')); assert.ok(domData(root).includes('SECOND_FULL_PRIVATE')); });
});
test('E028 UI: interrupted game requires confirmation, retains draft on cancel and excludes unsubmitted text', async () => {
  const saved = []; await withUI(safeFiles(saved), async root => { await start(root); await ready(root, '甲'); await write(root, '已提交段。'); await submit(root); await ready(root, '乙'); const old = await write(root, 'UNSUBMITTED_DRAFT'); await button(root, '主动结束本局并揭晓').fire('click'); assert.ok(!domData(root).includes('UNSUBMITTED_DRAFT')); assert.ok(!domData(root).includes('已提交段。')); assert.equal(old.value, ''); assert.equal(button(root, '保存完整 JSON 作品副本'), undefined);
    await button(root, '继续本局，保留未提交草稿').fire('click'); assert.equal(control(root, '当前玩家接龙正文').value, 'UNSUBMITTED_DRAFT'); assert.notEqual(control(root, '当前玩家接龙正文'), old); await end(root); assert.match(root.textContent, /主动中断/u); assert.match(root.textContent, /已提交1\/6段/u); assert.ok(!domData(root).includes('UNSUBMITTED_DRAFT')); await button(root, '保存完整 JSON 作品副本').fire('click'); const report = JSON.parse(saved[0].content); assert.equal(report.complete, false); assert.equal(report.submittedSegments, 1); assert.ok(!saved[0].content.includes('UNSUBMITTED_DRAFT'));
  });
});
test('E028 UI: new-game confirmation does not change locked game on cancel and clears on confirmation', async () => {
  await withUI(safeFiles([]), async root => { await start(root); await ready(root, '甲'); await write(root, 'KEEP_DRAFT'); await button(root, '建立新局').fire('click'); assert.ok(!domData(root).includes('KEEP_DRAFT')); assert.equal(control(root, '接龙查看模式'), undefined); await button(root, '返回当前局').fire('click'); assert.equal(control(root, '当前玩家接龙正文').value, 'KEEP_DRAFT'); assert.match(root.textContent, /甲 写作/u);
    await button(root, '建立新局').fire('click'); await button(root, '确认清空本局，进入新局设置').fire('click'); assert.ok(control(root, '接龙查看模式')); assert.ok(!domData(root).includes('KEEP_DRAFT')); await start(root); await ready(root, '甲'); assert.equal(control(root, '当前玩家接龙正文').value, ''); assert.match(root.textContent, /已提交0\/6段/u);
  });
});
test('E028 UI: pause clears old DOM, restores draft in new node; repeated activate preserves it', async () => {
  await withUI(safeFiles([]), async (root, lifecycle) => { await start(root); await ready(root, '甲'); const old = await write(root, 'PAUSED_PRIVATE\n草稿'), hint = control(root, '当前接龙提示'); lifecycle.deactivate(); assert.equal(old.value, ''); assert.equal(old.listeners.input.length, 0); assert.equal(hint.textContent, ''); assert.ok(!domData(root).includes('PAUSED_PRIVATE')); assert.equal(control(root, '当前玩家接龙正文'), undefined); lifecycle.activate(); const recovered = control(root, '当前玩家接龙正文'); assert.notEqual(recovered, old); assert.equal(recovered.value, 'PAUSED_PRIVATE\n草稿'); lifecycle.activate(); assert.equal(control(root, '当前玩家接龙正文').value, 'PAUSED_PRIVATE\n草稿'); await submit(root); await ready(root, '乙'); assert.equal(control(root, '当前玩家接龙正文').value, ''); });
});
test('E028 UI: destroy clears inputs/listeners and old button cannot mutate next module', async () => {
  await withUI(safeFiles([]), async (root, lifecycle) => { await start(root); await ready(root, '甲'); const old = await write(root, 'DESTROY_PRIVATE'), oldButton = button(root, '提交本段并交接下一位'); lifecycle.destroy(); assert.equal(root.children.length, 0); assert.equal(old.value, ''); assert.equal(old.listeners.input.length, 0); assert.equal(oldButton.listeners.click.length, 0); await oldButton.fire('click'); assert.equal(root.children.length, 0); lifecycle.activate(); assert.equal(root.children.length, 0); });
});
test('E028 UI: invalid paragraph stays current player, corrected input advances once', async () => {
  await withUI(safeFiles([]), async root => { await start(root); await ready(root, '甲'); for (const value of ['  ', 'x'.repeat(1001)]) { await write(root, value); await submit(root); assert.match(root.textContent, /每段须/u); assert.match(root.textContent, /甲 写作/u); } await write(root, ' 修复。 '); await submit(root); assert.match(root.textContent, /交给 乙/u); await ready(root, '乙'); assert.equal(control(root, '当前接龙提示').textContent, '修复。'); });
});
test('E028 UI: player limits and setup validation, selected original opening and one round', async () => {
  await withUI(safeFiles([]), async root => { for (let i = 3; i < 8; i++) await button(root, '添加玩家').fire('click'); assert.equal(button(root, '添加玩家').disabled, true); for (let i = 8; i > 2; i--) await button(root, '移除最后一位玩家').fire('click'); assert.equal(button(root, '移除最后一位玩家').disabled, true);
    const name = control(root, '接龙玩家1名称'); name.value = '乙'; await name.fire('input'); await start(root); assert.match(root.textContent, /唯一/u); assert.ok(control(root, '接龙开头卡')); name.value = '甲'; await name.fire('input'); const rounds = control(root, '接龙轮数'); rounds.value = '1'; await rounds.fire('input'); const opening = control(root, '接龙开头卡'); opening.value = 'C30'; await opening.fire('change'); await start(root); await ready(root, '甲'); assert.equal(control(root, '当前接龙提示').textContent, '我拆开封条，看到了一本正在写我的书。'); await write(root, '甲段。'); await submit(root); await ready(root, '乙'); assert.ok(button(root, '提交最后一段并揭晓作品')); await write(root, '乙段。'); await submit(root); assert.match(root.textContent, /已提交2\/2段/u);
  });
});
test('E028 UI: no early exporter; missing copyOnly capability disables ended exports', async () => {
  await withUI({ saveText: async () => assert.fail('unsafe save') }, async root => { await start(root); assert.equal(button(root, '保存完整 JSON 作品副本'), undefined); await end(root); assert.match(root.textContent, /已提交0\/6段/u); assert.equal(button(root, '保存完整 JSON 作品副本').disabled, true); assert.equal(button(root, '保存完整 Markdown 作品副本').disabled, true); assert.match(root.textContent, /缺少副本保护/u); });
});
test('E028 UI: strict save success, cancellation, false/stringok and exceptions are reported truthfully', async () => {
  let answer = { ok: false, error: '已有文件' }; const payloads = []; await withUI({ saveTextSupportsCopyOnly: true, saveText: async p => { payloads.push(p); if (answer instanceof Error) throw answer; return answer; } }, async root => { await start(root); await end(root);
    for (const response of [{ ok: false, error: '已有文件' }, { ok: 'true' }, undefined, new Error('写入失败')]) { answer = response; await button(root, '保存完整 JSON 作品副本').fire('click'); assert.ok(!root.textContent.includes('已保存作品副本')); assert.match(root.textContent, /失败|成功结果/u); }
    answer = { canceled: true }; await button(root, '保存完整 JSON 作品副本').fire('click'); assert.match(root.textContent, /已取消另存/u); answer = { ok: true, path: 'new.json' }; await button(root, '保存完整 JSON 作品副本').fire('click'); assert.match(root.textContent, /已保存作品副本：new.json/u); assert.ok(payloads.every(p => p.copyOnly === true && p.extension === 'json'));
  });
});
test('E028 UI: cancel bounded export before native IPC and retry succeeds', async () => {
  const saved = []; await withUI(safeFiles(saved), async root => { await start(root); await end(root); const task = button(root, '保存完整 JSON 作品副本').fire('click'); assert.equal(button(root, '取消作品副本生成').disabled, false); await button(root, '取消作品副本生成').fire('click'); await task; assert.equal(saved.length, 0); assert.match(root.textContent, /取消导出/u); assert.equal(button(root, '保存完整 JSON 作品副本').disabled, false); await button(root, '保存完整 JSON 作品副本').fire('click'); assert.equal(saved.length, 1); });
});
test('E028 UI: pending native dialog disables app cancel/new game, paused export does not write', async () => {
  let finish; await withUI({ saveTextSupportsCopyOnly: true, saveText: () => new Promise(resolve => { finish = resolve; }) }, async root => { await start(root); await end(root); const task = button(root, '保存完整 JSON 作品副本').fire('click'); while (!finish) await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(button(root, '取消作品副本生成').disabled, true); assert.equal(button(root, '建立新局').disabled, true); finish({ canceled: true }); await task; assert.match(root.textContent, /已取消另存/u); });
  const saved = []; await withUI(safeFiles(saved), async (root, lifecycle) => { await start(root); await end(root); const task = button(root, '保存完整 JSON 作品副本').fire('click'); lifecycle.deactivate(); await task; assert.equal(saved.length, 0); lifecycle.activate(); assert.match(root.textContent, /主动中断/u); });
});
