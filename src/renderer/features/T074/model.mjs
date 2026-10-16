export const LIMITS=Object.freeze({rows:128,stdoutBytes:262144,stderrBytes:8192,queryMs:12000,reportBytes:1048576});
export function input(p){if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).join('|')!=='port'||!Number.isInteger(p.port)||p.port<1||p.port>65535)throw Error('端口须1–65535整数，不支持范围或扫描。');return{port:p.port};}
export function script(port){input({port});return String.raw`$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$PSModuleAutoLoadingPreference='None'
Import-Module -Name ($PSHOME+'\Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1') -ErrorAction Stop
Import-Module -Name ($PSHOME+'\Modules\CimCmdlets\CimCmdlets.psd1') -ErrorAction Stop
Import-Module -Name ($PSHOME+'\Modules\NetTCPIP\NetTCPIP.psd1') -ErrorAction Stop
[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)
$taskPort=${port}
$taskStarted=[DateTime]::UtcNow.ToString('o')
$taskProtocols=@()
$taskRows=@()
$taskCapacity=$false
foreach($taskProtocol in @('TCP','UDP')) {
  try {
    if($taskProtocol -eq 'TCP') {$taskEndpoints=@(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object {$_.LocalPort -eq $taskPort})} else {$taskEndpoints=@(Get-NetUDPEndpoint -ErrorAction Stop | Where-Object {$_.LocalPort -eq $taskPort})}
    if($taskEndpoints.Count -gt 128) {$taskCapacity=$true;throw 'capacity'}
    $taskProtocols+=@{protocol=$taskProtocol;status='observed';count=$taskEndpoints.Count}
    foreach($taskEndpoint in $taskEndpoints) {
      $taskOwnerId=[long]$taskEndpoint.OwningProcess
      $taskName=$null;$taskPath=$null;$taskCreated=$null;$taskProcessStatus='unknown'
      try {
        $taskProcess=Get-CimInstance -ClassName Win32_Process -Filter ('ProcessId = '+$taskOwnerId) -ErrorAction Stop
        if($null -eq $taskProcess) {$taskProcessStatus='not_observed'} else {
          $taskName=[string]$taskProcess.Name
          if(-not [string]::IsNullOrEmpty([string]$taskProcess.ExecutablePath)) {$taskPath=[string]$taskProcess.ExecutablePath}
          if($null -ne $taskProcess.CreationDate) {$taskCreated=$taskProcess.CreationDate.ToUniversalTime().ToString('o')}
          $taskProcessStatus=if($null -eq $taskPath){'path_not_visible'}else{'observed'}
        }
      } catch {$taskProcessStatus='query_failed'}
      $taskRows+=@{protocol=$taskProtocol;address=[string]$taskEndpoint.LocalAddress;port=[int]$taskEndpoint.LocalPort;pid=$taskOwnerId;name=$taskName;path=$taskPath;createdAtUTC=$taskCreated;processStatus=$taskProcessStatus}
    }
  } catch {
    $taskProtocols+=@{protocol=$taskProtocol;status='query_failed';count=$null}
  }
}
if($taskCapacity -or $taskRows.Count -gt 128) {Write-Output '{"schema":1,"capacityExceeded":true}';exit 0}
@{schema=1;port=$taskPort;startedAtUTC=$taskStarted;completedAtUTC=[DateTime]::UtcNow.ToString('o');protocols=@($taskProtocols);rows=@($taskRows)} | ConvertTo-Json -Depth 6 -Compress
`;}
const keys=(p,wanted)=>p&&typeof p==='object'&&!Array.isArray(p)&&Object.keys(p).sort().join('|')===[...wanted].sort().join('|');
function value(v,max){if(v===null)return null;if(typeof v!=='string'||!v||v.length>max||/[\x00-\x1f\x7f]/.test(v))throw Error('系统元数据字段无效。');return v;}
function date(v){if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T/.test(v)||!Number.isFinite(Date.parse(v)))throw Error('系统观察时间无效。');return v;}
export function observation(raw,port){input({port});if(raw?.capacityExceeded===true)throw Error('完整端口归属超过128项，不截断。');if(!keys(raw,['schema','port','startedAtUTC','completedAtUTC','protocols','rows'])||raw.schema!==1||raw.port!==port||!Array.isArray(raw.rows)||raw.rows.length>128||!Array.isArray(raw.protocols)||raw.protocols.length!==2)throw Error('系统归属输出结构无效。');date(raw.startedAtUTC);date(raw.completedAtUTC);const protocols=new Set();for(const p of raw.protocols){if(!keys(p,['protocol','status','count'])||!['TCP','UDP'].includes(p.protocol)||protocols.has(p.protocol)||!['observed','query_failed'].includes(p.status)||(p.status==='observed'?(!Number.isInteger(p.count)||p.count<0||p.count>128):p.count!==null))throw Error('协议观察状态无效。');protocols.add(p.protocol);}
 const rows=raw.rows.map(r=>{if(!keys(r,['protocol','address','port','pid','name','path','createdAtUTC','processStatus'])||!protocols.has(r.protocol)||raw.protocols.find(p=>p.protocol===r.protocol).status!=='observed'||r.port!==port||!Number.isInteger(r.pid)||r.pid<0||r.pid>4294967295||!['observed','path_not_visible','not_observed','query_failed','unknown'].includes(r.processStatus))throw Error('端口行字段无效。');value(r.address,80);if(!/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(r.address)&&!r.address.includes(':'))throw Error('监听地址无效。');if(r.address.includes(':')&&!/^[0-9a-fA-F:.%a-zA-Z0-9_-]+$/.test(r.address))throw Error('监听地址无效。');value(r.name,260);value(r.path,4096);if(r.path!==null&&!/^[A-Za-z]:[\\/]/.test(r.path))throw Error('进程路径不是观察到的Windows绝对路径。');if(r.createdAtUTC!==null)date(r.createdAtUTC);if(r.processStatus==='observed'&&(r.path===null||r.name===null))throw Error('已观察进程缺字段。');if(r.processStatus==='path_not_visible'&&r.path!==null)throw Error('未知路径不应包含路径。');return{...r,addressScope:r.address==='0.0.0.0'||r.address==='::'?'wildcard':r.address==='127.0.0.1'||r.address==='::1'?'loopback':'specific_address',endpointKind:r.protocol==='TCP'?'listen':'bound_udp',pathKnown:r.path!==null,uncertainty:r.processStatus==='observed'?'非原子快照，PID可能退出/复用，路径不证明软件身份。':r.processStatus==='path_not_visible'?'路径不可见，权限/保护/其它原因未区分，不自动提权。':'进程未观察或查询失败，退出/权限/其它原因未知。'};});for(const p of raw.protocols)if(p.status==='observed'&&rows.filter(r=>r.protocol===p.protocol).length!==p.count)throw Error('协议行数与完整报告不一致。');return{...raw,rows};}
export function reportText(r,extension){if(r?.format!=='T074-port-owner-report'||r.version!==1||!Array.isArray(r.rows))throw Error('尚无完整端口报告。');const json=JSON.stringify(r,null,2),safe=v=>String(v??'未知').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('|','\\|').replace(/[\r\n]/g,' ');let out;if(extension==='json')out=json+'\n';else if(extension==='md')out='# T074 端口占用归属观察\n\n'+r.scope+'\n\n|协议|地址|端口|PID|名称|路径|状态|\n|---|---|---:|---:|---|---|---|\n'+r.rows.map(v=>'| '+[v.protocol,v.address,v.port,v.pid,v.name,v.path,v.processStatus].map(safe).join(' | ')+' |').join('\n')+'\n\n## 完整观察与未知\n\n```json\n'+json.replaceAll('`','\\u0060')+'\n```\n';else throw Error('仅支持JSON/Markdown。');if(new TextEncoder().encode(out).length>LIMITS.reportBytes)throw Error('完整报告超过1MiB，不截断。');return out;}
