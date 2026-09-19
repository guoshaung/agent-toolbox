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
console.log('Avatar viewer assets prepared.');
