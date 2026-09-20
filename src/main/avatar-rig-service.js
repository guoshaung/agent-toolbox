'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');
const { randomUUID } = require('node:crypto');

const VIEWS = ['front', 'left', 'back'];
const MAX_IMAGE_BYTES = 40 * 1024 * 1024;
const MODEL_MV = 'models/Hunyuan3D-2mv/hunyuan3d-dit-v2-mv/';
const pythonPath = (root, mode = 'single') => path.join(root,
  mode === 'multiview' ? '.venv-mv' : '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');

function decodeImage(file, label) {
  if (!file || typeof file.base64 !== 'string') throw new Error('缺少' + label + '图片');
  const encoded = file.base64.replace(/^data:image\/[^;]+;base64,/, '');
  if (!encoded || encoded.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
    throw new Error(label + '图片无效或超过 40MB');
  }
  const bytes = Buffer.from(encoded, 'base64');
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error(label + '图片超过 40MB');
  return bytes;
}

function validateInput(payload = {}) {
  const mode = payload.mode || 'single';
  if (!['single', 'multiview'].includes(mode)) throw new Error('未知的建模模式');
  const images = mode === 'single'
    ? { single: decodeImage(payload, '人物') }
    : Object.fromEntries(VIEWS.map((view, i) => [view, decodeImage(payload.views?.[view], ['正面', '左侧', '背面'][i])]));
  return { mode, images, name: String(payload.name || '图片重建角色').trim().slice(0, 100) || '图片重建角色' };
}

async function exists(file, minimum = 1) {
  const stat = await fs.stat(file).catch(() => null);
  return Boolean(stat?.isFile() && stat.size >= minimum);
}

async function readiness(root) {
  const [single, multiview] = await Promise.all([
    Promise.all([exists(pythonPath(root)), exists(path.join(root, 'pipeline.py')),
      exists(path.join(root, 'models/TripoSR/model.ckpt'), 1000000)]),
    Promise.all([exists(pythonPath(root, 'multiview')), exists(path.join(root, 'pipeline_multiview.py')),
      exists(path.join(root, 'vendor/Hunyuan3D-2/hy3dgen/shapegen/pipelines.py')),
      exists(path.join(root, MODEL_MV, 'config.yaml')),
      exists(path.join(root, MODEL_MV, 'model.fp16.safetensors'), 4928151562)]),
  ]);
  return { single: single.every(Boolean), multiview: multiview.every(Boolean) };
}

function stopChild(child) {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
  } else child.kill();
}

function runProcess(command, args, { cwd, timeout = 900000, onOutput = () => {}, onChild = () => {} }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, windowsHide: true,
      env: { ...process.env, PYTHONUTF8: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    onChild(child);
    let output = '';
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; stopChild(child); }, timeout);
    const receive = (chunk) => { output = (output + chunk).slice(-12000); onOutput(String(chunk)); };
    child.stdout.on('data', receive);
    child.stderr.on('data', receive);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (timedOut) reject(new Error('执行超时，进程已停止。'));
      else if (code === 0) resolve(output);
      else reject(new Error(output.trim().slice(-4000) || '进程退出码 ' + code));
    });
  });
}

