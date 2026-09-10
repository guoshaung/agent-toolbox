'use strict';

/**
 * Voicebox 平台清单：把运行时平台映射到官方 GitHub Release 资产。
 * 资产名用正则匹配，版本变化（如 0.5.0 → 0.6.0）不需要改仓库代码。
 *
 * release 地址：https://github.com/jamiepine/voicebox/releases
 * 约定：
 *  - Windows x64   → Voicebox_<ver>_x64_en-US.msi（CPU 变体，msiexec /a 无提权解包）
 *  - macOS arm64   → Voicebox_aarch64.app.tar.gz（MLX，Apple Silicon）
 *  - macOS x64     → Voicebox_x64.app.tar.gz（MLX，Intel）
 *  - Windows CUDA  → voicebox-server-cuda.tar.gz（可选加速，用户点击后再下载）
 */

const MANIFESTS = {
  'win32-x64': {
    asset: /^Voicebox_[\d.]+_x64_en-US\.msi$/,
    extract: 'msiexec',
    // msiexec /a 解包后服务端相对路径（PATH 从解包根目录起算）
    serverRel: ['PFiles', 'Voicebox', 'voicebox-server.exe'],
    gpuAsset: /^voicebox-server-cuda\.tar\.gz$/,
    gpuRel: ['voicebox-server.exe'],
    display: 'Windows x64 (CPU)',
  },
  'darwin-arm64': {
    asset: /^Voicebox_aarch64\.app\.tar\.gz$/,
    extract: 'tar',
    serverRel: ['Voicebox.app', 'Contents', 'MacOS', 'voicebox-server'],
    display: 'macOS Apple Silicon (MLX)',
  },
  'darwin-x64': {
    asset: /^Voicebox_x64\.app\.tar\.gz$/,
    extract: 'tar',
    serverRel: ['Voicebox.app', 'Contents', 'MacOS', 'voicebox-server'],
    display: 'macOS Intel (MLX)',
  },
};

/** 按运行时平台解析清单；不支持的平台返回 null（保持合法错误路径可测）。 */
function resolveManifest(platform = process.platform, arch = process.arch) {
  const key = `${platform}-${arch}`;
  return MANIFESTS[key] ? { ...MANIFESTS[key], key, platform, arch } : null;
}

/** 在 release assets 里挑出本平台发行包（避免把 .sig/.dmg/.zip 误选）。 */
function pickAsset(manifest, assets) {
  if (!manifest) return null;
  return (Array.isArray(assets) ? assets : []).find((asset) => manifest.asset.test(asset.name)) || null;
}

function pickGpuAsset(manifest, assets) {
  if (!manifest || !manifest.gpuAsset) return null;
  return (Array.isArray(assets) ? assets : []).find((asset) => manifest.gpuAsset.test(asset.name)) || null;
}

/** 平台是否支持 Voicebox（win32-x64 / darwin-arm64 / darwin-x64）。 */
function isSupported(platform = process.platform, arch = process.arch) {
  return Boolean(resolveManifest(platform, arch));
}

module.exports = { MANIFESTS, resolveManifest, pickAsset, pickGpuAsset, isSupported };