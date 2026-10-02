const LIMITS = { L: 60, T: 100, E: 40 };
const CATEGORIES = { L: '学习', T: '工具', E: '娱乐' };
export function validateCatalog(rows) {
  if (!Array.isArray(rows) || rows.length > 200) throw new Error('功能目录无效');
  const ids = new Set();
  return rows.map((row) => {
    const match = typeof row?.id === 'string' && row.id.match(/^([LTE])(\d{3})$/);
    if (!match || Number(match[2]) < 1 || Number(match[2]) > LIMITS[match[1]] || ids.has(row.id)) throw new Error('功能编号无效或重复');
    if (row.category !== CATEGORIES[match[1]]) throw new Error('功能分类无效');
    for (const [key, max] of [['title', 80], ['group', 80], ['description', 500]]) {
      if (typeof row[key] !== 'string' || !row[key].trim() || row[key].length > max) throw new Error(`功能 ${key} 无效`);
    }
    ids.add(row.id);
    return { id: row.id, category: row.category, group: row.group, title: row.title, description: row.description };
  });
}
export function filterFeatures(rows, { category = '全部', group = '全部', query = '', favorites = null } = {}) {
  const words = String(query).trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter((row) => (category === '全部' || row.category === category)
    && (group === '全部' || row.group === group)
    && (!favorites || favorites.includes(row.id))
    && words.every((word) => `${row.id} ${row.title} ${row.group} ${row.description}`.toLocaleLowerCase().includes(word)));
}
export function recentFeatures(previous, id, max = 12) {
  return [id, ...(Array.isArray(previous) ? previous : [])].filter((value, index, rows) => typeof value === 'string' && rows.indexOf(value) === index).slice(0, max);
}
