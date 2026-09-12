'use strict';

const fs = require('node:fs');
const path = require('node:path');
const PptxGenJS = require('pptxgenjs');

const MAX_SLIDES = 60;
const MAX_TEXT = 16000;

function text(value, limit = MAX_TEXT) {
  return String(value || '').trim().slice(0, limit);
}

function normalizeSlide(slide, index) {
  const bullets = Array.isArray(slide?.bullets)
    ? slide.bullets.map((item) => text(item, 1200)).filter(Boolean).slice(0, 12)
    : text(slide?.body, 9000).split(/\r?\n/).map((item) => item.trim()).filter(Boolean).slice(0, 12);
  return {
    title: text(slide?.title, 240) || `第 ${index + 1} 页`,
    subtitle: text(slide?.subtitle, 500),
    bullets,
    references: text(slide?.references, 1600),
    notes: text(slide?.notes, 5000),
    imageDataUrl: /^data:image\/(?:png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/.test(String(slide?.imageDataUrl || ''))
      ? slide.imageDataUrl : '',
  };
}

function normalizeDeck(deck = {}) {
  const slides = Array.isArray(deck.slides) ? deck.slides.slice(0, MAX_SLIDES) : [];
  return {
    title: text(deck.title, 240) || '科研演示',
    slides: slides.length ? slides.map(normalizeSlide) : [normalizeSlide({}, 0)],
  };
}

async function exportPptx(filePath, deck) {
  const normalized = normalizeDeck(deck);
  const target = path.resolve(String(filePath || ''));
  if (!target || target === path.parse(target).root) throw new Error('PPTX 保存路径无效。');
  fs.mkdirSync(path.dirname(target), { recursive: true });

  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'Agent Toolbox';
  pptx.company = 'Agent Toolbox';
  pptx.subject = '科研演示文稿';
  pptx.title = normalized.title;
  pptx.lang = 'zh-CN';

  normalized.slides.forEach((item, index) => {
    const slide = pptx.addSlide();
    slide.background = { color: 'F7F9FC' };
    slide.addText(`${String(index + 1).padStart(2, '0')}  /  ${String(normalized.slides.length).padStart(2, '0')}`, {
      x: 0.62, y: 0.35, w: 1.1, h: 0.2, fontFace: 'Aptos', fontSize: 8, color: '6C7A89', margin: 0,
    });
    slide.addText(item.title, {
      x: 0.62, y: 0.72, w: 8.2, h: 0.56, fontFace: 'Aptos Display', fontSize: 25, bold: true,
      color: '172A46', margin: 0, breakLine: false,
    });
    if (item.subtitle) slide.addText(item.subtitle, {
      x: 0.65, y: 1.38, w: 8.2, h: 0.35, fontFace: 'Aptos', fontSize: 13, color: '58708D', margin: 0,
    });

    if (item.imageDataUrl) {
      slide.addImage({ data: item.imageDataUrl, sizing: { type: 'contain', x: 7.65, y: 1.95, w: 5.0, h: 3.75 } });
    }

    if (item.bullets.length) {
      const runs = item.bullets.map((bullet) => ({
        text: bullet,
        options: { bullet: { indent: 18 }, hanging: 4, breakLine: true },
      }));
      slide.addText(runs, {
        x: 0.85, y: 2.0, w: item.imageDataUrl ? 6.25 : 11.25, h: 3.7,
        fontFace: 'Aptos', fontSize: 17, color: '263A55', breakLine: false,
        valign: 'mid', paraSpaceAfterPt: 13, margin: 0.08, fit: 'shrink',
      });
    }

    if (item.references) slide.addText(`References  ${item.references}`, {
      x: 0.65, y: 6.95, w: 11.9, h: 0.25, fontFace: 'Aptos', fontSize: 8, color: '718096', margin: 0,
      fit: 'shrink',
    });
    if (item.notes) slide.addNotes(item.notes);
  });

  await pptx.writeFile({ fileName: target });
  return { ok: true, path: target, slides: normalized.slides.length, size: fs.statSync(target).size };
}

module.exports = { exportPptx, normalizeDeck, normalizeSlide };
