import { h, toast, debounce } from '../../core/ui.js';

function targetLabel(state) {
  if (!state.target) return '尚未吸附窗口';
  return state.target.title ? `${state.target.name} · ${state.target.title}` : state.target.name;
}

export default {
  id: 'dock',
  title: '吸附',
  icon: 'magnet',
  hint: '把 Edge、Chrome 等窗口贴到工具箱左侧，自由调节宽度',

  create(root) {
    let state = {
      supported: true,
      active: false,
      target: null,
      ratio: 0.58,
      side: 'left',
      shortcut: '⌥⇧D',
    };

    const statusTag = h('span', { class: 'tag dock__state' }, '检查中');
    const targetName = h('strong', { class: 'dock__target-name' }, '尚未吸附窗口');
    const targetDetail = h('span', { class: 'faint dock__target-detail' }, 'Edge / Chrome / Safari / VSCode 等普通窗口都可以');
    const ratioValue = h('span', { class: 'dock__ratio-value mono' }, '58 : 42');
    const ratioInput = h('input', { type: 'range', min: '28', max: '72', step: '1', value: '58' });
    const captureBtn = h('button', { class: 'btn btn--primary' }, '3 秒后选择窗口');
    const detachBtn = h('button', { class: 'btn', disabled: true }, '解除并恢复');
    const leftBtn = h('button', { class: 'dock__side-btn' }, '网页在左');
    const rightBtn = h('button', { class: 'dock__side-btn' }, '网页在右');
    const browserPane = h('div', { class: 'dock__diagram-pane dock__diagram-browser' },
      h('span', {}, '🌐'), h('small', {}, 'Edge 网页'));
    const toolboxPane = h('div', { class: 'dock__diagram-pane dock__diagram-toolbox' },
      h('span', {}, '🧰'), h('small', {}, '工具箱'));
    const diagram = h('div', { class: 'dock__diagram' }, browserPane, h('div', { class: 'dock__diagram-grip' }), toolboxPane);

    function render(next = state) {
      state = { ...state, ...next };
      statusTag.textContent = state.active ? '已吸附' : state.armed ? '等待拖入' : (state.supported ? '待机' : '不支持');
      statusTag.className = `tag dock__state ${state.active ? 'tag--good' : state.armed ? 'tag--warn' : state.supported ? '' : 'tag--bad'}`;
      targetName.textContent = targetLabel(state);
      targetDetail.textContent = state.active
        ? '拖动两个窗口中间的蓝色细条即可调整宽度，双击细条可解除。'
        : state.armed
          ? `请拖住 Edge 标签页或窗口，移到工具箱${state.side === 'right' ? '右' : '左'}边缘的蓝色提示条后松手。`
          : '先点左侧栏顶部的回形针，再拖入 Edge 标签页或窗口';
      captureBtn.disabled = !state.supported;
      detachBtn.disabled = !state.active;
      captureBtn.textContent = state.active ? '已吸附' : state.armed ? '取消等待' : '启动回形针吸附';
      const targetPercent = Math.round((Number(state.ratio) || 0.58) * 100);
      ratioInput.value = String(targetPercent);
      ratioValue.textContent = `${targetPercent} : ${100 - targetPercent}`;
      leftBtn.classList.toggle('is-active', state.side !== 'right');
      rightBtn.classList.toggle('is-active', state.side === 'right');
      diagram.classList.toggle('is-reversed', state.side === 'right');
    }

    async function togglePin() {
      const result = await window.toolbox.dock.togglePin();
      if (!result.ok) {
        render(result);
        toast(result.error || '窗口吸附失败', 'bad', 5200);
        return;
      }
      render(result);
      if (result.armed) toast('回形针已点亮，把 Edge 标签页或窗口拖到蓝色边缘后松手。', 'good', 5200);
    }

    captureBtn.addEventListener('click', togglePin);
    detachBtn.addEventListener('click', async () => {
      const result = await window.toolbox.dock.detach();
      render(result);
      toast('已解除吸附，并恢复窗口位置', 'good');
    });
    leftBtn.addEventListener('click', async () => render(await window.toolbox.dock.setSide('left')));
    rightBtn.addEventListener('click', async () => render(await window.toolbox.dock.setSide('right')));

    const applyRatio = debounce(async () => {
      render(await window.toolbox.dock.setRatio(Number(ratioInput.value) / 100));
    }, 70);
    ratioInput.addEventListener('input', () => {
      const targetPercent = Number(ratioInput.value);
      ratioValue.textContent = `${targetPercent} : ${100 - targetPercent}`;
      applyRatio();
    });

    const permissionBtn = h('button', {
      class: 'btn btn--sm',
      onclick: async () => {
        permissionBtn.disabled = true;
        const result = await window.toolbox.dock.requestPermission();
        permissionBtn.disabled = false;
        if (result.trusted) toast('辅助功能权限已就绪', 'good');
        else toast('请在“系统设置 → 隐私与安全性 → 辅助功能”中允许窗口控制器，然后重试。', 'bad', 6500);
      },
    }, '检查 / 请求授权');

    root.append(
      h('div', { class: 'bar bar--drag' },
        h('strong', {}, '窗口吸附'),
        h('span', { class: 'faint' }, '把浏览器与工具箱组合成一个工作台'),
        h('span', { class: 'dock__bar-spacer' }),
        statusTag,
      ),
      h('div', { class: 'dock__body' },
        h('section', { class: 'card dock__hero' },
          h('div', { class: 'dock__hero-copy' },
            h('span', { class: 'dock__eyebrow' }, 'GLOBAL WINDOW DOCK'),
            h('h2', {}, '不用再来回切换 Edge 和工具箱'),
            h('p', { class: 'faint' },
              '点亮左侧栏顶部的回形针，再把 Edge 标签页或窗口拖到工具箱边缘，松手后自动贴成左右分栏。浏览器仍是原来的 Edge 窗口，账号、插件和登录状态都不会丢。'),
          ),
          diagram,
        ),
        h('section', { class: 'card dock__control' },
          h('div', { class: 'dock__target' },
            h('div', { class: 'dock__target-icon' }, '🪟'),
            h('div', { class: 'dock__target-copy' }, targetName, targetDetail),
          ),
          h('div', { class: 'dock__actions' }, captureBtn, detachBtn),
          h('div', { class: 'dock__shortcut' },
            h('span', { class: 'faint' }, '备用方式：在 Edge 窗口处于前台时按'),
            h('kbd', {}, state.shortcut),
            h('span', { class: 'faint' }, '立即吸附'),
          ),
        ),
        h('section', { class: 'card dock__layout' },
          h('div', { class: 'dock__section-head' },
            h('div', {}, h('h3', { class: 'card__title' }, '分栏布局'), h('p', { class: 'faint' }, '吸附后也可以直接拖动屏幕中央的蓝色分隔条。')),
            h('div', { class: 'dock__side-switch' }, leftBtn, rightBtn),
          ),
          h('label', { class: 'dock__ratio' },
            h('span', {}, '网页 : 工具箱'),
            ratioInput,
            ratioValue,
          ),
        ),
        h('section', { class: 'card dock__permission' },
          h('div', {},
            h('h3', { class: 'card__title' }, 'macOS 权限'),
            h('p', { class: 'faint' }, '第一次使用需要辅助功能权限，这是系统允许本工具移动其他应用窗口的必要权限。工具不会读取网页内容或键盘输入。'),
          ),
          permissionBtn,
        ),
        h('div', { class: 'dock__note' },
          h('strong', {}, '说明：'),
          'macOS 不允许 Electron 把第三方窗口真正塞进应用内部，因此这里采用系统级“贴靠组合”。视觉和操作上是左右一体的，但 Edge 仍由 Edge 自己运行，兼容性和登录状态更可靠。',
        ),
      ),
    );

    window.toolbox.dock.onStatus(render);
    window.toolbox.dock.status().then(render);

    return {
      activate() { window.toolbox.dock.status().then(render); },
    };
  },
};
