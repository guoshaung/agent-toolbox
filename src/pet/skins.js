/** 内置皮肤注册表：新增原创皮肤只需放入 assets 并在这里登记。 */
export const PET_SKINS = [
  { id: 'study-buddy', name: '蓝白学习助手', note: '原创内置 · 透明背景', src: 'assets/study-buddy.svg' },
  { id: 'neko-white', name: '白毛猫耳', note: '二次元 · 原创矢量', src: 'assets/neko-white.svg' },
  { id: 'sailor-blue', name: '蓝发双马尾', note: '二次元 · 水手服', src: 'assets/sailor-blue.svg' },
  { id: 'bunny-pink', name: '粉发兔耳', note: '二次元 · 卫衣', src: 'assets/bunny-pink.svg' },
  { id: 'glasses-dark', name: '黑发眼镜', note: '二次元 · 少年', src: 'assets/glasses-dark.svg' },
  { id: 'elf-gold', name: '金发精灵', note: '二次元 · 尖耳朵', src: 'assets/elf-gold.svg' },
  { id: 'fox-miko', name: '狐耳巫女', note: '二次元 · 橙发白尖耳、大尾巴', src: 'assets/fox-miko.svg' },
  { id: 'magical-violet', name: '紫发魔法少女', note: '二次元 · 双团子、星星魔杖', src: 'assets/magical-violet.svg' },
  { id: 'mecha-silver', name: '银发机娘', note: '二次元 · 耳机、瞄准环', src: 'assets/mecha-silver.svg' },
];

export function resolveSkin(settings) {
  if (settings.skin === 'custom' && settings.customSkin?.dataUrl) return settings.customSkin.dataUrl;
  return PET_SKINS.find((skin) => skin.id === settings.skin)?.src || PET_SKINS[0].src;
}
