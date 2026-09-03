'use strict';
/**
 * 站点登录墙绕过 preload（DOM + 主世界脚本注入）。
 *
 * 设计原则：
 *  1. 只删遮挡层、恢复滚动和复制，不伪造登录态、不改 cookie。
 *  2. 按 hostname 匹配，命中站点才动作。
 *  3. 对需要 JS 层绕过的站点（知乎点击劫持），往主世界注入 <script>。
 *  4. 运行在 contextIsolation=true 的 webview 里：隔离上下文安全，DOM/注入脚本完成实际绕过。
 */

(function () {
  if (window.__siteBypassInjected) return;
  window.__siteBypassInjected = true;
  const host = location.hostname.replace(/^www\./, '');
  const LOG = '[bypass:' + host + ']';
  console.log(LOG, 'preload loaded');

  function remove() {
    for (let i = 0; i < arguments.length; i++) {
      const sel = arguments[i];
      for (const el of document.querySelectorAll(sel)) el.remove();
    }
  }

  function hide() {
    for (let i = 0; i < arguments.length; i++) {
      const sel = arguments[i];
      for (const el of document.querySelectorAll(sel)) {
        el.style.setProperty('display', 'none', 'important');
        el.style.setProperty('visibility', 'hidden', 'important');
        el.style.setProperty('pointer-events', 'none', 'important');
      }
    }
  }

  function css(text) {
    const style = document.createElement('style');
    style.textContent = text;
    (document.head || document.documentElement).appendChild(style);
    return style;
  }

  function unlockScroll() {
    css('html, body { overflow: auto !important; position: static !important; } body { height: auto !important; touch-action: auto !important; } * { user-select: auto !important; -webkit-user-select: auto !important; }');
    document.documentElement.style.overflow = 'auto';
    if (document.body) document.body.style.overflow = 'auto';
  }

  function allowCopy() {
    const allow = (e) => { e.stopPropagation(); return true; };
    // 只拦"站点用来禁止复制/选中"的那几个事件。
    //
    // 这里原来还包含 mousedown —— 那是致命的：capture 阶段 stopPropagation
    // 会让事件根本到不了目标元素，页面里所有依赖 mousedown 的交互（现代 SPA
    // 的按钮、下拉、发送键几乎都是）全部失灵，表现就是"什么都点不动"。
    // 恢复选中靠下面 unlockScroll 里的 user-select: auto 就够了，不需要拦 mousedown。
    for (const ev of ['copy', 'cut', 'selectstart', 'contextmenu', 'dragstart']) {
      document.addEventListener(ev, allow, true);
    }
  }

  function watch(mutator) {
    const run = () => { try { mutator(); } catch (e) { console.error(LOG, 'watch error', e); } };
    run();
    let timer = null;
    const obs = new MutationObserver(() => {
      if (timer) return;
      timer = setTimeout(() => { timer = null; run(); }, 120);
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
  }

  function injectMainWorld(fn) {
    const script = document.createElement('script');
    script.textContent = '(' + fn.toString() + ')();';
    (document.head || document.documentElement).appendChild(script);
    script.remove();
  }

  const RULES = new Map();

  RULES.set('zhihu.com', () => {
    unlockScroll();
    allowCopy();
    css('.Modal-wrapper, .Modal-backdrop, .Modal { display: none !important; } [role="dialog"], [class*="SignFlow"], [class*="signFlow"], .ColumnLoginPrompt, .AppHeader-notice, .KfeCollection-VipRecommendCard, .Reward, .TopstoryItem--advertCard, .Pc-word, .zhiCustomBtn { display: none !important; } .Topstory-container, .Question-main, .Profile-main, .SearchResult-Card, .ContentItem { filter: none !important; -webkit-filter: none !important; } .ContentItem-action.is-disabled { pointer-events: auto !important; opacity: 1 !important; } html { overflow: auto !important; }');

    watch(() => {
      remove('.Modal-wrapper', '.Modal-backdrop', '.Modal', '.ColumnLoginPrompt', '.AppHeader-notice', '.KfeCollection-VipRecommendCard', '.zhiCustomBtn');
      hide('[role="dialog"]', '[class*="SignFlow"]', '[class*="signFlow"]');
      for (const el of document.querySelectorAll('.ContentItem-action.is-disabled')) el.classList.remove('is-disabled');
      for (const el of document.querySelectorAll('[style*="overflow: hidden"]')) {
        if (el.tagName === 'HTML' || el.tagName === 'BODY') el.style.overflow = 'auto';
      }
    });

    injectMainWorld(function () {
      'use strict';
      const isLoginUrl = (url) => /\/signin|login|oauth|unlogin/i.test(url || '');
      document.addEventListener('click', function (e) {
        const card = e.target.closest && e.target.closest('a[href*="/question/"], a[href*="/answer/"], a[href*="/video/"], a[href*="/p/"], .ContentItem, .HotItem, .TopstoryItem');
        if (!card) return;
        const link = card.closest && card.closest('a[href]');
        const href = link && link.getAttribute('href');
        if (href && !href.startsWith('javascript:') && !isLoginUrl(href)) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          location.href = link.href;
          return false;
        }
      }, true);

      const obs = new MutationObserver(() => {
        for (const el of document.querySelectorAll('.Modal-wrapper, .Modal-backdrop, [role="dialog"]')) {
          const html = el.innerHTML || '';
          if (/登录|注册|扫码|Sign|Login/i.test(html)) {
            el.remove();
            if (document.body) document.body.style.overflow = 'auto';
            document.documentElement.style.overflow = 'auto';
          }
        }
      });
      obs.observe(document.documentElement, { childList: true, subtree: true });
    });
  });

  RULES.set('csdn.net', () => {
    unlockScroll();
    allowCopy();
    css('.login-mark, .login-box, .hide-article-box, .blog_container_aside .aside-box a img, .recommend-box, .template-box, .type_hot_word, .csdn-side-toolbar, .user-desc, .vip-caise, .vip, .btn-readmore { display: none !important; } #article_content, #content_views, .blog_container_aside .article-list { height: auto !important; } #article_content, #content_views { user-select: auto !important; } .hljs-button { display: none !important; } .article-bar-top { filter: none !important; }');
    watch(() => {
      remove('.login-mark', '.login-box', '.hide-article-box', '.recommend-box', '.template-box', '.type_hot_word');
      for (const el of document.querySelectorAll('#article_content, #content_views')) {
        el.style.height = 'auto';
        el.style.userSelect = 'auto';
      }
    });
    injectMainWorld(function () {
      'use strict';
      document.addEventListener('copy', (e) => e.stopPropagation(), true);
      document.addEventListener('contextmenu', (e) => e.stopPropagation(), true);
      const obs = new MutationObserver(() => {
        for (const el of document.querySelectorAll('.login-mark, .login-box, .hide-article-box')) el.remove();
      });
      obs.observe(document.documentElement, { childList: true, subtree: true });
    });
  });

  RULES.set('qidian.com', () => {
    unlockScroll();
    allowCopy();
    css('.login-guide-wrap, .guide-box, .download-app, .wrap-bookinfo-intro .limit-free, .j_PayWall, .chapter-pay-wall, .vip-limit, .login-popup { display: none !important; }');
    watch(() => {
      remove('.login-guide-wrap', '.guide-box', '.download-app', '.j_PayWall', '.chapter-pay-wall', '.login-popup');
      hide('.vip-limit');
    });
  });

  RULES.set('tieba.baidu.com', () => {
    unlockScroll();
    allowCopy();
    css('.tieba-logo-ad, .dossier-form, .uiBubble, .app_ba_login, .j_app_compact, .open-app, .tbui_aside_floatbar, .pop-up, .pop-mask { display: none !important; }');
    watch(() => {
      remove('.dossier-form', '.app_ba_login', '.j_app_compact', '.open-app');
      hide('.uiBubble', '.tbui_aside_floatbar', '.pop-up', '.pop-mask');
    });
  });

  RULES.set('bilibili.com', () => {
    unlockScroll();
    allowCopy();
    // 评论接口由主进程在 bilibili 分区拦截；这里处理已经渲染出来的评论壳，
    // 避免它占用学习区首屏和滚动空间。
    css('.reply-list, .reply-box, .comment-container, .comment-list, .bili-comment, .video-page-special-comment, [class*="comment-container"], [class*="reply-list"] { display: none !important; }');
    watch(() => hide('.reply-list', '.reply-box', '.comment-container', '.comment-list', '.bili-comment', '.video-page-special-comment', '[class*="comment-container"]', '[class*="reply-list"]'));
  });

  RULES.set('douyin.com', () => {
    unlockScroll();
    allowCopy();
    css('.dy-account-btn, .login-guide, .guide-container, .download-guide, .verify-bar, .captcha-mask { display: none !important; }');
    watch(() => {
      remove('.login-guide', '.download-guide', '.verify-bar');
      hide('.dy-account-btn', '.guide-container', '.captcha-mask');
    });
  });

  RULES.set('jiqizhixin.com', () => {
    unlockScroll();
    allowCopy();
    css('.modal, .subscribe-popup, .login-popup, .paywall { display: none !important; }');
    watch(() => remove('.modal', '.subscribe-popup', '.login-popup', '.paywall'));
  });

  const runGeneral = () => {
    unlockScroll();
    allowCopy();
  };

  let matched = false;
  for (const [domain, fn] of RULES) {
    if (host === domain || host.endsWith('.' + domain)) {
      try { fn(); matched = true; console.log(LOG, 'rule applied'); } catch (e) { console.error(LOG, 'rule error', e); }
    }
  }
  if (!matched) {
    runGeneral();
    console.log(LOG, 'general rule applied');
  }
})();
