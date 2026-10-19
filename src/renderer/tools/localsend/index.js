import { h, toast } from '../../core/ui.js';

/**
 * LocalSend（工具箱内置版）：同一 Wi‑Fi 下的工具箱自动互相发现，按「编号」认人，拖文件/写文字直接发。
 * 对方必须点「接受」才会收；收到的东西进 下载/LocalSend。主进程常驻接收，这页关着也能收（会弹系统通知）。
 */

const STYLE = `
.ls{display:flex;flex-direction:column;gap:14px;padding:18px;max-width:980px;margin:0 auto;height:100%;overflow:auto;box-sizing:border-box}
.ls__me{display:flex;align-items:center;gap:16px;padding:16px 18px;border-radius:16px;background:linear-gradient(135deg,rgba(124,92,255,.16),rgba(0,174,236,.12));border:1px solid rgba(255,255,255,.08)}
.ls__badge{min-width:86px;height:86px;border-radius:22px;display:flex;flex-direction:column;align-items:center;justify-content:center;background:linear-gradient(135deg,#7c5cff,#00aeec);color:#fff;box-shadow:0 8px 24px rgba(124,92,255,.35)}
.ls__badge small{font-size:11px;opacity:.85;letter-spacing:.1em}
.ls__badge b{font-size:30px;letter-spacing:.08em;font-variant-numeric:tabular-nums}
.ls__meinfo{flex:1;min-width:0;display:flex;flex-direction:column;gap:6px}
.ls__name{font-size:18px;font-weight:700;background:transparent;border:1px solid transparent;border-radius:8px;padding:2px 6px;margin-left:-6px;color:inherit;width:100%;max-width:360px}
.ls__name:hover,.ls__name:focus{border-color:rgba(255,255,255,.18);outline:none}
.ls__sub{font-size:12px;opacity:.7}
.ls__sec{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:2px}
.ls__sec h3{margin:0;font-size:14px}
.ls__row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.ls__peers{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px}
.ls__peer{position:relative;display:flex;align-items:center;gap:10px;padding:12px;border-radius:14px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.03);cursor:pointer;transition:transform .12s,border-color .12s,background .12s}
.ls__peer:hover{transform:translateY(-1px);border-color:rgba(255,255,255,.22)}
.ls__peer.is-sel{border-color:#7c5cff;background:rgba(124,92,255,.14);box-shadow:0 0 0 2px rgba(124,92,255,.25) inset}
.ls__peer.is-off{opacity:.45}
.ls__ava{width:42px;height:42px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;color:#fff;background:linear-gradient(135deg,#ff9a6b,#fb7299);flex:0 0 auto;font-variant-numeric:tabular-nums}
.ls__pinfo{min-width:0;display:flex;flex-direction:column;gap:2px}
.ls__pname{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ls__pmeta{font-size:11px;opacity:.65;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ls__dot{position:absolute;top:10px;right:10px;width:8px;height:8px;border-radius:50%;background:#3fbf87;box-shadow:0 0 0 3px rgba(63,191,135,.18)}
.ls__peer.is-off .ls__dot{background:#888;box-shadow:none}
.ls__empty{padding:18px;border:1px dashed rgba(255,255,255,.16);border-radius:14px;font-size:13px;opacity:.75;line-height:1.7}
.ls__drop{border:2px dashed rgba(255,255,255,.18);border-radius:16px;padding:18px;text-align:center;transition:border-color .15s,background .15s}
.ls__drop.is-over{border-color:#00aeec;background:rgba(0,174,236,.08)}
.ls__chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px;justify-content:center}
.ls__chip{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;background:rgba(255,255,255,.08);font-size:12px;max-width:260px}
.ls__chip span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ls__chip button{background:none;border:none;color:inherit;opacity:.6;cursor:pointer;padding:0 2px;font-size:13px}
.ls__text{width:100%;min-height:64px;resize:vertical;box-sizing:border-box}
.ls__bar{height:6px;border-radius:999px;background:rgba(255,255,255,.08);overflow:hidden}
.ls__bar i{display:block;height:100%;width:0;background:linear-gradient(90deg,#7c5cff,#00aeec);transition:width .2s}
.ls__status{font-size:12px;min-height:16px;opacity:.85}
.ls__inc{display:flex;flex-direction:column;gap:10px}
.ls__offer{padding:14px;border-radius:14px;border:1px solid rgba(251,114,153,.45);background:rgba(251,114,153,.08);animation:lsPulse 1.6s ease-in-out infinite}
@keyframes lsPulse{0%,100%{box-shadow:0 0 0 0 rgba(251,114,153,.0)}50%{box-shadow:0 0 0 4px rgba(251,114,153,.18)}}
.ls__offer-h{font-weight:700;margin-bottom:6px}
.ls__offer ul{margin:4px 0 8px 18px;padding:0;font-size:12px;opacity:.85}
.ls__offer pre{white-space:pre-wrap;word-break:break-all;font-size:12px;background:rgba(0,0,0,.2);padding:8px;border-radius:8px;max-height:120px;overflow:auto;margin:4px 0 8px}
.ls__hist{display:flex;flex-direction:column;gap:4px;font-size:12px}
.ls__hist div{display:flex;gap:8px;opacity:.8}
.ls__hist em{font-style:normal;opacity:.6;flex:0 0 auto}
`;

