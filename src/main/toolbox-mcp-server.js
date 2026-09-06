'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const container = require('./container-storage');
const litFetch = require('./lit-fetch');

const userData = path.resolve(process.env.AGENT_TOOLBOX_USER_DATA || '');
if (!userData) throw new Error('AGENT_TOOLBOX_USER_DATA is required');
const getUserDataPath = () => userData;
const root = container.containerRoot(getUserDataPath);
const literatureDir = path.join(userData, 'literature');
fs.mkdirSync(literatureDir, { recursive: true });

function text(value) {
  return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] };
}

async function safeFile(relPath, { createParent = false } = {}) {
  const value = String(relPath || '').replace(/\\/g, '/');
  if (!value || value.startsWith('/') || value.split('/').includes('..')) throw new Error('路径必须是容器内的相对路径。');
  const target = path.resolve(root, value);
  if (target === root || !target.startsWith(root + path.sep)) throw new Error('拒绝访问容器以外的路径。');
  if (createParent) await fsp.mkdir(path.dirname(target), { recursive: true });
  return target;
}

const server = new McpServer({ name: 'agent-toolbox', version: '0.1.0' });

server.registerTool('container_status', {
  description: '查看 Agent 工具箱容器的跨平台根目录和顶层内容。所有未分类输出都应写入此容器。',
  inputSchema: {},
}, async () => text(await container.listContainer(getUserDataPath, '')));

server.registerTool('container_list', {
  description: '列出 Agent 工具箱容器内的目录。只能使用容器相对路径。',
  inputSchema: { path: z.string().default('') },
}, async ({ path: relPath }) => text(await container.listContainer(getUserDataPath, relPath)));

server.registerTool('container_read_text', {
  description: '读取容器内的 UTF-8 文本文件，最大 2MB；不能读取容器外文件。',
  inputSchema: { path: z.string().min(1) },
}, async ({ path: relPath }) => {
  const target = await safeFile(relPath);
  const stat = await fsp.stat(target);
  if (!stat.isFile() || stat.size > 2 * 1024 * 1024) throw new Error('文件不存在、不是普通文件或超过 2MB。');
  return text(await fsp.readFile(target, 'utf8'));
});

server.registerTool('container_write_text', {
  description: '把文本写入容器。默认拒绝覆盖已有文件，不能写到容器外。',
  inputSchema: { path: z.string().min(1), content: z.string().max(2_000_000), overwrite: z.boolean().default(false) },
}, async ({ path: relPath, content, overwrite }) => {
  const target = await safeFile(relPath, { createParent: true });
  if (!overwrite && fs.existsSync(target)) throw new Error('文件已存在；确需覆盖时显式设置 overwrite=true。');
  await fsp.writeFile(target, content, { encoding: 'utf8', flag: overwrite ? 'w' : 'wx' });
  return text({ ok: true, path: path.relative(root, target).split(path.sep).join('/'), bytes: Buffer.byteLength(content) });
});

server.registerTool('container_make_folder', {
  description: '在容器内创建文件夹；目录不存在时可安全创建。',
  inputSchema: { parent: z.string().default(''), name: z.string().min(1).max(80) },
}, async ({ parent, name }) => text(await container.makeFolder(getUserDataPath, parent, name)));

server.registerTool('container_organize', {
  description: '按文档、图片、视频、音频、代码、数据、压缩包和其他整理容器当前目录。',
  inputSchema: { path: z.string().default('') },
}, async ({ path: relPath }) => text(await container.organize(getUserDataPath, relPath)));

server.registerTool('research_download_papers', {
  description: '论文下载任务的默认且唯一推荐入口。根据标题检索合法开放 PDF，直接保存到 Agent 工具箱“科研→文献”库；不要用 shell、write、curl 或 Python 把论文下载到 DSH 工作区。逐篇返回结果；不绕过付费墙。',
  inputSchema: { titles: z.array(z.string().min(2).max(500)).min(1).max(30) },
}, async ({ titles }) => {
  const results = [];
  for (const title of titles) {
    try { results.push({ title, ...(await litFetch.fetchPaperByTitle(literatureDir, title)) }); }
    catch (error) { results.push({ title, ok: false, error: error.message }); }
  }
  return text({ ok: results.some((item) => item.ok), library: literatureDir, results });
});

server.connect(new StdioServerTransport()).catch((error) => {
  process.stderr.write(`[agent-toolbox-mcp] ${error.stack || error.message}\n`);
  process.exitCode = 1;
});
