'use strict';
/**
 * 证书例外。
 *
 * 起因：不少国内学术站点证书配错（比如 www.cnki.net 的证书签的是
 * *.cdn.myqcloud.com，根本没覆盖自己的域名）。Chrome 遇到这种会弹警告页
 * 让人自己决定，而 Electron 的 webview 直接白屏，什么都不说。
 *
 * 做法上刻意保守：**不做全局关闭证书校验**，那等于把 App 里所有站点都暴露给中间人。
 * 只维护一份用户显式点过"仍然访问"的域名清单，命中才放行，其余照常拦截。
 */
const STORE_KEY = 'security.certAllowHosts';

function hostOf(url) {
  try { return new URL(url).host.toLowerCase(); } catch { return ''; }
}

function listAllowed(store) {
  const value = store.get(STORE_KEY);
  return Array.isArray(value) ? value : [];
}

/** 证书错误的人话解释。白屏最气人的地方是你不知道发生了什么 */
const CERT_REASON = {
  'net::ERR_CERT_COMMON_NAME_INVALID': '证书上的域名和你访问的域名对不上（站点自己配错了，常见于用了 CDN 但没绑域名）',
  'net::ERR_CERT_DATE_INVALID': '证书已过期或还没生效',
  'net::ERR_CERT_AUTHORITY_INVALID': '证书的颁发机构不被系统信任（也可能是网络里有中间设备在拦截）',
  'net::ERR_CERT_REVOKED': '证书已被吊销',
  'net::ERR_CERT_INVALID': '证书本身无效',
};

function describeCertError(error) {
  return CERT_REASON[error] || `证书校验没通过（${error}）`;
}

function registerCertTrust(app, ipcMain, { getStore, getWindow }) {
  // 证书出错时：只有用户显式放行过的域名才继续，其余保持拦截
  app.on('certificate-error', (event, _webContents, url, error, _certificate, callback) => {
    const host = hostOf(url);
    if (host && listAllowed(getStore()).includes(host)) {
      event.preventDefault();
      callback(true);
      return;
    }
    callback(false);
  });

  ipcMain.handle('cert:describe', (_e, error) => describeCertError(error));
  ipcMain.handle('cert:list', () => listAllowed(getStore()));

  /** 放行一个域名。调用方必须已经把风险讲清楚了 */
  ipcMain.handle('cert:allow', (_e, url) => {
    const host = hostOf(url);
    if (!host) return { ok: false, error: '地址无效' };
    const store = getStore();
    const list = listAllowed(store);
    if (!list.includes(host)) store.set(STORE_KEY, [...list, host]);
    return { ok: true, host };
  });

  ipcMain.handle('cert:revoke', (_e, host) => {
    const store = getStore();
    store.set(STORE_KEY, listAllowed(store).filter((x) => x !== String(host).toLowerCase()));
    return { ok: true };
  });
}

module.exports = { registerCertTrust, describeCertError, STORE_KEY };
