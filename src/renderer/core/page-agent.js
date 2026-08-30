/**
 * 注入进 DeepSeek 页面里跑的「探针」。
 *
 * 设计要点：**不依赖对方的 class 名**。
 * 早期版本靠 `.ds-markdown` 之类的选择器抓回复，对方一改版就全挂。
 * 现在改成：发送前挂 MutationObserver 记录新增节点，回复就是这批节点里
 * 文本最长的那个 —— 类名怎么改都不影响。
 *
 * 唯一还需要「找元素」的是输入框，用可见性 + 尺寸启发式定位，也不认类名。
 */
export const PAGE_AGENT = String.raw`
(() => {
  if (window.__tbx && window.__tbx.version === 3) return 'already';

  const visible = (el) => {
    if (!el || !el.isConnected) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < 20 || rect.height < 10) return false;
    const style = getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
  };

  const agent = {
    version: 3,
    _added: [],
    _observer: null,

    /** 输入框：优先已知 id，其次「最大的可见 textarea」，最后 contenteditable。 */
    input() {
      const byId = document.querySelector('#chat-input');
      if (visible(byId)) return byId;

      const areas = [...document.querySelectorAll('textarea')].filter(visible);
      if (areas.length) {
        return areas.sort((a, b) => {
          const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
          return rb.width * rb.height - ra.width * ra.height;
        })[0];
      }

      const editables = [...document.querySelectorAll('[contenteditable="true"]')].filter(visible);
      return editables[0] || null;
    },

    /** 未登录时页面上只有登录表单，没有输入框。 */
    status() {
      const input = this.input();
      const hasPassword = !!document.querySelector('input[type="password"]');
      const loginish = hasPassword || /sign[_-]?in|login/i.test(location.pathname);
      return {
        url: location.href,
        title: document.title,
        hasInput: !!input,
        needLogin: !input && loginish,
        ready: !!input,
      };
    },

    setText(text) {
      const el = this.input();
      if (!el) return false;
      el.focus();
      if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
        const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        // React 受控组件只认原生 setter 触发的 input 事件，直接赋值会被下一次渲染覆盖。
        const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
        setter.call(el, text);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        el.textContent = '';
        document.execCommand('insertText', false, text);
        el.dispatchEvent(new InputEvent('input', { bubbles: true }));
      }
      return true;
    },

    /** 开始记录「发送之后页面上新长出来的节点」。 */
    watch() {
      this.unwatch();
      this._added = [];
      const seen = new Set();
      this._observer = new MutationObserver((records) => {
        for (const record of records) {
          for (const node of record.addedNodes) {
            if (node.nodeType !== 1 || seen.has(node)) continue;
            seen.add(node);
            this._added.push(node);
          }
        }
      });
      this._observer.observe(document.body, { childList: true, subtree: true });
      return true;
    },

    unwatch() {
      if (this._observer) this._observer.disconnect();
      this._observer = null;
      return true;
    },

    send() {
      const el = this.input();
      if (!el) return false;
      el.focus();
      // DeepSeek 网页版是回车发送。回车比找发送按钮稳，按钮的 DOM 一直在变。
      for (const type of ['keydown', 'keypress', 'keyup']) {
        el.dispatchEvent(new KeyboardEvent(type, {
          key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
          bubbles: true, cancelable: true, composed: true,
        }));
      }
      return true;
    },

    /**
     * 当前这轮回复的文本 = 新增节点里文本最长的那个。
     * 侧栏的会话标题之类也会被记进来，但它们文本很短，天然被过滤掉。
     */
    reply() {
      let best = '';
      for (const node of this._added) {
        if (!node.isConnected) continue;
        const text = (node.innerText || '').trim();
        if (text.length > best.length) best = text;
      }
      return { text: best, nodes: this._added.length };
    },

    /** 自检：把当前页面的关键状态一次性倒出来，用于设置页的「桥接自检」。 */
    probe() {
      const input = this.input();
      return {
        ...this.status(),
        inputTag: input ? input.tagName.toLowerCase() : null,
        inputId: input ? (input.id || null) : null,
        textareas: document.querySelectorAll('textarea').length,
        editables: document.querySelectorAll('[contenteditable="true"]').length,
        bodyChars: (document.body.innerText || '').length,
      };
    },

    /** 自定义背景：把注入的样式集中在一个 <style> 里，改一次覆盖一次。 */
    applyBackground({ dataUrl, dim = 0.45, blur = 0 }) {
      const ID = '__tbx_bg';
      let style = document.getElementById(ID);
      if (!style) {
        style = document.createElement('style');
        style.id = ID;
        document.documentElement.appendChild(style);
      }
      if (!dataUrl) { style.textContent = ''; return true; }
      style.textContent = [
        'html{background-image:url("' + dataUrl + '") !important;background-size:cover !important;',
        'background-position:center center !important;background-attachment:fixed !important;}',
        'html::before{content:"";position:fixed;inset:0;z-index:0;pointer-events:none;',
        'background:rgba(8,10,14,' + dim + ');backdrop-filter:blur(' + blur + 'px);}',
        // 把站点自己的实心底色掀掉，否则背景图会被整片盖住。
        'body,#root,#app,#__next{background:transparent !important;}',
        'body *:not(img):not(svg):not(canvas):not(video){background-color:transparent !important;}',
        // 掀完之后气泡/输入框会失去边界，补一层半透明玻璃让文字仍然可读。
        'textarea,input,[contenteditable="true"]{background-color:rgba(20,24,32,.55) !important;}',
      ].join('');
      return true;
    },
  };

  window.__tbx = agent;
  return 'installed';
})()
`;
