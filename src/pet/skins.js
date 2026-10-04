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
  { id: 'shark-hoodie', name: '鲨鱼连帽', note: '二次元 · 蓝白连帽衫、鳍和尾巴', src: 'assets/shark-hoodie.svg' },
  { id: 'imp-red', name: '小恶魔', note: '二次元 · 红角、蝠翼、尖尾', src: 'assets/imp-red.svg' },
  { id: 'angel-white', name: '天使', note: '二次元 · 光环、白翼', src: 'assets/angel-white.svg' },
  { id: 'maid-black', name: '女仆', note: '二次元 · 黑裙白头饰', src: 'assets/maid-black.svg' },
  { id: 'detective-brown', name: '侦探', note: '二次元 · 猎鹿帽、放大镜', src: 'assets/detective-brown.svg' },
  { id: 'pirate-red', name: '海盗', note: '二次元 · 三角帽、眼罩', src: 'assets/pirate-red.svg' },
  { id: 'dragon-teal', name: '龙娘', note: '二次元 · 龙角、龙尾', src: 'assets/dragon-teal.svg' },
  { id: 'vampire-violet', name: '吸血鬼', note: '二次元 · 小尖牙、披风', src: 'assets/vampire-violet.svg' },
  { id: 'witch-purple', name: '尖帽女巫', note: '二次元 · 尖顶帽、扫帚', src: 'assets/witch-purple.svg' },
  { id: 'panda-hoodie', name: '熊猫兜帽', note: '二次元 · 白兜帽、熊猫耳', src: 'assets/panda-hoodie.svg' },
  { id: 'idol-star', name: '星之偶像', note: '二次元 · 星星发饰、话筒', src: 'assets/idol-star.svg' },
  { id: 'samurai-red', name: '武士', note: '二次元 · 红头巾、佩刀', src: 'assets/samurai-red.svg' },
  { id: 'ghost-mint', name: '幽灵', note: '二次元 · 薄荷发、小幽灵', src: 'assets/ghost-mint.svg' },
];

export function resolveSkin(settings) {
  if (settings.skin === 'custom' && settings.customSkin?.dataUrl) return settings.customSkin.dataUrl;
  return PET_SKINS.find((skin) => skin.id === settings.skin)?.src || PET_SKINS[0].src;
}
