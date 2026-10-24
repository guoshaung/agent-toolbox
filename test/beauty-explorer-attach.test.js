const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { spawnSync } = require('node:child_process');
test('the native connector rejects changed DLL bytes before inspecting or connecting windows', { skip: process.platform !== 'win32' }, t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'beauty-attach-'));
  t.after(() => { assert.equal(path.dirname(root), os.tmpdir()); fs.rmSync(root, { recursive: true, force: true }); });
  const dll = path.join(root, 'ToolboxBeautyExplorer.dll'); fs.writeFileSync(dll, 'MZ-tampered');
  const env = { ...process.env }; for (const key of Object.keys(env)) if (key.toLowerCase() === 'psmodulepath') delete env[key];
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, '../src/main/beauty-explorer-attach.ps1'), '-DllPath', dll, '-ExpectedHash', '0'.repeat(64)], { env, encoding: 'utf8', windowsHide: true, timeout: 20000 });
  assert.notEqual(result.status, 0); assert.match(result.stderr, /Component bytes changed/);
});
