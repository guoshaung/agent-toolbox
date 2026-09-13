export function annotationSearchText(item = {}) {
  return [
    item.quote,
    item.note,
    item.selected_text,
    item.translated_text,
    item.tag,
    item.highlight_type,
  ].filter(Boolean).join(' ');
}

export function annotationMatches(item, query) {
  const needle = String(query || '').trim().toLocaleLowerCase();
  if (!needle) return true;
  return annotationSearchText(item).toLocaleLowerCase().includes(needle);
}

export function annotationAnchor(item = {}) {
  const paragraphId = item.paragraphId || item.paragraph_id || '';
  const page = Number(item.page) || null;
  return { paragraphId, page };
}
