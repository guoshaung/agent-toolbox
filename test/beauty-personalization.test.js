'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { SystemBeauty, WindowsBeautyBridge } = require('../src/main/system-beauty');
const { normalizeWindowsOptions, personalizationPlan, validatePersonalizationValues } = require('../src/main/beauty-personalization');
const dword = value => ({ exists: true, kind: 'DWord', value });
const missing = () => ({ exists: false });
const clone = value => JSON.parse(JSON.stringify(value));

function setup(t, initial = { AppsUseLightTheme: dword(1), SystemUsesLightTheme: dword(0), EnableTransparency: missing() }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolbox-personalization-'));
  t.after(() => { assert.equal(path.dirname(root), os.tmpdir()); assert.ok(path.basename(root).startsWith('toolbox-personalization-')); fs.rmSync(root, { recursive: true, force: true }); });
  const state = { current: clone(initial), calls: [], reads: 0, fail: false };
  const native = {
    personalization: async () => { state.reads++; return clone(state.current); },
    setPersonalization: async values => {
      assert.ok(JSON.parse(fs.readFileSync(path.join(root, 'library.json'))).personalizationRecovery, 'backup must be durable before any native write');
      state.calls.push(clone(values)); Object.assign(state.current, clone(values));
      if (state.fail) throw new Error('simulated partial native failure');
      return { notified: true };
    },
  };
  return { beauty: new SystemBeauty({ root, native, platform: 'win32' }), native, state };
}

test('Windows choices default to keep and reject invalid values without accepting arbitrary registry paths', () => {
  assert.deepEqual(normalizeWindowsOptions(), { apps: 'keep', system: 'keep', transparency: 'keep' });
  assert.deepEqual(personalizationPlan({ apps: 'dark', transparency: 'on', path: 'HKLM' }), { AppsUseLightTheme: dword(0), EnableTransparency: dword(1) });
  for (const input of [null, [], 'dark', { apps: 'unknown' }, { transparency: true }]) assert.throws(() => personalizationPlan(input), /无效/);
});

test('apply preserves untouched Windows values and extends the baseline across multiple apply cycles', async t => {
  const { beauty, state, native } = setup(t);
  await beauty.applyPersonalization({ apps: 'dark' });
  assert.equal(state.current.SystemUsesLightTheme.value, 0);
  assert.deepEqual(beauty.read().personalizationRecovery.values, { AppsUseLightTheme: dword(1) });
  await beauty.applyPersonalization({ apps: 'light', transparency: 'on' });
  const reopened = new SystemBeauty({ root: beauty.root, native, platform: 'win32' });
  assert.deepEqual(reopened.read().personalizationRecovery.values, { AppsUseLightTheme: dword(1), EnableTransparency: missing() });
  await reopened.restorePersonalization();
  assert.deepEqual(state.calls.at(-1), { AppsUseLightTheme: dword(1), EnableTransparency: missing() });
  assert.equal(reopened.list().personalizationRecovery, null);
});

test('missing values and full unsigned DWORD values are restored without changing their type', async t => {
  const { beauty, state } = setup(t, { AppsUseLightTheme: dword(0xffffffff), SystemUsesLightTheme: missing(), EnableTransparency: dword(1) });
  await beauty.applyPersonalization({ apps: 'dark', system: 'light' });
  await beauty.restorePersonalization();
  assert.deepEqual(state.current, { AppsUseLightTheme: dword(0xffffffff), SystemUsesLightTheme: missing(), EnableTransparency: dword(1) });
});

test('partial OS failure and failed restore keep recovery durable until a successful retry', async t => {
  const { beauty, state } = setup(t); state.fail = true;
  await assert.rejects(beauty.applyPersonalization({ apps: 'dark', transparency: 'on' }), /partial/);
  assert.ok(beauty.list().personalizationRecovery);
  await assert.rejects(beauty.restorePersonalization(), /partial/);
  assert.ok(beauty.list().personalizationRecovery);
  state.fail = false; await beauty.restorePersonalization();
  assert.deepEqual(state.current.EnableTransparency, missing());
  assert.equal(beauty.list().personalizationRecovery, null);
});

test('unsupported targeted registry types, malformed backups and no-op requests never mutate the OS', async t => {
  const { beauty, state } = setup(t, { AppsUseLightTheme: { exists: true, kind: 'String' }, SystemUsesLightTheme: dword(1), EnableTransparency: missing() });
  await assert.rejects(beauty.applyPersonalization({}), /请先选择/);
  await assert.rejects(beauty.applyPersonalization({ apps: 'dark' }), /类型/);
  assert.equal(fs.existsSync(beauty.file), false);
  beauty.write({ version: 1, assets: [], profiles: [], personalizationRecovery: { version: 1, values: { arbitraryKey: dword(0) } } });
  await assert.rejects(beauty.restorePersonalization(), /无效字段/);
  assert.equal(state.calls.length, 0);
  beauty.write({ version: 1, assets: [], profiles: [], personalizationRecovery: { version: 200, values: { AppsUseLightTheme: dword(1) } } });
  await assert.rejects(beauty.applyPersonalization({ system: 'dark' }), /版本/);
});

