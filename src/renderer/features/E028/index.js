import { h } from '../../core/ui.js';
import { LIMITS, OPENINGS, RULES, countCharacters, createGame, currentTurn, visibleContext, submitTurn, interruptGame, finalReport, serializeGame } from './model.mjs';
const css = `.e028{display:grid;gap:12px;color:var(--text);max-width:1050px;margin:auto}.e028 label{display:grid;gap:6px}.e028 input,.e028 textarea,.e028 select{font:inherit;padding:8px;border:1px solid var(--line);border-radius:6px;background:var(--bg-sunken);color:var(--text)}.e028 textarea{width:100%;box-sizing:border-box;resize:vertical;line-height:1.7}.e028 .e028-row{display:flex;gap:10px;align-items:end;flex-wrap:wrap}.e028 .e028-row>label{flex:1;min-width:150px}.e028 .e028-card{padding:16px;border:1px solid var(--line);border-radius:8px;display:grid;gap:10px}.e028 .e028-muted{font-size:13px;line-height:1.6;color:var(--text-dim)}.e028 .e028-status{padding:10px;background:var(--bg-sunken);white-space:pre-wrap}.e028 .e028-story{max-height:620px;overflow:auto;padding:14px;border:1px solid var(--line);border-radius:8px;line-height:1.8}.e028 pre,.e028 .e028-paragraph{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.8}.e028 button:disabled{opacity:.5}`;
const label = (title, input) => h('label', {}, title, input);
function scrub(node) { if (node.nodeType === 3) { node.textContent = ''; return; } for (const child of [...node.childNodes]) scrub(child); if (['INPUT', 'TEXTAREA'].includes(node.tagName?.toUpperCase())) node.value = ''; node.replaceChildren?.(); }
export default {
  id: 'E028',
  create(root) {
    let settings = { title: '我们的接龙故事', players: ['甲', '乙', '丙'], rounds: 2, mode: 'blind', openingId: 'C01' }, game = null, phase = 'setup', returnPhase = null, draft = '', writer = null, counter = null, stageBindings = [], exportButtons = [], saveCancel = null, active = true, alive = true, busy = false, nativePending = false, operation = null;
    const stage = h('div'), status = h('div', { class: 'e028-status', role: 'status', 'aria-live': 'polite' }, '配置玩家、轮数和开头卡，再建立锁定设置的新局。默认三人两轮盲接。');
    const files = window.toolbox?.files, safeSave = () => files?.saveTextSupportsCopyOnly === true && typeof files.saveText === 'function';
    const say = value => { if (alive) status.textContent = value; };
    const listen = (node, event, action) => { node.addEventListener(event, action); stageBindings.push([node, event, action]); return node; };
    const button = (title, action, primary = false, allowBusy = false) => listen(h('button', { type: 'button', class: primary ? 'btn btn--primary' : 'btn' }, title), 'click', async () => { if (!alive || !active || (busy && !allowBusy)) return; await action(); });
    const captureDraft = () => { if (writer && writer.value.length <= LIMITS.draftUnits) draft = writer.value; };
    const clearStage = preserveDraft => {
      if (writer) { if (preserveDraft) captureDraft(); else draft = ''; }
      for (const [node, event, action] of stageBindings) node.removeEventListener(event, action); stageBindings = [];
      scrub(stage); writer = counter = null; exportButtons = []; saveCancel = null;
    };
    const setControls = () => {
      if (!alive) return; for (const control of stage.querySelectorAll('input,textarea,select,button')) control.disabled = busy || !active;
      if (!busy && active) for (const button of exportButtons) button.disabled = !safeSave();
      if (saveCancel) saveCancel.disabled = !busy || nativePending || !active;
    };
    const publicSummary = () => h('p', { class: 'e028-muted' }, `设置已锁定：${game.config.players.join(' → ')}，${game.config.rounds}轮，${game.config.mode === 'blind' ? '盲接末句' : '上一段完整查看'}，开头卡${OPENINGS.find(card => card.id === game.config.openingId).title}；已提交${game.segments.length}/${game.plannedSegments}段。改变设置请明确建立新局。`);
    const newGameButton = () => button('建立新局', () => { returnPhase = phase; phase = 'confirmNew'; render(true); say('新局会清空当前作品和未提交草稿；已结束作品请先导出。'); });
    const endButton = () => button('主动结束本局并揭晓', () => { returnPhase = phase; phase = 'confirmEnd'; render(true); say('提前结束需明确确认，确认前不会揭晓历史全文。未提交草稿不会计入作品。'); });
    function renderSetup() {
      const title = listen(h('input', { 'aria-label': '接龙作品名称', value: settings.title, maxlength: 160 }), 'input', event => { settings.title = event.currentTarget.value; });
      const rounds = listen(h('input', { 'aria-label': '接龙轮数', type: 'number', min: 1, max: 10, step: 1, value: settings.rounds }), 'input', event => { settings.rounds = Number(event.currentTarget.value); });
      const mode = listen(h('select', { 'aria-label': '接龙查看模式' }, h('option', { value: 'blind' }, '盲接：只看上一段末句/最多80码点'), h('option', { value: 'full' }, '查看完整上一段')), 'change', event => { settings.mode = event.currentTarget.value; }); mode.value = settings.mode;
      const opening = listen(h('select', { 'aria-label': '接龙开头卡' }, ...OPENINGS.map(card => h('option', { value: card.id }, `${card.id} ${card.title}`))), 'change', event => { settings.openingId = event.currentTarget.value; preview.textContent = OPENINGS.find(card => card.id === settings.openingId)?.text || ''; }); opening.value = settings.openingId;
      const preview = h('pre', {}, OPENINGS.find(card => card.id === settings.openingId).text);
      const names = settings.players.map((name, index) => label(`玩家${index + 1}（按顺序）`, listen(h('input', { 'aria-label': `接龙玩家${index + 1}名称`, value: name, maxlength: 80 }), 'input', event => { settings.players[index] = event.currentTarget.value; })));
      const add = button('添加玩家', () => { if (settings.players.length >= 8) return; captureDraft(); settings.players.push(`玩家${settings.players.length + 1}`); render(); }), remove = button('移除最后一位玩家', () => { if (settings.players.length <= 2) return; settings.players.pop(); render(); });
      add.disabled = settings.players.length >= 8; add.dataset.limitDisabled = String(add.disabled); remove.disabled = settings.players.length <= 2; remove.dataset.limitDisabled = String(remove.disabled);
      const start = button('建立本局并开始交接', () => {
        try { game = createGame({ ...settings, players: [...settings.players] }); phase = 'handoff'; draft = ''; render(); say('本局已建立，设置锁定。请把设备交给第一位玩家，再由本人开始写作。'); } catch (error) { say(error.message); }
      }, true);
      stage.append(h('div', { class: 'e028-card' }, h('h3', {}, '新局设置'), h('div', { class: 'e028-row' }, label('作品名', title), label('轮数（1–10）', rounds), label('查看模式', mode)), h('div', { class: 'e028-row' }, ...names), h('div', { class: 'e028-row' }, add, remove), label('30张原创开头卡', opening), preview,
        h('p', { class: 'e028-muted' }, '2–8人，名字唯一，单段提交1–1000 Unicode码点（先去首尾空白）；每轮每人一段，最多80段。本局开始后不能更换模式/玩家/开头。'), start));
    }
    function renderHandoff() {
      const turn = currentTurn(game);
      stage.append(h('div', { class: 'e028-card' }, h('h3', {}, `请把设备交给 ${turn.author}`), publicSummary(), h('p', {}, `下一段：第${turn.round}轮，第${turn.ordinal}/${game.plannedSegments}段。交接页不显示前文或写作草稿。`),
        h('p', { class: 'e028-muted' }, '同屏合作隐私：请由该玩家本人接手。身份按钮没有登录、授权或加密隔离。'), button(`我是${turn.author}，开始写作`, () => { phase = 'writing'; render(); say('请按当前提示接写。提交后旧写作节点将清空并替换。'); }, true), h('div', { class: 'e028-row' }, endButton(), newGameButton())));
    }
    function renderWriting() {
      const turn = currentTurn(game), context = visibleContext(game);
      const hint = h('pre', { 'aria-label': '当前接龙提示' }, context.text);
      writer = h('textarea', { 'aria-label': '当前玩家接龙正文', rows: 8, maxlength: LIMITS.draftUnits, placeholder: '写一段1–1000 Unicode码点的正文。' }); writer.value = draft;
      counter = h('p', { class: 'e028-muted', 'aria-live': 'polite' });
      const count = () => { if (!writer || !counter) return; counter.textContent = writer.value.length > LIMITS.draftUnits ? '草稿超过2000 UTF-16单位，无法提交或暂停保留；请缩短。' : `${countCharacters(writer.value.trim())}/1000码点；提交去首尾空白，内部换行保留。`; };
      listen(writer, 'input', () => { captureDraft(); count(); }); count();
      const submit = button(turn.isLast ? '提交最后一段并揭晓作品' : '提交本段并交接下一位', () => {
        if (phase !== 'writing' || game?.segments.length !== turn.ordinal - 1) return;
        try { game = submitTurn(game, writer.value); phase = game.status === 'completed' ? 'closed' : 'handoff'; draft = ''; render(); say(game.status === 'completed' ? '已按计划完成，完整作品现在揭晓，可另存副本。' : '本段已提交；旧输入与提示已清空。请交给下一位玩家。'); }
        catch (error) { say(error.message); }
      }, true);
      stage.append(h('div', { class: 'e028-card' }, h('h3', {}, `${turn.author} 写作 · 第${turn.round}轮 · 第${turn.ordinal}/${game.plannedSegments}段`), publicSummary(),
        h('h4', {}, context.source === 'opening' ? '开头卡提示' : context.mode === 'blind' ? '上一段末句/尾片段' : '完整上一段'), hint,
        h('p', { class: 'e028-muted' }, context.mode === 'blind' ? `${context.truncated ? '末句/片段过长，只显示最后80码点，前文已省略。' : '仅显示规则提取出的末句/片段。'}${context.fallback ? '没有识别到句末符，采用最多80码点尾片段。' : ''} 盲接历史全文直到本局结束才揭晓。` : '只查看完整上一段，历史各段仍到本局结束再合并。'),
        label('当前玩家正文', writer), counter, submit, turn.isLast ? h('p', {}, '这是计划中的最后一段：提交即完成并揭晓全部作品。') : null,
        h('div', { class: 'e028-row' }, endButton(), newGameButton())));
    }
    function renderConfirmEnd() {
      stage.append(h('div', { class: 'e028-card' }, h('h3', {}, '确认主动中断并揭晓'), publicSummary(), h('p', {}, `确认后作品标记为中断，已提交${game.segments.length}/${game.plannedSegments}段；当前未提交草稿将舍弃。确认前不显示全文。`),
        button('确认中断并揭晓已提交作品', () => { game = interruptGame(game, true); phase = 'closed'; draft = ''; render(); say('本局已主动中断；作品明确标注已提交和计划段数。'); }, true), button('继续本局，保留未提交草稿', () => { phase = returnPhase; render(); say('已返回原阶段，当前玩家和未提交草稿保留。'); })));
    }
    function renderConfirmNew() {
      stage.append(h('div', { class: 'e028-card' }, h('h3', {}, '确认清空当前局并建立新局'), publicSummary(), h('p', {}, '确认会舍弃当前作品和未提交草稿。若已经结束，请先返回并导出；新局可重新设置模式、玩家和开头。'),
        button('确认清空本局，进入新局设置', () => { settings = { ...game.config, players: [...game.config.players] }; game = null; draft = ''; phase = 'setup'; render(); say('旧局已清空；请调整设置并重新建立新局。'); }), button('返回当前局', () => { phase = returnPhase; render(); say('已返回当前局，设置与草稿未改变。'); })));
    }
    const save = async format => {
      if (!game || !['completed', 'interrupted'].includes(game.status) || busy || !safeSave()) return;
      const controller = new AbortController(); operation = controller; busy = true; nativePending = false; setControls(); say('正在生成已结束作品副本…');
      try {
        const content = await serializeGame(game, format, { signal: controller.signal }); if (!alive || controller.signal.aborted) return; nativePending = true; setControls(); say('作品副本已生成，请在另存对话框核对目标或取消。');
        const response = await files.saveText({ content, extension: format, defaultName: `story-relay-work-copy.${format}`, copyOnly: true });
        if (alive) say(response?.canceled === true ? '已取消另存。' : response?.ok === true ? `已保存作品副本：${response.path || '所选新文件'}` : `保存失败：${response?.error || '未收到明确成功结果'}`);
      } catch (error) { say(error.message); } finally { if (operation === controller) { operation = null; busy = nativePending = false; setControls(); } }
    };
    function renderClosed() {
      const result = finalReport(game), json = button('保存完整 JSON 作品副本', () => save('json')), md = button('保存完整 Markdown 作品副本', () => save('md'));
      exportButtons = [json, md]; saveCancel = button('取消作品副本生成', () => operation?.abort(), false, true);
      stage.append(h('h3', {}, `${result.title} · ${result.complete ? '完整完成' : '主动中断'}`), h('p', {}, `已提交${result.submittedSegments}/${result.plannedSegments}段 · 正文${result.totalCharacters}码点 · 玩家顺序${result.players.map(player => player.name).join(' → ')}`),
        h('div', { class: 'e028-story' }, h('h4', {}, `开头卡：${result.opening.title}`), h('p', { class: 'e028-paragraph' }, result.opening.text), ...result.segments.map(segment => h('section', {}, h('h4', {}, `第${segment.round}轮 · 第${segment.ordinal}段 · ${segment.author}（${segment.playerId}）`), h('p', { class: 'e028-paragraph' }, segment.text)))),
        h('div', { class: 'e028-row' }, json, md, saveCancel), safeSave() ? h('p', { class: 'e028-muted' }, '只另存新文件，已有目标拒绝覆盖；对话框取消不报告成功。') : h('p', { class: 'e028-muted' }, '基础层缺少副本保护，导出已禁用，请使用支持copyOnly的版本。'), newGameButton());
    }
    function render(preserveDraft = false) {
      clearStage(preserveDraft); if (!alive) return;
      if (!active) stage.append(h('p', {}, '本局已暂停；回来恢复同一阶段与当前玩家未提交草稿。'));
      else if (phase === 'setup') renderSetup(); else if (phase === 'handoff') renderHandoff(); else if (phase === 'writing') renderWriting(); else if (phase === 'confirmEnd') renderConfirmEnd(); else if (phase === 'confirmNew') renderConfirmNew(); else if (phase === 'closed') renderClosed();
      setControls(); if (!busy && active) for (const control of stage.querySelectorAll('[data-limit-disabled]')) control.disabled = control.dataset.limitDisabled === 'true';
    }
    const panel = h('section', { class: 'e028' }, h('style', {}, css), h('h2', {}, '故事接龙'), h('p', { class: 'e028-muted' }, '30张原创开头卡，真人轮流写作；无网络/AI调用。同屏合作隐私不是账号授权、加密或安全隔离，请按交接约定操作。'), status, stage,
      h('details', {}, h('summary', {}, '末句规则、长度与保存限制'), ...Object.values(RULES).map(rule => h('p', { class: 'e028-muted' }, rule))), h('p', { class: 'e028-muted' }, '暂停保留当前未提交草稿，交接清空；切换具体功能会清理所有未保存内容。只有完成或明确中断后能导出全文。'));
    root.replaceChildren(panel); render();
    return { activate() { if (alive) { active = true; render(true); } }, deactivate() { if (alive) { operation?.abort(); active = false; render(true); } }, destroy() { operation?.abort(); alive = active = false; clearStage(false); draft = ''; game = null; settings = null; root.replaceChildren(); } };
  }
};
