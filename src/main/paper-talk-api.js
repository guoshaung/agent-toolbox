'use strict';

// Streaming keeps reverse proxies alive during long lesson generation.
async function requestPaperText({ endpoint, apiKey, model, prompt, fetchFn = globalThis.fetch }) {
  const clean = s => String(s).split(apiKey).join('[已隐藏]');
  const res = await fetchFn(endpoint, {
    method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], stream: true }),
    signal: AbortSignal.timeout(300000),
  });
  if (!res.ok) throw new Error(`AI HTTP ${res.status}：${clean((await res.text()).slice(0, 300))}`);
  if (!/text\/event-stream/i.test(res.headers.get('content-type') || '')) {
    const body = await res.text();
    let json; try { json = JSON.parse(body); } catch { throw new Error('AI 返回了网页或非 JSON 内容，请重试'); }
    const text = json.choices?.[0]?.message?.content;
    if (!text) throw new Error(clean(json.error?.message || 'AI 返回空内容'));
    return text;
  }
  const decoder = new TextDecoder();
  let pending = '', text = '', finished = false;
  function line(value) {
    if (!value.startsWith('data:')) return;
    const data = value.slice(5).trim();
    if (!data) return;
    if (data === '[DONE]') { finished = true; return; }
    const json = JSON.parse(data);
    if (json.error) throw new Error(clean(json.error.message || 'AI 流式生成失败'));
    const choice = json.choices?.[0];
    if (choice?.finish_reason === 'length') throw new Error('AI 达到输出长度限制，脚本未完成');
    if (choice?.finish_reason) finished = true;
    const content = choice?.delta?.content;
    if (typeof content === 'string') text += content;
    if (text.length > 200000) throw new Error('AI 返回内容超过论文讲解长度限制');
  }
  for await (const chunk of res.body) {
    pending += decoder.decode(chunk, { stream: true });
    const lines = pending.split(/\r?\n/); pending = lines.pop();
    for (const value of lines) line(value);
  }
  pending += decoder.decode();
  if (pending.trim()) line(pending);
  if (!finished) throw new Error('AI 连接中断，脚本未完整返回，请重试');
  if (!text.trim()) throw new Error('AI 返回空内容');
  return text;
}

module.exports = { requestPaperText };
