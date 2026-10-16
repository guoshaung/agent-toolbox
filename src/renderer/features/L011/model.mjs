export const STAGES = ['IF', 'ID', 'EX', 'MEM', 'WB'];
export const POLICY = {
  stages: 'IF/ID/EX/MEM/WB；单发射、顺序执行、独立取指与数据存储器，无结构冒险或分支。',
  load: 'LOAD 结果在 MEM 末就绪；不能向同周期 EX 转发。',
  writeback: 'WB 先写寄存器，同周期 ID 后读；关闭转发时所有源都在 ID 读就绪值。',
  forwarding: 'ADD/地址在 EX 使用源；优先选择最近的较早生产者，MEM 中 ADD 或 WB 结果可转发到 EX。',
  store: 'STORE 基址在 EX 使用；数据在 EX 尝试刷新并锁存，MEM 可由 WB 再转发。紧邻 LOAD→STORE 数据无停顿，基址仍有一次 load-use 停顿。',
  zero: 'R0 恒为零；写 R0 的指令仍经过五级但不形成寄存器依赖。',
  values: '8 个寄存器；有限安全整数运算，不模拟32位溢出。内存地址为0至255的字索引，不是字节地址，未初始化字为0。',
};

function integer(value, label) {
  if (typeof value !== 'number' && typeof value !== 'string') throw new Error(`${label}需要十进制整数。`);
  if (typeof value === 'string' && !/^[+-]?\d+$/.test(value.trim())) throw new Error(`${label}需要十进制整数。`);
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new Error(`${label}超出安全整数范围。`);
  return result;
}
function reg(value) { return Number(value.slice(1)); }
export function parseProgram(source) {
  if (typeof source !== 'string' || source.length > 10000) throw new Error('指令文本为空或超过10000字符。');
  const instructions = [];
  source.split(/\r?\n/).forEach((raw, index) => {
    const text = raw.replace(/(?:#|\/\/).*$/, '').trim();
    if (!text) return;
    let match = text.match(/^ADD\s+(R[0-7])\s*,\s*(R[0-7])\s*,\s*(R[0-7])$/i);
    let instruction;
    if (match) instruction = { op: 'ADD', dest: reg(match[1]), left: reg(match[2]), right: reg(match[3]) };
    else {
      match = text.match(/^(LOAD|STORE)\s+(R[0-7])\s*,\s*\[\s*(R[0-7])\s*(?:([+-])\s*(\d+))?\s*\]$/i);
      if (!match) throw new Error(`第${index + 1}行语法不支持：只允许 ADD Rd,Rs,Rt、LOAD Rd,[Rb+整数]、STORE Rs,[Rb+整数]。`);
      const offset = match[4] ? integer(`${match[4]}${match[5]}`, `第${index + 1}行偏移`) : 0;
      instruction = match[1].toUpperCase() === 'LOAD' ? { op: 'LOAD', dest: reg(match[2]), base: reg(match[3]), offset } : { op: 'STORE', data: reg(match[2]), base: reg(match[3]), offset };
    }
    instructions.push({ ...instruction, id: `I${instructions.length + 1}`, index: instructions.length, line: index + 1, text });
  });
  if (!instructions.length || instructions.length > 40) throw new Error('请输入1至40条指令。');
  return instructions;
}
export function parseMemory(source) {
  if (typeof source !== 'string' || source.length > 5000) throw new Error('内存初值文本超过5000字符。');
  const memory = {};
  for (const [index, raw] of source.split(/\r?\n/).entries()) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) continue;
    const match = line.match(/^(\d+)\s*=\s*([+-]?\d+)$/);
    if (!match) throw new Error(`内存初值第${index + 1}行请使用 地址=整数。`);
    const address = integer(match[1], '内存地址');
    if (address < 0 || address > 255) throw new Error('内存地址需在0至255之间。');
    if (Object.hasOwn(memory, address)) throw new Error(`内存地址${address}重复定义。`);
    memory[address] = integer(match[2], '内存值');
  }
  return memory;
}
function sources(instruction) {
  return instruction.op === 'ADD' ? [instruction.left, instruction.right] : instruction.op === 'LOAD' ? [instruction.base] : [instruction.base, instruction.data];
}
function exSources(instruction) { return instruction.op === 'STORE' ? [instruction.base] : sources(instruction); }
function destination(unit) { return unit && unit.instruction.op !== 'STORE' && unit.instruction.dest !== 0 ? unit.instruction.dest : null; }

