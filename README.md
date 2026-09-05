# Agent 工具箱

把「查文档、打字、进入状态、问 AI、背模板」这几件每天都要干、但每次都得切窗口的事，收进同一个壳里。

[![Latest Release](https://img.shields.io/github/v/release/guoshaung/agent-toolbox?display_name=tag&sort=semver&logo=github)](https://github.com/guoshaung/agent-toolbox/releases)
[![GitHub Stars](https://img.shields.io/github/stars/guoshaung/agent-toolbox?style=flat&logo=github)](https://github.com/guoshaung/agent-toolbox)
[![Electron](https://img.shields.io/badge/Electron-33.2.0-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![JavaScript](https://img.shields.io/badge/JavaScript-Vanilla-F7DF1E?logo=javascript&logoColor=111827)](https://developer.mozilla.org/docs/Web/JavaScript)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-111827)](#技术栈)

基于 Electron + Chromium WebView，使用原生 JavaScript/CSS 开发，发布使用 electron-builder。

## 跑起来

```bash
npm install
npm start
```

生成 macOS 安装包（Apple Silicon）：

```bash
npm run dist
```

完成后安装文件会作为 GitHub Release 资产发布（本地构建中间产物在 `dist/`）。把这个 `.dmg` 发给对方即可；对方拖到 Applications 后首次打开可能需要在右键菜单中选择“打开”。每个人的登录态、配置、文献和 API Key 都保存在各自电脑上，不会随安装包带走。

生成 Windows 便携版：

```bash
npm run dist:win
```

产物名会包含当前版本号，Windows 用户双击即可运行，不需要安装。Windows 版本不包含 macOS 专用的跨应用窗口吸附能力，其它工具照常可用。

第一次用请先点左上角「⚡ 快问」，在里面登录一次 DeepSeek。登录态会长期保留，
「打字纠错」和「帮我决定」都复用这个登录态，**不消耗 API 额度，不花钱**。

改完 `src/renderer/` 里的代码不用重启，在「设置」里点「重载界面」即可。
改了 `src/main/` 才需要重启。

## 工具

| | 干什么 | 快捷键 |
|---|---|---|
| ⚡ 快问 | 内嵌 DeepSeek 网页版，常驻热会话，背景可换成自己的图 | Cmd+1 |
| 📖 文档 | 内置 Chromium 的官方文档浏览器，多标签 + 书签 + 站内搜索 | Cmd+2 |
| ✍️ 纠错 | 读懂打错的中文；拿不准你的意思时会反问，而不是瞎猜 | Cmd+3 |
| 🎯 专注 | 回归思考：专注驾驶舱（今日意图/本轮任务/25-5、50-10、90-20/7 日节奏/最近记录）+ 番茄钟/白噪音/呼吸引导 + 醒脑小游戏 + 火柴人自动战斗 + AI 情报 + X 动态 | Cmd+4 |
| 📚 学习 | 必背代码模板（可遮住默写、逐行对比）+ AI 出题 + 知识网站库 | Cmd+5 |
| ◉ 桌宠 | 选中代码的四行快速解释；默认关闭，不自动追踪项目 | Cmd+6 |
| 🗂 记录 | 导出 Codex / Claude / OpenCode / OMP / DSH / Qwen / Gemini 本地聊天记录，打包成迁移包给另一个 AI 继续聊 | Cmd+7 |
| 📺 视频 | 固定 B 站学习区（保留登录态、关闭评论加载、可自由浏览）+ B 站视频总结报告（本地留底并可发飞书） | Cmd+8 |
| 🔬 科研 | 科研/AI 网站格子铺 + 文献管理：按研究方向发现论文，优先获取开放全文；受限论文可在持久登录浏览器中由用户正常下载并自动入库 | Cmd+9 |
| 🧑‍🏫 陪读 | 选中代码出知识缺口卡片（作用/知识点★/为什么/下一步），移植自 AI Code Reading Coach 插件 | Cmd+0 |
| ⌁ 术语 | 工具内输入术语，或在任意应用选中文字后按 `⌘⇧E`，用 DeepSeek 生成带证据链、歧义和核验关键词的悬浮解释卡 | — |
| ▣ 手机 | 持久化手机控制台：切换工具、调用当前 AI、读写剪贴板、打开其他 AI 网站；配对令牌加密保存，默认关闭 | — |
| 🧲 吸附 | 点亮左栏顶部回形针，把 Edge 标签页/窗口拖到工具箱边缘后自动排成左右分栏；中间分隔条可拖动，解除后恢复原位 | `⌥⇧D` 备用 |
| ⚙︎ 设置 | AI 接口配置、桥接自检、清理数据 | — |

### 学习工具里有什么

- **必背模板**：7 个模块共 64 个模板，全部带「为什么要背」「关键点」「容易翻车的地方」。
  - 算法 12 个：二分三种边界、滑动窗口、快排归并、树遍历、回溯、背包 DP、并查集、单调栈、Dijkstra/拓扑、前缀和差分、链表、LRU
  - 设计模式 10 个：单例、工厂、策略、观察者、装饰器、适配器、建造者、模板方法、责任链、代理（并说明 Python 里哪些模式其实不需要）
  - Transformer 7 个：SDPA、MHA/GQA、位置编码与 RoPE、LayerNorm/RMSNorm/SwiGLU、Pre-LN Block、KV Cache、训练循环
  - 搜广推 7 个：AUC/GAUC、FM/DeepFM、双塔+in-batch 负采样、DIN、ItemCF、排序指标、特征工程
  - 大模型安全 5 个：提示词注入、越权工具调用、数据泄露、模型幻觉、输出安全
  - 中间件 6 个：消息队列、缓存、RPC、服务发现、限流、链路追踪
  - 数学符号 17 个：集合逻辑、概率统计、矩阵张量、QKV、Token 索引、积分优化、损失函数和实验指标
- **三种模式**：看代码 → 遮住（只看要点回忆）→ 默写（写完逐行对比，忽略注释和空行，告诉你漏了哪行、多了哪行）
- **背熟标记**：每个模板可标记，侧栏显示 `已背熟 x/y`
- **自己加模板**：任何模块下都能加，也能把 AI 从网页里提取的代码片段一键存成模板
- **AI 出题**：专用 Qwen3.5-Flash 先讲一个范围内知识点，再考察基础、边界和迁移；选择题当场判对错并记录掌握度，代码题可让 Qwen 批改，一次 1 道或 5 道
- **实践敲码**：Notebook 单元格支持 `＋` 新增、`−` 删除、独立运行和保留输出；覆盖 Python、Linux 命令、MySQL 常用 SQL、Requests、MATLAB/Octave、uv、LangChain、PyTorch、Transformers、FastAPI、Matplotlib 和 Pandas。Python/框架轨道可用 uv 创建独立 `.venv` 并安装依赖，SQL 使用临时 SQLite 数据库覆盖常用 MySQL 语法
- **实践里的代码提示**：光标放到当前行会显示语法和作用；`import`、`from ... import ...`、Linux 命令和 SQL 子句优先用本地规则即时解释，不消耗 Token。复杂行可点「AI 解释当前行」，相关 Python/Linux/MySQL 文档可直接联动到「文档」工具
- **自定义 MCP**：Skill 工厂里可登记本地 stdio 或远程 HTTP/SSE 服务，生成标准配置并写入 Claude Desktop、Claude Code、OpenCode 或 Codex；已有配置会先备份为 `.bak`
- **知识网站**：预置 28 个官方文档/经典教程；「AI 找站」按领域推荐；「分析知识点」用内置浏览器真实打开任意网址，抓正文交给 AI 整理成可复习的知识点

### AI 接口是可替换的

「设置 → AI 接口」里可以切换：

- **DeepSeek 网页版**（默认）：复用你已登录的网页会话，不花钱，慢几秒
- **自定义 API**：填 Base URL + API Key + 模型名即可。任何 OpenAI 兼容的接口都行——DeepSeek 官方 API、豆包、Kimi、本地 Ollama/vLLM。

切换后纠错、出题、抓站全部自动走新接口，工具代码不用改。API 请求走主进程发出，Key 由 Electron `safeStorage` 加密保存，不进入页面上下文且不会在 UI 回显。兼容端点可查询模型列表，查询失败时仍可手工填写模型名。

### 手机控制

左侧「手机」默认关闭。点击「启动手机控制」后，让手机和电脑连接同一个 Wi-Fi，打开界面显示的配对地址。手机端调用 AI 时仍复用电脑端当前选择的 DeepSeek 网页版或第三方兼容 API，因此切换 AI 供应商不会破坏远程功能。配对令牌会加密保存，应用重启后可以继续使用；「重新配对」会让旧地址立即失效。勾选「开机自动启动」后，工具箱启动时会自动打开远程服务。

换 Wi-Fi 时，固定端口不变，但手机需要使用新的局域网地址；优先尝试显示的 `设备名.local` 地址。若两端都安装并登录 Tailscale 等 VPN，使用 VPN 地址即可跨 Wi-Fi 控制。真正跨网络且不依赖 VPN，需要额外部署云中继服务，本地工具本身不能凭空穿透路由器。

远程控制目前只开放工具箱动作、AI 请求、剪贴板和 http(s) 网页跳转，不开放任意 shell、任意键鼠模拟、删除文件或自动处理验证码/付款/系统权限。停止服务后局域网端口立即关闭。

学习出题模型在「设置 → 学习出题模型」单独配置，默认使用 `qwen3.5-flash` 的 DashScope 兼容接口，不影响其它工具。它会根据当前模板的关键点、易错点和历史答题情况，控制“已会 / 迁移 / 新知识”的比例。

### 桌宠快速解释

左侧「桌宠」默认关闭。启用后会出现可拖动、贴边、可置顶的原创蓝白学习助手；点击它打开极简知识卡。复制看不懂的那一小段代码，可补充语言名和一行卡点，输出严格只有四行。它不会扫描项目或自动追踪调用链，只有点击「向上一层追溯」才扩展一层。详细说明见 [docs/DESKTOP-PET.md](docs/DESKTOP-PET.md)。

### 文献按方向发现

在「科研 → 文献」左栏填写研究方向，可按年份筛选，也可只看开放全文。结果来自 OpenAlex 和 Europe PMC，候选会合并去重并显示作者、年份、期刊、摘要、被引量和开放状态。开放 PDF 可勾选后批量自动下载入库，系统会逐篇重试并跳过失败项；单篇也可直接下载。顶部「查找下载」支持粘贴任意 HTTP(S) PDF 直链，工具会先校验 PDF 文件头并直接入库，再对普通文献名走学术索引检索；CDN 链接没有文件名时会按域名生成安全文件名。没有开放 PDF 时点「登录下载」，在工具箱的持久浏览器中使用学校或出版社账号正常下载，下载完成后自动进入文献库。工具不接入绕过付费墙或未经授权的下载站。

对于知网或学校图书馆：点「打开登录页」进入已登录的检索结果页，再点「扫描当前列表」，勾选论文后使用「下载已选」。工具会在当前站点内逐篇打开论文并点击下载入口，最多处理 30 篇；单篇失败会记录原因并继续后面的论文，下载完成自动归档到文献库。遇到验证码、人工验证、权限确认或站点结构变化会提示，不会尝试绕过。

科研「门户」里的站点卡片可以直接拖出。释放后会生成置顶悬浮球；双击悬浮球默认展开手机端网页，展开后可切换到 PC 端、收回悬浮球、关闭悬浮球或用系统浏览器打开。网页仍使用科研门户的持久登录分区。

其它快捷键：双击左上角 Logo 重启应用，`⌘⇧E` 解释当前选词，`⌥⇧D` 直接吸附当前前台窗口（回形针拖入方式的备用入口），`Cmd+F` 页内查找，`Cmd+L` 定位地址栏，`Cmd+Enter` 触发纠错，`Cmd+W` 关标签页。

## 技术栈

- **桌面壳**：Electron、Chromium WebView、Node.js 主进程与 IPC 白名单
- **界面**：原生 JavaScript、CSS、SVG；不依赖 React/Vue 等前端框架
- **科研与文档**：KaTeX 公式排版、PDF.js 文献预览、OpenAlex / Europe PMC 检索
- **学习运行时**：Python、Bash、SQLite；uv 管理按领域隔离的 Python `.venv` 和依赖
- **外部能力**：DeepSeek 网页桥接、OpenAI-compatible API、DashScope、飞书 CLI
- **发布与历史版本**：electron-builder 构建 DMG / Windows portable，GitHub Releases 按版本追加，不覆盖历史资产

## 合伙人

当前合伙人：**自己**。这是一个独立设计、开发和维护的个人工具箱项目。

「术语」顶部的「解释领域」会同时约束内置查询和全局划词。选择 AI / 大模型、编程 / 软件工程、计算机系统、数据库、网络安全、科研等领域后，模型只能在该领域内解释；无法归类时会提示切换领域，不会自动扩展到其他领域。也可以选择「自定义领域」。

科研栏目还包含“学术入口”和“学校访问”。学校访问只打开各校官方图书馆入口；需要校内权限时，请先使用学校提供的 VPN / EasyConnect。工具箱不保存账号密码，也不绕过学校授权。EasyConnect 的网络范围由官方客户端和学校分流策略决定，普通客户端默认是系统级 VPN，并不能由工具箱强制限制为“仅本应用”。

从“学校访问”内嵌页面下载的文件会自动保存到工具箱文献库 `userData/literature/`，与“文献”页面导入的文件共用同一个库。

科研“想法”支持直接粘贴截图和 LaTeX：在补充细节框中按 `⌘V` 粘贴图片，保存后会压缩并跟随想法保存；公式可使用 `$...$`、`$$...$$`、`\(...\)`、`\[...\]`，也支持直接粘贴以 `\text`、`\frac`、`\underbrace` 等命令开头的完整公式。

含有多个等号或加号的裸 LaTeX 公式会自动整理为逐行对齐布局；等号、加号和 `\underbrace` 说明各自占固定位置，长公式只在公式区域内横向滚动。

科研“想法”右侧有独立的 DeepSeek 思考伙伴，不暴露网页界面。它会带着预置的科研讨论提示词区分事实、推断和待验证假设；AI 回复可以框选后“引用到输入框”继续追问，或“收藏片段”保存到本地引用库。

科研“PPT图板”是单页科研绘图工作台，不是多页演示文稿：支持素材网站默认收缩、半屏浏览、图片粘贴、矩形/椭圆/菱形、实线/虚线/单向箭头/双向箭头、文字、填充/边框/对象透明度、自由宽高拉伸、旋转手柄、多选、组合/取消组合、对齐、图层、复制、撤销/重做，以及 SVG/PNG 导出。边框支持自定义颜色、粗细、实线/虚线/点线，以及无效果、柔和阴影、悬浮阴影、边框光晕；连接线也支持独立颜色和粗细。文字支持论文无衬线、Avenir Next、Inter 和圆润的 Nunito Sans。画板右键可直接打开图层菜单，支持上移、下移、置顶、置底、组合、复制和删除；“插入结构”提供流程图、模型架构图、实验对比图、AgentSquare 和 Agent Archive 五套可继续编辑的科研图模板。

图板快捷键：`⌘/Ctrl+Z` 撤销，`⌘/Ctrl+Shift+Z` 或 `⌘/Ctrl+Y` 重做，`⌘/Ctrl+C/X/V/D` 复制/剪切/粘贴/复制一份，`⌘/Ctrl+G` 组合、`⌘/Ctrl+Shift+G` 取消组合，`Delete` 删除，方向键移动（按住 `Shift` 每次移动 10px），`R` 插入矩形、`T` 插入文字、`L` 插入箭头；选中对象后可拖动八个方向手柄自由拉伸。

图板素材库新增内置原创的 Eagle、Agent、Module pool、Memory 四个可点击素材；也保留 Iconfinder EAGLE 和 Flaticon EAGLE 的外部检索入口。外部图标下载后请遵守原作者许可并完成署名，内置素材可直接使用，详情见 `assets/research-icons/ATTRIBUTION.md`。

文献库左栏的“拖入文献”区域支持从 Finder 或文件管理器拖入单个文件，也支持直接拖入整个文件夹；工具会递归识别 PDF、Word、TXT、Markdown、EPUB、CAJ 等格式并自动复制到文献库，重复文件会按现有规则处理。

左侧只显示常用工具，其余集中在「更多」工具库。工具库里的星标可以固定或取消固定，最多保留 7 个；`Cmd+1…7` 按当前固定顺序切换。

## 几句实话

- **上传文件和 AI 吐字的速度，这个工具改不了**。那是 DeepSeek 服务端决定的。
  它能省掉的是「切到浏览器 → 搜索 → 等页面加载」这段，每次大概 5–15 秒，以及
  让你不用离开当前窗口。
- **纠错比 API 慢几秒**。因为它是驱动一个真实网页在跑，不是直连接口。代价换来的是不花钱。
- **DeepSeek 改版可能会让桥接失效**。真发生了，去「设置 → 检测桥接状态」，
  它会告诉你是「没登录」还是「页面结构变了」。前者自己登录一下，后者需要改
  `src/renderer/core/page-agent.js`。
- **AI 整理的知识点不保证正确**。「分析网站知识点」是把别人网页上的话交给模型总结，关键结论请回原文核对；
  「AI 找站」给的网址也可能失效或记错，点开看一眼再收藏。
- **抓来的网页内容当数据、不当指令**。送进模型时用分隔符隔离并明确声明，网页里若埋了「忽略以上指令」之类的文字不会生效。
- **数据只存本地**：普通设置在 `~/Library/Application Support/agent-toolbox/config.json`；API Key 由系统安全存储加密，不上传到项目或日志。

## 目录

```
src/
├── main/                   主进程：窗口、session、IPC、配置落盘
│   ├── main.js             入口；剥离内嵌站点 CSP、伪装 Chrome UA
│   ├── preload.js          渲染进程能用的 Node 能力白名单
│   └── store.js            config.json 原子读写
└── renderer/
    ├── app.js              壳：侧边栏、工具挂载与切换
    ├── core/
    │   ├── registry.js     工具注册表（加新工具改这里）
    │   ├── deepseek-bridge.js  把隐藏网页当无界面 LLM 用
    │   ├── page-agent.js   注入进 DeepSeek 页面的探针
    │   ├── config.js / ui.js
    ├── styles/
    │   └── ai.js           AI 接口门面（网页版 / 自定义 API 可切换）
    └── tools/
        ├── ask/ docs/ typing/ focus/ settings/
        └── study/          学习：data/ 知识模块 · highlight.js 代码高亮
                            recite.js 默写对比 · quiz.js AI 出题 · scrape.js 抓站
```

需求与设计取舍见 [docs/SPEC.md](docs/SPEC.md)，加新工具见 [docs/ADD-A-TOOL.md](docs/ADD-A-TOOL.md)。
