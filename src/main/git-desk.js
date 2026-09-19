'use strict';

/**
 * Git 组合拳。
 *
 * 平时最费事的不是单条 git 命令，是那一串顺序：同步主线要 fetch → rebase → push，
 * 开新分支要先 fetch 再从远端主线切出来，撤销提交还要想清楚 --soft 还是 --hard。
 * 这里把这些串好，点一下跑完，并且**把每条命令原样打出来** —— 照着能学会，
 * 出事也知道是哪一步。
 *
 * 安全上两条线：
 * 1. 只用 execFile 传数组参数，不过 shell，分支名里带分号也拼不出第二条命令；
 * 2. 子命令走白名单，push --force 只允许 --force-with-lease。
 */
const path = require('node:path');

/** 允许执行的 git 子命令。不在表里的一律拒绝。 */
const ALLOWED = new Set([
  'status', 'log', 'diff', 'show', 'branch', 'switch', 'checkout', 'add', 'commit',
  'fetch', 'pull', 'push', 'rebase', 'merge', 'reset', 'restore', 'clean', 'stash',
  'reflog', 'blame', 'remote', 'rev-parse', 'rev-list', 'cherry-pick', 'tag',
  'ls-files', 'describe', 'shortlog', 'config', 'symbolic-ref', 'count-objects', 'gc',
]);

/**
 * 组合拳清单。
 * steps 拿到 { main, branch, message, name, count } 这些参数，返回一串 git 参数数组。
 * danger 为真的，界面会先问一遍「这会丢东西，确定吗」。
 */
