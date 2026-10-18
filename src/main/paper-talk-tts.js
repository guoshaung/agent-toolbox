'use strict';
// Volcengine Speech v3. Credentials remain in the main process / encrypted vault.
const { randomUUID } = require('node:crypto');
const ENDPOINT = 'https://openspeech.bytedance.com/api/v3/tts/unidirectional';
const VOICES = Object.freeze({
  mf: { A: 'zh_male_m191_uranus_bigtts', B: 'zh_female_xiaohe_uranus_bigtts' },
  mm: { A: 'zh_male_m191_uranus_bigtts', B: 'zh_male_taocheng_uranus_bigtts' },
  ff: { A: 'zh_female_xiaohe_uranus_bigtts', B: 'zh_female_vv_uranus_bigtts' },
});
function direction(segment, slide = {}) {
  const key = slide.points?.[segment.focus]?.heading || slide.takeaway || '';
  const question = /[？?]/.test(segment.text);
  const tone = ({ curious: '带着好奇心自然追问，句尾轻微上扬', explain: '温和、自信地解释机制和证据', emphasize: '关键结论略放慢，重音清晰但不要喊叫', reflect: '收束语气，审慎说明局限和适用边界' })[segment.delivery]
    || (question ? '带着好奇心自然追问，句尾轻微上扬' : slide.emphasis === 'core' ? '关键机制和实验结论略放慢，强调因果关系' : '亲切自然地讲述');
  return [
    `这是双人学术播客。你是${segment.speaker === 'B' ? '专家讲解者' : '主持人'}，像与真人交流，不要机械播报。${tone}。`,
    `清晰但不要字字用力；逗号轻停，句末自然换气，重点前留短暂停顿，不要读出任何语气指令。${key ? '本轮重点：' + String(key).slice(0,100) + '。' : ''}`,
  ];
}
function payloadFor(segment, voiceMode, slide) {
  const role = segment.speaker === 'B' ? 'B' : 'A';
  const speaker = (VOICES[voiceMode] || VOICES.mf)[role];
  const text = String(segment.text || '').trim();
  if (!text || Buffer.byteLength(text,'utf8') > 20000) throw new Error('配音文本为空或超过单轮长度限制');
  return { req_params: { text, speaker, audio_params: { format: 'mp3', sample_rate: 24000, bit_rate: 160000,
    speech_rate: slide?.emphasis === 'core' ? -5 : 0 },
    additions: JSON.stringify({ context_texts: direction({...segment,speaker:role},slide),
      aigc_metadata: { enable: true, content_producer: 'Agent Toolbox' } }),
  } };
}
function redact(message, key) {
  let text = String(message || '未知错误');
  if (key) text = text.split(key).join('[已隐藏]');
  return text.replace(/(?:X-Api-Key|authorization)\s*[:=]\s*\S+/gi, '[凭据已隐藏]').slice(0,500);
}
async function synthesizeSpeech({ apiKey, segment, voiceMode = 'mf', slide = {}, fetchFn = globalThis.fetch, timeoutMs = 120000 }) {
  if (!apiKey) throw new Error('尚未配置火山语音密钥，请在配音设置中保存');
  let reader;
  try {
    const res = await fetchFn(ENDPOINT, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
      headers: { 'Content-Type':'application/json', 'X-Api-Key':apiKey, 'X-Api-Resource-Id':'seed-tts-2.0', 'X-Api-Request-Id':randomUUID() },
      body: JSON.stringify(payloadFor(segment,voiceMode,slide)),
    });
    if (!res.ok) throw new Error(`火山语音 HTTP ${res.status}：${(await res.text()).slice(0,1000)}`);
    if (!res.body) throw new Error('火山语音未返回音频流');
    reader = res.body.getReader();
    const decoder = new TextDecoder();
    const chunks = []; let pending = '', ended = false, total = 0;
    function line(value) {
      value = value.trim();
      if (!value || value.startsWith('event:') || value.startsWith(':')) return;
      if (value.startsWith('data:')) value = value.slice(5).trim();
      let frame;
      try { frame = JSON.parse(value); } catch { throw new Error('火山语音响应格式异常'); }
      if (frame.code !== 0 && frame.code !== 20000000) throw new Error(`火山语音 ${frame.code}：${frame.message || '合成失败'}`);
      if (typeof frame.data === 'string' && frame.data) {
        if (!/^[A-Za-z0-9+/]+={0,2}$/.test(frame.data)) throw new Error('火山语音音频编码异常');
        const chunk = Buffer.from(frame.data,'base64'); total += chunk.length;
        if (total > 32 * 1024 * 1024) throw new Error('单轮语音数据超过限制');
        chunks.push(chunk);
      }
      if (frame.code === 20000000) ended = true;
    }
    while (true) {
      const {done,value} = await reader.read();
      if (done) break;
      pending += decoder.decode(value,{stream:true});
      let end;
      while ((end=pending.indexOf('\n')) >= 0) {line(pending.slice(0,end)); pending=pending.slice(end+1);}
      if (pending.length > 4*1024*1024) throw new Error('火山语音单帧数据超过限制');
    }
    pending += decoder.decode(); if (pending.trim()) line(pending);
    if (!ended) throw new Error('火山语音连接中断，未收到合成完成确认，请重试');
    if (!total) throw new Error('火山语音未返回有效音频');
    return Buffer.concat(chunks);
  } catch (error) { throw new Error(redact(error.message,apiKey)); }
  finally { if (reader) {try {await reader.cancel();} catch {} reader.releaseLock();} }
}
module.exports = { ENDPOINT, VOICES, direction, payloadFor, synthesizeSpeech };
