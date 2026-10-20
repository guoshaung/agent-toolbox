'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('avatar import maps resolve the packaged GLTFLoader and all relative dependencies outside node_modules/examples', () => {
  require('../scripts/prepare-avatar-rig.cjs');
  const root = path.resolve(__dirname, '..');
  for (const name of ['settings-panel.html', 'render-debug.html']) {
    const html = fs.readFileSync(path.join(root, 'src/avatar', name), 'utf8');
    const map = JSON.parse(html.match(/<script type="importmap"[^>]*>([\s\S]*?)<\/script>/)[1]);
    assert.equal(map.imports['three/addons/'], '../../assets/avatar-three-addons/');
    const pending = [path.resolve(root, 'src/avatar', map.imports['three/addons/'], 'loaders/GLTFLoader.js')];
    const seen = new Set();
    while (pending.length) {
      const file = pending.pop();
      if (seen.has(file)) continue;
      assert.ok(file.startsWith(path.join(root, 'assets') + path.sep));
      const content = fs.readFileSync(file, 'utf8');
      seen.add(file);
      for (const match of content.matchAll(/\bfrom\s*['"](\.[^'"]+)['"]/g)) {
        pending.push(path.resolve(path.dirname(file), match[1]));
      }
    }
    assert.ok(seen.size >= 3);
  }
});
