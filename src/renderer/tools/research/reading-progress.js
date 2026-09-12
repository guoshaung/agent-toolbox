export function clampProgress(value) {
  const numeric = Number(value);
  return Math.max(0, Math.min(1, Number.isFinite(numeric) ? numeric : 0));
}

export function scrollProgress({ scrollTop = 0, scrollHeight = 0, clientHeight = 0 } = {}) {
  const maxScroll = Math.max(0, Number(scrollHeight) - Number(clientHeight));
  if (!maxScroll) return 0;
  return clampProgress(Number(scrollTop) / maxScroll);
}

export function scrollTopForProgress(progress, scrollHeight, clientHeight) {
  const maxScroll = Math.max(0, Number(scrollHeight) - Number(clientHeight));
  return Math.round(clampProgress(progress) * maxScroll);
}

export function visiblePage(pageOffsets = [], scrollTop = 0, viewportHeight = 0) {
  const anchor = Number(scrollTop) + Math.max(0, Number(viewportHeight)) * 0.28;
  let page = 1;
  for (const entry of pageOffsets) {
    if (!entry || Number(entry.offset) > anchor) break;
    const candidate = Number(entry.page);
    if (Number.isInteger(candidate) && candidate > 0) page = candidate;
  }
  return page;
}

export function progressLabel({ progress = 0, page = 0, pageCount = 0 } = {}) {
  const percent = Math.round(clampProgress(progress) * 100);
  if (percent >= 100) return '已读';
  if (pageCount > 0 && page > 0) return percent ? `${percent}% · 第 ${page}/${pageCount} 页` : `未开始 · 第 ${page}/${pageCount} 页`;
  return percent ? `阅读 ${percent}%` : '未开始';
}
