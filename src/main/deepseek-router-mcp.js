'use strict';
/**
 * DeepSeek 路由 MCP：给 Claude（Desktop / Code）一个「把简单活甩给 DeepSeek」的工具，省 Claude 额度。
 *
 * 真正省 token 的是两个参数，不是「换个模型回答」本身：
 *   - files：大输入传路径，由本 server 读文件发给 DeepSeek，内容不进 Claude 上下文；
 *   - output_file：长输出直接写文件，只回一句确认 + 短预览，不回灌给 Claude。
 * 由工具箱「其他 → MCP 配置」一键安装：用工具箱自带的 Electron 当 node 跑（ELECTRON_RUN_AS_NODE=1），
 * key 从保险箱取出后写进客户端 MCP 配置的 env。
 *
 * env：DEEPSEEK_API_KEY（必填）、DEEPSEEK_BASE_URL（默认 https://api.deepseek.com）、
 *      DEEPSEEK_MODEL（默认 deepseek-chat）、DEEPSEEK_REASONER_MODEL（默认 deepseek-reasoner）、
 *      DEEPSEEK_ROUTER_LOG（用量日志 jsonl，可选）。
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');

const KEY = String(process.env.DEEPSEEK_API_KEY || '').trim();
const BASE = String(process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, '');
const MODELS = {
  chat: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
  reasoner: process.env.DEEPSEEK_REASONER_MODEL || 'deepseek-reasoner',
};
const LOG = process.env.DEEPSEEK_ROUTER_LOG || path.join(os.homedir(), '.agent-toolbox', 'deepseek-router', 'usage.jsonl');
const PER_FILE = 300 * 1024;
const TOTAL = 600 * 1024;

const INSTRUCTIONS = [
  'deepseek-router 把「简单、独立、能一眼验收」的文本活交给 DeepSeek 去做，省 Claude 的额度。',
  '适合交出去：翻译；总结/提炼长文档或日志；改写润色；格式转换（JSON↔CSV↔Markdown 表格等）；',
  '写样板代码/测试数据/正则并附解释；根据 diff 文件起草提交说明；批量生成相似文本。',
  '不要交出去：需要读整个仓库推理、需要调用工具或改代码后验证的；正确性要求高又没法核对的；',
  '含密钥、密码、个人隐私或公司保密内容的（会发到 DeepSeek 的服务器）。',
  '省 token 的用法：大输入用 files 传绝对路径，别把内容贴进 task；长输出用 output_file 写到文件，',
  '只读回预览。DeepSeek 的结果要你过目把关，别不看就用。',
].join('');

function deny(p) {
  const s = p.replace(/\\/g, '/');
  return /\/\.ssh\/|\/\.gnupg\/|\/Keychains\/|\/\.aws\/|\/\.kube\/|(^|\/)\.env(\.|$)|\.pem$|\.key$|(^|\/)id_(rsa|ed25519|ecdsa)/i.test(s);
}

function readInputs(files) {
  const blocks = []; let total = 0;
  for (const raw of files) {
    const p = path.resolve(String(raw));
    if (!path.isAbsolute(String(raw))) throw new Error(`files 要用绝对路径：${raw}`);
    if (deny(p)) throw new Error(`出于安全不发送这个文件：${p}`);
    const st = fs.statSync(p);
    if (!st.isFile()) throw new Error(`不是文件：${p}`);
    if (st.size > PER_FILE) throw new Error(`${p} 有 ${Math.round(st.size / 1024)}KB，单个文件上限 ${PER_FILE / 1024}KB`);
    total += st.size;
    if (total > TOTAL) throw new Error(`文件合计超过 ${TOTAL / 1024}KB，分几次发`);
    const text = fs.readFileSync(p, 'utf8');
    if (text.includes('\u0000')) throw new Error(`${p} 像是二进制文件`);
    blocks.push(`<file path="${p}">\n${text}\n</file>`);
  }
  return blocks;
}

function logUsage(row) {
  try { fs.mkdirSync(path.dirname(LOG), { recursive: true }); fs.appendFileSync(LOG, JSON.stringify(row) + '\n'); } catch { /* 日志失败不影响结果 */ }
}

