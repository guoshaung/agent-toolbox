import { h } from '../../core/ui.js';
import { MODEL_VERSION, FIELDS, MAX_TICK, MAX_EVENTS, POLICY, TYPE_LABELS, example, simulate, prepareStoredState, validateStoredState, reportMarkdown } from './model.mjs';

const KEY = 'features.L016.state';
const LABELS = { packetCount: '数据包数量', window: '固定窗口包数', delay: '单向延迟tick', timeout: '初始超时tick', drops: '首次丢包列表' };
export default {
  id: 'L016',
  create(root, ctx = {}) {
    root.classList.add('feature-l016');
    let draft = example(); let result = null; let selected = 0; let timer = null; let destroyed = false; let exporting = false; let restoredNotice = '';
    const saved = ctx.config?.get(KEY);
    if (saved) {
      try { const state = validateStoredState(saved); draft = Object.fromEntries(FIELDS.map((key) => [key, state[key]])); restoredNotice = '已恢复参数草稿；收发状态和轨迹不写入配置，请重新模拟或保留导出报告。'; }
      catch (error) { restoredNotice = `保存草稿未能恢复：${error.message} 旧配置未被自动覆盖。`; }
    }
    const notice = h('div', { class: 'l016-notice', role: 'status', 'aria-live': 'polite' }, restoredNotice); const storageNotice = h('div', { class: 'l016-storage', role: 'status' });
    const editor = h('div', { class: 'l016-editor' }); const output = h('div', { class: 'l016-output' });
    function replace(node, ...children) { node.replaceChildren(...children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false)); }
    function message(text, error = false) { if (!destroyed) { notice.textContent = text; notice.classList.toggle('is-error', error); } }
    function persist() {
      if (timer !== null) clearTimeout(timer); timer = null; if (!ctx.config?.set) return;
      let state;
      try { state = prepareStoredState(draft); }
      catch (error) { if (!destroyed) storageNotice.textContent = `${error.message} 当前输入未写入全局配置，关闭后只能恢复较早草稿；请导出完整JSON，切走不能保存超限内容。`; return; }
      if (!destroyed) storageNotice.textContent = '';
      try { Promise.resolve(ctx.config.set(KEY, state)).catch((error) => message(`保存草稿失败：${error.message} 请导出完整JSON。`, true)); }
      catch (error) { message(`保存草稿失败：${error.message} 请导出完整JSON。`, true); }
    }
    function changed() { result = null; selected = 0; renderOutput(); message('参数已改变，旧收发状态及轨迹已清空，请重新模拟。'); if (timer !== null) clearTimeout(timer); timer = setTimeout(persist, 250); }
    function table(headers, rows, caption) { return h('div', { class: 'l016-scroll' }, h('table', {}, h('caption', {}, caption), h('thead', {}, h('tr', {}, headers.map((label) => h('th', { scope: 'col' }, label)))), h('tbody', {}, rows))); }
    function load(kind) { draft = example(kind); changed(); renderEditor(); persist(); message('示例已载入，请模拟时序。'); }
    function renderEditor() {
      replace(editor, h('div', { class: 'l016-fields' }, FIELDS.map((key) => {
        const input = h('input', { class: 'field', type: 'text', inputmode: key === 'drops' ? 'text' : 'numeric', maxlength: key === 'drops' ? '256' : '3', 'aria-label': LABELS[key], oninput: () => { draft[key] = input.value; changed(); } }); input.value = draft[key];
        return h('label', {}, h('span', {}, LABELS[key]), input);
      })), h('p', {}, '包数1–30；窗口1–8；单向延迟1–20；初始超时1–64。首次丢包号用逗号或空格分隔，空白表示不丢包；同包只丢第一次。ACK不丢失。'),
      h('div', { class: 'l016-actions' }, h('button', { class: 'btn', onclick: () => load('core') }, '载入窗口1丢包示例'), h('button', { class: 'btn', onclick: () => load('gap') }, '载入越序缓冲示例'), h('button', { class: 'btn', onclick: () => load('early') }, '载入过早超时示例'), h('button', { class: 'btn primary', onclick: run }, '模拟时序')));
    }
    function run() {
      try { result = simulate(draft); selected = 0; persist(); renderOutput(); message(`全程模拟已完成；当前查看tick0。全部确认tick${result.completedAt}，在途排空tick${result.endedAt}；不会进行网络连接。`); }
      catch (error) { result = null; renderOutput(); message(error.message, true); }
    }
    function pick(index) { if (!result || !Number.isInteger(index)) return; selected = Math.max(0, Math.min(result.trace.length - 1, index)); renderOutput(); }
    const list = (values) => values.length ? values.join('、') : '无';
    function snapshotView(state, title) {
      return h('div', { class: 'l016-state' }, h('h4', {}, title), h('p', {}, `发送端累计ACK=${state.ackNext}；未确认=${list(state.outstanding)}；下一未发送包=${state.nextPacket > result.input.packetCount ? '无' : state.nextPacket}`), h('p', {}, `接收端下一期待=${state.receiverNext}；连续交付=${list(state.delivered)}；越序缓冲=${list(state.buffer)}`), h('p', {}, `当前RTO=${state.rto}；超时到期=${state.deadline ?? '关闭'}`));
    }
    function timeline() {
      return h('div', { class: 'l016-timeline-scroll' }, h('div', { class: 'l016-timeline' }, h('div', { class: 'l016-lane l016-lane-head' }, ['tick', '发送端', '传输通道', '接收端'].map((label) => h('strong', {}, label))), result.trace.filter((frame) => frame.events.length).map((frame) => {
        const sender = frame.events.filter((entry) => ['send', 'ack-receive', 'timeout'].includes(entry.type)); const receiver = frame.events.filter((entry) => ['receive', 'ack-send'].includes(entry.type)); const transit = frame.events.filter((entry) => ['send', 'drop', 'ack-send'].includes(entry.type));
        return h('div', { class: `l016-lane${frame.tick === selected ? ' is-selected' : ''}` }, h('button', { class: 'btn', onclick: () => pick(frame.tick) }, `查看tick${frame.tick}`), h('div', {}, sender.map((entry) => h('p', {}, `${TYPE_LABELS[entry.type]}：${entry.type === 'ack-receive' ? `ACK${entry.ack}${entry.fresh ? '（新确认）' : '（重复）'}` : `包${entry.packet}${entry.retransmission ? '（重传）' : ''}`}`))), h('div', {}, transit.map((entry) => h('p', { class: entry.type === 'drop' ? 'l016-warning' : '' }, entry.type === 'drop' ? `× 包${entry.packet}首次丢弃` : entry.type === 'send' ? `DATA ${entry.packet} → 预计tick${entry.arrivesAt}` : `← ACK${entry.ack}，tick${entry.arrivesAt}`))), h('div', {}, receiver.map((entry) => h('p', {}, entry.type === 'receive' ? `收到包${entry.packet}（${entry.disposition === 'duplicate' ? '重复' : entry.disposition === 'out-of-order' ? '越序缓冲' : '按序'}）` : `发ACK${entry.ack}`))));
      })));
    }
    function renderOutput() {
      const exports = h('div', { class: 'l016-actions' }, h('button', { class: 'btn', onclick: () => exportReport('json') }, '导出完整 JSON'), h('button', { class: 'btn', onclick: () => exportReport('md') }, '导出完整 Markdown'));
      if (!result) { replace(output, h('p', {}, '请模拟当前参数，再单步查看发送、接收、累计ACK与超时。当前没有完成报告，可导出草稿。'), exports); return; }
      const frame = result.trace[selected]; const state = frame.after;
      const selector = h('select', { class: 'field', 'aria-label': '查看tick', onchange: () => pick(Number(selector.value)) }, result.trace.map((row) => h('option', { value: String(row.tick) }, `tick${row.tick} · ${row.events.length}事件`))); selector.value = String(selected);
      replace(output, h('div', { class: 'l016-summary' }, `全程报告：${result.input.packetCount}包全部确认tick${result.completedAt} · 在途排空tick${result.endedAt} · 重传${result.retransmissions.length}次`), h('p', {}, `最终收到唯一包${list(result.final.received)}，连续交付${list(result.final.delivered)}。以下状态对应当前查看tick，不是最终状态。`),
        h('div', { class: 'l016-actions' }, selector, h('button', { class: 'btn', disabled: selected === 0, onclick: () => pick(selected - 1) }, '上一tick'), h('button', { class: 'btn', disabled: selected === result.trace.length - 1, onclick: () => pick(selected + 1) }, '下一tick')),
        h('h3', {}, `当前查看tick${frame.tick}`), h('div', { class: 'l016-columns' }, snapshotView(frame.before, 'tick处理前'), snapshotView(frame.after, 'tick处理后')),
        frame.events.length ? h('ol', {}, frame.events.map((entry) => h('li', {}, `事件${entry.id} ${TYPE_LABELS[entry.type]}：${entry.message}`))) : h('p', {}, '本tick无事件，等待数据/ACK在途到达或超时；定时器不会因查看而改变。'),
        table(['包号', '发送端', '接收端', '发送次数'], Array.from({ length: result.input.packetCount }, (_, index) => { const packet = index + 1; return h('tr', {}, [packet, packet < state.ackNext ? '已累计确认' : state.attempts[index] ? '已发送，未确认' : '未发送', packet < state.receiverNext ? '已连续交付' : state.buffer.includes(packet) ? '已收到，越序缓冲' : '尚未收到', state.attempts[index]].map((cell) => h('td', {}, String(cell)))); }), `tick${frame.tick}处理后的逐包状态；接收与发送端确认是两件事`),
        table(['方向', '包/ACK', '到达tick', '次数'], state.inFlight.length ? state.inFlight.map((entry) => h('tr', {}, [entry.kind === 'data' ? '发送→接收' : '接收→发送', entry.kind === 'data' ? `包${entry.packet}` : `ACK${entry.ack}`, entry.due, entry.attempt ?? '—'].map((cell) => h('td', {}, String(cell))))) : [h('tr', {}, h('td', { colspan: '4' }, '没有在途事件'))], `tick${frame.tick}后的传输通道，不含已丢弃包`),
        h('h3', {}, '完整收发时间线'), h('p', {}, '只显示有事件tick；中间无事件tick仍在单步轨迹与导出中，未被截断。→为数据方向，←为ACK方向。'), timeline(),
        h('details', {}, h('summary', {}, '完整发送 / 确认 / 重传列表'),
          table(['tick', '包号', '次数', '类型', '预计接收'], result.sends.map((entry) => h('tr', {}, [entry.tick, entry.packet, entry.attempt, entry.retransmission ? '超时重传' : '首次发送', entry.dropped ? '首次丢弃，不到达' : entry.arrivesAt].map((cell) => h('td', {}, String(cell))))), '所有发送尝试'),
          table(['tick', '累计ACK', '是否新确认', '本次确认包'], result.acknowledgments.map((entry) => h('tr', {}, [entry.tick, entry.ack, entry.fresh ? '是' : '重复/旧ACK', list(entry.confirmed)].map((cell) => h('td', {}, String(cell))))), 'ACK到达发送端：ACK n确认1至n−1'),
          table(['tick', '重传包', '发送次数'], result.retransmissions.length ? result.retransmissions.map((entry) => h('tr', {}, [entry.tick, entry.packet, entry.attempt].map((cell) => h('td', {}, String(cell))))) : [h('tr', {}, h('td', { colspan: '3' }, '没有重传'))], '只重传最早未确认包，重复ACK不触发快速重传')),
        exports,
      );
    }
    async function exportReport(extension) {
      if (exporting) return;
      const files = window.toolbox?.files;
      if (!files?.saveTextSupportsCopyOnly) { message('当前基础层缺少防覆盖导出能力，请升级后导出。', true); return; }
      exporting = true;
      try {
        const payload = { feature: 'L016', schemaVersion: 1, modelVersion: MODEL_VERSION, exportedAt: new Date().toISOString(), draft: JSON.parse(JSON.stringify(draft)), result };
        const response = await files.saveText({ content: extension === 'json' ? JSON.stringify(payload, null, 2) : reportMarkdown(payload), extension, defaultName: `L016-loss-timeline.${extension}`, copyOnly: true });
        message(response?.ok ? '已导出新文件，包含全部tick、事件与收发快照。' : response?.canceled ? '已取消导出，输入与结果保留。' : `导出失败：${response?.error || '未确认保存成功'}`, !response?.ok && !response?.canceled);
      } catch (error) { message(`导出失败：${error.message}`, true); }
      finally { exporting = false; }
    }
    root.replaceChildren(h('link', { rel: 'stylesheet', href: new URL('./style.css', import.meta.url).href }), h('h2', {}, 'TCP 丢包时序'), h('p', {}, '单连接固定窗口的教学时序：看缺包如何限制累计ACK，以及超时后具体重传了哪一个包。'), notice, storageNotice,
      h('details', {}, h('summary', {}, '模型规则、协议参考与保存范围'), h('p', {}, POLICY), h('p', {}, `最多模拟至tick${MAX_TICK}、最多${MAX_EVENTS}事件；超限整轮拒绝，不输出截断完成报告。接收端缓冲最多全部30包，不模拟真实接收窗口、ACK丢失或延迟ACK。过早超时会重传仍在途的包，重复到达不重复交付。`), h('p', {}, '参考 ', h('a', { href: 'https://www.rfc-editor.org/rfc/rfc9293.html#section-3.4', target: '_blank', rel: 'noopener noreferrer' }, 'RFC 9293 §3.4'), ' 累计ACK，以及 ', h('a', { href: 'https://www.rfc-editor.org/rfc/rfc6298.html#section-5', target: '_blank', rel: 'noopener noreferrer' }, 'RFC 6298 §5'), ' 定时器规则。使用抽象包号/tick，省略字节序号回绕、握手、RTT估计、拥塞控制和真实秒制RTO，不是完整TCP，不建立连接或抓包。'), h('p', {}, '只保存≤64KiB版本化参数草稿，收发轨迹不持久化；切走没有后台模拟。JSON/Markdown导出全部状态副本并拒绝覆盖已有文件。')), editor, output);
    renderEditor(); renderOutput();
    return { activate() {}, deactivate() { persist(); }, destroy() { persist(); destroyed = true; root.replaceChildren(); root.classList.remove('feature-l016'); } };
  },
};
