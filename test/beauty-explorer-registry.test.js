const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), { execFileSync } = require('node:child_process');
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
