param([ValidateSet('read','validate','apply','restore')][string]$Operation,[string]$PayloadPath)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
Add-Type @'
using System;using System.Runtime.InteropServices;
public static class BeautyShellRefresh {
 [DllImport("shell32.dll")]public static extern void SHChangeNotify(uint eventId,uint flags,IntPtr item1,IntPtr item2);
 [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)]public static extern bool SystemParametersInfo(uint action,uint param,IntPtr value,uint flags);
 [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)]public static extern IntPtr LoadCursorFromFile(string file);
 [DllImport("user32.dll")]public static extern bool DestroyCursor(IntPtr cursor);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)]public static extern IntPtr SendMessageTimeout(IntPtr h,uint msg,IntPtr w,string l,uint flags,uint timeout,out UIntPtr result);
}
'@
# The renderer cannot supply registry paths. Every destination is fixed here.
$script:BeautyShellSlots=@{
 'icon.computer'=@('Software\Microsoft\Windows\CurrentVersion\Explorer\CLSID\{20D04FE0-3AEA-1069-A2D8-08002B30309D}\DefaultIcon','')
 'icon.documents'=@('Software\Microsoft\Windows\CurrentVersion\Explorer\CLSID\{59031A47-3F72-44A7-89C5-5595FE6B30EE}\DefaultIcon','')
 'icon.network'=@('Software\Microsoft\Windows\CurrentVersion\Explorer\CLSID\{F02C1A0D-BE21-4350-88B0-7367FC96EF3C}\DefaultIcon','')
 'icon.recycleEmpty'=@('Software\Microsoft\Windows\CurrentVersion\Explorer\CLSID\{645FF040-5081-101B-9F08-00AA002F954E}\DefaultIcon','empty')
 'icon.recycleFull'=@('Software\Microsoft\Windows\CurrentVersion\Explorer\CLSID\{645FF040-5081-101B-9F08-00AA002F954E}\DefaultIcon','full')
 'icon.folder'=@('Software\Classes\Folder\DefaultIcon','')
 'accent.dwm'=@('Software\Microsoft\Windows\DWM','AccentColor')
 'accent.colorization'=@('Software\Microsoft\Windows\DWM','ColorizationColor')
 'accent.titlebar'=@('Software\Microsoft\Windows\DWM','ColorPrevalence')
 'accent.shell'=@('Software\Microsoft\Windows\CurrentVersion\Themes\Personalize','ColorPrevalence')
 'accent.menu'=@('Software\Microsoft\Windows\CurrentVersion\Explorer\Accent','AccentColorMenu')
}
foreach($name in @('Arrow','Help','AppStarting','Wait','Crosshair','IBeam','NWPen','No','SizeNS','SizeWE','SizeNWSE','SizeNESW','SizeAll','UpArrow','Hand')){$script:BeautyShellSlots['cursor.'+$name]=@('Control Panel\Cursors',$name)}
function Read-BeautyShellValues($Hive) {
 $result=@{}
 foreach($slot in $script:BeautyShellSlots.Keys){$destination=$script:BeautyShellSlots[$slot];$key=$Hive.OpenSubKey($destination[0],$false)
  try{if($null -eq $key -or $key.GetValueNames() -notcontains $destination[1]){$result[$slot]=@{exists=$false};continue}
   $kind=$key.GetValueKind($destination[1]).ToString();$expected=if($slot.StartsWith('accent.')){@('DWord')}else{@('String','ExpandString')};if($expected -notcontains $kind){throw 'Unsupported original shell style registry type; preserved'}
   $raw=$key.GetValue($destination[1],$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames);if($kind -eq 'DWord'){$raw=[uint32]([int64]$raw -band 0xffffffffL)}
   $result[$slot]=@{exists=$true;kind=$kind;value=$raw}
  }finally{if($null -ne $key){$key.Dispose()}}
 }
 return $result
}
function Assert-BeautyShellValues($Values,[bool]$Restore) {
 $fields=@($Values.PSObject.Properties);if($fields.Count -lt 1 -or $fields.Count -gt $script:BeautyShellSlots.Count){throw 'Invalid shell style field count'}
 foreach($field in $fields){$value=$field.Value
  if(-not $script:BeautyShellSlots.ContainsKey($field.Name) -or $value.exists -isnot [bool]){throw 'Unknown shell style field'}
  if($field.Name.StartsWith('accent.')){if($value.exists -and ($value.kind -cne 'DWord' -or ($value.value -isnot [int] -and $value.value -isnot [long]) -or $value.value -lt 0 -or $value.value -gt 4294967295L)){throw 'Invalid shell color value'};continue}
  if($value.exists -and (@('String','ExpandString') -notcontains $value.kind -or $value.value -isnot [string] -or $value.value.Length -gt 32768 -or $value.value.Contains([char]0))){throw 'Invalid shell style value'}
  if(-not $Restore){if(-not $value.exists -or $value.kind -cne 'String'){throw 'Invalid applied shell style'}
   $file=$value.value
   if($field.Name.StartsWith('icon.')){if(-not $file.EndsWith('.ico,0',[StringComparison]::OrdinalIgnoreCase)){throw 'Only ICO resources are accepted'};$file=$file.Substring(0,$file.Length-2)}
   elseif(@('.cur','.ani') -notcontains [IO.Path]::GetExtension($file).ToLowerInvariant()){throw 'Invalid cursor extension'}
   if(-not [IO.Path]::IsPathRooted($file) -or -not [IO.File]::Exists($file)){throw 'Prepared icon/cursor file missing'}
   if($field.Name.StartsWith('cursor.')){$cursor=[BeautyShellRefresh]::LoadCursorFromFile($file);if($cursor -eq [IntPtr]::Zero){throw 'Windows rejected a generated cursor'};[void][BeautyShellRefresh]::DestroyCursor($cursor)}
  }
 }
}
function Write-BeautyShellValues($Hive,$Values) {
 foreach($field in $Values.PSObject.Properties){$destination=$script:BeautyShellSlots[$field.Name];$key=$null
  try{if($field.Value.exists){$key=$Hive.CreateSubKey($destination[0]);$kind=[Enum]::Parse([Microsoft.Win32.RegistryValueKind],$field.Value.kind);$raw=$field.Value.value;if($kind -eq [Microsoft.Win32.RegistryValueKind]::DWord){$raw=[BitConverter]::ToInt32([BitConverter]::GetBytes([uint32]$raw),0)};$key.SetValue($destination[1],$raw,$kind);$key.Flush()}
   else{$key=$Hive.OpenSubKey($destination[0],$true);if($null -ne $key){$key.DeleteValue($destination[1],$false);$key.Flush()}}
  }finally{if($null -ne $key){$key.Dispose()}}
 }
}
if($Operation -eq 'read'){Read-BeautyShellValues ([Microsoft.Win32.Registry]::CurrentUser)|ConvertTo-Json -Depth 5 -Compress;exit}
if((Get-Item -LiteralPath $PayloadPath).Length -gt 1048576){throw 'Shell style request too large'}
$request=Get-Content -LiteralPath $PayloadPath -Raw -Encoding UTF8|ConvertFrom-Json
Assert-BeautyShellValues $request.values ($Operation -eq 'restore')
if($Operation -eq 'validate'){@{valid=$true;fields=@($request.values.PSObject.Properties).Count}|ConvertTo-Json -Compress;exit}
Write-BeautyShellValues ([Microsoft.Win32.Registry]::CurrentUser) $request.values
if(@($request.values.PSObject.Properties|Where-Object {$_.Name.StartsWith('cursor.')}).Count){if(-not [BeautyShellRefresh]::SystemParametersInfo(0x57,0,[IntPtr]::Zero,0)){throw 'Windows could not reload cursors; recovery retained'}}
if(@($request.values.PSObject.Properties|Where-Object {$_.Name.StartsWith('icon.')}).Count){[BeautyShellRefresh]::SHChangeNotify(0x08000000,0,[IntPtr]::Zero,[IntPtr]::Zero)}
if(@($request.values.PSObject.Properties|Where-Object {$_.Name.StartsWith('accent.')}).Count){[UIntPtr]$reply=[UIntPtr]::Zero;[void][BeautyShellRefresh]::SendMessageTimeout([IntPtr]0xffff,0x1a,[IntPtr]::Zero,'ImmersiveColorSet',2,100,[ref]$reply)}
$actual=Read-BeautyShellValues ([Microsoft.Win32.Registry]::CurrentUser)
foreach($field in $request.values.PSObject.Properties){$v=$actual[$field.Name];if($v.exists -ne $field.Value.exists -or ($v.exists -and ($v.kind -cne $field.Value.kind -or $v.value -cne $field.Value.value))){throw 'Shell style readback mismatch; recovery retained'}}
@{applied=$true;fields=@($request.values.PSObject.Properties).Count}|ConvertTo-Json -Compress
