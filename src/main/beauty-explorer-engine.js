'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const os = require('node:os');
const { execFile } = require('node:child_process');
const execAsync = require('node:util').promisify(execFile);
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function powershellEnvironment() {
  const env = { ...process.env };
  // Windows PowerShell must discover its own modules, rather than inherit pwsh 7's path.
  for (const key of Object.keys(env)) if (key.toLowerCase() === 'psmodulepath') delete env[key];
  return env;
}
class ExplorerBeautyEngine {
  constructor({ root, platform = process.platform, exec = execAsync, bundled = path.join(__dirname, 'beauty-explorer-native') }) {
    this.root = root; this.platform = platform; this.exec = exec; this.bundled = bundled;
    this.receiptPath = path.join(root, 'installation.json');
  }
  binary() {
    const bytes = fs.readFileSync(path.join(this.bundled, 'ToolboxBeautyExplorer.dll'));
    const expected = JSON.parse(fs.readFileSync(path.join(this.bundled, 'build.json'), 'utf8'));
    if (bytes.length > 8 * 1024 * 1024 || bytes.toString('ascii', 0, 2) !== 'MZ' || digest(bytes) !== expected.sha256) throw new Error('原生组件构建校验失败，请重新构建或安装 Toolbox');
    return { bytes, hash: expected.sha256 };
  }
  location() {
    // Keep controlling a previously installed renderer after an app update.
    // It may still be loaded in Explorer; never silently switch its live endpoint.
    if (fs.existsSync(this.receiptPath)) {
      const record = JSON.parse(fs.readFileSync(this.receiptPath, 'utf8'));
      const directory = typeof record.dll === 'string' ? path.dirname(record.dll) : '';
      if (record.version === 1 && record.phase === 'installed' && path.dirname(directory) === this.root && /^v1-[a-f0-9]{16}$/.test(path.basename(directory)) && path.basename(record.dll) === 'ToolboxBeautyExplorer.dll') return directory;
    }
    const { hash } = this.binary();
    return path.join(this.root, `v1-${hash.slice(0, 16)}`);
  }
  dll() { return path.join(this.location(), 'ToolboxBeautyExplorer.dll'); }
  async run(operation, elevate = false) {
    if (this.platform !== 'win32') throw new Error('资源管理器原生组件仅支持 Windows x64');
    if (!['status', 'install-machine', 'remove-machine', 'register-user', 'remove-user', 'reload', 'disable', 'restart'].includes(operation)) throw new Error('无效的组件操作');
    if (elevate) {
      if (!['install-machine', 'remove-machine'].includes(operation)) throw new Error('该操作不能请求管理员权限');
      const machineScript = `$ErrorActionPreference='Stop';$p='Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Browser Helper Objects\\{70C21916-1316-4825-AF20-DEED801D7690}';$marker='AgentToolboxBeautyExplorerV1';$h=[Microsoft.Win32.Registry]::LocalMachine;$k=$h.OpenSubKey($p,$false);if($null -ne $k){try{$names=@($k.GetValueNames());if($k.SubKeyCount -ne 0 -or $names.Count -lt 1 -or $names.Count -gt 2 -or $k.GetValueKind('').ToString() -ne 'String' -or $k.GetValue('') -cne $marker -or @($names|Where-Object{$_ -ne '' -and $_ -ne 'NoInternetExplorer'}).Count -or ($names -contains 'NoInternetExplorer' -and ($k.GetValueKind('NoInternetExplorer').ToString() -ne 'DWord' -or $k.GetValue('NoInternetExplorer') -ne 1))){throw 'Component registration conflict'}}finally{$k.Dispose()}};${operation === 'install-machine' ? "$k=$h.CreateSubKey($p);try{$k.SetValue('',$marker,[Microsoft.Win32.RegistryValueKind]::String);$k.SetValue('NoInternetExplorer',1,[Microsoft.Win32.RegistryValueKind]::DWord);$k.Flush()}finally{$k.Dispose()}" : 'if($null -ne $k){$h.DeleteSubKey($p,$false)}'};exit 0`;
      const encoded = Buffer.from(machineScript, 'utf16le').toString('base64');
      // The elevated process accepts only a fixed operation and writes one fixed BHO key.
      // It never accepts paths or registry destinations from renderer input.
      const launcher = `$ErrorActionPreference='Stop';try {$p=Start-Process -FilePath (Join-Path $env:WINDIR 'System32\\WindowsPowerShell\\v1.0\\powershell.exe') -Verb RunAs -WindowStyle Hidden -ArgumentList @('-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand','${encoded}') -Wait -PassThru;if($p.ExitCode -ne 0){throw 'Windows component registration failed'};@{authorized=$true}|ConvertTo-Json -Compress}catch{throw ('Windows 授权未完成：'+$_.Exception.Message)}`;
      const { stdout } = await this.exec('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(launcher, 'utf16le').toString('base64')], { env: powershellEnvironment(), windowsHide: true, timeout: 180_000, maxBuffer: 128 * 1024 });
      return JSON.parse(stdout.replace(/^\uFEFF/, '').trim());
    }
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'toolbox-beauty-bridge-')), helper = path.join(directory, 'bridge.ps1');
    try {
      // -File keeps the long helper below Windows' command-line limit, including Unicode paths.
      const source = fs.readFileSync(path.join(__dirname, operation === 'restart' ? 'beauty-explorer-restart.ps1' : 'beauty-explorer-native.ps1'));
      fs.writeFileSync(helper, Buffer.concat([Buffer.from([239, 187, 191]), source]), { flag: 'wx' });
      const argumentsList = operation === 'restart' ? [] : ['-Operation', operation, '-DllPath', this.dll()];
      const { stdout } = await this.exec('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper, ...argumentsList], { env: powershellEnvironment(), windowsHide: true, timeout: operation === 'restart' ? 45_000 : 20_000, maxBuffer: 128 * 1024 });
      return JSON.parse(stdout.replace(/^\uFEFF/, '').trim());
    } finally { if (fs.existsSync(helper)) fs.unlinkSync(helper); fs.rmdirSync(directory); }
  }
  async status() {
    if (this.platform !== 'win32') return { supported: false, registered: false, ready: false };
    try {
      const status = await this.run('status');
      const live = (status.live || []).filter(x => x.responded && (x.result & 0xffff) === 0xb001);
      const installed = fs.existsSync(this.dll()) && digest(fs.readFileSync(this.dll())).startsWith(path.basename(this.location()).slice(3));
      return { supported: true, ...status, registered: status.machineRegistered && status.userRegistered && installed, ready: live.some(x => x.result & 0x40000),
        enabled: live.some(x => x.result & 0x10000), painted: live.some(x => (x.result & 0x30000) === 0x30000) };
    } catch (error) { return { supported: true, registered: false, ready: false, error: error.message }; }
  }
  config(enabled, image = '', cover = false) {
    const directory = this.location(); fs.mkdirSync(directory, { recursive: true });
    if (/[\r\n\0]/.test(image)) throw new Error('素材路径无效');
    const text = `[beauty]\r\nenabled=${enabled ? 1 : 0}\r\ncover=${cover ? 1 : 0}\r\nimage=${image}\r\n`;
    const file = path.join(directory, 'config.ini'), temporary = file + '.' + crypto.randomUUID() + '.tmp';
    try { fs.writeFileSync(temporary, Buffer.concat([Buffer.from([255, 254]), Buffer.from(text, 'utf16le')]), { flag: 'wx' }); fs.renameSync(temporary, file); }
    finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  }
  async install() {
    const before = await this.status();
    if (before.registered) return before;
    if (before.foreignMachine || before.foreignUser) throw new Error('发现其他安装占用组件注册，请保留原设置并先处理冲突');
    const binary = this.binary(), file = this.dll(); fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file)) { if (digest(fs.readFileSync(file)) !== binary.hash) throw new Error('原生组件文件已改变，已停止启用'); }
    else fs.writeFileSync(file, binary.bytes, { flag: 'wx' });
    fs.copyFileSync(path.join(this.bundled, 'THIRD-PARTY-NOTICES.txt'), path.join(path.dirname(file), 'THIRD-PARTY-NOTICES.txt'));
    if (!fs.existsSync(path.join(path.dirname(file), 'config.ini'))) this.config(false);
    const previous = fs.existsSync(this.receiptPath) ? JSON.parse(fs.readFileSync(this.receiptPath)) : null;
    fs.writeFileSync(this.receiptPath, JSON.stringify({ version: 1, dll: file, machineAlreadyInstalled: previous?.machineAlreadyInstalled === false && before.machineRegistered ? false : !!before.machineRegistered, phase: 'pending', at: new Date().toISOString() }, null, 2));
    if (!before.machineRegistered) await this.run('install-machine', true);
    await this.run('register-user');
    const status = await this.status(); if (!status.registered) throw new Error('组件未完成注册，当前电脑主题未改变，可重试启用');
    const record = JSON.parse(fs.readFileSync(this.receiptPath)); record.phase = 'installed'; fs.writeFileSync(this.receiptPath, JSON.stringify(record, null, 2));
    return status;
  }
  async apply(buffer, { cover = false } = {}) {
    const status = await this.status();
    if (!status.registered) throw new Error('请先启用资源管理器组件并完成 Windows 授权，当前电脑主题尚未改变');
    const image = path.join(this.location(), digest(buffer) + '.png');
    if (!fs.existsSync(image)) fs.writeFileSync(image, buffer, { flag: 'wx' });
    this.config(true, image, cover);
    const response = await this.run('reload');
    if ((response.live || []).some(x => !x.responded || x.result !== 1)) throw new Error('资源管理器没有完成重绘，恢复记录已保留，请重试或撤销');
    return { ...await this.status(), pendingWindow: !response.live?.length };
  }
  async disable() {
    this.config(false);
    const response = await this.run('disable');
    if ((response.live || []).some(x => !x.responded || x.result !== 1)) throw new Error('部分资源管理器未响应撤销，备份保留，请重试恢复');
    return this.status();
  }
  async restart() {
    if (!(await this.status()).registered) throw new Error('请先启用资源管理器组件');
    const result = await this.run('restart');
    return { ...await this.status(), restartResult: result };
  }
  async uninstall() {
    await this.disable();
    await this.run('remove-user');
    const status = await this.status();
    const record = fs.existsSync(this.receiptPath) ? JSON.parse(fs.readFileSync(this.receiptPath)) : null;
    const ownsMachine = record?.version === 1 && record.dll === this.dll() && record.machineAlreadyInstalled === false;
    if (status.machineRegistered && ownsMachine) await this.run('remove-machine', true);
    if (ownsMachine && (await this.status()).machineRegistered) throw new Error('Windows 未完成组件移除，可以重试；图片效果已停止');
    if (fs.existsSync(this.receiptPath)) { const record = JSON.parse(fs.readFileSync(this.receiptPath)); record.phase = 'removed'; fs.writeFileSync(this.receiptPath, JSON.stringify(record, null, 2)); }
    return this.status();
  }
}
module.exports = { ExplorerBeautyEngine };
