export const LIMITS = Object.freeze({ sourceBytes: 64 * 1024 * 1024, outputBytes: 20 * 1024 * 1024, frameBytes: 1024 * 1024, contactBytes: 8 * 1024 * 1024, durationMs: 120000, frames: 32, probeBytes: 131072 });
export function fail(code) { throw Object.assign(new Error(code), { code }); }
export function exact(value, keys) { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join('|') !== [...keys].sort().join('|')) fail('INVALID_PAYLOAD'); }
function positive(v, code) { const n = Number(v); if (!Number.isFinite(n) || n <= 0) fail(code); return n; }
export function versionBanner(text, name) {
  if (typeof text !== 'string' || text.length > LIMITS.probeBytes) fail('ENGINE_OUTPUT_LIMIT');
  const match = text.match(new RegExp('^' + name + ' version (6\\.\\d+(?:\\.\\d+)?)(?:[-\\s]|$)'));
  if (!match) fail('ENGINE_VERSION_UNSUPPORTED');
  return match[1];
}
export function encoderSupport(text) { if(typeof text!=='string'||text.length>131072||!/^\s*V[^\s]{5}\s+png\s/m.test(text))fail('PNG_ENCODER_UNAVAILABLE');return ['png']; }
export function parseProbe(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > LIMITS.probeBytes) fail('PROBE_LIMIT');
  let p; try { p = JSON.parse(text); } catch { fail('PROBE_JSON_INVALID'); }
  if (!p || !Array.isArray(p.streams) || !p.format || p.streams.length < 1 || p.streams.length > 2 || (p.chapters && (!Array.isArray(p.chapters) || p.chapters.length))) fail('STREAM_SCOPE_UNSUPPORTED');
  if (!String(p.format.format_name).split(',').includes('mp4')) fail('MP4_REQUIRED');
  const durationMs = Math.round(positive(p.format.duration, 'DURATION_INVALID') * 1000);
  if (durationMs > LIMITS.durationMs) fail('DURATION_LIMIT');
  const videos = p.streams.filter(s => s.codec_type === 'video'), audios = p.streams.filter(s => s.codec_type === 'audio');
  if (videos.length !== 1 || videos.length + audios.length !== p.streams.length || audios.length > 1) fail('STREAM_SCOPE_UNSUPPORTED');
  const v = videos[0];
  if (v.codec_name !== 'h264' || v.pix_fmt !== 'yuv420p' || (v.disposition?.attached_pic || 0) || (v.sample_aspect_ratio !== '1:1' && v.sample_aspect_ratio !== undefined) || ['smpte2084', 'arib-std-b67'].includes(v.color_transfer)) fail('VIDEO_SCOPE_UNSUPPORTED');
  if (!Number.isInteger(v.width) || !Number.isInteger(v.height) || v.width < 2 || v.height < 2 || v.width > 1920 || v.height > 1080) fail('DIMENSION_LIMIT');
  const rate = String(v.avg_frame_rate).match(/^(\d+)\/(\d+)$/); const fps = rate ? Number(rate[1]) / Number(rate[2]) : NaN;
  if (!Number.isFinite(fps) || fps <= 0 || fps > 60) fail('FRAME_RATE_UNSUPPORTED');
  for (const stream of p.streams) {
    if (!Number.isInteger(stream.index) || stream.index < 0 || stream.index > 8 || !Number.isFinite(Number(stream.start_time)) || Math.abs(Number(stream.start_time)) > .001) fail('TIMESTAMP_SCOPE_UNSUPPORTED');
    if (stream.side_data_list && (!Array.isArray(stream.side_data_list) || stream.side_data_list.some(d => d.rotation === undefined || Number(d.rotation) !== 0))) fail('SIDE_DATA_UNSUPPORTED');
  }
  let audio = null;
  if (audios.length) { const a = audios[0], sampleRate = positive(a.sample_rate, 'AUDIO_SCOPE_UNSUPPORTED'); if (a.codec_name !== 'aac' || ![1, 2].includes(a.channels) || !Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 48000) fail('AUDIO_SCOPE_UNSUPPORTED'); audio = { index: a.index, codec: 'aac', sampleRate, channels: a.channels }; }
  return { durationMs, video: { index: v.index, codec: 'h264', width: v.width, height: v.height, fps, pixelFormat: 'yuv420p' }, audio };
}
export const probeArgs = source => ['-v', 'error', '-protocol_whitelist', 'file', '-f', 'mov', '-enable_drefs', '0', '-use_absolute_path', '0', '-show_entries', 'format=format_name,duration:stream=index,codec_type,codec_name,width,height,avg_frame_rate,sample_rate,channels,start_time,pix_fmt,sample_aspect_ratio,color_transfer:stream_disposition=attached_pic:stream_side_data=rotation:chapter=id', '-of', 'json', source];
export function buildPlan(source, selection) {
  if (!source?.media || !Number.isSafeInteger(source.bytes) || source.bytes < 1 || source.bytes > LIMITS.sourceBytes || !/^[a-f0-9]{64}$/.test(source.sha256)) fail('SOURCE_INVALID');
  exact(selection, ['mode', 'timesMs', 'intervalMs']);
  let times;
  if (selection.mode === 'points') {
    if (selection.intervalMs !== null || !Array.isArray(selection.timesMs) || selection.timesMs.length < 1 || selection.timesMs.length > 32) fail('POINT_COUNT');
    times = selection.timesMs.slice();
  } else if (selection.mode === 'interval') {
    if (selection.timesMs !== null || !Number.isSafeInteger(selection.intervalMs) || selection.intervalMs < 100 || selection.intervalMs > LIMITS.durationMs) fail('INTERVAL_INVALID');
    const count = Math.ceil(source.media.durationMs / selection.intervalMs); if (count > 32) fail('POINT_COUNT');
    times = Array.from({ length: count }, (_, i) => i * selection.intervalMs);
  } else fail('SELECTION_MODE');
  if (times.some(t => !Number.isSafeInteger(t) || t < 0 || t >= source.media.durationMs) || new Set(times).size !== times.length) fail('POINT_RANGE_OR_DUPLICATE');
  const ratio = Math.min(1, 640 / source.media.video.width, 360 / source.media.video.height);
  const width = Math.max(2, Math.floor(source.media.video.width * ratio)), height = Math.max(2, Math.floor(source.media.video.height * ratio));
  return { format: 'T043-extraction-plan', version: 1, source: { name: source.name, bytes: source.bytes, sha256: source.sha256, media: source.media }, selection, requests: times.map((requestedMs, i) => ({ sequence: i + 1, path: `frame-${String(i + 1).padStart(2, '0')}.png`, requestedMs })), image: { format: 'PNG', color: 'RGB8', width, height, scaling: 'preserve-aspect-no-upscale-max640x360' }, contact: { path: 'contact-sheet.png', columns: 3, rows: Math.ceil(times.length / 3), cellWidth: 320, cellHeight: 200, padding: 8, margin: 8, width: 992, height: Math.ceil(times.length / 3) * 200 + (Math.ceil(times.length / 3) + 1) * 8 }, notes: ['按列表顺序输出；每请求独立完整解码，选第一个源PTS大于或等于请求的帧，不是最近帧/最近关键帧。', '实际时间由select后的showinfo整数PTS与time_base计算，单独保留请求和正偏差；若请求后没有帧整份拒绝。', 'PNG为画面像素副本，无音频/视频总结；缩小可能丢细节。联系表从已生成PNG按顺序拼接；行列位置由索引解释。'], limits: LIMITS };
}
export function extractArgs(plan, request, source, output) {
  return ['-hide_banner', '-loglevel', 'info', '-nostdin', '-n', '-threads', '2', '-filter_threads', '1', '-protocol_whitelist', 'file', '-f', 'mov', '-enable_drefs', '0', '-use_absolute_path', '0', '-noautorotate', '-copyts', '-i', source, '-map', '0:v:0', '-an', '-sn', '-dn', '-vf', `select=gte(t\\,${(request.requestedMs / 1000).toFixed(3)}),showinfo,scale=${plan.image.width}:${plan.image.height},setsar=1,format=rgb24`, '-frames:v', '1', '-fps_mode', 'passthrough', '-c:v', 'png', '-threads', '1', '-map_metadata', '-1', '-update', '1', '-fs', String(LIMITS.frameBytes), '-f', 'image2', output];
}
export function contactArgs(plan, inputPattern, output) {
  return ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-threads', '2', '-filter_threads', '1', '-protocol_whitelist', 'file', '-f', 'image2', '-start_number', '1', '-framerate', '1', '-i', inputPattern, '-vf', `scale=320:180:force_original_aspect_ratio=decrease,pad=320:200:(ow-iw)/2:0:color=black,tile=3x${plan.contact.rows}:nb_frames=${plan.requests.length}:padding=8:margin=8:color=black`, '-frames:v', '1', '-c:v', 'png', '-pix_fmt', 'rgb24', '-threads', '1', '-update', '1', '-fs', String(LIMITS.contactBytes), '-f', 'image2', output];
}
export function actualTimestamp(log, requestedMs, durationMs) {
  if (typeof log !== 'string' || new TextEncoder().encode(log).length > 131072) fail('FRAME_LOG_LIMIT');
  const configs = [...log.matchAll(/\[Parsed_showinfo_\d+ @ [^\]]+\] config in time_base:\s*(\d+)\/(\d+),/g)];
  const entries = [...log.matchAll(/\[Parsed_showinfo_\d+ @ [^\]]+\]\s+n:\s*(\d+)\s+pts:\s*(-?\d+)\s+pts_time:\s*([0-9.eE+-]+)/g)].filter(e => Number(e[1]) === 0);
  if (configs.length !== 1 || entries.length !== 1) fail('FRAME_TIMESTAMP_MISSING_OR_AMBIGUOUS');
  const numerator = Number(configs[0][1]), denominator = Number(configs[0][2]), pts = Number(entries[0][2]), loggedSeconds = Number(entries[0][3]);
  if (![numerator, denominator, pts].every(Number.isSafeInteger) || numerator < 1 || denominator < 1 || numerator > 1e9 || denominator > 1e9 || Math.abs(pts) > 1e12) fail('FRAME_TIMEBASE_UNSUPPORTED');
  const actualMs = pts * numerator * 1000 / denominator;
  if (!Number.isFinite(actualMs) || !Number.isFinite(loggedSeconds) || Math.abs(actualMs - loggedSeconds * 1000) > 1 || actualMs + .0000001 < requestedMs || actualMs < 0 || actualMs >= durationMs) fail('FRAME_TIMESTAMP_INCONSISTENT');
  return { pts, timeBase: { numerator, denominator }, actualMs, actualSeconds: pts * numerator / denominator, deltaMs: actualMs - requestedMs, evidence: 'FFmpeg select → showinfo n=0; source timestamp, before scale, no setpts', loggedSeconds };
}
export function pngInfo(bytes, maxBytes, maxWidth, maxHeight) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 57 || bytes.length >= maxBytes) fail('PNG_SIZE_OR_STRUCTURE');
  const signature = [137, 80, 78, 71, 13, 10, 26, 10]; if (signature.some((n, i) => bytes[i] !== n)) fail('PNG_SIGNATURE');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); let offset = 8, count = 0, idat = false, ended = false, width = 0, height = 0;
  const crc = (from, end) => { let c = 0xffffffff; for (let i = from; i < end; i++) { c ^= bytes[i]; for (let b = 0; b < 8; b++) c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0); } return (c ^ 0xffffffff) >>> 0; };
  while (offset < bytes.length) {
    if (++count > 1024 || offset + 12 > bytes.length) fail('PNG_STRUCTURE'); const length = view.getUint32(offset), end = offset + 12 + length; if (end > bytes.length) fail('PNG_TRUNCATED'); const type = String.fromCharCode(...bytes.slice(offset + 4, offset + 8)); if (crc(offset + 4, offset + 8 + length) !== view.getUint32(offset + 8 + length)) fail('PNG_CRC');
    if (count === 1) { if (type !== 'IHDR' || length !== 13) fail('PNG_IHDR'); width = view.getUint32(offset + 8); height = view.getUint32(offset + 12); if (bytes[offset + 16] !== 8 || bytes[offset + 17] !== 2 || bytes[offset + 18] !== 0 || bytes[offset + 19] !== 0 || bytes[offset + 20] !== 0 || width < 1 || height < 1 || width > maxWidth || height > maxHeight) fail('PNG_DOMAIN'); }
    else if (type === 'IHDR' || !['pHYs', 'IDAT', 'IEND'].includes(type)) fail('PNG_CHUNK_UNSUPPORTED');
    if (type === 'IDAT') idat = true; if (type === 'IEND') { if (length !== 0 || !idat || end !== bytes.length) fail('PNG_END'); ended = true; } offset = end;
  }
  if (!ended) fail('PNG_END'); return { width, height, bytes: bytes.length, format: 'PNG/RGB8' };
}
