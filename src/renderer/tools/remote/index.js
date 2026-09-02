import { h, toast } from '../../core/ui.js';

export default {
  id: 'remote',
  title: '手机',
  icon: 'smartphone',
  hint: '手机远程控制工具箱与当前 AI',

  create(root) {
    const state = h('span', { class: 'tag remote__state' }, '未启动');
    const urls = h('textarea', { class: 'field remote__urls', readonly: true, rows: '3', placeholder: '启动后，手机和电脑连同一个 Wi-Fi，打开这里的地址。' });
    const detail = h('div', { class: 'remote__detail faint' }, '远程服务默认关闭，只在你点击启动后开放。');
    const autoStartInput = h('input', { type: 'checkbox', checked: false, onchange: async () => { await window.toolbox.remote.setAutoStart(autoStartInput.checked); toast(autoStartInput.checked ? '已设置为开机自动启动' : '已关闭自动启动', 'good'); } });
    const startBtn = h('button', { class: 'btn btn--primary', onclick: start }, '启动手机控制');
    const stopBtn = h('button', { class: 'btn btn--sm btn--ghost', disabled: true, onclick: stop }, '停止');
    const rotateBtn = h('button', { class: 'btn btn--sm', disabled: true, onclick: rotate }, '重新配对');

    async function refresh(next) {
      const current = next || await window.toolbox.remote.status();
      state.textContent = current.enabled ? '手机已连接入口' : '未启动';
      state.className = `tag remote__state ${current.enabled ? 'tag--good' : 'tag--warn'}`;
      urls.value = current.urls?.join('\n') || '';
      detail.textContent = current.enabled
        ? `${current.addresses?.length || 0} 个局域网地址 · 配对令牌已加密保存`
        : '远程服务默认关闭，只在你点击启动后开放。';
      autoStartInput.checked = Boolean(current.autoStart);
      startBtn.disabled = Boolean(current.enabled);
      stopBtn.disabled = !current.enabled;
      rotateBtn.disabled = !current.enabled;
    }
    async function start() {
      try { await refresh(await window.toolbox.remote.start()); toast('手机控制已启动，打开上面的地址配对。', 'good', 5000); }
      catch (err) { toast(`启动失败：${err.message}`, 'bad'); }
    }
    async function stop() {
      await refresh(await window.toolbox.remote.stop());
      toast('手机控制已停止', 'good');
    }
    async function rotate() {
      await refresh(await window.toolbox.remote.rotate());
      toast('已生成新的配对地址，旧地址失效', 'good');
    }

    root.append(
      h('div', { class: 'bar bar--drag' }, h('strong', {}, '手机控制'), state),
      h('div', { class: 'remote__body' },
        h('section', { class: 'card remote__hero' },
          h('div', { class: 'remote__eyebrow' }, 'LOCAL REMOTE CONSOLE'),
          h('h2', {}, '把工具箱带到手机上'),
          h('p', { class: 'faint' }, '手机和电脑连同一个 Wi-Fi，启动后打开配对地址。AI 请求仍在电脑端执行，当前选用 DeepSeek 网页版或第三方 API 都能继续使用。'),
          h('div', { class: 'remote__actions' }, startBtn, stopBtn, rotateBtn),
          h('label', { class: 'remote__auto-start' }, autoStartInput, '开机自动启动（默认关闭）'),
          detail,
        ),
        h('section', { class: 'card remote__pairing' },
          h('div', { class: 'remote__section-head' }, h('strong', {}, '手机打开这个地址'), h('button', { class: 'btn btn--sm btn--ghost', onclick: async () => { if (!urls.value) return; await window.toolbox.clipboard.write(urls.value); toast('配对地址已复制', 'good'); } }, '复制地址')),
          urls,
          h('div', { class: 'faint remote__security' }, '配对令牌保存在电脑的系统安全存储中。需要结束控制时点“停止”；需要让旧手机失效时点“重新配对”。'),
        ),
        h('section', { class: 'card remote__scope' },
          h('div', { class: 'remote__section-head' }, h('strong', {}, '手机端可以做什么')),
          h('div', { class: 'remote__capabilities' },
            ...['切换工具', '调用当前 AI', '读写电脑剪贴板', '打开其他 AI 网站', '停止远程服务'].map((item) => h('span', { class: 'remote__capability' }, item)),
          ),
          h('p', { class: 'faint remote__security' }, '当前版本不开放任意 shell、任意键鼠模拟或删除文件。需要验证码、付款、系统权限或敏感操作时，仍在电脑端确认。换 Wi-Fi 时请使用设备名.local、Tailscale 或其他 VPN 地址。'),
        ),
      ),
    );
    refresh();
    return {};
  },
};
