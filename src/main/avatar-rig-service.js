'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');

function pythonCandidates(cwd) {
  return [path.join(cwd, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')];
}

async function runPipeline(script, args, cwd, timeoutMs = 900000, onOutput = () => {}) {
  let lastError;
  for (const command of pythonCandidates(cwd)) {
    try {
      const result = await new Promise((resolve, reject) => {
        const child = spawn(command, ['-u', script, ...args], { cwd, windowsHide: true, env: {...process.env, PYTHONUTF8:'1'}, stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => {
          if(process.platform==='win32' && child.pid)execFile('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true},()=>{});
          else child.kill();
          reject(new Error('重建超过 15 分钟，已停止。'));
        }, timeoutMs);
        child.stdout.on('data', (data) => { stdout = (stdout + data).slice(-10000); onOutput(String(data)); });
        child.stderr.on('data', (data) => { stderr = (stderr + data).slice(-10000); });
        child.on('error', (error) => { clearTimeout(timer); reject(error); });
        child.on('close', (code) => {
          clearTimeout(timer);
          if (code === 0) resolve({ stdout, stderr });
          else reject(new Error((stderr || stdout || `Python 退出码 ${code}`).trim().slice(-4000)));
        });
      });
      return result;
    } catch (error) { lastError = error; }
  }
  throw lastError || new Error('没有找到可用的 Python。');
}

function safeName(value) {
  return String(value || 'avatar').replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 60) || 'avatar';
}

function registerAvatarRigIpc(ipcMain, { getUserDataPath, shell }) {
  let running = false;
  let progress = '等待选择图片';
  let viewer;
  const projectRoot = () => path.join(getUserDataPath(), 'container', 'avatar-rig-studio');
  ipcMain.handle('avatarRig:status', async () => ({running, progress,
    ready: Boolean(await fs.stat(path.join(projectRoot(), 'models/TripoSR/model.ckpt')).catch(()=>null))}));
  ipcMain.handle('avatarRig:sample', async () => {
    try {
      const bytes = await fs.readFile(path.join(projectRoot(), 'miku-official.png'));
      return {name:'miku-official.png', mime:'image/png', base64:bytes.toString('base64')};
    } catch {return {error:'本机还没有示例图片。可选择自己的图，或在项目目录运行 setup_models.py --sample 下载官方参考图。'};}
  });
  ipcMain.handle('avatarRig:preview', async (_event, jobId = '') => {
    try {
      if (jobId && !/^[a-zA-Z0-9_-]+$/.test(jobId)) throw new Error('任务编号无效');
      const url = 'http://127.0.0.1:18765';
      const healthy = async () => {
        try { const r = await fetch(url+'/health', {signal:AbortSignal.timeout(1000)});return (await r.json()).service === 'avatar-rig-studio'; }
        catch { return false; }
      };
      if (!(await healthy())) {
        viewer = spawn(pythonCandidates(projectRoot())[0], ['app.py','--no-browser','--port','18765'], {cwd:projectRoot(),windowsHide:true,stdio:'ignore'});
        let failure; viewer.once('error', e=>{failure=e;});
        for (let i=0;i<30;i++) {if(failure)throw failure; if(await healthy())break; await new Promise(r=>setTimeout(r,200));}
        if(!(await healthy()))throw new Error('模型查看器未能启动，18765 端口可能被占用。');
      }
      const target=jobId?`${url}/viewer.html?job=${encodeURIComponent(jobId)}`:url+'/';
      await shell.openExternal(target);
      return {ok:true,url:target};
    } catch(error) {return {ok:false,error:error.message};}
  });
  ipcMain.handle('avatarRig:project', () => {
    const project = path.join(getUserDataPath(), 'container', 'avatar-rig-studio');
    return { ok: true, path: project };
  });

  ipcMain.handle('avatarRig:open', async () => {
    const project = path.join(getUserDataPath(), 'container', 'avatar-rig-studio');
    await fs.mkdir(project, { recursive: true });
    const error = await shell.openPath(project);
    return error ? { ok: false, error } : { ok: true, path: project };
  });

  ipcMain.handle('avatarRig:generate', async (_event, payload = {}) => {
    if(running)return {ok:false,error:'已有重建任务运行中，请等待完成。'};
    running=true; progress='正在准备图片';
    try {
      const root = path.join(getUserDataPath(), 'container', 'avatar-rig-studio');
      const script = path.join(root, 'pipeline.py');
      if (!(await fs.stat(script).catch(() => null))) throw new Error('容器里的 avatar-rig-studio 尚未初始化，请重新启动工具箱。');
      if (!(await fs.stat(pythonCandidates(root)[0]).catch(() => null))) throw new Error('首次使用请在项目目录运行 setup.ps1 安装独立 Python 环境和模型。');
      const input = String(payload.base64 || '').replace(/^data:[^;]+;base64,/, '');
      if (!input) throw new Error('没有收到图片内容。');
      if(input.length>56*1024*1024)throw new Error('图片超过 40MB');
      const jobs = path.join(root, 'jobs');
      const jobId = `${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 7)}`;
      const job = path.join(jobs, jobId);
      await fs.mkdir(job, { recursive: true });
      await fs.writeFile(path.join(job, `input-${safeName(payload.fileName)}.png`), Buffer.from(input, 'base64'));
      const inputPath = path.join(job, `input-${safeName(payload.fileName)}.png`);
      await runPipeline('pipeline.py', [
        '--input', inputPath,
        '--output', job,
      ], root, 900000, chunk=>{if(chunk.includes('Loading'))progress='加载重建模型';if(chunk.includes('Reconstructing'))progress='推断三维形状';if(chunk.includes('Extracting'))progress='提取立体网格与颜色';});
      const manifest = JSON.parse(await fs.readFile(path.join(job, 'project.json'), 'utf8'));
      const model = await fs.readFile(path.join(job,'avatar.vrm'));
      if(model.length < 1000 || model.toString('ascii',0,4)!=='glTF')throw new Error('没有得到有效的 VRM 模型。');
      progress='完成：VRM / GLB 已保存';
      return { ok: true, jobId, project: root, job, manifest };
    } catch (error) { progress='失败：'+error.message; return { ok: false, error: error.message }; }
    finally {running=false;}
  });
}

module.exports = { registerAvatarRigIpc };
