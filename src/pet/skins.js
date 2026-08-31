/** 内置皮肤注册表：新增原创皮肤只需放入 assets 并在这里登记。 */
export const PET_SKINS = [
  { id: 'study-buddy', name: '蓝白学习助手', note: '原创内置 · 透明背景', src: 'assets/study-buddy.svg' },
];

export function resolveSkin(settings) {
  if (settings.skin === 'custom' && settings.customSkin?.dataUrl) return settings.customSkin.dataUrl;
  return PET_SKINS.find((skin) => skin.id === settings.skin)?.src || PET_SKINS[0].src;
}
