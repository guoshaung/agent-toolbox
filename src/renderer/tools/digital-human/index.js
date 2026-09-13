import { h, toast } from '../../core/ui.js';
import { avatarById, AVATARS, deckToSpeech, personaById, PERSONAS, speechSegments } from './logic.js';

export default {
  id: 'digital-human',
  title: '数字人',
  icon: 'bot',
  hint: '论文讲解台：讲稿、字幕和本地语音',

  create(root, ctx) {
    root.classList.add('digitalhuman');
    const speech = window.speechSynthesis;
    let segments = [];
    let activeIndex = -1;
    let token = 0;
    let voices = [];
    let selectedAvatar = avatarById(ctx.config.get('digitalHuman.avatar', 'crystal'));

    const personaSelect = h('select', { class: 'field field--sm digitalhuman__select', onchange: () => { ctx.config.set('digitalHuman.persona', personaSelect.value); personaCopy.textContent = personaById(personaSelect.value).intro; } }, ...PERSONAS.map((persona) => h('option', { value: persona.id }, persona.label)));
    personaSelect.value = ctx.config.get('digitalHuman.persona', 'researcher');
    const rateSelect = h('select', { class: 'field field--sm digitalhuman__select', onchange: () => ctx.config.set('digitalHuman.rate', Number(rateSelect.value)) },
      h('option', { value: '0.85' }, '慢速 · 0.85×'), h('option', { value: '1' }, '标准 · 1×'), h('option', { value: '1.15' }, '快速 · 1.15×'));
    rateSelect.value = String(ctx.config.get('digitalHuman.rate', 1));
    const voiceSelect = h('select', { class: 'field field--sm digitalhuman__select', title: '系统语音' }, h('option', { value: '' }, '系统默认语音'));
    const scriptInput = h('textarea', { class: 'field digitalhuman__script', rows: '10', placeholder: '把论文结论、PPT 讲稿或自己的讲解词放在这里…' });
    const personaCopy = h('p', { class: 'digitalhuman__persona-copy' }, personaById(personaSelect.value).intro);
    const lineList = h('div', { class: 'digitalhuman__line-list' });
    const progress = h('span', { class: 'tag digitalhuman__progress' }, '尚未开始');
    const speakButton = h('button', { class: 'btn btn--primary', onclick: () => playFrom(0) }, '开始讲解');
    const stopButton = h('button', { class: 'btn', onclick: stopSpeaking }, '停止');
    const aiButton = h('button', { class: 'btn', onclick: refineWithAi }, 'AI 精修讲稿');
    const importButton = h('button', { class: 'btn', onclick: importDeck }, '从 PPT 导入');
    const exportButton = h('button', { class: 'btn', onclick: exportScript }, '保存讲稿');
    const stateCopy = h('p', { class: 'digitalhuman__state' }, '文字和系统朗读默认留在本机。');
    const avatarBodyLabel = h('span', {}, selectedAvatar.shortLabel);
    const avatarCaption = h('div', { class: 'digitalhuman__avatar-caption' }, h('strong', {}, selectedAvatar.label), h('span', {}, selectedAvatar.description));
    const avatar = h('div', { class: `digitalhuman__avatar digitalhuman__avatar--${selectedAvatar.id}`, dataset: { avatar: selectedAvatar.id }, 'aria-label': selectedAvatar.label, role: 'img' },
      h('div', { class: 'digitalhuman__halo' }),
      h('div', { class: 'digitalhuman__head' },
        h('span', { class: 'digitalhuman__ear digitalhuman__ear--left' }),
        h('span', { class: 'digitalhuman__ear digitalhuman__ear--right' }),
        h('div', { class: 'digitalhuman__face' },
          h('div', { class: 'digitalhuman__hair' }),
          h('span', { class: 'digitalhuman__eye digitalhuman__eye--left' }),
          h('span', { class: 'digitalhuman__eye digitalhuman__eye--right' }),
          h('span', { class: 'digitalhuman__glasses digitalhuman__glasses--left' }),
          h('span', { class: 'digitalhuman__glasses digitalhuman__glasses--right' }),
          h('span', { class: 'digitalhuman__mouth' }),
        ),
      ),
      h('div', { class: 'digitalhuman__body' }, avatarBodyLabel),
    );
    const avatarSelect = h('select', { class: 'field field--sm digitalhuman__select', title: '切换动态数字人形象', onchange: () => applyAvatar(avatarSelect.value) }, ...AVATARS.map((item) => h('option', { value: item.id }, item.label)));
    avatarSelect.value = selectedAvatar.id;

    function applyAvatar(id) {
      selectedAvatar = avatarById(id);
      avatar.classList.remove(...AVATARS.map((item) => `digitalhuman__avatar--${item.id}`));
      avatar.classList.add(`digitalhuman__avatar--${selectedAvatar.id}`);
      avatar.dataset.avatar = selectedAvatar.id;
      avatar.setAttribute('aria-label', selectedAvatar.label);
      avatarBodyLabel.textContent = selectedAvatar.shortLabel;
      avatarCaption.replaceChildren(h('strong', {}, selectedAvatar.label), h('span', {}, selectedAvatar.description));
      void ctx.config.set('digitalHuman.avatar', selectedAvatar.id);
    }

    function refreshVoices() {
      voices = speech?.getVoices?.() || [];
      const current = voiceSelect.value;
      voiceSelect.replaceChildren(h('option', { value: '' }, '系统默认语音'), ...voices.map((voice, index) => h('option', { value: String(index) }, `${voice.name} · ${voice.lang}`)));
      if (voices[current]) voiceSelect.value = current;
    }

    function renderSegments() {
      segments = speechSegments(scriptInput.value);
      lineList.replaceChildren(...segments.map((line, index) => h('button', {
        class: `digitalhuman__line${index === activeIndex ? ' is-active' : ''}`,
        title: '从这一句开始播放',
        onclick: () => playFrom(index),
      }, h('span', {}, String(index + 1).padStart(2, '0')), h('strong', {}, line))));
      progress.textContent = segments.length ? `${segments.length} 句 · 尚未开始` : '尚未开始';
    }

    function setActive(index) {
      activeIndex = index;
      for (const [position, line] of Array.from(lineList.children).entries()) line.classList.toggle('is-active', position === index);
      progress.textContent = index >= 0 ? `正在讲解 · ${index + 1}/${segments.length}` : segments.length ? `${segments.length} 句 · 尚未开始` : '尚未开始';
      avatar.classList.toggle('is-speaking', index >= 0);
    }

    function stopSpeaking() {
      token += 1;
      speech?.cancel();
      setActive(-1);
      stateCopy.textContent = '已停止。讲稿仍保存在输入区。';
    }

    function playFrom(start) {
      if (!speech) return toast('当前系统不支持语音朗读，可以继续使用字幕模式。', 'info', 5000);
      renderSegments();
      if (!segments.length) return toast('先写一段讲稿，或从 PPT 导入讲稿。', 'info');
      speech.cancel();
      const currentToken = ++token;
      const next = (index) => {
        if (currentToken !== token || index >= segments.length) {
          if (currentToken === token) { setActive(-1); progress.textContent = '讲解完成'; stateCopy.textContent = '讲解完成，可以点击任意句子重新播放。'; }
          return;
        }
        setActive(index);
        const utterance = new SpeechSynthesisUtterance(segments[index]);
        utterance.rate = Number(rateSelect.value) || 1;
        utterance.lang = 'zh-CN';
        const selected = voices[Number(voiceSelect.value)];
        if (selected) { utterance.voice = selected; utterance.lang = selected.lang; }
        utterance.onstart = () => { stateCopy.textContent = `正在使用${personaById(personaSelect.value).label}口吻朗读；点击任意句子可从那里开始。`; };
        utterance.onend = () => setTimeout(() => next(index + 1), 180);
        utterance.onerror = () => { if (currentToken === token) { setActive(-1); stateCopy.textContent = '系统语音播放失败，可以切换系统默认语音后重试。'; } };
        speech.speak(utterance);
      };
      next(Math.max(0, start));
    }

    function importDeck() {
      const deck = ctx.config.get('research.presentationDeck', null);
      const imported = deckToSpeech(deck || {});
      if (!imported.length) return toast('还没有可导入的 PPT 讲稿，请先在「科研 → PPT演示」里写几页。', 'info', 5000);
      scriptInput.value = imported.join('\n');
      renderSegments();
      toast(`已导入 ${imported.length} 句 PPT 讲稿`, 'good');
    }

    async function refineWithAi() {
      const text = scriptInput.value.trim();
      if (!text) return toast('先写一段讲稿，再让 AI 精修。', 'info');
      aiButton.disabled = true;
      stateCopy.textContent = '正在按当前数字人口吻精修讲稿…';
      try {
        const persona = personaById(personaSelect.value);
        const result = await ctx.ai.chat([
          '你是科研汇报讲稿编辑。只改写讲稿，不虚构论文事实。',
          `当前口吻：${persona.label}。要求：${persona.intro}`,
          '保留数字、公式、模型名、数据集名和引用；每句话适合口头表达；只输出改写后的中文讲稿。',
          `原稿：\n---\n${text.slice(0, 12000)}\n---`,
        ].join('\n\n'), { timeout: 90000 });
        scriptInput.value = String(result || '').trim();
        renderSegments();
        stateCopy.textContent = 'AI 精修完成；播放前请核对数字、引用和结论。';
      } catch (error) {
        stateCopy.textContent = `AI 精修失败：${error.message}`;
      } finally { aiButton.disabled = false; }
    }

    async function exportScript() {
      const result = await window.toolbox.files.saveText({ content: scriptInput.value, extension: 'md', defaultName: '数字人讲稿.md' });
      if (result?.ok) toast(`讲稿已保存：${result.path}`, 'good', 5000);
    }

    scriptInput.addEventListener('input', renderSegments);
    speech?.addEventListener?.('voiceschanged', refreshVoices);
    refreshVoices();
    renderSegments();

    root.append(
      h('header', { class: 'digitalhuman__hero' },
        h('div', { class: 'digitalhuman__hero-copy' }, h('span', { class: 'digitalhuman__eyebrow' }, 'RESEARCH PRESENTER'), h('h1', {}, '把论文讲给自己听'), h('p', {}, '动态矢量角色：切换不同形象，讲解时同步呼吸、眨眼、口型和字幕。导入 PPT 讲稿即可开始，默认本地运行。')),
        h('div', { class: 'digitalhuman__avatar-stage' }, avatar, avatarCaption),
      ),
      h('div', { class: 'digitalhuman__workspace' },
        h('section', { class: 'digitalhuman__script-card' },
          h('div', { class: 'digitalhuman__section-head' }, h('div', {}, h('span', { class: 'digitalhuman__eyebrow' }, 'SCRIPT'), h('h2', {}, '讲解内容')), h('div', { class: 'digitalhuman__actions' }, importButton, exportButton)),
          scriptInput,
          h('div', { class: 'digitalhuman__line-head' }, h('span', {}, '逐句字幕'), progress),
          lineList,
        ),
        h('aside', { class: 'digitalhuman__control-card' },
          h('div', { class: 'digitalhuman__section-head' }, h('div', {}, h('span', { class: 'digitalhuman__eyebrow' }, 'PRESENTER'), h('h2', {}, '讲解设置'))),
          h('label', { class: 'digitalhuman__control' }, h('span', {}, '动态形象'), avatarSelect),
          h('label', { class: 'digitalhuman__control' }, h('span', {}, '角色口吻'), personaSelect),
          personaCopy,
          h('label', { class: 'digitalhuman__control' }, h('span', {}, '播放速度'), rateSelect),
          h('label', { class: 'digitalhuman__control' }, h('span', {}, '系统语音'), voiceSelect),
          h('div', { class: 'digitalhuman__control-actions' }, speakButton, stopButton),
          aiButton,
          stateCopy,
          h('p', { class: 'digitalhuman__note' }, '系统朗读可能使用操作系统提供的本地或云端语音服务；点击“AI 精修讲稿”才会向当前 AI 发送文本。'),
        ),
      ),
    );

    return { deactivate: stopSpeaking };
  },
};
