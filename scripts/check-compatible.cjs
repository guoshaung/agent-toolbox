'use strict';
const fs=require('node:fs/promises'),os=require('node:os'),{spawnSync}=require('node:child_process');
(async()=>{
 const env={...process.env};
 if(process.platform==='win32'){
   env.TOOLBOX_ORIGINAL_TEMP=os.tmpdir();
   env.TEMP=env.TMP=await fs.realpath(os.tmpdir());
 }
 for(const args of [['--check','src/main/main.js'],['--check','src/main/preload.js'],['--test']]){
  const result=spawnSync(process.execPath,args,{stdio:'inherit',env});if(result.error)throw result.error;if(result.status!==0)process.exit(result.status||1);
 }
})().catch(error=>{console.error(error);process.exit(1);});
