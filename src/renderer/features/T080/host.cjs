'use strict';
const FIELDS=['vendorString','deviceString','driverVendor','driverVersion','driverDate'];
const FEATURES=['2d_canvas','gpu_compositing','rasterization','video_decode','video_encode','webgl','webgl2','webgpu'];
const text=v=>typeof v==='string'&&v.length>0&&Buffer.byteLength(v,'utf8')<=2048&&!/[\u0000-\u001f\u007f\ud800-\udfff]/u.test(v)?v:null;
function normalizeInfo(info){
 if(!info||typeof info!=='object'||!Array.isArray(info.gpuDevice)||info.gpuDevice.length>32)throw Error('invalid_gpu_info');
 const devices=info.gpuDevice.map((d,index)=>{if(!d||typeof d!=='object')throw Error('invalid_gpu_device');const fields={};for(const key of FIELDS)fields[key]={value:text(d[key]),source:`Electron app.getGPUInfo(complete).gpuDevice[${index}].${key}`};for(const key of ['vendorId','deviceId'])fields[key]={value:Number.isInteger(d[key])&&d[key]>=0&&d[key]<=0xffffffff?d[key]:null,source:`Electron app.getGPUInfo(complete).gpuDevice[${index}].${key}`};return{index,active:typeof d.active==='boolean'?d.active:null,fields,dedicatedVramBytes:null,vramReason:'public_gpu_device_fields_do_not_supply_verified_dedicated_vram_bytes'};});
 const aux={};for(const key of ['glVendor','glRenderer','glVersion'])aux[key]={value:text(info.auxAttributes?.[key]),source:`Electron app.getGPUInfo(complete).auxAttributes.${key}`};
 return{state:'observed',devices,aux,source:'Electron app.getGPUInfo(complete)',scope:'当前Electron/Chromium所报告的适配器，不是系统全部设备清单；没有从系统内存、共享内存或型号猜测显存。'};
}
function createHost({getApp=()=>require('electron').app,platform=process.platform,versions=process.versions,timeoutMs=5000,statusWaitMs=1000}={}){
 const jobs=new Map();let pendingRead=null;
 function stop(job,reason){if(!job||job.stopped)return;job.stopped=true;job.abort(reason);}
 return{
 async invoke(operation,payload,{senderId}={}){
  if(operation!=='collect'||!payload||Object.keys(payload).length!==1||typeof payload.jobId!=='string'||!/^[-A-Za-z0-9_]{1,64}$/.test(payload.jobId)||!Number.isInteger(senderId)||senderId<=0)throw Error('invalid_gpu_request');
  if(jobs.has(senderId)||jobs.size>=32)throw Error('gpu_job_limit');
  const application=getApp();let finishAbort;const aborted=new Promise(resolve=>{finishAbort=resolve;});const job={id:payload.jobId,stopped:false,abort:finishAbort};jobs.set(senderId,job);
  let seen=false,resolveEvent;const observed=new Promise(resolve=>{resolveEvent=resolve;});const event=()=>{seen=true;resolveEvent();};let totalTimer,statusTimer;
  try{
   application.on('gpu-info-update',event);
   const deadline=new Promise(resolve=>{totalTimer=setTimeout(()=>resolve({kind:'timeout'}),timeoutMs);});
   const collection=Promise.resolve().then(()=>{if(job.stopped)return{kind:'canceled'};if(pendingRead)return{kind:'busy'};const token={};pendingRead=token;return Promise.resolve().then(()=>application.getGPUInfo('complete')).then(info=>({kind:'info',info}),()=>({kind:'failed'})).finally(()=>{if(pendingRead===token)pendingRead=null;});});
   const outcome=await Promise.race([collection,deadline,aborted.then(()=>({kind:'canceled'}))]);
   if(outcome.kind==='canceled'||job.stopped)return{ok:false,canceled:true};
   let gpu={state:'unknown',devices:[],aux:{},reason:outcome.kind==='timeout'?'gpu_info_timeout':outcome.kind==='busy'?'prior_underlying_gpu_query_still_pending':'gpu_info_failed'};
   if(outcome.kind==='info')try{gpu=normalizeInfo(outcome.info);}catch{gpu.reason='invalid_or_oversized_gpu_info';}
   if(outcome.kind==='info'&&!seen)await Promise.race([observed,deadline,aborted,new Promise(resolve=>{statusTimer=setTimeout(resolve,statusWaitMs);})]);
   if(job.stopped)return{ok:false,canceled:true};
   let featureStatus={state:'unknown',values:{},source:'Electron app.getGPUFeatureStatus',reason:'gpu_info_update_not_observed_during_this_collection'};
   if(seen)try{const raw=application.getGPUFeatureStatus(),values={};for(const key of FEATURES)values[key]=text(raw?.[key]);featureStatus={state:'observed',values,source:'Electron app.getGPUFeatureStatus after observed gpu-info-update',reason:null};}catch{featureStatus.reason='gpu_feature_status_failed';}
   let hardwareAccelerationEnabled=null,hardwareAccelerationReason='api_unavailable_or_failed';try{const v=application.isHardwareAccelerationEnabled();if(typeof v==='boolean'){hardwareAccelerationEnabled=v;hardwareAccelerationReason=null;}else hardwareAccelerationReason='invalid_return_type';}catch{}
   return{ok:true,schemaVersion:1,collectedAt:new Date().toISOString(),platform,runtime:{electron:versions.electron||null,chrome:versions.chrome||null,node:versions.node||null},gpu,featureStatus,hardwareAccelerationEnabled,hardwareAccelerationReason,hardwareAccelerationSource:'Electron app.isHardwareAccelerationEnabled',driverInstalled:false,taskExecuted:false,taskCompatibility:'unknown_not_tested'};
  }finally{clearTimeout(totalTimer);clearTimeout(statusTimer);application.removeListener('gpu-info-update',event);if(jobs.get(senderId)===job)jobs.delete(senderId);}
 },
 cancel(jobId,{senderId}={}){const job=jobs.get(senderId);if(!job||job.id!==jobId)return{ok:true,canceled:false};stop(job,'user_cancel');return{ok:true,canceled:true};},
 disposeSender(senderId){stop(jobs.get(senderId),'sender_destroyed');}
 };
}
module.exports={...createHost(),createHost,normalizeInfo,FEATURES};
