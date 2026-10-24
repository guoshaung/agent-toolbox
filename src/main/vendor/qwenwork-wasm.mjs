// Toolbox adaptation: stdin-only credentials, no auth CLI, no temporary files. See QWENWORK-LICENSE.txt.
﻿// 来源：Buddy2api（https://github.com/wicm84266964/Buddy2api），MIT License，
// Copyright (c) 2026。本文件为其中的 providers/qwenwork/wasm_helper.mjs，
// 按 MIT 条款搬入本项目并保留原许可声明。仅改动：文件头补此说明，
// 并在末尾追加 `serve` 长驻模式（原文件只支持一次性 CLI 调用）。
//
// `serve` 模式与 CLI 模式并存：
//   - CLI（auth/infer/req）：一次调用生成一个请求后退出，便于手工排查
//   - serve：stdin/stdout 长驻，进程复用同一个 wasm context
// 目前上层走 CLI 模式（实现简单、无状态易排查）；若实测每请求 spawn 成为
// 延迟瓶颈，切到 serve 只改 bridge.js 一处，不必动这里的 wasm 逻辑。
//
// 为什么必须用它：千问办公 1.1.0 的数据面要求请求体由官方
// qoder_auth_wasm_bg.wasm 生成（Encode=1），本地自实现的编码与线上不兼容，
// 服务端会回 `400 Invalid agent chat JSON body`。
// ---------------------------------------------------------------------------
// Generate a real QwenWork data-plane request by driving the official
// qoder_auth_wasm_bg.wasm, mirroring the worker runtime's QoderContext usage:
//
//   createContext(machineId, cosyVersion, userInfoJson)
//     -> new QoderContext(machineId, cosyVersion, userInfoJson, clientMetadataJson)
//   ctx.prepareInferRequest(endpoint, path, method, bodyJson)
//     -> { url, headers, body }
//
// Usage:
//   node _wasm_auth.mjs auth <uid> <token> [orgId] [orgTagsJson]
//   node _wasm_auth.mjs infer <uid> <token> <endpoint> <path> <bodyJsonFile>
//
// `auth` prints {"encrypt_user_info":..,"key":..}; `infer` prints the full
// prepared request as JSON so the caller can replay it verbatim.

import fs from 'node:fs';
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;
import os from 'node:os';
import path from 'node:path';

const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const WASM = input.wasm;

// --- wasm-bindgen object heap ------------------------------------------------
let heap = new Array(1024).fill(undefined);
let heapNext = 1024;
function addHeapObject(o) { if (heapNext === heap.length) heap.push(heap.length + 1); const i = heapNext; heapNext = heap[i]; heap[i] = o; return i; }
function getHeapObject(i) { return heap[i]; }
function dropHeapObject(i) { heap[i] = heapNext; heapNext = i; }

let exports_ = null, mem = null, cachedU8 = null, cachedDV = null, rg = 0;
function u8() { if (!cachedU8 || cachedU8.byteLength === 0 || cachedU8.buffer !== mem.buffer) cachedU8 = new Uint8Array(mem.buffer); return cachedU8; }
function dv() { if (!cachedDV || cachedDV.buffer !== mem.buffer) cachedDV = new DataView(mem.buffer); return cachedDV; }
const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });

function readString(ptr, len) { return dec.decode(u8().subarray(ptr, ptr + len)); }
function passString(s) {
  const t = enc.encode(s);
  const p = exports_.__wbindgen_export2(t.length, 1) >>> 0;
  u8().subarray(p, p + t.length).set(t);
  rg = t.length;
  return p;
}
function readBytes(ptr, len) { return u8().subarray(ptr, ptr + len).slice(); }