function fmtSize(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB']; let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i += 1; }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
}

function ago(t) {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return '刚刚';
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
  return new Date(t).toLocaleDateString();
}

export default {
  id: 'localsend',
  title: 'LocalSend',
  icon: 'link',
  hint: '局域网互传：自动发现附近的工具箱，按编号发文件/文字，对方点接受才收',

  create(root) {
    const api = (window.toolbox && window.toolbox.localSend) || null;
    if (!document.getElementById('ls-style')) {
      const st = document.createElement('style'); st.id = 'ls-style'; st.textContent = STYLE; document.head.appendChild(st);
    }
    if (!api) { root.append(h('div', { class: 'ls' }, h('div', { class: 'ls__empty' }, 'LocalSend 服务没加载（重启工具箱试试）。'))); return {}; }

    let me = {}; let peers = []; let selected = ''; let files = []; let pending = []; let sending = false;
    let unsub = null;

    // ---------- 我 ----------
    const codeEl = h('b', {}, '----');
    const nameInput = h('input', { class: 'ls__name', title: '点一下改名字，别人看到的就是它', maxlength: '40' });
    nameInput.addEventListener('change', async () => { me = await api.setName(nameInput.value); renderMe(); toast('名字已更新'); });
    nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') nameInput.blur(); });
    const meSub = h('div', { class: 'ls__sub' });
    const meCard = h('div', { class: 'ls__me' },
      h('div', { class: 'ls__badge', title: '你的编号：别人在列表里按这个认出你' }, h('small', {}, '我的编号'), codeEl),
      h('div', { class: 'ls__meinfo' }, nameInput, meSub,
        h('div', { class: 'ls__row' },
          h('button', { class: 'btn btn--sm', onclick: () => api.openFolder() }, '📂 接收文件夹'),
          h('span', { class: 'ls__sub' }, '同一 Wi‑Fi 下开着工具箱的设备会自动出现在下面'))));

    function renderMe() {
      codeEl.textContent = me.code || '----';
      if (document.activeElement !== nameInput) nameInput.value = me.name || '';
      meSub.textContent = `${(me.ips || []).join(' · ') || '没有局域网 IP（连上 Wi‑Fi 再试）'}  ·  端口 ${me.port || ''}`;
    }

    // ---------- 收到的请求 ----------
    const incWrap = h('div', { class: 'ls__inc' });
    function renderIncoming() {
      incWrap.innerHTML = '';
      for (const o of pending) {
        const list = o.files.slice(0, 8).map((f) => h('li', {}, `${f.name}（${fmtSize(f.size)}）`));
        if (o.files.length > 8) list.push(h('li', {}, `…还有 ${o.files.length - 8} 个`));
        incWrap.append(h('div', { class: 'ls__offer' },
          h('div', { class: 'ls__offer-h' }, `📥 ${o.from.name || o.from.ip}（#${o.from.code || '?'}）想发给你`
            + (o.files.length ? ` ${o.files.length} 个文件 · ${fmtSize(o.totalSize)}` : '') + (o.textLen ? ' · 一段文字' : '')),
          o.files.length ? h('ul', {}, ...list) : null,
          o.text ? h('pre', {}, o.text + (o.textLen > o.text.length ? '\n…' : '')) : null,
          h('div', { class: 'ls__row' },
            h('button', { class: 'btn btn--primary btn--sm', onclick: () => answer(o.offerId, true) }, '✓ 接受'),
            h('button', { class: 'btn btn--ghost btn--sm', onclick: () => answer(o.offerId, false) }, '拒绝'),
            h('span', { class: 'ls__sub' }, `来自 ${o.from.ip}`))));
      }
    }
    async function answer(offerId, ok) {
      const r = await api.respond(offerId, ok);
      pending = pending.filter((o) => o.offerId !== offerId); renderIncoming();
      if (!r.ok) toast(r.error || '处理失败');
      else if (ok) toast('已接受，正在接收…');
    }

    // ---------- 设备 ----------
    const peersWrap = h('div', { class: 'ls__peers' });
    const ipInput = h('input', { class: 'field', placeholder: '按 IP 添加，如 192.168.1.23', style: 'width:200px' });
    async function addIp() {
      const v = ipInput.value.trim(); if (!v) return;
      const r = await api.addIp(v);
      if (r.ok) { ipInput.value = ''; toast(`已添加：${r.peer.name}（#${r.peer.code}）`); peers = await api.peers(); renderPeers(); }
      else toast(r.error);
    }
    ipInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addIp(); });

    function renderPeers() {
      peersWrap.innerHTML = '';
      if (!peers.length) {
        peersWrap.append(h('div', { class: 'ls__empty', style: 'grid-column:1/-1' },
          '还没发现别的工具箱。确认：① 对方也打开了工具箱（新版才有 LocalSend）② 两台在同一个 Wi‑Fi（访客网/AP 隔离会挡）③ 第一次运行时 macOS 问「是否允许传入连接」要点允许。组播被路由器拦了的话，用右上角按 IP 添加。'));
      }
      if (selected && !peers.some((p) => p.id === selected)) selected = '';
      if (!selected) { const on = peers.find((p) => p.online); if (on) selected = on.id; }
      for (const p of peers) {
        const card = h('div', { class: `ls__peer ${p.id === selected ? 'is-sel' : ''} ${p.online ? '' : 'is-off'}`, title: p.online ? '点一下选为发送对象' : '离线（超过 12 秒没听到它）', onclick: () => { selected = p.id; renderPeers(); renderSendBtn(); } },
          h('span', { class: 'ls__dot' }),
          h('div', { class: 'ls__ava' }, p.code || '??'),
          h('div', { class: 'ls__pinfo' },
            h('div', { class: 'ls__pname' }, p.name || '未命名'),
            h('div', { class: 'ls__pmeta' }, `#${p.code} · ${p.ip}${p.manual ? ' · 手动' : ''}`)));
        peersWrap.append(card);
      }
      renderSendBtn();
    }

    // ---------- 发送 ----------
    const chips = h('div', { class: 'ls__chips' });
    const drop = h('div', { class: 'ls__drop' },
      h('div', {}, '把文件拖到这里，或 ', h('button', { class: 'btn btn--sm', onclick: pick }, '选择文件')),
      chips);
    const textArea = h('textarea', { class: 'field ls__text', placeholder: '也可以只发一段文字/链接（可和文件一起发）' });
    const sendBtn = h('button', { class: 'btn btn--primary', onclick: doSend }, '发送');
    const barFill = h('i'); const bar = h('div', { class: 'ls__bar' }, barFill);
    const status = h('div', { class: 'ls__status' });

    function renderChips() {
      chips.innerHTML = '';
      files.forEach((f, i) => chips.append(h('span', { class: 'ls__chip', title: f },
        h('span', {}, f.split('/').pop()),
        h('button', { title: '移除', onclick: () => { files.splice(i, 1); renderChips(); renderSendBtn(); } }, '×'))));
    }
    function renderSendBtn() {
      const p = peers.find((x) => x.id === selected);
      sendBtn.disabled = sending || !p;
      sendBtn.textContent = sending ? '发送中…' : (p ? `发送给 ${p.name}（#${p.code}）` : '先在上面选一台设备');
    }
    async function pick() {
      const list = await api.pickFiles();
      if (list && list.length) { for (const f of list) if (!files.includes(f)) files.push(f); renderChips(); renderSendBtn(); }
    }
    drop.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); e.stopPropagation(); drop.classList.add('is-over'); } });
    drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
    drop.addEventListener('drop', (e) => {
      e.preventDefault(); e.stopPropagation(); drop.classList.remove('is-over');
      const getPath = window.toolbox.files && window.toolbox.files.getPathForFile;
      for (const f of e.dataTransfer.files || []) {
        const p = getPath ? getPath(f) : f.path;
        if (p && !files.includes(p)) files.push(p);
      }
      renderChips(); renderSendBtn();
    });

    async function doSend() {
      const p = peers.find((x) => x.id === selected);
      if (!p) { toast('先选一台设备'); return; }
      const text = textArea.value;
      if (!files.length && !text.trim()) { toast('拖个文件或写点文字'); return; }
      sending = true; renderSendBtn(); barFill.style.width = '0%';
      const r = await api.send({ peerId: p.id, files: files.slice(), text });
      sending = false; renderSendBtn();
      if (r.ok) { files = []; textArea.value = ''; renderChips(); barFill.style.width = '100%'; }
      else { status.textContent = '没发出去：' + r.error; }
    }

    // ---------- 历史 ----------
    const histWrap = h('div', { class: 'ls__hist' });
    function renderHistory(list) {
      histWrap.innerHTML = '';
      if (!list || !list.length) { histWrap.append(h('div', { class: 'ls__sub' }, '还没有记录')); return; }
      for (const it of list.slice(0, 15)) {
        const what = [it.files && it.files.length ? `${it.files.length} 个文件（${it.files.slice(0, 2).join('、')}${it.files.length > 2 ? '…' : ''}）` : '', it.text ? `文字「${it.text}」` : ''].filter(Boolean).join(' + ');
        histWrap.append(h('div', {}, h('em', {}, ago(it.at)), h('span', {}, `${it.dir === 'in' ? '⬇ 收自' : '⬆ 发给'} ${it.peer}：${what}`)));
      }
    }

    root.append(h('div', { class: 'ls' },
      meCard,
      incWrap,
      h('div', { class: 'ls__sec' }, h('h3', {}, '附近的工具箱'),
        h('div', { class: 'ls__row' }, ipInput, h('button', { class: 'btn btn--sm', onclick: addIp }, '添加'),
          h('button', { class: 'btn btn--sm btn--ghost', onclick: refresh }, '↻ 刷新'))),
      peersWrap,
      h('div', { class: 'ls__sec' }, h('h3', {}, '发送')),
      drop, textArea,
      h('div', { class: 'ls__row' }, sendBtn),
      bar, status,
      h('div', { class: 'ls__sec' }, h('h3', {}, '记录'), h('button', { class: 'btn btn--sm btn--ghost', onclick: () => api.openFolder() }, '打开 下载/LocalSend')),
      histWrap));

    async function refresh() {
      [me, peers, pending] = await Promise.all([api.info(), api.peers(), api.pending()]);
      renderMe(); renderPeers(); renderIncoming();
      renderHistory(await api.history());
    }

    function onEvent(e) {
      if (!e) return;
      if (e.type === 'peers') { peers = e.peers; renderPeers(); }
      else if (e.type === 'incoming') { if (!pending.some((o) => o.offerId === e.offerId)) pending.push(e); renderIncoming(); }
      else if (e.type === 'incoming-closed') { pending = pending.filter((o) => o.offerId !== e.offerId); renderIncoming(); }
      else if (e.type === 'send-state') { status.textContent = e.text || ''; if (e.state === 'done') toast(e.text); }
      else if (e.type === 'send-progress') { barFill.style.width = `${Math.round((e.sent / Math.max(1, e.total)) * 100)}%`; status.textContent = `正在发 ${e.name}（${e.index + 1}/${e.count}）· ${fmtSize(e.sent)} / ${fmtSize(e.total)}`; }
      else if (e.type === 'recv-progress') { status.textContent = `正在接收 ${e.name} · ${fmtSize(e.got)} / ${fmtSize(e.size)}`; }
      else if (e.type === 'file-received') { status.textContent = `收到 ${e.name}（来自 ${e.from}）`; if (e.done) toast(`收好了，来自 ${e.from}，在 下载/LocalSend`); }
      else if (e.type === 'text-received') { toast(`收到 ${e.from} 的文字`); }
      else if (e.type === 'history') { renderHistory(e.history); }
      else if (e.type === 'error') { status.textContent = e.text; }
    }

    unsub = api.onEvent(onEvent);
    refresh();

    return {
      activate() { refresh(); },
      deactivate() { /* 保持订阅：页面切走也要能接收请求 */ },
      dispose() { if (unsub) unsub(); },
    };
  },
};
