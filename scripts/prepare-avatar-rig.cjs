'use strict';
// Bundle redistributable MIT viewer libraries; weights and reference art stay local.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const dest = path.join(root, 'container-seed/avatar-rig-studio/web/vendor');
fs.mkdirSync(dest, {recursive:true});
for (const part of ['build','examples/jsm']) {
  fs.cpSync(path.join(root,'node_modules/three',part),path.join(dest,'three',part),{recursive:true});
}
fs.copyFileSync(path.join(root,'node_modules/three/LICENSE'),path.join(dest,'three/LICENSE'));
fs.copyFileSync(path.join(root,'node_modules/@pixiv/three-vrm/lib/three-vrm.module.js'),path.join(dest,'three-vrm.module.js'));
fs.copyFileSync(path.join(root,'node_modules/@pixiv/three-vrm/LICENSE'),path.join(dest,'three-vrm-LICENSE'));
// electron-builder strips node_modules/**/examples, including runtime Three addons.
// Copy the loader's dependency closure into application assets before packaging.
const addonsSource = path.join(root, 'node_modules/three/examples/jsm');
const addonsDest = path.join(root, 'assets/avatar-three-addons');
const pending = ['loaders/GLTFLoader.js'];
const copied = new Set();
while (pending.length) {
  const relative = pending.pop();
  if (copied.has(relative)) continue;
  const source = path.resolve(addonsSource, relative);
  if (!source.startsWith(addonsSource + path.sep)) throw new Error('Invalid Three addon path');
  const target = path.join(addonsDest, relative);
  const content = fs.readFileSync(source, 'utf8');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  copied.add(relative);
  for (const match of content.matchAll(/\bfrom\s*['"](\.[^'"]+)['"]/g)) {
    pending.push(path.normalize(path.join(path.dirname(relative), match[1])));
  }
}
fs.copyFileSync(path.join(root, 'node_modules/three/LICENSE'), path.join(addonsDest, 'LICENSE'));
console.log('Avatar viewer assets prepared.');
