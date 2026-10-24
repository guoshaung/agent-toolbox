'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {VOICES,payloadFor,synthesizeSpeech}=require('../src/main/paper-talk-tts');
const {createVoiceConfig}=require('../src/main/paper-talk-voice-config');
const key='test-volc-key-000000';
const segment={speaker:'A',text:'这才是重点，为什么？',delivery:'curious',focus:0};
function response(lines,sse=false){const text=lines.map(x=>(sse?'data: ':'')+JSON.stringify(x)).join('\r\n');const bytes=new TextEncoder().encode(text);return new Response(new ReadableStream({start(c){for(let i=0;i<bytes.length;i+=7)c.enqueue(bytes.slice(i,i+7));c.close();}}));}
test('男女/男男/女女均为不同的真实音色，不是同嗓调音高',()=>{
  for(const voices of Object.values(VOICES)) assert.notEqual(voices.A,voices.B);
  assert.match(VOICES.mf.A,/male/);assert.match(VOICES.mf.B,/female/);
});
test('重点页语速略慢，表演指令与朗读正文分离',()=>{
  const p=payloadFor(segment,'mf',{emphasis:'core',points:[{heading:'重点机制'}]}).req_params;
  assert.equal(p.text,segment.text);assert.equal(p.audio_params.speech_rate,-5);
  assert.match(JSON.parse(p.additions).context_texts.join(' '),/好奇|重点机制/);
  assert.equal(p.audio_params.bit_rate,160000);
});
for(const sse of [false,true])test('完整收集'+(sse?'SSE':'NDJSON')+'音频，含跨块中文及无尾换行',async()=>{
  const got=await synthesizeSpeech({apiKey:key,segment,fetchFn:async(url,opt)=>{
    assert.equal(url,'https://openspeech.bytedance.com/api/v3/tts/unidirectional');
    assert.equal(opt.redirect,'error');assert.equal(opt.headers['X-Api-Key'],key);
    assert.equal(opt.headers['X-Api-Resource-Id'],'seed-tts-2.0');
    return response([{code:0,message:'正常',data:Buffer.from('audio').toString('base64')},{code:20000000}],sse);
  }});assert.equal(got.toString(),'audio');
});
test('中断的音频流不被误保存为成功文件',async()=>{
  await assert.rejects(synthesizeSpeech({apiKey:key,segment,fetchFn:async()=>response([{code:0,data:'YQ=='}])}),/中断/);
});
test('业务错误/HTTP错误和异常中的凭据均隐藏',async()=>{
  for(const res of [()=>response([{code:45000000,message:key}]),()=>new Response(key,{status:403})])await assert.rejects(synthesizeSpeech({apiKey:key,segment,fetchFn:async()=>res()}),e=>!e.message.includes(key)&&e.message.includes('[已隐藏]'));
});
test('鉴权失败不回退到系统 say 或其他供应商',async()=>{
  let calls=0;await assert.rejects(synthesizeSpeech({apiKey:key,segment,fetchFn:async()=>{calls++;return new Response('denied',{status:401});}}),/401/);assert.equal(calls,1);
});
test('保存接口只持久化 vaultId，不向配置/调用方泄露原始密钥',()=>{
  const map=new Map();let saved;
  const store={get:(k,d)=>map.get(k)??d,set:(k,v)=>{map.set(k,v);if(k==='research.papertalk.tts')map.set(k+'.vaultId',v.vaultId);}};
  const vault={pinStatus:()=>({hasPin:false,unlocked:true}),list:()=>({entries:[]}),save:x=>{saved=x;return{ok:true,id:'voice-entry'};},keyOf:()=>({ok:true,key})};
  const service=createVoiceConfig({vault,store});assert.equal(service.save(key).configured,true);
  assert.equal(saved.key,key);assert.equal(service.credential(),key);
  assert.ok(!JSON.stringify([...map]).includes(key));assert.ok(!JSON.stringify(service.status()).includes(key));
});
test('密钥箱被锁定时不能用保存接口覆盖语音凭据',()=>{
  const service=createVoiceConfig({vault:{pinStatus:()=>({hasPin:true,unlocked:false})},store:{get:()=>({})}});
  assert.match(service.save(key).error,/解锁/);
});
