'use strict';

/**
 * 给 .pptx 注入元素级进场动画。
 *
 * pptxgenjs 只会摆静态元素 —— PowerPoint 的动画是每页 slideN.xml 末尾那段
 * <p:timing>，它根本不生成。所以流程是：pptxgenjs 出静态包 → 解压 →
 * 按元素出现顺序把 shape id 和动画对上 → 生成 timing → 重新打包。
 *
 * 只做 3 类进场效果（覆盖了演示里 95% 的需求）：
 *   fade   presetID=10  淡入
 *   fly-in presetID=2   从四个方向飞入，presetSubtype 定方向
 *   zoom   presetID=23  放大淡入
 * 对应 CSS 播放器里的 fade / slide-* / zoom，两边动起来是一样的。
 */

const JSZip = require('jszip');
const fs = require('node:fs');

/** 飞入方向 → PowerPoint 的 presetSubtype，以及动画要改哪个坐标、从哪来 */
const FLY = {
  'slide-left': { subtype: 8, attr: 'ppt_x', from: '0-#ppt_w/2' },      // 从屏幕左外飞进来
  'slide-right': { subtype: 2, attr: 'ppt_x', from: '1+#ppt_w/2' },
  'slide-up': { subtype: 4, attr: 'ppt_y', from: '1+#ppt_h/2' },        // 从下方往上
  'slide-down': { subtype: 1, attr: 'ppt_y', from: '0-#ppt_h/2' },
};

const DURATION = 500;

/** 一个自增的 id 发号器：timing 树里每个 cTn 都要唯一 id */
function counter(start = 1) {
  let n = start;
  return () => (n += 1);
}

const target = (spid) => `<p:tgtEl><p:spTgt spid="${spid}"/></p:tgtEl>`;

/** 所有进场效果都要先把元素设成可见 —— 放映时它在动画播到之前是藏着的 */
const setVisible = (spid, id) =>
  `<p:set><p:cBhvr><p:cTn id="${id}" dur="1" fill="hold">`
  + `<p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn>`
  + `${target(spid)}<p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst>`
  + `</p:cBhvr><p:to><p:strVal val="visible"/></p:to></p:set>`;

const fadeIn = (spid, id) =>
  `<p:animEffect transition="in" filter="fade"><p:cBhvr>`
  + `<p:cTn id="${id}" dur="${DURATION}"/>${target(spid)}</p:cBhvr></p:animEffect>`;

/**
 * 一个效果节点。nodeType 决定它是「点一下才播」还是「跟上一个一起播」。
 */
function effect({ spid, anim, nodeType, nextId }) {
  const rootId = nextId();
  let preset = { id: 10, subtype: 0 };
  let body = '';

  if (FLY[anim]) {
    const fly = FLY[anim];
    preset = { id: 2, subtype: fly.subtype };
    const setId = nextId();
    const animId = nextId();
    body = setVisible(spid, setId)
      + `<p:anim calcmode="lin" valueType="num"><p:cBhvr additive="base">`
      + `<p:cTn id="${animId}" dur="${DURATION}" fill="hold"/>${target(spid)}`
      + `<p:attrNameLst><p:attrName>${fly.attr}</p:attrName></p:attrNameLst></p:cBhvr>`
      + `<p:tavLst>`
      + `<p:tav tm="0"><p:val><p:strVal val="${fly.from}"/></p:val></p:tav>`
      + `<p:tav tm="100000"><p:val><p:strVal val="#${fly.attr}"/></p:val></p:tav>`
      + `</p:tavLst></p:anim>`;
  } else if (anim === 'zoom') {
    preset = { id: 23, subtype: 0 };
    const setId = nextId();
    const fadeId = nextId();
    const scaleId = nextId();
    body = setVisible(spid, setId) + fadeIn(spid, fadeId)
      + `<p:animScale><p:cBhvr><p:cTn id="${scaleId}" dur="${DURATION}" fill="hold"/>${target(spid)}</p:cBhvr>`
      + `<p:from x="0" y="0"/><p:to x="100000" y="100000"/></p:animScale>`;
  } else {
    const setId = nextId();
    const fadeId = nextId();
    body = setVisible(spid, setId) + fadeIn(spid, fadeId);
  }

  return `<p:par><p:cTn id="${rootId}" presetID="${preset.id}" presetClass="entr" presetSubtype="${preset.subtype}"`
    + ` fill="hold" grpId="0" nodeType="${nodeType}">`
    + `<p:stCondLst><p:cond delay="0"/></p:stCondLst>`
    + `<p:childTnLst>${body}</p:childTnLst></p:cTn></p:par>`;
}

