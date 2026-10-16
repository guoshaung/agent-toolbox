// Hand-authored drawing topics. Aliases are exact common names, never fuzzy alternatives.
export const WORDS = Object.freeze([
  ['自行车', '单车', '脚踏车'], ['雨伞', '伞'], ['台灯', '桌灯'], ['闹钟'], ['雪人'], ['彩虹'], ['火山'], ['月亮', '月球'],
  ['太阳', '日头'], ['星星'], ['篮球'], ['足球'], ['飞机'], ['轮船'], ['火车', '列车'], ['风筝', '纸鸢'],
  ['气球'], ['眼镜'], ['剪刀'], ['牙刷'], ['钥匙'], ['苹果'], ['香蕉'], ['西瓜'], ['草莓'], ['菠萝'],
  ['胡萝卜'], ['蘑菇'], ['面包'], ['蛋糕'], ['冰淇淋'], ['饺子'], ['汤圆'], ['筷子'], ['勺子', '汤匙'],
  ['帽子'], ['手机', '移动电话'], ['电脑', '计算机'], ['冰箱', '电冰箱'], ['手电筒', '电筒'],
].map(([target, ...aliases], i) => Object.freeze({ id: `W${String(i + 1).padStart(3, '0')}`, target, aliases: Object.freeze(aliases) })));

export function normalizeAnswer(text) {
  if (typeof text !== 'string' || text.length > 32 || /[\u0000-\u001f\u007f]/.test(text)) throw new RangeError('猜测须为 1–32 个字符，不能包含控制字符。');
  const result = text.normalize('NFKC').replace(/\s+/gu, '').toLowerCase();
  if (!result || result.length > 32) throw new RangeError('请输入 1–32 个字符的猜测。');
  return result;
}

const owners = new Map();
for (const word of WORDS) for (const label of [word.target, ...word.aliases]) {
  const key = normalizeAnswer(label);
  if (owners.has(key)) throw new Error(`词题名称或别名冲突：${label}`);
  owners.set(key, word.id);
}
export function matchesWord(word, text) { return owners.get(normalizeAnswer(text)) === word.id; }
