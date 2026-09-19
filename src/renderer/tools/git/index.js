import { h, toast } from '../../core/ui.js';

/**
 * Git 组合拳。
 *
 * 费事的从来不是单条 git，是那一串顺序（同步主线 = fetch → rebase → push）。
 * 这里点一下跑完整串，并且把每条命令原样打出来 —— 照着能学会，出事也知道卡在哪一步。
 */
export default {
  id: 'git',
  title: 'Git',
  icon: 'branch',
  hint: '常用 git 组合一键跑完',

  create(root, ctx) {
    const { config } = ctx;
    let repo = config.get('git.lastRepo', '') || '';
    let combos = [];
    let status = null;
    let busy = false;

    // ---------- 顶部：仓库 ----------
    const repoLabel = h('strong', { class: 'git__repo' }, '还没选仓库');
    const branchTag = h('span', { class: 'tag' }, '');
    const aheadTag = h('span', { class: 'faint git__ahead' }, '');
    const recentSelect = h('select', { class: 'field field--sm git__recent', onchange: () => { if (recentSelect.value) use(recentSelect.value); } });
    const pickBtn = h('button', { class: 'btn btn--sm btn--primary', onclick: () => pick() }, '选仓库…');
    const refreshBtn = h('button', { class: 'btn btn--sm btn--ghost', onclick: () => refresh() }, '刷新');
    const revealBtn = h('button', { class: 'btn btn--sm btn--ghost', onclick: () => repo && window.toolbox.git.reveal(repo) }, '打开目录');

    // ---------- 现状 ----------
    const statusBox = h('div', { class: 'git__status' });
    const commitsBox = h('div', { class: 'git__commits' });

    // ---------- 组合拳 ----------
    const comboBox = h('div', { class: 'git__combos' });

    // ---------- 输出 ----------
    const output = h('pre', { class: 'git__output' }, '这里会显示每一条真正跑了的 git 命令和它的输出。');

    function log(text, kind = '') {
      output.textContent = text;
      output.className = `git__output${kind ? ` is-${kind}` : ''}`;
    }

    async function pick() {
      const result = await window.toolbox.git.pick();
      if (!result) return;
      if (result.error) return toast(result.error, 'bad', 5000);
      await use(result.repo);
    }

    async function use(dir) {
      const result = await window.toolbox.git.use(dir);
      if (!result.ok) return toast(result.error, 'bad', 5000);
      repo = result.repo;
      config.set('git.lastRepo', repo);
      await loadRecents();
      await refresh();
    }

    async function loadRecents() {
      const list = await window.toolbox.git.recents();
      recentSelect.replaceChildren(
        h('option', { value: '' }, list.length ? '最近打开…' : '还没有记录'),
        ...list.map((p) => h('option', { value: p }, shorten(p))),
      );
      recentSelect.value = '';
    }

    const shorten = (p) => (p.length > 46 ? `…${p.slice(-44)}` : p);

    async function refresh() {
      if (!repo) { repoLabel.textContent = '还没选仓库'; return; }
      repoLabel.textContent = shorten(repo);
      repoLabel.title = repo;
      const result = await window.toolbox.git.status(repo);
      if (!result.ok) { toast(result.error, 'bad', 5000); return; }
      status = result;
      branchTag.textContent = result.branch || '(游离 HEAD)';
      branchTag.className = `tag ${result.conflicts.length ? 'tag--bad' : 'tag--good'}`;
      const bits = [];
      if (result.ahead) bits.push(`领先远端 ${result.ahead} 笔`);
      if (result.behind) bits.push(`落后 ${result.behind} 笔`);
      if (!result.hasUpstream) bits.push('还没有上游分支');
      if (result.rebasing) bits.push('正在 rebase');
      aheadTag.textContent = bits.join(' · ');

      const group = (title, files, cls) => (files.length ? h('div', { class: `git__group ${cls}` },
        h('div', { class: 'git__group-title' }, `${title} ${files.length}`),
        h('div', { class: 'git__files' }, ...files.slice(0, 40).map((f) => h('code', {}, f))),
      ) : null);
      statusBox.replaceChildren(...[
        group('冲突', result.conflicts, 'is-conflict'),
        group('已暂存', result.staged, 'is-staged'),
        group('改动未暂存', result.changed, 'is-changed'),
        group('新文件', result.untracked, 'is-new'),
      ].filter(Boolean));
      if (!statusBox.children.length) statusBox.append(h('div', { class: 'faint git__clean' }, '工作区是干净的。'));

      commitsBox.replaceChildren(...(result.commits || []).map((c) => h('div', { class: 'git__commit' },
        h('code', { class: 'git__hash' }, c.hash),
        h('span', { class: 'git__subject', title: c.subject }, c.subject),
        h('span', { class: 'faint git__when' }, `${c.author} · ${c.date}`),
      )));
      renderCombos();
    }

    function renderCombos() {
      const groups = new Map();
      for (const combo of combos) {
        if (!groups.has(combo.group)) groups.set(combo.group, []);
        groups.get(combo.group).push(combo);
      }
      comboBox.replaceChildren(...[...groups.entries()].map(([name, list]) => h('div', { class: 'git__group-block' },
        h('div', { class: 'git__combo-group' }, name),
        h('div', { class: 'git__combo-grid' }, ...list.map((combo) => h('button', {
          class: `git__combo${combo.danger ? ' is-danger' : ''}`,
          disabled: !repo,
          title: combo.explain || combo.desc,
          onclick: () => runCombo(combo),
        },
          h('span', { class: 'git__combo-icon' }, combo.icon || '·'),
          h('span', { class: 'git__combo-text' },
            h('strong', {}, combo.name),
            h('span', { class: 'faint' }, combo.desc)),
        ))),
      )));
    }

    const ASK = {
      message: ['提交说明', '写一句话说清楚这次改了什么'],
      name: ['分支名', '比如 fix/login-timeout'],
      count: ['压几笔', '最近几笔提交合成一笔，比如 3'],
      file: ['文件路径', '相对仓库根目录，比如 src/main.js'],
    };

    async function runCombo(combo) {
      if (busy || !repo) return;
      const params = {};
      for (const key of combo.needs || []) {
        const [label, hint] = ASK[key] || [key, ''];
        const value = window.prompt(`${label}\n${hint}`, key === 'count' ? '2' : '');
        if (value == null) return;
        if (!value.trim()) return toast(`${label}不能空着`, 'info');
        params[key] = value.trim();
      }
      if (combo.danger) {
        const ok = window.confirm(`「${combo.name}」\n\n${combo.explain || combo.desc}\n\n这一步可能丢掉东西，确定要跑吗？`);
        if (!ok) return;
      }
      busy = true;
      log(`正在跑「${combo.name}」…`);
      const result = await window.toolbox.git.runCombo(repo, combo.id, params);
      busy = false;
      const lines = [];
      for (const step of result.steps || []) {
        lines.push(`$ git ${(step.args || []).join(' ')}`);
        const body = [step.stdout, step.stderr].filter(Boolean).join('\n').trimEnd();
        if (body) lines.push(body);
        if (!step.ok) lines.push(`✗ ${step.error}`);
        lines.push('');
      }
      if (result.error && !result.steps?.length) lines.push(`✗ ${result.error}`);
      lines.push(result.ok ? `✓ 「${combo.name}」跑完了` : `✗ 停在上面那一步：${result.error}`);
      log(lines.join('\n').trim(), result.ok ? 'good' : 'bad');
      toast(result.ok ? `${combo.name} 完成` : `${combo.name} 没跑完`, result.ok ? 'good' : 'bad', result.ok ? 2000 : 6000);
      await refresh();
    }

    // 自己敲一条
    const freeInput = h('input', {
      class: 'field field--sm git__free', placeholder: '自己敲一条：status --short  （前面的 git 不用写，回车执行）',
      onkeydown: async (e) => {
        if (e.key !== 'Enter' || e.isComposing) return;
        const args = freeInput.value.trim().replace(/^git\s+/, '').split(/\s+/).filter(Boolean);
        if (!args.length || !repo) return;
        const result = await window.toolbox.git.run(repo, args);
        log(`$ git ${args.join(' ')}\n${[result.stdout, result.stderr].filter(Boolean).join('\n').trim() || (result.ok ? '(没有输出)' : '')}${result.ok ? '' : `\n✗ ${result.error}`}`, result.ok ? '' : 'bad');
        if (result.ok) refresh();
      },
    });

    (async () => {
      combos = await window.toolbox.git.combos();
      await loadRecents();
      renderCombos();
      if (repo) await refresh();
    })();

    root.append(
      h('div', { class: 'bar bar--drag' },
        h('strong', {}, 'Git'),
        repoLabel, branchTag, aheadTag,
        h('span', { style: { flex: 1 } }),
        recentSelect, pickBtn, refreshBtn, revealBtn,
      ),
      h('div', { class: 'git' },
        h('aside', { class: 'git__side' },
          h('div', { class: 'git__side-title' }, '现在的状态'),
          statusBox,
          h('div', { class: 'git__side-title' }, '最近的提交'),
          commitsBox,
        ),
        h('section', { class: 'git__main' },
          comboBox,
          freeInput,
          output,
        ),
      ),
    );
    // 切回来时重新读一次仓库状态：在别处提交过、切过分支，这里不能还显示旧的
    return { activate: () => { if (repo) refresh(); } };
  },
};
