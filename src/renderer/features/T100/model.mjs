export const MAX_CHARS = 100000;
export const TRACKING = Object.freeze(['utm_source','utm_medium','utm_campaign','utm_term','utm_content','utm_id','utm_name']);
export const CLICK_IDS = Object.freeze(['gclid','dclid','fbclid','msclkid']);
export const INVISIBLE = Object.freeze([
  { key: 'zeroSpace', title: '零宽空格 U+200B', codes: [0x200b], default: true },
  { key: 'bom', title: 'BOM / 零宽不换行空格 U+FEFF', codes: [0xfeff], default: true },
  { key: 'joiners', title: '连字控制 U+200C / U+200D（可能影响文字与表情）', codes: [0x200c,0x200d], default: false },
  { key: 'wordJoiner', title: '词连接符 U+2060', codes: [0x2060], default: false },
  { key: 'bidi', title: '方向控制 U+202A–202E / U+2066–2069（可能影响双向文字）', codes: [0x202a,0x202b,0x202c,0x202d,0x202e,0x2066,0x2067,0x2068,0x2069], default: false },
]);
function checkedInput(value) {
  if (typeof value !== 'string') throw Error('请输入文本。');
  if (value.length > MAX_CHARS) throw Error('输入超过 100000 字符上限。');
}
export function cleanUrl(original, options = {}) {
  checkedInput(original);
  const trim = options.trim !== false, includeClickIds = options.clickIds === true;
  const source = trim ? original.trim() : original;
  if (!source || /\s/u.test(source)) throw Error('URL 不能为空或包含空白字符；请核对输入与首尾修剪规则。');
  let parsed;
  try { parsed = new URL(source); } catch { throw Error('请输入完整 HTTP 或 HTTPS URL。'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw Error('仅支持 HTTP / HTTPS URL。');
  const hashAt = source.indexOf('#'), head = hashAt < 0 ? source : source.slice(0, hashAt), fragment = hashAt < 0 ? '' : source.slice(hashAt);
  const queryAt = head.indexOf('?'), changes = [], warnings = [];
  if (trim && source !== original) changes.push({ kind: 'trim', before: original, after: source });
  let result = source;
  const keys = new Set([...TRACKING, ...(includeClickIds ? CLICK_IDS : [])]);
  if (queryAt >= 0) {
    const prefix = head.slice(0,queryAt), query = head.slice(queryAt + 1), kept = [];
    for (const [index, raw] of query.split('&').entries()) {
      const eq = raw.indexOf('='), rawName = eq < 0 ? raw : raw.slice(0,eq);
      let name;
      try { name = decodeURIComponent(rawName.replace(/\+/gu,' ')); }
      catch { kept.push(raw); warnings.push({ parameter: index + 1, reason: '参数名有非法百分号编码，原样保留。' }); continue; }
      if (keys.has(name.toLowerCase())) changes.push({ kind: 'parameter', parameter: index + 1, name, raw });
      else kept.push(raw);
    }
    // Preserve all retained tokens byte-for-byte, including empty tokens and the fragment.
    if (changes.some(change => change.kind === 'parameter')) result = prefix + (kept.length ? '?' + kept.join('&') : '') + fragment;
  }
  return { feature:'T100',schemaVersion:1,mode:'url',original,result,rules:{trim,clickIds:includeClickIds,parameterNames:[...keys]},changes,warnings };
}
export function cleanText(original, selected = INVISIBLE.filter(rule=>rule.default).map(rule=>rule.key)) {
  checkedInput(original);
  if (!Array.isArray(selected) || selected.some(key=>!INVISIBLE.some(rule=>rule.key===key))) throw Error('请选择有效的字符规则。');
  const codes = new Set(INVISIBLE.filter(rule=>selected.includes(rule.key)).flatMap(rule=>rule.codes));
  const chunks=[],changes=[];
  for (let offset=0;offset<original.length;) {
    const code=original.codePointAt(offset), char=String.fromCodePoint(code);
    if (codes.has(code)) changes.push({kind:'character',offset,codePoint:'U+'+code.toString(16).toUpperCase().padStart(4,'0')});
    else chunks.push(char);
    offset+=char.length;
  }
  return {feature:'T100',schemaVersion:1,mode:'text',original,result:chunks.join(''),rules:{selected:[...new Set(selected)],offsetUnit:'UTF-16，从 0 开始'},changes,warnings:[]};
}
