import { h } from './ui.js';

/**
 * 全局拖放：把任何文件 / 文件夹拖到工具箱窗口上，弹一个「你想干嘛」。
 *
 * 各工具自己的拖放区（收纳的「看懂项目」、科研文献、容器…）会 preventDefault，
 * 这里只接没人接的那些。给懒人的：不用先想「该拖到哪个工具」。
 */

const IMAGE = /\.(png|jpe?g|gif|webp|heic|heif|bmp|tiff?|svg|avif)$/i;
const PAPER = /\.(pdf|docx?|pptx?|epub|md|txt)$/i;
const ARCHIVE = /\.(zip|rar|7z|tar|gz|tgz)$/i;

/** 根据拖进来的东西决定给哪几个选项。纯函数，方便测。 */
export function dropActions(paths, { hasPhone = true } = {}) {
  const list = (paths || []).filter(Boolean);
  if (!list.length) return [];
  const dirs = list.filter((p) => !/\.[a-z0-9]{1,5}$/i.test(p.split('/').pop()));
  const papers = list.filter((p) => PAPER.test(p));
  const images = list.filter((p) => IMAGE.test(p));
  const out = [];
  if (dirs.length === 1 && list.length === 1) out.push({ id: 'learn', title: '看懂这个项目', hint: '让 AI 讲它是什么、怎么跑、从哪个文件读起', icon: '🎓' });
  if (papers.length) out.push({ id: 'lit', title: `收进科研文献（${papers.length}）`, hint: 'PDF / Word / PPT 进文献库，科研工具里能读', icon: '📚', only: papers });
  out.push({ id: 'container', title: `收进容器（${list.length}）`, hint: '复制一份到工具箱的资料容器，AI 能归类', icon: '📦' });
  if (hasPhone) out.push({ id: 'phone', title: `递给手机（${list.length}）`, hint: '放进出件箱，手机精灵几秒内取走', icon: '📱' });
  if (images.length === list.length) out.push({ id: 'avatar', title: '拿去建模', hint: '单图 / 三视图 → 3D 形象', icon: '🧊' });
  out.push({ id: 'reveal', title: '在访达里显示', hint: list.length > 1 ? '显示第一个' : '', icon: '📁' });
  if (ARCHIVE.test(list[0])) out[out.length - 1].hint = '压缩包先解开再说';
  return out;
}

export function createDropzone({ activate, config, toast }) {
  let paths = [];
  const list = h('div', { class: 'palette__list' });
  const head = h('div', { class: 'palette__head dropzone__head' });
  const root = h('div', { class: 'palette dropzone', hidden: true },
    h('div', { class: 'palette__panel' }, head, list, h('div', { class: 'palette__foot faint' }, '↑↓ 选 · 回车确定 · Esc 算了')),
  );
  document.body.appendChild(root);
  let index = 0; let actions = [];

  const run = async (action) => {
    hide();
    const targets = action.only || paths;
    try {
      if (action.id === 'learn') { await config.set('tidy.pending', paths[0]); activate('tidy'); }
      else if (action.id === 'lit') { const r = await window.toolbox.lit.importFiles(targets); toast(r?.ok === false ? r.error : `收进文献库 ${r?.imported?.length ?? targets.length} 份`, r?.ok === false ? 'bad' : 'good'); activate('research'); }
      else if (action.id === 'container') { const r = await window.toolbox.container.import({ sources: targets }); toast(r?.ok === false ? r.error : `收进容器 ${r?.imported?.length ?? r?.count ?? targets.length} 项`, r?.ok === false ? 'bad' : 'good'); activate('container'); }
      else if (action.id === 'phone') { const r = await window.toolbox.phone.sendFiles(targets); toast(r.ok ? `放进出件箱：${r.sent.map((x) => x.name).join('、')}` : (r.errors?.[0] || '递不出去'), r.ok ? 'good' : 'bad'); }
      else if (action.id === 'avatar') { activate('avatar-rig'); toast('把图再拖到建模面板里', 'info'); }
      else if (action.id === 'reveal') { await window.toolbox.tidy.reveal(paths[0]); }
    } catch (error) { toast(error.message || '没做成', 'bad'); }
  };

  function render() {
    const names = paths.map((p) => p.split('/').pop());
    head.replaceChildren(h('span', { class: 'dropzone__title' }, '📥 ', names.length === 1 ? names[0] : `${names[0]} 等 ${names.length} 项`), h('span', { class: 'faint dropzone__sub' }, '要怎么处理？'), h('kbd', {}, 'esc'));
    list.replaceChildren(...actions.map((a, i) => {
      const row = h('div', { class: `palette__row${i === index ? ' is-active' : ''}` },
        h('span', { class: 'palette__icon' }, a.icon), h('span', { class: 'palette__text' }, h('span', { class: 'palette__title' }, a.title), a.hint ? h('span', { class: 'palette__hint' }, a.hint) : null));
      row.addEventListener('pointermove', () => { if (index !== i) { index = i; highlight(); } });
      row.addEventListener('click', () => run(a));
      return row;
    }));
  }
  function highlight() { [...list.children].forEach((el, i) => el.classList.toggle('is-active', i === index)); }
  function show(next) { paths = next; actions = dropActions(paths); if (!actions.length) return; index = 0; render(); root.hidden = false; root.focus(); }
  function hide() { root.hidden = true; }

  root.tabIndex = -1;
  root.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); index = Math.min(actions.length - 1, index + 1); highlight(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); index = Math.max(0, index - 1); highlight(); }
    else if (e.key === 'Enter') { e.preventDefault(); run(actions[index]); }
    else if (e.key === 'Escape') { e.preventDefault(); hide(); }
  });
  root.addEventListener('pointerdown', (e) => { if (e.target === root) hide(); });

  // 只接没人接的拖放：工具自己的拖放区会 preventDefault，那时 defaultPrevented 为 true
  window.addEventListener('dragover', (e) => { if (!e.defaultPrevented && e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; document.body.classList.add('is-dropping'); } });
  window.addEventListener('dragleave', (e) => { if (!e.relatedTarget) document.body.classList.remove('is-dropping'); });
  window.addEventListener('drop', (e) => {
    document.body.classList.remove('is-dropping');
    if (e.defaultPrevented) return;
    const files = [...(e.dataTransfer?.files || [])];
    if (!files.length) return;
    e.preventDefault();
    const next = files.map((f) => window.toolbox.files.getPathForFile(f)).filter(Boolean);
    if (next.length) show(next);
  });

  return { show, hide };
}
