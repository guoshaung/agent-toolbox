'use strict';
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
async function decodeIcon(input) {
  if (!Buffer.isBuffer(input) || input.length < 22 || input.length > 25 * 1024 * 1024 || input.readUInt16LE(0) !== 0 || ![1, 2].includes(input.readUInt16LE(2))) throw new Error('图标格式无效');
  const count = input.readUInt16LE(4);
  if (!count || count > 256 || 6 + 16 * count > input.length) throw new Error('图标目录无效');
  const entries = [];
  for (let index = 0; index < count; index++) {
    const at = 6 + index * 16, width = input[at] || 256, height = input[at + 1] || 256;
    const size = input.readUInt32LE(at + 8), offset = input.readUInt32LE(at + 12);
    if (!size || offset < 6 + 16 * count || offset + size > input.length) throw new Error('图标数据范围无效');
    entries.push({ width, height, bytes: input.subarray(offset, offset + size) });
  }
  entries.sort((a, b) => b.width * b.height - a.width * a.height);
  for (const entry of entries) {
    const { bytes, width, height } = entry;
    if (bytes.subarray(0, 8).equals(PNG)) {
      const sharp = require('sharp'), meta = await sharp(bytes, { limitInputPixels: 1_048_576 }).metadata();
      if (meta.width !== width || meta.height !== height) throw new Error('图标图像尺寸不匹配');
      return sharp(bytes).png().toBuffer();
    }
    if (bytes.length < 40) continue;
    const header = bytes.readUInt32LE(0), w = bytes.readInt32LE(4), h = bytes.readInt32LE(8), bits = bytes.readUInt16LE(14), compression = bytes.readUInt32LE(16);
    if (header < 40 || header > bytes.length || w !== width || ![height, height * 2].includes(Math.abs(h)) || bytes.readUInt16LE(12) !== 1 || ![1, 4, 8, 24, 32].includes(bits) || compression !== 0) continue;
    const colors = bits <= 8 ? (bytes.readUInt32LE(32) || 2 ** bits) : 0;
    if (colors > 256) throw new Error('图标调色板无效');
    const pixels = header + colors * 4, stride = Math.ceil(width * bits / 32) * 4, maskStride = Math.ceil(width / 32) * 4, mask = pixels + stride * height;
    if (mask > bytes.length) throw new Error('图标像素数据截断');
    const hasMask = mask + maskStride * height <= bytes.length, rgba = Buffer.alloc(width * height * 4);
    let alphaPresent = false;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const row = h < 0 ? y : height - 1 - y, at = pixels + row * stride, out = (y * width + x) * 4;
      let color, alpha = 255;
      if (bits <= 8) {
        const byte = bytes[at + Math.floor(x * bits / 8)], index = bits === 8 ? byte : bits === 4 ? (byte >> (x % 2 ? 0 : 4)) & 15 : (byte >> (7 - x % 8)) & 1;
        if (index >= colors) throw new Error('图标调色板索引无效'); color = header + index * 4;
      } else { color = at + x * bits / 8; if (bits === 32) { alpha = bytes[color + 3]; alphaPresent ||= alpha !== 0; } }
      rgba[out] = bytes[color + 2]; rgba[out + 1] = bytes[color + 1]; rgba[out + 2] = bytes[color]; rgba[out + 3] = alpha;
    }
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const out = (y * width + x) * 4 + 3, row = h < 0 ? y : height - 1 - y;
      if (bits === 32 && !alphaPresent) rgba[out] = 255;
      if (hasMask && (bytes[mask + row * maskStride + Math.floor(x / 8)] & (1 << (7 - x % 8)))) rgba[out] = 0;
    }
    return require('sharp')(rgba, { raw: { width, height, channels: 4 } }).png().toBuffer();
  }
  throw new Error('图标没有可解码的 PNG 或未压缩 DIB 图像');
}
module.exports = { decodeIcon };
