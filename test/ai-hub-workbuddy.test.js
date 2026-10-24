'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { WorkBuddyCN, parseQuota, parseModels } = require('../src/main/ai-hub-workbuddy');
const { AiHub } = require('../src/main/ai-hub');
const jwt = (exp = Date.now() / 1000 + 3600) => 'test.' + Buffer.from(JSON.stringify({ sub: 'fixture-user', exp })).toString('base64url') + '.fixture';
const json = data => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
const wrap = data => json({ code: 0, data });
const credits = values => ({ Response: { Data: { Accounts: values.map(v => ({ CapacityUnit: 'credits', CycleCapacityRemain: v })) } } });
const sse = rows => new Response(rows.map(row => 'data: ' + (typeof row === 'string' ? row : JSON.stringify(row)) + '\n\n').join(''), { headers: { 'content-type': 'text/event-stream' } });
test('OAuth accepts only official HTTPS authorization URLs and never follows redirects', async () => {
  for (const authUrl of ['http://www.codebuddy.cn/login', 'https://www.codebuddy.cn.evil.test/login', 'https://user:password@www.codebuddy.cn/login']) {
    const service = new WorkBuddyCN({ fetchImpl: async (_url, init) => { assert.equal(init.redirect, 'error'); return wrap({ state: 'fixture-state', authUrl }); } });
    await assert.rejects(service.begin(), /非预期/); assert.equal(service.pending, null);
  }
});
test('OAuth pending, rate control, expiry, cancellation and stale poll isolation', async () => {
  let now = 100000; let calls = 0; let release;
  const service = new WorkBuddyCN({ now: () => now, fetchImpl: async url => {
    if (url.includes('/state?')) return wrap({ state: 'fixture', authUrl: 'https://www.codebuddy.cn/login' });
    calls++; if (calls === 1) return json({ code: 11217 });
    return new Promise(r => { release = () => r(wrap({ accessToken: jwt(), refreshToken: 'refresh-fixture' })); });
  } });
  let login = await service.begin(); assert.equal(await service.poll(login.loginId), null);
  assert.equal(await service.poll(login.loginId), null); assert.equal(calls, 1);
  now += 2500; const polling = service.poll(login.loginId); await Promise.resolve(); service.cancel(); release();
  await assert.rejects(polling, /取消/);
  login = await service.begin(); now += 600001; await assert.rejects(service.poll(login.loginId), /超时/);
});
test('quota requires actual numeric credits and does not turn unknown data into zero', () => {
  assert.equal(parseQuota({ data: credits(['2.5', 7.5]) }).remaining, 10);
  assert.equal(parseQuota({ data: credits([0]) }).remaining, 0);
  for (const value of [null, undefined, '', true, 'nope', -1]) assert.throws(() => parseQuota({ data: credits([value]) }));
  assert.throws(() => parseQuota({ data: credits([]) }), /未知/);
  assert.throws(() => parseQuota({ data: { Response: { Data: { Accounts: [{ CapacityUnit: 'tokens', CycleCapacityRemain: 2 }] } } } }));
  assert.deepEqual(parseModels({ data: { agents: [{ models: ['a', 'a', { id: 'b' }] }], models: [{ id: 'c' }] } }), ['a','b','c']);
});
test('quota uses official billing host and collects every page with end-time filters', async () => {
  const requests = [];
  const service = new WorkBuddyCN({ fetchImpl: async (url, init) => {
    requests.push([url, JSON.parse(init.body)]); return wrap(credits(requests.length === 1 ? Array(100).fill(1) : [2]));
  } });
  assert.equal((await service.quota({ accessToken: 'test', uid: 'test' })).remaining, 102);
  assert.equal(requests.length, 2); assert.equal(new URL(requests[0][0]).origin, 'https://www.codebuddy.cn');
  assert.equal(requests[1][1].PageNumber, 2); assert.match(requests[0][1].PackageEndTimeRangeBegin, /^\d{4}-\d\d-\d\d /);
});
test('forced upstream SSE is assembled for nonstream callers, including fragmented tool calls', async () => {
  const service = new WorkBuddyCN({ fetchImpl: async (_url, init) => {
    assert.equal(JSON.parse(init.body).stream, true);
    return sse([
      { id:'fixture', choices:[{delta:{reasoning_content:'想',content:'你',tool_calls:[{index:0,id:'call-1',function:{name:'read',arguments:'{"x":'}}]}}] },
      { choices:[{delta:{content:'好',tool_calls:[{index:0,function:{arguments:'1}'}}]},finish_reason:'tool_calls'}],usage:{prompt_tokens:5,completion_tokens:2} }, '[DONE]']);
  } });
  const response = await service.chat({ accessToken:'test',uid:'test' }, { model:'test',stream:false }, undefined); const result = await response.json();
  assert.equal(result.choices[0].message.content, '你好'); assert.equal(result.choices[0].message.reasoning_content, '想');
  assert.equal(result.choices[0].message.tool_calls[0].function.arguments, '{"x":1}'); assert.equal(result.usage.prompt_tokens, 5);
});
test('stream interruption and service business errors fail without retry', async () => {
  for (const rows of [[{choices:[{delta:{content:'partial'}}]}], [{error:{message:'private-error'}}], [{code:11140}]]) {
    let calls = 0; const service = new WorkBuddyCN({ fetchImpl: async () => { calls++; return sse(rows); } });
    await assert.rejects(service.chat({ accessToken:'test',uid:'test' }, {stream:false}, undefined)); assert.equal(calls, 1);
  }
});
async function hubFixture(t, token = jwt()) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-workbuddy-'));
  let renewCount = 0; let quotaFails = false;
  const hub = new AiHub({ directory:dir, safeStorage:{ isEncryptionAvailable:()=>true, encryptString:s=>Buffer.from(s).reverse(), decryptString:b=>Buffer.from(b).reverse().toString() }, fetchImpl:async (url, init) => {
    if(url.includes('/auth/state?')) return wrap({state:'fixture-state',authUrl:'https://www.codebuddy.cn/login'});
    if(url.includes('/auth/token?')) return wrap({accessToken:token,refreshToken:'secret-refresh-fixture'});
    if(url.endsWith('/token/refresh')) { renewCount++; await new Promise(r=>setTimeout(r,10)); return wrap({accessToken:jwt(Date.now()/1000+7200),refreshToken:'rotated-refresh'}); }
    if(url.endsWith('/personal/models')) return wrap({agents:[{models:['fixture-model']}]});
    if(url.endsWith('/get-user-resource')) return quotaFails ? json({code:123}) : wrap(credits([8]));
    if(url.endsWith('/chat/completions')) return sse([{choices:[{delta:{content:'OK'}}],usage:{prompt_tokens:1,completion_tokens:1}},'[DONE]']);
    throw Error('Unexpected test URL');
  } });
  t.after(async()=>{await hub.stop();fs.rmSync(dir,{recursive:true,force:true});});
  return { hub,renewCount:()=>renewCount,failQuota:()=>{quotaFails=true;} };
}
test('browser login stores encrypted isolated credentials, starts disabled, then routes an enabled channel', async t => {
  const {hub,failQuota} = await hubFixture(t); const login=await hub.loginStart(); const result=await hub.loginPoll(login.loginId);
  assert.equal(result.loginStatus,'connected'); let c=result.channels[0]; assert.equal(c.enabled,false); assert.equal(c.model,'fixture-model'); assert.equal(c.quota.remaining,8);
  for(const secret of ['secret-refresh-fixture','fixture-state',jwt(),'accountEncrypted']) assert.ok(!JSON.stringify(hub.status()).includes(secret));
  assert.ok(!fs.readFileSync(hub.file,'utf8').includes('secret-refresh-fixture'));
  failQuota(); const before=c.quota.updatedAt; await hub.refreshAccount(c.id); assert.equal(hub.status().channels[0].quota.updatedAt,before);
  hub.save({...c,enabled:true}); await hub.start(0);
  const response=await fetch(hub.status().baseUrl+'/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+hub.token,'Content-Type':'application/json'},body:JSON.stringify({messages:[{role:'user',content:'test'}]})});
  assert.equal(response.status,200); assert.equal((await response.json()).choices[0].message.content,'OK'); assert.equal(hub.status().channels[0].stats.completed,1);
  const reloaded=new AiHub({directory:path.dirname(hub.file),safeStorage:hub.safeStorage}); assert.equal(reloaded.status().channels[0].hasKey,true);
});
test('concurrent expired-token readers renew once and preserve rotation', async t => {
  const {hub,renewCount} = await hubFixture(t); const login=await hub.loginStart(); await hub.loginPoll(login.loginId);
  const c=hub.state.channels[0]; const auth=JSON.parse(hub.unseal(c.accountEncrypted));auth.expiresAt=0;c.accountEncrypted=hub.seal(JSON.stringify(auth));
  const [one,two]=await Promise.all([hub.workbuddyAuth(c.id),hub.workbuddyAuth(c.id)]);
  assert.equal(renewCount(),1); assert.equal(one.accessToken,two.accessToken); assert.equal(JSON.parse(hub.unseal(c.accountEncrypted)).refreshToken,'rotated-refresh');
});
