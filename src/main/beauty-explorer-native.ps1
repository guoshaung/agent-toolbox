param(
  [ValidateSet('status','install-machine','remove-machine','register-user','remove-user','reload','disable')][string]$Operation,
  [string]$DllPath = ''
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$beautyClsid = '{70C21916-1316-4825-AF20-DEED801D7690}'
$beautyMarker = 'AgentToolboxBeautyExplorerV1'
$beautyMachinePath = "Software\Microsoft\Windows\CurrentVersion\Explorer\Browser Helper Objects\$beautyClsid"
$beautyClassPath = "Software\Classes\CLSID\$beautyClsid"
function Read-BeautyRegistration($Hive, [string]$Path) {
  $key = $Hive.OpenSubKey($Path,$false)
  if ($null -eq $key) { return $null }
  try {
    $values = @{}
    foreach ($name in $key.GetValueNames()) {
      $values[$name] = @{ kind=$key.GetValueKind($name).ToString(); value=$key.GetValue($name) }
    }
    return @{ values=$values; children=@($key.GetSubKeyNames()) }
  } finally { $key.Dispose() }
}
function Assert-BeautyMachineOwned($Record) {
  if ($null -eq $Record) { return }
  if ($Record.children.Count -ne 0 -or $Record.values.Count -ne 2 -or $Record.values[''].kind -ne 'String' -or $Record.values[''].value -cne $beautyMarker -or $Record.values.NoInternetExplorer.kind -ne 'DWord' -or $Record.values.NoInternetExplorer.value -ne 1) { throw 'This Explorer component registration belongs to another installation; no changes made' }
}
function Assert-BeautyMachineMayComplete($Record) {
  if ($null -eq $Record) { return }
  if ($Record.children.Count -ne 0 -or $Record.values.Count -lt 1 -or $Record.values.Count -gt 2 -or $Record.values[''].kind -ne 'String' -or $Record.values[''].value -cne $beautyMarker -or ($Record.values.ContainsKey('NoInternetExplorer') -and ($Record.values.NoInternetExplorer.kind -ne 'DWord' -or $Record.values.NoInternetExplorer.value -ne 1)) -or @($Record.values.Keys | Where-Object { $_ -ne '' -and $_ -ne 'NoInternetExplorer' }).Count) { throw 'Explorer component key was changed; preserved for inspection' }
}
function Assert-BeautyUserOwned($Record, $Server, [string]$Expected) {
  if ($null -eq $Record -and $null -eq $Server) { return }
  if ($null -eq $Record -or $null -eq $Server -or $Record.values.Count -ne 1 -or $Record.values[''].value -cne $beautyMarker -or $Record.values[''].kind -ne 'String' -or $Record.children.Count -ne 1 -or $Record.children[0] -cne 'InprocServer32' -or $Server.children.Count -ne 0 -or $Server.values.Count -ne 2 -or $Server.values[''].value -ine $Expected -or $Server.values[''].kind -ne 'String' -or $Server.values.ThreadingModel.kind -ne 'String' -or $Server.values.ThreadingModel.value -cne 'Apartment') { throw 'This user Explorer component registration has changed; preserved for inspection' }
}
function Assert-BeautyUserMayComplete($Record, $Server, [string]$Expected) {
  if ($null -eq $Record -and $null -eq $Server) { return }
  if ($null -eq $Record -or $Record.values.Count -ne 1 -or $Record.values[''].kind -ne 'String' -or $Record.values[''].value -cne $beautyMarker -or @($Record.children | Where-Object { $_ -cne 'InprocServer32' }).Count) { throw 'User component key was changed; preserved for inspection' }
  if ($null -ne $Server -and ($Server.children.Count -ne 0 -or @($Server.values.Keys | Where-Object { $_ -ne '' -and $_ -ne 'ThreadingModel' }).Count -or ($Server.values.ContainsKey('') -and ($Server.values[''].kind -ne 'String' -or $Server.values[''].value -ine $Expected)) -or ($Server.values.ContainsKey('ThreadingModel') -and ($Server.values.ThreadingModel.kind -ne 'String' -or $Server.values.ThreadingModel.value -cne 'Apartment')))) { throw 'User component server was changed; preserved for inspection' }
}
Add-Type @'
using System; using System.Text; using System.Runtime.InteropServices;
public static class ToolboxExplorerMessages {
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern IntPtr FindWindowEx(IntPtr parent,IntPtr after,string cls,string title);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
 [DllImport("user32.dll")] public static extern IntPtr SendMessageTimeout(IntPtr h,uint msg,IntPtr w,IntPtr l,uint flags,uint timeout,out UIntPtr result);
}
'@
function Send-BeautyMessage([uint32]$Message) {
  $after = [IntPtr]::Zero; $results = @(); $expectedExplorer = Join-Path $env:WINDIR 'explorer.exe'
  for ($attempt = 0; $attempt -lt 64; $attempt++) {
    $handle = [ToolboxExplorerMessages]::FindWindowEx([IntPtr](-3),$after,'AgentToolboxBeautyExplorerV1',$null)
    if ($handle -eq [IntPtr]::Zero) { break }; $after = $handle
    [uint32]$engineProcessId = 0
    [void][ToolboxExplorerMessages]::GetWindowThreadProcessId($handle,[ref]$engineProcessId)
    $engineProcess = Get-Process -Id $engineProcessId -ErrorAction SilentlyContinue
    if ($null -eq $engineProcess -or $engineProcess.Path -ine $expectedExplorer) { continue }
    # Verify our exact loaded module path, not just a spoofable message-window class.
    $loaded = @($engineProcess.Modules | Where-Object { $_.FileName -ieq $DllPath })
    if ($loaded.Count -ne 1) { continue }
    [UIntPtr]$reply = [UIntPtr]::Zero
    $sent = [ToolboxExplorerMessages]::SendMessageTimeout($handle,$Message,[IntPtr]::Zero,[IntPtr]::Zero,3,1500,[ref]$reply)
    $results += @{ pid=$engineProcessId; responded=($sent -ne [IntPtr]::Zero); result=$reply.ToUInt64() }
  }
  return $results
}
$machine = Read-BeautyRegistration ([Microsoft.Win32.Registry]::LocalMachine) $beautyMachinePath
$user = Read-BeautyRegistration ([Microsoft.Win32.Registry]::CurrentUser) $beautyClassPath
$server = Read-BeautyRegistration ([Microsoft.Win32.Registry]::CurrentUser) "$beautyClassPath\InprocServer32"
switch ($Operation) {
  'status' {
    $machineOwned=$false; $userOwned=$false; $machineRecoverable=$false; $userRecoverable=$false
    try { Assert-BeautyMachineOwned $machine; $machineOwned=($null -ne $machine) } catch {}
    try { Assert-BeautyUserOwned $user $server $DllPath; $userOwned=($null -ne $user) } catch {}
    try { Assert-BeautyMachineMayComplete $machine; $machineRecoverable=$true } catch {}
    try { Assert-BeautyUserMayComplete $user $server $DllPath; $userRecoverable=$true } catch {}
    $live = @(Send-BeautyMessage 0x810f)
    @{ machineRegistered=$machineOwned; userRegistered=$userOwned; foreignMachine=($null -ne $machine -and -not $machineRecoverable); foreignUser=($null -ne $user -and -not $userRecoverable); live=$live; requiresAdministrator=(-not $machineOwned) } | ConvertTo-Json -Depth 6 -Compress
  }
  'install-machine' {
    Assert-BeautyMachineMayComplete $machine
    & {
      $key=[Microsoft.Win32.Registry]::LocalMachine.CreateSubKey($beautyMachinePath)
      try { $key.SetValue('',$beautyMarker,[Microsoft.Win32.RegistryValueKind]::String); $key.SetValue('NoInternetExplorer',1,[Microsoft.Win32.RegistryValueKind]::DWord); $key.Flush() } finally { $key.Dispose() }
    }
    @{ installed=$true } | ConvertTo-Json -Compress
  }
  'remove-machine' {
    Assert-BeautyMachineMayComplete $machine
    if ($null -ne $machine) { [Microsoft.Win32.Registry]::LocalMachine.DeleteSubKey($beautyMachinePath,$false) }
    @{ removed=$true } | ConvertTo-Json -Compress
  }
  'register-user' {
    if (-not $DllPath -or -not (Test-Path -LiteralPath $DllPath -PathType Leaf)) { throw 'Prepared native component missing' }
    Assert-BeautyMachineOwned $machine
    if ($null -eq $machine) { throw 'Windows administrator authorization is required to enable Explorer loading' }
    Assert-BeautyUserMayComplete $user $server $DllPath
    if ($true) {
      $key=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($beautyClassPath)
      try { $key.SetValue('',$beautyMarker,[Microsoft.Win32.RegistryValueKind]::String) } finally { $key.Dispose() }
      $key=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey("$beautyClassPath\InprocServer32")
      try { $key.SetValue('',$DllPath,[Microsoft.Win32.RegistryValueKind]::String); $key.SetValue('ThreadingModel','Apartment',[Microsoft.Win32.RegistryValueKind]::String); $key.Flush() } finally { $key.Dispose() }
    }
    @{ registered=$true } | ConvertTo-Json -Compress
  }
  'remove-user' {
    Assert-BeautyUserMayComplete $user $server $DllPath
    if ($null -ne $server) { [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKey("$beautyClassPath\InprocServer32",$false) }
    if ($null -ne $user) { [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKey($beautyClassPath,$false) }
    @{ removed=$true } | ConvertTo-Json -Compress
  }
  'reload' { @{ live=@(Send-BeautyMessage 0x8110) } | ConvertTo-Json -Depth 5 -Compress }
  'disable' { @{ live=@(Send-BeautyMessage 0x8111) } | ConvertTo-Json -Depth 5 -Compress }
}
