'use strict';

const { createReadStream } = require('node:fs');
const { readFile, stat } = require('node:fs/promises');
const { createHash } = require('node:crypto');
const path = require('node:path');
let yaml;
try {
  yaml = require('js-yaml');
} catch (error) {
  console.error('Update artifact verification requires js-yaml (^4.3.2). Run npm ci first.');
  process.exitCode = 1;
  return;
}

async function main() {
  const directory = path.resolve(process.argv[2] || path.join(__dirname, '..', 'dist'));
  const version = process.argv[3] || require('../package.json').version;
  const metadata = yaml.load(await readFile(path.join(directory, 'latest.yml'), 'utf8'));
  if (metadata?.version !== version) {
    throw new Error(`latest.yml version must be ${version}; received ${metadata?.version}`);
  }
  if (!Array.isArray(metadata.files) || metadata.files.length !== 1) {
    throw new Error('latest.yml must describe exactly one Windows x64 installer');
  }

  const file = metadata.files[0];
  const filename = `Agent-Toolbox-${version}-win-x64.exe`;
  if (file?.url !== filename || metadata.path !== filename) {
    throw new Error(`latest.yml must reference ${filename}`);
  }
  const installer = path.join(directory, filename);
  const installerStat = await stat(installer);
  if (!installerStat.isFile() || installerStat.size <= 0 || installerStat.size !== file.size) {
    throw new Error(`Installer size does not match latest.yml: ${filename}`);
  }

  const hash = createHash('sha512');
  for await (const chunk of createReadStream(installer)) hash.update(chunk);
  const sha512 = hash.digest('base64');
  if (file.sha512 !== sha512 || metadata.sha512 !== sha512) {
    throw new Error(`Installer SHA-512 does not match latest.yml: ${filename}`);
  }

  const blockmapStat = await stat(`${installer}.blockmap`);
  if (!blockmapStat.isFile() || blockmapStat.size <= 0) {
    throw new Error(`Installer blockmap is missing or empty: ${filename}.blockmap`);
  }
  console.log(`Verified ${version}: latest.yml, ${filename} (${installerStat.size} bytes, SHA-512 matched), ${filename}.blockmap`);
}

main().catch((error) => {
  console.error(`Update artifact verification failed: ${error.message}`);
  process.exitCode = 1;
});
