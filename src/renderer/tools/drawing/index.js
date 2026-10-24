import { h, toast } from '../../core/ui.js';

export default {
  id: 'drawing',
  title: '同步绘图',
  icon: 'pen',
  hint: '与 iPad 共享手写绘图本，笔迹和粘贴图片双向同步',
  create(root) {
    let lastUrl = '', pairOpen = false, hadRemote = false, active = false, timer, polling = false, qrGeneration = 0;
    const info = h('span', { class: 'drawing__connection', role: 'status', 'aria-live': 'polite' }, '开启后连接 iPad，共享笔迹与图片');
    const pair = h('div', { class: 'drawing__pair', id: 'drawing-pair-panel', hidden: true });
    const frame = h('iframe', { class: 'drawing__frame', title: 'Toolbox 同步绘图本', hidden: true });
    const placeholder = h('div', { class: 'empty' }, h('strong', {}, '电脑与 iPad，共用一本画册'), h('p', {}, '开启绘图本后，在 iPad「Toolbox 绘图本」内扫码或粘贴地址配对。'));
    const qr = h('img', { class: 'drawing__qr', alt: 'iPad 绘图配对二维码', width: 128, height: 128, hidden: true });
    const urls = h('select', { class: 'field', 'aria-label': '电脑网络地址' });
    async function updateQR() {
      const selected = urls.value, generation = ++qrGeneration;
      qr.hidden = true;
      if (!selected || !pairOpen) return;
      try {
        const data = await window.toolbox.drawing.qr(selected);
        if (generation === qrGeneration && pairOpen && urls.value === selected) { qr.src = data; qr.hidden = false; }
      } catch (e) { toast(e.message, 'bad'); }
    }
    urls.addEventListener('change', updateQR);
    function showPair(show) {
      pairOpen = show; pair.hidden = !show;
      pairButton.textContent = show ? '收起配对' : '连接 iPad';
      pairButton.setAttribute('aria-expanded', String(show));
      if (show) updateQR(); else qrGeneration++;
    }
    const start = h('button', { class: 'btn btn--primary', onclick: async () => {
      start.disabled = true;
      try { const state = await window.toolbox.drawing.start(); render(state); showPair(!state.remoteClients); }
      catch (e) { toast(e.message, 'bad'); } finally { start.disabled = false; }
    } }, '打开绘图本并启用 iPad 同步');
    const pairButton = h('button', { class: 'btn', hidden: true, 'aria-expanded': 'false', 'aria-controls': pair.id, onclick: () => showPair(!pairOpen) }, '连接 iPad');
    const stop = h('button', { class: 'btn btn--sm', hidden: true, onclick: async () => {
      try { render(await window.toolbox.drawing.stop()); } catch (e) { toast(e.message, 'bad'); }
    } }, '停止同步');
    const rotate = h('button', { class: 'btn btn--sm', onclick: async () => {
      try { render(await window.toolbox.drawing.rotate()); showPair(true); }
      catch (e) { toast(e.message, 'bad'); }
    } }, '使旧地址失效并重新配对');
    pair.append(qr, h('div', { class: 'drawing__pair-body' },
      h('strong', {}, '在 iPad 绘图本内配对'),
      h('p', {}, '打开「Toolbox 绘图本」→ 左上角「配对」→ 扫描此二维码。也可复制完整地址后粘贴连接。'),
      h('div', { class: 'drawing__pair-actions' }, urls, h('button', { class: 'btn', onclick: async () => {
        try { if (!urls.value) return; await window.toolbox.clipboard.write(urls.value); toast('绘图配对地址已复制'); }
        catch (e) { toast(e.message, 'bad'); }
      } }, '复制配对地址')),
      h('p', { class: 'faint' }, '连接后自动收起。网页用户也可用 Safari 打开二维码地址；“已同步”表示连接成功。'),
      rotate,
    ));
    root.classList.add('drawing');
    root.append(h('div', { class: 'bar bar--drag drawing__toolbar' }, h('strong', {}, '同步绘图'), info, start, pairButton, stop), pair, placeholder, frame);
    function render(state) {
      start.hidden = state.enabled; stop.hidden = !state.enabled; rotate.hidden = !state.enabled; pairButton.hidden = !state.enabled;
      frame.hidden = !state.enabled; placeholder.hidden = state.enabled;
      if (!state.enabled) {
        frame.removeAttribute('src'); lastUrl = ''; hadRemote = false; showPair(false);
        info.textContent = '同步已停止 · 绘图本保留在本机'; info.classList.remove('is-connected'); return;
      }
      const remote = state.remoteClients > 0;
      info.textContent = `#${state.identity.code} · ${remote ? `已连接 ${state.remoteClients} 个远端窗口` : '等待 iPad 连接'}`;
      info.classList.toggle('is-connected', remote);
      if (remote && !hadRemote) showPair(false);
      hadRemote = remote;
      if (state.desktopUrl !== lastUrl) {
        frame.src = state.desktopUrl; lastUrl = state.desktopUrl;
        const selected = urls.value;
        urls.replaceChildren(...state.urls.map(url => h('option', { value: url }, url.split('/#')[0])));
        if (state.urls.includes(selected)) urls.value = selected;
        if (pairOpen) updateQR();
      }
    }
    async function refresh() {
      if (polling) return;
      polling = true;
      try { const state = await window.toolbox.drawing.status(); if (active) render(state); }
      catch (e) { if (active) info.textContent = e.message; }
      finally { polling = false; }
    }
    return {
      activate() { active = true; refresh(); clearInterval(timer); timer = setInterval(refresh, 2000); },
      deactivate() { active = false; clearInterval(timer); },
      destroy() { active = false; clearInterval(timer); qrGeneration++; },
    };
  },
};
