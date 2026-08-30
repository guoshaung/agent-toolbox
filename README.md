# Agent 工具箱

把「查文档、打字、进入状态、问 AI」这四件每天都要干、但每次都得切窗口的事，收进同一个壳里。

基于 Electron（Chrome 内核），只有 `electron` 一个依赖，没有构建步骤。

## 跑起来

```bash
npm install
npm start
```

第一次用请先点左上角「⚡ 快问」，在里面登录一次 DeepSeek。登录态会长期保留，
「打字纠错」和「帮我决定」都复用这个登录态，**不消耗 API 额度，不花钱**。

改完 `src/renderer/` 里的代码不用重启，在「设置」里点「重载界面」即可。
改了 `src/main/` 才需要重启。

## 四个工具

| | 干什么 | 快捷键 |
|---|---|---|
| ⚡ 快问 | 内嵌 DeepSeek 网页版，常驻热会话，背景可换成自己的图 | Cmd+1 |
| 📖 文档 | 内置 Chromium 的官方文档浏览器，多标签 + 书签 + 站内搜索 | Cmd+2 |
| ✍️ 纠错 | 读懂打错的中文；拿不准你的意思时会反问，而不是瞎猜 | Cmd+3 |
| 🎯 专注 | 番茄钟 + 白噪音 + 呼吸引导 + 「不知道干什么」时帮你选一件 | Cmd+4 |
| ⚙︎ 设置 | 桥接自检、清理数据、开发者工具 | Cmd+5 |

其它快捷键：`Cmd+F` 页内查找，`Cmd+L` 定位地址栏，`Cmd+Enter` 触发纠错，`Cmd+W` 关标签页。

## 几句实话

- **上传文件和 AI 吐字的速度，这个工具改不了**。那是 DeepSeek 服务端决定的。
  它能省掉的是「切到浏览器 → 搜索 → 等页面加载」这段，每次大概 5–15 秒，以及
  让你不用离开当前窗口。
- **纠错比 API 慢几秒**。因为它是驱动一个真实网页在跑，不是直连接口。代价换来的是不花钱。
- **DeepSeek 改版可能会让桥接失效**。真发生了，去「设置 → 检测桥接状态」，
  它会告诉你是「没登录」还是「页面结构变了」。前者自己登录一下，后者需要改
  `src/renderer/core/page-agent.js`。
- **数据只存本地**，在 `~/Library/Application Support/agent-toolbox/config.json`，不上传任何地方。

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
    └── tools/{ask,docs,typing,focus,settings}/
```

需求与设计取舍见 [docs/SPEC.md](docs/SPEC.md)，加新工具见 [docs/ADD-A-TOOL.md](docs/ADD-A-TOOL.md)。
