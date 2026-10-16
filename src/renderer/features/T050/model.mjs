export const LIMITS = Object.freeze({ sourceBytes: 64 * 1024 * 1024, outputBytes: 65 * 1024 * 1024, durationMs: 600000, chapters: 64, probeBytes: 131072 });
export function fail(code) { throw Object.assign(new Error(code), { code }); }
export function exact(value, keys) { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join('|') !== [...keys].sort().join('|')) fail('INVALID_PAYLOAD'); }
function positive(v, code) { const n = Number(v); if (!Number.isFinite(n) || n <= 0) fail(code); return n; }
export function versionBanner(text, name) {
  if (typeof text !== 'string' || text.length > LIMITS.probeBytes) fail('ENGINE_OUTPUT_LIMIT');
  const match = text.match(new RegExp('^' + name + ' version (6\\.\\d+(?:\\.\\d+)?)(?:[-\\s]|$)'));
  if (!match) fail('ENGINE_VERSION_UNSUPPORTED');
  return match[1];
}
export function muxerSupport(text) {
  if (typeof text !== 'string' || text.length > LIMITS.probeBytes) fail('ENGINE_OUTPUT_LIMIT');
  if (!/^\s*E\s+mp4\s/m.test(text)) fail('MP4_MUXER_UNAVAILABLE');
  return ['mp4'];
}
export function parseProbe(text, output = false) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > LIMITS.probeBytes) fail('PROBE_LIMIT');
  let p; try { p = JSON.parse(text); } catch { fail('PROBE_JSON_INVALID'); }
  if (!p || !Array.isArray(p.streams) || !p.format || p.streams.length < 1 || p.streams.length > (output ? 3 : 2) || !Array.isArray(p.chapters) || (!output && p.chapters.length) || p.chapters.length > LIMITS.chapters) fail('STREAM_SCOPE_UNSUPPORTED');
  if (!String(p.format.format_name).split(',').includes('mp4')) fail('MP4_REQUIRED');
  const durationMs = Math.round(positive(p.format.duration, 'DURATION_INVALID') * 1000);
  if (durationMs > LIMITS.durationMs) fail('DURATION_LIMIT');
  const data = p.streams.filter(s => s.codec_type === 'data'); if (data.length && (!output || data.length !== 1 || data[0].codec_name !== 'bin_data' || data[0].codec_tag_string !== 'text' || data[0].tags?.handler_name !== 'SubtitleHandler')) fail('DATA_TRACK_UNSUPPORTED');
  const videos = p.streams.filter(s => s.codec_type === 'video'), audios = p.streams.filter(s => s.codec_type === 'audio');
  if (videos.length !== 1 || videos.length + audios.length + data.length !== p.streams.length || audios.length > 1) fail('STREAM_SCOPE_UNSUPPORTED');
  const v = videos[0];
  if (v.codec_name !== 'h264' || v.pix_fmt !== 'yuv420p' || (v.disposition?.attached_pic || 0) || (v.sample_aspect_ratio !== '1:1' && v.sample_aspect_ratio !== undefined) || ['smpte2084', 'arib-std-b67'].includes(v.color_transfer)) fail('VIDEO_SCOPE_UNSUPPORTED');
  if (!Number.isInteger(v.width) || !Number.isInteger(v.height) || v.width < 2 || v.height < 2 || v.width > 1920 || v.height > 1080) fail('DIMENSION_LIMIT');
  const rate = String(v.avg_frame_rate).match(/^(\d+)\/(\d+)$/); const fps = rate ? Number(rate[1]) / Number(rate[2]) : NaN;
  if (!Number.isFinite(fps) || fps <= 0 || fps > 60) fail('FRAME_RATE_UNSUPPORTED');
  for (const stream of p.streams.filter(s => s.codec_type !== 'data')) {
    if (!Number.isInteger(stream.index) || stream.index < 0 || stream.index > 8 || !Number.isFinite(Number(stream.start_time)) || Math.abs(Number(stream.start_time)) > .001) fail('TIMESTAMP_SCOPE_UNSUPPORTED');
    if (stream.side_data_list && (!Array.isArray(stream.side_data_list) || stream.side_data_list.some(d => d.rotation === undefined || Number(d.rotation) !== 0))) fail('SIDE_DATA_UNSUPPORTED');
  }
  let audio = null;
  if (audios.length) { const a = audios[0], sampleRate = positive(a.sample_rate, 'AUDIO_SCOPE_UNSUPPORTED'); if (a.codec_name !== 'aac' || ![1, 2].includes(a.channels) || !Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 48000) fail('AUDIO_SCOPE_UNSUPPORTED'); audio = { index: a.index, codec: 'aac', sampleRate, channels: a.channels }; }
  return { durationMs, video: { index: v.index, codec: 'h264', width: v.width, height: v.height, fps, pixelFormat: 'yuv420p' }, audio, chapters: p.chapters.map(parseChapter), chapterDataTrack: data.length === 1 };
}
function parseChapter(c) {
  const t = String(c?.time_base).match(/^(\d+)\/(\d+)$/), start = c?.start, end = c?.end;
  if (!t || !Number(t[1]) || !Number(t[2]) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || Number(t[1]) > 1000000 || Number(t[2]) > 1000000 || typeof c?.tags?.title !== 'string') fail('CHAPTER_PROBE_INVALID');
  const startMs = start * Number(t[1]) * 1000 / Number(t[2]), endMs = end * Number(t[1]) * 1000 / Number(t[2]);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs > LIMITS.durationMs + 1) fail('CHAPTER_PROBE_INVALID');
  return { startMs, endMs, title: c.tags.title, timeBase: c.time_base };
}
export function buildPlan(source, chapters) {
  if (!source?.media || !/^[a-f0-9]{64}$/.test(source.sha256) || !Number.isSafeInteger(source.bytes) || source.bytes < 1 || source.bytes > LIMITS.sourceBytes) fail('SOURCE_INVALID');
  if (!Array.isArray(chapters) || chapters.length < 1 || chapters.length > LIMITS.chapters) fail('CHAPTER_COUNT');
  const titles = new Set(); let previous = -1;
  const timeline = chapters.map((c, i) => {
    exact(c, ['startMs', 'title']);
    if (!Number.isSafeInteger(c.startMs) || c.startMs < 0 || c.startMs >= source.media.durationMs || c.startMs <= previous) fail('CHAPTER_ORDER_DUPLICATE_OR_RANGE');
    if (i === 0 && c.startMs !== 0) fail('FIRST_CHAPTER_MUST_START_AT_ZERO');
    const title = c.title;
    if (typeof title !== 'string' || !title.length || [...title].length > 80 || new TextEncoder().encode(title).length > 240 || title !== title.trim() || title.normalize('NFC') !== title || /[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/.test(title) || [...title].some(ch => { const n = ch.codePointAt(0); return n >= 0xd800 && n <= 0xdfff; })) fail('CHAPTER_TITLE_INVALID');
    if (titles.has(title)) fail('DUPLICATE_CHAPTER_TITLE'); titles.add(title); previous = c.startMs;
    return { sequence: i + 1, startMs: c.startMs, endMs: chapters[i + 1]?.startMs ?? source.media.durationMs, title };
  });
  return { format: 'T050-chapter-plan', version: 1, source: { name: source.name, bytes: source.bytes, sha256: source.sha256, media: source.media }, chapters: timeline, unchapteredPrefixMs: timeline[0].startMs, expectedDurationMs: source.media.durationMs, output: { container: 'mp4', video: { ...source.media.video }, audio: source.media.audio ? { ...source.media.audio } : null, operation: 'stream-copy-remux-with-explicit-chapters; no-transcoding' }, limits: LIMITS, notes: ['列表顺序严格递增，重复时间/标题和越界整体拒绝，不自动排序或修正。', '章节终点是下一章节起点，末章节终点是完整媒体时长。首章必须为0毫秒，以避免MP4章节轨对非零首点归零的歧义；媒体不截断。', '固定-c copy重封装原音视频，不改变尺寸、帧率、声音或重编码；容器布局和文件SHA改变。', 'MP4章节包含容器生成的text数据轨，播放器章节菜单支持不一致；工具另提供逐章实际成片跳转。', '源已有章节/字幕/数据轨整体拒绝，暂不替换或合并旧章节；不能冒称保留任意未知轨道。'] };
}
export function chapterMetadata(plan) {
  const escape = title => title.replace(/[\\=;#]/g, c => '\\' + c);
  const text = ';FFMETADATA1\n' + plan.chapters.map(c => `[CHAPTER]\nTIMEBASE=1/1000\nSTART=${c.startMs}\nEND=${c.endMs}\ntitle=${escape(c.title)}\n`).join('');
  if (new TextEncoder().encode(text).length > 32768) fail('METADATA_LIMIT');
  return text;
}
export const probeArgs = source => ['-v', 'error', '-protocol_whitelist', 'file', '-f', 'mov', '-enable_drefs', '0', '-use_absolute_path', '0', '-show_entries', 'format=format_name,duration:stream=index,codec_type,codec_name,codec_tag_string,width,height,avg_frame_rate,sample_rate,channels,start_time,pix_fmt,sample_aspect_ratio,color_transfer:stream_disposition=attached_pic:stream_side_data=rotation:stream_tags=handler_name:chapter=id,time_base,start,end,start_time,end_time:chapter_tags=title', '-of', 'json', source];
export function remuxArgs(source, metadata, output) {
  return ['-hide_banner', '-loglevel', 'error', '-xerror', '-nostdin', '-n', '-threads', '2', '-protocol_whitelist', 'file', '-f', 'mov', '-enable_drefs', '0', '-use_absolute_path', '0', '-i', source, '-protocol_whitelist', 'file', '-f', 'ffmetadata', '-i', metadata, '-map', '0:v:0', '-map', '0:a:0?', '-c', 'copy', '-map_metadata', '0', '-map_chapters', '1', '-movflags', '+faststart', '-write_btrt', '0', '-fs', String(LIMITS.outputBytes), '-f', 'mp4', output];
}
export const decodeArgs = source => ['-hide_banner', '-loglevel', 'error', '-xerror', '-nostdin', '-threads', '2', '-protocol_whitelist', 'file', '-f', 'mov', '-enable_drefs', '0', '-use_absolute_path', '0', '-i', source, '-map', '0:v:0', '-map', '0:a:0?', '-f', 'null', '-'];
export function verifyOutput(plan, media, bytes, sha256) {
  if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes >= LIMITS.outputBytes || !/^[a-f0-9]{64}$/.test(sha256)) fail('OUTPUT_SIZE_OR_HASH');
  const v = plan.output.video, a = plan.output.audio, deltaMs = media.durationMs - plan.expectedDurationMs;
  if (Math.abs(deltaMs) > 100 || media.video.codec !== v.codec || media.video.width !== v.width || media.video.height !== v.height || media.video.fps !== v.fps || !!media.audio !== !!a || media.audio && (media.audio.codec !== a.codec || media.audio.sampleRate !== a.sampleRate || media.audio.channels !== a.channels)) fail('OUTPUT_MEDIA_VERIFICATION_FAILED');
  if (media.chapters.length !== plan.chapters.length || media.chapters.some((c, i) => c.title !== plan.chapters[i].title || Math.abs(c.startMs - plan.chapters[i].startMs) > .5 || Math.abs(c.endMs - plan.chapters[i].endMs) > .5)) fail('OUTPUT_CHAPTER_VERIFICATION_FAILED');
  return { name: 'chaptered.mp4', bytes, sha256, expectedDurationMs: plan.expectedDurationMs, actualDurationMs: media.durationMs, differenceMs: deltaMs, media, chapters: media.chapters, completeDecode: true, operation: 'stream-copy-remux; compressed-packet-preservation-verified-separately-in-fixed-fixtures' };
}

export const packetArgs = source => ['-hide_banner','-loglevel','error','-xerror','-nostdin','-threads','2','-protocol_whitelist','file','-f','mov','-enable_drefs','0','-use_absolute_path','0','-i',source,'-map','0:v:0','-map','0:a:0?','-c','copy','-f','framehash','-hash','sha256','-'];
