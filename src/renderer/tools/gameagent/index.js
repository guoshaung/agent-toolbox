import { h, toast } from '../../core/ui.js';
import { iconFor } from '../../core/icons.js';
import mascotDataUrl from './assets/mascot.js';

/**
 * 游戏控制 —— 视觉闭环 PoC 的驾驶舱。
 *
 * 真正干活的是 game-agent/ 下的 Python 子进程：
 *   截图 → 找目标 → 判左右 → 敲一下 A/D → 再截图。
 * 这一页只做三件事：让你一键把它跑起来、让你一眼看清它每一帧在判断什么、
 * 让它在任何意外下都立刻松开按键。
 *
 * 刻意不做的事：不读游戏内存、不注入、不挂钩 —— 和 OK-WW 一样只靠截图看画面。
 * 也不接 LLM / OCR / 寻路 / 战斗识别：战斗归 OK-WW，这里只管把目标拉回屏幕中心。
 */

const STORE_KEY = 'gameAgent.';
const HISTORY = 150;

/** 看板娘（data URL，CSP 只认 data:，加载失败就安静消失）。 */
const MASCOT_URL = mascotDataUrl;

/** 三个场景就是三种「按下去会发生什么」，别的参数都可以之后再调。 */
const SCENES = [
  {
    id: 'sim',
    title: '仿真演练 🧪',
    icon: 'flask',
    badge: '最安全',
    blurb: '内置虚拟游戏，不截图也不发键',
    detail: '先在这里确认闭环真的会收敛',
    source: 'sim',
    backend: 'null',
    needsWindow: false,
  },
  {
    id: 'test',
    title: '测试窗口 🖥️',
    icon: 'monitor',
    badge: '彩排',
    blurb: '截真实窗口，真的会发 A / D',
    detail: '看着红点一点点被拉回中心',
    source: 'screen',
    backend: 'sendinput',
    defaultWindow: 'AgentToolboxTestTarget',
    needsWindow: true,
  },
  {
    id: 'live',
    title: '真实游戏 🎮',
    icon: 'target',
    badge: '只读检测',
    blurb: '截游戏窗口，比较目标特征，不发送按键',
    detail: '识别结果需用真实标注验证；A/D 不能直接当成相机转向',
    source: 'screen',
    backend: 'null',
    needsWindow: true,
  },
];

const DECISIONS = {
  LEFT: { text: '目标偏左', glyph: '←', tone: 'left', note: '目标在中心左边，敲一下 A' },
  RIGHT: { text: '目标偏右', glyph: '→', tone: 'right', note: '目标在中心右边，敲一下 D' },
  CENTERED: { text: '已居中', glyph: '✓', tone: 'centered', note: '稳稳的，先松开 A/D' },
  LOST: { text: '目标不见啦', glyph: '?', tone: 'lost', note: '这一帧没找到目标，先不动' },
};

const PRESETS = [
  { id: 'red', label: '红色' },
  { id: 'yellow', label: '黄色' },
  { id: 'green', label: '绿色' },
  { id: 'blue', label: '蓝色' },
  { id: 'magenta', label: '品红' },
  { id: 'white', label: '白色' },
];

const SUGGEST_WINDOW = /鸣潮|wuthering|kuro|client-win64|ok-?ww|yuan?shen|genshin|原神/i;

