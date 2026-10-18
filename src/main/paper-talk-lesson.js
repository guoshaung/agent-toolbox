'use strict';

function plain(html) {
  return String(html || '').replace(/<(script|style|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<math\b[^>]*alttext="([^"]*)"[\s\S]*?<\/math>/gi, ' $1 ')
    .replace(/<\/(?:p|h[1-6]|tr|section|figcaption)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&[a-z]+;/gi, ' ').replace(/[ \t]+/g, ' ').replace(/\n\s*\n/g, '\n').trim();
}

function extractPaperHtml(html, baseUrl) {
  const main = String(html).match(/<article\b[\s\S]*?<\/article>/i)?.[0] || html;
  const figures = [];
  for (const m of main.matchAll(/<figure\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/figure>/gi)) {
    const src = m[2].match(/<(?:img|object)\b[^>]*\b(?:src|data)="([^"]+)"/i)?.[1];
    if (!src) continue;
    let url;
    try { url = new URL(src, baseUrl); } catch { continue; }
    if (url.protocol !== 'https:' || !/(^|\.)arxiv\.org$/i.test(url.hostname)) continue;
    figures.push({ id: m[1], url: url.href, caption: plain(m[2].match(/<figcaption\b[\s\S]*?<\/figcaption>/i)?.[0] || '').slice(0, 1000) });
  }
  // Retain methods AND findings: a long bibliography must not crowd out the final sections.
  const withoutRefs = main.replace(/<section\b[^>]*(?:id="bib"|class="[^"]*ltx_bibliography)[\s\S]*$/i, '');
  const text = plain(withoutRefs);
  const body = text.length <= 100000 ? text : text.slice(0, 65000) + '\n[中间部分过长，已省略]\n' + text.slice(-35000);
  return { body, figures: figures.slice(0, 12), sourceUrl: baseUrl };
}

function normalizePlan(raw, paper) {
  if (!raw || !Array.isArray(raw.slides) || raw.slides.length < 8 || raw.slides.length > 16) throw new Error('教学规划需要 8–16 个主题页，请重新生成');
  const seen = new Set();
  const slides = raw.slides.map((s, i) => {
    const id = String(s.id || `s${i + 1}`);
    if (seen.has(id)) throw new Error('教学页编号重复');
    seen.add(id);
    const points = (s.points || []).map(p => ({ heading: String(p.heading || '').trim(), detail: String(p.detail || '').trim() }));
    if (points.length < 2 || points.length > 4 || points.some(p => !p.heading || !p.detail || p.heading.length > 40 || p.detail.length > 110)) throw new Error(`第 ${i + 1} 页需要 2–4 条有解释的分层要点，不能只有标题`);
    if (!s.title || !s.takeaway || !s.source || !s.objective) throw new Error(`第 ${i + 1} 页缺少标题、结论、教学目标或来源`);
    const figure = (paper.figures || []).find(f => f.id === s.figureId);
    const table = s.table && Array.isArray(s.table.columns) && Array.isArray(s.table.rows) ? s.table : null;
    if (table && (table.columns.length < 2 || table.columns.length > 4 || table.rows.length < 2 || table.rows.length > 5 || table.rows.some(r => !Array.isArray(r) || r.length !== table.columns.length))) throw new Error(`第 ${i + 1} 页实验表格格式不完整`);
    return { id, chapter: String(s.chapter || ''), title: String(s.title), objective: String(s.objective),
      takeaway: String(s.takeaway), emphasis: s.emphasis === 'core' ? 'core' : 'support', points,
      source: String(s.source), figureId: figure?.id || '', table,
      layout: table ? 'table' : figure ? 'figure' : s.layout === 'comparison' ? 'comparison' : 'outline' };
  });
  if (slides.filter(s => s.emphasis === 'core').length < 3) throw new Error('教学规划必须明确至少三页核心方法或实验重点');
  return { title: String(raw.title || paper.title), slides };
}

function normalizeNarration(raw, plan) {
  if (!Array.isArray(raw?.segments) || !raw.segments.length) throw new Error('讲解脚本没有有效台词');
  const byId = new Map(plan.slides.map(s => [s.id, s]));
  const used = new Map();
  let lastIndex = -1;
  const segments = raw.segments.map(s => {
    const slideId = String(s.slideId || '');
    const slide = byId.get(slideId);
    const text = String(s.text || '').trim();
    if (!slide || !text) throw new Error('台词没有对应教学页或缺少正文');
    const index = plan.slides.indexOf(slide);
    if (index < lastIndex) throw new Error('台词页面顺序与教学规划不一致');
    lastIndex = index;
    const focus = Number.isInteger(s.focus) && s.focus >= 0 && s.focus < slide.points.length ? s.focus : -1;
    used.set(slideId, (used.get(slideId) || 0) + 1);
    return { slideId, speaker: s.speaker === 'B' ? 'B' : 'A', text, focus,
      title: slide.title, subtitle: String(s.caption || slide.takeaway).slice(0, 72) };
  });
  for (const slide of plan.slides) if ((used.get(slide.id) || 0) < 2) throw new Error(`「${slide.title}」需要至少两轮对话，不能一句话换一页`);
  const coreWords = segments.filter(s => byId.get(s.slideId).emphasis === 'core').reduce((n, s) => n + s.text.length, 0);
  const totalWords = segments.reduce((n, s) => n + s.text.length, 0);
  if (coreWords < totalWords * 0.5) throw new Error('方法与实验重点的讲解篇幅不足一半，请调整教学节奏');
  return { title: plan.title, slides: plan.slides, segments, version: 2 };
}

function lessonNotes(script) {
  return ['# ' + script.title, '', ...script.slides.flatMap((s, i) => [
    `## ${i + 1}. ${s.title}${s.emphasis === 'core' ? '（重点）' : ''}`, '', s.takeaway, '',
    ...s.points.map(p => `- **${p.heading}**：${p.detail}`), '', `来源：${s.source}`, '',
  ])].join('\n');
}

module.exports = { plain, extractPaperHtml, normalizePlan, normalizeNarration, lessonNotes };
