import { createSiteGrid } from '../../core/sitegrid.js';

/**
 * 在线工具箱：把网上那些「一个站顶一堆小工具」的网站收进来，内嵌打开，不用再翻收藏夹。
 *
 * 选站标准：免安装、打开就能用、不强制登录。都是别人的网站，只是嵌进来；
 * 想加自己常用的，格子铺最后那个「＋」就是。
 */
const PRESET_SITES = [
  // ---- 万能工具箱 ----
  { category: 'all-in-one', name: 'IT-Tools', url: 'https://it-tools.tech/', desc: '开发者百宝箱：编码 / 哈希 / UUID / JWT / 正则 / 颜色 / 二维码，全在本地算', emoji: '🧰' },
  { category: 'all-in-one', name: 'CyberChef', url: 'https://gchq.github.io/CyberChef/', desc: '英国 GCHQ 出的「数据厨房」：编码解码、加解密、压缩，一步步串起来', emoji: '🍳' },
  { category: 'all-in-one', name: '菜鸟工具', url: 'https://c.runoob.com/', desc: '菜鸟教程配套的在线工具，中文，编译器 / 转换 / 生成器一应俱全', emoji: '🐣' },
  { category: 'all-in-one', name: '在线工具 tool.lu', url: 'https://tool.lu/', desc: '老牌中文在线工具：时间戳、JSON、正则、进制、图片处理', emoji: '🔧' },
  { category: 'all-in-one', name: 'TinyWow', url: 'https://tinywow.com/', desc: 'PDF / 图片 / 视频 / 文字 两百多个小工具，免费无水印', emoji: '✨' },
  { category: 'all-in-one', name: '10015 Tools', url: 'https://10015.io/', desc: '设计师和开发者都用得上的一站式工具集，界面好看', emoji: '🎛️' },
  // ---- 开发 ----
  { category: 'dev', name: 'regex101', url: 'https://regex101.com/', desc: '写正则最顺手的地方：实时高亮、逐段解释、测试用例', emoji: '🔤' },
  { category: 'dev', name: 'JSON Crack', url: 'https://jsoncrack.com/editor', desc: '把 JSON / YAML / CSV 画成图，一眼看清嵌套结构', emoji: '🕸️' },
  { category: 'dev', name: 'transform.tools', url: 'https://transform.tools/', desc: 'JSON → TypeScript / Go / Rust 类型，HTML → JSX，一键互转', emoji: '🔁' },
  { category: 'dev', name: 'crontab.guru', url: 'https://crontab.guru/', desc: 'cron 表达式翻译成人话，再也不用背五个星号', emoji: '⏰' },
  { category: 'dev', name: 'Carbon', url: 'https://carbon.now.sh/', desc: '把代码片段渲染成好看的图片，发群里 / 放 PPT', emoji: '🖼️' },
  { category: 'dev', name: 'Excalidraw', url: 'https://excalidraw.com/', desc: '手绘风白板，画架构图和流程图最快', emoji: '✏️' },
  { category: 'dev', name: 'Mermaid Live', url: 'https://mermaid.live/', desc: '用文字画流程图 / 时序图 / 甘特图，改一个字图就跟着变', emoji: '🧜' },
  // ---- 图片 ----
  { category: 'image', name: 'Squoosh', url: 'https://squoosh.app/', desc: 'Google 出的图片压缩，本地处理不上传，对比着看画质', emoji: '🗜️' },
  { category: 'image', name: 'Photopea', url: 'https://www.photopea.com/', desc: '网页版 Photoshop，能开 PSD，免费', emoji: '🎨' },
  { category: 'image', name: 'remove.bg', url: 'https://www.remove.bg/zh', desc: '一键抠图去背景', emoji: '✂️' },
  { category: 'image', name: 'TinyPNG', url: 'https://tinypng.com/', desc: 'PNG / JPG / WebP 智能压缩，肉眼看不出差别', emoji: '🐼' },
  // ---- 文档 / PDF ----
  { category: 'doc', name: 'iLovePDF', url: 'https://www.ilovepdf.com/zh-cn', desc: 'PDF 合并 / 拆分 / 压缩 / 转 Word，全套', emoji: '📄' },
  { category: 'doc', name: 'PDF24', url: 'https://tools.pdf24.org/zh/', desc: '德国人做的 PDF 工具箱，免费无限制', emoji: '📑' },
  { category: 'doc', name: 'Diffchecker', url: 'https://www.diffchecker.com/', desc: '两段文字 / 两个文件对比差异', emoji: '🆚' },
  { category: 'doc', name: 'DeepL 翻译', url: 'https://www.deepl.com/zh/translator', desc: '翻译质量最自然的一家，长段落尤其好', emoji: '🌐' },
  // ---- 转换 ----
  { category: 'convert', name: 'Convertio', url: 'https://convertio.co/zh/', desc: '三百多种文件格式互转，音视频文档都行', emoji: '🔄' },
  { category: 'convert', name: 'CloudConvert', url: 'https://cloudconvert.com/', desc: '转换质量稳，支持批量和参数微调', emoji: '☁️' },
  { category: 'convert', name: 'ezgif', url: 'https://ezgif.com/', desc: 'GIF 制作 / 裁剪 / 压缩 / 视频转 GIF', emoji: '🎞️' },
];

const CATEGORIES = [
  { id: 'all-in-one', label: '万能箱' },
  { id: 'dev', label: '开发' },
  { id: 'image', label: '图片' },
  { id: 'doc', label: '文档' },
  { id: 'convert', label: '转换' },
];

export default {
  id: 'webtools',
  title: '在线工具',
  icon: 'zap',
  hint: 'IT-Tools、CyberChef、Squoosh 这些在线工具站，内嵌打开，可以自己加',

  create(root, ctx) {
    createSiteGrid(root, {
      presets: PRESET_SITES,
      categories: CATEGORIES,
      configKey: 'webtools.sites',
      cachePrefix: 'webtools.favicons.',
      partition: 'persist:webtools',
      config: ctx.config,
      detachable: true,
      bypass: false,
    });
  },
};
