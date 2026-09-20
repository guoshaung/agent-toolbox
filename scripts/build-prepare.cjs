'use strict';
// Runs even when electron-builder is called directly (for example macOS CI).
module.exports = async function () { require('./prepare-avatar-rig.cjs'); };
