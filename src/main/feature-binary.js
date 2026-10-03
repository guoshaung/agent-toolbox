'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const MAX_BYTES = 10 * 1024 * 1024;
function validateBinary(payload) {
  if (!payload || payload.copyOnly !== true || typeof payload.base64 !== 'string' || payload.base64.length > Math.ceil(MAX_BYTES / 3) * 4 || payload.base64.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(payload.base64)) throw Error('二进制副本需copyOnly=true及不超过10MiB的规范Base64。');
  const bytes = Buffer.from(payload.base64, 'base64');
  if (bytes.length > MAX_BYTES || bytes.toString('base64') !== payload.base64) throw Error('Base64不是规范编码或超过10MiB。');
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  if (payload.sha256 !== sha256) throw Error('SHA-256不匹配，未打开保存对话框。');
  return { bytes, sha256 };
}
function writeBinaryCopy(target, payload, { writeFile = fs.writeFileSync } = {}) {
  let fd, createdIdentity;
  try {
    const { bytes, sha256 } = validateBinary(payload);
    if (typeof target !== 'string' || !path.isAbsolute(target)) throw Error('保存目标须来自原生对话框。');
    fd = fs.openSync(target, 'wx', 0o600);
    createdIdentity = fs.fstatSync(fd);
    writeFile(fd, bytes);
    fs.closeSync(fd); fd = undefined;
    return { ok: true, path: target, size: bytes.length, sha256 };
  } catch (error) {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch {} }
    if (createdIdentity) {
      try {
        const current = fs.lstatSync(target);
        if (current.isSymbolicLink() || current.ino !== createdIdentity.ino || current.dev !== createdIdentity.dev) return { ok: false, error: '写入失败且新副本状态已改变，请人工核对。', partialPath: target };
        fs.unlinkSync(target);
      } catch (cleanup) { if (cleanup.code !== 'ENOENT') return { ok: false, error: '写入失败，未完成新副本清理，请人工核对。', partialPath: target }; }
    }
    return { ok: false, error: error.code === 'EEXIST' ? '二进制副本不能覆盖已有文件。' : '二进制副本写入失败；请核对文件权限、容量及输入摘要。' };
  }
}
function registerBinaryIpc(ipcMain, { dialog, getWindow, getDownloads }) {
  ipcMain.handle('files:saveBinary', async (_event, payload) => {
    try { validateBinary(payload); } catch (error) { return { ok: false, error: error.message }; }
    const raw = payload.defaultName;
    const name = typeof raw === 'string' && raw.length <= 120 && raw.length > 0 && !/[\x00-\x1f\x7f<>:"|?*\\/]/u.test(raw) && !/[. ]$/u.test(raw) && !/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(raw) && Buffer.from(raw).toString('utf8') === raw ? raw : 'binary-copy.bin';
    try {
      const choice = await dialog.showSaveDialog(getWindow(), { title: '保存二进制新副本（不覆盖已有文件）', defaultPath: path.join(getDownloads(), name) });
      if (choice.canceled || !choice.filePath) return { ok: false, canceled: true };
      return writeBinaryCopy(choice.filePath, payload);
    } catch { return { ok: false, error: '保存对话框未完成，未报告副本成功。' }; }
  });
}
module.exports = { MAX_BYTES, validateBinary, writeBinaryCopy, registerBinaryIpc };
