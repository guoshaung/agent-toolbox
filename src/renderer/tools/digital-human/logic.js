export const PERSONAS = [
  { id: 'researcher', label: '研究员', intro: '用清晰、克制的方式解释问题、方法和证据。' },
  { id: 'advisor', label: '导师', intro: '先指出关键假设，再提醒容易忽略的限制。' },
  { id: 'labmate', label: '实验搭档', intro: '像一起做实验的同学，优先讲可复现的步骤。' },
];

export const AVATARS = [
  { id: 'crystal', label: '晶石研究员', shortLabel: 'CRYSTAL', description: '冷静、清晰的主讲形象。' },
  { id: 'mentor', label: '学术导师', shortLabel: 'MENTOR', description: '带眼镜的严谨讲解形象。' },
  { id: 'labmate', label: '实验搭档', shortLabel: 'LABMATE', description: '更轻松、更有亲和力的实验伙伴。' },
  { id: 'robot', label: '实验机器人', shortLabel: 'ROBOT', description: '适合讲流程、代码和实验步骤。' },
];

export function speechSegments(text, maxLength = 120) {
  const normalized = String(text || '').replace(/\r/g, '').trim();
  if (!normalized) return [];
  const lines = normalized.split(/\n+/).flatMap((line) => line.split(/(?<=[。！？.!?；;])\s*/u));
  const result = [];
  for (const line of lines) {
    let value = line.trim();
    while (value.length > maxLength) {
      const cut = Math.max(value.lastIndexOf('，', maxLength), value.lastIndexOf(',', maxLength), value.lastIndexOf(' ', maxLength));
      const at = cut >= Math.floor(maxLength * 0.55) ? cut + 1 : maxLength;
      result.push(value.slice(0, at).trim());
      value = value.slice(at).trim();
    }
    if (value) result.push(value);
  }
  return result;
}

export function deckToSpeech(deck = {}) {
  const slides = Array.isArray(deck.slides) ? deck.slides : [];
  return slides.flatMap((slide, index) => {
    const title = String(slide.title || `第 ${index + 1} 页`).trim();
    const body = [slide.subtitle, ...(Array.isArray(slide.bullets) ? slide.bullets : []), slide.notes]
      .map((item) => String(item || '').trim()).filter(Boolean).join('。');
    return speechSegments(`${title}。${body}`);
  });
}

export function personaById(id) {
  return PERSONAS.find((persona) => persona.id === id) || PERSONAS[0];
}

export function avatarById(id) {
  return AVATARS.find((avatar) => avatar.id === id) || AVATARS[0];
}
