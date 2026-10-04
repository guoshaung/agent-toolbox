'use strict';
const fs = require('node:fs');
function writeText(file, content, copyOnly = false) {
  try {
    fs.writeFileSync(file, content, { encoding: 'utf8', flag: copyOnly ? 'wx' : 'w' });
    return { ok: true, path: file, size: Buffer.byteLength(content) };
  } catch (error) {
    if (copyOnly && error.code === 'EEXIST') return { ok: false, error: '副本导出不能覆盖已有文件，请选择一个新文件名。' };
    return { ok: false, error: `保存失败：${error.message}` };
  }
}
module.exports = { writeText };
