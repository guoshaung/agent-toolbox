'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveManifest, pickAsset, pickGpuAsset, isSupported } = require('../src/main/voicebox-platforms');

test('platforms：win32-x64 选 Windows MSI 资产', () => {
  const m = resolveManifest('win32', 'x64');
  assert.ok(m);
  assert.equal(m.extract, 'msiexec');
  assert.equal(m.asset.test('Voicebox_0.5.0_x64_en-US.msi'), true);
  assert.equal(m.asset.test('Voicebox_0.5.0_aarch64.dmg'), false);
  assert.equal(m.asset.test('voicebox-server-cuda.tar.gz'), false);
  assert.equal(m.serverRel[m.serverRel.length - 1], 'voicebox-server.exe');
  assert.ok(m.gpuAsset.test('voicebox-server-cuda.tar.gz'));
});

test('platforms：darwin-arm64 走官方 MLX app 包（不用 Docker / CUDA）', () => {
  const m = resolveManifest('darwin', 'arm64');
  assert.ok(m);
  assert.equal(m.extract, 'tar');
  assert.equal(m.asset.test('Voicebox_aarch64.app.tar.gz'), true);
  assert.equal(m.asset.test('Voicebox_0.5.0_x64_en-US.msi'), false);
  assert.equal(m.asset.test('voicebox-server-cuda.tar.gz'), false);
  assert.equal(m.serverRel[m.serverRel.length - 1], 'voicebox-server');
  assert.equal(m.gpuAsset, undefined, 'mac 不需要 CUDA 包');
});

test('platforms：darwin-x64 选 Intel MLX 包', () => {
  const m = resolveManifest('darwin', 'x64');
  assert.ok(m);
  assert.equal(m.extract, 'tar');
  assert.equal(m.asset.test('Voicebox_x64.app.tar.gz'), true);
  assert.equal(m.asset.test('Voicebox_aarch64.app.tar.gz'), false);
});

test('platforms：不支持平台返回 null', () => {
  assert.equal(resolveManifest('linux', 'x64'), null);
  assert.equal(resolveManifest('win32', 'arm64'), null);
  assert.equal(isSupported('linux', 'x64'), false);
  assert.equal(isSupported('win32', 'x64'), true);
  assert.equal(isSupported('darwin', 'arm64'), true);
});

test('platforms：pickAsset 从混合列表挑出本平台发行包', () => {
  const m = resolveManifest('win32', 'x64');
  const assets = [
    { name: 'cuda-libs-cu128-v1.tar.gz' },
    { name: 'Voicebox_0.5.0_x64_en-US.msi' },
    { name: 'Voicebox_0.5.0_x64_en-US.msi.sig' },
    { name: 'voicebox-server-cuda.tar.gz' },
  ];
  assert.equal(pickAsset(m, assets).name, 'Voicebox_0.5.0_x64_en-US.msi');
  assert.equal(pickGpuAsset(m, assets).name, 'voicebox-server-cuda.tar.gz');
});