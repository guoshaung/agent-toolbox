'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { yearOf, creatorsToAuthors, resolveAttachmentPath, annotationToHighlight, toConnectorItem, sanitizeName, colorName } = require('../src/main/zotero');

test('Zotero：日期各种写法里抠年份', () => {
  assert.equal(yearOf('2024-05-01 2024-05-01'), '2024');
  assert.equal(yearOf('May 2023'), '2023');
  assert.equal(yearOf(''), '');
});

test('Zotero：creators 转文献库的 authors', () => {
  assert.deepEqual(creatorsToAuthors([{ firstName: 'Yann', lastName: 'LeCun' }, { firstName: '', lastName: '' }]), [{ family: 'LeCun', given: 'Yann' }]);
});

test('Zotero：附件路径三种写法', () => {
  assert.equal(resolveAttachmentPath('/d', 'ABCD1234', 'storage:paper.pdf'), path.join('/d', 'storage', 'ABCD1234', 'paper.pdf'));
  assert.equal(resolveAttachmentPath('/d', 'K', '/abs/x.pdf'), '/abs/x.pdf');
  assert.equal(resolveAttachmentPath('/d', 'K', 'attachments:sub/x.pdf', '/base'), path.join('/base', 'sub', 'x.pdf'));
  assert.equal(resolveAttachmentPath('/d', 'K', 'attachments:x.pdf'), '');
});

test('Zotero：批注变成「文献」页的高亮，颜色归到五色', () => {
  const hl = annotationToHighlight({ key: 'ANN1', type: 1, text: '关键句', comment: '我的想法', color: '#ffd400', pageLabel: '3', dateAdded: '2026-01-02 03:04:05' }, 'a.pdf');
  assert.equal(hl.id, 'zot-ANN1');
  assert.equal(hl.selected_text, '关键句');
  assert.equal(hl.note, '我的想法');
  assert.equal(hl.page, 3);
  assert.equal(hl.color, 'yellow');
  assert.equal(hl.source, 'zotero');
  assert.equal(colorName('#5fb236'), 'green');
  assert.equal(colorName('#2ea8e5'), 'blue');
});

test('Zotero：文献库条目 → 连接器 saveItems 的 item', () => {
  const item = toConnectorItem({ title: 'T', authors: [{ family: 'Li', given: 'Hua' }], year: '2025', journal: 'NeurIPS', doi: '10.1/x', tags: ['agent'], note: '好' }, 'http://127.0.0.1:1/pdf/abc');
  assert.equal(item.itemType, 'journalArticle');
  assert.deepEqual(item.creators, [{ creatorType: 'author', firstName: 'Hua', lastName: 'Li' }]);
  assert.equal(item.publicationTitle, 'NeurIPS');
  assert.equal(item.DOI, '10.1/x');
  assert.equal(item.attachments[0].url, 'http://127.0.0.1:1/pdf/abc');
  assert.deepEqual(item.tags, [{ tag: 'agent' }]);
  const pre = toConnectorItem({ title: 'P', url: 'https://arxiv.org/abs/2604.1' }, '');
  assert.equal(pre.itemType, 'preprint');
  assert.equal(pre.attachments.length, 0);
});

test('Zotero：文件名清洗', () => {
  assert.equal(sanitizeName('A/B: C? "D"  '), 'A B C D');
  assert.equal(sanitizeName(''), 'paper');
});