async function callDeepSeek({ model, system, user, maxTokens }) {
  if (!KEY) throw new Error('没配置 DEEPSEEK_API_KEY：去工具箱「其他 → MCP 配置」重新安装 DeepSeek 路由');
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: user });
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens, stream: false }),
    signal: AbortSignal.timeout(240000),
  });
  const bodyText = await res.text();
  if (!res.ok) throw new Error(`DeepSeek HTTP ${res.status}：${bodyText.split(KEY).join('[已隐藏]').slice(0, 300)}`);
  const j = JSON.parse(bodyText);
  const text = j.choices?.[0]?.message?.content || '';
  return { text, usage: j.usage || {} };
}

function out(value) { return { content: [{ type: 'text', text: value }] }; }

const server = new McpServer({ name: 'deepseek-router', version: '1.0.0' }, { instructions: INSTRUCTIONS });

server.registerTool('deepseek', {
  description: '把一个简单、独立的文本任务交给 DeepSeek 完成并返回结果（翻译、总结、改写、格式转换、样板代码等）。'
    + '大输入请用 files 传绝对路径（内容不会进你的上下文）；长输出请给 output_file（只回预览）。不要发送机密。',
  inputSchema: {
    task: z.string().min(1).describe('要 DeepSeek 做什么，写清楚要求和输出格式'),
    files: z.array(z.string()).max(20).default([]).describe('作为输入的文本文件绝对路径'),
    system: z.string().optional().describe('可选的系统提示'),
    model: z.enum(['chat', 'reasoner']).default('chat').describe('chat 快且便宜；reasoner 用于需要推理的数学/逻辑'),
    output_file: z.string().optional().describe('把结果写到这个绝对路径，而不是返回全文'),
    overwrite: z.boolean().default(false).describe('output_file 已存在时是否覆盖'),
    max_output_tokens: z.number().int().min(64).max(8192).default(4096),
  },
}, async ({ task, files, system, model, output_file: outFile, overwrite, max_output_tokens: maxTokens }) => {
  const started = Date.now();
  const blocks = readInputs(files || []);
  const user = blocks.length ? `${task}\n\n以下是输入文件：\n\n${blocks.join('\n\n')}` : task;
  const modelName = MODELS[model] || MODELS.chat;
  const { text, usage } = await callDeepSeek({ model: modelName, system, user, maxTokens });
  logUsage({ at: new Date().toISOString(), model: modelName, in: usage.prompt_tokens || 0, out: usage.completion_tokens || 0, files: (files || []).length, toFile: Boolean(outFile), ms: Date.now() - started });
  const meta = `（DeepSeek ${modelName} · 输入 ${usage.prompt_tokens ?? '?'} / 输出 ${usage.completion_tokens ?? '?'} tokens）`;
  if (outFile) {
    if (!path.isAbsolute(outFile)) throw new Error('output_file 要用绝对路径');
    if (deny(outFile)) throw new Error('不往这个位置写文件');
    if (fs.existsSync(outFile) && !overwrite) throw new Error(`${outFile} 已存在；要覆盖请传 overwrite: true`);
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, text, 'utf8');
    return out(`已写入 ${outFile}（${text.length} 字）${meta}\n预览：\n${text.slice(0, 300)}${text.length > 300 ? '…' : ''}`);
  }
  return out(`${text}\n\n${meta}`);
});

server.registerTool('deepseek_usage', {
  description: '查看 DeepSeek 路由的用量：今天和累计调用次数、输入/输出 tokens。',
  inputSchema: {},
}, async () => {
  let rows = [];
  try { rows = fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { /* 还没有 */ }
  const today = new Date().toISOString().slice(0, 10);
  const sum = (list) => list.reduce((a, r) => ({ n: a.n + 1, i: a.i + (r.in || 0), o: a.o + (r.out || 0) }), { n: 0, i: 0, o: 0 });
  const t = sum(rows.filter((r) => String(r.at).startsWith(today))); const all = sum(rows);
  return out(`今天：${t.n} 次，输入 ${t.i} / 输出 ${t.o} tokens\n累计：${all.n} 次，输入 ${all.i} / 输出 ${all.o} tokens\n（输出 tokens ≈ 少让 Claude 生成的量）`);
});

server.connect(new StdioServerTransport()).catch((e) => { process.stderr.write(`deepseek-router 启动失败：${e.message}\n`); process.exit(1); });
