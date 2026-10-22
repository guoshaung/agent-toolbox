const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), { execFileSync } = require('node:child_process');
test('native user-registration guards accept a junction to the same DLL and reject a different file', { skip: process.platform !== 'win32' }, t => {
  const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'beauty-reg-path-'));
  t.after(() => { assert.equal(path.dirname(root), require('node:os').tmpdir()); fs.rmSync(root, { recursive: true, force: true }); });
  const actual = path.join(root, 'actual'), alias = path.join(root, 'alias'); fs.mkdirSync(actual); fs.symlinkSync(actual, alias, 'junction');
  fs.writeFileSync(path.join(actual, 'ToolboxBeautyExplorer.dll'), 'MZ-test'); fs.writeFileSync(path.join(actual, 'other.dll'), 'MZ-test');
  const paths = Buffer.from(JSON.stringify({ physical: path.join(actual, 'ToolboxBeautyExplorer.dll'), alias: path.join(alias, 'ToolboxBeautyExplorer.dll'), other: path.join(actual, 'other.dll') })).toString('base64');
  const source = fs.readFileSync(path.join(__dirname, '../src/main/beauty-explorer-native.ps1'), 'utf8');
  const functions = source.slice(source.indexOf("$ErrorActionPreference = 'Stop'"), source.indexOf('$machine ='));
  const check = `
$paths=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${paths}'))|ConvertFrom-Json
$record=@{values=@{''=@{kind='String';value=$beautyMarker}};children=@('InprocServer32')}
$server=@{values=@{''=@{kind='String';value=$paths.alias};ThreadingModel=@{kind='String';value='Apartment'}};children=@()}
Assert-BeautyUserOwned $record $server $paths.physical
Assert-BeautyUserMayComplete $record $server $paths.physical
$server.values[''].value=$paths.other
$refused=$false;try{Assert-BeautyUserOwned $record $server $paths.physical}catch{$refused=$true}
if(-not $refused){throw 'Different DLL path accepted'}
$refused=$false;try{Assert-BeautyUserMayComplete $record $server $paths.physical}catch{$refused=$true}
if(-not $refused){throw 'Different DLL path accepted for retry'}
@{ok=$true;productionKeysWritten=$false}|ConvertTo-Json -Compress
`;
  const file = path.join(root, 'test.ps1'); fs.writeFileSync(file, '\uFEFF' + functions + check);
  const env = { ...process.env }; delete env.PSModulePath;
  const stdout = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file], { env, encoding: 'utf8', windowsHide: true, timeout: 20000 });
  assert.equal(JSON.parse(stdout.trim()).ok, true);
});
test('registry ownership guards use real types and preserve unexpected values and subkeys', { skip: process.platform !== 'win32' }, () => {
  const source = fs.readFileSync(path.join(__dirname,'../src/main/beauty-explorer-native.ps1'),'utf8');
  const functions = source.slice(source.indexOf("$ErrorActionPreference = 'Stop'"), source.indexOf('Add-Type'));
  const check = `
$temporaryPath='Software\\AgentToolboxTests\\BeautyEngine\\'+[Guid]::NewGuid().ToString()
if(-not $temporaryPath.StartsWith('Software\\AgentToolboxTests\\BeautyEngine\\')){throw 'Bad test namespace'}
try {
 $key=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($temporaryPath)
 $key.SetValue('',$beautyMarker,[Microsoft.Win32.RegistryValueKind]::String)
 $key.SetValue('NoInternetExplorer',1,[Microsoft.Win32.RegistryValueKind]::DWord)
 $key.Dispose()
 $record=Read-BeautyRegistration ([Microsoft.Win32.Registry]::CurrentUser) $temporaryPath
 Assert-BeautyMachineOwned $record
 $key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($temporaryPath,$true)
 $key.SetValue('keep','untouched',[Microsoft.Win32.RegistryValueKind]::String);$key.Dispose()
 $refused=$false;try{Assert-BeautyMachineOwned (Read-BeautyRegistration ([Microsoft.Win32.Registry]::CurrentUser) $temporaryPath)}catch{$refused=$true}
 if(-not $refused){throw 'Unknown values accepted'}
 $key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($temporaryPath,$true)
 if($key.GetValue('keep') -cne 'untouched'){throw 'Unknown value changed'}
 $key.DeleteValue('keep');$child=$key.CreateSubKey('unexpected');$child.Dispose();$key.Dispose()
 $refused=$false;try{Assert-BeautyMachineOwned (Read-BeautyRegistration ([Microsoft.Win32.Registry]::CurrentUser) $temporaryPath)}catch{$refused=$true}
 if(-not $refused){throw 'Unknown subkey accepted'}
 @{ok=$true;productionKeysWritten=$false}|ConvertTo-Json -Compress
} finally {[Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree($temporaryPath,$false)}
`;
  const stdout = execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(functions+check,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true,timeout:20000});
  assert.equal(JSON.parse(stdout.trim()).ok,true);
});
