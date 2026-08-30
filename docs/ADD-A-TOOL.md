# 加一个新工具

需求第 5 条「可能还需要更多好用的工具」就是靠这个。加一个工具是两步：写一个文件夹，注册一行。

## 1. 建目录

```
src/renderer/tools/<你的工具id>/index.js
```

## 2. 默认导出一个对象

```js
import { h, toast } from '../../core/ui.js';

export default {
  id: 'timer',            // 唯一 id，也是 DOM 里 #tool-timer 的来源
  title: '计时',           // 侧边栏上的两个字，别太长
  icon: '⏱',              // 一个 emoji
  hint: '鼠标悬停时的说明',

  /**
   * root: 这个工具专属的 <section>，随便往里塞
   * ctx:  { config, bridge, toast, goto }
   * 返回 { activate?, deactivate? }，可选
   */
  create(root, ctx) {
    const label = h('div', {}, '你好');
    root.append(
      h('div', { class: 'bar bar--drag' }, h('strong', {}, '计时')),
      h('div', { class: 'card' }, label),
    );

    return {
      activate() { /* 每次切到这个工具时调用 */ },
      deactivate() { /* 切走时调用，用来暂停动画、存状态 */ },
    };
  },
};
```

## 3. 注册

在 `src/renderer/core/registry.js` 里 import 并加进 `TOOLS` 数组。数组顺序 = 侧边栏顺序，
也决定了 `Cmd+数字` 的编号。

## ctx 里有什么

| | 用法 | 说明 |
|---|---|---|
| `ctx.config` | `config.get('my.key', 默认值)` / `await config.set('my.key', 值)` | 点分路径，自动落盘到 config.json。**给你的 key 加个前缀**，别和别的工具撞 |
| `ctx.bridge` | `await bridge.ask('提示词')` → 字符串<br>`await bridge.askJSON('...')` → 对象 | 复用用户已登录的 DeepSeek 网页会话，不花钱。串行执行，同时只跑一轮 |
| `ctx.toast` | `toast('存好了', 'good')` | kind: `info` / `good` / `bad` |
| `ctx.goto` | `ctx.goto('ask')` | 跳到另一个工具 |

`window.toolbox` 上还有：`clipboard.write/read`、`files.pickImage`、`shell.openExternal`、
`app.reload/openDevTools`。要加新的 Node 能力，得同时改 `src/main/preload.js`（白名单）和
`src/main/main.js`（IPC handler）—— 这是故意的，渲染进程默认拿不到 Node。

## 用 bridge 的两条注意

1. **一定要处理报错。** 最常见的是没登录：

   ```js
   try {
     const result = await ctx.bridge.askJSON(prompt);
   } catch (err) {
     if (err.code === 'need-login') { /* 给个「去登录」按钮，ctx.goto('ask') */ }
     else { /* err.code 还可能是 timeout / no-input / empty */ }
   }
   ```

2. **要 JSON 就把格式写死在提示词里**，并且声明「不要用 markdown 代码块」。
   `askJSON` 已经能兜住模型多嘴的情况，但提示词写清楚能少绕一圈。
   参考 `tools/typing/prompt.js`。

## 样式

`styles/base.css` 里有现成的 `.bar` `.btn` `.field` `.card` `.tag` `.empty` `.spinner`。
工具专属样式写进 `styles/tools.css`，class 用 `工具id__块名` 前缀，避免互相污染。
