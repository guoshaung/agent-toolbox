import { h, toast, mmss } from '../../core/ui.js';
import { NoisePlayer } from './noise.js';

/** 呼吸引导用 4-7-8：吸 4 秒、屏 7 秒、呼 8 秒，呼气比吸气长才会放松下来。 */
const BREATH = [
  { label: '吸气', seconds: 4, scale: 1.0 },
  { label: '屏住', seconds: 7, scale: 1.0 },
  { label: '呼气', seconds: 8, scale: 0.55 },
];

function decidePrompt(tasks, energy) {
  return `你在帮一个人对抗决策疲劳。他现在坐在电脑前，不知道该做哪件事。

他的精力状态：${energy}
他手上的事：
${tasks.map((t, i) => `${i + 1}. ${t}`).join('\n')}

请只挑出**一件**现在最该做的事。判断依据：和他当前精力匹配（没精力就挑轻的）、能在一两个番茄钟内推进、做完有实感。
再给一个 5 分钟内就能开始的第一步，要具体到动作（比如「打开 X 文件，把第一段读完」），不要写「先梳理一下思路」这种没法执行的。

严格只输出一个 JSON 对象，不要解释，不要用 markdown 代码块：
{"pick": "选中的那件事", "why": "为什么是它，一句话", "firstStep": "具体的第一步", "minutes": 建议专注的分钟数（数字）}`;
}

