export const LIMITS = Object.freeze({ sourceBytes: 64 * 1024 * 1024, outputBytes: 20 * 1024 * 1024, durationMs: 120000, clips: 8, probeBytes: 131072 });
export function fail(code) { throw Object.assign(new Error(code), { code }); }
export function exact(value, keys) { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join('|') !== [...keys].sort().join('|')) fail('INVALID_PAYLOAD'); }
function positive(v, code) { const n = Number(v); if (!Number.isFinite(n) || n <= 0) fail(code); return n; }
export function versionBanner(text, name) {
  if (typeof text !== 'string' || text.length > LIMITS.probeBytes) fail('ENGINE_OUTPUT_LIMIT');
  const match = text.match(new RegExp('^' + name + ' version (6\\.\\d+(?:\\.\\d+)?)(?:[-\\s]|$)'));
  if (!match) fail('ENGINE_VERSION_UNSUPPORTED');
  return match[1];
}
export function encoderSupport(text) {
  if (typeof text !== 'string' || text.length > LIMITS.probeBytes) fail('ENGINE_OUTPUT_LIMIT');
  if (!/^\s*V[^\s]{5}\s+libx264\s/m.test(text) || !/^\s*A[^\s]{5}\s+aac\s/m.test(text)) fail('REQUIRED_ENCODER_UNAVAILABLE');
  return ['libx264', 'aac'];
}
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
export function buildPlan(source, clips) {
  if (!source || !source.media || !/^[a-f0-9]{64}$/.test(source.sha256) || !Number.isSafeInteger(source.bytes) || source.bytes < 1 || source.bytes > LIMITS.sourceBytes) fail('SOURCE_INVALID');
  if (!Array.isArray(clips) || clips.length < 1 || clips.length > LIMITS.clips) fail('CLIP_COUNT');
  let outputStartMs = 0;
  const timeline = clips.map((clip, i) => { exact(clip, ['startMs', 'endMs']); const { startMs, endMs } = clip; if (!Number.isSafeInteger(startMs) || !Number.isSafeInteger(endMs) || startMs < 0 || endMs - startMs < 100 || endMs > source.media.durationMs) fail('CLIP_RANGE'); const row = { sequence: i + 1, sourceStartMs: startMs, sourceEndMs: endMs, outputStartMs, outputEndMs: outputStartMs + endMs - startMs }; outputStartMs = row.outputEndMs; return row; });
  if (outputStartMs > LIMITS.durationMs) fail('TOTAL_DURATION_LIMIT');
  const scale = Math.min(1, 1280 / source.media.video.width, 720 / source.media.video.height);
  const width = Math.max(2, Math.floor(source.media.video.width * scale / 2) * 2), height = Math.max(2, Math.floor(source.media.video.height * scale / 2) * 2);
  return { format: 'T041-edit-plan', version: 1, source: { name: source.name, bytes: source.bytes, sha256: source.sha256, media: source.media }, timeline, expectedDurationMs: outputStartMs, output: { container: 'mp4', video: { codec: 'h264', encoder: 'libx264', crf: 23, preset: 'veryfast', fps: 30, width, height, pixelFormat: 'yuv420p', maxrateKbps: 1000 }, audio: source.media.audio ? { codec: 'aac', bitrateKbps: 96, sampleRate: 48000, channels: source.media.audio.channels, selection: '唯一源音轨（按同一时间区间剪接）' } : null }, limits: LIMITS, notes: ['毫秒输入对应时间戳筛选；实际视频边界量化到帧、AAC量化到采样/编码帧，核验容差100毫秒。', '按列表顺序输出，允许重复区间；不叠加、转场或自动跟随其他媒体。', '真实重编码会损失图像/声音细节；保留比例、向下取偶数尺寸、不放大。', '不修改源。产物全部就绪并预览后，才由原生保存对话框创建新目录。'] };
}
export const probeArgs = source => ['-v', 'error', '-protocol_whitelist', 'file', '-f', 'mov', '-enable_drefs', '0', '-use_absolute_path', '0', '-show_entries', 'format=format_name,duration:stream=index,codec_type,codec_name,width,height,avg_frame_rate,sample_rate,channels,start_time,pix_fmt,sample_aspect_ratio,color_transfer:stream_disposition=attached_pic:stream_side_data=rotation:chapter=id', '-of', 'json', source];
export function encodeArgs(plan, source, output) {
  const parts = [], labels = [], { width, height } = plan.output.video, audio = plan.output.audio;
  const sec = ms => (ms / 1000).toFixed(3);
  for (const [i, row] of plan.timeline.entries()) {
    parts.push(`[0:v:0]trim=start=${sec(row.sourceStartMs)}:end=${sec(row.sourceEndMs)},setpts=PTS-STARTPTS,scale=${width}:${height},setsar=1,fps=30,format=yuv420p[v${i}]`); labels.push(`[v${i}]`);
    if (audio) { parts.push(`[0:a:0]atrim=start=${sec(row.sourceStartMs)}:end=${sec(row.sourceEndMs)},asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=${audio.channels === 1 ? 'mono' : 'stereo'}[a${i}]`); labels.push(`[a${i}]`); }
  }
  parts.push(`${labels.join('')}concat=n=${plan.timeline.length}:v=1:a=${audio ? 1 : 0}[v]${audio ? '[a]' : ''}`);
  return ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-threads', '2', '-filter_complex_threads', '1', '-protocol_whitelist', 'file', '-f', 'mov', '-enable_drefs', '0', '-use_absolute_path', '0', '-noautorotate', '-i', source, '-filter_complex', parts.join(';'), '-map', '[v]', ...(audio ? ['-map', '[a]', '-c:a', 'aac', '-b:a', '96k', '-ar', '48000', '-ac', String(audio.channels)] : ['-an']), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-maxrate', '1000k', '-bufsize', '2000k', '-pix_fmt', 'yuv420p', '-r', '30', '-threads', '2', '-map_metadata', '-1', '-map_chapters', '-1', '-movflags', '+faststart', '-fs', String(LIMITS.outputBytes), '-f', 'mp4', output];
}
export function verifyOutput(plan, media, bytes, sha256) {
  if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes >= LIMITS.outputBytes || !/^[a-f0-9]{64}$/.test(sha256)) fail('OUTPUT_SIZE_OR_HASH');
  const expected = plan.output, deltaMs = media.durationMs - plan.expectedDurationMs;
  if (Math.abs(deltaMs) > 100 || media.video.codec !== expected.video.codec || media.video.width !== expected.video.width || media.video.height !== expected.video.height || media.video.fps !== 30 || !!media.audio !== !!expected.audio || media.audio && (media.audio.sampleRate !== 48000 || media.audio.channels !== expected.audio.channels)) fail('OUTPUT_VERIFICATION_FAILED');
  return { name: 'edited.mp4', bytes, sha256, expectedDurationMs: plan.expectedDurationMs, actualDurationMs: media.durationMs, differenceMs: deltaMs, media };
}