// Explicit user action, not a silent overwrite of editable container scripts.
// Back up changed project files, skip symlinks, never touch jobs/models/envs.
async function refreshSeed(source, target) {
  const backupName = new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 6);
  const backupRoot = path.join(target, '_backups', backupName);
  let copied = 0, backedUp = 0;
  const skip = new Set(['.git', '__pycache__']);
  const rootOnlySkip = new Set(['.venv', '.venv-mv', 'jobs', 'models', '_backups', 'multiview-ready.json']);
  const backupDirectory = await fs.lstat(path.join(target, '_backups')).catch(() => null);
  if (backupDirectory?.isSymbolicLink()) throw new Error('备份目录不能是符号链接');
  async function walk(relative = '') {
    const dest = path.join(target, relative);
    const present = await fs.lstat(dest).catch(() => null);
    if (present?.isSymbolicLink()) throw new Error('项目脚本目录不能是符号链接：' + relative);
    await fs.mkdir(dest, { recursive: true });
    for (const entry of await fs.readdir(path.join(source, relative), { withFileTypes: true })) {
      if (skip.has(entry.name) || (!relative && rootOnlySkip.has(entry.name)) || entry.name.endsWith('.pyc') || entry.isSymbolicLink()) continue;
      const rel = path.join(relative, entry.name), destination = path.join(target, rel);
      if (entry.isDirectory()) { await walk(rel); continue; }
      if (!entry.isFile()) continue;
      const previous = await fs.lstat(destination).catch(() => null);
      if (previous && (!previous.isFile() || previous.isSymbolicLink())) throw new Error('不能覆盖非普通文件：' + rel);
      const content = await fs.readFile(path.join(source, rel));
      if (previous) {
        if (content.equals(await fs.readFile(destination))) continue;
        const saved = path.join(backupRoot, rel);
        await fs.mkdir(path.dirname(saved), { recursive: true });
        await fs.copyFile(destination, saved);
        backedUp++;
      }
      await fs.writeFile(destination, content);
      copied++;
    }
  }
  await walk();
  return { ok: true, copied, backedUp, backup: backedUp ? backupRoot : null };
}