const COMBOS = [
  {
    id: 'sync', group: '每天都用', name: '同步主线', icon: '↧',
    desc: '把远端最新的拉下来，你的提交接在它后面，再推上去',
    explain: '相当于 fetch + rebase + push。比 pull 干净：历史是一条直线，不会多出一堆 merge 提交。',
    steps: (p) => [['fetch', '--prune'], ['rebase', `origin/${p.main}`], ['push']],
  },
  {
    id: 'save', group: '每天都用', name: '存一笔', icon: '✓',
    desc: '把所有改动记一笔提交（不推）',
    explain: '写代码写到一半想存档用这个。只在本地留记录，随时能回来。',
    needs: ['message'],
    steps: (p) => [['add', '-A'], ['commit', '-m', p.message]],
  },
  {
    id: 'ship', group: '每天都用', name: '提交并推送', icon: '↥',
    desc: '全部改动 → 一笔提交 → 推到远端（第一次会自动建上游分支）',
    explain: '最常用的一条。分支没有上游时自动 push -u。',
    needs: ['message'],
    steps: (p) => [['add', '-A'], ['commit', '-m', p.message], p.hasUpstream ? ['push'] : ['push', '-u', 'origin', 'HEAD']],
  },
  {
    id: 'newbranch', group: '分支', name: '从最新主线开新分支', icon: '⎇',
    desc: '先把远端拉新，再从主线切一条干净的分支出来',
    explain: '避免「从三天前的主线开出来」，省掉以后一堆冲突。',
    needs: ['name'],
    steps: (p) => [['fetch', '--prune'], ['switch', '-c', p.name, `origin/${p.main}`]],
  },
  {
    id: 'movework', group: '分支', name: '把当前改动挪到新分支', icon: '⇄',
    desc: '改到一半发现站错分支了，用这个把改动整包搬走',
    explain: 'stash → 切新分支 → stash pop，改动一点不丢。',
    needs: ['name'],
    steps: (p) => [['stash', 'push', '-u', '-m', 'move-to-branch'], ['switch', '-c', p.name], ['stash', 'pop']],
  },
  {
    id: 'cleanbranch', group: '分支', name: '清理已合并的分支', icon: '⌫',
    desc: '删掉那些已经并进主线的本地分支',
    explain: '只删已经合并的，没合并的 git 自己会拒绝，删不掉。',
    danger: true,
    steps: (p) => [['fetch', '--prune'], ['branch', '--merged', `origin/${p.main}`, '--format=%(refname:short)']],
    // 第二步要按上一步的输出决定删谁，交给 runCombo 特判
    expand: 'deleteMerged',
  },
  {
    id: 'undo', group: '后悔药', name: '撤销上一次提交（改动留着）', icon: '↺',
    desc: '提交写错了、少加了文件，用这个退回去重来',
    explain: 'reset --soft HEAD~1：提交没了，改动还在暂存区，改完重新提交即可。',
    steps: () => [['reset', '--soft', 'HEAD~1']],
  },
  {
    id: 'unstage', group: '后悔药', name: '取消暂存（改动留着）', icon: '↤',
    desc: 'add 多了，把暂存区清空但不碰文件',
    explain: 'reset：只把文件从暂存区拿下来。',
    steps: () => [['reset']],
  },
  {
    id: 'discard', group: '后悔药', name: '丢掉所有本地改动', icon: '✕',
    desc: '回到上一次提交的样子，没提交的全没了',
    explain: 'reset --hard + clean -fd。这一步真的会删文件，包括没被 git 跟踪的新文件。',
    danger: true,
    steps: () => [['reset', '--hard'], ['clean', '-fd']],
  },
  {
    id: 'squash', group: '后悔药', name: '把最近几笔压成一笔', icon: '⊞',
    desc: '一串 "fix typo" 合并成一条像样的提交',
    explain: 'reset --soft HEAD~N 之后重新提交。已经推出去的分支压完要 --force-with-lease 才推得上去。',
    needs: ['count', 'message'],
    danger: true,
    steps: (p) => [['reset', '--soft', `HEAD~${p.count}`], ['commit', '-m', p.message]],
  },
  {
    id: 'forcepush', group: '后悔药', name: '改完历史再推上去', icon: '↥',
    desc: '压过提交 / rebase 过之后用这个推',
    explain: '用 --force-with-lease：如果别人在你之后推过东西，它会拒绝，不会把人家的提交冲掉。',
    danger: true,
    steps: () => [['push', '--force-with-lease']],
  },
  {
    id: 'lost', group: '找东西', name: '找回弄丢的提交', icon: '🔦',
    desc: 'reset 过头、分支删错了，从这里找回来',
    explain: 'reflog 记着 HEAD 去过的每个地方。找到那行的哈希，用「切到某个提交」就能回去。',
    steps: () => [['reflog', '-n', '40', '--date=relative']],
  },
  {
    id: 'whochanged', group: '找东西', name: '这个文件谁改的', icon: '👤',
    desc: '看一个文件每一行最后是谁动的',
    explain: 'git blame。追责不是重点，找当事人问清楚才是。',
    needs: ['file'],
    steps: (p) => [['blame', '--date=short', '-w', '--', p.file]],
  },
  {
    id: 'hotfiles', group: '找东西', name: '最近改得最勤的文件', icon: '🔥',
    desc: '半年内改动次数排行，前几名往往就是最该重构的',
    steps: () => [['log', '--since=6.months', '--name-only', '--pretty=format:']],
    expand: 'countFiles',
  },
  {
    id: 'bigfiles', group: '找东西', name: '仓库里最占地方的文件', icon: '📦',
    desc: '找出把仓库撑大的那些大家伙',
    steps: () => [['count-objects', '-vH'], ['rev-list', '--objects', '--all', '--filter=blob:limit=1m']],
  },
  {
    id: 'conflicts', group: '解冲突', name: '看看冲突在哪', icon: '⚡',
    desc: '列出所有冲突文件和当前处在什么状态',
    explain: '冲突时先看这个，再决定要哪边。',
    steps: () => [['status', '--short'], ['diff', '--name-only', '--diff-filter=U']],
  },
  {
    id: 'abort', group: '解冲突', name: '放弃这次合并 / rebase', icon: '⎋',
    desc: '冲突解不动了，退回到开始之前',
    explain: '会自动判断当前是 rebase 还是 merge。',
    danger: true,
    steps: (p) => [p.rebasing ? ['rebase', '--abort'] : ['merge', '--abort']],
  },
];

function argsOk(args) {
  if (!Array.isArray(args) || !args.length) return false;
  if (!ALLOWED.has(args[0])) return false;
  // 强推只走 --force-with-lease：-f / --force 会把别人的提交直接冲掉
  if (args[0] === 'push' && args.some((a) => a === '-f' || a === '--force')) return false;
  return args.every((a) => typeof a === 'string');
}

class GitDesk {
  constructor({ execFile, store, dialog, getWindow }) {
    this.execFile = execFile;
    this.store = store;
    this.dialog = dialog;
    this.getWindow = getWindow;
  }

