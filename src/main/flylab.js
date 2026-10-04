'use strict';

/**
 * 果蝇观察箱：在 toolbox 里跑 NeuroMechFly v2（flygym + MuJoCo）仿真。
 *
 * Python 那套太重、又跨平台，所以不进 asar：独立 venv 放 ~/.agent-toolbox/flylab，
 * 首次点「开始仿真」才建环境、装 flygym（几百 MB），之后直接跑。
 * 仿真在子进程里出 mp4，进度按行流回渲染层；跑完把 mp4 读成 data URL 播（CSP 允许 media-src data:）。
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(os.homedir(), '.agent-toolbox', 'flylab');
const SIM_DIR = path.join(ROOT, 'sim');
const OUT_DIR = path.join(ROOT, 'output');
const CONFIG = path.join(ROOT, 'config.json');
const IS_WIN = process.platform === 'win32';
const VENV_PY = path.join(ROOT, '.venv', IS_WIN ? path.join('Scripts', 'python.exe') : path.join('bin', 'python'));

const CAMERAS = [
  { id: 'Animat/camera_top', label: '俯视（看它溜达）' },
  { id: 'Animat/camera_left', label: '侧面（看腿的动作）' },
  { id: 'Animat/camera_front', label: '正面（看脸）' },
];

// 和一键包里验证过的脚本一致：读 config.json，CPG 步态走 + 拐弯，跟拍存 mp4。
const OBSERVE_PY = String.raw`import os, json, time, datetime
from pathlib import Path
import numpy as np
os.environ.setdefault("MUJOCO_GL", "glfw")
ROOT = Path(__file__).resolve().parent.parent

def load_config():
    cfg = {"sim_steps": 3000, "timestep": 1e-4, "camera": "Animat/camera_top",
           "window_size": [900, 700], "fps": 30, "play_speed": 0.1,
           "seed": 0, "output_dir": "output", "wander": True}
    try:
        cfg.update({k: v for k, v in json.loads((ROOT / "config.json").read_text("utf-8")).items() if not k.startswith("_")})
    except Exception as e:
        print(f"[配置] 用默认值：{e}", flush=True)
    return cfg

def main():
    cfg = load_config()
    print("[1/4] 载入 flygym / MuJoCo …", flush=True)
    from flygym import Fly, Camera, preprogrammed
    from flygym.examples.locomotion import HybridTurningController
    n = int(cfg["sim_steps"])
    print(f"[2/4] 组装果蝇 + 空白世界（{n} 步）…", flush=True)
    fly = Fly(enable_adhesion=True, contact_sensor_placements=preprogrammed.default_leg_sensor_placements)
    cam = Camera(fly=fly, camera_id=cfg["camera"], window_size=tuple(cfg["window_size"]),
                 play_speed=float(cfg["play_speed"]), fps=int(cfg["fps"]))
    sim = HybridTurningController(fly=fly, cameras=[cam], timestep=float(cfg["timestep"]))
    sim.reset(seed=int(cfg["seed"]))
    print("[3/4] 开始模拟仿真 …", flush=True)
    t0 = time.time(); frames = 0
    for i in range(n):
        if cfg.get("wander", True):
            drive = np.array([1.0, 1.0]) if i < n*0.4 else (np.array([1.2, 0.4]) if i < n*0.7 else np.array([0.4, 1.2]))
        else:
            drive = np.array([1.0, 1.0])
        sim.step(drive)
        r = sim.render()
        if r and r[0] is not None: frames += 1
        if i % max(1, n // 25) == 0:
            print(f"PROGRESS {i*100//n} {frames}", flush=True)
    out_dir = ROOT / cfg["output_dir"]; out_dir.mkdir(exist_ok=True)
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    out = out_dir / f"fly-{stamp}.mp4"
    print(f"[4/4] 写视频 …", flush=True)
    cam.save_video(str(out))
    print(f"DONE {out}", flush=True)
    print(f"渲了 {frames} 帧，用时 {time.time()-t0:.0f}s", flush=True)

if __name__ == "__main__":
    main()
`;

function macSystemPython() {
  // 系统自带 /usr/bin/python3 是通用二进制、Apple 芯片原生 arm64，且有现成科学计算 wheel；
  // 别用 Homebrew/conda 的（架构/版本常和预编译包对不上，会去源码编译 llvmlite 然后失败）。
  return fs.existsSync('/usr/bin/python3') ? '/usr/bin/python3' : '';
}

function resolveUv() {
  for (const p of [
    path.join(os.homedir(), '.local', 'bin', IS_WIN ? 'uv.exe' : 'uv'),
    path.join(os.homedir(), '.cargo', 'bin', IS_WIN ? 'uv.exe' : 'uv'),
    '/opt/homebrew/bin/uv', '/usr/local/bin/uv',
  ]) if (fs.existsSync(p)) return p;
  return '';
}

class FlyLabService {
  constructor({ getWindow } = {}) {
    this.getWindow = getWindow || (() => null);
    this.child = null;
    this.phase = 'idle';   // idle | installing | running
  }

  _emit(payload) {
    try { this.getWindow()?.webContents.send('flylab:progress', payload); } catch { /* 窗口没了 */ }
  }

  cameras() { return CAMERAS; }

  status() {
    return {
      ok: true,
      ready: fs.existsSync(VENV_PY),
      busy: this.phase !== 'idle',
      phase: this.phase,
      hasBootstrap: IS_WIN ? Boolean(resolveUv()) : Boolean(macSystemPython()),
      platform: process.platform,
      root: ROOT,
    };
  }

  list() {
    try {
      const files = fs.readdirSync(OUT_DIR).filter((f) => f.endsWith('.mp4'))
        .map((f) => { const s = fs.statSync(path.join(OUT_DIR, f)); return { name: f, path: path.join(OUT_DIR, f), at: s.mtimeMs, size: s.size }; })
        .sort((a, b) => b.at - a.at);
      return { ok: true, items: files };
    } catch { return { ok: true, items: [] }; }
  }

  /** 把 mp4 读成 data URL 给 <video> 播（渲染层沙箱里 file:// 用不了，CSP 放了 media-src data:） */
  readVideo(p) {
    try {
      const abs = path.resolve(String(p || ''));
      if (!abs.startsWith(OUT_DIR) || !fs.existsSync(abs)) return { ok: false, error: '视频不在了' };
      if (fs.statSync(abs).size > 60 * 1024 * 1024) return { ok: false, error: '视频太大，直接在文件夹里打开吧' };
      return { ok: true, dataUrl: `data:video/mp4;base64,${fs.readFileSync(abs).toString('base64')}` };
    } catch (e) { return { ok: false, error: e.message }; }
  }

  openFolder() { try { require('electron').shell.showItemInFolder(OUT_DIR); } catch { /* ignore */ } return { ok: true }; }

  remove(p) {
    try {
      const abs = path.resolve(String(p || ''));
      if (abs.startsWith(OUT_DIR) && fs.existsSync(abs)) fs.unlinkSync(abs);
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  }

  cancel() {
    if (!this.child) return { ok: true };
    try { if (IS_WIN) this.child.kill(); else process.kill(-this.child.pid, 'SIGKILL'); } catch { try { this.child.kill(); } catch { /* */ } }
    return { ok: true };
  }

  _writeAssets(cfg) {
    fs.mkdirSync(SIM_DIR, { recursive: true });
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(path.join(SIM_DIR, 'observe.py'), OBSERVE_PY, 'utf8');
    const merged = {
      sim_steps: Math.max(200, Math.min(30000, Number(cfg.sim_steps) || 3000)),
      timestep: 1e-4,
      camera: CAMERAS.some((c) => c.id === cfg.camera) ? cfg.camera : 'Animat/camera_top',
      window_size: [900, 700], fps: 30,
      play_speed: Math.max(0.02, Math.min(1, Number(cfg.play_speed) || 0.1)),
      seed: Number.isInteger(cfg.seed) ? cfg.seed : 0,
      output_dir: 'output', wander: cfg.wander !== false,
    };
    fs.writeFileSync(CONFIG, JSON.stringify(merged, null, 2), 'utf8');
  }

  _spawn(command, args, { onLine } = {}) {
    return new Promise((resolve) => {
      const child = spawn(command, args, {
        cwd: ROOT,
        env: { ...process.env, MUJOCO_GL: 'glfw', PYTHONUNBUFFERED: '1', PYTHONDONTWRITEBYTECODE: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: !IS_WIN,
      });
      this.child = child;
      let tail = '';
      const feed = (chunk) => {
        tail += chunk.toString();
        const lines = tail.split(/\r?\n/); tail = lines.pop();
        for (const line of lines) if (line.trim()) onLine?.(line.trim());
      };
      child.stdout.on('data', feed);
      child.stderr.on('data', feed);
      child.on('error', (err) => { this.child = null; resolve({ ok: false, error: err.message }); });
      child.on('close', (code) => { this.child = null; if (tail.trim()) onLine?.(tail.trim()); resolve({ ok: code === 0, code }); });
    });
  }

  async _ensureEnv() {
    if (fs.existsSync(VENV_PY)) return { ok: true };
    fs.mkdirSync(ROOT, { recursive: true });
    this.phase = 'installing';
    this._emit({ phase: 'installing', pct: 0, line: '第一次运行：正在建环境、下载 flygym + MuJoCo（几百 MB，要联网）…' });
    if (IS_WIN) {
      const uv = resolveUv();
      if (!uv) return { ok: false, error: '没找到 uv。请先装 uv（astral.sh/uv）或 Python 后重试。' };
      const v = await this._spawn(uv, ['venv', '--python', '3.11', path.join(ROOT, '.venv')], { onLine: (l) => this._emit({ phase: 'installing', line: l }) });
      if (!v.ok) return { ok: false, error: '建 venv 失败（uv）。' };
      const i = await this._spawn(uv, ['pip', 'install', '--python', VENV_PY, 'flygym', 'networkx'], { onLine: (l) => this._emit({ phase: 'installing', line: l }) });
      if (!i.ok) return { ok: false, error: '装 flygym 失败，看日志。' };
    } else {
      const py = macSystemPython();
      if (!py) return { ok: false, error: '没找到 /usr/bin/python3。终端执行 xcode-select --install 后重试。' };
      const v = await this._spawn(py, ['-m', 'venv', path.join(ROOT, '.venv')], { onLine: (l) => this._emit({ phase: 'installing', line: l }) });
      if (!v.ok || !fs.existsSync(VENV_PY)) return { ok: false, error: '建 venv 失败。' };
      await this._spawn(VENV_PY, ['-m', 'pip', 'install', '--upgrade', 'pip', '-q'], {});
      const i = await this._spawn(VENV_PY, ['-m', 'pip', 'install', 'flygym', 'networkx'], { onLine: (l) => this._emit({ phase: 'installing', line: l }) });
      if (!i.ok) return { ok: false, error: '装 flygym 失败，看日志。' };
    }
    return { ok: true };
  }

  /** 主入口：确保环境 → 跑仿真 → 返回 mp4 的 data URL */
  async run(cfg = {}) {
    if (this.phase !== 'idle') return { ok: false, error: '已经在跑了，等这一轮结束。' };
    try {
      this._writeAssets(cfg);
      const env = await this._ensureEnv();
      if (!env.ok) { this.phase = 'idle'; this._emit({ phase: 'error', line: env.error }); return env; }

      this.phase = 'running';
      this._emit({ phase: 'running', pct: 0, line: '开始模拟仿真 …' });
      let video = '';
      const r = await this._spawn(VENV_PY, [path.join(SIM_DIR, 'observe.py')], {
        onLine: (line) => {
          const mp = line.match(/^PROGRESS (\d+) (\d+)/);
          if (mp) { this._emit({ phase: 'running', pct: Number(mp[1]), frames: Number(mp[2]) }); return; }
          const md = line.match(/^DONE (.+)$/);
          if (md) { video = md[1].trim(); return; }
          this._emit({ phase: 'running', line });
        },
      });
      this.phase = 'idle';
      if (!r.ok) { this._emit({ phase: 'error', line: '仿真失败，看上面的日志。' }); return { ok: false, error: '仿真进程退出异常。' }; }
      const read = video ? this.readVideo(video) : { ok: false };
      this._emit({ phase: 'done', pct: 100, video, dataUrl: read.ok ? read.dataUrl : '' });
      return { ok: true, video, dataUrl: read.ok ? read.dataUrl : '' };
    } catch (e) {
      this.phase = 'idle';
      this._emit({ phase: 'error', line: e.message });
      return { ok: false, error: e.message };
    }
  }
}

module.exports = { FlyLabService, CAMERAS, ROOT };
