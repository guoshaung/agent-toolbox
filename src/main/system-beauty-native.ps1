param(
  [ValidateSet('wallpaper','set-wallpaper','probe','personalization','set-personalization')][string]$Operation,
  [AllowEmptyString()][string]$ImagePath = ''
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class ToolboxBeautyNative {
  [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool SystemParametersInfo(uint action,uint param,StringBuilder value,uint flags);
  [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true, EntryPoint="SystemParametersInfoW")] public static extern bool SetParameter(uint action,uint param,string value,uint flags);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern IntPtr FindWindowEx(IntPtr parent,IntPtr after,string cls,string title);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
  [DllImport("user32.dll",SetLastError=true)] public static extern IntPtr SendMessageTimeout(IntPtr h,uint msg,IntPtr w,IntPtr l,uint flags,uint timeout,out UIntPtr result);
  [DllImport("user32.dll",CharSet=CharSet.Unicode,EntryPoint="SendMessageTimeoutW")] public static extern IntPtr SendSettingsMessage(IntPtr h,uint msg,IntPtr w,string l,uint flags,uint timeout,out UIntPtr result);
}
'@
# Helpers take an already-open key so tests can use an isolated temporary registry namespace.
# Production callers below always use the fixed current-user Personalize key.
function Get-ToolboxPersonalizationValues($Key) {
  $values = @{}
  foreach ($name in @('AppsUseLightTheme','SystemUsesLightTheme','EnableTransparency')) {
    if ($null -eq $Key -or $Key.GetValueNames() -notcontains $name) { $values[$name] = @{ exists=$false }; continue }
    $kind = $Key.GetValueKind($name).ToString()
    $entry = @{ exists=$true; kind=$kind }
    if ($kind -eq 'DWord') { $entry.value = [uint32]([int64]$Key.GetValue($name) -band 0xffffffffL) }
    $values[$name] = $entry
  }
  return $values
}
function Assert-ToolboxPersonalizationValues($Values) {
  $properties = @($Values.PSObject.Properties)
  if ($properties.Count -lt 1 -or $properties.Count -gt 3) { throw 'Invalid personalization values' }
  foreach ($property in $properties) {
    if (@('AppsUseLightTheme','SystemUsesLightTheme','EnableTransparency') -notcontains $property.Name) { throw 'Unknown personalization field' }
    $entry = $property.Value
    if ($null -eq $entry -or $entry.exists -isnot [bool]) { throw 'Invalid personalization record' }
    if ($entry.exists) {
      $number = $entry.value
      if ($entry.kind -cne 'DWord' -or ($number -isnot [int] -and $number -isnot [long] -and $number -isnot [double]) -or $number -lt 0 -or $number -gt 4294967295L -or [Math]::Floor([double]$number) -ne $number) { throw 'Unsupported personalization value type' }
    }
  }
}
function Set-ToolboxPersonalizationValues($Key, $Values) {
  Assert-ToolboxPersonalizationValues $Values
  foreach ($property in $Values.PSObject.Properties) {
    if ($property.Value.exists) {
      $signed = [BitConverter]::ToInt32([BitConverter]::GetBytes([uint32]$property.Value.value),0)
      $Key.SetValue($property.Name,$signed,[Microsoft.Win32.RegistryValueKind]::DWord)
    } else { $Key.DeleteValue($property.Name,$false) }
  }
  $Key.Flush()
}
$personalizePath = 'Software\Microsoft\Windows\CurrentVersion\Themes\Personalize'
switch ($Operation) {
  'personalization' {
    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($personalizePath,$false)
    try { Get-ToolboxPersonalizationValues $key | ConvertTo-Json -Depth 5 -Compress }
    finally { if ($null -ne $key) { $key.Dispose() } }
  }
  'set-personalization' {
    if ($ImagePath.Length -gt 4096) { throw 'Personalization payload too large' }
    $values = $ImagePath | ConvertFrom-Json
    Assert-ToolboxPersonalizationValues $values
    $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($personalizePath)
    try { Set-ToolboxPersonalizationValues $key $values }
    finally { $key.Dispose() }
    [UIntPtr]$reply = [UIntPtr]::Zero
    $sent = [ToolboxBeautyNative]::SendSettingsMessage([IntPtr]0xffff,0x1a,[IntPtr]::Zero,'ImmersiveColorSet',2,100,[ref]$reply)
    @{ applied=$true; notified=($sent -ne [IntPtr]::Zero) } | ConvertTo-Json -Compress
  }
  'wallpaper' {
    $buffer = [Text.StringBuilder]::new(32768)
    if (-not [ToolboxBeautyNative]::SystemParametersInfo(0x73,$buffer.Capacity,$buffer,0)) { throw 'Windows could not read the current wallpaper' }
    @{ path = $buffer.ToString() } | ConvertTo-Json -Compress
  }
  'set-wallpaper' {
    if ($ImagePath -and -not (Test-Path -LiteralPath $ImagePath -PathType Leaf)) { throw 'Wallpaper file does not exist' }
    if (-not [ToolboxBeautyNative]::SetParameter(0x14,0,$ImagePath,3)) { throw 'Windows refused to set the wallpaper' }
    @{ applied = $true } | ConvertTo-Json -Compress
  }
  'probe' {
    $handle = [ToolboxBeautyNative]::FindWindowEx([IntPtr](-3),[IntPtr]::Zero,'MHostProcess',$null)
    if ($handle -eq [IntPtr]::Zero) { @{ supported=$true; running=$false; verified=$false } | ConvertTo-Json -Compress; break }
    [uint32]$hostProcessId = 0
    [void][ToolboxBeautyNative]::GetWindowThreadProcessId($handle,[ref]$hostProcessId)
    $processPath = (Get-Process -Id $hostProcessId).Path
    if (-not $processPath) { throw 'Could not verify the native host identity' }
    $hash = (Get-FileHash -LiteralPath $processPath -Algorithm SHA256).Hash.ToLowerInvariant()
    # Only probe the exact 2.1.0 host inspected with REA. Never load its DLL in Electron.
    $verified = $hash -eq '8c1bdaba17ab9d60611a24e6442e70d10bb4fcd773d0f0896771acb8cc4d5965'
    $protocol = 0; $statusBits = 0
    if ($verified) {
      [UIntPtr]$reply = [UIntPtr]::Zero
      $sent = [ToolboxBeautyNative]::SendMessageTimeout($handle,0x8048,[IntPtr]::Zero,[IntPtr]::Zero,3,1000,[ref]$reply)
      if ($sent -ne [IntPtr]::Zero) { $protocol = $reply.ToUInt64() }
      if ($protocol -eq 2) {
        $sent = [ToolboxBeautyNative]::SendMessageTimeout($handle,0x804b,[IntPtr]::Zero,[IntPtr]::Zero,3,1000,[ref]$reply)
        if ($sent -ne [IntPtr]::Zero) { $statusBits = $reply.ToUInt64() }
      }
    }
    @{ supported=$true; running=$true; verified=$verified; protocol=$protocol; statusBits=$statusBits; pid=$hostProcessId; path=$processPath } | ConvertTo-Json -Compress
  }
}
