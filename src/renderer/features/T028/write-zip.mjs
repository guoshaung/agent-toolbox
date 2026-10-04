import {crc32} from './zip.mjs';
const enc=new TextEncoder(),fail=code=>{const e=new Error('ZIP output refused');e.code=code;throw e};
// Complete ordinary Store ZIP, fixed metadata, canonical UTF8 names, CRC both headers.
export function writeZip(parts) {
 let total = 22; const records = parts.map(p => { const name = enc.encode(p.path), data = p.data; total += 76 + name.length * 2 + data.length; return { name, data, crc: crc32(data) }; }); if (total > 2097152) fail('output_docx_bytes'); const out = new Uint8Array(total), v = new DataView(out.buffer); let at = 0; const offsets = [];
 for (const r of records) { offsets.push(at); v.setUint32(at, 0x04034b50, true); v.setUint16(at + 4, 20, true); v.setUint16(at + 6, 2048, true); v.setUint16(at + 12, 33, true); v.setUint32(at + 14, r.crc, true); v.setUint32(at + 18, r.data.length, true); v.setUint32(at + 22, r.data.length, true); v.setUint16(at + 26, r.name.length, true); out.set(r.name, at + 30); out.set(r.data, at + 30 + r.name.length); at += 30 + r.name.length + r.data.length; }
 const central = at; for (let i = 0; i < records.length; i++) { const r = records[i]; v.setUint32(at, 0x02014b50, true); v.setUint16(at + 4, 20, true); v.setUint16(at + 6, 20, true); v.setUint16(at + 8, 2048, true); v.setUint16(at + 14, 33, true); v.setUint32(at + 16, r.crc, true); v.setUint32(at + 20, r.data.length, true); v.setUint32(at + 24, r.data.length, true); v.setUint16(at + 28, r.name.length, true); v.setUint32(at + 42, offsets[i], true); out.set(r.name, at + 46); at += 46 + r.name.length; }
 v.setUint32(at, 0x06054b50, true); v.setUint16(at + 8, records.length, true); v.setUint16(at + 10, records.length, true); v.setUint32(at + 12, at - central, true); v.setUint32(at + 16, central, true); return out;
}
