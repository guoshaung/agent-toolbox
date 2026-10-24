'use strict';
const query = new URLSearchParams(location.search);
const color = (key, fallback) => /^#[a-f0-9]{6}$/i.test(query.get(key) || '') ? query.get(key) : fallback;
const tint = color('tint', '#1a2442'), accent = color('accent', '#8fb4ff');
const channels = [1, 3, 5].map(offset => parseInt(tint.slice(offset, offset + 2), 16));
const alpha = query.has('opacity') && Number.isFinite(Number(query.get('opacity'))) ? Math.max(.15, Math.min(1, Number(query.get('opacity')) / 100)) : .72;
const solid = query.get('material') === 'none';
document.documentElement.style.setProperty('--tint', `rgba(${channels.join(',')},${solid ? 1 : alpha})`);
document.documentElement.style.setProperty('--accent', accent);
if (channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722 > 160) {
  document.documentElement.style.setProperty('--ink', '#182236');
  document.documentElement.style.setProperty('--muted', '#3c4c62');
  document.documentElement.style.colorScheme = 'light';
}
const labels = { mica: 'Windows 云母', acrylic: 'Windows 亚克力', none: '纯色对照' };
document.querySelector('#material').textContent = labels[query.get('material')] || labels.none;
document.querySelector('#name').textContent = (query.get('name') || '我的主题').slice(0, 60);
document.querySelector('#description').textContent = solid ? '纯色底色作为材质效果的对照。' : '此窗口已请求 Windows 合成器绘制原生材质。移动窗口，观察系统背景的变化。';
document.querySelector('#note').textContent = query.get('effect') === 'glass' ? '玻璃配方使用 Windows 亚克力作原生预览。模糊强度由系统控制，与上方的 CSS 搭配预览会有差异。' : '材质表现取决于系统、节能与透明效果设置；不透明度 100% 会遮住材质。';
document.querySelector('#close').addEventListener('click', () => window.close());
document.addEventListener('keydown', event => { if (event.key === 'Escape') window.close(); });
