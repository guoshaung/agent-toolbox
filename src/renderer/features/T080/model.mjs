export const TARGETS=['AI推理','视频处理','3D与浏览器图形'];
export const FEATURES=['none','webgl','webgl2','webgpu','video_decode','video_encode'];
const accelerated=new Set(['enabled','enabled_on','enabled_force','enabled_force_on','enabled_readback']);
const unavailable=new Set(['disabled_software','disabled_off','disabled_off_ok','unavailable_software','unavailable_off','unavailable_off_ok']);
export function validateRequirements({task,minVramGiB,exactDriver,feature}){
 if(!TARGETS.includes(task)||!FEATURES.includes(feature))throw Error('任务或Chromium检查项无效。');
 if(typeof minVramGiB!=='string'||(minVramGiB!==''&&!/^(?:0|[1-9]\d{0,2})(?:\.\d{1,3})?$/.test(minVramGiB)))throw Error('最低显存须为空或0–256 GiB，最多三位小数。');
 const memory=minVramGiB===''?null:Number(minVramGiB);if(memory!==null&&memory>256)throw Error('最低显存超过256 GiB。');
 if(typeof exactDriver!=='string'||new TextEncoder().encode(exactDriver).length>512||/[\u0000-\u001f\u007f\ud800-\udfff]/u.test(exactDriver))throw Error('驱动精确版本最多512字节且不能含控制字符。');
 return{task,minVramGiB:memory,exactDriver,feature};
}
export function buildReport(snapshot,requirements){
 const input=validateRequirements(requirements);if(snapshot?.ok!==true||snapshot.schemaVersion!==1||!['unknown','observed'].includes(snapshot.gpu?.state)||!Array.isArray(snapshot.gpu.devices))throw Error('未取得有效GPU快照。');
 const checks=[];
 if(input.minVramGiB!==null)checks.push({item:'最低专用显存',requestedGiB:input.minVramGiB,state:'unknown',reason:'没有公开API提供已核验且单位明确的专用显存字节数；需用系统工具和目标软件另行核对。'});
 if(input.exactDriver!=='')for(const d of snapshot.gpu.devices){const value=d.fields?.driverVersion?.value??null;checks.push({item:'精确驱动版本',adapterIndex:d.index,requested:input.exactDriver,actual:value,state:value===null?'unknown':value===input.exactDriver?'matched':'different',source:d.fields?.driverVersion?.source??null,reason:'按原始字符串精确比较，不跨厂商或平台推断版本新旧。'});}
 if(input.exactDriver!==''&&snapshot.gpu.devices.length===0)checks.push({item:'精确驱动版本',state:'unknown',reason:'没有可读取的适配器条目。'});
 if(input.feature!=='none'){const value=snapshot.featureStatus?.state==='observed'?snapshot.featureStatus.values?.[input.feature]??null:null;checks.push({item:'Chromium加速状态',feature:input.feature,actual:value,state:accelerated.has(value)?'chromium_reports_accelerated':unavailable.has(value)?'chromium_reports_not_hardware_accelerated':'unknown',reason:'只描述当前Chromium功能，不能证明目标软件、CUDA/ROCm/编解码器或模型可运行。'});}
 return{...snapshot,requirements:input,checks,taskCompatibility:'unknown_not_tested',pending:['目标软件支持的GPU/后端/驱动范围需另查。','专用显存容量、空闲量及模型/视频的实际资源需求需另查。','所需CUDA/ROCm/运行时或编解码器、分辨率/格式及实际执行均未验证。'],reportScope:'只读API采集，没有运行基准、目标任务、shell命令、驱动安装、联网或修改加速开关。'};
}
export function serializeReport(report,kind){const body=JSON.stringify(report,null,2);if(kind==='json')return body;if(kind!=='md')throw Error('无效格式。');return'# GPU本地能力报告\n\n任务运行能力仍未知；以下保留原始值与采集来源。\n\n'+('`'.repeat(10))+'json\n'+body.replaceAll('`','\\u0060')+'\n'+('`'.repeat(10))+'\n';}
