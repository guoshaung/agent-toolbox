'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { MAX_INI, decodeIni, mergeNativeIni, readIni, writeNewIni } = require('../src/main/beauty-ini');
const { makeNativeRecipe } = require('../src/main/beauty-recipes');
const profile = { tint: '#123456', opacity: 50, blur: 30, effect: 'mica' };
const recipe = engine => makeNativeRecipe(engine, profile);
const utf16 = text => Buffer.concat([Buffer.from([255, 254]), Buffer.from(text, 'utf16le')]);
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolbox-ini-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('merge preserves unknown font/key fields, comments and engine behavior options verbatim', () => {
  const source = '; 我的自定义\r\n[Config]\r\n  EffectType =0\r\napplyglobal=true\r\ndisableOnBattery=false\r\nblurMethod=1\r\ncrossFade=false\r\nFont=等线\r\nApiKey=dummy-only\r\n[Custom]\r\nopaque=a=b;keep\r\n';
  const merged = decodeIni(mergeNativeIni(utf16(source), recipe('dwm')).buffer).text;
  assert.match(merged, /  EffectType =3\r\n/);
  for (const line of ['; 我的自定义', 'applyglobal=true', 'disableOnBattery=false', 'blurMethod=1', 'crossFade=false', 'Font=等线', 'ApiKey=dummy-only', '[Custom]', 'opaque=a=b;keep']) assert.ok(merged.includes(line + '\r\n'));
  assert.match(merged, /customBlurAmount=30\r\n/);
  assert.equal(merged.match(/\[Config\]/g).length, 1);
});

test('merge keeps UTF-8 with or without BOM, UTF-16LE BOM, and mixed original line endings', () => {
  const text = '; 中文\n[config]\r\neffect=3\rfont=等线';
  for (const buffer of [Buffer.from(text), Buffer.concat([Buffer.from([239,187,191]), Buffer.from(text)]), utf16(text)]) {
    const before = decodeIni(buffer), after = decodeIni(mergeNativeIni(buffer, recipe('explorer')).buffer);
    assert.equal(after.encoding, before.encoding); assert.deepEqual(after.bom, before.bom);
    assert.ok(after.text.startsWith('; 中文\n[config]\r\neffect=2\rfont=等线\n'));
    assert.match(after.text, /\[light\]\nr=18\ng=52\nb=86\na=128\n/);
  }
});

test('Explorer merge changes color and material while preserving toolbar choices', () => {
  const source = '[config]\neffect=1\nclearAddress=false\nclearWinUIBg=false\n[light]\nr=4\n[dark]\na=3\n[other]\nkeep=1\n';
  const text = decodeIni(mergeNativeIni(Buffer.from(source), recipe('explorer')).buffer).text;
  assert.match(text, /effect=2\nclearAddress=false\nclearWinUIBg=false/);
  assert.match(text, /\[light\]\nr=18\ng=52\nb=86\na=128/);
  assert.match(text, /\[dark\]\na=128\nr=18/);
  assert.ok(text.endsWith('[other]\nkeep=1\n'));
});

test('duplicate keys and sections get consistent values and missing keys go in the first section', () => {
  const text = decodeIni(mergeNativeIni(Buffer.from('[CONFIG]\neffectType=0\nEFFECTTYPE=1\n[custom]\nx=1\n[config]\nactiveBlendColor=4\n'), recipe('dwm')).buffer).text;
  assert.equal((text.match(/effecttype=3/ig) || []).length, 2);
  const first = text.split('[custom]')[0];
  assert.match(first, /activeBlendColor=2153133074/);
  assert.equal((text.match(/^activeBlendColor=2153133074$/gm) || []).length, 2);
});