  combos() {
    return COMBOS.map(({ steps, expand, ...rest }) => rest);
  }

  recents() {
    const list = this.store?.get('git.recentRepos', []) || [];
    return Array.isArray(list) ? list.filter((p) => typeof p === 'string') : [];
  }

  remember(repo) {
    const list = [repo, ...this.recents().filter((p) => p !== repo)].slice(0, 12);
    this.store?.set('git.recentRepos', list);
    return list;
  }

  forget(repo) {
    const list = this.recents().filter((p) => p !== repo);
    this.store?.set('git.recentRepos', list);
    return list;
  }

  async pickRepo() {
    const result = await this.dialog.showOpenDialog(this.getWindow?.(), {
      title: '选一个 git 仓库',
      properties: ['openDirectory'],
    });
    if (result.canceled || !result.filePaths?.length) return null;
    const repo = result.filePaths[0];
    const check = await this.run(repo, ['rev-parse', '--show-toplevel']);
    if (!check.ok) return { error: `${repo} 不是 git 仓库（或者 git 不可用）。` };
    const top = check.stdout.trim() || repo;
    this.remember(top);
    return { repo: top };
  }

  /** 跑一条 git。不过 shell，参数原样传给 git。 */
  async run(repo, args, { timeout = 120000 } = {}) {
    if (!repo) return { ok: false, args, error: '还没选仓库。' };
    if (!argsOk(args)) return { ok: false, args, error: `不允许的 git 命令：${args?.[0] || '(空)'}` };
    const started = Date.now();
    try {
      const { stdout, stderr } = await this.execFile('git', args, {
        cwd: repo, timeout, maxBuffer: 16 * 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
      });
      return { ok: true, args, stdout: stdout || '', stderr: stderr || '', ms: Date.now() - started };
    } catch (error) {
      return {
        ok: false, args, ms: Date.now() - started,
        stdout: error.stdout || '', stderr: error.stderr || '',
        error: describeGitError(error),
      };
    }
  }