test('unsupported values in untouched fields are preserved and backup write failure prevents native calls', async t => {
  const { beauty, state } = setup(t, { AppsUseLightTheme: { exists: true, kind: 'String' }, SystemUsesLightTheme: dword(1), EnableTransparency: missing() });
  await beauty.applyPersonalization({ system: 'dark' });
  assert.deepEqual(state.current.AppsUseLightTheme, { exists: true, kind: 'String' });
  const writes = state.calls.length;
  beauty.write = () => { throw new Error('disk full'); };
  await assert.rejects(beauty.applyPersonalization({ transparency: 'on' }), /disk full/);
  assert.equal(state.calls.length, writes);
});

test('concurrent changes serialize their backups and preserve the first original value', async t => {
  const { beauty, state } = setup(t);
  await Promise.all([beauty.applyPersonalization({ apps: 'dark' }), beauty.applyPersonalization({ apps: 'light', transparency: 'off' })]);
  assert.deepEqual(beauty.read().personalizationRecovery.values, { AppsUseLightTheme: dword(1), EnableTransparency: missing() });
  assert.equal(state.calls.length, 2);
});

test('saved and portable themes retain choices but omit registry backups', async t => {
  const { beauty } = setup(t);
  await beauty.applyPersonalization({ apps: 'dark' });
  const profile = { id: 'native-theme', windows: { apps: 'dark', system: 'light', transparency: 'off', font: 'no' } };
  await beauty.saveProfile(profile);
  const bundle = JSON.parse(beauty.exportBundle(profile));
  assert.deepEqual(bundle.theme.windows, { apps: 'dark', system: 'light', transparency: 'off' });
  assert.ok(!JSON.stringify(bundle).includes('AppsUseLightTheme'));
  assert.ok(!JSON.stringify(bundle).includes('personalizationRecovery'));
  const result = await beauty.importBundle(JSON.stringify(bundle));
  assert.deepEqual(result.profiles.at(-1).windows, bundle.theme.windows);
});

test('native bridge restricts settings to documented DWORD fields before executing PowerShell', async () => {
  let calls = 0;
  const bridge = new WindowsBeautyBridge({ platform: 'win32', exec: async (_command, args) => {
    calls++;
    const command = Buffer.from(args.at(-1), 'base64').toString('utf16le');
    assert.ok(command.includes(Buffer.from(JSON.stringify({ AppsUseLightTheme: dword(0) })).toString('base64')));
    return { stdout: '{"applied":true,"notified":false}' };
  } });
  assert.equal((await bridge.setPersonalization({ AppsUseLightTheme: dword(0) })).notified, false);
  for (const value of [{}, { path: dword(1) }, { AppsUseLightTheme: dword(-1) }, { AppsUseLightTheme: { exists: 'yes' } }]) await assert.rejects(bridge.setPersonalization(value));
  assert.equal(calls, 1);
  assert.throws(() => validatePersonalizationValues({ AppsUseLightTheme: dword(NaN) }));
});

test('PowerShell registry adapter round-trips DWORD and absent values in an isolated test key', { skip: process.platform !== 'win32' }, () => {
  const source = path.join(__dirname, '../src/main/system-beauty-native.ps1');
  const script = `$ErrorActionPreference='Stop';$source=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(source).toString('base64')}'));. $source
$testPath='Software\\AgentToolboxBeautyTest-'+[Guid]::NewGuid().ToString('N')
if($testPath -notmatch '^Software\\\\AgentToolboxBeautyTest-[a-f0-9]{32}$'){throw 'Invalid test key'}
$key=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($testPath)
try {
 $key.SetValue('Other','untouched',[Microsoft.Win32.RegistryValueKind]::String)
 $key.SetValue('AppsUseLightTheme',-1,[Microsoft.Win32.RegistryValueKind]::DWord)
 $before=Get-ToolboxPersonalizationValues $key
 if($before.AppsUseLightTheme.value -ne 4294967295L -or $before.SystemUsesLightTheme.exists){throw 'Read mismatch'}
 $values='{"AppsUseLightTheme":{"exists":true,"kind":"DWord","value":0},"SystemUsesLightTheme":{"exists":true,"kind":"DWord","value":1}}'|ConvertFrom-Json
 Set-ToolboxPersonalizationValues $key $values
 if($key.GetValue('AppsUseLightTheme') -ne 0 -or $key.GetValueKind('SystemUsesLightTheme').ToString() -ne 'DWord'){throw 'Write mismatch'}
 $restore=$before|ConvertTo-Json -Depth 5 -Compress|ConvertFrom-Json
 Set-ToolboxPersonalizationValues $key $restore
 $after=Get-ToolboxPersonalizationValues $key
 if($after.AppsUseLightTheme.value -ne 4294967295L -or $after.SystemUsesLightTheme.exists -or $key.GetValue('Other') -ne 'untouched'){throw 'Restore mismatch'}
 $blocked=$false;try{Set-ToolboxPersonalizationValues $key ('{"Other":{"exists":true,"kind":"DWord","value":1}}'|ConvertFrom-Json)}catch{$blocked=$true}
 if(-not $blocked -or $key.GetValue('Other') -ne 'untouched'){throw 'Whitelist failure'}
 @{passed=$true;fixtureOnly=$true;broadcastSent=$false}|ConvertTo-Json -Compress
} finally { $key.Dispose();[Microsoft.Win32.Registry]::CurrentUser.DeleteSubKey($testPath,$false) }`;
  const output = execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, timeout: 20000, encoding: 'utf8' });
  assert.deepEqual(JSON.parse(output), { passed: true, fixtureOnly: true, broadcastSent: false });
});
