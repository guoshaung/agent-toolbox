import { h, toast } from '../../core/ui.js';

/**
 * 视频报告：贴一个 B 站链接 → 抓公开信息 → AI 写摘要 → 本地存 Markdown，
 * 顺手用 lark-cli 发到飞书。报告文件永远在本地留底，飞书发不出去也不丢。
 *
 * 注意：B 站公开 API 拿不到字幕，所以这是「内容地图型」报告（标题/简介/分集大纲），
 * 不是逐句转写。要语音级总结得另接 ASR。
 */
export default {
  id: 'video',
  title: '视频',
  icon: '📺',
  hint: '贴 B 站链接，生成视频总结报告，存本地并可一键发到飞书',

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

    async function fetchInfo() {
      const url = linkInput.value.trim();
      if (!url) return toast('先贴链接', 'info');
      if (busy) return;
      busy = true;
      fetchBtn.disabled = true;
      body.textContent = '';
      body.appendChild(h('div', { class: 'empty' }, h('span', { class: 'spinner' }), ' 正在抓视频信息…'));
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
            h('label', { class: 'switch' }, aiToggle, h('span', { class: 'switch__track' }), 'AI 写摘要和建议'),
            h('label', { class: 'switch' }, publishToggle, h('span', { class: 'switch__track' }), '同时发到飞书'),
            h('span', { style: { flex: 1 } }),
            h('button', { class: 'btn btn--primary', onclick: () => generate() }, '生成报告'),
          ),
        ),
      );
    }

    function buildMarkdown(aiParts) {
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
      if (info.pages.length > 1) {
        lines.push(`## 分集大纲（${info.pages.length} 集）`, '');
        for (const p of info.pages) {
          lines.push(`${p.page}. ${p.part}（${fmtDuration(p.duration)}）`);
        }
        lines.push('');
      }
      if (aiParts?.path) lines.push('## 学习路径建议', '', aiParts.path, '');
      if (aiParts?.audience) lines.push('## 适合人群', '', aiParts.audience, '');
      lines.push('---', `> 由 Agent 工具箱「视频」生成。B 站公开 API 无字幕，本报告为内容地图型摘要，非逐句转写。`);
      return lines.join('\n');
    }

    async function askAi() {
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
        ].join('\n'),
        { timeout: 90000 },
      );
    }

    async function generate() {
      if (!info || busy) return;
      busy = true;
      body.textContent = '';
      body.appendChild(h('div', { class: 'empty' }, h('span', { class: 'spinner' }), ' 正在生成报告…',
        h('div', { class: 'faint video__note' }, aiToggle.checked ? `AI 摘要走 ${ai.describe()}，要慢几秒。` : '未开 AI 摘要，用视频简介顶上。')));
      try {
        let aiParts = null;
        if (aiToggle.checked) {
          try {
            aiParts = await askAi();
          } catch (err) {
            if (err.code === 'need-login') return showError('AI 还没登录，先去登录一次再来。', true);
            toast(`AI 摘要失败（${err.message}），改用视频简介`, 'bad');
          }
        }
        const markdown = buildMarkdown(aiParts);
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

    function renderResult(markdown, result) {
      body.textContent = '';
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
        h('div', { class: 'card video__markdown' }, markdown),
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
          h('div', { class: 'faint' }, new Date(r.mtime).toLocaleString('zh-CN', { hour12: false })),
        ));
      }
    }

    async function openReport(r) {
      const result = await video.readReport(r.name);
      if (!result.ok) return toast(result.error, 'bad');
      renderResult(result.content, { localPath: result.path });
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
      h('span', { class: 'faint' }, '报告会存到本地 reports/ 目录；开了「发飞书」就顺手用 lark-cli 建一篇飞书文档。'),
    ));
    renderHistory();

    return { activate: () => setTimeout(() => linkInput.focus(), 30) };
  },
};