export function simulate(source, { forwarding = true, registers = Array(8).fill(0), memory = {} } = {}) {
  const instructions = parseProgram(source);
  if (typeof forwarding !== 'boolean') throw new Error('转发开关需要布尔值。');
  if (!memory || typeof memory !== 'object' || Array.isArray(memory)) throw new Error('内存初值需要地址到整数的对象。');
  if (!Array.isArray(registers) || registers.length !== 8) throw new Error('需要R0至R7共8个初值。');
  const values = registers.map((value, index) => integer(value, `R${index}`)); values[0] = 0;
  const words = {};
  for (const [key, value] of Object.entries(memory)) {
    const address = integer(key, '内存地址');
    if (address < 0 || address > 255) throw new Error('内存地址需在0至255之间。');
    words[address] = integer(value, '内存值');
  }
  const initial = { registers: [...values], memory: { ...words } };
  let next = 1;
  let pipeline = { IF: { instruction: instructions[0] }, ID: null, EX: null, MEM: null, WB: null };
  const frames = []; const stalls = [];
  for (let cycle = 1; STAGES.some((stage) => pipeline[stage]); cycle += 1) {
    if (cycle > instructions.length * 4 + 10) throw new Error('流水线未在界限内结束。');
    const events = [];
    const stageView = Object.fromEntries(STAGES.map((stage) => [stage, pipeline[stage] ? { id: pipeline[stage].instruction.id, text: pipeline[stage].instruction.text } : null]));
    const writer = pipeline.WB;
    if (destination(writer) !== null) { values[writer.instruction.dest] = writer.result; events.push(`WB ${writer.instruction.id}：写R${writer.instruction.dest}=${writer.result}，本周期ID可读。`); }
    const producer = (register, consumer, stages) => register === 0 ? null : stages.map((stage) => ({ stage, unit: pipeline[stage] })).filter(({ unit }) => destination(unit) === register && unit.instruction.index < consumer.index).sort((a, b) => b.unit.instruction.index - a.unit.instruction.index)[0] || null;
    function forwarded(register, unit, target, fallback, allowPending = false) {
      if (register === 0) return 0;
      const candidate = producer(register, unit.instruction, target === 'EX' ? ['MEM', 'WB'] : ['WB']);
      if (!candidate) return fallback;
      if (candidate.stage === 'MEM' && candidate.unit.instruction.op === 'LOAD') {
        if (allowPending) { events.push(`EX ${unit.instruction.id}：STORE数据R${register}等待LOAD ${candidate.unit.instruction.id}在MEM末产生，下一周期MEM再取。`); return fallback; }
        throw new Error(`内部时序错误：${unit.instruction.id}提前使用LOAD结果。`);
      }
      events.push(`${candidate.stage}→${target}：${candidate.unit.instruction.id}的R${register}=${candidate.unit.result}供${unit.instruction.id}${target === 'MEM' ? '的STORE数据' : ''}使用。`);
      return candidate.unit.result;
    }
    const accessing = pipeline.MEM;
    if (accessing?.instruction.op === 'LOAD') { accessing.result = words[accessing.address] ?? 0; events.push(`MEM ${accessing.instruction.id}：读M[${accessing.address}]=${accessing.result}，MEM末就绪。`); }
    if (accessing?.instruction.op === 'STORE') {
      const data = forwarding ? forwarded(accessing.instruction.data, accessing, 'MEM', accessing.storeData) : accessing.storeData;
      words[accessing.address] = data; events.push(`MEM ${accessing.instruction.id}：写M[${accessing.address}]=${data}。`);
    }
    const executing = pipeline.EX;
    if (executing) {
      const instruction = executing.instruction;
      const read = (register) => forwarding ? forwarded(register, executing, 'EX', executing.reads[register]) : executing.reads[register];
      if (instruction.op === 'ADD') { executing.result = integer(read(instruction.left) + read(instruction.right), `${instruction.id} ADD结果`); events.push(`EX ${instruction.id}：ADD结果${executing.result}，周期末就绪。`); }
      else {
        executing.address = integer(read(instruction.base) + instruction.offset, `${instruction.id}地址`);
        if (executing.address < 0 || executing.address > 255) throw new Error(`周期${cycle} ${instruction.id}内存地址${executing.address}超出0至255。`);
        events.push(`EX ${instruction.id}：计算字地址${executing.address}。`);
        if (instruction.op === 'STORE') executing.storeData = forwarding ? forwarded(instruction.data, executing, 'EX', executing.reads[instruction.data], true) : executing.reads[instruction.data];
      }
    }
    let blocked = null;
    const decoding = pipeline.ID;
    if (decoding) {
      for (const register of new Set(forwarding ? exSources(decoding.instruction) : sources(decoding.instruction))) {
        const dependency = producer(register, decoding.instruction, ['EX', 'MEM']);
        if (!dependency) continue;
        if (!forwarding || (dependency.stage === 'EX' && dependency.unit.instruction.op === 'LOAD')) {
          blocked = { cycle, consumer: decoding.instruction.id, producer: dependency.unit.instruction.id, register: `R${register}`, reason: forwarding ? 'load-use：LOAD在MEM末才就绪，下一周期EX来不及使用' : '无转发：等待生产者WB；WB同周期ID可读' };
          break;
        }
      }
      if (blocked) { stalls.push(blocked); events.push(`ID ${blocked.consumer}停顿：${blocked.register}等待${blocked.producer}；${blocked.reason}。冻结IF/ID，向EX插入空泡。`); }
      else { decoding.reads = Object.fromEntries(sources(decoding.instruction).map((register) => [register, register === 0 ? 0 : values[register]])); events.push(`ID ${decoding.instruction.id}：读取寄存器并进入下一周期EX。`); }
    }
    frames.push({ cycle, stages: stageView, stall: blocked, events, registers: [...values], memory: { ...words } });
    pipeline = {
      WB: pipeline.MEM, MEM: pipeline.EX, EX: blocked ? null : pipeline.ID,
      ID: blocked ? pipeline.ID : pipeline.IF,
      IF: blocked ? pipeline.IF : next < instructions.length ? { instruction: instructions[next++] } : null,
    };
  }
  const matrix = instructions.map((instruction) => ({ id: instruction.id, text: instruction.text, cells: frames.map((frame) => {
    const stage = STAGES.find((name) => frame.stages[name]?.id === instruction.id);
    return stage ? `${stage}${frame.stall?.consumer === instruction.id ? '*' : ''}` : '';
  }) }));
  return { feature: 'L011', schemaVersion: 1, modelVersion: 'five-stage-v1', policy: POLICY, program: source, instructions, forwarding: !!forwarding, initial, totalCycles: frames.length, stallCount: stalls.length, stalls, frames, matrix, final: { registers: [...values], memory: { ...words } } };
}

