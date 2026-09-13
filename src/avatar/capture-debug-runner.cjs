'use strict';

const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

app.commandLine.appendSwitch('use-fake-ui-for-media-stream');

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media');
  });

  const window = new BrowserWindow({
    width: 960,
    height: 760,
    backgroundColor: '#080b12',
    webPreferences: { sandbox: true },
  });
  window.webContents.on('console-message', (_event, _level, message) => {
    console.error(`[capture debug] ${message}`);
  });
  await window.loadFile(path.join(__dirname, 'capture-debug.html'));

  const deadline = Date.now() + 20_000;
  let detected = false;
  while (Date.now() < deadline) {
    detected = await window.webContents.executeJavaScript(
      "document.querySelector('#status')?.dataset.detected === 'true'",
    );
    if (detected) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!detected) throw new Error('No face was detected before the screenshot deadline');

  await new Promise((resolve) => setTimeout(resolve, 1500));
  const screenshot = await window.webContents.capturePage();
  await fs.writeFile(path.join(__dirname, 'capture-debug.png'), screenshot.toPNG());
  app.quit();
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
