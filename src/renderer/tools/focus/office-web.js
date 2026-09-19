/**
 * 各家 AI 的网页版对话框，内嵌在办公室里。
 *
 * 之前「派发」和「接着聊」都是另起一个 CLI 进程 —— 那是个全新的、没登录的会话，
 * 所以每次都被要求登录。你要的从来不是再开一个，而是把字送进已经开着、已经登录
 * 的那个对话框。网页版是最稳的一条路：每家一个 persist 分区的 webview，登录一次
 * 长期有效，之后把文字塞进它的输入框、替你点发送，回答就在它自己的屏幕里滚出来。
 *
 * 不用 playwright：那要再拉起一个浏览器进程、还得想办法共享登录态。webview 本身
 * 就是一个受控的 Chromium 页面，executeJavaScript 能直接摸到它的 DOM，成本更低。
 */

export const WEB_CHAT = {
  dsh:      { url: 'https://chat.deepseek.com/',   who: 'DeepSeek' },
  codex:    { url: 'https://chatgpt.com/',         who: 'ChatGPT' },
  claude:   { url: 'https://claude.ai/new',        who: 'Claude' },
  gemini:   { url: 'https://gemini.google.com/app', who: 'Gemini' },
  kimi:     { url: 'https://www.kimi.com/',        who: 'Kimi' },
  glm:      { url: 'https://chatglm.cn/',          who: '智谱清言' },
  grok:     { url: 'https://grok.com/',            who: 'Grok' },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 在页面里找聊天输入框、聚焦并清空。
 * 各家结构都不一样，但有两个共性：要么是 textarea，要么是 contenteditable；
 * 而且几乎总在页面最底下 —— 所以取「可见的、最靠下的那个」。
 *
 * 文字不在这里填：用 JS 改 value 再补 input 事件，ChatGPT 的 React 状态不认，
 * 发送按钮一直是灰的。真正的输入走 webview.insertText —— 那是走输入法通道进去的，
 * 页面分不出和你手敲有什么区别。
 */
const FOCUS_BOX = `(function () {
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 20 && r.height > 10 && getComputedStyle(el).visibility !== 'hidden'; };
  const boxes = [...document.querySelectorAll('textarea, [contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"]')]
    .filter(visible).filter((el) => !el.disabled && !el.readOnly);
  boxes.sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom);
  const box = boxes[0];
  if (!box) return { ok: false, error: '这个页面上找不到输入框，可能还没登录或还在加载' };
  box.focus();
  if (box.tagName === 'TEXTAREA') box.select(); else document.execCommand('selectAll', false);
  window.__toolboxBox = box;
  return { ok: true, tag: box.tagName };
})()`;

/** 输入框现在的内容 —— 发出去以后各家都会把它清空，拿这个判断到底发没发。 */
const BOX_TEXT = `(function () { const b = window.__toolboxBox; return b ? (b.tagName === 'TEXTAREA' ? b.value : b.innerText).trim() : ''; })()`;

/** 发送后页面是不是弹了登录框（Kimi、DeepSeek 都是这样：没登录也让你打字，一按发送才拦） */
const LOGIN_WALL = `(function () {
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 100 && r.height > 100; };
  const layers = [...document.querySelectorAll('[role="dialog"], [class*="modal"], [class*="Modal"], [class*="login"], [class*="Login"]')].filter(visible);
  return layers.some((el) => /登录|log ?in|sign ?in|验证码/i.test(el.innerText || ''));
})()`;

/** 点发送按钮。找不到或按钮是灰的就返回 false，外面改用回车。 */
const CLICK_SEND = `(function () {
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const box = window.__toolboxBox;
  const near = (el) => { if (!box) return true; const a = el.getBoundingClientRect(), b = box.getBoundingClientRect(); return Math.abs(a.bottom - b.bottom) < 160; };
  const all = [...document.querySelectorAll('button, [role="button"]')]
    .filter(visible).filter((b) => !b.disabled && b.getAttribute('aria-disabled') !== 'true');
  const byTestId = all.find((b) => /send/i.test(b.getAttribute('data-testid') || ''));
  const byLabel = all.find((b) => /发送|send|submit/i.test((b.getAttribute('aria-label') || '') + ' ' + (b.title || '')));
  const bySubmit = all.filter((b) => b.type === 'submit' && near(b)).pop();
  const pick = byTestId || byLabel || bySubmit;
  if (!pick) return false;
  pick.click();
  return true;
})()`;

export function createWebPool() {
  /** agentId -> webview */
  const views = new Map();
  const host = document.createElement('div');
  host.className = 'office__screen';

  function ensure(id) {
    if (views.has(id)) return views.get(id);
    const site = WEB_CHAT[id];
    if (!site) return null;
    const view = document.createElement('webview');
    view.setAttribute('partition', `persist:office-${id}`);   // 每家单独会话，登录一次长期有效
    view.setAttribute('src', site.url);
    view.setAttribute('allowpopups', 'true');
    view.className = 'office__screen-view';
    view.__ready = new Promise((resolve) => view.addEventListener('dom-ready', resolve, { once: true }));
    views.set(id, view);
    host.append(view);
    return view;
  }

  /** 让某一家的屏幕露出来（别家只是 visibility 隐藏，不 display:none —— 那会让 webview 重载） */
  function show(id) {
    const target = ensure(id);
    for (const [key, view] of views) view.classList.toggle('is-front', key === id);
    host.classList.toggle('is-open', Boolean(target));
    return target;
  }

  function close() {
    host.classList.remove('is-open');
    for (const view of views.values()) view.classList.remove('is-front');
  }

  /**
   * 把一句话送进某家的网页对话框并发送。
   * 不等回答 —— 回答在它自己的屏幕里滚，你看得见，也能随时插话。
   */
  async function send(id, text) {
    const view = ensure(id);
    if (!view) return { ok: false, error: '这家没有网页版' };
    await Promise.race([view.__ready, sleep(15000)]);
    let focused;
    try {
      focused = await view.executeJavaScript(FOCUS_BOX, true);
    } catch (error) {
      return { ok: false, error: `页面没响应：${error.message}` };
    }
    if (!focused?.ok) return { ok: false, error: focused?.error || '找不到输入框', needsLogin: true };
    // 选中了旧内容，insertText 会把它整个替换掉
    await view.insertText(text);
    await sleep(300);                                   // 等前端框架把输入吃进去、把发送按钮点亮
    const typed = await view.executeJavaScript(BOX_TEXT, true).catch(() => '');
    if (!typed) return { ok: false, error: '字没填进它的输入框，去它屏幕里看看' };

    const emptied = async () => !(await view.executeJavaScript(BOX_TEXT, true).catch(() => 'x'));
    let how = 'button';
    let clicked = false;
    try { clicked = await view.executeJavaScript(CLICK_SEND, true); } catch { /* 走回车 */ }
    if (clicked) await sleep(500);
    if (!clicked || !(await emptied())) {
      how = 'enter';
      view.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
      view.sendInputEvent({ type: 'char', keyCode: 'Return' });
      view.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
      await sleep(600);
    }
    if (!(await emptied())) {
      const wall = await view.executeJavaScript(LOGIN_WALL, true).catch(() => false);
      if (wall) return { ok: false, needsLogin: true, error: `${WEB_CHAT[id].who} 要你先登录：在它的屏幕里登录一次，以后就不用了` };
      return { ok: false, error: '字填进去了，但它没发出去 —— 去它的屏幕里按一下发送' };
    }
    return { ok: true, how };
  }

  function reload(id) { views.get(id)?.reload(); }
  function openHome(id) { const v = views.get(id); if (v && WEB_CHAT[id]) v.loadURL(WEB_CHAT[id].url); }

  return { host, ensure, show, close, send, reload, openHome, has: (id) => Boolean(WEB_CHAT[id]) };
}
