'use strict';

const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const modelPath = process.argv[2];
if (!modelPath) {
  console.error('Usage: electron render-debug-runner.cjs <model.vrm>');
  process.exitCode = 1;
  app.quit();
} else {
  app.whenReady().then(async () => {
    const window = new BrowserWindow({
      width: 720,
      height: 720,
      transparent: true,
      backgroundColor: '#00000000',
      show: true,
      webPreferences: { sandbox: true, backgroundThrottling: false },
    });
    window.webContents.on('console-message', (_event, _level, message) => {
      console.log(`[render debug] ${message}`);
    });
    await window.loadFile(path.join(__dirname, 'render-debug.html'), {
      query: { model: pathToFileURL(path.resolve(modelPath)).href },
    });
    await window.webContents.executeJavaScript('window.renderDebugReady');
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const dataUrl = await window.webContents.executeJavaScript('window.recordMockDemo(5000)');
    const comma = dataUrl.indexOf(',');
    await fs.writeFile(
      path.join(__dirname, 'render-debug.webm'),
      Buffer.from(dataUrl.slice(comma + 1), 'base64'),
    );
    const measuredFps = await window.webContents.executeJavaScript("document.querySelector('#fps').textContent");
    console.log(`Recorded mock animation at ${measuredFps} FPS`);
    app.quit();
  }).catch((error) => {
    console.error(error);
    app.exit(1);
  });
}
