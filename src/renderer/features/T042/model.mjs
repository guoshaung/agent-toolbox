export const LIMITS = Object.freeze({ sourceBytes: 64 * 1024 * 1024, outputBytes: 20 * 1024 * 1024, durationMs: 120000, attempts: 2, probeBytes: 131072 });
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
  if (!Number.isInteger(v.width) || !Number.isInteger(v.height) || v.width < 2 || v.height < 2 || v.width > 1920 || v.height > 1080 || v.width % 2 || v.height % 2) fail('DIMENSION_LIMIT');
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
export function buildPlan(source, constraints, previous = null) {
  if (!source?.media || !/^[a-f0-9]{64}$/.test(source.sha256) || !Number.isSafeInteger(source.bytes) || source.bytes < 1 || source.bytes > LIMITS.sourceBytes) fail('SOURCE_INVALID');
  exact(constraints, ['targetBytes', 'width', 'height']);
  const { targetBytes, width, height } = constraints, video = source.media.video;
  if (!Number.isSafeInteger(targetBytes) || targetBytes < 1 || targetBytes > 20000000) fail('TARGET_LIMIT');
  if (![width, height].every(n => Number.isSafeInteger(n) && n >= 2 && n % 2 === 0) || width > video.width || height > video.height || width * video.height !== height * video.width) fail('EXPLICIT_DIMENSIONS_REQUIRED');
  const reserveBytes = Math.max(65536, Math.ceil(targetBytes * .05)), audioBitsPerSecond = source.media.audio ? 96000 : 0;
  let videoBitsPerSecond = Math.floor(((targetBytes - reserveBytes) * 8000 / source.media.durationMs - audioBitsPerSecond) / 1000) * 1000;
  let attempt = 1;
  if (previous) {
    if (previous.attempt !== 1 || previous.qualified || previous.targetBytes !== targetBytes || previous.media.video.width !== width || previous.media.video.height !== height || !Number.isSafeInteger(previous.bytes) || previous.bytes <= targetBytes) fail('SECOND_ATTEMPT_NOT_ALLOWED');
    attempt = 2;
    videoBitsPerSecond = Math.min(videoBitsPerSecond, Math.floor(previous.plannedVideoBitsPerSecond * targetBytes / previous.bytes * .85 / 1000) * 1000);
  }
  videoBitsPerSecond = Math.min(2000000, videoBitsPerSecond);
  const feasible = videoBitsPerSecond >= 64000;
  return { format: 'T042-delivery-plan', version: 1, attempt, source: { name: source.name, bytes: source.bytes, sha256: source.sha256, media: source.media }, targetBytes, targetUnit: 'bytes; decimal MB = 1000000 bytes', expectedDurationMs: source.media.durationMs, reserveBytes, reserveRule: 'max(65536 bytes, ceil(targetBytes × 5%)); estimate, not actual container overhead', feasible, reason: feasible ? null : 'INSUFFICIENT_AUDIO_CONTAINER_AND_MIN_VIDEO_BUDGET', output: { container: 'mp4', video: { width, height, fps: 30, codec: 'h264', encoder: 'libx264', preset: 'veryfast', pixelFormat: 'yuv420p', bitsPerSecond: Math.max(0, videoBitsPerSecond) }, audio: source.media.audio ? { codec: 'aac', bitsPerSecond: audioBitsPerSecond, sampleRate: 48000, channels: source.media.audio.channels } : null }, samplePositionsMs: [.1, .5, .9].map(f => Math.floor(source.media.durationMs * f)), notes: ['输出尺寸必须由用户明确选择，不静默改变。等比例、不放大、偶数像素。', 'ABR码率与5%容器余量是估计；只以实际文件字节判断体积。', '合格仅表示体积、尺寸、时长、音轨与完整解码核验通过，不证明主观画质。', '最多两次完整编码；第二次只在第一份实际超限后单独确认。无第三次、无自动重试。', '源和实际成片在10%/50%/90%位置抽样并可完整播放；由用户核对画质和声音。'] };
}
export const probeArgs = source => ['-v', 'error', '-protocol_whitelist', 'file', '-f', 'mov', '-enable_drefs', '0', '-use_absolute_path', '0', '-show_entries', 'format=format_name,duration:stream=index,codec_type,codec_name,width,height,avg_frame_rate,sample_rate,channels,start_time,pix_fmt,sample_aspect_ratio,color_transfer:stream_disposition=attached_pic:stream_side_data=rotation:chapter=id', '-of', 'json', source];
export function encodeArgs(plan, source, output) {
  if (!plan.feasible) fail('PLAN_INFEASIBLE');
  const v = plan.output.video, a = plan.output.audio;
  return ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-threads', '2', '-filter_threads', '1', '-protocol_whitelist', 'file', '-f', 'mov', '-enable_drefs', '0', '-use_absolute_path', '0', '-noautorotate', '-i', source, '-map', '0:v:0', '-vf', `scale=${v.width}:${v.height},setsar=1,fps=30,format=yuv420p`, ...(a ? ['-map', '0:a:0', '-c:a', 'aac', '-b:a', '96000', '-ar', '48000', '-ac', String(a.channels)] : ['-an']), '-c:v', 'libx264', '-preset', 'veryfast', '-b:v', String(v.bitsPerSecond), '-pix_fmt', 'yuv420p', '-r', '30', '-threads', '2', '-map_metadata', '-1', '-map_chapters', '-1', '-movflags', '+faststart', '-fs', String(LIMITS.outputBytes), '-f', 'mp4', output];
}
export const decodeArgs = source => ['-hide_banner', '-loglevel', 'error', '-xerror', '-nostdin', '-threads', '2', '-protocol_whitelist', 'file', '-f', 'mov', '-enable_drefs', '0', '-use_absolute_path', '0', '-i', source, '-map', '0:v:0', '-map', '0:a:0?', '-f', 'null', '-'];
export function verifyOutput(plan, media, bytes, sha256) {
  if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes >= LIMITS.outputBytes || !/^[a-f0-9]{64}$/.test(sha256)) fail('OUTPUT_SIZE_OR_HASH');
  const v = plan.output.video, a = plan.output.audio, deltaMs = media.durationMs - plan.expectedDurationMs;
  if (Math.abs(deltaMs) > 100 || media.video.codec !== v.codec || media.video.width !== v.width || media.video.height !== v.height || media.video.fps !== 30 || !!media.audio !== !!a || media.audio && (media.audio.sampleRate !== 48000 || media.audio.channels !== a.channels)) fail('OUTPUT_VERIFICATION_FAILED');
  const qualified = bytes <= plan.targetBytes;
  return { attempt: plan.attempt, name: `attempt-${plan.attempt}.mp4`, bytes, sha256, targetBytes: plan.targetBytes, qualified, status: qualified ? 'QUALIFIED_DIMENSIONS_BYTES_DECODE' : 'UNQUALIFIED_SIZE_EXCEEDED', plannedVideoBitsPerSecond: v.bitsPerSecond, actualTotalBitsPerSecond: bytes * 8000 / media.durationMs, expectedDurationMs: plan.expectedDurationMs, actualDurationMs: media.durationMs, differenceMs: deltaMs, media, completeDecode: true };
}
