'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto'), { spawnSync, execFileSync } = require('child_process');
function build() {
  if (process.platform !== 'win32') return;
  const repo = path.resolve(__dirname, '..'), root = path.join(repo, 'src/main/beauty-explorer-native');
  const source = ['engine.cpp', 'vendor/minihook/buffer.cpp', 'vendor/minihook/hook.cpp', 'vendor/minihook/trampoline.cpp', 'vendor/minihook/hde/hde64.cpp'];
  const inventory = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(x => x.isDirectory() ? inventory(path.join(directory, x.name)) : /\.(cpp|h|txt|def)$/.test(x.name) ? [path.join(directory, x.name)] : []);
  const inputs = [...inventory(root), __filename].sort(); const hash = crypto.createHash('sha256');
  for (const file of inputs) { hash.update(path.relative(repo, file)); hash.update(fs.readFileSync(file)); }
  const sourceHash = hash.digest('hex'), file = path.join(root, 'ToolboxBeautyExplorer.dll'), manifest = path.join(root, 'build.json');
  const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
  if (fs.existsSync(file) && fs.existsSync(manifest)) { const value = JSON.parse(fs.readFileSync(manifest)); if (value.sourceHash === sourceHash && value.sha256 === digest(fs.readFileSync(file))) return value; }
  const candidates = [process.env.BEAUTY_CXX, 'g++.exe', 'C:/ProgramData/mingw64/mingw64/bin/g++.exe'].filter(Boolean);
  let result, compiler;
  const vswhere = path.join(process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)', 'Microsoft Visual Studio/Installer/vswhere.exe');
  const vs = fs.existsSync(vswhere) ? spawnSync(vswhere, ['-latest', '-products', '*', '-property', 'installationPath'], { encoding: 'utf8', windowsHide: true }).stdout?.trim() : '';
  const vars = vs && path.join(vs, 'VC/Auxiliary/Build/vcvars64.bat');
  if (!process.env.BEAUTY_CXX && vars && fs.existsSync(vars) && !/["\r\n]/.test(vars)) {
    const output = execFileSync('cmd.exe', ['/d', '/s', '/c', `""${vars}" >nul && set"`], { windowsVerbatimArguments: true, windowsHide: true, encoding: 'utf8' });
    const env = { ...process.env }; for (const line of output.split(/\r?\n/)) { const at = line.indexOf('='); if (at > 0) env[line.slice(0, at)] = line.slice(at + 1); }
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'toolbox-beauty-build-'));
    try {
      compiler = 'msvc';
      result = spawnSync(path.join(env.VCToolsInstallDir, 'bin/Hostx64/x64/cl.exe'), ['/nologo', '/LD', '/MT', '/EHsc', '/std:c++17', '/O2', '/Fo' + temporary + '\\', ...source.map(p => path.join(root, p)), '/link', '/OUT:' + file, '/IMPLIB:' + path.join(temporary, 'engine.lib'), '/DEF:' + path.join(root, 'engine.def'), '/INCREMENTAL:NO', '/Brepro', 'gdiplus.lib', 'msimg32.lib', 'ole32.lib', 'uuid.lib', 'gdi32.lib', 'user32.lib', 'shell32.lib'], { cwd: temporary, env, windowsHide: true, encoding: 'utf8', timeout: 120_000 });
    } finally {
      // This freshly created flat compiler directory contains only our known build outputs.
      for (const name of fs.readdirSync(temporary)) { const target = path.join(temporary, name); if (!fs.lstatSync(target).isFile()) throw new Error('Unexpected native build output'); fs.unlinkSync(target); }
      fs.rmdirSync(temporary);
    }
  } else {
    compiler = candidates.find(name => spawnSync(name, ['--version'], { windowsHide: true, stdio: 'ignore' }).status === 0);
    if (!compiler) throw new Error('Windows native beauty build requires MSVC x64 or MinGW-w64 g++ (BEAUTY_CXX).');
    result = spawnSync(compiler, ['-shared', '-static', '-O2', '-std=c++17', '-Wl,--no-insert-timestamp', '-o', file, ...source.map(p => path.join(root, p)), path.join(root, 'engine.def'), '-lgdiplus', '-lmsimg32', '-lole32', '-luuid', '-lgdi32', '-luser32', '-lshell32'], { cwd: repo, windowsHide: true, encoding: 'utf8', timeout: 120_000 });
  }
  if (result.status !== 0) throw new Error('Native beauty build failed: ' + (result.stderr || result.error || result.status));
  const value = { version: 1, architecture: 'x64', compiler, sourceHash, sha256: digest(fs.readFileSync(file)) };
  fs.writeFileSync(manifest, JSON.stringify(value, null, 2) + '\n'); return value;
}
module.exports = build;
if (require.main === module) console.log(JSON.stringify(build()));
