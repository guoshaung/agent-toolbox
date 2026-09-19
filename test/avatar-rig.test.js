'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {registerAvatarRigIpc}=require('../src/main/avatar-rig-service');

test('invalid viewer job cannot escape the project or launch external URLs',async()=>{
  const handlers={};let opened=false;
  registerAvatarRigIpc({handle:(n,f)=>handlers[n]=f},{getUserDataPath:()=>os.tmpdir(),shell:{openExternal:()=>{opened=true;}}});
  const result=await handlers['avatarRig:preview'](null,'../../secret');
  assert.equal(result.ok,false);assert.equal(opened,false);
});

test('fresh install reports missing setup and releases busy state',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'avatar-rig-test-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const handlers={};
  registerAvatarRigIpc({handle:(n,f)=>handlers[n]=f},{getUserDataPath:()=>root,shell:{}});
  const result=await handlers['avatarRig:generate'](null,{base64:'aGVsbG8='});
  assert.equal(result.ok,false);
  assert.equal((await handlers['avatarRig:status']()).running,false);
  const sample=await handlers['avatarRig:sample']();assert.ok(sample.error);
});
