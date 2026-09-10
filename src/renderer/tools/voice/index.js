import { h, toast } from '../../core/ui.js';

export default {
  id: 'voice',
  title: '语音',
  icon: 'mic',
  hint: '本机 Voicebox：TTS 配音、声音克隆与教学配图',

  create(root, ctx) {
    const { config } = ctx;

    const statusTag = h('span', { class: 'tag' }, '未检测');
    const startBtn = h('button', { class: 'btn btn--sm btn--primary', onclick: start }, '启动 Voicebox');
    const stopBtn = h('button', { class: 'btn btn--sm', onclick: stop, disabled: true }, '停止');

    const engineStatus = h('span', { class: 'faint' }, '—');
    const mcpUrlEl = h('code', { class: 'mono' }, '—');
    const gpuBtn = h('button', { class: 'btn btn--sm', onclick: installGpu, disabled: true }, '安装 GPU 加速');

    const ttsInput = h('textarea', { class: 'field voice__tts-input', rows: 3, placeholder: '输入要合成的文字…' });
    ttsInput.value = '你好，这是一段由本机 Voicebox 生成的中文语音。';
    const ttsBtn = h('button', { class: 'btn btn--sm btn--primary', onclick: runTts, disabled: true }, '生成并试听');
    const player = h('audio', { class: 'voice__player', controls: true, style: { display: 'none' } });
    const ttsStatus = h('span', { class: 'faint voice__tts-status' }, '启动引擎后可试听');

    const slideInput = h('input', { class: 'field', placeholder: '输入教学主题，如：Transformer Encoder' });
    const slideBtn = h('button', { class: 'btn btn--sm btn--primary', onclick: runSlides, disabled: true }, '生成 5 页');
    const slideOut = h('div', { class: 'voice__slide-out faint' }, '保存图片 API Key 后可生成。');
    const imageBaseUrl = h('input', { class: 'field mono', placeholder: 'https://api.openai.com/v1' });
    imageBaseUrl.value = config.get('image.api.baseUrl', 'https://api.openai.com/v1');
    const imageKey = h('input', { class: 'field mono', type: 'password', placeholder: 'sk-…（系统安全存储）' });
    const imageKeyStatus = h('span', { class: 'tag' }, '未检测');
    let imageCredentialReady = false;

    async function refreshImageCredential() {
      const state = await window.toolbox.ai.credentialStatus('image');
      imageCredentialReady = Boolean(state.hasKey);
      imageKeyStatus.textContent = imageCredentialReady ? 'Key 已保存' : '未保存 Key';
      imageKeyStatus.className = `tag ${imageCredentialReady ? 'tag--good' : 'tag--warn'}`;
      slideBtn.disabled = !imageCredentialReady;
    }

    async function saveImageCredential() {
      const baseUrl = imageBaseUrl.value.trim();
      if (!/^https?:\/\/[^\s]+$/i.test(baseUrl)) return toast('图片 API 地址无效', 'bad');
      await config.set('image.api.baseUrl', baseUrl.replace(/\/+$/, ''));
      const value = imageKey.value.trim();
      if (value) {
        const saved = await window.toolbox.ai.saveCredential(value, 'image');
        if (!saved.ok) return toast(saved.error || '图片 API Key 保存失败', 'bad');
        imageKey.value = '';
      }
      await refreshImageCredential();
      toast('教学配图 API 已保存', 'good');
    }

    async function clearImageCredential() {
      await window.toolbox.ai.clearCredential('image');
      imageKey.value = '';
      await refreshImageCredential();
      toast('图片 API Key 已清除', 'info');
    }

    function applyState(state) {
      const running = state?.status === 'running';
      const busy = state?.status === 'installing' || state?.status === 'starting';
      statusTag.textContent = state?.status === 'running' ? '运行中' : state?.status === 'installing' ? '下载安装中' : state?.status === 'starting' ? '启动中' : state?.status === 'error' ? '错误' : state?.supported === false ? '不支持' : '未启动';
      statusTag.className = `tag ${running ? 'tag--good' : state?.status === 'error' ? 'tag--bad' : busy ? 'tag--warn' : ''}`;
      startBtn.disabled = running || busy;
      stopBtn.disabled = !running || !state?.managed;
      ttsBtn.disabled = !running;
      slideBtn.disabled = !imageCredentialReady;
      gpuBtn.disabled = !running || state?.gpu;
      engineStatus.textContent = running ? `${state?.manifest?.display || ''} · 端口 ${state?.port}` : state?.error || (state?.manifest ? `已就绪待启动 · ${state.manifest.display}` : '未安装');
      mcpUrlEl.textContent = running ? state?.mcpUrl || '' : '—';
      if (state?.status === 'error') toast(state.error, 'bad', 6000);
    }

    async function refresh() {
      applyState(await window.toolbox.voicebox.status());
    }

    async function start() {
      startBtn.disabled = true;
      statusTag.textContent = '启动中…';
      const result = await window.toolbox.voicebox.start();
      applyState(result);
      if (!result.ok) toast(result.error || 'Voicebox 启动失败', 'bad', 6000);
      else toast(result.managed ? 'Voicebox 已启动' : '复用已有 Voicebox 实例', 'good');
    }

    async function stop() {
      const result = await window.toolbox.voicebox.stop();
      applyState(result);
      toast('Voicebox 已停止', 'info');
    }

    async function installGpu() {
      gpuBtn.disabled = true;
      gpuBtn.textContent = '下载中…';
      const result = await window.toolbox.voicebox.installGpu();
      gpuBtn.textContent = '安装 GPU 加速';
      toast(result.ok ? (result.note || 'GPU 加速已就绪') : (result.error || 'GPU 安装失败'), result.ok ? 'good' : 'bad');
      refresh();
    }

    async function runTts() {
      const text = ttsInput.value.trim();
      if (!text) return toast('先输入要合成的文字', 'info');
      ttsBtn.disabled = true;
      ttsStatus.textContent = '正在合成（首次会下载 0.6B 模型，可能较慢）…';
      const result = await window.toolbox.voicebox.tts(text);
      ttsBtn.disabled = false;
      if (!result.ok) {
        ttsStatus.textContent = result.error || '合成失败';
        return toast(result.error || '合成失败', 'bad', 6000);
      }
      ttsStatus.textContent = `已生成 ${result.duration ? `${result.duration.toFixed(1)}s` : '音频'}（model_size ${result.modelSize}）`;
      player.src = result.audioUrl;
      player.style.display = 'block';
      player.play().catch(() => {});
    }

    async function runSlides() {
      const topic = slideInput.value.trim();
      if (!topic) return toast('先输入教学主题', 'info');
      slideBtn.disabled = true;
      slideOut.textContent = '正在生成 storyboard 与 5 张配图（并发 2，约需几分钟）…';
      const result = await window.toolbox.slides.generateTeaching(topic);
      slideBtn.disabled = false;
      if (!result.ok && result.error && !result.slides) {
        slideOut.textContent = result.error;
        return toast(result.error, 'bad', 6000);
      }
      const ok = result.slides.filter((s) => s.imageOk).length;
      slideOut.textContent = result.slides.length
        ? `完成 ${ok}/${result.slides.length} 张（输出目录：${result.outputDir}）` + result.slides.filter((s) => !s.imageOk).map((s) => `\n第${result.slides.indexOf(s) + 1}页「${s.title}」失败：${s.error}`).join('')
        : '无结果';
      toast(`教学配图 ${ok}/${result.slides.length}`, ok === result.slides.length ? 'good' : 'bad');
    }

    window.toolbox.voicebox.onStatus(applyState);
    refresh();
    refreshImageCredential();

    const audioHint = () => h('div', { class: 'faint settings__hint' },
      '参考录音（wav/mp3/m4a/ogg/flac，几秒即可）后续通过「克隆声音」上传，合成将使用你的声音；' +
      '当前默认使用中文预设音色（model_size 0.6B）。');

    root.append(
      h('div', { class: 'bar bar--drag' },
        h('strong', {}, '语音'),
        statusTag,
        engineStatus,
        h('span', { style: { flex: 1 } }),
        startBtn,
        stopBtn,
      ),
      h('div', { class: 'settings__body' },
        h('section', { class: 'card' },
          h('h3', { class: 'card__title' }, '语音引擎'),
          h('div', { class: 'settings__row settings__row--first' },
            h('div', {},
              h('div', {}, 'Voicebox（本机 REST 服务）'),
              h('div', { class: 'faint settings__hint' }, '端口 17493；未安装时自动从官方 Release 下载，产物都在 userData/external/voicebox，不入仓库。'),
            ),
            h('code', { class: 'mono' }, '127.0.0.1:17493'),
          ),
          h('div', { class: 'settings__row' },
            h('div', {},
              h('div', {}, 'MCP 端点（供 Agent 调用）'),
              h('div', { class: 'faint settings__hint' }, '配音内部走 REST POST /generate（model_size 0.6B），避免触发 1.7B 大模型。'),
            ),
            mcpUrlEl,
          ),
          gpuBtn,
        ),
        h('section', { class: 'card' },
          h('h3', { class: 'card__title' }, '试听 TTS'),
          ttsInput,
          h('div', { class: 'settings__row settings__row--first' }, ttsBtn, ttsStatus),
          player,
        ),
        h('section', { class: 'card' },
          h('h3', { class: 'card__title' }, '声音克隆'),
          audioHint(),
        ),
        h('section', { class: 'card' },
          h('h3', { class: 'card__title' }, '教学幻灯片'),
          h('div', { class: 'settings__row settings__row--first' },
            h('div', {},
              h('div', {}, '教学配图 API'),
              h('div', { class: 'faint settings__hint' }, 'Key 使用系统安全存储；环境变量 OPENAI_API_KEY / OPENAI_BASE_URL 优先。'),
            ),
            imageKeyStatus,
          ),
          h('div', { class: 'settings__field' }, h('label', {}, 'Base URL'), imageBaseUrl),
          h('div', { class: 'settings__field' }, h('label', {}, 'API Key'), imageKey),
          h('div', { class: 'settings__row' },
            h('span', { class: 'faint settings__hint' }, '模型：gpt-image-2 · 1536x864 · medium · 并发 2'),
            h('div', {},
              h('button', { class: 'btn btn--sm', onclick: clearImageCredential }, '清除 Key'),
              h('button', { class: 'btn btn--sm btn--primary', onclick: saveImageCredential }, '保存配置'),
            ),
          ),
          h('div', { class: 'settings__row' }, slideInput, slideBtn),
          slideOut,
        ),
      ),
    );

    return {};
  },
};
