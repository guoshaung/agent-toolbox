import { h } from './ui.js';

/** 够用的 Markdown → DOM：标题、列表、代码块、行内代码、粗体。不引库。 */
export function md(text) {
  const root = h('div', { class: 'tidy__md md' });
  const lines = String(text || '').split('\n');
  let list = null; let pre = null;
  const inline = (s) => {
    const frag = document.createDocumentFragment();
    const parts = s.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
    for (const part of parts) {
      if (!part) continue;
      if (part.startsWith('`')) frag.append(h('code', {}, part.slice(1, -1)));
      else if (part.startsWith('**')) frag.append(h('strong', {}, part.slice(2, -2)));
      else frag.append(part);
    }
    return frag;
  };
  for (const raw of lines) {
    if (raw.startsWith('```')) { if (pre) { root.append(pre); pre = null; } else pre = h('pre', {}, h('code')); continue; }
    if (pre) { pre.firstChild.append(raw + '\n'); continue; }
    const line = raw.trimEnd();
    const hm = line.match(/^(#{1,4})\s+(.*)/);
    if (hm) { list = null; root.append(h('h2', {}, hm[2])); continue; }
    const lm = line.match(/^\s*(?:[-*]|\d+\.)\s+(.*)/);
    if (lm) { if (!list) { list = h(/^\s*\d/.test(line) ? 'ol' : 'ul'); root.append(list); } list.append(h('li', {}, inline(lm[1]))); continue; }
    list = null;
    if (line.trim()) root.append(h('p', {}, inline(line)));
  }
  if (pre) root.append(pre);
  return root;
}

