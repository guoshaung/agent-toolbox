const code = (...lines) => lines.join('\n');

/**
 * 实践敲码的补充轨道。
 *
 * 挑的标准：跑得起来、看得到输出、并且是科研和写代码时真的天天用的东西。
 * 纯语法演示不收；每条都能直接按运行看到结果。
 */
export const EXTRA_TRACKS = [
  {
    id: 'regex', name: '正则表达式', icon: '⌗', level: '入门 → 实战', runtime: 'python3',
    description: '匹配、分组、替换、贪婪与非贪婪；处理日志和论文文本时天天要用。',
    samples: [
      { title: '提取所有数字', level: '入门', code: code(
        'import re', '',
        'text = "实验跑了 3 轮，准确率 0.87，耗时 125 秒"',
        'print(re.findall(r"\\d+\\.?\\d*", text))') },
      { title: '命名分组', level: '基础', code: code(
        'import re', '',
        'log = "2026-09-04 18:22:01 ERROR disk full"',
        'm = re.match(r"(?P<date>\\S+) (?P<time>\\S+) (?P<level>\\w+) (?P<msg>.+)", log)',
        'print(m.group("level"), "|", m.group("msg"))',
        'print(m.groupdict())') },
      { title: '贪婪 vs 非贪婪', level: '基础', code: code(
        'import re', '',
        'html = "<b>粗体</b> 和 <i>斜体</i>"',
        'print("贪婪  :", re.findall(r"<.+>", html))',
        'print("非贪婪:", re.findall(r"<.+?>", html))') },
      { title: '抠 DOI 和 arXiv 号', level: '进阶', code: code(
        'import re', '',
        'page = "Cite as arXiv:2410.06153v3  doi:10.48550/arXiv.2410.06153."',
        'doi = re.search(r"10\\.\\d{4,9}/[-._;()/:A-Za-z0-9]+", page).group(0)',
        'print("DOI  :", doi.rstrip("."))',
        'print("arXiv:", re.search(r"arXiv:\\s*(\\d{4}\\.\\d{4,5})", page).group(1))') },
      { title: '替换时带函数', level: '进阶', code: code(
        'import re', '',
        'text = "loss=0.83 acc=0.91"',
        'print(re.sub(r"\\d\\.\\d+", lambda m: f"{float(m.group()) * 100:.0f}%", text))') },
    ],
  },
  {
    id: 'numpy', name: 'NumPy', icon: '⊞', level: '数组 → 广播', runtime: 'python3 + numpy',
    framework: true, packageKey: 'numpy', packageLabel: 'NumPy',
    description: '数组、切片、广播、轴和随机数；做实验统计和写模型前的基本功。',
    samples: [
      { title: '创建与切片', level: '入门', code: code(
        'import numpy as np', '',
        'a = np.arange(12).reshape(3, 4)',
        'print(a)',
        'print("第2行:", a[1])',
        'print("最后一列:", a[:, -1])') },
      { title: '轴与统计', level: '基础', code: code(
        'import numpy as np', '',
        'scores = np.array([[0.81, 0.74], [0.89, 0.77], [0.85, 0.80]])',
        'print("每列均值(按行压):", scores.mean(axis=0))',
        'print("每行最大:", scores.max(axis=1))',
        'print("整体标准差:", round(float(scores.std()), 4))') },
      { title: '广播机制', level: '基础', code: code(
        'import numpy as np', '',
        'features = np.arange(6).reshape(2, 3).astype(float)',
        'mean = features.mean(axis=0)',
        'std = features.std(axis=0) + 1e-9',
        'print("标准化后:\\n", (features - mean) / std)') },
      { title: '布尔索引筛选', level: '进阶', code: code(
        'import numpy as np', '',
        'rng = np.random.default_rng(0)',
        'acc = rng.random(10)',
        'print("全部:", np.round(acc, 3))',
        'print("超过0.5:", np.round(acc[acc > 0.5], 3))',
        'print("超过0.5的下标:", np.flatnonzero(acc > 0.5))') },
      { title: '矩阵乘法与范数', level: '进阶', code: code(
        'import numpy as np', '',
        'q = np.array([[1.0, 0.0], [0.0, 1.0]])',
        'k = np.array([[1.0, 1.0], [0.0, 1.0]])',
        'scores = q @ k.T / np.sqrt(q.shape[-1])',
        'weights = np.exp(scores) / np.exp(scores).sum(axis=-1, keepdims=True)',
        'print("注意力权重:\\n", np.round(weights, 3))') },
    ],
  },
  {
    id: 'asyncio', name: 'asyncio 异步', icon: '⇉', level: '协程 → 并发', runtime: 'python3',
    description: 'async/await、gather、超时和信号量；批量抓论文、批量调 API 时就靠它。',
    samples: [
      { title: '第一个协程', level: '入门', code: code(
        'import asyncio', '',
        'async def work(name, seconds):',
        '    await asyncio.sleep(seconds)',
        '    return f"{name} 完成"', '',
        'print(asyncio.run(work("任务A", 0.1)))') },
      { title: 'gather 并发', level: '基础', code: code(
        'import asyncio, time', '',
        'async def work(n):',
        '    await asyncio.sleep(0.2)',
        '    return n * n', '',
        'async def main():',
        '    start = time.perf_counter()',
        '    results = await asyncio.gather(*(work(i) for i in range(5)))',
        '    print("结果:", results)',
        '    print(f"耗时 {time.perf_counter() - start:.2f}s（串行要 1.0s）")', '',
        'asyncio.run(main())') },
      { title: '超时控制', level: '基础', code: code(
        'import asyncio', '',
        'async def slow():',
        '    await asyncio.sleep(5)',
        '    return "永远等不到"', '',
        'async def main():',
        '    try:',
        '        print(await asyncio.wait_for(slow(), timeout=0.3))',
        '    except asyncio.TimeoutError:',
        '        print("超时了，及时放弃")', '',
        'asyncio.run(main())') },
      { title: '信号量限流', level: '进阶', code: code(
        'import asyncio', '',
        'async def fetch(i, gate):',
        '    async with gate:',
        '        await asyncio.sleep(0.1)',
        '        return i', '',
        'async def main():',
        '    gate = asyncio.Semaphore(3)   # 同时最多 3 个，别把对方接口打挂',
        '    print(await asyncio.gather(*(fetch(i, gate) for i in range(9))))', '',
        'asyncio.run(main())') },
    ],
  },
  {
    id: 'datafile', name: '文件与 JSON/CSV', icon: '🗂', level: '读写 → 清洗', runtime: 'python3',
    description: 'pathlib、JSON、CSV 和编码问题；整理实验记录和数据集时最常用的一组。',
    samples: [
      { title: 'pathlib 读写', level: '入门', code: code(
        'from pathlib import Path', '',
        'p = Path("notes.txt")',
        'p.write_text("第一行\\n第二行\\n", encoding="utf-8")',
        'print(p.read_text(encoding="utf-8").splitlines())',
        'print("大小:", p.stat().st_size, "字节")') },
      { title: 'JSON 存取', level: '基础', code: code(
        'import json', 'from pathlib import Path', '',
        'record = {"model": "ours", "acc": 0.873, "tags": ["rsi", "agent"]}',
        'Path("run.json").write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")',
        'back = json.loads(Path("run.json").read_text(encoding="utf-8"))',
        'print(back["tags"], back["acc"])') },
      { title: 'CSV 逐行处理', level: '基础', code: code(
        'import csv', 'from pathlib import Path', '',
        'rows = [{"run": 1, "loss": 0.8}, {"run": 2, "loss": 0.6}]',
        'with open("log.csv", "w", newline="", encoding="utf-8") as f:',
        '    writer = csv.DictWriter(f, fieldnames=["run", "loss"])',
        '    writer.writeheader()',
        '    writer.writerows(rows)',
        'with open("log.csv", encoding="utf-8") as f:',
        '    for row in csv.DictReader(f):',
        '        print(row["run"], "->", row["loss"])') },
      { title: '批量重命名', level: '进阶', code: code(
        'from pathlib import Path', '',
        'for i in range(3):',
        '    Path(f"paper ({i}).pdf").write_text("x", encoding="utf-8")',
        'for f in sorted(Path(".").glob("paper (*).pdf")):',
        '    clean = f.name.replace(" (", "_").replace(")", "")',
        '    f.rename(clean)',
        '    print(f.name, "->", clean)') },
    ],
  },
  {
    id: 'pytest', name: 'pytest 测试', icon: '✓', level: '断言 → 参数化', runtime: 'python3 + pytest',
    framework: true, packageKey: 'pytest', packageLabel: 'pytest',
    description: '写测试、参数化、异常断言；改代码不怕改坏靠的就是这个。',
    samples: [
      { title: '第一个测试', level: '入门', code: code(
        'import subprocess, sys', 'from pathlib import Path', '',
        'Path("test_demo.py").write_text(',
        '    "def add(a, b):\\n"',
        '    "    return a + b\\n\\n"',
        '    "def test_add():\\n"',
        '    "    assert add(2, 3) == 5\\n", encoding="utf-8")',
        'print(subprocess.run([sys.executable, "-m", "pytest", "-q", "test_demo.py"],',
        '                     capture_output=True, text=True).stdout)') },
      { title: '参数化用例', level: '基础', code: code(
        'import subprocess, sys', 'from pathlib import Path', '',
        'Path("test_param.py").write_text(',
        '    "import pytest\\n\\n"',
        '    "@pytest.mark.parametrize(\\"value,expected\\", [(2, 4), (3, 9), (4, 16)])\\n"',
        '    "def test_square(value, expected):\\n"',
        '    "    assert value ** 2 == expected\\n", encoding="utf-8")',
        'print(subprocess.run([sys.executable, "-m", "pytest", "-q", "test_param.py"],',
        '                     capture_output=True, text=True).stdout)') },
      { title: '断言会抛异常', level: '进阶', code: code(
        'import subprocess, sys', 'from pathlib import Path', '',
        'Path("test_raise.py").write_text(',
        '    "import pytest\\n\\n"',
        '    "def divide(a, b):\\n"',
        '    "    if b == 0:\\n"',
        '    "        raise ZeroDivisionError(\\"除数不能为零\\")\\n"',
        '    "    return a / b\\n\\n"',
        '    "def test_divide_zero():\\n"',
        '    "    with pytest.raises(ZeroDivisionError):\\n"',
        '    "        divide(1, 0)\\n", encoding="utf-8")',
        'print(subprocess.run([sys.executable, "-m", "pytest", "-q", "test_raise.py"],',
        '                     capture_output=True, text=True).stdout)') },
    ],
  },
  {
    id: 'git', name: 'Git 常用命令', icon: '⑂', level: '日常 → 救急', runtime: 'bash + git',
    description: '在临时目录里建一个真仓库来练：提交、分支、合并、回退、看历史。不碰你的项目。',
    samples: [
      { title: '建仓库并提交', level: '入门', code: code(
        'git init -q demo && cd demo',
        'git config user.email "you@local" && git config user.name "you"',
        'echo "first line" > a.txt',
        'git add a.txt && git commit -qm "第一次提交"',
        'git log --oneline') },
      { title: '分支与合并', level: '基础', code: code(
        'git init -q demo2 && cd demo2',
        'git config user.email "you@local" && git config user.name "you"',
        'echo base > a.txt && git add . && git commit -qm base',
        'git checkout -qb feature',
        'echo feature >> a.txt && git commit -qam "改了点东西"',
        'git checkout -q master 2>/dev/null || git checkout -q main',
        'git merge -q feature -m merge',
        'cat a.txt && git log --oneline --graph') },
      { title: '看改了什么', level: '基础', code: code(
        'git init -q demo3 && cd demo3',
        'git config user.email "you@local" && git config user.name "you"',
        'printf "line1\\nline2\\n" > a.txt && git add . && git commit -qm init',
        'printf "line1\\nline2 改过\\nline3\\n" > a.txt',
        'git diff') },
      { title: '撤销：三种后悔药', level: '进阶', code: code(
        'git init -q demo4 && cd demo4',
        'git config user.email "you@local" && git config user.name "you"',
        'echo v1 > a.txt && git add . && git commit -qm v1',
        'echo v2 > a.txt && git add . && git commit -qm v2',
        'echo "--- 只回退提交、保留改动 ---"',
        'git reset --soft HEAD~1 && git status --short',
        'echo "--- 连暂存也撤掉 ---"',
        'git reset HEAD~0 -q && git status --short',
        'echo "--- 彻底丢弃工作区改动 ---"',
        'git checkout -- . && cat a.txt') },
    ],
  },
  {
    id: 'textproc', name: 'Shell 文本处理', icon: '≡', level: 'awk / sed / 管道', runtime: 'bash',
    description: 'awk、sed、sort、cut 组合拳；处理实验日志比写脚本快得多。',
    samples: [
      { title: 'awk 按列取值', level: '入门', code: code(
        'printf "ada 90\\nlinus 82\\ngrace 97\\n" > s.txt',
        "awk '{print $1 \": \" $2}' s.txt") },
      { title: 'awk 求和求平均', level: '基础', code: code(
        'printf "ada 90\\nlinus 82\\ngrace 97\\n" > s.txt',
        "awk '{sum += $2} END {printf \"总分 %d，平均 %.1f\\n\", sum, sum/NR}' s.txt") },
      { title: 'sed 批量替换', level: '基础', code: code(
        'printf "loss=0.83\\nloss=0.71\\n" > log.txt',
        "sed 's/loss/LOSS/g' log.txt") },
      { title: '统计日志里的错误类型', level: '进阶', code: code(
        'printf "ERROR disk\\nINFO ok\\nERROR net\\nERROR disk\\nWARN slow\\n" > app.log',
        "grep ERROR app.log | awk '{print $2}' | sort | uniq -c | sort -nr") },
    ],
  },
];
