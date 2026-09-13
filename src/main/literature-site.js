'use strict';

function sameLibrarySite(left, right) {
  try {
    const a = new URL(String(left || ''));
    const b = new URL(String(right || ''));
    if (!['https:', 'http:'].includes(a.protocol) || !['https:', 'http:'].includes(b.protocol)) return false;
    if (a.hostname === b.hostname) return true;
    const isCnkiHost = (hostname) => hostname === 'cnki.net' || hostname.endsWith('.cnki.net');
    return isCnkiHost(a.hostname) && isCnkiHost(b.hostname);
  } catch {
    return false;
  }
}

module.exports = { sameLibrarySite };
