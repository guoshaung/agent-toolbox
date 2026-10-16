export const MODEL_VERSION = '1.0';
export const MAX_TICK = 2048;
export const MAX_EVENTS = 512;
export const MAX_RTO = 1024;
export const FIELDS = ['packetCount', 'window', 'delay', 'timeout', 'drops'];
export const POLICY = '固定窗口按包数计；包号1起，每包一个抽象序号单位。ACK n表示1至n−1已连续收到，下一缺包为n。接收端保留越序包，重复包不重复交付；每次到包立即发累计ACK，ACK不丢失；教学逐包ACK，不模拟批量聚合或延迟ACK。同tick按数据到达→ACK到达→超时→填充发送窗口处理；到达按入网顺序。单定时器只重传最早未确认包，超时RTO翻倍（上限1024tick），新累计ACK重启当前RTO，重复ACK不重启；无快速重传/拥塞控制/RTT估计。';
export const TYPE_LABELS = { send: '发送', drop: '首次丢包', receive: '接收', 'ack-send': 'ACK发出', 'ack-receive': 'ACK到达', timeout: '超时' };
function integer(value, label, min, max) {
  if (!['string', 'number'].includes(typeof value) || !/^\d+$/.test(String(value).trim())) throw new Error(`${label}须为十进制整数。`);
  const number = Number(value); if (!Number.isSafeInteger(number) || number < min || number > max) throw new Error(`${label}须在${min}至${max}之间。`); return number;
}
export function validateInput(draft) {
  if (!draft || typeof draft !== 'object') throw new Error('输入对象无效。');
  const packetCount = integer(draft.packetCount, '包数', 1, 30); const window = integer(draft.window, '窗口', 1, 8); const delay = integer(draft.delay, '单向延迟', 1, 20); const timeout = integer(draft.timeout, '初始超时', 1, 64);
  if (typeof draft.drops !== 'string' || new TextEncoder().encode(draft.drops).byteLength > 256) throw new Error('首次丢包列表须为≤256字节文本。');
  const drops = draft.drops.trim() ? draft.drops.trim().split(/[\s,，]+/).map((item) => integer(item, '首次丢包号', 1, packetCount)) : [];
  if (new Set(drops).size !== drops.length) throw new Error('首次丢包列表包含重复包号。');
  return { packetCount, window, delay, timeout, drops };
}
export function simulate(draft, limits = {}) {
  const input = validateInput(draft); const tickLimit = integer(limits.maxTick ?? MAX_TICK, '模拟tick上限', 1, MAX_TICK); const eventLimit = integer(limits.maxEvents ?? MAX_EVENTS, '事件上限', 1, MAX_EVENTS);
  const losses = new Set(input.drops); const outstanding = new Set(); const buffer = new Set(); const received = new Set(); const attempts = Array(input.packetCount + 1).fill(0); const inFlight = [];
  const events = []; const trace = []; let networkId = 0; let nextPacket = 1; let ackNext = 1; let receiverNext = 1; let rto = input.timeout; let deadline = null; let completedAt = null;
  function event(tick, type, details, message) {
    if (events.length >= eventLimit) throw new Error(`事件数超过${eventLimit}上限；未生成完成结果，不会截断轨迹。请减少包数/丢包或增大超时。`);
    events.push({ id: events.length + 1, tick, type, ...details, message });
  }
  function snapshot() { return { nextPacket, ackNext, outstanding: [...outstanding].sort((a, b) => a - b), receiverNext, received: [...received].sort((a, b) => a - b), buffer: [...buffer].sort((a, b) => a - b), delivered: Array.from({ length: receiverNext - 1 }, (_, index) => index + 1), rto, deadline, attempts: attempts.slice(1), inFlight: structuredClone(inFlight).sort((a, b) => a.due - b.due || a.id - b.id) }; }
  function send(tick, packet, retransmission) {
    attempts[packet]++; outstanding.add(packet);
    event(tick, 'send', { packet, attempt: attempts[packet], retransmission, dropped: attempts[packet] === 1 && losses.has(packet), arrivesAt: tick + input.delay }, `${retransmission ? '重传' : '首次发送'}包${packet}（第${attempts[packet]}次），单向延迟${input.delay}tick。`);
    if (attempts[packet] === 1 && losses.has(packet)) event(tick, 'drop', { packet, attempt: 1 }, `包${packet}首次发送被丢弃；重传不再丢弃。`);
    else inFlight.push({ id: ++networkId, kind: 'data', due: tick + input.delay, packet, attempt: attempts[packet] });
    if (deadline === null) deadline = tick + rto;
  }
  for (let tick = 0; tick <= tickLimit; tick++) {
    const before = snapshot(); const firstEvent = events.length;
    const arriving = inFlight.filter((entry) => entry.due === tick).sort((a, b) => a.id - b.id);
    for (let index = inFlight.length - 1; index >= 0; index--) if (inFlight[index].due === tick) inFlight.splice(index, 1);
    for (const entry of arriving.filter((entry) => entry.kind === 'data')) {
      let disposition; const released = [];
      if (entry.packet < receiverNext || buffer.has(entry.packet)) disposition = 'duplicate';
      else {
        received.add(entry.packet);
        if (entry.packet > receiverNext) { buffer.add(entry.packet); disposition = 'out-of-order'; }
        else { disposition = 'in-order'; released.push(receiverNext++); while (buffer.has(receiverNext)) { buffer.delete(receiverNext); released.push(receiverNext++); } }
      }
      event(tick, 'receive', { packet: entry.packet, attempt: entry.attempt, disposition, released }, disposition === 'duplicate' ? `重复包${entry.packet}，不重复交付。` : disposition === 'out-of-order' ? `包${entry.packet}越序到达，缓冲等待缺包${receiverNext}。` : `按序交付包${released.join('、')}；下一需要包${receiverNext}。`);
      event(tick, 'ack-send', { ack: receiverNext, arrivesAt: tick + input.delay }, `立即发ACK${receiverNext}，累计确认1至${receiverNext - 1}；仍缺${receiverNext <= input.packetCount ? `包${receiverNext}` : '无'}。`);
      inFlight.push({ id: ++networkId, kind: 'ack', due: tick + input.delay, ack: receiverNext });
    }
    for (const entry of arriving.filter((entry) => entry.kind === 'ack')) {
      const fresh = entry.ack > ackNext; const confirmed = fresh ? Array.from({ length: entry.ack - ackNext }, (_, index) => ackNext + index) : [];
      if (fresh) { ackNext = entry.ack; for (const packet of confirmed) outstanding.delete(packet); deadline = outstanding.size ? tick + rto : null; }
      event(tick, 'ack-receive', { ack: entry.ack, fresh, confirmed }, fresh ? `累计ACK${entry.ack}确认包${confirmed.join('、')}，${outstanding.size ? `重启定时器至${deadline}` : '关闭定时器'}。` : `重复/旧ACK${entry.ack}，不改变窗口或定时器。`);
      if (ackNext === input.packetCount + 1 && completedAt === null) completedAt = tick;
    }
    if (deadline !== null && tick >= deadline && outstanding.size) {
      const packet = Math.min(...outstanding); const oldRto = rto; rto = Math.min(MAX_RTO, rto * 2);
      event(tick, 'timeout', { packet, oldRto, newRto: rto }, `定时器到期，只重传最早未确认包${packet}；RTO ${oldRto}→${rto}。`);
      deadline = null; send(tick, packet, true);
    }
    while (nextPacket <= input.packetCount && nextPacket < ackNext + input.window) send(tick, nextPacket++, false);
    trace.push({ tick, before, events: structuredClone(events.slice(firstEvent)), after: snapshot() });
    if (completedAt !== null && inFlight.length === 0) return { modelVersion: MODEL_VERSION, policy: POLICY, input, limits: { maxTick: tickLimit, maxEvents: eventLimit }, status: 'completed', completedAt, endedAt: tick, events, trace, final: snapshot(), sends: structuredClone(events.filter((entry) => entry.type === 'send')), retransmissions: structuredClone(events.filter((entry) => entry.type === 'send' && entry.retransmission)), acknowledgments: structuredClone(events.filter((entry) => entry.type === 'ack-receive')) };
  }
  throw new Error(`模拟tick超过${tickLimit}上限；未生成完成结果，不会截断或声称全部收到。请减少丢包/包数或调整参数。`);
}
export function example(kind = 'core') {
  if (kind === 'gap') return { packetCount: '3', window: '3', delay: '1', timeout: '4', drops: '2' };
  if (kind === 'early') return { packetCount: '1', window: '1', delay: '2', timeout: '1', drops: '' };
  return { packetCount: '3', window: '1', delay: '1', timeout: '4', drops: '2' };
}
export function prepareStoredState(draft) {
  if (!draft || FIELDS.some((key) => typeof draft[key] !== 'string')) throw new Error('草稿字段类型无效。');
  const serialized = JSON.stringify({ schemaVersion: 1, ...Object.fromEntries(FIELDS.map((key) => [key, draft[key]])) });
  if (new TextEncoder().encode(serialized).byteLength > 65536) throw new Error('草稿超过64KiB。');
  return JSON.parse(serialized);
}
export function validateStoredState(state) {
  if (!state || state.schemaVersion !== 1) throw new Error('草稿版本不支持。');
  if (new TextEncoder().encode(JSON.stringify(state)).byteLength > 65536) throw new Error('草稿超过64KiB。');
  return prepareStoredState(state);
}
export function reportMarkdown(payload) {
  const safe = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[|\r\n]/g, ' ');
  const lines = ['# L016 TCP 丢包时序', '', '教学抽象：无真实连接或抓包，按包序号单位而非TCP字节序号。', '', POLICY, '', '## 输入草稿', '', ...FIELDS.map((key) => `${key}：${safe(payload.draft[key])}`)];
  if (!payload.result) { lines.push('', '当前输入未完成有效模拟，未生成完成报告。'); return lines.join('\n'); }
  const result = payload.result;
  lines.push('', '## 结果', '', `全部确认tick=${result.completedAt}；在途事件排空tick=${result.endedAt}；重传包：${result.retransmissions.map((entry) => entry.packet).join('、') || '无'}；收到唯一包：${result.final.received.join('、')}；连续交付：${result.final.delivered.join('、')}。`, '', '|事件|tick|类型|说明|', '|---|---|---|---|');
  result.events.forEach((entry) => lines.push(`|${entry.id}|${entry.tick}|${TYPE_LABELS[entry.type]}|${safe(entry.message)}|`));
  for (const frame of result.trace) lines.push('', `### tick ${frame.tick}`, '', `之前：${JSON.stringify(frame.before)}`, '', `之后：${JSON.stringify(frame.after)}`, '', frame.events.length ? frame.events.map((entry) => entry.message).join('\n\n') : '等待在途数据/ACK或超时，没有事件。');
  lines.push('', '## 协议参考与简化', '', '[RFC 9293 §3.4](https://www.rfc-editor.org/rfc/rfc9293.html#section-3.4)：累计ACK使用下一期待序号。', '', '[RFC 6298 §5](https://www.rfc-editor.org/rfc/rfc6298.html#section-5)：参考单定时器、新ACK重启、最早未确认段重传和退避。模型不做RTT估计、真实秒制RTO、拥塞控制、握手、字节序号回绕或ACK丢失，不是完整TCP实现。');
  return lines.join('\n');
}
