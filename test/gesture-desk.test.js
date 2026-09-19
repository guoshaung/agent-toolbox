'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseLsappinfo, GestureDesk } = require('../src/main/gesture-desk');

test('parseLsappinfo：只留 Foreground 的应用，带名字和包路径', () => {
  const sample = [
    ' 1) "loginwindow" ASN:0x0-0x1001: ', '    bundle path="/System/Library/CoreServices/loginwindow.app"', '    pid = 166 type="UIElement" flavor=3',
    ' 2) "Obsidian" ASN:0x0-0x2002: ', '    bundle path="/Applications/Obsidian.app"', '    pid = 900 type="Foreground" flavor=3',
    ' 3) "飞书" ASN:0x0-0x3003: ', '    bundle path="/Applications/Lark.app"', '    pid = 901 type="Foreground" flavor=3',
    ' 4) "universalaccessd" ASN:0x0-0x8008: ', '    bundle path="/usr/sbin/universalaccessd"', '    pid = 425 type="BackgroundOnly"',
  ].join('\n');
  const rows = parseLsappinfo(sample);
  assert.deepEqual(rows.map((r) => [r.name, r.path]), [['Obsidian', '/Applications/Obsidian.app'], ['飞书', '/Applications/Lark.app']]);
});

test('listApps：去掉工具箱自己、去重、最多 9 个；activate 按包路径 open', async () => {
  const calls = [];
  const lines = ['Electron', 'A', 'B', 'A', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'].map((n, i) => ` ${i}) "${n}" ASN:0x0-0x${i}:\n    bundle path="/Applications/${n}.app"\n    pid = ${i} type="Foreground"`).join('\n');
  const desk = new GestureDesk({ platform: 'darwin', app: null, execFile: async (file, args) => { calls.push([file, ...args]); return { stdout: lines }; } });
  const apps = await desk.listApps();
  assert.equal(apps.length, 9);
  assert.ok(!apps.some((a) => a.name === 'Electron'));
  assert.equal(new Set(apps.map((a) => a.name)).size, 9);
  const r = await desk.activate(apps[1]);
  assert.equal(r.ok, true);
  assert.deepEqual(calls.at(-1), ['/usr/bin/open', '-a', '/Applications/B.app']);
});

test('handleEvent：切换栏没开时比数字直接切；开了先高亮再选', async () => {
  const calls = [];
  const desk = new GestureDesk({ platform: 'darwin', app: null, execFile: async (file, args) => { calls.push([file, ...args]); return { stdout: ' 1) "A" ASN:0x0-0x1:\n    bundle path="/Applications/A.app"\n    pid = 1 type="Foreground"' }; } });
  const direct = await desk.handleEvent({ type: 'number', value: 1 });
  assert.equal(direct.ok, true, '没开切换栏也能凭编号切');
  assert.deepEqual(calls.at(-1), ['/usr/bin/open', '-a', '/Applications/A.app']);
  desk.apps = [{ name: 'X' }, { name: 'Y' }];
  desk.switcherOpen = true;
  desk.highlight = () => {};
  desk.hideSwitcher = () => { desk.switcherOpen = false; };
  const r = await desk.handleEvent({ type: 'number', value: 5 });
  assert.match(r.error, /没有第 5 个/);
});
