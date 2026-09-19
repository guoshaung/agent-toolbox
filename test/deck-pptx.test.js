'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const JSZip = require('jszip');
const { buildTiming, shapeIds, injectTiming } = require('../src/main/pptx-anim');
const { exportDeck, inch, pt } = require('../src/main/deck-pptx');

test('播放器和 pptx 用同一套坐标：1280×720 px 正好是 13.333×7.5 英寸', () => {
  assert.equal(Math.round(inch(1280) * 1000) / 1000, 13.333);
  assert.equal(inch(720), 7.5);
  assert.equal(pt(96), 72);          // 96px = 72pt
});

test('shapeIds 跳过 spTree 自己的分组节点，按 XML 顺序给出形状 id', () => {
  const xml = '<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/></p:nvGrpSpPr>'
    + '<p:sp><p:cNvPr id="2" name="Text 0"/></p:sp>'
    + '<p:sp><p:cNvPr id="7" name="Text 1"/></p:sp></p:spTree>';
  assert.deepEqual(shapeIds(xml), [2, 7]);
});

test('buildTiming：同一步的多个元素只有第一个要点击，其余跟着一起播', () => {
  const xml = buildTiming([
    { spid: 2, anim: 'slide-left', step: 1 },
    { spid: 3, anim: 'slide-right', step: 1 },
    { spid: 4, anim: 'zoom', step: 2 },
  ]);
  assert.equal((xml.match(/nodeType="clickEffect"/g) || []).length, 2, '两步 = 两个 clickEffect');
  assert.equal((xml.match(/nodeType="withEffect"/g) || []).length, 1, '第一步的第二个元素跟着播');
  assert.match(xml, /presetID="2" presetClass="entr" presetSubtype="8"/);   // 从左飞入
  assert.match(xml, /presetID="2" presetClass="entr" presetSubtype="2"/);   // 从右飞入
  assert.match(xml, /presetID="23"/);                                      // 放大
  // 每个 cTn 的 id 必须唯一，否则 PowerPoint 会判定文件损坏
  const ids = [...xml.matchAll(/<p:cTn id="(\d+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, `cTn id 重复了：${ids.join(',')}`);
});

test('buildTiming：没有动画的元素不生成 timing', () => {
  assert.equal(buildTiming([{ spid: 2, anim: 'none', step: 0 }]), '');
  assert.equal(buildTiming([{ spid: 2, anim: 'fade', step: 0 }]), '', 'step 0 是跟着页面出现的，不占步骤');
  assert.equal(buildTiming([]), '');
});

test('injectTiming 放在 </p:sld> 之前，重复注入不会叠加', () => {
  const base = '<p:sld><p:cSld/><p:clrMapOvr/></p:sld>';
  const once = injectTiming(base, '<p:timing>A</p:timing>');
  assert.equal(once, '<p:sld><p:cSld/><p:clrMapOvr/><p:timing>A</p:timing></p:sld>');
  assert.equal(injectTiming(once, '<p:timing>B</p:timing>'), '<p:sld><p:cSld/><p:clrMapOvr/><p:timing>B</p:timing></p:sld>');
});

test('exportDeck：真的写出一个每页带动画的 pptx', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'deck-')), 'out.pptx');
  const result = await exportDeck(file, {
    title: '测试', theme: 'violet',
    slides: [
      { layout: 'cover', title: '封面', subtitle: '副标题', titleAnim: 'zoom', blocks: [] },
      { layout: 'bullets', title: '要点', titleAnim: 'slide-right',
        blocks: [{ type: 'bullets', anim: 'slide-left', step: 1, stagger: true, items: ['一', '二', '三'] }] },
      { layout: 'stats', title: '数字', titleAnim: 'slide-right',
        blocks: [{ type: 'stats', anim: 'zoom', step: 1, items: [{ value: '99', label: 'A' }, { value: '1', label: 'B' }] }] },
    ],
  });
  assert.equal(result.ok, true);
  assert.equal(result.slides, 3);
  assert.equal(result.animatedSlides, 2, '封面没有块，不该有动画');

  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  const slide2 = await zip.file('ppt/slides/slide2.xml').async('string');
  assert.equal((slide2.match(/nodeType="clickEffect"/g) || []).length, 3, '三条要点逐条出现');
  // 动画指向的 spid 必须真的存在于这一页
  const ids = new Set(shapeIds(slide2));
  for (const m of slide2.matchAll(/<p:spTgt spid="(\d+)"/g)) {
    assert.ok(ids.has(Number(m[1])), `动画指向了不存在的形状 ${m[1]}`);
  }
  assert.ok(!(await zip.file('ppt/slides/slide1.xml').async('string')).includes('<p:timing>'));
  fs.rmSync(path.dirname(file), { recursive: true, force: true });
});
