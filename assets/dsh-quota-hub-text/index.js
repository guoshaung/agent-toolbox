import http from 'node:http'
import https from 'node:https'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const name = 'toolbox-quota-hub-text'

const HOST = '127.0.0.1'
const PORT = 18879
const CONFIG_FILE = path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'toolbox-quota-hub-text.json')
const MAX_BODY = 2 * 1024 * 1024
const MAX_USER_CHARS = 16000
const MAX_CONTEXT_CHARS = 12000
const MAX_CONTEXT_MESSAGES = 20

function respond(res, status, message) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify({ error: { type: 'text_only_route', message } }))
}

function pureText(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content) && content.every(part => part?.type === 'text' && typeof part.text === 'string')) {
    return content.map(part => part.text).join('\n')
  }
  return null
}

function assistantText(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return null
  return content.filter(part => part?.type === 'text' && typeof part.text === 'string').map(part => part.text).join('\n') || null
}

export function normalizeTextRequest(input) {
  if (!input || input.model !== 'auto' || !Array.isArray(input.messages)) throw new Error('只支持模型 auto 的纯文本消息')
  const messages = input.messages
  const conversation = []
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i]
    if (message?.role === 'user') {
      const content = pureText(message.content)
      // DSH 会在真实用户输入后追加一段短说明和大型工具前导。
      // 只在相邻三条 user 消息吻合已验证的形状时丢弃这两段前导。
      if (content?.length > 32000 && i >= 2
          && messages[i - 1]?.role === 'user' && pureText(messages[i - 1].content)?.length < 2000
          && messages[i - 2]?.role === 'user' && conversation.at(-1)?.role === 'user') {
        conversation.pop()
        continue
      }
      if (content === null) throw new Error('当前路由不支持图片或文件消息')
      if (content && content.length <= MAX_USER_CHARS) conversation.push({ role: 'user', content })
      else if (content?.length > MAX_USER_CHARS) throw new Error('用户文本超过长度上限')
    } else if (message?.role === 'assistant') {
      const content = assistantText(message.content)
      if (content) conversation.push({ role: 'assistant', content })
    }
  }
  if (conversation.at(-1)?.role !== 'user') throw new Error('缺少当前用户文本')
  const selected = [conversation.at(-1)]
  let length = selected[0].content.length
  for (let i = conversation.length - 2; i >= 0 && selected.length < MAX_CONTEXT_MESSAGES; i--) {
    const message = conversation[i]
    if (length + message.content.length > MAX_CONTEXT_CHARS) break
    selected.unshift(message)
    length += message.content.length
  }
  while (selected[0]?.role === 'assistant') selected.shift()
  return {
    model: 'auto',
    messages: selected,
    stream: input.stream === true,
    max_tokens: 4096,
  }
}

export function targetUrl(baseUrl, requestPath) {
  const base = new URL(baseUrl)
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)
  if ((base.protocol !== 'https:' && !(base.protocol === 'http:' && loopback))
      || base.username || base.password || base.search || base.hash
      || base.hostname === HOST && base.port === String(PORT)) throw new Error('invalid upstream address')
  const target = new URL(base.href)
  target.pathname = base.pathname.replace(/\/+$/, '') + requestPath.slice('/v1'.length)
  return target
}

function upstreamUrl(requestPath) {
  const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))
  return targetUrl(saved.baseUrl, requestPath)
}

function forward(req, res, body) {
  let target
  try { target = upstreamUrl(req.url) }
  catch { respond(res, 503, '远端额度中枢地址未配置或无效'); return }
  const headers = {
    Authorization: req.headers.authorization,
    'Content-Type': 'application/json',
    'Content-Length': String(body.length),
  }
  const transport = target.protocol === 'https:' ? https : http
  const upstream = transport.request({ hostname: target.hostname, port: target.port || undefined, path: target.pathname, method: req.method, headers, timeout: 120000 }, reply => {
    const responseHeaders = {
      'Content-Type': reply.headers['content-type'] || 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    }
    if (reply.headers['x-toolbox-channel']) responseHeaders['X-Toolbox-Channel'] = reply.headers['x-toolbox-channel']
    res.writeHead(reply.statusCode || 502, responseHeaders)
    reply.pipe(res)
  })
  upstream.on('timeout', () => upstream.destroy(new Error('upstream timeout')))
  upstream.on('error', () => {
    if (!res.headersSent) respond(res, 502, '远端额度中枢暂不可达')
    else res.destroy()
  })
  upstream.end(body)
}

export function createServer() {
  return http.createServer((req, res) => {
    if (req.headers.host !== `${HOST}:${PORT}` || req.headers.origin || req.headers['sec-fetch-site'] === 'cross-site') {
      respond(res, 403, '只允许本机 DSH 访问')
      return
    }
    if (!/^Bearer\s+\S+$/i.test(req.headers.authorization || '')) {
      respond(res, 401, '缺少网关密钥')
      return
    }
    if (req.method === 'GET' && req.url === '/v1/models') {
      forward(req, res, Buffer.alloc(0))
      return
    }
    if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
      respond(res, 404, '仅支持 Chat Completions 文本接口')
      return
    }
    const chunks = []
    let size = 0
    req.on('data', chunk => {
      size += chunk.length
      if (size > MAX_BODY) {
        respond(res, 413, '请求体过大')
        req.destroy()
      } else chunks.push(chunk)
    })
    req.on('end', () => {
      if (res.writableEnded) return
      try {
        const normalized = normalizeTextRequest(JSON.parse(Buffer.concat(chunks).toString('utf8')))
        forward(req, res, Buffer.from(JSON.stringify(normalized)))
      } catch (error) {
        respond(res, 422, error.message)
      }
    })
  })
}

export function apply(ctx) {
  ctx.effect(() => {
    const server = createServer()
    server.on('error', error => console.error('[toolbox-quota-hub-text] listen failed:', error.code || error.name))
    server.listen(PORT, HOST)
    return () => server.close()
  }, 'toolbox-quota-hub-text: local text bridge')
}
