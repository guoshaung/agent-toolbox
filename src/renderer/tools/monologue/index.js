import { h, toast } from '../../core/ui.js';

/**
 * 内心独白：设置面板。
 *
 * 真正显示解读的是那个常驻浮窗（src/monologue），这一页只管配置和校准。
 * 校准这件事躲不掉 —— 微信窗口是多栏的，而且布局随窗口宽度变，
 * 硬猜聊天区在哪一定会把会话列表当成对方说的话（实测翻过车）。
 * 所以给两个滑块，拖一次存下来，之后就一直准。
 */
export default {
  id: 'monologue',
  title: '内心独白',
  icon: 'brain',
  hint: '选中一句话，拆出对方真正想说什么',

  create(root) {
    let status = {};

    const statusTag = h('span', { class: 'tag' }, '未启动');
    const showBtn = h('button', { class: 'btn btn--sm btn--primary', onclick: async () => { await window.toolbox.monologue.show(); toast('浮窗已经出来了，拖到你顺手的位置', 'good', 3000); } }, '打开浮窗');

    // ---------- 模板 ----------
    const tplRow = h('div', { class: 'mono__tpls' });
    async function loadTemplates() {
      const list = await window.toolbox.monologue.templates();
      tplRow.replaceChildren(...list.map((t) => h('button', {
        class: `mono__tpl${t.id === status.template ? ' is-on' : ''}`,
        onclick: async () => { await window.toolbox.monologue.setTemplate(t.id); await refresh(); },
      },
        h('span', { class: 'mono__tpl-icon' }, t.icon),
        h('span', {}, h('strong', {}, t.name), h('span', { class: 'faint' }, t.desc)),
      )));
    }

    // ---------- 自动模式校准 ----------
    const appInput = h('input', {
      class: 'field field--sm', value: '微信', style: { maxWidth: '160px' },
      onchange: () => window.toolbox.monologue.set({ app: appInput.value.trim() || '微信' }),
    });
    const leftRange = h('input', { class: 'mono__range', type: 'range', min: '0', max: '0.8', step: '0.01', value: '0.3' });
    const rightRange = h('input', { class: 'mono__range', type: 'range', min: '0.2', max: '1', step: '0.01', value: '1' });
    const leftLabel = h('span', { class: 'faint mono__num' }, '0.30');
    const rightLabel = h('span', { class: 'faint mono__num' }, '1.00');
    const preview = h('div', { class: 'mono__preview' }, h('div', { class: 'faint' }, '点「试读一次」看看分得对不对。'));

    async function pushRange() {
      leftLabel.textContent = Number(leftRange.value).toFixed(2);
      rightLabel.textContent = Number(rightRange.value).toFixed(2);
      await window.toolbox.monologue.set({ chatLeft: Number(leftRange.value), chatRight: Number(rightRange.value) });
    }
    leftRange.oninput = pushRange;
    rightRange.oninput = pushRange;

    const peekBtn = h('button', { class: 'btn btn--sm', onclick: async () => {
      preview.replaceChildren(h('div', { class: 'faint' }, '正在截窗口 + OCR…'));
      const result = await window.toolbox.monologue.peek();
      if (!result.ok) {
        preview.replaceChildren(
          h('div', { class: 'mono__err' }, result.error || '读不到'),
          result.code === 'no-permission' ? h('div', { class: 'mono__row' },
            h('span', { class: 'faint' }, '系统设置 → 隐私与安全性 → 屏幕录制，勾上「Agent 工具箱」，然后重启工具箱。'),
            h('button', { class: 'btn btn--sm', onclick: () => window.toolbox.monologue.openScreenPerm() }, '打开设置'),
          ) : null,
        );
        return;
      }
      preview.replaceChildren(
        h('div', { class: 'faint mono__preview-head' }, `从「${result.app}」读到最后 ${result.messages.length} 条 —— 左右分对了吗？`),
        ...result.messages.map((m) => h('div', { class: `mono__line is-${m.side}` },
          h('span', { class: 'mono__who' }, m.side === 'them' ? '对方' : '我'),
          h('span', {}, m.text.slice(0, 60)))),
      );
    } }, '试读一次');

    const overlayBtn = h('button', { class: 'btn btn--sm btn--primary', onclick: async () => {
      if (status.overlay) { await window.toolbox.monologue.stopOverlay(); }
      else {
        await window.toolbox.monologue.startOverlay();
        toast('覆盖层开了 —— 切到微信看看，卡片会贴在对方消息旁边', 'good', 5000);
        // 第一次截图要几秒；没权限的话什么都不会出现，这里把原因说出来
        setTimeout(async () => {
          const s = await window.toolbox.monologue.status();
          if (!s.lastError) return;
          toast(s.lastError, 'bad', 8000);
          overlayHint.replaceChildren(
            h('span', { class: 'faint' }, s.lastError),
            h('button', { class: 'btn btn--sm', onclick: () => window.toolbox.monologue.openScreenPerm() }, '打开设置'),
          );
          overlayHint.hidden = false;
        }, 3500);
      }
      await refresh();
    } }, '贴到微信上');

    const whoSel = h('select', { class: 'field field--sm', onchange: () => window.toolbox.monologue.set({ who: whoSel.value }) },
      ...['她', '他', 'TA'].map((w) => h('option', { value: w }, w)));
    const overlayHint = h('div', { class: 'mono__row', hidden: true });

    const watchBtn = h('button', { class: 'btn btn--sm', onclick: async () => {
      if (status.watching) { await window.toolbox.monologue.stopWatch(); }
      else { await window.toolbox.monologue.startWatch(); toast('开始盯着聊天窗口了', 'good'); }
      await refresh();
    } }, '开始自动盯');

    async function refresh() {
      status = await window.toolbox.monologue.status();
      statusTag.textContent = status.watching ? '自动盯着' : '待命';
      statusTag.className = `tag ${status.watching ? 'tag--good' : ''}`;
      watchBtn.textContent = status.watching ? '停止自动盯' : '只盯最新一条';
      overlayBtn.textContent = status.overlay ? '收起覆盖层' : '贴到微信上';
      overlayBtn.classList.toggle('btn--primary', !status.overlay);
      appInput.value = status.app || '微信';
      whoSel.value = status.who || '她';
      leftRange.value = String(status.chatLeft ?? 0.3);
      rightRange.value = String(status.chatRight ?? 1);
      leftLabel.textContent = Number(leftRange.value).toFixed(2);
      rightLabel.textContent = Number(rightRange.value).toFixed(2);
      await loadTemplates();
    }

    root.append(
      h('div', { class: 'bar bar--drag' },
        h('strong', {}, '内心独白'),
        h('span', { class: 'faint' }, '选中一句话 → ⌘⇧M'),
        h('span', { style: { flex: 1 } }),
        statusTag, showBtn,
      ),
      h('div', { class: 'settings__body' },
        h('section', { class: 'card' },
          h('h3', { class: 'card__title' }, '怎么用'),
          h('p', { class: 'faint settings__hint' },
            '在微信（或任何应用）里选中对方那句话，按 ⌘⇧M，浮窗里就出解读。浮窗不抢焦点，微信那边不会失焦。'),
          h('p', { class: 'faint settings__hint' },
            '要先在「设置」里配好 AI（Base URL + 模型 + API Key）。想用 JEV：Base URL 填 https://openrouter.ai/api/v1，模型填 typesafe/jev-1.13。'),
        ),
        h('section', { class: 'card' },
          h('h3', { class: 'card__title' }, '解读模板'),
          h('p', { class: 'faint settings__hint' }, '不同场景问的问题不一样。'),
          tplRow,
        ),
        h('section', { class: 'card' },
          h('h3', { class: 'card__title' }, '贴在微信上（覆盖层）'),
          h('p', { class: 'faint settings__hint' },
            '每隔几秒截一次窗口、OCR 出最新一条对方消息，变了就自动分析。需要「屏幕录制」权限。'),
          h('div', { class: 'mono__row' }, h('span', { class: 'faint' }, '盯哪个应用'), appInput, h('span', { class: 'faint' }, '对方是'), whoSel, overlayBtn, watchBtn, peekBtn),
          overlayHint,
          h('p', { class: 'faint settings__hint' },
            '「贴到微信上」= 透明覆盖层，卡片直接画在对方每条消息旁边，跟着窗口移动和滚动走，鼠标完全穿透。'
            + '微信不在前台时自动隐藏。做不到真的嵌进微信（那要往它进程里注入代码，会被封号），但看着是一回事。'),
          h('p', { class: 'faint settings__hint' },
            '微信窗口是多栏的（图标条 + 会话列表 + 聊天区，有时右边还有面板），得把聊天区框出来：'),
          h('div', { class: 'mono__row' }, h('span', { class: 'faint mono__lbl' }, '聊天区左边界'), leftRange, leftLabel),
          h('div', { class: 'mono__row' }, h('span', { class: 'faint mono__lbl' }, '聊天区右边界'), rightRange, rightLabel),
          preview,
        ),
        h('section', { class: 'card' },
          h('h3', { class: 'card__title' }, '说明'),
          h('p', { class: 'faint settings__hint' },
            '只读屏幕和你选中的文字，不碰微信进程、不自动发消息。但要知道：选中的内容会发给你配的那个模型，'
            + '所以别拿它分析真正私密的东西。另外模型从一句话猜意图本来就不准，当个参考，别当依据。'),
        ),
      ),
    );

    refresh();
    return { activate: () => refresh() };
  },
};