/** 番茄钟 / 白噪音 / 呼吸引导 / 不知道干什么。 */
export function createTimer(root, ctx) {
  const { config, bridge } = ctx;
  const noise = new NoisePlayer();

  // ---------- 番茄钟 ----------
  let phase = 'idle'; // idle | focus | break
  let remaining = 0;
  let ticker = null;

  const timeEl = h('div', { class: 'focus__time' }, mmss(config.get('focus.focusMin', 25) * 60));
  const phaseEl = h('div', { class: 'focus__phase faint' }, '准备好了就开始');
  const startBtn = h('button', { class: 'btn btn--primary focus__start', onclick: () => toggle() }, '开始专注');

  const focusMin = h('input', {
    type: 'number', class: 'field field--sm focus__num', min: '1', max: '180',
    value: String(config.get('focus.focusMin', 25)),
    onchange: () => {
      config.set('focus.focusMin', Number(focusMin.value) || 25);
      if (phase === 'idle') timeEl.textContent = mmss((Number(focusMin.value) || 25) * 60);
    },
  });
  const breakMin = h('input', {
    type: 'number', class: 'field field--sm focus__num', min: '1', max: '60',
    value: String(config.get('focus.breakMin', 5)),
    onchange: () => config.set('focus.breakMin', Number(breakMin.value) || 5),
  });

  function setPhase(next, minutes) {
    phase = next;
    remaining = Math.round(minutes * 60);
    timeEl.textContent = mmss(remaining);
    phaseEl.textContent = next === 'focus' ? '专注中 —— 别开新标签页' : next === 'break' ? '休息一下，站起来走两步' : '准备好了就开始';
    startBtn.textContent = next === 'idle' ? '开始专注' : '暂停';
    root.classList.toggle('is-focusing', next === 'focus');
  }

  function tick() {
    remaining -= 1;
    timeEl.textContent = mmss(remaining);
    if (remaining > 0) return;
    clearInterval(ticker);
    ticker = null;
    noise.chime();

    if (phase === 'focus') {
      logSession(Number(focusMin.value) || 25);
      new Notification('专注结束', { body: `干了 ${focusMin.value} 分钟，去休息 ${breakMin.value} 分钟。` });
      setPhase('break', Number(breakMin.value) || 5);
      ticker = setInterval(tick, 1000);
      startBtn.textContent = '暂停';
    } else {
      new Notification('休息结束', { body: '回来了，再来一轮？' });
      setPhase('idle', Number(focusMin.value) || 25);
    }
  }

  function toggle() {
    if (ticker) { // 运行中 → 暂停
      clearInterval(ticker);
      ticker = null;
      startBtn.textContent = '继续';
      phaseEl.textContent = '已暂停';
      return;
    }
    if (phase === 'idle') setPhase('focus', Number(focusMin.value) || 25);
    else phaseEl.textContent = phase === 'focus' ? '专注中 —— 别开新标签页' : '休息中';
    ticker = setInterval(tick, 1000);
    startBtn.textContent = '暂停';
    if (Notification.permission === 'default') Notification.requestPermission();
  }

  function reset() {
    clearInterval(ticker);
    ticker = null;
    setPhase('idle', Number(focusMin.value) || 25);
  }

  async function logSession(minutes) {
    const log = config.get('focus.log') || [];
    log.unshift({ at: Date.now(), minutes });
    await config.set('focus.log', log.slice(0, 200));
    renderStats();
  }

  const statsEl = h('div', { class: 'faint focus__stats' });
  function renderStats() {
    const log = config.get('focus.log') || [];
    const today = new Date().setHours(0, 0, 0, 0);
    const todays = log.filter((x) => x.at >= today);
    const minutes = todays.reduce((sum, x) => sum + x.minutes, 0);
    statsEl.textContent = todays.length
      ? `今天 ${todays.length} 个番茄，共 ${minutes} 分钟`
      : '今天还没开始';
  }

  // ---------- 白噪音 ----------
  const noiseButtons = h('div', { class: 'focus__noise' });
  for (const kind of NoisePlayer.kinds()) {
    noiseButtons.appendChild(h('button', {
      class: 'btn btn--sm',
      dataset: { kind: kind.value },
      onclick: (e) => {
        const active = noise.kind === kind.value;
        if (active) noise.stop();
        else noise.play(kind.value);
        config.set('focus.noise', noise.kind || null);
        for (const btn of noiseButtons.children) {
          btn.classList.toggle('is-active', btn.dataset.kind === noise.kind);
        }
      },
    }, kind.label));
  }
  const volume = h('input', {
    type: 'range', min: '0', max: '1', step: '0.05',
    value: String(config.get('focus.volume', 0.35)),
    oninput: () => { noise.setVolume(Number(volume.value)); config.set('focus.volume', Number(volume.value)); },
  });
  noise.setVolume(config.get('focus.volume', 0.35));

  // ---------- 呼吸引导 ----------
  const breathCircle = h('div', { class: 'focus__breath-circle' });
  const breathLabel = h('div', { class: 'focus__breath-label faint' }, '静不下来时，跟着呼吸一分钟');
  let breathTimer = null;
  const breathBtn = h('button', {
    class: 'btn btn--sm',
    onclick: () => {
      if (breathTimer) return stopBreath();
      breathBtn.textContent = '停止';
      let step = 0;
      const runStep = () => {
        const { label, seconds, scale } = BREATH[step % BREATH.length];
        breathLabel.textContent = `${label} ${seconds} 秒`;
        breathCircle.style.transitionDuration = `${seconds}s`;
        breathCircle.style.transform = `scale(${scale})`;
        step += 1;
        breathTimer = setTimeout(runStep, seconds * 1000);
      };
      runStep();
    },
  }, '开始呼吸引导');

  function stopBreath() {
    clearTimeout(breathTimer);
    breathTimer = null;
    breathCircle.style.transitionDuration = '.6s';
    breathCircle.style.transform = 'scale(1)';
    breathLabel.textContent = '静不下来时，跟着呼吸一分钟';
    breathBtn.textContent = '开始呼吸引导';
  }

  // ---------- 不知道干什么 ----------
  const taskInput = h('input', {
    class: 'field field--sm',
    placeholder: '手上还有什么事？回车添加',
    onkeydown: async (e) => {
      if (e.key !== 'Enter' || e.isComposing) return;
      const text = taskInput.value.trim();
      if (!text) return;
      const tasks = config.get('focus.tasks') || [];
      tasks.push(text);
      await config.set('focus.tasks', tasks);
      taskInput.value = '';
      renderTasks();
    },
  });
  const taskList = h('div', { class: 'focus__tasks' });

  function renderTasks() {
    const tasks = config.get('focus.tasks') || [];
    taskList.textContent = '';
    if (!tasks.length) {
      taskList.appendChild(h('div', { class: 'faint focus__note' }, '空的。随手记两件，下次不知道干什么时就有得选了。'));
      return;
    }
    tasks.forEach((task, index) => {
      taskList.appendChild(h('div', { class: 'focus__task' },
        h('span', {}, task),
        h('button', {
          class: 'btn btn--sm btn--ghost', title: '完成/删除',
          onclick: async () => {
            const list = config.get('focus.tasks') || [];
            list.splice(index, 1);
            await config.set('focus.tasks', list);
            renderTasks();
          },
        }, '×'),
      ));
    });
  }

  const energy = h('select', { class: 'field field--sm' },
    h('option', { value: '还行，能干点费脑子的' }, '还行'),
    h('option', { value: '有点累，只想干轻的' }, '有点累'),
    h('option', { value: '很累，快干不动了' }, '很累'),
    h('option', { value: '精神很好' }, '精神好'),
  );

  const decision = h('div', { class: 'focus__decision' });
  const decideBtn = h('button', {
    class: 'btn btn--primary',
    onclick: async () => {
      const tasks = config.get('focus.tasks') || [];
      if (!tasks.length) return toast('先在上面记两件事，它才有得挑', 'info');
      decideBtn.disabled = true;
      decision.textContent = '';
      decision.append(h('span', { class: 'spinner' }), ' 想想…');
      try {
        const result = await bridge.askJSON(decidePrompt(tasks, energy.value), { timeout: 70000 });
        const minutes = Number(result.minutes) || Number(focusMin.value) || 25;
        decision.textContent = '';
        decision.append(
          h('div', { class: 'focus__pick' }, result.pick || ''),
          h('div', { class: 'faint focus__why' }, result.why || ''),
          h('div', { class: 'focus__first-step' },
            h('span', { class: 'faint' }, '第一步：'), result.firstStep || '',
          ),
          h('button', {
            class: 'btn btn--primary',
            onclick: () => {
              focusMin.value = String(Math.min(180, Math.max(1, Math.round(minutes))));
              config.set('focus.focusMin', Number(focusMin.value));
              reset();
              toggle();
              toast(`开始 ${focusMin.value} 分钟：${result.pick}`, 'good');
            },
          }, `就干这个，${Math.round(minutes)} 分钟`),
        );
      } catch (err) {
        decision.textContent = '';
        decision.append(
          h('div', { class: 'faint' }, err.message),
          err.code === 'need-login'
            ? h('button', { class: 'btn btn--sm', style: { marginTop: '8px' }, onclick: () => ctx.goto('ask') }, '去登录 DeepSeek')
            : null,
        );
      } finally {
        decideBtn.disabled = false;
      }
    },
  }, '帮我决定');

  // ---------- 组装 ----------
  root.append(
    h('div', { class: 'bar' },
      statsEl,
      h('span', { style: { flex: 1 } }),
      h('button', { class: 'btn btn--sm btn--ghost', onclick: () => reset() }, '重置'),
    ),
    h('div', { class: 'focus__body' },
      h('section', { class: 'focus__timer card' },
        timeEl,
        phaseEl,
        h('div', { class: 'focus__controls' },
          startBtn,
          h('label', { class: 'subbar__label' }, '专注', focusMin, '分'),
          h('label', { class: 'subbar__label' }, '休息', breakMin, '分'),
        ),
      ),
      h('section', { class: 'card' },
        h('h3', { class: 'card__title' }, '背景音'),
        noiseButtons,
        h('label', { class: 'subbar__label focus__volume' }, '音量', volume),
        h('div', { class: 'faint focus__note' }, '实时合成，不占硬盘，也不会突然放广告。'),
      ),
      h('section', { class: 'card focus__breath' },
        h('h3', { class: 'card__title' }, '进入状态'),
        breathCircle,
        breathLabel,
        breathBtn,
      ),
      h('section', { class: 'card focus__decide' },
        h('h3', { class: 'card__title' }, '不知道干什么'),
        taskInput,
        taskList,
        h('div', { class: 'focus__decide-row' },
          h('label', { class: 'subbar__label' }, '现在精力', energy),
          decideBtn,
        ),
        decision,
      ),
    ),
  );

  renderTasks();
  renderStats();
  setPhase('idle', Number(focusMin.value) || 25);

  return { deactivate: () => stopBreath() };
}
