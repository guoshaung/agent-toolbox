param([ValidateSet('extract','status','record','stop')][string]$Operation,[string]$Root,[string]$Receipt)
$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
if([IO.Path]::GetFileName($Root) -cne '2026.2' -or [IO.Path]::GetFileName($Receipt) -cne 'session.json' -or [IO.Path]::GetDirectoryName($Root) -ine [IO.Path]::GetDirectoryName($Receipt)){throw 'Invalid owned taskbar directory'}
$exe=Join-Path $Root 'TranslucentTB.exe'
if($Operation -eq 'extract'){
 Add-Type -AssemblyName System.IO.Compression.FileSystem
 $zip=Join-Path ([IO.Path]::GetDirectoryName($Root)) 'TranslucentTB-2026.2.zip'
 if((Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash -ine '0dbe8e0255c20e131cde536dcd0ae490d45989a7d360e26d0150dff1922ac420'){throw 'Taskbar archive hash mismatch'}
 $archive=[IO.Compression.ZipFile]::OpenRead($zip)
 try{
  if($archive.Entries.Count -gt 128){throw 'Taskbar archive has too many files'};$total=0
  foreach($entry in $archive.Entries){$total+=$entry.Length;if($total -gt 30MB -or $entry.FullName.Contains('..') -or $entry.FullName.Contains(':') -or $entry.FullName.StartsWith('/') -or $entry.FullName.StartsWith('\')){throw 'Invalid taskbar archive entry'}}
  if(Test-Path -LiteralPath $Root){if(@(Get-ChildItem -LiteralPath $Root -Force).Count){throw 'Preserve existing taskbar directory'}}else{New-Item -ItemType Directory -Path $Root|Out-Null}
  $inventory=@{}
  foreach($entry in $archive.Entries){$target=[IO.Path]::GetFullPath((Join-Path $Root $entry.FullName));if(-not $target.StartsWith([IO.Path]::GetFullPath($Root)+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Taskbar archive escapes owned directory'}
   if(-not $entry.Name){[IO.Directory]::CreateDirectory($target)|Out-Null;continue};[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target))|Out-Null;[IO.Compression.ZipFileExtensions]::ExtractToFile($entry,$target,$false)
   if($entry.FullName -match '^[a-zA-Z0-9_. -]+$'){$inventory[$entry.FullName]=(Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()}
  }
  if(-not (Test-Path -LiteralPath $exe)){throw 'Portable package layout changed'}
  $inventory|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $Root 'toolbox-inventory.json') -Encoding UTF8
 }finally{$archive.Dispose()}
 @{installed=$true}|ConvertTo-Json -Compress;exit
}
$processes=@(Get-Process -Name TranslucentTB -ErrorAction SilentlyContinue);$owned=@();$foreign=$false
foreach($p in $processes){try{if($p.Path -ieq $exe -and $p.SessionId -eq [Diagnostics.Process]::GetCurrentProcess().SessionId){$owned+=$p}else{$foreign=$true}}catch{$foreign=$true}}
if($Operation -eq 'status'){@{running=($owned.Count -eq 1);foreign=$foreign}|ConvertTo-Json -Compress;exit}
if($Operation -eq 'record'){if($owned.Count -ne 1 -or $foreign){throw 'Taskbar component did not start as its owned process'};@{pid=$owned[0].Id;started=$owned[0].StartTime.ToUniversalTime().Ticks.ToString();exe=$exe}|ConvertTo-Json|Set-Content -LiteralPath $Receipt -Encoding UTF8;@{recorded=$true}|ConvertTo-Json -Compress;exit}
$record=Get-Content -LiteralPath $Receipt -Raw -Encoding UTF8|ConvertFrom-Json
if($record.exe -ine $exe){throw 'Taskbar restore identity mismatch'}
$p=Get-Process -Id $record.pid -ErrorAction SilentlyContinue
if($null -ne $p){$null=$p.Handle;if($p.Path -ine $exe -or $p.StartTime.ToUniversalTime().Ticks.ToString() -cne $record.started -or $p.SessionId -ne [Diagnostics.Process]::GetCurrentProcess().SessionId){throw 'Taskbar process identity changed; preserved'}
 Add-Type @'
using System;using System.Runtime.InteropServices;
public static class BeautyTaskbarClose {
 public delegate bool Visitor(IntPtr h,IntPtr p);
 [DllImport("user32.dll")]public static extern bool EnumWindows(Visitor visitor,IntPtr p);
 [DllImport("user32.dll")]public static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
 [DllImport("user32.dll")]public static extern bool PostMessage(IntPtr h,uint message,IntPtr w,IntPtr l);
}
'@
 $visitor=[BeautyTaskbarClose+Visitor]{param($h,$unused)[uint32]$owner=0;$null=[BeautyTaskbarClose]::GetWindowThreadProcessId($h,[ref]$owner);if($owner -eq $p.Id){[void][BeautyTaskbarClose]::PostMessage($h,0x10,[IntPtr]::Zero,[IntPtr]::Zero)};return $true}
 [void][BeautyTaskbarClose]::EnumWindows($visitor,[IntPtr]::Zero)
 if(-not $p.WaitForExit(8000)){throw 'Taskbar component did not exit normally; recovery retained'}
}
Remove-Item -LiteralPath $Receipt
@{restored=$true;wasRunning=($null -ne $p)}|ConvertTo-Json -Compress
