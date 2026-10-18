'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {timedCues}=require('../src/main/paper-talk-subtitles');
const {synthesizeSpeech}=require('../src/main/paper-talk-tts');
function words(text,start=0){return [...text].map((word,i)=>({word,startTime:start+i*.1,endTime:start+(i+1)*.1}));}
test('字幕来自完整朗读字词，不使用摘要，按标点逐句更新',()=>{
  const text='我们先解释问题。接下来讨论实验。';const cues=timedCues(words(text),5);
  assert.equal(cues.map(c=>c.text).join(''),text);assert.equal(cues.length,2);
  assert.equal(cues[1].start,.8);assert.ok(cues[0].end<=cues[1].start);
});
test('长句按可读行长拆分，保留所有原文内容',()=>{
  const text='这是一段没有标点但是需要完整显示并随着配音向上滚动的讲解文本'.repeat(3);
  const cues=timedCues(words(text),text.length*.1+1);
  assert.equal(cues.map(c=>c.text).join(''),text);assert.ok(cues.every(c=>[...c.text].length<=38));
});
test('缺失、越界或重叠时间戳不使用估算字幕兜底',()=>{
  assert.deepEqual(timedCues([],5),[]);assert.deepEqual(timedCues(undefined,5),[]);
  assert.deepEqual(timedCues([{word:'错误',startTime:-1,endTime:3}],5),[]);
  assert.deepEqual(timedCues([{word:'错误',startTime:0,endTime:10}],5),[]);
  assert.deepEqual(timedCues([{word:'错误',startTime:null,endTime:1}],5),[]);
  assert.deepEqual(timedCues([{word:'一',startTime:0,endTime:2},{word:'二',startTime:1,endTime:3}],5),[]);
});
test('重复返回的字级字幕去重，英文词之间保留空格',()=>{
  const a={word:'Agent',startTime:0,endTime:.3},b={word:'privacy',startTime:.3,endTime:.8};
  assert.equal(timedCues([a,a,b],2)[0].text,'Agent privacy');
});
test('配音接口开启时间戳，可接收在音频之后到达的字幕',async()=>{
  const got=await synthesizeSpeech({apiKey:'test-key',segment:{speaker:'A',text:'完整字幕。'},withTimestamps:true,fetchFn:async(_,opt)=>{
    assert.equal(JSON.parse(opt.body).req_params.audio_params.enable_subtitle,true);
    return new Response([{code:0,data:'YXVkaW8='},{code:0,sentence:{words:words('完整字幕。')}},{code:20000000}].map(f=>JSON.stringify(f)).join('\n'));
  }});
  assert.equal(got.audio.toString(),'audio');assert.equal(got.words.length,5);
});
test('接口不支持字幕时保留配音，明确不生成底部假字幕',async()=>{
  let calls=0;
  const got=await synthesizeSpeech({apiKey:'test-key',segment:{speaker:'A',text:'完整台词'},withTimestamps:true,fetchFn:async(_,opt)=>{
    const options=JSON.parse(opt.body).req_params.audio_params;
    if(++calls===1){assert.equal(options.enable_subtitle,true);return new Response('unsupported enable_subtitle',{status:400});}
    assert.equal(options.enable_subtitle,undefined);
    return new Response('{"code":0,"data":"YXVkaW8="}\n{"code":20000000}');
  }});
  assert.equal(got.audio.toString(),'audio');assert.deepEqual(got.words,[]);assert.equal(calls,2);
});
