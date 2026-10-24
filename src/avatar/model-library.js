'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const catalog = require('./model-catalog.json');

function createModelLibrary({ directory, fetcher = globalThis.fetch, models = catalog }) {
  const pending = new Map();
  const modelPath = (model) => path.join(directory, `${model.id}.vrm`);
  async function ready(model) {
    try { return (await fs.stat(modelPath(model))).size === model.bytes; } catch { return false; }
  }
  async function list() {
    return Promise.all(models.map(async (model) => ({ ...model, ready: await ready(model), path: modelPath(model) })));
  }
  async function download(model) {
    const target = modelPath(model);
    const valid = (buffer) => buffer.length === model.bytes && buffer.toString('ascii', 0, 4) === 'glTF'
      && createHash('sha256').update(buffer).digest('hex') === model.sha256;
    if (await ready(model)) {
      if (valid(await fs.readFile(target))) return target;
    }
    const response = await fetcher(model.url, {
      headers: { Accept: 'application/vnd.github.raw', 'User-Agent': 'Agent-Toolbox' },
      signal: AbortSignal.timeout(180000),
    });
    if (!response.ok) throw new Error(`皮套下载失败（HTTP ${response.status}），请稍后重试`);
    const content = Buffer.from(await response.arrayBuffer());
    if (!valid(content)) throw new Error('皮套文件校验失败，请重新下载');
    await fs.mkdir(directory, { recursive: true });
    const temporary = path.join(directory, `.${model.id}-${randomUUID()}.tmp`);
    try { await fs.writeFile(temporary, content); await fs.rename(temporary, target); }
    finally { await fs.rm(temporary, { force: true }); }
    return target;
  }
  function ensure(id) {
    const model = models.find((item) => item.id === id);
    if (!model) return Promise.reject(new Error('未知的皮套'));
    if (!pending.has(id)) pending.set(id, download(model).finally(() => pending.delete(id)));
    return pending.get(id);
  }
  return { list, ensure };
}
module.exports = { createModelLibrary };
