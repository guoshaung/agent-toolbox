'use strict';
const { contextBridge, ipcRenderer } = require('electron');

/**
 * 渲染进程唯一的 Node 能力入口。这里是白名单：没列出来的能力，
 * 页面里拿不到。工具代码统一通过 window.toolbox 访问。
 */
contextBridge.exposeInMainWorld('toolbox', {
  platform: process.platform,

  config: {
    all: () => ipcRenderer.invoke('config:all'),
    get: (key, fallback) => ipcRenderer.invoke('config:get', key, fallback),
    set: (key, value) => ipcRenderer.invoke('config:set', key, value),
  },

  files: {
    /** 打开选图对话框，返回 { path, name, mime, base64 } 或 null（用户取消） */
    pickImage: () => ipcRenderer.invoke('files:pickImage'),
    pickPetSkin: () => ipcRenderer.invoke('files:pickPetSkin'),
  },

  chat: {
    /** 可用的 AI 来源列表：{ codex: 'Codex', ... } */
    sources: () => ipcRenderer.invoke('chat:sources'),
    /** 列出本机某 AI 工具的会话：source 为 'codex' | 'claude' | 'opencode' | ... */
    list: (source) => ipcRenderer.invoke('chat:list', source),
    /** 加载单个会话（默认预览前 120 条；full=true 拿全部） */
    load: (source, id, full) => ipcRenderer.invoke('chat:load', { source, id, full }),
    /** 导出会话到文件（弹保存框），返回 { ok, path, count } */
    export: (source, id, format) => ipcRenderer.invoke('chat:export', { source, id, format }),
    /** 把若干会话打包成迁移包 JSON（弹保存框） */
    transfer: (source, ids, note) => ipcRenderer.invoke('chat:transfer', { source, ids, note }),
    /** 选择一个迁移包并读取摘要 */
    pickTransfer: () => ipcRenderer.invoke('chat:pickTransfer'),
    /** 在访达里显示文件 */
    showInFinder: (path) => ipcRenderer.invoke('chat:showInFinder', path),
  },

  video: {
    /** 抓 B 站视频公开信息（标题/简介/UP主/分集/播放量），返回 { ok, info | error } */
    fetchInfo: (url) => ipcRenderer.invoke('video:fetchInfo', url),
    /** 拉字幕：官方字幕优先，没有则 AI 字幕；scope: 'p1' | 'p5' | 'all' */
    fetchSubs: (payload) => ipcRenderer.invoke('video:fetchSubs', payload),
    /** 报告落盘 userData/reports/*.md，publish=true 时再用 lark-cli 发飞书 */
    saveReport: (payload) => ipcRenderer.invoke('video:saveReport', payload),
    publishReport: (fileName, force = false) => ipcRenderer.invoke('video:publishReport', fileName, force),
    openFeishuWindow: (url) => ipcRenderer.invoke('video:openFeishuWindow', url),
    /** 历史报告列表（本地持久化的） */
    listReports: () => ipcRenderer.invoke('video:listReports'),
    readReport: (fileName) => ipcRenderer.invoke('video:readReport', fileName),
  },

  site: {
    /** 主进程代取站点 favicon，返回 data: URL（拿不到返回 null，界面用兜底图标） */
    favicon: (url) => ipcRenderer.invoke('site:favicon', url),
    /** 站点登录墙绕过脚本内容（渲染进程注入 webview 用） */
    bypassScript: () => ipcRenderer.invoke('site:bypassScript'),
    /** 同步 Edge/Chrome 已登录站点的 cookie 到指定 webview 分区 */
    syncCookies: (partition, host) => ipcRenderer.invoke('edge:syncCookies', { partition, host }),
    /** 把科研门户站点拆成置顶悬浮球 */
    float: (site) => ipcRenderer.invoke('site:float', site),
  },

  watch: {
    /** 获取公开 X 头像并返回应用内 data URL；失败时由界面显示首字母 */
    avatar: (handle) => ipcRenderer.invoke('watch:avatar', handle),
  },

  skill: {
    /** Skill 工厂的默认输出目录 */
    targets: () => ipcRenderer.invoke('skill:targets'),
    /** 扫描本机常见 Skill 目录 */
    list: () => ipcRenderer.invoke('skill:list'),
    read: (filePath) => ipcRenderer.invoke('skill:read', filePath),
    write: (payload) => ipcRenderer.invoke('skill:write', payload),
    reveal: (filePath) => ipcRenderer.invoke('skill:reveal', filePath),
    /** MCP 服务目标和配置管理 */
    mcpTargets: () => ipcRenderer.invoke('mcp:targets'),
    mcpList: (targetId) => ipcRenderer.invoke('mcp:list', targetId),
    mcpSnippet: (payload) => ipcRenderer.invoke('mcp:snippet', payload),
    mcpWrite: (payload) => ipcRenderer.invoke('mcp:write', payload),
    mcpRemove: (payload) => ipcRenderer.invoke('mcp:remove', payload),
  },

  news: {
    /** 主进程代取 RSS/Atom 订阅源，返回 { ok, items: [{title, link, at, image}] | error } */
    fetchFeed: (url) => ipcRenderer.invoke('news:fetchFeed', url),
    /** 快报配图代取（data: URL 带磁盘缓存），拿不到返回 null */
    image: (url) => ipcRenderer.invoke('news:image', url),
  },

  coach: {
    /** 把陪读插件装进本机 VSCode / Cursor 并写入默认 API 配置 */
    install: () => ipcRenderer.invoke('coach:install'),
  },

  practice: {
    /** 在受限临时目录中运行学习实践代码，返回 stdout/stderr 和退出状态 */
    run: (payload) => ipcRenderer.invoke('practice:run', payload),
    environment: () => ipcRenderer.invoke('practice:environment'),
  },

  dock: {
    status: () => ipcRenderer.invoke('dock:status'),
    requestPermission: () => ipcRenderer.invoke('dock:requestPermission'),
    togglePin: () => ipcRenderer.invoke('dock:togglePin'),
    arm: () => ipcRenderer.invoke('dock:arm'),
    cancelArm: () => ipcRenderer.invoke('dock:cancelArm'),
    captureAfter: (delay) => ipcRenderer.invoke('dock:captureAfter', delay),
    captureFrontmost: () => ipcRenderer.invoke('dock:captureFrontmost'),
    setRatio: (ratio) => ipcRenderer.invoke('dock:setRatio', ratio),
    setSide: (side) => ipcRenderer.invoke('dock:setSide', side),
    detach: () => ipcRenderer.invoke('dock:detach'),
    onStatus: (callback) => ipcRenderer.on('dock:status', (_event, state) => callback(state)),
    onError: (callback) => ipcRenderer.on('dock:error', (_event, message) => callback(message)),
  },

  terms: {
    status: () => ipcRenderer.invoke('term:status'),
    setOverlayEnabled: (enabled) => ipcRenderer.invoke('term:setOverlayEnabled', enabled),
    shortcutLabel: () => process.platform === 'darwin' ? '⌘⇧E' : 'Ctrl+Shift+E',
    resolve: (payload) => ipcRenderer.invoke('term:resolve', payload),
    onExplainRequest: (callback) => ipcRenderer.on('term:explain-request', (_event, payload) => callback(payload)),
  },

  lit: {
    /** 弹文件选择框导入文献到 userData/literature/，返回导入的文件列表 */
    import: () => ipcRenderer.invoke('lit:import'),
    /** 列出已导入的文献（文件名/大小/格式/时间） */
    list: () => ipcRenderer.invoke('lit:list'),
    /** 用系统默认程序打开 */
    open: (file) => ipcRenderer.invoke('lit:open', file),
    /** 在访达里显示 */
    reveal: (file) => ipcRenderer.invoke('lit:reveal', file),
    /** 删除 */
    remove: (file) => ipcRenderer.invoke('lit:remove', file),
    /** 完整路径（内置阅读器用） */
    path: (file) => ipcRenderer.invoke('lit:path', file),
    /** 读纯文本内容（TXT/MD 内置阅读） */
    readText: (file) => ipcRenderer.invoke('lit:readText', file),
    /** 读 PDF 字节（渲染进程用 PDF.js 自渲染，摆脱内置插件的各种限制） */
    readPdf: (file) => ipcRenderer.invoke('lit:readPdf', file),
    /** 整理库里编号命名的 PDF（arxiv 编号 → 正文标题），返回重命名列表 */
    fixNames: () => ipcRenderer.invoke('lit:fixNames'),
    /** 按文献名自动下载免费 PDF（arXiv/Semantic Scholar），返回 { ok, file | error } */
    fetchByTitle: (query) => ipcRenderer.invoke('lit:fetch', query),
    /** 按研究方向发现候选论文 */
    discover: (options) => ipcRenderer.invoke('lit:discover', options),
    /** 下载候选的合法开放全文 */
    downloadCandidate: (paper) => ipcRenderer.invoke('lit:downloadCandidate', paper),
    downloadCandidates: (papers) => ipcRenderer.invoke('lit:downloadCandidates', papers),
    /** 打开持久登录浏览器，下载完成后自动进入文献库 */
    openAccessBrowser: (url) => ipcRenderer.invoke('lit:openAccessBrowser', url),
    scanBrowserPage: () => ipcRenderer.invoke('lit:scanBrowserPage'),
    downloadBatch: (items) => ipcRenderer.invoke('lit:downloadBatch', items),
    onBatchProgress: (callback) => ipcRenderer.on('lit:batch-progress', (_event, state) => callback(state)),
    onAutoProgress: (callback) => ipcRenderer.on('lit:auto-progress', (_event, state) => callback(state)),
    onDownloaded: (callback) => ipcRenderer.on('lit:downloaded', (_event, item) => callback(item)),
    /** 免费翻译（有道），返回 { ok, translation | error } */
    translate: (text, opts) => ipcRenderer.invoke('lit:translate', text, opts),
    /** 圈选截图 OCR（只识别不翻译，翻译走渲染层 AI 接口），返回 { ok, text | error } */
    snipOcr: (dataUrl) => ipcRenderer.invoke('lit:snipOcr', dataUrl),
  },

  ai: {
    /** 走主进程发 OpenAI 兼容请求；API Key 只从主进程安全存储读取 */
    chat: (payload) => ipcRenderer.invoke('ai:chat', payload),
    /** 文献翻译专用豆包通道，使用独立安全凭据，不受全局 AI 模型切换影响 */
    translate: (payload) => ipcRenderer.invoke('ai:translate', payload),
    /** 学习出题专用 Qwen 通道，使用独立安全凭据，不影响其他工具 */
    quiz: (payload) => ipcRenderer.invoke('ai:quiz', payload),
    credentialStatus: (scope) => ipcRenderer.invoke('ai:credentialStatus', scope),
    saveCredential: (key, scope) => ipcRenderer.invoke('ai:saveCredential', key, scope),
    clearCredential: (scope) => ipcRenderer.invoke('ai:clearCredential', scope),
    listModels: (baseUrl, scope) => ipcRenderer.invoke('ai:listModels', { baseUrl, scope }),
  },

  pet: {
    getState: () => ipcRenderer.invoke('pet:getState'),
    setEnabled: (enabled) => ipcRenderer.invoke('pet:setEnabled', enabled),
    resize: (expanded) => ipcRenderer.invoke('pet:resize', expanded),
    move: (position) => ipcRenderer.invoke('pet:move', position),
    endDrag: () => ipcRenderer.invoke('pet:endDrag'),
    explain: (input) => ipcRenderer.invoke('pet:explain', input),
    openAiSettings: () => ipcRenderer.invoke('pet:openAiSettings'),
    onSettingsChanged: (callback) => ipcRenderer.on('pet:settings-changed', (_event, settings) => callback(settings)),
    onCollapse: (callback) => ipcRenderer.on('pet:collapse', callback),
  },

  notebook: {
    /** 扫描本机跑过 /understand 的项目 */
    findGraphs: () => ipcRenderer.invoke('notebook:findGraphs'),
    /** 手动指一个项目目录 */
    pickGraph: () => ipcRenderer.invoke('notebook:pickGraph'),
    /** 读取某个项目的知识图谱 */
    loadGraph: (root) => ipcRenderer.invoke('notebook:loadGraph', root),
    /** 按 filePath + lineRange 回读真实源码 */
    readSource: (payload) => ipcRenderer.invoke('notebook:readSource', payload),
    /** 打开项目文件夹（只记路径，不扫内容） */
    pickFolder: () => ipcRenderer.invoke('notebook:pickFolder'),
    folderInfo: (root) => ipcRenderer.invoke('notebook:folderInfo', root),
    /** 列一层目录 —— 展开哪层读哪层，不做全量索引 */
    listDir: (payload) => ipcRenderer.invoke('notebook:listDir', payload),
    /** 点开某个文件才读它的内容 */
    readFile: (payload) => ipcRenderer.invoke('notebook:readFile', payload),
  },

  biblio: {
    /** 按标题或 DOI 从 Crossref 查书目元数据 */
    lookup: (payload) => ipcRenderer.invoke('biblio:lookup', payload),
    lookupMany: (list) => ipcRenderer.invoke('biblio:lookupMany', list),
    /** 导出 .bib / .ris / .txt */
    export: (payload) => ipcRenderer.invoke('biblio:export', payload),
    /** 富文本复制，粘进 Word 保留排版 */
    copyRich: (payload) => ipcRenderer.invoke('biblio:copyRich', payload),
  },

  clipboard: {
    write: (text) => ipcRenderer.invoke('clipboard:write', text),
    read: () => ipcRenderer.invoke('clipboard:read'),
    readImage: () => ipcRenderer.invoke('clipboard:readImage'),
  },

  remote: {
    status: () => ipcRenderer.invoke('remote:status'),
    start: () => ipcRenderer.invoke('remote:start'),
    stop: () => ipcRenderer.invoke('remote:stop'),
    rotate: () => ipcRenderer.invoke('remote:rotate'),
    setAutoStart: (enabled) => ipcRenderer.invoke('remote:setAutoStart', enabled),
    resolve: (payload) => ipcRenderer.invoke('remote:resolve', payload),
    onCommand: (callback) => ipcRenderer.on('remote:command', (_event, command) => callback(command)),
  },

  shell: {
    openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
    openEasyConnect: () => ipcRenderer.invoke('shell:openEasyConnect'),
    /** 唤起本机微信；只暴露固定动作，不允许渲染层传任意自定义协议 */
    openWeChat: () => ipcRenderer.invoke('shell:openWeChat'),
  },

  /** 内嵌页面请求打开新窗口时，主进程把 URL 转到这里 */
  onOpenUrl: (callback) => {
    ipcRenderer.on('webview:open-url', (_event, url) => callback(url));
  },

  app: {
    version: () => ipcRenderer.invoke('app:version'),
    relaunch: () => ipcRenderer.invoke('app:relaunch'),
    reload: () => ipcRenderer.invoke('app:reload'),
    openDevTools: () => ipcRenderer.invoke('app:openDevTools'),
    onNavigateTool: (callback) => ipcRenderer.on('app:navigate-tool', (_event, target) => callback(target)),
  },
});
