import { h, toast } from '../../core/ui.js';
import { md } from '../../core/md.js';
import { parseChatLog, speakersOf, isGroup, guessMe, messagePrompt, personaPrompt, groupPrompt, extractJson, alignMessages, newMessages, msgKey, DIMENSIONS, MBTI_AXES } from './chatlog.js';

/**
 * 聊天分析：把聊天记录（导出文本 / 截图 OCR / 读一次微信窗口）交给你配的模型，
 * 做逐条情绪 + 意图、人物画像（六维互动 / MBTI / 好感度）、群聊整体氛围。
 *
 * 和 WechatVibe 的分工：那个项目靠读 Windows 微信本地库拿数据（Mac 上没有那条路，仓库我已放进容器给你在 Windows 用）。
 * 这里只处理你手动给的文本，不碰微信进程和数据库，所以没有封号风险，也就没法真正实时 —— 要更新就再导一次。
 */
const KEY = 'chatAnalyze';

export default {
  id: 'chat-analyze',
  title: '聊天分析',
  icon: 'brain',
  hint: '把聊天记录（导出 / 截图 / 读屏）交给模型：情绪、意图、人物画像、MBTI、好感度',

  create(root, ctx) {
    const { config, ai } = ctx;
    let convId = config.get(`${KEY}.current`, '') || '';
    let msgs = [];
    let me = '';
    let busy = false;

    const store = () => config.get(`${KEY}.convs`, {}) || {};
    const conv = () => store()[convId] || null;
    const saveConv = (patch) => {
      const all = store();
      all[convId] = { ...(all[convId] || {}), ...patch, updatedAt: Date.now() };
      config.set(`${KEY}.convs`, all);
    };

    // ---------- 导入区 ----------
    const dump = h('textarea', { class: 'field ca__dump', rows: 5, placeholder: '把聊天记录贴进来：\n· 微信里「导出聊天记录」的文本，格式最准\n· 或者截图直接粘进来（会自动 OCR 成文字）\n格式随意，「昵称 时间」或「昵称：内容」都认' });
    const meInput = h('input', { class: 'field field--sm ca__me', placeholder: '哪个昵称是“我”（可留空）' });
    const nameInput = h('input', { class: 'field field--sm ca__name', placeholder: '给这段起个名，如：和小明' });

    async function ocrImageFile(file) {
      const dataUrl = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(file); });
      const r = await window.toolbox.lit.snipOcr(dataUrl);
      if (r?.ok && r.text) { dump.value += (dump.value ? '\n' : '') + r.text.trim(); toast('截图已 OCR，检查一下昵称对不对', 'good'); }
      else toast(r?.error || '这张图没识别出文字', 'bad');
    }
    dump.addEventListener('paste', async (e) => {
      const img = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
      if (img) { e.preventDefault(); await ocrImageFile(img.getAsFile()); }
    });

    async function readScreen() {
      if (busy) return;
      busy = true;
      try {
        const src = await window.toolbox.chat.pickWindow();
        if (!src?.ok) return toast(src?.error || '没找到可读的窗口', 'info', 5000);
        const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: src.id, maxWidth: 1920, maxHeight: 1200 } } });
        const video = h('video', { autoplay: true }); video.srcObject = stream; await video.play();
        await new Promise((r) => setTimeout(r, 300));
        const canvas = h('canvas'); canvas.width = video.videoWidth; canvas.height = video.videoHeight;
        canvas.getContext('2d').drawImage(video, 0, 0);
        stream.getTracks().forEach((t) => t.stop());
        const r = await window.toolbox.lit.snipOcr(canvas.toDataURL('image/png'));
        if (r?.ok && r.text) { dump.value = r.text.trim(); toast(`读到「${src.name}」，OCR 出 ${r.text.length} 字，检查后点分析`, 'good', 5000); }
        else toast(r?.error || '窗口里没 OCR 出文字', 'bad');
      } catch (err) { toast(`读屏失败：${err.message}`, 'bad', 6000); } finally { busy = false; }
    }

    const importCard = h('section', { class: 'ca__import' },
      h('div', { class: 'ca__import-head' }, h('strong', {}, '导入聊天'), h('span', { class: 'faint' }, '数据是你手动给的，不读微信数据库，也就没法自动实时；要更新就再导一次')),
      dump,
      h('div', { class: 'ca__import-row' }, meInput, nameInput),
      h('div', { class: 'ca__import-row' },
        h('button', { class: 'btn btn--primary', onclick: () => analyze(false) }, '分析'),
        h('button', { class: 'btn', title: '只分析这次新增的消息，和已有结果合并', onclick: () => analyze(true) }, '追加分析'),
        h('button', { class: 'btn btn--ghost', onclick: readScreen, title: '截当前前台窗口（比如微信）并 OCR，读一次；不是持续监听' }, '读一次窗口'),
        h('button', { class: 'btn btn--ghost', onclick: async () => { const t = await window.toolbox.clipboard.read?.(); if (t) { dump.value += (dump.value ? '\n' : '') + t; } else toast('剪贴板是空的', 'info'); } }, '从剪贴板粘'),
      ),
    );

    // ---------- 结果区 ----------
    const convBar = h('div', { class: 'ca__convs' });
    const summary = h('div', { class: 'ca__summary' });
    const timeline = h('div', { class: 'ca__timeline' });
    const personaWrap = h('div', { class: 'ca__personas' });

    function renderConvs() {
      const all = store();
      const ids = Object.keys(all).sort((a, b) => (all[b].updatedAt || 0) - (all[a].updatedAt || 0));
      convBar.replaceChildren(
        h('span', { class: 'faint' }, ids.length ? '已分析：' : '还没有分析过的会话'),
        ...ids.map((id) => h('button', { class: `btn btn--sm ${id === convId ? 'is-active' : ''}`, onclick: () => { convId = id; config.set(`${KEY}.current`, id); load(); } }, all[id].name || id)),
        ids.length ? h('button', { class: 'btn btn--sm btn--ghost', title: '删掉当前这段分析', onclick: () => { const a = store(); delete a[convId]; config.set(`${KEY}.convs`, a); convId = Object.keys(a)[0] || ''; config.set(`${KEY}.current`, convId); load(); } }, '删除当前') : null,
      );
    }

    async function analyze(incremental) {
      if (busy) return;
      const parsed = parseChatLog(dump.value);
      if (parsed.length < 2) return toast('至少要两条消息，检查一下粘进来的格式', 'info');
      me = meInput.value.trim() || guessMe(parsed, meInput.value.trim());
      const check = ai.check?.();
      if (check && !check.ok) return toast(check.reason || '先在设置里配好 AI', 'bad', 6000);
      busy = true;
      const btns = importCard.querySelectorAll('button'); btns.forEach((b) => { b.disabled = true; });
      try {
        if (!incremental || !convId) {
          convId = `c_${Date.now().toString(36)}`;
          config.set(`${KEY}.current`, convId);
          saveConv({ name: nameInput.value.trim() || (isGroup(parsed) ? '群聊' : (speakersOf(parsed).find((n) => n !== me) || '会话')), me, group: isGroup(parsed), messages: [], personas: {} });
        }
        const prev = conv() || {};
        const analyzedKeys = (prev.messages || []).map(msgKey);
        const toDo = incremental ? newMessages(parsed, analyzedKeys) : parsed;
        if (!toDo.length) { toast('没有新消息', 'info'); return; }
        summary.replaceChildren(h('div', { class: 'ca__working' }, `正在逐条分析 ${toDo.length} 条…`));
        // 逐条情绪 + 意图，分批（每批 30 条）免得超上下文
        const analyzed = [];
        for (let i = 0; i < toDo.length; i += 30) {
          const batch = toDo.slice(i, i + 30);
          const reply = await ai.chat(messagePrompt(batch, { me }));
          analyzed.push(...alignMessages(batch, extractJson(reply, [])));
          summary.replaceChildren(h('div', { class: 'ca__working' }, `逐条分析 ${Math.min(i + 30, toDo.length)}/${toDo.length}…`));
        }
        const merged = incremental ? [...(prev.messages || []), ...analyzed] : analyzed;
        saveConv({ messages: merged, me, group: isGroup(parsed) });
        // 画像：单聊给对方 + 我；群聊给整体
        summary.replaceChildren(h('div', { class: 'ca__working' }, '在做人物画像…'));
        const personas = { ...(prev.personas || {}) };
        if (isGroup(parsed)) {
          personas.__group__ = extractJson(await ai.chat(groupPrompt(parsed)), null);
        } else {
          for (const name of speakersOf(parsed)) personas[name] = extractJson(await ai.chat(personaPrompt(parsed, name, { me })), null);
        }
        saveConv({ personas });
        dump.value = '';
        toast(`分析完成：${merged.length} 条消息`, 'good');
        load();
      } catch (err) {
        toast(err.code === 'need-login' || /登录/.test(err.message || '') ? '模型未登录 / 未配置，去设置里看看' : (err.message || '分析失败'), 'bad', 7000);
        summary.replaceChildren();
      } finally { busy = false; importCard.querySelectorAll('button').forEach((b) => { b.disabled = false; }); }
    }

    const EMO_TONE = { 开心: 'good', 期待: 'good', 平静: '', 委屈: 'warn', 生气: 'bad', 疲惫: 'warn', 焦虑: 'warn', 无奈: 'warn', 暧昧: 'good', 敷衍: '' };

    function radar(dims) {
      const n = DIMENSIONS.length; const cx = 90; const cy = 84; const R = 62;
      const pt = (i, r) => [cx + r * Math.cos(-Math.PI / 2 + i * 2 * Math.PI / n), cy + r * Math.sin(-Math.PI / 2 + i * 2 * Math.PI / n)];
      const grid = [0.33, 0.66, 1].map((f) => `<polygon points="${DIMENSIONS.map((_, i) => pt(i, R * f).join(',')).join(' ')}" fill="none" stroke="var(--line)" stroke-width="1"/>`).join('');
      const poly = DIMENSIONS.map((d, i) => pt(i, R * Math.max(0, Math.min(100, Number(dims?.[d.key]) || 0)) / 100).join(',')).join(' ');
      const labels = DIMENSIONS.map((d, i) => { const [x, y] = pt(i, R + 14); return `<text x="${x}" y="${y}" font-size="9" fill="var(--text-dim)" text-anchor="middle" dominant-baseline="middle">${d.label}</text>`; }).join('');
      return h('div', { class: 'ca__radar', html: `<svg viewBox="0 0 180 168">${grid}<polygon points="${poly}" fill="color-mix(in srgb, var(--accent) 26%, transparent)" stroke="var(--accent)" stroke-width="1.5"/>${labels}</svg>` });
    }

    function personaCard(name, p, isMe) {
      if (!p) return h('article', { class: 'card ca__persona' }, h('div', { class: 'ca__persona-name' }, name), h('div', { class: 'faint' }, '这个人还没分析出画像'));
      const mbti = (p.mbti || []).map((x) => x.letter && x.letter !== '?' ? x.letter : '·').join('');
      return h('article', { class: 'card ca__persona' },
        h('div', { class: 'ca__persona-head' }, h('div', { class: 'ca__persona-name' }, name, isMe ? h('span', { class: 'tag' }, '我') : null), p.mbti ? h('span', { class: 'ca__mbti', title: 'MBTI 聊天推测' }, mbti) : null),
        radar(p.dims),
        typeof p.affinity === 'number' ? h('div', { class: 'ca__affinity' }, h('div', { class: 'ca__affinity-bar' }, h('span', { style: { width: `${Math.max(0, Math.min(100, p.affinity))}%` } })), h('span', { class: 'faint' }, `好感度 ${p.affinity} · ${p.affinityReason || ''}`)) : null,
        p.summary ? h('div', { class: 'ca__persona-sum' }, md(p.summary)) : null,
        (p.topics || []).length ? h('div', { class: 'ca__topics' }, ...p.topics.slice(0, 6).map((t) => h('span', { class: 'tag' }, t))) : null,
        p.mbti ? h('div', { class: 'ca__mbti-axes' }, ...MBTI_AXES.map((ax, i) => { const x = (p.mbti || [])[i] || {}; return h('span', { class: 'faint' }, `${ax[0]}/${ax[1]}: ${x.letter || '?'}${x.score ? ` ${x.score}` : ''}`); })) : null,
      );
    }

    function load() {
      renderConvs();
      const c = conv();
      meInput.value = c?.me || '';
      nameInput.value = c?.name || '';
      if (!c) { summary.replaceChildren(h('div', { class: 'ca__empty faint' }, '上面导入一段聊天记录，点「分析」。')); timeline.replaceChildren(); personaWrap.replaceChildren(); return; }
      const emo = {}; for (const m of c.messages || []) if (m.emotion) emo[m.emotion] = (emo[m.emotion] || 0) + 1;
      const top = Object.entries(emo).sort((a, b) => b[1] - a[1]).slice(0, 5);
      summary.replaceChildren(
        h('div', { class: 'ca__summary-head' }, h('strong', {}, c.name || '会话'), h('span', { class: 'tag' }, c.group ? '群聊' : '单聊'), h('span', { class: 'faint' }, `${(c.messages || []).length} 条 · ${new Date(c.updatedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`)),
        top.length ? h('div', { class: 'ca__emo-bars' }, ...top.map(([e, n]) => h('span', { class: `tag tag--${EMO_TONE[e] || 'neutral'}` }, `${e} ${n}`))) : null,
      );
      timeline.replaceChildren(...(c.messages || []).slice(-200).map((m) => h('div', { class: `ca__msg ${m.speaker === c.me ? 'is-me' : ''}` },
        h('div', { class: 'ca__msg-top' }, h('span', { class: 'ca__msg-who' }, m.speaker || '?'), m.emotion ? h('span', { class: `tag tag--${EMO_TONE[m.emotion] || 'neutral'}` }, m.emotion) : null, m.intent ? h('span', { class: 'tag' }, m.intent) : null),
        h('div', { class: 'ca__msg-text' }, m.text),
      )));
      if (c.group && c.personas?.__group__) {
        const g = c.personas.__group__;
        personaWrap.replaceChildren(h('article', { class: 'card ca__persona' },
          h('div', { class: 'ca__persona-head' }, h('div', { class: 'ca__persona-name' }, '群整体'), g.mood ? h('span', { class: 'tag' }, g.mood) : null),
          radar(g.dims), g.summary ? h('div', { class: 'ca__persona-sum' }, md(g.summary)) : null,
          (g.topics || []).length ? h('div', { class: 'ca__topics' }, ...g.topics.slice(0, 6).map((t) => h('span', { class: 'tag' }, t))) : null,
        ));
      } else {
        const names = Object.keys(c.personas || {}).filter((k) => k !== '__group__');
        personaWrap.replaceChildren(...names.map((name) => personaCard(name, c.personas[name], name === c.me)));
      }
    }

    root.append(
      h('div', { class: 'bar' }, h('strong', {}, '聊天分析'), h('span', { class: 'faint' }, '情绪 · 意图 · 人物画像 · MBTI · 好感度'), h('span', { style: { flex: 1 } }), convBar),
      h('div', { class: 'ca__body' },
        h('div', { class: 'ca__left' }, importCard, summary, timeline),
        h('aside', { class: 'ca__right' }, personaWrap),
      ),
    );
    load();
    return { activate: () => load() };
  },
};
