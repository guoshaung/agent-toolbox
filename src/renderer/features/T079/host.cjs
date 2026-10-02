'use strict';
const states=new Set(['not-determined','granted','denied','restricted','unknown']);
function settingsFor(platform,type){if(platform==='win32')return{path:`Windows 设置 → 隐私与安全性 → ${type==='camera'?'摄像头':'麦克风'}`,uri:type==='camera'?'ms-settings:privacy-webcam':'ms-settings:privacy-microphone',opened:false};if(platform==='darwin')return{path:`System Settings → Privacy & Security → ${type==='camera'?'Camera':'Microphone'}`,uri:null,opened:false};return{path:'查询当前桌面环境/应用沙箱的媒体设备权限；Linux无统一设置入口。',uri:null,opened:false};}
function readStatus(type,{platform=process.platform,getStatus=media=>require('electron').systemPreferences.getMediaAccessStatus(media)}={}){
 if(!['camera','microphone'].includes(type))throw Error('只支持camera/microphone。');let state='unknown',reason=null,rawState=null;
 if(!['win32','darwin'].includes(platform))reason='platform_api_unsupported';else try{const raw=getStatus(type);if(typeof raw==='string'&&states.has(raw)){state=raw;rawState=raw;if(raw==='unknown')reason='platform_reported_unknown';}else reason='unsupported_return_state';}catch{reason='platform_api_unavailable_or_failed';}
 return{platform,deviceType:type,systemPermission:{state,rawState,reason,source:'Electron systemPreferences.getMediaAccessStatus（只读）'},settings:settingsFor(platform,type),captureStarted:false,permissionRequested:false,scope:'系统状态只描述公开权限API，不证明设备存在、可采集或未被占用；没有打开系统设置。'};
}
function createHost(options={}){return{invoke(operation,payload){if(operation!=='read_status'||!payload||typeof payload!=='object'||Array.isArray(payload)||Object.keys(payload).length!==1||!Object.hasOwn(payload,'deviceType'))throw Error('请求只接受read_status和deviceType。');return{ok:true,...readStatus(payload.deviceType,options)};},cancel(){return{ok:true,canceled:false,reason:'synchronous_read_only_status_has_no_capture_job'};},disposeSender(){}};}
module.exports={...createHost(),createHost,readStatus,settingsFor};
