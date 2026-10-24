const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {ThemeWindows,themeWindowOptions}=require('../src/main/beauty-theme-windows');
test('whole-theme windows follow new windows, retain the first baseline, skip manually owned windows and restore only their own changes',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'beauty-theme-windows-'));t.after(()=>{assert.equal(path.dirname(root),os.tmpdir());fs.rmSync(root,{recursive:true,force:true});});
 const target=n=>({hwnd:String(n),pid:123,started:'987654321',className:'TestWindow',processName:'test',title:'window '+n});
 let windows=[target(101),target(102)],captured=0;const original={20:0,33:0,38:1},state=new Map(windows.map(w=>[w.hwnd,{values:{...original},marker:w.hwnd==='102'?777:0}]));
 const service=new ThemeWindows({root,platform:'win32',release:'10.0.26100'});service.appearance.native={enumerate:async()=>windows,capture:async(target,attributes,marker)=>{captured++;const s=state.get(target.hwnd);if(marker&&s.marker!==marker)throw Error('marker mismatch');return {values:Object.fromEntries(attributes.map(k=>[k,s.values[k]])),marker:s.marker};},apply:async(target,values,marker,bind)=>{const s=state.get(target.hwnd);if(bind&&s.marker)throw Error('already manually owned');s.marker=marker;Object.assign(s.values,values);},restore:async(target,values,marker)=>{const s=state.get(target.hwnd);assert.equal(s.marker,marker);Object.assign(s.values,values);},clearMarker:async(target,marker)=>{assert.equal(state.get(target.hwnd).marker,marker);state.get(target.hwnd).marker=0;},alive:async t=>windows.some(x=>x.hwnd===t.hwnd)};
 const profile={tint:'#192439',effect:'acrylic'};const first=await service.apply(profile);assert.equal(first.applied.length,1);assert.equal(first.skipped.length,1);assert.equal(state.get('101').values[38],3);
 // A foreign/manual marker is rejected before creating any recovery record.
 assert.equal(service.appearance.read().records.length,1);
 assert.equal(state.get('102').marker,777);
 const before=captured;windows.push(target(103));state.set('103',{values:{...original},marker:0});const next=await service.apply(profile,{onlyNew:true});assert.equal(next.applied.length,1);assert.equal(captured-before,1);
 windows=windows.filter(t=>t.hwnd!=='102');const restored=await service.restore();assert.equal(restored.failed.length,0);assert.deepEqual(state.get('101').values,original);assert.deepEqual(state.get('103').values,original);assert.equal(state.get('102').marker,777);
});
test('window material and title-bar mode follow the actual profile',()=>{assert.deepEqual(themeWindowOptions({tint:'#fefefe',effect:'mica'}),{dark:'off',corners:'round',material:'mica'});assert.equal(themeWindowOptions({tint:'#111111',effect:'solid'}).material,'none');});
test('batched themes back up more than 32 windows before mutations and retry partial apply/marker cleanup safely',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'beauty-window-batch-'));t.after(()=>{assert.equal(path.dirname(root),os.tmpdir());fs.rmSync(root,{recursive:true,force:true});});
 const target=n=>({hwnd:String(n),pid:12,started:'123',className:'Window',processName:'app',title:'Window '+n});
 let windows=Array.from({length:48},(_,i)=>target(i+1)),clearFailure=true,restoreWrites=0;
 const states=new Map(windows.map(w=>[w.hwnd,{values:{20:0,33:0,38:1},marker:w.hwnd==='48'?99:0}]));
 const service=new ThemeWindows({root,platform:'win32',release:'10.0.26100'});
 service.appearance.native={enumerate:async()=>windows,alive:async t=>states.has(t.hwnd),batch:async(op,items)=>{
  if(op==='apply-many'){const onDisk=service.appearance.read();for(const item of items)assert.equal(onDisk.records.find(r=>r.id===item.id)?.phase,'pending');}
  return items.map(item=>{const s=states.get(item.target.hwnd);if(op==='capture-many')return {id:item.id,ok:true,data:{values:item.target.hwnd==='47'?{20:s.values[20],33:s.values[33]}:{...s.values},unsupported:item.target.hwnd==='47'?['38']:[],marker:s.marker}};
   if(op==='apply-many'){if(item.bind){assert.equal(s.marker,0);s.marker=item.marker;}else assert.equal(s.marker,item.marker);Object.assign(s.values,item.values);if(item.target.hwnd==='46')return {id:item.id,ok:false,error:'partial native write'};return {id:item.id,ok:true};}
   if(op==='restore-many'){if(item.phase!=='restored'){assert.equal(s.marker,item.marker);Object.assign(s.values,item.values);restoreWrites++;}return {id:item.id,ok:true};}
   if(op==='clear-marker-many'){if(clearFailure&&item.target.hwnd==='1')return {id:item.id,ok:false,error:'clear failed'};assert.equal(s.marker,item.marker);s.marker=0;return {id:item.id,ok:true};}
   throw Error('unexpected batch operation');});
 }};
 const first=await service.apply({tint:'#112233',effect:'mica'});assert.equal(first.applied.length,46);assert.equal(first.skipped.length,2);assert.equal(first.limited.length,1);assert.equal(service.appearance.read().records.length,47);assert.equal(states.get('48').marker,99);
 windows.push(target(49));states.set('49',{values:{20:0,33:0,38:1},marker:0});const later=await service.apply({tint:'#112233',effect:'mica'},{onlyNew:true});assert.equal(later.applied.length,1);
 const result=await service.restore();assert.equal(result.failed.length,1);assert.equal(result.remaining,1);assert.equal(service.appearance.read().records[0].phase,'restored');const writes=restoreWrites;
 clearFailure=false;const retry=await service.restore();assert.equal(retry.failed.length,0);assert.equal(retry.remaining,0);assert.equal(restoreWrites,writes);for(const [id,s]of states)if(id!=='48'){assert.deepEqual(s.values,{20:0,33:0,38:1});assert.equal(s.marker,0);}
});
