$ErrorActionPreference='Stop'
$PSModuleAutoloadingPreference='None'
[Console]::InputEncoding=[System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)
Import-Module 'C:\Windows\System32\WindowsPowerShell\v1.0\Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1'
$code=@'
using System;using System.IO;using System.Text;using System.Collections.Generic;using System.Runtime.InteropServices;using System.Security.Cryptography;using Microsoft.Win32.SafeHandles;
public class T011Meta { public string path,name,parent,sha256,identity,writeTicks,creationTicks;public long bytes; }
public class T011Lease:IDisposable {
 [StructLayout(LayoutKind.Sequential)] public struct Info {public uint attributes,creationLow,creationHigh,accessLow,accessHigh,writeLow,writeHigh,volume,sizeHigh,sizeLow,links,indexHigh,indexLow;}
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern SafeFileHandle CreateFileW(string name,uint access,uint share,IntPtr security,uint disposition,uint flags,IntPtr template);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetFileInformationByHandle(SafeFileHandle h,out Info info);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern uint GetFileAttributesW(string name);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetFileInformationByHandle(SafeFileHandle h,int kind,IntPtr data,uint size);
 public List<T011Meta> files=new List<T011Meta>();List<SafeFileHandle> dirs=new List<SafeFileHandle>();List<FileStream> streams=new List<FileStream>();string parent;
 static Exception Error(string code,int number){return new Exception(code+":"+number);}
 static Info Stat(SafeFileHandle h){Info i;if(!GetFileInformationByHandle(h,out i))throw Error("HANDLE_INFO",Marshal.GetLastWin32Error());return i;}
 public static bool Exists(string p){uint a=GetFileAttributesW(p);if(a!=0xffffffff)return true;int e=Marshal.GetLastWin32Error();if(e==2||e==3)return false;throw Error("TARGET_UNKNOWN",e);}
 public T011Lease(string[] names){try{if(names.Length<1||names.Length>50)throw Error("FILE_COUNT",0);parent=Path.GetDirectoryName(names[0]);DriveInfo drive=new DriveInfo(Path.GetPathRoot(parent));if(drive.DriveType!=DriveType.Fixed||drive.DriveFormat!="NTFS")throw Error("FIXED_NTFS_REQUIRED",0);foreach(string p in names)if(Path.GetDirectoryName(p)!=parent)throw Error("ONE_PARENT_REQUIRED",0);
  List<string> ancestors=new List<string>();string current=parent;while(current!=null){ancestors.Insert(0,current);DirectoryInfo up=Directory.GetParent(current);current=up==null?null:up.FullName;}if(ancestors.Count>32)throw Error("DEPTH_LIMIT",0);
  foreach(string d in ancestors){SafeFileHandle h=CreateFileW(d,0x80,3,IntPtr.Zero,3,0x02200000,IntPtr.Zero);if(h.IsInvalid){h.Dispose();throw Error("DIRECTORY_OPEN",Marshal.GetLastWin32Error());}dirs.Add(h);Info st=Stat(h);if((st.attributes&0x400)!=0||(st.attributes&0x10)==0)throw Error("DIRECTORY_LINK",0);}
  long total=0;foreach(string p in names){SafeFileHandle h=CreateFileW(p,0x80010080,1,IntPtr.Zero,3,0x00200000,IntPtr.Zero);if(h.IsInvalid){h.Dispose();throw Error("SOURCE_OPEN",Marshal.GetLastWin32Error());}FileStream stream=new FileStream(h,FileAccess.Read,65536,false);streams.Add(stream);Info i=Stat(h);long size=((long)i.sizeHigh<<32)|i.sizeLow;if((i.attributes&0x410)!=0||i.links!=1)throw Error("ORDINARY_SINGLE_LINK_REQUIRED",0);if(size>33554432||(total+=size)>67108864)throw Error("BYTE_BUDGET",0);string sha;using(SHA256 hash=SHA256.Create()){sha=BitConverter.ToString(hash.ComputeHash(stream)).Replace("-","").ToLowerInvariant();}Info after=Stat(h);if(i.indexHigh!=after.indexHigh||i.indexLow!=after.indexLow||i.writeHigh!=after.writeHigh||i.writeLow!=after.writeLow||i.sizeHigh!=after.sizeHigh||i.sizeLow!=after.sizeLow)throw Error("SOURCE_CHANGED",0);files.Add(new T011Meta{path=p,name=Path.GetFileName(p),parent=parent,bytes=size,sha256=sha,identity=i.volume.ToString()+":"+i.indexHigh.ToString()+":"+i.indexLow.ToString(),writeTicks=(((long)i.writeHigh<<32)|i.writeLow).ToString(),creationTicks=(((long)i.creationHigh<<32)|i.creationLow).ToString()});}
 }catch{Dispose();throw;}}
 public int Move(int index,string target){if(index<0||index>=streams.Count||Path.GetDirectoryName(target)!=parent)return 87;if(Exists(target))return 183;byte[] name=Encoding.Unicode.GetBytes(target);int nameOffset=IntPtr.Size==8?20:12,lenOffset=IntPtr.Size==8?16:8;IntPtr memory=Marshal.AllocHGlobal(nameOffset+name.Length+2);try{for(int i=0;i<nameOffset+name.Length+2;i++)Marshal.WriteByte(memory,i,0);Marshal.WriteInt32(memory,lenOffset,name.Length);Marshal.Copy(name,0,IntPtr.Add(memory,nameOffset),name.Length);if(!SetFileInformationByHandle(streams[index].SafeFileHandle,3,memory,(uint)(nameOffset+name.Length+2)))return Marshal.GetLastWin32Error();using(SafeFileHandle check=CreateFileW(target,0x80,7,IntPtr.Zero,3,0x00200000,IntPtr.Zero)){if(check.IsInvalid)return -1;Info checkInfo=Stat(check);string id=checkInfo.volume.ToString()+":"+checkInfo.indexHigh.ToString()+":"+checkInfo.indexLow.ToString();if(id!=files[index].identity)return -1;}return 0;}finally{Marshal.FreeHGlobal(memory);}}
 public void Dispose(){foreach(FileStream f in streams)f.Dispose();streams.Clear();foreach(SafeFileHandle d in dirs)d.Dispose();dirs.Clear();}
}
'@
function Emit($value){[Console]::WriteLine((ConvertTo-Json -InputObject $value -Depth 8 -Compress));[Console]::Out.Flush()}
$lease=$null
try {
 Add-Type -TypeDefinition $code
 $inputLine=[Console]::ReadLine();if($null -eq $inputLine -or $inputLine.Length -gt 65536){throw 'INVALID_INPUT'}
 $p=ConvertFrom-Json -InputObject $inputLine
 $sources=[string[]]@($p.rows | ForEach-Object {$_.source})
 $lease=[T011Lease]::new($sources)
 if($p.mode -eq 'inspect'){Emit @{kind='complete';files=@($lease.files)};return}
 $errors=@();for($i=0;$i -lt $p.rows.Count;$i++){ $row=$p.rows[$i];$actual=$lease.files[$i];if($row.sha256 -ne $actual.sha256 -or $row.identity -ne $actual.identity -or [string]$row.bytes -ne [string]$actual.bytes -or $row.writeTicks -ne $actual.writeTicks -or $row.creationTicks -ne $actual.creationTicks){$errors+=@{index=$i;code='SOURCE_CHANGED'}};if($row.target -ne $row.source -and [T011Lease]::Exists($row.target)){$errors+=@{index=$i;code='TARGET_OCCUPIED'}} }
 if($errors.Count -gt 0){Emit @{kind='blocked';conflicts=$errors};return}
 Emit @{kind='ready'}
 for($i=0;$i -lt $p.rows.Count;$i++){
  $line=[Console]::ReadLine();if($line -ne ('GO '+$i)){Emit @{kind='stopped';index=$i};return}
  $row=$p.rows[$i];if($row.source -eq $row.target){Emit @{kind='unchanged';index=$i};continue}
  $errorCode=$lease.Move($i,$row.target);if($errorCode -ne 0){Emit @{kind='failed';index=$i;win32=$errorCode};return}
  Emit @{kind='moved';index=$i}
 }
 Emit @{kind='complete'}
}catch{Emit @{kind='error';code='WINDOWS_FILE_OPERATION_FAILED'}}finally{if($null -ne $lease){$lease.Dispose()}}