  /** 仓库现状：分支、领先/落后、改了哪些文件、最近几笔提交 */
  async status(repo) {
    const [porcelain, logOut, upstream, state] = await Promise.all([
      this.run(repo, ['status', '--porcelain=v2', '--branch']),
      this.run(repo, ['log', '-n', '12', '--date=relative', '--pretty=format:%h%an%ad%s']),
      this.run(repo, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']),
      this.run(repo, ['rev-parse', '--git-path', 'rebase-merge']),
    ]);
    if (!porcelain.ok) return { ok: false, error: porcelain.error };
    const info = { branch: '', ahead: 0, behind: 0, staged: [], changed: [], untracked: [], conflicts: [] };
    for (const line of porcelain.stdout.split('\n')) {
      if (line.startsWith('# branch.head ')) info.branch = line.slice(14).trim();
      else if (line.startsWith('# branch.ab ')) {
        const m = line.match(/\+(\d+)\s+-(\d+)/);
        if (m) { info.ahead = Number(m[1]); info.behind = Number(m[2]); }
      } else if (line.startsWith('1 ') || line.startsWith('2 ')) {
        const parts = line.split(' ');
        const xy = parts[1];
        const file = pathFromPorcelain(line, parts);
        if (xy[0] !== '.') info.staged.push(file);
        if (xy[1] !== '.') info.changed.push(file);
      } else if (line.startsWith('u ')) info.conflicts.push(line.split(' ').slice(10).join(' '));
      else if (line.startsWith('? ')) info.untracked.push(line.slice(2));
    }
    const commits = (logOut.stdout || '').split('\n').filter(Boolean).map((line) => {
      const [hash, author, date, subject] = line.split('');
      return { hash, author, date, subject };
    });
    let rebasing = false;
    if (state.ok) {
      const fs = require('node:fs');
      rebasing = fs.existsSync(path.resolve(repo, state.stdout.trim()));
    }
    return {
      ok: true, repo, ...info, commits,
      hasUpstream: upstream.ok, upstream: upstream.ok ? upstream.stdout.trim() : '',
      rebasing,
      main: await this.mainBranch(repo),
    };
  }

  /** 主线叫 main 还是 master：问远端的 HEAD，问不到就按本地分支猜 */
  async mainBranch(repo) {
    const head = await this.run(repo, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
    if (head.ok && head.stdout.trim()) return head.stdout.trim().replace(/^origin\//, '');
    const branches = await this.run(repo, ['branch', '-r', '--format=%(refname:short)']);
    const names = (branches.stdout || '').split('\n').map((s) => s.trim());
    for (const candidate of ['origin/main', 'origin/master', 'origin/develop']) {
      if (names.includes(candidate)) return candidate.replace('origin/', '');
    }
    return 'main';
  }

  /** 跑一套组合拳：逐条执行，谁失败就停在那儿，把每步的命令和输出都带回去 */
  async runCombo(repo, id, params = {}) {
    const combo = COMBOS.find((c) => c.id === id);
    if (!combo) return { ok: false, error: `没有这套组合：${id}` };
    for (const key of combo.needs || []) {
      if (!String(params[key] ?? '').trim()) return { ok: false, error: `还差一个参数：${key}` };
    }
    const state = await this.status(repo);
    const p = { main: state.main || 'main', hasUpstream: state.hasUpstream, rebasing: state.rebasing, ...params };
    const steps = [];
    for (const args of combo.steps(p)) {
      const result = await this.run(repo, args);
      steps.push(result);
      if (!result.ok) return { ok: false, combo: combo.id, steps, error: result.error };
    }
    // 有几套要看上一步的输出再决定下一步
    if (combo.expand === 'deleteMerged') {
      const current = state.branch;
      const merged = (steps.at(-1).stdout || '').split('\n').map((s) => s.trim())
        .filter((b) => b && b !== current && b !== p.main && !b.startsWith('('));
      if (!merged.length) steps.push({ ok: true, args: ['(没有可删的分支)'], stdout: '所有本地分支都还没并进主线，什么都没删。', ms: 0 });
      else {
        const del = await this.run(repo, ['branch', '-d', ...merged]);
        steps.push(del);
        if (!del.ok) return { ok: false, combo: combo.id, steps, error: del.error };
      }
    }
    if (combo.expand === 'countFiles') {
      const counts = new Map();
      for (const file of (steps.at(-1).stdout || '').split('\n')) {
        const name = file.trim();
        if (name) counts.set(name, (counts.get(name) || 0) + 1);
      }
      const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)
        .map(([file, n]) => `${String(n).padStart(4)} 次  ${file}`).join('\n');
      steps[steps.length - 1] = { ...steps.at(-1), stdout: top || '半年内没有改动记录。' };
    }
    return { ok: true, combo: combo.id, steps, status: await this.status(repo) };
  }
}

/**
 * 从 porcelain=v2 的一行里取文件名。
 *   普通改动： 1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <路径>   → 第 9 个字段起全是路径
 *   重命名：   2 <XY> ... <X分数> <新路径>TAB<原路径>          → 第 10 个字段起，取 TAB 前半段
 * 路径里可能有空格，所以只能「跳过前 N 个字段、剩下全算路径」，不能整行 split 取某一个。
 * 之前这里切错了，文件名前面粘着一截对象哈希。
 */
function pathFromPorcelain(line, parts) {
  const renamed = line.startsWith('2 ');
  const rest = parts.slice(renamed ? 9 : 8).join(' ');
  return renamed ? rest.split('\t')[0] : rest;
}

/** git 的报错前面总顶着一堆 usage，把有用那句挑出来 */
function describeGitError(error) {
  const text = `${error.stderr || ''}\n${error.stdout || ''}`.trim();
  if (/not a git repository/i.test(text)) return '这个目录不是 git 仓库。';
  if (/could not read Username|Authentication failed/i.test(text)) return '远端要登录：先在终端里配好凭据（ssh key 或 token），工具箱不会替你存密码。';
  if (/CONFLICT|Merge conflict/i.test(text)) return `有冲突要解：\n${text.split('\n').filter((l) => /CONFLICT/i.test(l)).join('\n')}`;
  if (/non-fast-forward|rejected/i.test(text)) return '远端有你本地没有的提交，先「同步主线」再推。';
  if (/nothing to commit/i.test(text)) return '没有任何改动可以提交。';
  if (/ENOENT/.test(error.message || '')) return '找不到 git 命令，先装 git。';
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
    .filter((l) => !/^usage:|^\s*\(use /i.test(l));
  return lines.slice(0, 6).join('\n') || error.message || 'git 执行失败';
}

module.exports = { GitDesk, COMBOS, ALLOWED, argsOk, describeGitError, pathFromPorcelain };
