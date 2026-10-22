const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {ShellAssets,ShellStyleBridge,values,cur,ico}=require('../src/main/beauty-shell-assets');
const {SystemBeauty,normalizeProfile}=require('../src/main/system-beauty');
const sharp=require('sharp');
function root(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'beauty-shell-test-'));t.after(()=>{assert.equal(path.dirname(dir),os.tmpdir());fs.rmSync(dir,{recursive:true,force:true});});return dir;}
test('theme icons and animated cursors decode and are accepted by the real Windows loader without applying',async t=>{
 const dir=root(t),beauty=new SystemBeauty({root:path.join(dir,'beauty')}),service=new ShellAssets({root:path.join(dir,'shell')});
 const p=normalizeProfile({id:'test',name:'Test',tint:'#192438',accent:'#8fb4ff'}),prepared=await service.prepare(beauty,p,{icons:true,cursors:true,shellColors:true});
 assert.equal(Object.keys(prepared.plan).length,26);assert.equal(prepared.generatedIcons.length,6);
 const png=await require('../src/main/beauty-icons').decodeIcon(fs.readFileSync(prepared.plan['icon.computer'].value.slice(0,-2)));assert.equal((await sharp(png).metadata()).width,256);
 const cursor=fs.readFileSync(prepared.plan['cursor.Arrow'].value);assert.equal((await sharp(await require('../src/main/beauty-icons').decodeIcon(cursor)).metadata()).width,48);
 const animation=fs.readFileSync(prepared.plan['cursor.Wait'].value);assert.equal(animation.toString('ascii',0,4),'RIFF');assert.equal(animation.toString('ascii',8,12),'ACON');
 if(process.platform==='win32'){const result=await new ShellStyleBridge().run('validate',{values:prepared.plan});assert.equal(result.valid,true);assert.equal(result.fields,26);}
 assert.equal(service.read(),null);assert.equal(beauty.read().recovery,null);
});
test('shell changes preserve first string/expand-string/absent/DWORD baselines across switches and retries',async t=>{
 const dir=root(t),before={'cursor.Arrow':{exists:true,kind:'ExpandString',value:'%SystemRoot%\\cursors\\aero_arrow.cur'},'icon.computer':{exists:false},'accent.dwm':{exists:true,kind:'DWord',value:4294967295}};let state=structuredClone(before),fail=false;
 const native={read:async()=>structuredClone(state),set:async p=>{Object.assign(state,p);if(fail)throw Error('native failed');}};
 const service=new ShellAssets({root:dir,native}),first={plan:{'cursor.Arrow':{exists:true,kind:'String',value:'D:/one.cur'},'icon.computer':{exists:true,kind:'String',value:'D:/one.ico,0'}}};
 await service.apply(first);await service.apply({plan:{'cursor.Arrow':{exists:true,kind:'String',value:'D:/two.cur'},'accent.dwm':{exists:true,kind:'DWord',value:0xff223344}}});
 assert.deepEqual(service.read().values,before);fail=true;await assert.rejects(service.restore(),/native failed/);assert.deepEqual(service.read().values,before);
 fail=false;await service.restore();assert.deepEqual(state,before);assert.equal(service.read(),null);
 fail=true;await assert.rejects(service.apply(first),/native failed/);assert.ok(service.list().recoveryAvailable);
});
test('shell backups reject arbitrary registry fields, unknown original types and malformed values',()=>{
 for(const v of [{'font.FontFamily':{exists:false}},{'cursor.Arrow':{exists:true,kind:'Binary',value:'bad'}},{'accent.dwm':{exists:true,kind:'DWord',value:-1}},{'icon.computer':{exists:true,kind:'String',value:'a\0b'}}])assert.throws(()=>values(v));
});
test('portrait palettes ignore transparent pixels and produce distinct matching colors without changing the source',async t=>{
 const dir=root(t),{portraitPalette}=require('../src/main/beauty-palette'),file=path.join(dir,'portrait.png');
 const png=await sharp({create:{width:16,height:16,channels:4,background:'#00aabb'}}).png().toBuffer();fs.writeFileSync(file,png);const result=await portraitPalette(file);assert.match(result.accent,/^#[0-9a-f]{6}$/);assert.match(result.tint,/^#[0-9a-f]{6}$/);assert.notEqual(result.accent,result.tint);assert.deepEqual(fs.readFileSync(file),png);
 fs.writeFileSync(file,await sharp({create:{width:16,height:16,channels:4,background:'#ff000000'}}).png().toBuffer());assert.equal(await portraitPalette(file),null);
});
test('custom icon assignments travel inside portable themes and protect referenced assets',async t=>{
 const dir=root(t),beauty=new SystemBeauty({root:dir}),d=beauty.read(),asset=await beauty.storeAsset(await sharp({create:{width:16,height:16,channels:4,background:'#ff2233'}}).png().toBuffer(),{name:'Icon',kind:'icon'},d);beauty.write(d);
 const p=normalizeProfile({id:'icons-a',name:'Icons',iconAssets:{computer:asset.id,folder:asset.id}});await beauty.saveProfile(p);
 await assert.rejects(beauty.deleteAsset(asset.id),/正被已保存主题使用/);
 const bundle=beauty.exportBundle(p),json=JSON.parse(bundle);assert.deepEqual(json.theme.iconAssets,{});assert.ok(json['icon.computer'].base64);
 await beauty.importBundle(bundle);assert.deepEqual(beauty.read().profiles.at(-1).iconAssets,p.iconAssets);
 const malicious=JSON.parse(bundle);delete malicious['icon.computer'];delete malicious['icon.folder'];malicious.theme.iconAssets={computer:'f'.repeat(64)};await beauty.importBundle(JSON.stringify(malicious));assert.deepEqual(beauty.read().profiles.at(-1).iconAssets,{});
});
test('native shell registry helpers round-trip absent, expandable and unsigned values in an isolated namespace', {skip:process.platform!=='win32'},t=>{
 const dir=root(t),source=fs.readFileSync(path.join(__dirname,'../src/main/beauty-shell-native.ps1'),'utf8');
 const prefix=source.slice(0,source.indexOf("if($Operation -eq 'read')"));
 const name='Software\\AgentToolboxBeautyTest-'+require('node:crypto').randomUUID();
 const script=prefix+String.raw`
$testRoot='${name}'
$hive=[Microsoft.Win32.Registry]::CurrentUser
try {
 $index=0;foreach($slot in @($script:BeautyShellSlots.Keys)){$script:BeautyShellSlots[$slot]=@(($testRoot+'\'+$index),'style');$index++}
 $original=@{};$next=@{}
 foreach($slot in $script:BeautyShellSlots.Keys){
  if($slot.StartsWith('accent.')){$original[$slot]=@{exists=$true;kind='DWord';value=4294967295L};$next[$slot]=@{exists=$true;kind='DWord';value=123}}
  elseif($slot -eq 'icon.computer'){$original[$slot]=@{exists=$false};$next[$slot]=@{exists=$true;kind='String';value='test.ico,0'}}
  else{$original[$slot]=@{exists=$true;kind='ExpandString';value='%SystemRoot%\cursor.cur'};$next[$slot]=@{exists=$true;kind='String';value='test.cur'}}
 }
 $before=($original|ConvertTo-Json -Depth 5)|ConvertFrom-Json;$after=($next|ConvertTo-Json -Depth 5)|ConvertFrom-Json
 Assert-BeautyShellValues $before $true;Assert-BeautyShellValues $after $true
 Write-BeautyShellValues $hive $before
 $sentinel=$hive.CreateSubKey($script:BeautyShellSlots['cursor.Arrow'][0]);$sentinel.SetValue('font-key-sentinel','keep');$sentinel.Dispose()
 Write-BeautyShellValues $hive $after;Write-BeautyShellValues $hive $before
 $actual=Read-BeautyShellValues $hive
 foreach($field in $before.PSObject.Properties){$v=$actual[$field.Name];if($v.exists -ne $field.Value.exists -or ($v.exists -and ($v.kind -cne $field.Value.kind -or $v.value -cne $field.Value.value))){throw 'Round-trip mismatch'}}
 $sentinel=$hive.OpenSubKey($script:BeautyShellSlots['cursor.Arrow'][0]);try{if($sentinel.GetValue('font-key-sentinel') -cne 'keep'){throw 'Unknown value changed'}}finally{$sentinel.Dispose()}
 Write-Output 'isolated-roundtrip-ok'
}finally{$hive.DeleteSubKeyTree($testRoot,$false)}
`;
 const file=path.join(dir,'test.ps1');fs.writeFileSync(file,'\ufeff'+script);
 const result=require('node:child_process').spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',file],{windowsHide:true,encoding:'utf8',timeout:20000});assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/isolated-roundtrip-ok/);
});