const imports = { './qoder_auth_wasm_bg.js': {
  __wbg_Error_2e59b1b37a9a34c3: (a, b) => addHeapObject(Error(readString(a, b))),
  __wbg___wbindgen_is_function_49868bde5eb1e745: (a) => typeof getHeapObject(a) === 'function',
  __wbg___wbindgen_is_object_40c5a80572e8f9d3: (a) => { const e = getHeapObject(a); return typeof e === 'object' && e !== null; },
  __wbg___wbindgen_is_string_b29b5c5a8065ba1a: (a) => typeof getHeapObject(a) === 'string',
  __wbg___wbindgen_is_undefined_c0cca72b82b86f4d: (a) => getHeapObject(a) === undefined,
  __wbg___wbindgen_throw_81fc77679af83bc6: (a, b) => { throw new Error(readString(a, b)); },
  __wbg_call_d578befcc3145dee: (a, b, c) => addHeapObject(getHeapObject(a).call(getHeapObject(b), getHeapObject(c))),
  __wbg_crypto_38df2bab126b63dc: (a) => { const o = getHeapObject(a); return addHeapObject((o && o.crypto) || globalThis.crypto); },
  __wbg_getRandomValues_c44a50d8cfdaebeb: (a, b) => { const c = getHeapObject(a), t = getHeapObject(b); (c && c.getRandomValues ? c.getRandomValues(t) : globalThis.crypto.getRandomValues(t)); },
  __wbg_getRandomValues_d49329ff89a07af1: (a, b) => { globalThis.crypto.getRandomValues(new Uint8Array(mem.buffer, a >>> 0, b >>> 0)); },
  __wbg_length_0c32cb8543c8e4c8: (a) => getHeapObject(a).length,
  __wbg_msCrypto_bd5a034af96bcba6: (a) => addHeapObject(getHeapObject(a).msCrypto),
  __wbg_new_99cabae501c0a8a0: () => addHeapObject(new Map()),
  __wbg_new_with_length_9cedd08484b73942: (a) => addHeapObject(new Uint8Array(a >>> 0)),
  __wbg_node_84ea875411254db1: (a) => addHeapObject(getHeapObject(a).node),
  __wbg_now_88621c9c9a4f3ffc: () => Date.now(),
  __wbg_process_44c7a14e11e9f69e: (a) => addHeapObject(getHeapObject(a).process),
  __wbg_prototypesetcall_3e05eb9545565046: (a, b, c) => Uint8Array.prototype.set.call(u8().subarray(a >>> 0, (a >>> 0) + (b >>> 0)), getHeapObject(c)),
  __wbg_randomFillSync_6c25eac9869eb53c: (a, b) => getHeapObject(a).randomFillSync(getHeapObject(b)),
  __wbg_require_b4edbdcf3e2a1ef0: () => addHeapObject(() => {}),
  __wbg_set_08463b1df38a7e29: (a, b, c) => getHeapObject(a).set(getHeapObject(b), getHeapObject(c)),
  __wbg_static_accessor_GLOBAL_THIS_a1248013d790bf5f: () => { const A = typeof globalThis > 'u' ? null : globalThis; return A === undefined ? 0 : addHeapObject(A); },
  __wbg_static_accessor_GLOBAL_f2e0f995a21329ff: () => { const A = typeof global > 'u' ? null : global; return A === undefined ? 0 : addHeapObject(A); },
  __wbg_static_accessor_SELF_24f78b6d23f286ea: () => { const A = typeof self > 'u' ? null : self; return A === undefined ? 0 : addHeapObject(A); },
  __wbg_static_accessor_WINDOW_59fd959c540fe405: () => { const A = typeof window > 'u' ? null : window; return A === undefined ? 0 : addHeapObject(A); },
  __wbg_subarray_0f98d3fb634508ad: (a, b, c) => addHeapObject(getHeapObject(a).subarray(b >>> 0, c >>> 0)),
  __wbg_versions_276b2795b1c6a219: (a) => addHeapObject(getHeapObject(a).versions),
  __wbindgen_cast_0000000000000001: (a, b) => addHeapObject(readBytes(a, b)),
  __wbindgen_cast_0000000000000002: (a, b) => addHeapObject(readString(a, b)),
  __wbindgen_object_clone_ref: (a) => addHeapObject(getHeapObject(a)),
  __wbindgen_object_drop_ref: (a) => dropHeapObject(a),
} };

const bytes = fs.readFileSync(WASM);
const { instance } = await WebAssembly.instantiate(bytes, imports);
exports_ = instance.exports;
mem = exports_.memory;

// --- QoderContext / RequestResult wrappers (mirroring the worker) ------------
const registry = new FinalizationRegistry((ptr) => { try { exports_.__wbg_qodercontext_free(ptr, 0); } catch {} });
const rrRegistry = new FinalizationRegistry((ptr) => { try { exports_.__wbg_requestresult_free(ptr, 0); } catch {} });

class RequestResult {
  constructor(ptr) { this.__wbg_ptr = ptr >>> 0; rrRegistry.register(this, this.__wbg_ptr, this); }
  static __wrap(ptr) { return new RequestResult(ptr); }
  free() { const p = this.__wbg_ptr; this.__wbg_ptr = 0; rrRegistry.unregister(this); try { exports_.__wbg_requestresult_free(p, 0); } catch {} }
  get url() {
    const sp = exports_.__wbindgen_add_to_stack_pointer(-16);
    try {
      exports_.requestresult_url(sp, this.__wbg_ptr);
      const p = dv().getInt32(sp + 0, true), l = dv().getInt32(sp + 4, true);
      return readString(p, l);
    } finally { exports_.__wbindgen_add_to_stack_pointer(16); }
  }
  get body() {
    const sp = exports_.__wbindgen_add_to_stack_pointer(-16);
    try {
      exports_.requestresult_body(sp, this.__wbg_ptr);
      const p = dv().getInt32(sp + 0, true), l = dv().getInt32(sp + 4, true);
      if (p === 0) return undefined;
      const out = readBytes(p, l);
      exports_.__wbindgen_export4(p, l, 1);
      return out;
    } finally { exports_.__wbindgen_add_to_stack_pointer(16); }
  }
  get headerCount() { return exports_.requestresult_headerCount(this.__wbg_ptr) >>> 0; }
  // `requestresult_headers` hands back a JS Map through the bindgen heap (the
  // worker's `zD` helper), not a byte buffer, so it must be taken by reference.
  get headers() {
    const idx = exports_.requestresult_headers(this.__wbg_ptr);
    const value = getHeapObject(idx);
    dropHeapObject(idx);
    return value;
  }
}

