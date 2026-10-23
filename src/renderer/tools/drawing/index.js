import { h, toast } from '../../core/ui.js';

export default {
  id: 'drawing',
  title: '同步绘图',
  icon: 'pen',
  hint: '与 iPad 共享手写绘图本，笔迹和粘贴图片双向同步',
  create(root) {
    const info = h('span', { class: 'faint' }, 'iPad 与电脑连接同一 Wi-Fi，用 Safari 扫码配对。');
    const pair = h('div', { style: { display: 'none', gap: '18px', alignItems: 'center', padding: '16px', flexWrap: 'wrap' } });
    const frame = h('iframe', { title: 'Toolbox 同步绘图本', style: { width: '100%', flex: '1', minHeight: '450px', border: '0' } });
    const start = h('button', { class: 'btn btn--primary', onclick: async () => {
      start.disabled = true;
      try { render(await window.toolbox.drawing.start()); } catch (e) { toast(e.message, 'bad'); } finally { start.disabled = false; }
    } }, '打开绘图本并启用 iPad 同步');
    const pairButton = h('button', { class: 'btn', hidden: true, onclick: () => { pair.style.display = pair.style.display === 'none' ? 'flex' : 'none'; } }, 'iPad 配对');
    const stop = h('button', { class: 'btn', hidden: true, onclick: async () => { try { render(await window.toolbox.drawing.stop()); } catch (e) { toast(e.message, 'bad'); } } }, '停止连接');
    const rotate = h('button', { class: 'btn', hidden: true, onclick: async () => { try { await window.toolbox.drawing.rotate(); render(await window.toolbox.drawing.start()); } catch (e) { toast(e.message, 'bad'); } } }, '重新配对');
    root.style.display = 'flex'; root.style.flexDirection = 'column'; root.style.height = '100%';
    root.append(h('div', { class: 'bar bar--drag' }, h('strong', {}, '同步绘图'), start, pairButton, rotate, stop), h('div', { style: { padding: '8px 16px' } }, info), pair, frame);
    let lastUrl = '';
    function render(state) {
      start.hidden = state.enabled; stop.hidden = !state.enabled; rotate.hidden = !state.enabled; pairButton.hidden = !state.enabled;
      if (!state.enabled) { frame.removeAttribute('src'); lastUrl = ''; pair.style.display = 'none'; info.textContent = '连接已关闭。绘图本保存在本机，下次打开继续。'; return; }
      info.textContent = `设备 #${state.identity.code} · ${state.identity.name} ｜ 笔迹与图片自动同步。停止连接保留绘图本；重新配对会让旧地址失效。`;
      if (state.desktopUrl !== lastUrl) { frame.src = state.desktopUrl; lastUrl = state.desktopUrl; }
      pair.replaceChildren();
      const qr = h('img', { src: state.qr || '', alt: 'iPad 专用绘图配对二维码', width: 170, height: 170 });
      if (state.qr) pair.append(qr);
      const urls = h('select', { class: 'field', 'aria-label': '电脑网络地址' }, state.urls.map(url => h('option', { value: url }, url.split('/#')[0])));
      urls.addEventListener('change', async () => { const selected = urls.value; try { const data = await window.toolbox.drawing.qr(selected); if (urls.value === selected) qr.src = data; } catch (e) { toast(e.message, 'bad'); } });
      pair.append(h('div', {}, h('strong', {}, `在 iPad 上连接 #${state.identity.code}`), h('p', {}, '使用 iPad 相机扫码，用 Safari 打开。也可复制地址发给自己。'), urls,
        h('button', { class: 'btn', onclick: async () => { await window.toolbox.clipboard.write(urls.value); toast('绘图配对地址已复制'); } }, '复制配对地址'),
        h('p', { class: 'faint' }, '多网卡时请选择 iPad 可访问的 Wi-Fi 地址。首次可能需允许 Windows 防火墙的专用网络访问。'),
        h('p', { class: 'faint' }, 'Safari → 分享 → 添加到主屏幕，即可作为独立绘图应用打开。仅 Pencil 可防止手指误画。')));
      if (!state.urls.length) pair.append(h('p', {}, '未找到局域网地址，请检查 Wi-Fi 连接。电脑端仍可绘图。'));
      if (state.qr && pair.style.display === 'none' && !pair.dataset.shown) { pair.style.display = 'flex'; pair.dataset.shown = 'yes'; }
    }
    return { async activate() { try { const state = await window.toolbox.drawing.status(); if (state.enabled) render(await window.toolbox.drawing.start()); } catch (e) { info.textContent = e.message; } } };
  },
};
