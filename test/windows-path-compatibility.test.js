'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {scanRoot,createHost}=require('../src/renderer/features/T020/host.cjs');
test('T020 short TEMP alias identifies the same ordinary root without rejecting it',async t=>{
 const parent=await fs.mkdtemp(path.join(process.env.TOOLBOX_ORIGINAL_TEMP||os.tmpdir(),'toolbox-alias-'));
 t.after(()=>fs.rm(parent,{recursive:true,force:true}));
 const root=path.join(parent,'root');await fs.mkdir(root);await fs.writeFile(path.join(root,'ordinary.txt'),'unchanged');
 const report=await scanRoot(root);assert.equal(report.root,await fs.realpath(root));assert.equal(report.summary.ordinaryFiles,1);
 const host=createHost({chooseDirectory:async()=>root});const selected=await host.invoke('select',{}, {senderId:1});assert.equal(selected.root,await fs.realpath(root));
 assert.equal(await fs.readFile(path.join(root,'ordinary.txt'),'utf8'),'unchanged');
});
test('T020 canonicalization still refuses a final directory junction',async t=>{
 if(process.platform!=='win32')return t.skip('Windows junction test');
 const parent=await fs.mkdtemp(path.join(os.tmpdir(),'toolbox-junction-'));t.after(()=>fs.rm(parent,{recursive:true,force:true}));
 const root=path.join(parent,'root'),link=path.join(parent,'alias');await fs.mkdir(root);await fs.symlink(root,link,'junction');
 await assert.rejects(scanRoot(link),/普通目录/);
});
