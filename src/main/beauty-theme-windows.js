'use strict';
const crypto=require('node:crypto');
const { WindowAppearance,windowPlan,windowValues,validRecord } = require('./beauty-window-appearance');
function themeWindowOptions(profile) {
  const rgb=profile.tint.slice(1).match(/../g).map(v=>parseInt(v,16));
  return {dark:rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722<145?'on':'off',corners:'round',material:{mica:'mica',solid:'none',glass:'acrylic',acrylic:'acrylic'}[profile.effect]||'mica'};
}
class ThemeWindows {
  constructor(options) { this.appearance=new WindowAppearance({...options,limit:128});this.seen=new Set();this.timer=null;this.summary=null;this.epoch=0; }
  stop(){this.epoch++;clearTimeout(this.timer);this.timer=null;}
  async apply(profile,{onlyNew=false}={}) {
    const appearance=this.appearance,options=themeWindowOptions(profile),applied=[],skipped=[];
    if(!onlyNew)this.seen.clear();
    const list=await appearance.refresh(),live=new Set();
    const candidates=[...appearance.candidates.values()];
    // Recheck only missing windows, avoiding a helper process per live record on
    // every polling cycle. A reused handle still has to pass the identity check.
    for(const r of appearance.read().records)if(!candidates.some(t=>t.hwnd===r.target?.hwnd&&t.pid===r.target?.pid&&t.started===r.target?.started)){
      try{if(await appearance.native.alive(r.target))await appearance.restore(r.id);else await appearance.forgetClosed(r.id);}catch{}
    }
    if(appearance.native.batch)return appearance.serial(()=>this.applyBatch(list,options,onlyNew));
    for(const target of list.candidates){
      live.add(target.id);if(onlyNew&&this.seen.has(target.id))continue;
      this.seen.add(target.id);
      try{
        let requested=options;
        try{await appearance.apply(target.id,requested);}catch(error){
          if(error.code!=='ATTRIBUTE_READ')throw error;
          requested={...options,material:'keep'};await appearance.apply(target.id,requested);
        }
        applied.push({title:target.title,processName:target.processName,options:requested});
      }
      catch(error){skipped.push({title:target.title,error:error.message});}
    }
    this.seen=new Set([...this.seen].filter(id=>live.has(id)));
    return this.summary={options,applied,skipped,tracked:appearance.list().records.length};
  }
  async applyBatch(list,options,onlyNew){
    const a=this.appearance,data=a.read(),plan=windowPlan(options),requests=[],applied=[],skipped=[],limited=[],live=new Set(list.candidates.map(t=>t.id));
    if(new Set(data.records.map(r=>r.id)).size!==data.records.length)throw Error('窗口恢复ID重复，已保留备份并停止');
    const skip=(target,error)=>skipped.push({title:target.title,error});
    for(const c of list.candidates){if(onlyNew&&this.seen.has(c.id))continue;this.seen.add(c.id);const target=a.candidates.get(c.id);
      if(target.processName.toLowerCase()==='translucenttb')continue;
      try{let record=data.records.find(r=>r.target?.hwnd===target.hwnd&&r.target?.pid===target.pid&&r.target?.started===target.started);if(record){record=validRecord(record);if(record.phase!=='applied')throw Error('请先恢复该窗口未完成的更改');}
        if(requests.length>=128)throw Error('本次窗口数量超过128');requests.push({id:c.id,target,attributes:Object.keys(plan),marker:record?.marker,record});
      }catch(error){skip(target,error.message);}
    }
    if(!requests.length){this.seen=new Set([...this.seen].filter(id=>live.has(id)));return this.summary={options,applied,skipped,limited,tracked:data.records.length};}
    const captured=await a.native.batch('capture-many',requests),actions=[],targets=new Map(requests.map(r=>[r.id,r]));
    if(!Array.isArray(captured)||captured.length!==requests.length||new Set(captured.map(r=>r.id)).size!==captured.length)throw Error('窗口批量备份回执无效');
    for(const result of captured){const request=targets.get(result.id);if(!request)throw Error('窗口备份回执目标无效');const {target}=request;
      try{if(!result.ok)throw Error(result.error||'无法备份窗口');if(!request.record&&result.data.marker)throw Error('该窗口已有独立外观标记，已保留');
        const snapshot=windowValues(result.data.values),values=Object.fromEntries(Object.keys(snapshot).filter(k=>Object.hasOwn(plan,k)).map(k=>[k,plan[k]]));if(!Object.keys(values).length)throw Error('窗口不支持所选属性');
        let record=request.record;if(!record){if(data.records.length>=128)throw Error('已达到128个窗口恢复记录');record={id:crypto.randomUUID(),target,marker:crypto.randomInt(1,0x7fffffff),at:new Date().toISOString(),values:{}};data.records.push(record);}else data.records=data.records.map(r=>r.id===record.id?record:r);
        for(const key of Object.keys(values))if(!Object.hasOwn(record.values,key))record.values[key]=snapshot[key];
        record.phase='pending';actions.push({id:record.id,target,values,marker:record.marker,bind:!request.record});
        if(result.data.unsupported?.length)limited.push({title:target.title,attributes:result.data.unsupported});
      }catch(error){skip(target,error.message);}
    }
    if(actions.length){a.write(data);const changed=await a.native.batch('apply-many',actions),byId=new Map(actions.map(r=>[r.id,r]));
      if(!Array.isArray(changed)||changed.length!==actions.length||new Set(changed.map(r=>r.id)).size!==changed.length)throw Error('窗口应用回执无效');
      for(const result of changed){const request=byId.get(result.id);if(!request)throw Error('窗口应用回执目标无效');if(result.ok){data.records.find(r=>r.id===result.id).phase='applied';applied.push({title:request.target.title,processName:request.target.processName,values:request.values});}else{if(request.bind&&result.bound===false)data.records=data.records.filter(r=>r.id!==result.id);skip(request.target,result.error||'窗口未完整应用');}}a.write(data);
    }
    this.seen=new Set([...this.seen].filter(id=>live.has(id)));return this.summary={options,applied,skipped,limited,tracked:data.records.length};
  }
  watch(profile,enqueue){
    this.stop();
    const epoch=this.epoch;
    const tick=()=>{this.timer=setTimeout(()=>{enqueue(()=>this.epoch===epoch?this.apply(profile,{onlyNew:true}):undefined).catch(()=>{}).finally(()=>{if(this.epoch===epoch&&this.timer)tick();});},15000);this.timer.unref?.();};tick();
  }
  async restore(){this.stop();if(this.appearance.native.batch)return this.appearance.serial(()=>this.restoreBatch());const result=await this.appearance.restoreAll();const failed=[];
    for(const item of result.restoreSummary.failed){try{await this.appearance.forgetClosed(item.id);}catch{failed.push(item);}}
    this.seen.clear();return {attempted:result.restoreSummary.attempted,restored:result.restoreSummary.restored.length,failed,remaining:this.appearance.list().records.length};
  }
  async restoreBatch(){const a=this.appearance,data=a.read(),failed=[],restored=[],requests=[];
    const ids=new Set();for(const r of data.records){try{const value=validRecord(r);if(ids.has(value.id))throw Error('窗口恢复ID重复');ids.add(value.id);requests.push(value);}catch(error){failed.push({id:r.id,error:error.message});}}
    if(failed.length)return {attempted:data.records.length,restored:0,failed,remaining:data.records.length};
    if(!requests.length)return {attempted:0,restored:0,failed:[],remaining:0};
    const results=await a.native.batch('restore-many',requests),byId=new Map(requests.map(r=>[r.id,r])),clear=[];
    if(!Array.isArray(results)||results.length!==requests.length||new Set(results.map(r=>r.id)).size!==results.length)throw Error('窗口恢复回执无效');
    for(const result of results){const r=byId.get(result.id);if(!r)throw Error('窗口恢复目标无效');if(result.ok){data.records.find(x=>x.id===r.id).phase='restored';clear.push(r);}else if(['WINDOW_GONE','WINDOW_IDENTITY'].includes(result.code)){data.records=data.records.filter(x=>x.id!==r.id);restored.push(r.id);}else failed.push({id:r.id,error:result.error||'窗口恢复失败'});}
    a.write(data);
    if(clear.length){const cleared=await a.native.batch('clear-marker-many',clear);if(!Array.isArray(cleared)||cleared.length!==clear.length||new Set(cleared.map(r=>r.id)).size!==cleared.length)throw Error('窗口清理回执无效');for(const result of cleared){if(!clear.some(r=>r.id===result.id))throw Error('窗口清理目标无效');if(result.ok||['WINDOW_GONE','WINDOW_IDENTITY'].includes(result.code)){data.records=data.records.filter(x=>x.id!==result.id);restored.push(result.id);}else failed.push({id:result.id,error:result.error||'窗口标记清理失败'});}a.write(data);}
    this.seen.clear();return {attempted:requests.length,restored:restored.length,failed,remaining:data.records.length};
  }
  list(){return {...this.appearance.list(),followingNewWindows:!!this.timer,summary:this.summary};}
}
module.exports={ThemeWindows,themeWindowOptions};
