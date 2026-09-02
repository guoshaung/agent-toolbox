import { h, toast } from '../../core/ui.js';
import { MODULES } from './data/index.js';
import { BUILTIN_SITES, DOMAIN_LABELS } from './data/sites.js';
import { highlightBlock } from './highlight.js';
import { diffLines, verdict } from './recite.js';
import { createQuizPanel } from './quiz.js';
import { PageScraper, buildKnowledgePrompt, buildSiteDiscoveryPrompt } from './scrape.js';
import { createPracticePanel } from './practice.js';

const VIEWS = [
  { id: 'practice', label: '实践敲码' },
  { id: 'templates', label: '模板背诵' },
  { id: 'quiz', label: 'AI 出题' },
  { id: 'sites', label: '知识网站' },
];

export default {
  id: 'study',
  title: '学习',
  icon: 'book',
  hint: '必背模板 / AI 出题 / 知识网站（Cmd+5）',

  create(root, ctx) {
    const { config, ai } = ctx;

    let moduleId = config.get('study.lastModule', MODULES[0].id);
    let templateId = null;
    let view = 'templates';

    const scraper = new PageScraper(document.getElementById('bridge-host'));

    const practice = createPracticePanel(ctx);

    // ---------- 数据：内置 + 用户自己加的 ----------
    const userTemplates = () => config.get('study.userTemplates') || [];

    function currentModule() {
      return MODULES.find((m) => m.id === moduleId) || MODULES[0];
    }

    function templatesOf(id) {
      const base = (MODULES.find((m) => m.id === id)?.templates) || [];
      const mine = userTemplates().filter((t) => t.moduleId === id);
      return [...base, ...mine];
    }

    function currentTemplate() {
      const list = templatesOf(moduleId);
      return list.find((t) => t.id === templateId) || list[0] || null;
    }

    const masteredKey = (t) => `study.mastered.${moduleId}__${t.id}`;
    const isMastered = (t) => !!config.get(masteredKey(t));

    // ---------- 侧栏 ----------
    const moduleList = h('div', { class: 'study__modules' });
    const templateList = h('div', { class: 'study__templates' });

    function renderModules() {
      moduleList.textContent = '';
      for (const mod of MODULES) {
        const count = templatesOf(mod.id).length;
        moduleList.append(h('button', {
          class: `study__module${mod.id === moduleId ? ' is-active' : ''}`,
          onclick: () => {
            moduleId = mod.id;
            templateId = null;
            config.set('study.lastModule', moduleId);
            renderModules();
            renderTemplateList();
            renderMain();
          },
        },
          h('span', { class: 'study__module-icon' }, mod.icon),
          h('span', { class: 'study__module-name' }, mod.name),
          h('span', { class: 'study__module-count faint' }, String(count)),
        ));
      }
    }

    function renderTemplateList() {
      templateList.textContent = '';
      const list = templatesOf(moduleId);
      const active = currentTemplate();
      const done = list.filter(isMastered).length;

      templateList.append(h('div', { class: 'study__templates-head faint' },
        `模板 ${done}/${list.length} 已背熟`));

      for (const tpl of list) {
        templateList.append(h('button', {
          class: `study__tpl${active && tpl.id === active.id ? ' is-active' : ''}`,
          onclick: () => { templateId = tpl.id; renderTemplateList(); renderMain(); },
        },
          h('span', { class: 'study__tpl-dot', dataset: { done: String(isMastered(tpl)) } }, isMastered(tpl) ? '✓' : '○'),
          h('span', { class: 'study__tpl-title' }, tpl.title),
        ));
      }

      templateList.append(h('button', {
        class: 'study__tpl study__tpl--add',
        onclick: () => openTemplateEditor(),
      }, '＋ 加一个自己的模板'));
    }

    // ---------- 模板详情 / 背诵 ----------
    const main = h('div', { class: 'study__main' });

    function renderTemplateView() {
      const tpl = currentTemplate();
      main.textContent = '';
      if (!tpl) {
        main.append(h('div', { class: 'empty' }, '这个模块还没有模板，点左边「加一个自己的模板」。'));
        return;
      }

      let mode = 'read'; // read | hide | write
      const codeBlock = h('pre', { class: 'code code--block', html: highlightBlock(tpl.code, tpl.lang || 'python') });
      const writeArea = h('textarea', {
        class: 'field study__write',
        placeholder: '凭记忆把这段代码默写出来，写完点「对比」。\n对比时会忽略注释和空行，只看代码本身。',
      });
      const diffBox = h('div', { class: 'study__diff' });

      const modeBar = h('div', { class: 'study__modes' });
      const modes = [
        { id: 'read', label: '看代码' },
        { id: 'hide', label: '遮住' },
        { id: 'write', label: '默写' },
      ];
      for (const m of modes) {
        modeBar.append(h('button', {
          class: `btn btn--sm${m.id === mode ? ' btn--primary' : ''}`,
          dataset: { mode: m.id },
          onclick: () => setMode(m.id),
        }, m.label));
      }

      function setMode(next) {
        mode = next;
        for (const btn of modeBar.children) {
          btn.classList.toggle('btn--primary', btn.dataset.mode === mode);
        }
        codeBlock.hidden = mode !== 'read';
        writeArea.hidden = mode !== 'write';
        compareBtn.hidden = mode !== 'write';
        revealBtn.hidden = mode === 'read';
        hideHint.hidden = mode !== 'hide';
        if (mode !== 'write') diffBox.textContent = '';
        if (mode === 'write') setTimeout(() => writeArea.focus(), 30);
      }

      const compareBtn = h('button', {
        class: 'btn btn--sm btn--primary',
        onclick: () => {
          if (!writeArea.value.trim()) return toast('先默写点东西', 'info');
          const result = diffLines(tpl.code, writeArea.value, tpl.lang === 'javascript' ? '//' : '#');
          const v = verdict(result.score);
          diffBox.textContent = '';
          diffBox.append(
            h('div', { class: 'study__diff-head' },
              h('span', { class: `tag tag--${v.kind}` }, `${Math.round(result.score * 100)}%`),
              h('strong', {}, v.text),
              h('span', { class: 'faint' }, `对上 ${result.matched} / ${result.expectedLines} 行有效代码`),
            ),
            h('div', { class: 'study__diff-body' },
              ...result.rows.map((row) => h('div', { class: `study__diff-row study__diff-row--${row.type}` },
                h('span', { class: 'study__diff-sign' }, row.type === 'missing' ? '−' : row.type === 'extra' ? '+' : ' '),
                h('code', {}, row.text),
              )),
            ),
            h('div', { class: 'faint study__diff-legend' }, '− 是你漏掉的　+ 是你多写的'),
          );
        },
      }, '对比');

      const revealBtn = h('button', {
        class: 'btn btn--sm',
        onclick: () => setMode('read'),
      }, '显示答案');

      const hideHint = h('div', { class: 'study__hide-hint' },
        '代码已遮住。先在脑子里过一遍：这段的骨架是什么？哪几行最容易写错？',
      );

      main.append(
        h('div', { class: 'study__head' },
          h('h2', { class: 'study__title' }, tpl.title),
          h('div', { class: 'study__tags' },
            ...(tpl.tags || []).map((t) => h('span', { class: `tag${t === '必背' ? ' tag--warn' : ''}` }, t)),
            h('span', { class: 'tag' }, tpl.lang || 'python'),
          ),
          h('span', { style: { flex: 1 } }),
          h('button', {
            class: `btn btn--sm${isMastered(tpl) ? ' btn--primary' : ''}`,
            onclick: async (e) => {
              const now = isMastered(tpl);
              await config.set(masteredKey(tpl), now ? undefined : Date.now());
              e.target.classList.toggle('btn--primary', !now);
              renderTemplateList();
            },
          }, isMastered(tpl) ? '✓ 已背熟' : '标记背熟'),
          h('button', {
            class: 'btn btn--sm',
            onclick: async () => { await window.toolbox.clipboard.write(tpl.code); toast('代码已复制', 'good'); },
          }, '复制'),
          tpl.moduleId ? h('button', {
            class: 'btn btn--sm btn--ghost',
            onclick: async () => {
              await config.set('study.userTemplates', userTemplates().filter((x) => x.id !== tpl.id));
              templateId = null;
              renderTemplateList();
              renderMain();
            },
          }, '删除') : null,
        ),

        tpl.why ? h('div', { class: 'study__why' },
          h('span', { class: 'study__why-label' }, '为什么要背'), tpl.why) : null,

        modeBar,
        hideHint,
        codeBlock,
        writeArea,
        h('div', { class: 'study__write-actions' }, compareBtn, revealBtn),
        diffBox,

        (tpl.points || []).length ? h('div', { class: 'study__notes' },
          h('h3', { class: 'card__title' }, '关键点'),
          h('ul', {}, ...(tpl.points || []).map((p) => h('li', {}, p))),
        ) : null,

        (tpl.pitfalls || []).length ? h('div', { class: 'study__notes study__notes--warn' },
          h('h3', { class: 'card__title' }, '容易翻车的地方'),
          h('ul', {}, ...(tpl.pitfalls || []).map((p) => h('li', {}, p))),
        ) : null,
      );

      setMode('read');
    }

    // ---------- 自己加模板 ----------
    function openTemplateEditor() {
      const title = h('input', { class: 'field', placeholder: '模板标题，比如「Redis 分布式锁」' });
      const lang = h('select', { class: 'field field--sm' },
        h('option', { value: 'python' }, 'python'),
        h('option', { value: 'javascript' }, 'javascript'),
      );
      const why = h('input', { class: 'field', placeholder: '为什么值得背（可留空）' });
      const code = h('textarea', { class: 'field study__editor-code', placeholder: '把代码粘进来' });
      const points = h('textarea', { class: 'field', placeholder: '关键点，一行一条（可留空）' });

      main.textContent = '';
      main.append(h('div', { class: 'study__editor' },
        h('h2', { class: 'study__title' }, `给「${currentModule().name}」加一个模板`),
        title, why, lang, code, points,
        h('div', { class: 'study__editor-actions' },
          h('button', {
            class: 'btn btn--primary',
            onclick: async () => {
              if (!title.value.trim() || !code.value.trim()) return toast('标题和代码都得填', 'bad');
              const tpl = {
                id: `u_${Date.now().toString(36)}`,
                moduleId,                          // 有 moduleId 的就是用户自己加的
                title: title.value.trim(),
                lang: lang.value,
                why: why.value.trim(),
                code: code.value,
                tags: ['我加的'],
                points: points.value.split('\n').map((s) => s.trim()).filter(Boolean),
                pitfalls: [],
              };
              await config.set('study.userTemplates', [...userTemplates(), tpl]);
              templateId = tpl.id;
              renderTemplateList();
              renderMain();
              toast('已保存', 'good');
            },
          }, '保存'),
          h('button', { class: 'btn', onclick: () => renderMain() }, '取消'),
        ),
      ));
    }

    // ---------- 知识网站 ----------
    function allSites() {
      return [...BUILTIN_SITES, ...(config.get('study.sites') || [])];
    }

    function renderSitesView() {
      main.textContent = '';

      const topic = h('input', {
        class: 'field',
        placeholder: '想学什么？比如「Rust 异步编程」「因果推断」',
        onkeydown: (e) => { if (e.key === 'Enter' && !e.isComposing) discover(); },
      });
      const discoverOut = h('div', { class: 'study__discover' });

      async function discover() {
        const text = topic.value.trim();
        if (!text) return toast('先说个方向', 'info');
        discoverOut.textContent = '';
        discoverOut.append(h('div', { class: 'faint' }, h('span', { class: 'spinner' }), ` 让 ${ai.describe()} 找找…`));
        try {
          const result = await ai.json(buildSiteDiscoveryPrompt(text), { timeout: 100000 });
          const sites = Array.isArray(result.sites) ? result.sites : [];
          discoverOut.textContent = '';
          if (!sites.length) return discoverOut.append(h('div', { class: 'faint' }, '没找到。'));
          discoverOut.append(h('div', { class: 'faint study__warn' },
            '这些是模型给的，网址可能失效或记错 —— 点开看一眼再决定要不要收藏。'));
          for (const site of sites) {
            discoverOut.append(h('div', { class: 'study__site' },
              h('div', { class: 'study__site-main' },
                h('a', {
                  class: 'study__site-name',
                  href: '#',
                  onclick: (e) => { e.preventDefault(); openInDocs(site.url); },
                }, site.name || site.url),
                site.level ? h('span', { class: 'tag' }, site.level) : null,
                h('div', { class: 'faint study__site-note' }, site.note || ''),
                h('div', { class: 'faint mono study__site-url' }, site.url || ''),
              ),
              h('div', { class: 'study__site-actions' },
                h('button', {
                  class: 'btn btn--sm',
                  onclick: async () => {
                    const list = config.get('study.sites') || [];
                    if (list.some((x) => x.url === site.url)) return toast('已经收藏过了', 'info');
                    list.push({ domain: 'custom', name: site.name, url: site.url, note: site.note || '' });
                    await config.set('study.sites', list);
                    toast('已收藏', 'good');
                  },
                }, '收藏'),
                h('button', { class: 'btn btn--sm', onclick: () => analyzeUrl(site.url) }, '分析知识点'),
              ),
            ));
          }
        } catch (err) {
          discoverOut.textContent = '';
          discoverOut.append(aiError(err));
        }
      }

      const analyzeInput = h('input', {
        class: 'field mono',
        placeholder: '粘一个网址，把它的知识点整理出来',
        onkeydown: (e) => { if (e.key === 'Enter' && !e.isComposing) analyzeUrl(analyzeInput.value.trim()); },
      });
      const analyzeOut = h('div', { class: 'study__analyze' });

      async function analyzeUrl(url) {
        if (!url) return toast('先填个网址', 'info');
        analyzeInput.value = url;
        analyzeOut.textContent = '';
        analyzeOut.append(h('div', { class: 'faint' }, h('span', { class: 'spinner' }), ' 打开页面、抓正文…'));
        try {
          const page = await scraper.fetch(url);
          analyzeOut.textContent = '';
          analyzeOut.append(h('div', { class: 'faint' },
            h('span', { class: 'spinner' }), ` 抓到 ${page.length} 字，交给 ${ai.describe()} 整理…`));

          const result = await ai.json(buildKnowledgePrompt(page), { timeout: 150000 });
          renderKnowledge(page, result);
        } catch (err) {
          analyzeOut.textContent = '';
          analyzeOut.append(aiError(err));
        }
      }

      function renderKnowledge(page, result) {
        const points = Array.isArray(result.points) ? result.points : [];
        analyzeOut.textContent = '';
        analyzeOut.append(
          h('div', { class: 'study__source faint' },
            '来源：', h('a', { href: '#', onclick: (e) => { e.preventDefault(); openInDocs(page.url); } }, page.title || page.url),
            h('div', { class: 'study__warn' }, '以下内容由模型整理自该网页，不代表它一定正确 —— 关键结论请回原文核对。'),
          ),
          result.summary ? h('div', { class: 'study__summary' }, result.summary) : null,
          points.length ? h('div', { class: 'study__points' },
            ...points.map((p) => h('div', { class: `study__point study__point--${p.importance || 'mid'}` },
              h('div', { class: 'study__point-title' }, p.title || ''),
              h('div', { class: 'faint' }, p.detail || ''),
            )),
          ) : null,
          Array.isArray(result.snippets) && result.snippets.length
            ? h('div', { class: 'study__snippets' },
                ...result.snippets.map((s) => h('div', { class: 'study__snippet' },
                  h('div', { class: 'faint' }, s.caption || ''),
                  h('pre', { class: 'code code--block', html: highlightBlock(String(s.code || ''), s.lang || 'python') }),
                  h('button', {
                    class: 'btn btn--sm',
                    onclick: async () => {
                      const tpl = {
                        id: `u_${Date.now().toString(36)}`,
                        moduleId,
                        title: s.caption || '从网页存下的片段',
                        lang: s.lang || 'python',
                        why: `来自 ${page.url}`,
                        code: String(s.code || ''),
                        tags: ['我加的'],
                        points: [],
                        pitfalls: [],
                      };
                      await config.set('study.userTemplates', [...userTemplates(), tpl]);
                      renderTemplateList();
                      toast(`已存进「${currentModule().name}」的模板里`, 'good');
                    },
                  }, `存成「${currentModule().name}」的模板`),
                )),
              )
            : null,
          Array.isArray(result.gaps) && result.gaps.length
            ? h('div', { class: 'study__notes study__notes--warn' },
                h('h3', { class: 'card__title' }, '这篇没讲清楚的'),
                h('ul', {}, ...result.gaps.map((g) => h('li', {}, g))),
              )
            : null,
        );
      }

      // 常见网站
      const grouped = new Map();
      for (const site of allSites()) {
        const key = site.domain || 'custom';
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key).push(site);
      }

      main.append(
        h('div', { class: 'study__site-tools' },
          h('div', { class: 'card' },
            h('h3', { class: 'card__title' }, '让 AI 找这个领域的网站'),
            h('div', { class: 'study__row' }, topic, h('button', { class: 'btn btn--primary', onclick: discover }, '找')),
            discoverOut,
          ),
          h('div', { class: 'card' },
            h('h3', { class: 'card__title' }, '把一个网站的知识点整理出来'),
            h('div', { class: 'study__row' },
              analyzeInput,
              h('button', { class: 'btn btn--primary', onclick: () => analyzeUrl(analyzeInput.value.trim()) }, '分析'),
            ),
            h('div', { class: 'faint study__hint-small' },
              '用内置浏览器真实打开页面再抓正文，所以 JS 渲染的站点也能抓到。整理结果可以一键存成模板。'),
            analyzeOut,
          ),
        ),
        h('h3', { class: 'card__title study__sites-title' }, '常用学习网站'),
        ...[...grouped.entries()].map(([domain, sites]) => h('div', { class: 'study__site-group' },
          h('div', { class: 'study__group-label' }, DOMAIN_LABELS[domain] || domain),
          ...sites.map((site) => h('div', { class: 'study__site' },
            h('div', { class: 'study__site-main' },
              h('a', {
                class: 'study__site-name',
                href: '#',
                onclick: (e) => { e.preventDefault(); openInDocs(site.url); },
              }, site.name),
              h('div', { class: 'faint study__site-note' }, site.note || ''),
            ),
            h('div', { class: 'study__site-actions' },
              h('button', { class: 'btn btn--sm', onclick: () => analyzeUrl(site.url) }, '分析知识点'),
              site.domain === 'custom' ? h('button', {
                class: 'btn btn--sm btn--ghost',
                onclick: async () => {
                  await config.set('study.sites', (config.get('study.sites') || []).filter((x) => x.url !== site.url));
                  renderMain();
                },
              }, '删除') : null,
            ),
          )),
        )),
      );
    }

    function aiError(err) {
      return h('div', { class: 'study__error' },
        h('div', {}, err.message),
        err.code === 'need-login'
          ? h('button', { class: 'btn btn--sm', onclick: () => ctx.goto('ask') }, '去登录 DeepSeek')
          : null,
        err.code === 'not-configured'
          ? h('button', { class: 'btn btn--sm', onclick: () => ctx.goto('settings') }, '去配置 AI 接口')
          : null,
      );
    }

    function openInDocs(url) {
      window.dispatchEvent(new CustomEvent('toolbox:open-url', { detail: { url } }));
    }

    // ---------- 出题面板 ----------
    const quiz = createQuizPanel(ctx, () => {
      const tpl = currentTemplate();
      return tpl
        ? {
            name: `${currentModule().name} · ${tpl.title}`,
            code: tpl.code,
            lessonText: [tpl.why, ...(tpl.points || []), ...(tpl.pitfalls || [])].filter(Boolean).join('\n'),
          }
        : {
            name: currentModule().name,
            code: null,
            lessonText: currentModule().description || '',
          };
    });

    // ---------- 视图切换 ----------
    const viewBar = h('div', { class: 'study__views' });
    for (const v of VIEWS) {
      viewBar.append(h('button', {
        class: `btn btn--sm${v.id === view ? ' btn--primary' : ''}`,
        dataset: { view: v.id },
        onclick: () => { view = v.id; syncViewBar(); renderMain(); },
      }, v.label));
    }
    function syncViewBar() {
      for (const btn of viewBar.children) btn.classList.toggle('btn--primary', btn.dataset.view === view);
    }

    function renderMain() {
      if (view === 'practice') {
        main.textContent = '';
        main.append(practice.el);
        return;
      }
      if (view === 'quiz') {
        main.textContent = '';
        quiz.updateScope({ name: currentTemplate() ? `${currentModule().name} · ${currentTemplate().title}` : currentModule().name });
        main.append(quiz.el);
        return;
      }
      if (view === 'sites') return renderSitesView();
      return renderTemplateView();
    }

    root.append(
      h('div', { class: 'bar bar--drag' },
        h('strong', {}, '学习'),
        viewBar,
        h('span', { style: { flex: 1 } }),
        h('span', { class: 'faint study__ai-label' }, `AI：${ai.describe()}`),
      ),
      h('div', { class: 'study__body' },
        h('aside', { class: 'study__side' }, moduleList, templateList),
        main,
      ),
    );

    renderModules();
    renderTemplateList();
    renderMain();

    return {};
  },
};
