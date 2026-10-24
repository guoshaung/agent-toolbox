'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const project = path.join(__dirname, '..');
const files = fs.readdirSync(path.join(project, 'test'))
  .filter((name) => name.endsWith('.test.js'))
  .sort()
  .map((name) => path.join(project, 'test', name));

if (files.length === 0) {
  console.error('No test/*.test.js files found');
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', ...files], { cwd: project, stdio: 'inherit' });
if (result.error) {
  console.error(result.error);
  process.exit(1);
}
process.exit(result.status ?? 1);
