import { h, toast } from '../../core/ui.js';
import { PAGE_AGENT } from '../../core/page-agent.js';
import { DEEPSEEK_URL, DEEPSEEK_PARTITION } from '../../core/deepseek-bridge.js';

/** 背景图先压到这个尺寸再存，原图动辄几十 MB，塞进配置文件不合适。 */
const MAX_EDGE = 2560;
const JPEG_QUALITY = 0.82;

async function downscale({ base64, mime }) {
  const source = `data:${mime};base64,${base64}`;
  const img = await new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('这个图片解不开，换一张试试'));
    image.src = source;
  });

  const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
  if (scale === 1 && base64.length < 1_500_000) return source; // 本来就不大，省一次重编码

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
}

export default {
  id: 'ask',
  title: '快问',
  icon: '⚡',
  hint: 'DeepSeek 网页版，常驻热会话（Cmd+1）',

  create(root, ctx) {
    const { config } = ctx;

    const view = h('webview', {
      partition: DEEPSEEK_PARTITION,
      src: DEEPSEEK_URL,
    });

    const quick = h('input', {
      class: 'field',
      placeholder: '直接在这里问，回车发送 —— 不用先点进去',
      onkeydown: async (e) => {
        if (e.key !== 'Enter' || e.isComposing) return;
        const text = quick.value.trim();
        if (!text) return;
        try {
          await inject();
          const ok = await view.executeJavaScript(`window.__tbx.setText(${JSON.stringify(text)})`, true);
          if (!ok) return toast('页面还没准备好（可能需要先登录）', 'bad');
          await new Promise((r) => setTimeout(r, 120));
          await view.executeJavaScript('window.__tbx.send()', true);
          quick.value = '';
        } catch (err) {
          toast(`发送失败：${err.message}`, 'bad');
        }
      },
    });

    // ---- 背景设置面板 ----
    const bgName = h('span', { class: 'faint' }, config.get('ask.bg.name') || '未设置');
    const dim = h('input', {
      type: 'range', min: '0', max: '0.9', step: '0.05',
      value: String(config.get('ask.bg.dim', 0.45)),
      oninput: () => { config.set('ask.bg.dim', Number(dim.value)); applyBackground(); },
    });
    const blur = h('input', {
      type: 'range', min: '0', max: '24', step: '1',
      value: String(config.get('ask.bg.blur', 0)),
      oninput: () => { config.set('ask.bg.blur', Number(blur.value)); applyBackground(); },
    });

    const panel = h('div', { class: 'subbar', hidden: true },
      h('button', {
        class: 'btn btn--sm',
        onclick: async () => {
          const picked = await window.toolbox.files.pickImage();
          if (!picked) return;
          if (picked.error) return toast(picked.error, 'bad');
          try {
            const dataUrl = await downscale(picked);
            await config.set('ask.bg.dataUrl', dataUrl);
            await config.set('ask.bg.name', picked.name);
            bgName.textContent = picked.name;
            await applyBackground();
            toast('背景已换。觉得字看不清就把「暗度」拉高一点。', 'good');
          } catch (err) {
            toast(err.message, 'bad');
          }
        },
      }, '选择图片…'),
      bgName,
      h('span', { class: 'subbar__sep' }),
      h('label', { class: 'subbar__label' }, '暗度', dim),
      h('label', { class: 'subbar__label' }, '模糊', blur),
      h('button', {
        class: 'btn btn--sm btn--ghost',
        onclick: async () => {
          await config.set('ask.bg.dataUrl', undefined);
          await config.set('ask.bg.name', undefined);
          bgName.textContent = '未设置';
          await applyBackground();
        },
      }, '清除背景'),
    );

    const bar = h('div', { class: 'bar bar--drag' },
      h('button', {
        class: 'btn btn--icon', title: '新会话',
        onclick: () => view.loadURL(DEEPSEEK_URL),
      }, '＋'),
      h('button', {
        class: 'btn btn--icon', title: '刷新',
        onclick: () => view.reload(),
      }, '⟳'),
      quick,
      h('button', {
        class: 'btn btn--sm',
        onclick: () => panel.toggleAttribute('hidden'),
      }, '🖼 背景'),
    );

    root.append(bar, panel, view);

    let injected = false;
    async function inject() {
      if (injected) return;
      await view.executeJavaScript(PAGE_AGENT);
      injected = true;
    }

    async function applyBackground() {
      try {
        await inject();
        await view.executeJavaScript(`window.__tbx.applyBackground(${JSON.stringify({
          dataUrl: config.get('ask.bg.dataUrl') || '',
          dim: config.get('ask.bg.dim', 0.45),
          blur: config.get('ask.bg.blur', 0),
        })})`);
      } catch (err) {
        console.warn('[ask] 背景注入失败', err);
      }
    }

    // 每次导航后页面被重建，探针和背景都要重新打一遍
    view.addEventListener('dom-ready', async () => {
      injected = false;
      await applyBackground();
    });
    view.addEventListener('did-fail-load', (e) => {
      if (e.errorCode === -3) return;
      toast(`DeepSeek 加载失败：${e.errorDescription}`, 'bad');
    });

    return {
      activate: () => setTimeout(() => quick.focus(), 30),
    };
  },
};
