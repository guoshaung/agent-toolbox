const MAX_HISTORY = 12;

export function searchHistoryKey(entry) {
  return [entry.query, entry.yearFrom, entry.yearTo, entry.openAccessOnly ? 'open' : 'all'].join('|');
}

export function pushSearchHistory(entries, entry, limit = MAX_HISTORY) {
  const query = String(entry?.query || '').trim();
  if (!query) return Array.isArray(entries) ? entries.slice(0, limit) : [];
  const next = {
    query,
    yearFrom: Number(entry.yearFrom) || 0,
    yearTo: Number(entry.yearTo) || 0,
    openAccessOnly: Boolean(entry.openAccessOnly),
    savedAt: Number(entry.savedAt) || Date.now(),
  };
  const previous = Array.isArray(entries) ? entries : [];
  return [next, ...previous.filter((item) => searchHistoryKey(item) !== searchHistoryKey(next))].slice(0, limit);
}
