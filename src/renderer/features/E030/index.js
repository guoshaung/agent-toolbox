import { h } from '../../core/ui.js';
import { createGame, publicView, showDice, privateDice, coverDice, finishInspection, makeBid, challenge, nextRound, destroyGame, serializeGame, RULES } from './model.mjs';

export default { id: 'E030', create(root) {
  let alive = true, active = true, game = null, confirmReset = false, names = ['甲', '乙', '丙'], wild = false, message = '', busy = false, nativePending = false, controller = null;
  const bindings = [];
  function on(node, type, fn) { const guarded = async event => { if (!alive || !active || busy) return; try { await fn(event); } catch (error) { message = error.message || '操作失败'; render(); } }; node.addEventListener(type, guarded); bindings.push([node, type, guarded]); return node; }
  function button(text, fn, disabled = false) { return on(h('button', { type: 'button', class: 'btn', disabled }, text), 'click', fn); }
  function scrub() { for (const [node, type, fn] of bindings.splice(0)) node.removeEventListener(type, fn); for (const node of root.querySelectorAll('input,select,textarea')) node.value = ''; for (const node of root.querySelectorAll('[data-private-dice]')) node.textContent = ''; root.replaceChildren(); }
  function act(fn) { fn(); message = ''; render(); }
  function reset() { if (game) destroyGame(game); game = null; confirmReset = false; names = ['甲', '乙', '丙']; wild = false; message = ''; render(); }
  async function save(format) {
    const files = window.toolbox?.files; if (files?.saveTextSupportsCopyOnly !== true || typeof files.saveText !== 'function') throw Error('缺少copyOnly副本保护能力');
    coverDice(game); busy = true; nativePending = false; controller = new AbortController(); render();
    try { const content = await serializeGame(game, format, { signal: controller.signal }); if (!alive || !active || controller.signal.aborted) return; nativePending = true; render(); const result = await files.saveText({ content, extension: format, defaultName: `liars-dice-revealed-copy.${format}`, copyOnly: true }); if (!alive || !active) return; message = result?.canceled === true ? '已取消另存' : result?.ok === true ? `已保存已揭示历史副本：${result.path || ''}` : `保存失败：${result?.error || '未返回成功结果'}`; }
    catch (error) { if (alive && active) message = error.name === 'AbortError' ? '已取消报告生成' : `保存失败：${error.message}`; }
    finally { busy = false; nativePending = false; controller = null; if (alive && active) render(); }
  }
  function render() {
    if (!alive) return; scrub(); root.append(h('h2', {}, '吹牛骰子'), h('p', { style: { color: 'var(--text-dim)' } }, '本地同屏交接。请其他人背过屏幕；合作遮挡不是授权隔离。切换具体功能会丢失本局。'));
    if (!active) { root.append(h('p', {}, '已暂停并遮盖骰子；返回后请本人重新查看。')); return; }
    if (message) root.append(h('p', { role: 'status' }, message));
    if (confirmReset) { root.append(h('p', {}, '建立新局将清空当前局和未保存历史，无法撤销。'), button('返回当前局并保持遮盖', () => act(() => { confirmReset = false; })), button('确认清空，进入新局设置', reset)); return; }
    if (!game) {
      names.forEach((name, i) => { const input = h('input', { 'aria-label': `骰子玩家${i + 1}名称`, value: name, maxlength: 40 }); on(input, 'input', () => { names[i] = input.value; }); root.append(h('label', {}, `玩家${i + 1} `, input)); });
      const mode = h('select', { 'aria-label': '万能1规则' }, h('option', { value: 'off', selected: !wild }, '1不万能（默认）'), h('option', { value: 'on', selected: wild }, '1万能：仅叫2至6时计入')); mode.value = wild ? 'on' : 'off'; on(mode, 'change', () => { wild = mode.value === 'on'; });
      root.append(h('div', {}, button('添加玩家', () => act(() => { names.push(`玩家${names.length + 1}`); }), names.length === 6), button('移除最后一位玩家', () => act(() => { names.pop(); }), names.length === 3)), h('label', {}, '规则 ', mode), h('p', {}, '3至6人，每人5骰。每轮先依次私密看骰，再从起手玩家叫价。规则在建立本局后锁定。'), ...Object.values(RULES).slice(0, 4).map(text => h('p', {}, text)), button('建立本局并开始看骰', () => act(() => { game = createGame({ players: names, wildOnes: wild }); }))); return;
    }
    const view = publicView(game), current = view.players[view.current]; root.append(h('p', {}, `第${view.round}轮 · 总骰数${view.totalDice} · 万能1${view.wildOnes ? '开启' : '关闭'}`), h('p', {}, view.players.map(p => `${p.name}：${p.remaining}骰${p.remaining ? '' : '（退出）'}`).join('；')));
    if (['inspect', 'turn'].includes(view.phase)) {
      root.append(h('h3', {}, view.phase === 'inspect' ? `交给 ${current.name} · 看骰${view.inspectPosition + 1}/${view.inspectCount}` : `交给 ${current.name} · 叫价或质疑`));
      if (!view.visible) root.append(h('p', {}, '骰子已遮盖。请本人接过设备后查看。'), button(`我是${current.name}，私密查看自己的骰子`, () => act(() => { showDice(game); })));
      else {
        root.append(h('p', { 'data-private-dice': '', 'aria-label': '本人私密骰子', style: { fontSize: '24px', letterSpacing: '4px' } }, privateDice(game).join(' · ')), button('立即遮盖自己的骰子', () => act(() => { coverDice(game); })));
        if (view.phase === 'inspect') root.append(button('记住骰子，遮盖并交接', () => act(() => { finishInspection(game); })));
        else {
          const quantity = h('input', { type: 'number', min: 1, max: view.totalDice, step: 1, value: view.bid?.quantity || 1, 'aria-label': '叫价数量' }), face = h('select', { 'aria-label': '叫价点数' }, ...Array.from({ length: 6 }, (_, i) => h('option', { value: i + 1 }, `${i + 1}点`)));
          root.append(h('label', {}, '数量 ', quantity), h('label', {}, '点数 ', face), button('确认叫价并遮盖交接', () => act(() => { makeBid(game, Number(quantity.value), Number(face.value)); })), button('质疑上一叫价并亮全部骰', () => act(() => { challenge(game); }), !view.bid));
        }
      }
      if (view.bid) root.append(h('p', {}, `上一叫价：${view.players[view.bid.player].name}，${view.bid.quantity}个${view.bid.face}`));
      root.append(h('p', {}, RULES.bid), h('p', {}, RULES.loss));
    } else {
      const round = view.latestRevealed; root.append(h('h3', {}, view.phase === 'finished' ? `本局结束，胜者：${view.players[view.winner].name}` : '质疑结算 · 全部骰已揭示'), ...round.dice.map(p => h('p', {}, `${p.name}：${p.faces.join(' · ') || '已退出'}`)), h('p', {}, `叫价${round.bid.quantity}个${round.bid.face}，实际${round.actual}；质疑${round.challengeSucceeded ? '成功' : '失败'}；${view.players[round.loser].name}扣1骰${round.eliminated ? '并退出' : ''}。`));
      if (view.phase === 'revealed') root.append(h('p', {}, `下一轮起手：${view.players[round.nextStarter].name}`), button('下一轮重新掷骰并遮盖', () => act(() => { nextRound(game); })));
    }
    if (view.calls.length) root.append(h('details', {}, h('summary', {}, `本轮公开叫价${view.calls.length}次`), ...view.calls.map(call => h('p', {}, `${call.ordinal}. ${view.players[call.player].name}：${call.quantity}个${call.face}`))));
    const capable = window.toolbox?.files?.saveTextSupportsCopyOnly === true && typeof window.toolbox.files.saveText === 'function';
    if (view.revealedRounds) { root.append(h('p', {}, `已亮骰${view.revealedRounds}轮；导出不含当前未揭示骰子。`), button('保存已揭示 JSON 历史副本', () => save('json'), busy || !capable), button('保存已揭示 Markdown 历史副本', () => save('md'), busy || !capable)); if (!capable) root.append(h('p', {}, '缺少copyOnly副本保护能力，不能保存。')); }
    root.append(button('建立新局', () => act(() => { coverDice(game); confirmReset = true; }), busy));
    if (busy) { const cancel = h('button', { type: 'button', disabled: nativePending }, '取消报告生成'); const fn = () => controller?.abort(); cancel.addEventListener('click', fn); bindings.push([cancel, 'click', fn]); root.append(cancel, h('p', {}, nativePending ? '原生另存处理中，请在对话框取消。' : '正在生成已揭示历史。')); }
    if (busy) for (const node of root.querySelectorAll('button,input,select')) if (node.textContent !== '取消报告生成') node.disabled = true;
  }
  render(); return { activate() { if (!alive || active) return; active = true; render(); }, deactivate() { if (!alive) return; active = false; controller?.abort(); if (game) coverDice(game); render(); }, destroy() { if (!alive) return; alive = false; controller?.abort(); if (game) destroyGame(game); game = null; names = []; scrub(); } };
} };