class QoderContext {
  constructor(machineId, cosyVersion, userInfoJson, clientMetadataJson) {
    const sp = exports_.__wbindgen_add_to_stack_pointer(-16);
    try {
      const a = passString(machineId), al = rg;
      const b = passString(cosyVersion), bl = rg;
      const c = passString(userInfoJson), cl = rg;
      const d = passString(clientMetadataJson), dl = rg;
      exports_.qodercontext_new(sp, a, al, b, bl, c, cl, d, dl);
      const ptr = dv().getInt32(sp + 0, true), err = dv().getInt32(sp + 8, true);
      if (err) throw new Error('qodercontext_new error ' + err);
      this.__wbg_ptr = ptr >>> 0;
      registry.register(this, this.__wbg_ptr, this);
    } finally { exports_.__wbindgen_add_to_stack_pointer(16); }
  }
  free() { const p = this.__wbg_ptr; this.__wbg_ptr = 0; registry.unregister(this); try { exports_.__wbg_qodercontext_free(p, 0); } catch {} }
  prepareInferRequest(endpoint, path, method, body) {
    const sp = exports_.__wbindgen_add_to_stack_pointer(-16);
    try {
      const a = passString(endpoint), al = rg;
      const b = passString(path), bl = rg;
      const c = passString(method), cl = rg;
      const d = passString(body), dl = rg;
      exports_.qodercontext_prepareInferRequest(sp, this.__wbg_ptr, a, al, b, bl, c, cl, d, dl);
      const ptr = dv().getInt32(sp + 0, true), err = dv().getInt32(sp + 8, true);
      if (err) throw new Error('prepareInferRequest error ' + err);
      return RequestResult.__wrap(ptr);
    } finally { exports_.__wbindgen_add_to_stack_pointer(16); }
  }
  prepareRequest(endpoint, path, method, kind, body, headersJson) {
    const sp = exports_.__wbindgen_add_to_stack_pointer(-16);
    try {
      const a = passString(endpoint), al = rg;
      const b = passString(path), bl = rg;
      const c = passString(method), cl = rg;
      const d = passString(kind), dl = rg;
      const e = passString(body === undefined || body === null ? '' : String(body)), el = rg;
      exports_.qodercontext_prepareRequest(sp, this.__wbg_ptr, a, al, b, bl, c, cl, d, dl, e, el);
      const ptr = dv().getInt32(sp + 0, true), err = dv().getInt32(sp + 8, true);
      if (err) throw new Error('prepareRequest error ' + err);
      return RequestResult.__wrap(ptr);
    } finally { exports_.__wbindgen_add_to_stack_pointer(16); }
  }
}

// Must mirror the identity the request headers advertise. The desktop client
// signs as qoder_work/6/qwork; building the body under the CLI's cli/5/assistant
// triple makes the two disagree and the server rejects the request.
function clientMetadata() {
  return JSON.stringify({ client_type: '6', business_product: 'qoder_work', business_type: 'agent', scene: 'qwork' });
}


try {
 if (input.mode === 'decode') {
  const p=passString(input.text), l=rg, sp=exports_.__wbindgen_add_to_stack_pointer(-16);
  try { exports_.decrypt_server_response(sp,p,l); if(dv().getInt32(sp+8,true)) throw Error('decode'); process.stdout.write(JSON.stringify(readString(dv().getInt32(sp,true),dv().getInt32(sp+4,true)))); } finally { exports_.__wbindgen_add_to_stack_pointer(16); }
 } else {
  const a=input.auth;
  const p=passString(JSON.stringify({uid:a.uid,security_oauth_token:a.token,organization_id:'',organization_tags:'',data_policy_agreed:true})), l=rg, sp=exports_.__wbindgen_add_to_stack_pointer(-16);
  let runtime;
  try { exports_.generate_runtime_auth_fields(sp,p,l); if(dv().getInt32(sp+8,true))throw Error('auth');runtime=JSON.parse(readString(dv().getInt32(sp,true),dv().getInt32(sp+4,true))); } finally { exports_.__wbindgen_add_to_stack_pointer(16); }
  const ctx=new QoderContext(a.machineId,'1.1.52',JSON.stringify({uid:a.uid,encrypt_user_info:runtime.encrypt_user_info,key:runtime.key}),clientMetadata());
  try {
   const rr=input.mode==='infer'?ctx.prepareInferRequest('https://gateway.qwenwork.cn',JSON.stringify(input.body),input.model,'system'):ctx.prepareRequest('https://gateway.qwenwork.cn','/api/v2/model/list','GET','auth','');
   try { const headers={};rr.headers.forEach((v,k)=>headers[String(k)]=String(v));process.stdout.write(JSON.stringify({url:rr.url,headers,body:rr.body?Buffer.from(rr.body).toString('utf8'):null})); } finally {rr.free();}
  } finally {ctx.free();}
 }
} catch { process.stderr.write('QwenWork request component failed');process.exitCode=1; }
