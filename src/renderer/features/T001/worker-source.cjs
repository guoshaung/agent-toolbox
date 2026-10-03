'use strict';
const{parentPort,workerData}=require('node:worker_threads'),crypto=require('node:crypto'),Ajv=require('./vendor/ajv.cjs');
(async()=>{try{const m=await import('./model.mjs'),report=m.analyze(workerData,Ajv);report.sourceSHA256={data:crypto.createHash('sha256').update(workerData.dataText,'utf8').digest('hex'),schema:crypto.createHash('sha256').update(workerData.schemaText,'utf8').digest('hex')};m.reportText(report,'json');parentPort.postMessage({ok:true,report});}catch(e){parentPort.postMessage({ok:false,error:String(e.message).slice(0,2000)});}finally{parentPort.close();}})();
