'use strict';
const{parentPort}=require('node:worker_threads'),path=require('node:path');
// Fixed local model/core paths only; even an accidental upstream fetch fails closed.
global.fetch=async()=>{throw Error('此识别线程禁止网络下载；请恢复固定本地模型。');};
// Both this owner and the Tesseract child live in the job worker environment.
// Host termination disposes the worker environment, including its child workers.
let engine=null;
parentPort.on('message',async message=>{try{if(!engine){const t=require('./vendor/runtime/node_modules/tesseract.js');engine=await t.createWorker(message.language,1,{langPath:path.join(__dirname,'vendor/models'),gzip:false,cacheMethod:'none',logger:()=>{},errorHandler:()=>{}});await engine.setParameters({tessedit_pageseg_mode:'3',preserve_interword_spaces:'1'});}const result=await engine.recognize(Buffer.from(message.png),{}, {blocks:true,text:true});const words=[];let line=0;for(const block of result.data.blocks??[])for(const paragraph of block.paragraphs??[])for(const row of paragraph.lines??[]){for(const word of row.words??[]){const text=word.text.trim();if(text)words.push({text,bbox:word.bbox,confidence:Math.max(0,Math.min(100,word.confidence)),line});}line++;}parentPort.postMessage({ok:true,words});}catch(error){parentPort.postMessage({ok:false,error:String(error?.message??error).slice(0,500)});}});
