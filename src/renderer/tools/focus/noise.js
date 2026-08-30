/**
 * 白噪音发生器。全部用 WebAudio 实时合成 —— 不带任何音频文件，
 * 仓库不会因为几十 MB 的 mp3 变胖，也不用管版权。
 */
const KINDS = {
  white: '白噪音',
  pink: '粉噪音',
  brown: '棕噪音',
  rain: '雨声',
};

function fillNoise(data, kind) {
  if (kind === 'pink') {
    // Paul Kellet 的近似粉噪滤波器：比白噪柔和，高频不刺耳
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.969 * b2 + white * 0.153852;
      b3 = 0.8665 * b3 + white * 0.3104856;
      b4 = 0.55 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.016898;
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
    }
    return;
  }
  if (kind === 'brown') {
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    }
    return;
  }
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
}

export class NoisePlayer {
  constructor() {
    this.audio = null;
    this.nodes = null;
    this.kind = null;
    this.volume = 0.35;
  }

  static kinds() {
    return Object.entries(KINDS).map(([value, label]) => ({ value, label }));
  }

  get playing() {
    return !!this.nodes;
  }

  play(kind = 'pink') {
    this.stop();
    this.audio ||= new (window.AudioContext || window.webkitAudioContext)();
    if (this.audio.state === 'suspended') this.audio.resume();

    // 雨声 = 粉噪过一层低通，再加极慢的音量起伏，听起来像雨势变化
    const base = kind === 'rain' ? 'pink' : kind;
    const buffer = this.audio.createBuffer(1, this.audio.sampleRate * 4, this.audio.sampleRate);
    fillNoise(buffer.getChannelData(0), base);

    const source = this.audio.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    const gain = this.audio.createGain();
    gain.gain.value = this.volume;

    let tail = gain;
    let lfo = null, lfoGain = null, filter = null;

    if (kind === 'rain') {
      filter = this.audio.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 1400;
      filter.Q.value = 0.5;
      source.connect(filter).connect(gain);

      lfo = this.audio.createOscillator();
      lfo.frequency.value = 0.06; // 约 16 秒一个起伏周期
      lfoGain = this.audio.createGain();
      lfoGain.gain.value = this.volume * 0.35;
      lfo.connect(lfoGain).connect(gain.gain);
      lfo.start();
    } else {
      source.connect(gain);
    }

    tail.connect(this.audio.destination);
    source.start();

    this.nodes = { source, gain, lfo, lfoGain, filter };
    this.kind = kind;
    return kind;
  }

  setVolume(value) {
    this.volume = value;
    if (this.nodes) {
      this.nodes.gain.gain.value = value;
      if (this.nodes.lfoGain) this.nodes.lfoGain.gain.value = value * 0.35;
    }
  }

  stop() {
    if (!this.nodes) return;
    try { this.nodes.source.stop(); } catch { /* 已经停了 */ }
    try { this.nodes.lfo?.stop(); } catch { /* 没有 lfo */ }
    for (const node of Object.values(this.nodes)) node?.disconnect?.();
    this.nodes = null;
    this.kind = null;
  }

  /** 番茄钟结束时的提示音：两声柔和的正弦，不吓人 */
  chime() {
    this.audio ||= new (window.AudioContext || window.webkitAudioContext)();
    const now = this.audio.currentTime;
    for (const [index, freq] of [523.25, 659.25].entries()) {
      const osc = this.audio.createOscillator();
      const gain = this.audio.createGain();
      osc.frequency.value = freq;
      osc.type = 'sine';
      const start = now + index * 0.28;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.22, start + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.9);
      osc.connect(gain).connect(this.audio.destination);
      osc.start(start);
      osc.stop(start + 1);
    }
  }
}
