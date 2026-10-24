'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { findWebUrl } = require('../src/main/dsh-service');
test('DSH launch discovery ignores package registry and foreign token URLs',()=>{
  assert.equal(findWebUrl('download failed https://pypi.org/simple/package/'),'');
  assert.equal(findWebUrl('https://example.com/?token=test'),'');
  assert.equal(findWebUrl('http://localhost.evil.test:3080/?token=test'),'');
  assert.equal(findWebUrl('http://name:password@127.0.0.1:3080/?token=test'),'');
});
test('DSH authenticated URL wins over unrelated local URLs and ANSI colors',()=>{
  assert.equal(findWebUrl('proxy http://127.0.0.1:7890 \x1b[32mhttp://localhost:3080/?token=fixture\x1b[0m\n'),'http://localhost:3080/?token=fixture');
  assert.equal(findWebUrl('server http://[::1]:49123/?token=fixture'),'http://[::1]:49123/?token=fixture');
});
