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
    /** 历史报告列表（本地持久化的） */
    listReports: () => ipcRenderer.invoke('video:listReports'),
    readReport: (fileName) => ipcRenderer.invoke('video:readReport', fileName),
  },

  site: {
    /** 主进程代取站点 favicon，返回 data: URL（拿不到返回 null，界面用兜底图标） */
    favicon: (url) => ipcRenderer.invoke('site:favicon', url),
  },

  news: {
    /** 主进程代取 RSS/Atom 订阅源，返回 { ok, items: [{title, link, at}] | error } */
    fetchFeed: (url) => ipcRenderer.invoke('news:fetchFeed', url),
  },

  coach: {
    /** 把陪读插件装进本机 VSCode / Cursor 并写入默认 API 配置 */
    install: () => ipcRenderer.invoke('coach:install'),
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
    /** 整理库里编号命名的 PDF（arxiv 编号 → 正文标题），返回重命名列表 */
    fixNames: () => ipcRenderer.invoke('lit:fixNames'),
    /** 按文献名自动下载免费 PDF（arXiv/Semantic Scholar），返回 { ok, file | error } */
    fetchByTitle: (query) => ipcRenderer.invoke('lit:fetch', query),
    /** 免费翻译（有道），返回 { ok, translation | error } */
    translate: (text) => ipcRenderer.invoke('lit:translate', text),
    /** 圈选截图 OCR + 翻译，返回 { ok, srcText, translation | error } */
    snipTranslate: (dataUrl) => ipcRenderer.invoke('lit:snipTranslate', dataUrl),
  },

  ai: {
    /** 走主进程发 OpenAI 兼容请求；API Key 只从主进程安全存储读取 */
    chat: (payload) => ipcRenderer.invoke('ai:chat', payload),
    credentialStatus: () => ipcRenderer.invoke('ai:credentialStatus'),
    saveCredential: (key) => ipcRenderer.invoke('ai:saveCredential', key),
    clearCredential: () => ipcRenderer.invoke('ai:clearCredential'),
    listModels: (baseUrl) => ipcRenderer.invoke('ai:listModels', { baseUrl }),
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

  clipboard: {
    write: (text) => ipcRenderer.invoke('clipboard:write', text),
    read: () => ipcRenderer.invoke('clipboard:read'),
  },

  shell: {
    openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  },

  /** 内嵌页面请求打开新窗口时，主进程把 URL 转到这里 */
  onOpenUrl: (callback) => {
    ipcRenderer.on('webview:open-url', (_event, url) => callback(url));
  },

  app: {
    version: () => ipcRenderer.invoke('app:version'),
    reload: () => ipcRenderer.invoke('app:reload'),
    openDevTools: () => ipcRenderer.invoke('app:openDevTools'),
    onNavigateTool: (callback) => ipcRenderer.on('app:navigate-tool', (_event, target) => callback(target)),
  },
});
