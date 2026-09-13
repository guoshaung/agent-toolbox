'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { sameLibrarySite } = require('../src/main/literature-site');

test('登录文献站点允许同源和 CNKI 根域名/子域名，拒绝跨站点', () => {
  assert.equal(sameLibrarySite('https://library.example.edu/results', 'https://library.example.edu/paper'), true);
  assert.equal(sameLibrarySite('https://cnki.net/results', 'https://kns.cnki.net/kcms/detail'), true);
  assert.equal(sameLibrarySite('https://www.cnki.net/results', 'https://cnki.net/download'), true);
  assert.equal(sameLibrarySite('https://library.example.edu/results', 'https://cdn.example.net/paper.pdf'), false);
  assert.equal(sameLibrarySite('file:///tmp/paper.pdf', 'https://cnki.net/download'), false);
});