export default {
  id: 'gameagent',
  title: '游戏',
  icon: 'target',
  hint: '截图检测与回放评估；真实游戏只读观察',

  create(root, ctx) {
    const { config } = ctx;
    root.classList.add('gameagent');

    const cfg = (key, fallback) => config.get(STORE_KEY + key, fallback);
    const persist = (key, value) => { config.set(STORE_KEY + key, value); };

    // ---------------------------------------------------------------- 运行态

    let status = 'idle'; // idle | starting | running | stopping
    let activeSceneId = SCENES.some((s) => s.id === cfg('scene', 'sim')) ? cfg('scene', 'sim') : 'sim';
    let history = [];
    let frameCount = 0;
    let installing = false;
    let resizeObserver = null;
    const sceneNodes = new Map();

    const sceneOf = (id = activeSceneId) => SCENES.find((s) => s.id === id) || SCENES[0];

    // ---------------------------------------------------------------- 顶部

    const mascot = h('img', {
      class: 'gameagent__mascot', src: MASCOT_URL, alt: '', draggable: 'false',
    });
    mascot.addEventListener('error', () => mascot.remove()); // CSP 或路径出问题时安静退场

    // ---------------------------------------------------------------- 启动台

    const powerGlyph = h('span', { class: 'gameagent__power-glyph' });
    const powerText = h('span', { class: 'gameagent__power-text' }, '启动');
    const powerButton = h('button', {
      class: 'gameagent__power', type: 'button', 'data-state': 'idle', onclick: onPower,
    }, h('span', { class: 'gameagent__power-halo' }), powerGlyph, powerText);

    const launchState = h('strong', { class: 'gameagent__launch-state' }, '未启动');
    const launchNote = h('span', { class: 'gameagent__launch-note' }, '选一个场景，然后按下左边那个圆钮。');

    const sceneHost = h('div', { class: 'gameagent__scenes' });
    for (const scene of SCENES) {
      const node = h('button', {
        class: 'gameagent__scene', type: 'button', 'data-scene': scene.id,
        onclick: () => selectScene(scene.id),
      },
        h('span', { class: 'gameagent__scene-top' },
          iconFor(scene.icon, 'gameagent__scene-icon'),
          h('span', { class: 'gameagent__scene-title' }, scene.title),
          h('span', { class: 'gameagent__scene-badge' }, scene.badge),
        ),
        h('span', { class: 'gameagent__scene-blurb' }, scene.blurb),
        h('span', { class: 'gameagent__scene-detail' }, scene.detail),
      );
      sceneNodes.set(scene.id, node);
      sceneHost.append(node);
    }

    // ---------------------------------------------------------------- 窗口选择

    const windowSelect = h('select', {
      class: 'field gameagent__window-select',
      onchange: () => {
        if (windowSelect.value) {
          windowInput.value = windowSelect.value;
          persist('windowTitle', windowInput.value);
        }
      },
    }, h('option', { value: '' }, '— 点右边「扫描」列出当前窗口 —'));

    const windowInput = h('input', {
      class: 'field', type: 'text',
      placeholder: '窗口标题的一部分，例如：鸣潮',
      value: cfg('windowTitle', ''),
      oninput: () => persist('windowTitle', windowInput.value.trim()),
    });

    const scanButton = h('button', { class: 'btn btn--sm', type: 'button', onclick: scanWindows },
      '扫描窗口');

    const windowRow = h('div', { class: 'gameagent__window' },
      h('div', { class: 'gameagent__window-head' },
        h('span', { class: 'gameagent__window-label' }, '游戏窗口'),
        h('span', { class: 'gameagent__window-tip' },
          '只读窗口标题和尺寸，用来定位截图区域 —— 不读游戏内容。'),
      ),
      h('div', { class: 'gameagent__window-pick' }, windowSelect, scanButton),
      windowInput,
    );

    // ---------------------------------------------------------------- 二次操作

    const testWindowButton = h('button', { class: 'btn btn--sm', type: 'button', onclick: toggleTestWindow },
      '打开测试窗口');
    const doctorButton = h('button', { class: 'btn btn--sm', type: 'button', onclick: runDoctor },
      '检查环境');
    const installButton = h('button', { class: 'btn btn--sm', type: 'button', onclick: installDeps, hidden: true },
      '安装依赖');
    const clearLogButton = h('button', {
      class: 'btn btn--sm', type: 'button',
      onclick: (event) => {
        // 它在 <summary> 里，不拦一下会顺带把折叠区收起来
        event.preventDefault();
        event.stopPropagation();
        logHost.replaceChildren();
      },
    }, '清空');

    // ---------------------------------------------------------------- 仪表盘

    const readout = (label, unit = '') => {
      const value = h('span', { class: 'gameagent__readout-value' }, '--');
      const node = h('div', { class: 'gameagent__readout' },
        h('span', { class: 'gameagent__readout-label' }, label),
        h('span', { class: 'gameagent__readout-num' }, value, unit ? h('em', {}, unit) : null),
      );
      return { node, set(v) { value.textContent = v; }, raw: value };
    };

    const fpsReadout = readout('FPS');
    const targetReadout = readout('目标 X', 'px');
    const centerReadout = readout('中心 X', 'px');
    const errorReadout = readout('误差', 'px');

    const decisionGlyph = h('span', { class: 'gameagent__verdict-glyph' }, '—');
    const decisionText = h('span', { class: 'gameagent__verdict-text' }, '待机');
    const decisionNote = h('span', { class: 'gameagent__verdict-note' }, '还没开始跑');
    const actionText = h('span', { class: 'gameagent__verdict-action' }, 'A/D 未发送');

    const verdict = h('div', { class: 'gameagent__verdict is-idle' },
      h('span', { class: 'gameagent__verdict-glyph-wrap' }, decisionGlyph),
      h('div', { class: 'gameagent__verdict-body' },
        decisionText,
        decisionNote,
        actionText,
      ),
    );

    // 方向轴：把「目标相对中心偏了多少」画成一根会动的轴，比看数字快得多
    const axisBand = h('div', { class: 'gameagent__axis-band' });
    const axisCenter = h('div', { class: 'gameagent__axis-center' });
    const axisDot = h('div', { class: 'gameagent__axis-dot' });
    const axis = h('div', { class: 'gameagent__axis' },
      h('span', { class: 'gameagent__axis-tag is-left' }, 'A ←'),
      axisBand, axisCenter, axisDot,
      h('span', { class: 'gameagent__axis-tag is-right' }, '→ D'),
    );

    const sparkline = h('canvas', { class: 'gameagent__spark' });
    const sparkHint = h('span', { class: 'gameagent__spark-hint' },
      '误差历史：绿线在阈值带里 = 已经收住了；橙色 = 还在追。');

    // ---------------------------------------------------------------- 参数（折叠）

    const sourceSelect = h('select', { class: 'field' },
      h('option', { value: 'sim' }, '内置仿真（不碰屏幕）'),
      h('option', { value: 'screen' }, '真实屏幕 / 游戏窗口'),
    );

    const backendSelect = h('select', { class: 'field' },
      h('option', { value: 'null' }, '空跑 —— 只判断，不发键'),
      h('option', { value: 'sendinput' }, 'SendInput（扫描码，游戏更容易认）'),
      h('option', { value: 'pyautogui' }, 'pyautogui'),
    );

    const presetSelect = h('select', { class: 'field' },
      ...PRESETS.map((p) => h('option', { value: p.id }, p.label)),
    );

    const detectorMode = h('select',{class:'field'},h('option',{value:'feature'},'目标特征匹配（推荐真实画面）'),h('option',{value:'template'},'固定图标模板'),h('option',{value:'color'},'颜色团块（演练）'));
    const targetTemplate = h('input',{class:'field',placeholder:'目标截图的完整路径'});
    detectorMode.value = cfg('detectorMode','feature');
    targetTemplate.value = cfg('targetTemplate','');
    const thresholdInput = h('input', {
      class: 'field', type: 'number', min: '10', max: '400', step: '5',
      value: String(cfg('threshold', 50)),
      onchange: () => { persist('threshold', Number(thresholdInput.value) || 50); drawSparkline(); updateAxisBand(); },
    });

    const fpsInput = h('input', {
      class: 'field', type: 'number', min: '2', max: '30', step: '1',
      value: String(cfg('fps', 8)),
      onchange: () => persist('fps', Number(fpsInput.value) || 8),
    });

    const pulseInput = h('input', {
      class: 'field', type: 'number', min: '20', max: '500', step: '10',
      value: String(cfg('maxPulseMs', 120)),
      onchange: () => persist('maxPulseMs', Number(pulseInput.value) || 120),
    });

    const invertToggle = h('input', { type: 'checkbox', onchange: () => persist('invertAxis', invertToggle.checked) });
    const previewToggle = h('input', { type: 'checkbox', onchange: () => persist('showPreviewWindow', previewToggle.checked) });
    const dumpToggle = h('input', { type: 'checkbox', onchange: () => persist('dumpFrames', dumpToggle.checked) });
    // 对应 Python 侧的 --fast：锁定目标后只截目标周围一小块 + 检测降到 960。
    // 实测 2560x1440 上整帧 49ms → 11.4ms（4.3x），是最值钱的一个开关。
    const fastToggle = h('input', { type: 'checkbox', onchange: () => persist('fast', fastToggle.checked) });

    // 先把持久化值灌进去，再按场景覆盖默认
    sourceSelect.value = cfg('source', 'sim');
    backendSelect.value = cfg('backend', 'null');
    presetSelect.value = cfg('preset', 'red');
    invertToggle.checked = Boolean(cfg('invertAxis', false));
    previewToggle.checked = Boolean(cfg('showPreviewWindow', false));
    dumpToggle.checked = Boolean(cfg('dumpFrames', false));
    fastToggle.checked = Boolean(cfg('fast', true));

    function field(label, control, hint) {
      return h('label', { class: 'gameagent__field' },
        h('span', { class: 'gameagent__field-label' }, label),
        control,
        hint ? h('span', { class: 'gameagent__field-hint' }, hint) : null,
      );
    }

    function switchRow(label, control, hint) {
      return h('label', { class: 'gameagent__switch' },
        h('span', { class: 'gameagent__switch-track' }, control, h('span', { class: 'gameagent__switch-knob' })),
        h('span', { class: 'gameagent__switch-copy' },
          h('span', { class: 'gameagent__switch-label' }, label),
          hint ? h('span', { class: 'gameagent__field-hint' }, hint) : null,
        ),
      );
    }

    // ---------------------------------------------------------------- 日志

    const logHost = h('div', { class: 'gameagent__log' });

    function appendLog(level, message) {
      const line = h('div', { class: `gameagent__log-line is-${level}` },
        h('span', { class: 'gameagent__log-time' }, new Date().toLocaleTimeString('zh-CN', { hour12: false })),
        h('span', { class: 'gameagent__log-text' }, String(message)));
      logHost.append(line);
      while (logHost.childElementCount > 400) logHost.firstChild.remove();
      logHost.scrollTop = logHost.scrollHeight;
    }

    // ---------------------------------------------------------------- 场景切换

    function selectScene(id, { silent = false } = {}) {
      activeSceneId = id;
      const scene = sceneOf(id);
      persist('scene', id);

      for (const [key, node] of sceneNodes) node.classList.toggle('is-active', key === id);

      // 场景决定默认的截图来源 / 输入方式，参数面板里仍可手动覆盖
      sourceSelect.value = scene.source;
      backendSelect.value = scene.backend;
      windowRow.hidden = !scene.needsWindow;
      if (scene.defaultWindow && !windowInput.value.trim()) windowInput.value = scene.defaultWindow;
      if (scene.needsWindow && !windowInput.value.trim()) windowInput.value = cfg('windowTitle', '');

      powerText.textContent = scene.source === 'sim' ? '启动演练' : '启动';
      if (!silent && status === 'idle') {
        launchNote.textContent = scene.source === 'sim'
          ? '不碰屏幕、不发键，纯看闭环能不能收敛。'
          : '真实游戏只做截图观察；测试窗口可验证 A/D 闭环。';
      }
      syncStateCopy();
    }

    function syncStateCopy() {
      const scene = sceneOf();
      const running = status === 'running';
      const busy = status === 'stopping' || status === 'starting';
      launchState.textContent = running ? '运行中'
        : status === 'stopping' ? '正在收手…'
          : status === 'starting' ? '启动中…' : '未启动';
      launchState.dataset.tone = running ? 'live' : busy ? 'busy' : 'idle';

      if (running) {
        launchNote.textContent = scene.source === 'sim'
          ? `仿真演练跑着（第 ${frameCount} 帧），F8 暂停、ESC 退出。`
          : scene.id === 'live' ? `只读观察「${windowInput.value.trim() || '游戏'}」，不会发送 A/D；仅在游戏前台时采样。` : `正在截「${windowInput.value.trim() || '测试窗口'}」，只有测试窗口在前台时才发键。`;
      } else if (!busy && status === 'idle') {
        launchNote.textContent = scene.source === 'sim'
          ? '不碰屏幕、不发键，纯看闭环能不能收敛。'
          : '真实游戏只做截图观察；测试窗口可验证 A/D 闭环。';
      }
    }

    // ---------------------------------------------------------------- 动作

    function currentConfig() {
      const scene = sceneOf();
      const payload = {
        source: sourceSelect.value,
        preset: presetSelect.value,
        mode: scene.id === 'live' ? detectorMode.value : 'color',
        template: targetTemplate.value.trim(),
        backend: backendSelect.value,
        threshold: Number(thresholdInput.value) || 50,
        fps: Number(fpsInput.value) || 8,
        maxPulseMs: Number(pulseInput.value) || 120,
        invertAxis: invertToggle.checked,
        fast: fastToggle.checked,
      };
      const title = windowInput.value.trim();
      if (title) {
        payload.windowTitle = title;
        payload.focusTitle = title;
        payload.focusMode = 'block';
      } else {
        payload.focusMode = 'off';
      }
      if (scene.source === 'screen' && !previewToggle.checked) payload.noWindow = true;
      if (dumpToggle.checked) payload.dumpDir = 'work/ui-run';
      return payload;
    }

    function persistForm() {
      persist('scene', activeSceneId);
      persist('source', sourceSelect.value);
      persist('backend', backendSelect.value);
      persist('preset', presetSelect.value);
      persist('detectorMode',detectorMode.value);
      persist('targetTemplate',targetTemplate.value.trim());
      persist('threshold', Number(thresholdInput.value) || 50);
      persist('fps', Number(fpsInput.value) || 8);
      persist('maxPulseMs', Number(pulseInput.value) || 120);
      persist('windowTitle', windowInput.value.trim());
      persist('invertAxis', invertToggle.checked);
      persist('showPreviewWindow', previewToggle.checked);
      persist('dumpFrames', dumpToggle.checked);
      persist('fast', fastToggle.checked);
    }

    async function onPower() {
      if (status === 'running' || status === 'stopping') { await stopAgent(); return; }
      await startAgent();
    }

    async function startAgent() {
      if (status !== 'idle') return;
      const payload = currentConfig();
      if (sceneOf().id === 'live' && payload.mode !== 'color' && !payload.template) { toast('请填写目标截图路径，或者先用颜色演练观察误识别。','bad'); return; }
      const scene = sceneOf();

      if (scene.needsWindow && !payload.windowTitle) {
        toast('先选一个游戏窗口：点「扫描窗口」挑一个，或直接填标题里的几个字', 'bad', 6000);
        return;
      }
      if (payload.source === 'screen' && payload.backend !== 'null') {
        const answer = window.confirm(
          `即将向「${payload.windowTitle || '当前前台窗口'}」真实发送 A / D 键。\n\n`
          + '· 这是第一次用的话，建议先在「仿真演练」和「测试窗口」里确认\n'
          + '· 全程按 ESC 可立即退出并松开所有按键\n'
          + '· 请只在单机或允许自动化的环境里使用\n\n确定继续吗？');
        if (!answer) return;
      }

      persistForm();
      history = [];
      frameCount = 0;
      status = 'starting';
      renderPowerButton();
      syncStateCopy();
      startButtonBusy(true);

      try {
        const result = await window.toolbox.gameAgent.start(payload);
        if (!result.ok) {
          toast(result.error || '启动失败', 'bad', 6000);
          appendLog('error', result.error || '启动失败');
          status = 'idle';
          renderPowerButton();
          syncStateCopy();
          startButtonBusy(false);
          return;
        }
        appendLog('info', `已启动 pid=${result.pid}`);
        applyStatus('running');
      } catch (error) {
        toast(`启动失败：${error.message}`, 'bad', 6000);
        status = 'idle';
        renderPowerButton();
        syncStateCopy();
        startButtonBusy(false);
      }
    }

    async function stopAgent() {
      if (status === 'idle') return;
      status = 'stopping';
      renderPowerButton();
      syncStateCopy();
      try {
        await window.toolbox.gameAgent.stop();
        appendLog('warn', '已请求停止：先让它自己松键，超时才强杀。');
      } catch (error) {
        toast(`停止失败：${error.message}`, 'bad', 6000);
      }
    }

    function startButtonBusy(busy) {
      powerButton.disabled = busy;
    }

    let testWindowOpen = false;
    async function toggleTestWindow() {
      try {
        const result = testWindowOpen
          ? await window.toolbox.gameAgent.closeTestWindow()
          : await window.toolbox.gameAgent.openTestWindow();
        if (!result.ok) { toast(result.error || '操作失败', 'bad', 5000); return; }
        testWindowOpen = !testWindowOpen;
        testWindowButton.textContent = testWindowOpen ? '关闭测试窗口' : '打开测试窗口';
        if (testWindowOpen) {
          appendLog('info', '测试窗口已打开：黑底 + 会漂移的红点，而且它认 A / D。');
          toast('测试窗口开好了，点「扫描窗口」把它选上', 'good', 4600);
          scanWindows();
        }
      } catch (error) {
        toast(`操作失败：${error.message}`, 'bad', 5000);
      }
    }

    async function scanWindows() {
      scanButton.disabled = true;
      scanButton.textContent = '扫描中…';
      try {
        const result = await window.toolbox.gameAgent.listWindows();
        if (!result.ok) { toast(result.error || '扫描失败', 'bad', 6000); return; }
        const current = windowInput.value.trim();
        windowSelect.replaceChildren(h('option', { value: '' }, `— 共 ${result.windows.length} 个可见窗口 —`));
        for (const item of result.windows) {
          const star = SUGGEST_WINDOW.test(`${item.title} ${item.process}`) ? '★ ' : '';
          const label = `${star}${item.title}  ·  ${item.width}×${item.height}`
            + (item.process ? `  ·  ${item.process}` : '')
            + (item.minimized ? '  ·  最小化' : '');
          windowSelect.append(h('option', { value: item.title }, label));
        }
        if (current) {
          const hit = result.windows.find((w) => w.title.includes(current));
          windowSelect.value = hit ? hit.title : '';
        }
        appendLog('info', `扫到 ${result.windows.length} 个可见窗口，带 ★ 的看起来像游戏或 OK-WW。`);
      } catch (error) {
        toast(`扫描失败：${error.message}`, 'bad', 6000);
      } finally {
        scanButton.disabled = false;
        scanButton.textContent = '扫描窗口';
      }
    }

    async function runDoctor() {
      doctorButton.disabled = true;
      doctorButton.textContent = '检查中…';
      try {
        const info = await window.toolbox.gameAgent.doctor();
        appendLog(info.depsReady ? 'good' : 'error',
          `环境：python=${info.python}  ${info.detail}`);
        installButton.hidden = info.depsReady;
        if (info.depsReady) {
          toast('Python 环境就绪', 'good', 3000);
        } else {
          toast('依赖没装齐，点「安装依赖」', 'bad', 6000);
          logFold.open = true;
        }
      } catch (error) {
        toast(`检查失败：${error.message}`, 'bad', 6000);
      } finally {
        doctorButton.disabled = false;
        doctorButton.textContent = '检查环境';
      }
    }

    async function installDeps() {
      if (installing) return;
      installing = true;
      installButton.disabled = true;
      installButton.textContent = '安装中…';
      logFold.open = true;
      appendLog('info', '开始安装依赖，日志会一行行打在这里…');
      try {
        const result = await window.toolbox.gameAgent.installDeps();
        if (!result.ok) {
          toast(result.error || '安装失败', 'bad', 6000);
          installing = false;
          installButton.disabled = false;
          installButton.textContent = '安装依赖';
        }
      } catch (error) {
        toast(`安装失败：${error.message}`, 'bad', 6000);
        installing = false;
        installButton.disabled = false;
        installButton.textContent = '安装依赖';
      }
    }

    // ---------------------------------------------------------------- 渲染

    function renderPowerButton() {
      powerButton.dataset.state = status === 'running' ? 'running'
        : status === 'stopping' ? 'busy'
          : status === 'starting' ? 'busy' : 'idle';
      powerButton.disabled = status === 'starting' || status === 'stopping';
      powerText.textContent = status === 'running' ? '停止'
        : status === 'stopping' ? '收手中'
          : status === 'starting' ? '启动中'
            : (sceneOf().source === 'sim' ? '启动演练' : '启动');
    }

    function applyStatus(next) {
      status = next;
      renderPowerButton();
      syncStateCopy();
      if (next === 'idle') {
        decisionGlyph.textContent = '—';
        decisionText.textContent = '待机';
        decisionNote.textContent = '还没开始跑';
        actionText.textContent = 'A/D 未发送';
        verdict.className = 'gameagent__verdict is-idle';
        axisDot.classList.add('is-lost');
        axisDot.style.left = '50%';
      }
    }

    function updateAxisBand() {
      const threshold = Number(thresholdInput.value) || 50;
      const span = Math.max(threshold * 6, 240);
      const width = Math.min(60, (threshold / span) * 100);
      axisBand.style.width = `${width}%`;
    }

    function updateAxis(error) {
      const threshold = Number(thresholdInput.value) || 50;
      const span = Math.max(threshold * 6, 240);
      if (error == null) {
        axisDot.classList.add('is-lost');
        axisDot.style.left = '50%';
        return;
      }
      axisDot.classList.remove('is-lost');
      axisDot.classList.toggle('is-inside', Math.abs(error) <= threshold);
      const ratio = Math.max(-1, Math.min(1, error / span));
      axisDot.style.left = `${50 + ratio * 47}%`;
    }

    function drawSparkline() {
      const dpr = window.devicePixelRatio || 1;
      const cssWidth = sparkline.clientWidth || 720;
      const cssHeight = 92;
      sparkline.width = Math.round(cssWidth * dpr);
      sparkline.height = Math.round(cssHeight * dpr);
      const context = sparkline.getContext('2d');
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, cssWidth, cssHeight);

      const threshold = Number(thresholdInput.value) || 50;
      const peak = Math.max(threshold * 3, ...history.map((v) => Math.abs(v)), threshold);
      const mid = cssHeight / 2;
      const usable = cssHeight / 2 - 8;

      // 阈值带：只要线落进来，就说明目标已经在中心附近了
      context.fillStyle = 'rgba(63,185,138,.10)';
      const bandHalf = (threshold / peak) * usable;
      context.fillRect(0, mid - bandHalf, cssWidth, bandHalf * 2);

      context.strokeStyle = 'rgba(120,132,155,.35)';
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(0, mid);
      context.lineTo(cssWidth, mid);
      context.stroke();

      if (history.length < 2) return;
      const step = cssWidth / Math.max(1, HISTORY - 1);
      const total = history.length;
      const offset = cssWidth - (total - 1) * step;
      context.lineWidth = 2;
      for (let i = 1; i < total; i += 1) {
        const x0 = offset + (i - 1) * step;
        const x1 = offset + i * step;
        const y0 = mid - Math.max(-1, Math.min(1, history[i - 1] / peak)) * usable;
        const y1 = mid - Math.max(-1, Math.min(1, history[i] / peak)) * usable;
        context.strokeStyle = Math.abs(history[i]) <= threshold ? '#3fb98a' : '#f0a94f';
        context.beginPath();
        context.moveTo(x0, y0);
        context.lineTo(x1, y1);
        context.stroke();
      }
    }

    function applyFrame(frame) {
      frameCount = frame.index || frameCount + 1;
      fpsReadout.set(Number(frame.fps || 0).toFixed(1));
      targetReadout.set(frame.target_x == null ? '--' : String(frame.target_x));
      centerReadout.set(String(frame.center_x ?? '--'));

      if (frame.error == null) {
        errorReadout.set('--');
        errorReadout.node.classList.add('is-lost');
      } else {
        errorReadout.node.classList.remove('is-lost');
        const value = Number(frame.error);
        errorReadout.set((value > 0 ? '+' : '') + String(value));
        history.push(value);
        if (history.length > HISTORY) history.shift();
        drawSparkline();
      }
      updateAxis(frame.error == null ? null : Number(frame.error));

      const meta = DECISIONS[frame.decision] || DECISIONS.LOST;
      decisionGlyph.textContent = meta.glyph;
      decisionText.textContent = meta.text;
      decisionNote.textContent = meta.note;
      verdict.className = `gameagent__verdict is-${meta.tone}`;

      if (frame.action) {
        const duration = frame.duration_ms != null ? ` ${frame.duration_ms}ms` : '';
        actionText.textContent = `发键：${String(frame.action).toUpperCase()}${duration}`;
      } else {
        actionText.textContent = frame.skipped ? `没发键：${frame.skipped}` : 'A/D 松开';
      }
    }

    // ---------------------------------------------------------------- 组装

    const launchCard = h('section', { class: 'card gameagent__launch' },
      h('div', { class: 'gameagent__launch-main' },
        powerButton,
        h('div', { class: 'gameagent__launch-copy' },
          launchState,
          launchNote,
          h('div', { class: 'gameagent__launch-tools' },
            testWindowButton, doctorButton, installButton),
        ),
      ),
      h('div', { class: 'gameagent__launch-right' },
        h('span', { class: 'gameagent__section-title' }, '🎮 选一个场景'),
        sceneHost,
        windowRow,
      ),
    );

    const consoleCard = h('section', { class: 'card gameagent__console' },
      h('div', { class: 'gameagent__console-head' },
        h('span', { class: 'gameagent__section-title' }, '📡 实时判断'),
        h('span', { class: 'gameagent__console-note' }, '每一帧都会在这里过一遍'),
      ),
      h('div', { class: 'gameagent__console-body' },
        verdict,
        h('div', { class: 'gameagent__readouts' },
          fpsReadout.node, targetReadout.node, centerReadout.node, errorReadout.node),
      ),
      axis,
      sparkline,
      sparkHint,
    );

    const okwwCard = h('section', { class: 'card gameagent__okww' },
      h('span', { class: 'gameagent__section-title' }, '🤝 和 OK-WW 怎么分工'),
      h('div', { class: 'gameagent__split' },
        h('div', { class: 'gameagent__split-item' },
          h('span', { class: 'gameagent__split-role' }, '战斗'),
          h('strong', {}, 'OK-WW'),
          h('p', {}, '它负责打。保持开着就行，不用管它。'),
        ),
        h('span', { class: 'gameagent__split-plus' }, '＋'),
        h('div', { class: 'gameagent__split-item is-mine' },
          h('span', { class: 'gameagent__split-role' }, '朝向'),
          h('strong', {}, '这一页'),
          h('p', {}, '只发 A / D 两个键，负责把目标拉回屏幕中心。'),
        ),
      ),
      h('ul', { class: 'gameagent__notes' },
        h('li', {}, '两边都只看画面，都不读游戏内存、不注入进程，所以可以同时开着。'),
        h('li', {}, '本工具只按 A 和 D。如果 OK-WW 那边也把 A / D 派了别的用场，先把那边改掉，否则两个程序会互相打架。'),
        h('li', {}, '焦点守卫：填了窗口标题后，只有那个窗口在前台时才真的发键。切到聊天框、浏览器时会自动停手。'),
        h('li', {}, '游戏保持在前台、别被工具箱挡住 —— 截图截的是屏幕上真实显示的内容。'),
      ),
    );

    const advancedFold = h('details', { class: 'gameagent__fold' },
      h('summary', {}, '🧸 参数（一般不用动）'),
      h('div', { class: 'gameagent__fields' },
        field('画面来源', sourceSelect),
        field('输入方式', backendSelect),
        field('检测方法',detectorMode), field('目标截图',targetTemplate), field('目标颜色', presetSelect),
        field('居中阈值', thresholdInput, '误差小于它就认为已居中'),
        field('帧率', fpsInput, '5~10 就够了'),
        field('单次按键上限', pulseInput, '毫秒；短脉冲，绝不长按'),
      ),
      h('div', { class: 'gameagent__switches' },
        switchRow('性能优先（推荐）', fastToggle, '锁定后只截目标周围一块；实测整帧 49ms → 11ms'),
        switchRow('A / D 反向', invertToggle, '按了往反方向转时才需要打开'),
        switchRow('弹出 OpenCV 预览窗', previewToggle, '默认关闭，免得挡住游戏'),
        switchRow('保存标注帧到 work/ui-run', dumpToggle, '事后复盘用'),
      ),
    );

    const logFold = h('details', { class: 'gameagent__fold', open: true },
      h('summary', {},
        '📜 运行日志',
        h('span', { class: 'gameagent__fold-tools' }, clearLogButton),
      ),
      logHost,
    );

    root.append(
      h('header', { class: 'gameagent__hero' },
        h('div', {},
          h('span', { class: 'gameagent__eyebrow' }, '✦ 看得见的自动寻向 · PHASE 1'),
          h('h1', {}, '游戏控制'),
          h('p', {},
            '截图 → 找目标 → 判左右 → 敲一下 A / D → 再截图。全程只看画面，',
            h('strong', {}, '不偷看游戏内存、不注入进程'),
            ' —— 和 OK-WW 一样乖乖只靠眼睛。这一版只验证一件事：能不能把目标稳稳拉回屏幕中心 ✨'),
        ),
        mascot,
      ),
      launchCard,
      consoleCard,
      okwwCard,
      advancedFold,
      logFold,
    );

    // ---------------------------------------------------------------- 生命周期

    const unsubscribe = window.toolbox.gameAgent.onEvent((payload) => {
      if (!payload) return;
      if (payload.channel === 'frame' && payload.type === 'frame') applyFrame(payload);
      else if (payload.channel === 'frame' && payload.type === 'event') appendLog(payload.level || 'info',payload.message || '');
      else if (payload.channel === 'frame' && payload.type === 'summary') appendLog('info',`验收状态：${payload.validation_status || '未验证'}；新鲜观测 ${payload.observed_frames || 0} 帧；居中不代表游戏任务成功。`);
      else if (payload.channel === 'status') applyStatus(payload.status);
      else if (payload.channel === 'log') appendLog(payload.level || 'info', payload.message || '');
      else if (payload.channel === 'install') {
        if (payload.state !== 'running') {
          installing = false;
          installButton.disabled = false;
          installButton.textContent = '安装依赖';
          if (payload.state === 'done') {
            installButton.hidden = true;
            toast('依赖装好了，可以启动了', 'good', 4000);
            runDoctor();
          }
        }
      }
    });

    selectScene(activeSceneId, { silent: true });
    updateAxisBand();
    renderPowerButton();
    setupResize();

    (async () => {
      try {
        const info = await window.toolbox.gameAgent.status();
        applyStatus(info.status || 'idle');
        if (!info.running) runDoctor();
      } catch (_) {
        applyStatus('idle');
      }
      // 实战/彩排场景顺手把窗口列出来，省一次点击
      if (sceneOf().needsWindow) scanWindows();
    })();

    function setupResize() {
      if (typeof ResizeObserver !== 'function') return;
      resizeObserver = new ResizeObserver(() => drawSparkline());
      resizeObserver.observe(sparkline);
    }

    return {
      deactivate() {
        persistForm();
        try { unsubscribe && unsubscribe(); } catch (_) { /* 忽略 */ }
        try { resizeObserver && resizeObserver.disconnect(); } catch (_) { /* 忽略 */ }
      },
    };
  },
};