export function prepareStoredState(state) {
  const serialized = JSON.stringify({ ...state, schemaVersion: 1 });
  if (new TextEncoder().encode(serialized).byteLength > 65536) throw new Error('状态超过64KiB保存上限。');
  return JSON.parse(serialized);
}
export function validateStoredState(state) {
  if (!state || state.schemaVersion !== 1) throw new Error('状态版本不支持，需要schemaVersion:1。');
  prepareStoredState(state); return state;
}
export function reportMarkdown(result) {
  const lines = ['# 指令流水线实验', '', `模型：${result.modelVersion}；转发：${result.forwarding ? '开' : '关'}；总周期：${result.totalCycles}；停顿：${result.stallCount}`, '', ...Object.values(result.policy), '', '## 初值', '', result.initial.registers.map((value, index) => `R${index}=${value}`).join('，'), '', ...Object.entries(result.initial.memory).map(([address, value]) => `- M[${address}]=${value}`), '', '## 指令', '', result.program, '', '## 时序矩阵', '', `| 指令 | ${result.frames.map((frame) => `C${frame.cycle}`).join(' | ')} |`, `|---|${result.frames.map(() => '---').join('|')}|`, ...result.matrix.map((row) => `| ${row.id} ${row.text} | ${row.cells.map((cell) => cell || '·').join(' | ')} |`), '', 'ID* 表示该周期数据冒险停顿；IF同时冻结。', '', '## 逐周期原因'];
  for (const frame of result.frames) lines.push('', `### C${frame.cycle}`, ...frame.events.map((event) => `- ${event}`));
  lines.push('', '## 最终寄存器', '', result.final.registers.map((value, index) => `R${index}=${value}`).join('，'), '', '## 最终内存', '', ...Object.entries(result.final.memory).map(([address, value]) => `- M[${address}]=${value}`));
  return `${lines.join('\n')}\n`;
}
