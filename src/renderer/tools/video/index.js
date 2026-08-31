import { h, toast } from '../../core/ui.js';

/**
 * 视频报告：贴一个 B 站链接 → 抓公开信息 → 拉字幕（官方优先，AI 兜底）→
 * AI 按字幕写逐集笔记 → 本地存 Markdown，顺手用 lark-cli 发到飞书。
 * 报告文件永远在本地留底，飞书发不出去也不丢。
 *
 * 字幕策略：视频本身有 UP 主上传的官方字幕就直接用；没有才拉 B 站 AI 生成字幕。
 * 都没字幕就退化成「内容地图型」报告（标题/简介/分集大纲）。
 */
export default {
  id: 'video',
  title: '视频',
  icon: '📺',
  hint: '贴 B 站链接，拉字幕生成内容级总结报告，存本地并可一键发到飞书',

  create(root, ctx) {
    const { config, ai } = ctx;
    const video = window.toolbox.video;
    const clipboard = window.toolbox.clipboard;

    let info = null; // 抓到的视频信息
    let busy = false;

    const linkInput = h('input', {
      class: 'field video__link',
      placeholder: '粘贴 B 站链接，回车抓取（https://www.bilibili.com/video/BV…）',
      onkeydown: (e) => {
        if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); fetchInfo(); }
      },
    });
    const fetchBtn = h('button', { class: 'btn btn--sm btn--primary', onclick: () => fetchInfo() }, '抓取');

    const aiToggle = h('input', { type: 'checkbox', class: 'switch__input' });
    aiToggle.checked = config.get('video.useAi', true);
    aiToggle.addEventListener('change', () => config.set('video.useAi', aiToggle.checked));

    const publishToggle = h('input', { type: 'checkbox', class: 'switch__input' });
    publishToggle.checked = config.get('video.publish', true);
    publishToggle.addEventListener('change', () => config.set('video.publish', publishToggle.checked));

    const subsScope = h('select', { class: 'field video__scope' },
      h('option', { value: 'p1' }, '字幕：仅第 1 集'),
      h('option', { value: 'p5' }, '字幕：前 5 集'),
      h('option', { value: 'all' }, '字幕：全部集（慢）'),
      h('option', { value: 'none' }, '字幕：不拉取'),
    );
    subsScope.value = config.get('video.subsScope', 'p1');
    subsScope.addEventListener('change', () => config.set('video.subsScope', subsScope.value));

    const body = h('div', { class: 'video__body' });
    const historyEl = h('div', { class: 'video__history' });

    function fmtDuration(seconds) {
      const s = Math.max(0, Math.round(seconds));
      const hh = Math.floor(s / 3600);
      const mm = Math.floor((s % 3600) / 60);
      const ss = s % 60;
      return hh ? `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${mm}:${String(ss).padStart(2, '0')}`;
    }

    function fmtCount(n) {
      return n >= 10000 ? `${(n / 10000).toFixed(1)}万` : String(n);
    }

    function showError(message, needLogin) {
      body.textContent = '';
      body.appendChild(h('div', { class: 'empty' },
        h('span', { class: 'empty__icon' }, needLogin ? '🔑' : '⚠️'),
        message,
        needLogin && h('div', { style: { marginTop: '14px' } },
          h('button', { class: 'btn btn--primary', onclick: () => ctx.goto('ask') }, '去登录 DeepSeek'),
        ),
      ));
    }

    function showProgress(text, note) {
      body.textContent = '';
      body.appendChild(h('div', { class: 'empty' },
        h('span', { class: 'spinner' }), ` ${text}`,
        note && h('div', { class: 'faint video__note' }, note),
      ));
    }

    async function fetchInfo() {
      const url = linkInput.value.trim();
      if (!url) return toast('先贴链接', 'info');
      if (busy) return;
      busy = true;
      fetchBtn.disabled = true;
      showProgress('正在抓视频信息…');
      try {
        const result = await video.fetchInfo(url);
        if (!result.ok) return showError(result.error);
        info = result.info;
        renderInfo();
      } catch (err) {
        showError(err.message);
      } finally {
        busy = false;
        fetchBtn.disabled = false;
      }
    }

    function renderInfo() {
      body.textContent = '';
      body.appendChild(
        h('div', { class: 'card video__info' },
          h('div', { class: 'video__title' }, info.title),
          h('div', { class: 'video__meta faint' },
            `${info.owner || '未知 UP 主'} · ${info.pubdate || '未知日期'} · 共 ${info.pages.length} 集 · 总长 ${fmtDuration(info.duration)} · 播放 ${fmtCount(info.stat.view)}`),
          info.desc && h('div', { class: 'video__desc' }, info.desc.slice(0, 400) + (info.desc.length > 400 ? '…' : '')),
          h('div', { class: 'video__options' },
            subsScope,
            h('label', { class: 'switch' }, aiToggle, h('span', { class: 'switch__track' }), 'AI 写摘要'),
            h('label', { class: 'switch' }, publishToggle, h('span', { class: 'switch__track' }), '同时发到飞书'),
            h('span', { style: { flex: 1 } }),
            h('button', { class: 'btn btn--primary', onclick: () => generate() }, '生成报告'),
          ),
        ),
      );
    }

    function partTitle(page) {
      const p = info.pages.find((x) => x.page === page);
      return p ? p.part : '';
    }

    function buildMarkdown({ aiParts, notes, subsKind, subsPages }) {
      const lines = [];
      lines.push(`# B站视频总结报告：${info.title}`, '');
      lines.push('## 一屏摘要', '');
      lines.push(aiParts?.summary || info.desc || '（无简介）', '');
      lines.push('## 视频基本信息', '');
      lines.push(`- 标题：${info.title}`);
      lines.push(`- BV号：${info.bvid}`);
      lines.push(`- 链接：${info.url}`);
      lines.push(`- UP主：${info.owner || '未知'}`);
      lines.push(`- 发布日期：${info.pubdate || '未知'}`);
      lines.push(`- 总时长：${fmtDuration(info.duration)}（共 ${info.pages.length} 集）`);
      lines.push(`- 播放/弹幕/点赞/投币/收藏：${fmtCount(info.stat.view)} / ${fmtCount(info.stat.danmaku)} / ${fmtCount(info.stat.like)} / ${fmtCount(info.stat.coin)} / ${fmtCount(info.stat.favorite)}`);
      lines.push('');
      if (notes && notes.length) {
        const kindLabel = subsKind === 'official' ? '官方字幕' : 'B 站 AI 生成字幕';
        lines.push(`## 逐集内容笔记（基于${kindLabel}）`, '');
        for (const n of notes) {
          const t = partTitle(n.page);
          lines.push(`### P${n.page}${t ? ` ${t}` : ''}`, '', n.note, '');
        }
        if (subsPages && subsPages < info.pages.length) {
          lines.push(`> 仅拉取并总结了前 ${subsPages} 集的字幕，其余分集见下方大纲。`, '');
        }
      }
      if (info.pages.length > 1) {
        lines.push(`## 分集大纲（${info.pages.length} 集）`, '');
        for (const p of info.pages) {
          lines.push(`${p.page}. ${p.part}（${fmtDuration(p.duration)}）`);
        }
        lines.push('');
      }
      if (aiParts?.path) lines.push('## 学习路径建议', '', aiParts.path, '');
      if (aiParts?.audience) lines.push('## 适合人群', '', aiParts.audience, '');
      lines.push('---');
      lines.push(notes && notes.length
        ? `> 由 Agent 工具箱「视频」生成。内容基于${subsKind === 'official' ? '官方字幕' : 'B 站 AI 字幕'}全文总结，AI 字幕可能有个别错别字。`
        : '> 由 Agent 工具箱「视频」生成。未获取到字幕，本报告为内容地图型摘要（标题/简介/分集大纲），非逐句转写。');
      return lines.join('\n');
    }

    /** 把字幕集按字符数切成批次，控制每次 AI 调用的体量 */
    function makeBatches(episodes) {
      const batches = [];
      let cur = [];
      let chars = 0;
      for (const ep of episodes) {
        if (cur.length && (chars + ep.chars > 30000 || cur.length >= 6)) {
          batches.push(cur);
          cur = [];
          chars = 0;
        }
        cur.push(ep);
        chars += ep.chars;
      }
      if (cur.length) batches.push(cur);
      return batches.slice(0, 10); // 最多 10 批，再多的等不起
    }

    async function askAiOverall(notesDigest) {
      const pagesPreview = info.pages.slice(0, 40).map((p) => `${p.page}. ${p.part}`).join('\n');
      return ai.json(
        [
          '根据下面的 B 站视频信息，写一份视频报告的三个部分。',
          '返回 JSON：{"summary": "一屏摘要，3-5 句话讲清这个视频讲什么、有什么价值", "path": "学习路径建议，分 3-5 步", "audience": "适合人群，2-3 句"}',
          '不要用 markdown 代码块包裹，直接返回 JSON。',
          '',
          `标题：${info.title}`,
          `UP主：${info.owner}`,
          `简介：${info.desc || '（无）'}`,
          `分集大纲（共 ${info.pages.length} 集）：\n${pagesPreview}`,
          notesDigest ? `\n部分内容笔记（基于字幕）：\n${notesDigest}` : '',
        ].join('\n'),
        { timeout: 90000 },
      );
    }

    async function askAiBatchNotes(batch) {
      const parts = batch.map((ep) =>
        `【第 ${ep.page} 集：${partTitle(ep.page)}】\n${ep.text.slice(0, 12000)}`);
      const result = await ai.json(
        [
          '下面是 B 站视频若干集的字幕文本（AI 字幕可能有个别错别字，按上下文理解）。',
          '为每一集写 100-250 字的内容笔记：讲清实际讲了什么、关键技术点/结论，不要泛泛而谈；明显是卖课营销的内容标注（营销内容）并一句话带过。',
          '返回 JSON：{"notes": [{"page": 集数数字, "note": "笔记"}]}，每集一条。不要用 markdown 代码块包裹。',
          '',
          parts.join('\n\n'),
        ].join('\n'),
        { timeout: 120000 },
      );
      return Array.isArray(result?.notes) ? result.notes : [];
    }

    async function generate() {
      if (!info || busy) return;
      busy = true;
      const useSubs = subsScope.value !== 'none';
      showProgress('正在生成报告…', aiToggle.checked ? `AI 摘要走 ${ai.describe()}，要慢一些。` : '未开 AI 摘要，用视频简介顶上。');
      try {
        let subs = null;
        if (useSubs) {
          showProgress('正在拉取字幕…', '优先官方字幕，没有再拉 B 站 AI 字幕（借浏览器登录态）。');
          try {
            const result = await video.fetchSubs({ url: info.url, scope: subsScope.value });
            if (result.ok && result.episodes?.length) {
              subs = result;
            } else {
              toast(result.error || '没拿到字幕，改用大纲生成', 'info');
            }
          } catch (err) {
            toast(`字幕拉取失败（${err.message}），改用大纲生成`, 'bad');
          }
        }

        let aiParts = null;
        let notes = [];
        if (aiToggle.checked) {
          try {
            if (subs) {
              const batches = makeBatches(subs.episodes);
              for (let i = 0; i < batches.length; i += 1) {
                showProgress(`AI 正在读字幕写笔记（${i + 1}/${batches.length}）…`, `走 ${ai.describe()}`);
                const got = await askAiBatchNotes(batches[i]);
                notes.push(...got);
              }
              const digest = notes.slice(0, 12).map((n) => `P${n.page}: ${n.note}`).join('\n');
              showProgress('AI 正在汇总整体摘要…');
              aiParts = await askAiOverall(digest);
            } else {
              aiParts = await askAiOverall(null);
            }
          } catch (err) {
            if (err.code === 'need-login') return showError('AI 还没登录，先去登录一次再来。', true);
            toast(`AI 摘要失败（${err.message}），改用视频简介`, 'bad');
          }
        }
        const markdown = buildMarkdown({
          aiParts,
          notes,
          subsKind: subs?.kind,
          subsPages: subs?.episodes?.length || 0,
        });
        const title = `B站视频总结报告：${info.title}`;
        const result = await video.saveReport({ title, markdown, bvid: info.bvid, publish: publishToggle.checked });
        renderResult(markdown, result);
        renderHistory();
      } catch (err) {
        showError(err.message);
      } finally {
        busy = false;
      }
    }

    /** 极简 Markdown 渲染：标题/列表/加粗/行内代码/引用/分割线/链接，先转义再拼，报告内容来自 AI 也不怕 */
    function mdToHtml(md) {
      const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const inline = (s) => esc(s)
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\[([^\]]+)\]\((https?:[^\s)]+)\)/g, '<a href="#" data-url="$2">$1</a>')
        .replace(/\*([^*]+)\*/g, '<em>$1</em>');
      const out = [];
      let list = null;
      const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
      for (const raw of String(md).split('\n')) {
        const line = raw.trimEnd();
        let m;
        if ((m = line.match(/^(#{1,3})\s+(.*)$/))) { closeList(); out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); continue; }
        if (/^---+\s*$/.test(line)) { closeList(); out.push('<hr>'); continue; }
        if ((m = line.match(/^>\s?(.*)$/))) { closeList(); out.push(`<blockquote>${inline(m[1])}</blockquote>`); continue; }
        if ((m = line.match(/^[-*]\s+(.*)$/))) {
          if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; }
          out.push(`<li>${inline(m[1])}</li>`); continue;
        }
        if ((m = line.match(/^\d+[.、]\s+(.*)$/))) {
          if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; }
          out.push(`<li>${inline(m[1])}</li>`); continue;
        }
        if (!line.trim()) { closeList(); continue; }
        closeList();
        out.push(`<p>${inline(line)}</p>`);
      }
      closeList();
      return out.join('');
    }

    /** 渲染出的文章里的链接走系统浏览器（壳有 CSP 且不让内页导航走） */
    function bindArticleLinks(articleEl) {
      articleEl.addEventListener('click', (e) => {
        const a = e.target.closest('a[data-url]');
        if (!a) return;
        e.preventDefault();
        window.toolbox.shell.openExternal(a.dataset.url);
      });
    }

    function renderResult(markdown, result, { fromHistory = false } = {}) {
      body.textContent = '';
      if (fromHistory) {
        body.appendChild(h('div', { class: 'video__reader-bar' },
          h('button', {
            class: 'btn btn--sm',
            onclick: () => {
              body.textContent = '';
              body.appendChild(h('div', { class: 'empty' },
                h('span', { class: 'empty__icon' }, '📺'),
                '贴一个 B 站视频链接，回车抓取。'));
            },
          }, '‹ 返回'),
          h('span', { class: 'faint' }, '正在阅读历史报告'),
        ));
      }
      body.appendChild(
        h('div', { class: 'card video__result' },
          h('div', { class: 'video__result-head' },
            h('span', { class: 'tag tag--good' }, '已存本地'),
            h('code', { class: 'faint video__path' }, result.localPath),
            h('button', {
              class: 'btn btn--sm',
              onclick: async () => { await clipboard.write(result.localPath); toast('路径已复制', 'good'); },
            }, '复制路径'),
            h('button', { class: 'btn btn--sm', onclick: () => window.toolbox.chat.showInFinder(result.localPath) }, '在访达显示'),
          ),
          result.docUrl && h('div', { class: 'video__result-head' },
            h('span', { class: 'tag tag--good' }, '已发飞书'),
            h('a', {
              class: 'video__doc-link', href: '#',
              onclick: (e) => { e.preventDefault(); window.toolbox.shell.openExternal(result.docUrl); },
            }, result.docUrl),
            h('button', {
              class: 'btn btn--sm',
              onclick: async () => { await clipboard.write(result.docUrl); toast('链接已复制', 'good'); },
            }, '复制链接'),
          ),
          result.publishError && h('div', { class: 'video__publish-error' },
            h('span', { class: 'tag tag--warn' }, '飞书未发'), result.publishError),
          result.publishNote && h('div', { class: 'faint video__note' }, result.publishNote),
        ),
        (() => {
          const article = h('div', { class: 'card video__article', html: mdToHtml(markdown) });
          bindArticleLinks(article);
          return article;
        })(),
      );
    }

    async function renderHistory() {
      historyEl.textContent = '';
      let reports = [];
      try {
        reports = await video.listReports();
      } catch { /* 忽略 */ }
      if (!reports.length) return;
      historyEl.appendChild(h('div', { class: 'video__history-head faint' }, '历史报告（本地留底）'));
      for (const r of reports) {
        historyEl.appendChild(h('div', {
          class: 'video__history-item',
          onclick: () => openReport(r),
        },
          h('div', { class: 'video__history-title' }, r.title),
          h('div', { class: 'faint' },
            new Date(r.mtime).toLocaleString('zh-CN', { hour12: false }),
            r.docUrl && h('span', { class: 'tag tag--good video__history-feishu' }, '飞书')),
        ));
      }
    }

    async function openReport(r) {
      const result = await video.readReport(r.name);
      if (!result.ok) return toast(result.error, 'bad');
      renderResult(
        result.content,
        { localPath: result.path, docUrl: result.docUrl },
        { fromHistory: true },
      );
    }

    root.append(
      h('div', { class: 'bar bar--drag' },
        h('strong', {}, '视频报告'),
        linkInput,
        fetchBtn,
      ),
      h('div', { class: 'video__scroll' }, body, historyEl),
    );

    body.appendChild(h('div', { class: 'empty' },
      h('span', { class: 'empty__icon' }, '📺'),
      '贴一个 B 站视频链接，回车抓取。',
      h('br'),
      h('span', { class: 'faint' }, '有字幕就按字幕写内容级总结（官方字幕优先，没有再拉 AI 字幕）；报告永远存到本地 reports/ 目录，开了「发飞书」就顺手建一篇飞书文档。'),
    ));
    renderHistory();

    return { activate: () => setTimeout(() => linkInput.focus(), 30) };
  },
};