test('invalid encodings, binary, malformed sections and oversized inputs are rejected', () => {
  for (const buffer of [Buffer.alloc(0), Buffer.from([0xc3,0x28]), Buffer.from('[config]\n\0bad=1'), Buffer.from([0xfe,0xff,0,1]), Buffer.from([0xff,0xfe,0x00,0xd8]), Buffer.from([0xff,0xfe,0x41]), Buffer.alloc(MAX_INI + 1)]) assert.throws(() => mergeNativeIni(buffer, recipe('dwm')));
  for (const text of ['{}', '[other]\nx=1', '[config]\n[bad]suffix\nx=1', '[config]\nmissing-equals', '[config]\nx' + ' '.repeat(65536)]) assert.throws(() => mergeNativeIni(Buffer.from(text), recipe('dwm')));
  assert.match(decodeIni(mergeNativeIni(Buffer.from('[config]\n[constructor]\n__proto__=preserve\n'), recipe('dwm')).buffer).text, /\[constructor\]\n__proto__=preserve/);
  assert.throws(() => mergeNativeIni(Buffer.from('[config]'), { engine: '__proto__', text: '' }));
});

test('exclusive export refuses input, other existing files, hard links and wrong extensions', t => {
  const root = fixture(t), original = path.join(root, 'source.ini'), other = path.join(root, 'existing.ini'), link = path.join(root, 'hardlink.ini');
  const bytes = utf16('[config]\neffectType=0\nfont=等线');
  fs.writeFileSync(original, bytes); fs.writeFileSync(other, 'keep'); fs.linkSync(original, link);
  const output = mergeNativeIni(readIni(original), recipe('dwm')).buffer;
  for (const target of [original, other, link]) assert.throws(() => writeNewIni(target, output), /新 INI/);
  assert.throws(() => writeNewIni(path.join(root, 'no.txt'), output), /\.ini/);
  const target = path.join(root, 'new.ini'); writeNewIni(target, output);
  assert.deepEqual(readIni(original), bytes); assert.deepEqual(fs.readFileSync(other), Buffer.from('keep'));
  assert.deepEqual(readIni(target), output);
});

test('bounded reader rejects directories and oversized files', t => {
  const root = fixture(t), file = path.join(root, 'large.ini');
  fs.writeFileSync(file, Buffer.alloc(MAX_INI + 1));
  assert.throws(() => readIni(file), /1 MB/); assert.throws(() => readIni(root));
});

test('Windows INI reader sees updated duplicate fields and preserved unknown values', { skip: process.platform !== 'win32' }, t => {
  const root = fixture(t), original = path.join(root, 'source.ini'), target = path.join(root, 'merged.ini');
  const source = utf16('; 中文\r\n[CONFIG]\r\nEffectType=0\r\nEFFECTTYPE=1\r\nfont=等线\r\napplyglobal=true\r\n[custom]\r\nkey=dummy-only\r\n[config]\r\nactiveBlendColor=0\r\n');
  fs.writeFileSync(original, source);
  writeNewIni(target, mergeNativeIni(readIni(original), recipe('dwm')).buffer);
  const script = `$ProgressPreference='SilentlyContinue';Add-Type @'\nusing System;using System.Text;using System.Runtime.InteropServices;public class IniMergeRead {[DllImport("kernel32.dll",CharSet=CharSet.Unicode)] public static extern int GetPrivateProfileString(string section,string key,string fallback,StringBuilder result,int size,string file);}\n'@\n$f=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(target).toString('base64')}'));$result=@{};foreach($key in @('effectType','activeBlendColor','font','applyglobal')){$b=[Text.StringBuilder]::new(100);[void][IniMergeRead]::GetPrivateProfileString('config',$key,'missing',$b,100,$f);$result[$key]=$b.ToString()};[Console]::OutputEncoding=[Text.Encoding]::UTF8;$result|ConvertTo-Json -Compress`;
  const raw = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, timeout: 20000, encoding: 'utf8' });
  const actual = JSON.parse(raw.replace(/^\ufeff/, ''));
  assert.deepEqual(actual, { effectType: '3', activeBlendColor: String(0x80563412), font: '等线', applyglobal: 'true' });
  assert.deepEqual(fs.readFileSync(original), source);
});