/** 一个「点击步骤」：这一步里第一个效果是 clickEffect，其余跟着一起播 */
function clickStep(effects, nextId) {
  const outerId = nextId();
  const innerId = nextId();
  const inner = effects
    .map((e, i) => effect({ ...e, nodeType: i === 0 ? 'clickEffect' : 'withEffect', nextId }))
    .join('');
  return `<p:par><p:cTn id="${outerId}" fill="hold">`
    + `<p:stCondLst><p:cond delay="indefinite"/></p:stCondLst>`
    + `<p:childTnLst><p:par><p:cTn id="${innerId}" fill="hold">`
    + `<p:stCondLst><p:cond delay="0"/></p:stCondLst>`
    + `<p:childTnLst>${inner}</p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn>`
    + `<p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst>`
    + `</p:par>`;
}

/**
 * 把「元素 → 动画 + 第几步」整理成一页的 <p:timing>。
 * @param {{spid:number, anim:string, step:number}[]} items
 */
function buildTiming(items) {
  const animated = items.filter((i) => i.spid && i.anim && i.anim !== 'none' && i.step > 0);
  if (!animated.length) return '';

  const steps = new Map();
  for (const item of animated) {
    if (!steps.has(item.step)) steps.set(item.step, []);
    steps.get(item.step).push(item);
  }
  const nextId = counter(2);          // id 1 给 tmRoot，2 给 mainSeq，效果从 3 开始
  const mainSeqId = nextId();
  const body = [...steps.keys()].sort((a, b) => a - b)
    .map((step) => clickStep(steps.get(step), nextId)).join('');

  return '<p:timing><p:tnLst><p:par>'
    + '<p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst>'
    + '<p:seq concurrent="1" nextAc="seek">'
    + `<p:cTn id="${mainSeqId}" dur="indefinite" nodeType="mainSeq"><p:childTnLst>${body}</p:childTnLst></p:cTn>`
    + '<p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst>'
    + '<p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst>'
    + '</p:seq></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>';
}

/**
 * 读出一页里所有形状的 id，按它们在 XML 里出现的先后。
 * pptxgenjs 按添加顺序写 XML，所以这个顺序 = 我们 addText / addImage 的顺序。
 * 第一个 cNvPr 是 spTree 自己的分组节点，跳掉。
 */
function shapeIds(xml) {
  const ids = [...String(xml).matchAll(/<p:cNvPr\s+id="(\d+)"/g)].map((m) => Number(m[1]));
  return ids.slice(1);
}

/** 把 timing 塞进 </p:cSld> 之后、</p:sld> 之前（clrMapOvr 后面是它的位置） */
function injectTiming(xml, timing) {
  if (!timing) return xml;
  const clean = String(xml).replace(/<p:timing>[\s\S]*?<\/p:timing>/, '');
  if (!clean.includes('</p:sld>')) return clean;
  return clean.replace('</p:sld>', `${timing}</p:sld>`);
}

/**
 * 给已经写好的 pptx 文件补上动画。
 * @param {string} filePath
 * @param {{anim:string, step:number}[][]} plans 每页一个数组，元素顺序要和 addText/addImage 的顺序一致
 */
async function applyAnimations(filePath, plans) {
  const zip = await JSZip.loadAsync(fs.readFileSync(filePath));
  let touched = 0;
  for (let i = 0; i < plans.length; i += 1) {
    const entry = zip.file(`ppt/slides/slide${i + 1}.xml`);
    if (!entry) continue;
    const xml = await entry.async('string');
    const ids = shapeIds(xml);
    const items = (plans[i] || []).map((plan, k) => ({ spid: ids[k], anim: plan.anim, step: plan.step }));
    const timing = buildTiming(items);
    if (!timing) continue;
    zip.file(`ppt/slides/slide${i + 1}.xml`, injectTiming(xml, timing));
    touched += 1;
  }
  if (!touched) return { ok: true, animatedSlides: 0 };
  const out = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  fs.writeFileSync(filePath, out);
  return { ok: true, animatedSlides: touched };
}

module.exports = { applyAnimations, buildTiming, shapeIds, injectTiming, FLY };