function registerAvatarRigIpc(ipcMain, { getUserDataPath, shell, getSeedPath, app, run = runProcess, checkReadiness = readiness }) {
  let running = false, progress = '等待选择图片', activeChild, viewer;
  const root = () => path.join(getUserDataPath(), 'container', 'avatar-rig-studio');
  const output = chunk => {
    const stages = [
      ['prepare_multiview_inputs', '检查并预处理三视图'],
      ['Loading', '加载模型（首次可能需要较长时间）'],
      ['Reconstructing', '单图形状推理'],
      ['Joint multi-view', '三视图联合形状推理'],
      ['Diffusion Sampling', '多视图扩散采样'],
      ['Volume Decoding', '解码三维表面'],
      ['prepare_multiview_mesh', '生成三视图贴图'],
      ['Extracting', '提取立体网格'],
      ['export_vrm', '绑定初始骨骼并导出'],
    ];
    for (const [match, text] of stages) if (chunk.includes(match)) progress = text;
  };
  async function exclusive(operation) {
    if (running) return { ok: false, error: '已有建模或安装任务运行中，请等待完成。' };
    running = true;
    try { return await operation(); }
    catch (error) { progress = '失败：' + error.message; return { ok: false, error: error.message }; }
    finally { running = false; activeChild = undefined; }
  }

  ipcMain.handle('avatarRig:status', async () => {
    const engines = await checkReadiness(root());
    return { running, progress, ready: engines.single, engines };
  });
  ipcMain.handle('avatarRig:project', () => ({ ok: true, path: root() }));
  ipcMain.handle('avatarRig:open', async () => {
    await fs.mkdir(root(), { recursive: true });
    const error = await shell.openPath(root());
    return error ? { ok: false, error } : { ok: true, path: root() };
  });
  ipcMain.handle('avatarRig:refresh', () => exclusive(async () => {
    if (!getSeedPath) throw new Error('找不到项目模板');
    const result = await refreshSeed(getSeedPath(), root());
    stopChild(viewer); viewer = undefined;
    progress = '项目脚本已更新，修改过的旧文件已备份';
    return result;
  }));
  ipcMain.handle('avatarRig:setup', (_event, mode = 'single') => exclusive(async () => {
    if (!['single', 'multiview'].includes(mode)) throw new Error('未知的建模模式');
    if (process.platform !== 'win32') throw new Error('一键安装目前支持 Windows；其他系统请按项目 README 安装。');
    if (getSeedPath) await refreshSeed(getSeedPath(), root());
    const script = mode === 'multiview' ? 'setup_multiview.ps1' : 'setup.ps1';
    progress = '安装独立环境及模型，请等待下载完成';
    await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root(), script)],
      { cwd: root(), timeout: 3600000, onChild: child => { activeChild = child; } });
    if (!(await checkReadiness(root()))[mode]) throw new Error('安装命令已结束，但运行文件不完整，请检查项目目录。');
    progress = '环境就绪';
    return { ok: true };
  }));
  ipcMain.handle('avatarRig:sample', async () => {
    try {
      const bytes = await fs.readFile(path.join(root(), 'miku-official.png'));
      return { name: 'miku-official.png', mime: 'image/png', base64: bytes.toString('base64') };
    } catch { return { error: '本机没有示例图片，请选择自己的图，或按 README 下载官方参考图。' }; }
  });
  ipcMain.handle('avatarRig:preview', async (_event, jobId = '') => {
    try {
      if (jobId && !/^[a-zA-Z0-9_-]+$/.test(jobId)) throw new Error('任务编号无效');
      if (jobId && !(await exists(path.join(root(), 'jobs', jobId, 'avatar.vrm')))) throw new Error('此任务还没有模型');
      const url = 'http://127.0.0.1:18765';
      const healthy = async () => {
        try {
          const response = await fetch(url + '/health', { signal: AbortSignal.timeout(1000) });
          return (await response.json()).service === 'avatar-rig-studio';
        } catch { return false; }
      };
      if (!(await healthy())) {
        const python = await exists(pythonPath(root())) ? pythonPath(root()) : pythonPath(root(), 'multiview');
        viewer = spawn(python, ['app.py', '--no-browser', '--port', '18765'],
          { cwd: root(), windowsHide: true, stdio: 'ignore' });
        let failure;
        viewer.once('error', error => { failure = error; });
        for (let i = 0; i < 30; i++) {
          if (failure) throw failure;
          if (await healthy()) break;
          if (viewer.exitCode !== null) break;
          await new Promise(resolve => setTimeout(resolve, 200));
        }
        if (!(await healthy())) { stopChild(viewer); throw new Error('查看器未能启动，18765 端口可能被占用。'); }
      }
      const target = jobId ? url + '/viewer.html?job=' + encodeURIComponent(jobId) : url + '/';
      await shell.openExternal(target);
      return { ok: true, url: target };
    } catch (error) { return { ok: false, error: error.message }; }
  });

  ipcMain.handle('avatarRig:generate', (_event, payload = {}) => exclusive(async () => {
    // Fail before allocating a job if any view or environment is missing.
    const { mode, images, name } = validateInput(payload);
    if (!(await checkReadiness(root()))[mode]) throw new Error('所选模式尚未安装，请点击“安装所选环境”。');
    const jobId = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14) + '-' + randomUUID().slice(0, 8);
    const job = path.join(root(), 'jobs', jobId);
    await fs.mkdir(job, { recursive: true });
    await fs.writeFile(path.join(job, 'reference.json'), JSON.stringify({ name }, null, 2));
    for (const [view, bytes] of Object.entries(images)) await fs.writeFile(path.join(job, 'input-' + view + '.png'), bytes);
    const script = mode === 'multiview' ? 'pipeline_multiview.py' : 'pipeline.py';
    const args = mode === 'multiview' ? ['--job', job] : ['--input', path.join(job, 'input-single.png'), '--output', job];
    progress = '启动' + (mode === 'multiview' ? '三视图' : '单图') + '重建';
    try {
      await run(pythonPath(root(), mode), ['-u', script, ...args],
        { cwd: root(), timeout: 1800000, onOutput: output, onChild: child => { activeChild = child; } });
      const manifest = JSON.parse(await fs.readFile(path.join(job, 'project.json'), 'utf8'));
      const model = await fs.readFile(path.join(job, 'avatar.vrm'));
      if (model.length < 1000 || model.toString('ascii', 0, 4) !== 'glTF' ||
          model.readUInt32LE(8) !== model.length) throw new Error('没有得到有效的 VRM 模型。');
      progress = '完成：VRM / GLB 已保存';
      return { ok: true, jobId, project: root(), job, manifest };
    } catch (error) {
      await fs.writeFile(path.join(job, 'failure.json'), JSON.stringify({ ok: false, error: error.message }, null, 2));
      throw error;
    }
  }));
  const dispose = () => { stopChild(activeChild); stopChild(viewer); };
  app?.once('before-quit', dispose);
  return { dispose };
}

module.exports = { registerAvatarRigIpc, validateInput, readiness, refreshSeed, runProcess };
