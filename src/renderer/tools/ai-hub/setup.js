import { h, toast } from '../../core/ui.js';

export function createAiHubSetup({ api, getGateway, applyGateway }) {
  let peer = null;
  let role = 'server';
  let chosenRole = false;
  let busy = false;

  const toggle = h('button', { class: 'btn btn--sm btn--ghost', onclick: () => {
    panel.hidden = !panel.hidden;
    if (!panel.hidden) { panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); void load(); }
  } }, '跨设备配置');
  const panel = h('section', { class: 'card aihub__setup', hidden: true, 'aria-label': '跨设备配置' });
  const lead = h('p', { class: 'faint' }, '这台电脑可以提供额度、使用另一台电脑的额度，也可以同时做两件事。SSH 隧道由你现有的连接方式维持，这里负责检测与接入。');
  const roleButtons = ['server', 'client', 'both'].map((id, i) => h('button', { class: 'aihub__role', type: 'button', onclick: async () => {
    role = id; chosenRole = true;
    paint();
    if (id === 'both' && ['18878', '18880'].includes(port.value) && peer?.baseUrl?.startsWith('http://127.0.0.1:18878/')) {
      const result = await api.suggestPort();
      if (role === id && result?.ok && Number.isInteger(result.port)) { port.value = result.port; paint(); }
      else if (role === id) notice.textContent = result?.error || '请手动选择空闲端口';
    }
  } }, ['提供服务', '使用服务', '两者都做'][i]));
  const server = h('div', { class: 'aihub__setup-section' });
  const client = h('div', { class: 'aihub__setup-section' });
  const notice = h('p', { class: 'aihub__setup-notice', 'aria-live': 'polite' }, '选择角色后按顺序完成配置。');
  panel.append(h('div', { class: 'aihub__row' }, h('div', {}, h('h3', {}, '跨设备配置'), lead), h('span', { style: { flex: 1 } }), h('button', { class: 'btn btn--sm', onclick: () => { panel.hidden = true; } }, '收起')),
    h('div', { class: 'aihub__roles', role: 'group', 'aria-label': '这台电脑的角色' }, ...roleButtons), server, client, notice);

  const port = h('input', { class: 'field', type: 'number', min: 1024, max: 65535, value: 18878, 'aria-label': '本机网关端口' });
  const serverState = h('p', { class: 'faint' });
  const start = h('button', { class: 'btn btn--primary', onclick: () => action(async () => {
    const current = getGateway();
    const result = current?.running ? await api.stop() : await api.start(Number(port.value));
    if (!result?.ok) throw Error(result?.error || '网关操作失败');
    applyGateway(result); return current?.running ? '本机网关已停止' : '本机网关已启动';
  }) }, '启动本机网关');
  server.append(h('div', { class: 'aihub__setup-heading' }, h('strong', {}, '提供服务'), h('span', { class: 'faint' }, '把已启用的通道汇成一个 Chat Completions 接口')),
    h('div', { class: 'aihub__setup-grid' },
      h('label', { class: 'aihub__field' }, h('span', {}, '本机监听端口'), port),
      h('div', { class: 'aihub__setup-actions' }, start,
        h('button', { class: 'btn btn--sm', onclick: async () => { const url = getGateway()?.baseUrl; if (!url) return toast('先启动本机网关'); await window.toolbox.clipboard.write(url); toast('网关地址已复制', 'good'); } }, '复制地址'),
        h('button', { class: 'btn btn--sm', onclick: async () => { const result = await api.copyKey(); toast(result?.ok ? '网关密钥已复制' : result?.error || '请先启动网关', result?.ok ? 'good' : 'bad'); } }, '复制网关密钥'))),
    serverState, h('p', { class: 'faint' }, '让使用端通过已有隧道或 HTTPS 到达这个端口。密钥只通过“复制网关密钥”取得，页面不展示明文。'));

  const baseUrl = h('input', { class: 'field', value: 'http://127.0.0.1:18878/v1', spellcheck: false, 'aria-label': '对方额度中枢 Base URL' });
  const key = h('input', { class: 'field', type: 'password', autocomplete: 'new-password', spellcheck: false, placeholder: '填入对方网关密钥', 'aria-label': '对方网关密钥' });
  const show = h('button', { class: 'btn btn--sm', type: 'button', onclick: () => { key.type = key.type === 'password' ? 'text' : 'password'; show.textContent = key.type === 'password' ? '显示' : '隐藏'; } }, '显示');
  const connection = h('p', { class: 'faint' }, '尚未检测对方网关。');
  const models = h('div', { class: 'aihub__setup-models' });
  const dsh = h('p', { class: 'faint' }, '正在检查 DSH…');
  const useOwn = h('button', { class: 'btn btn--sm', onclick: () => {
    const url = getGateway()?.baseUrl;
    if (!url) return toast('先启动本机网关');
    baseUrl.value = url; toast('已填入本机网关地址', 'good');
  } }, '使用本机网关地址');

  const check = h('button', { class: 'btn btn--sm', onclick: () => action(connect) }, '检测并保存');
  const test = h('button', { class: 'btn btn--sm', onclick: () => action(testText) }, '短文本测试（消耗额度）');
  const install = h('button', { class: 'btn btn--sm', onclick: () => action(installDsh) }, '接入并重启 DSH');
  const all = h('button', { class: 'btn btn--primary', onclick: () => action(async () => {
    await connect(); await testText();
    if (peer?.dsh?.available) await installDsh();
    return peer?.dsh?.available ? '地址、文本调用和 DSH 接入均已完成' : '地址与文本调用已完成；本机未发现 DSH';
  }) }, '一键完成（含一次测试）');
  client.append(h('div', { class: 'aihub__setup-heading' }, h('strong', {}, '使用服务'), h('span', { class: 'faint' }, '检测已有隧道，再接入本机 DSH')),
    h('div', { class: 'aihub__setup-grid' },
      h('label', { class: 'aihub__field' }, h('span', {}, '对方 Base URL · Chat Completions'), baseUrl),
      h('label', { class: 'aihub__field' }, h('span', {}, '对方网关密钥'), h('div', { class: 'aihub__key-input' }, key, show))),
    h('div', { class: 'aihub__row aihub__setup-actions' }, useOwn, check, test, install, all), connection, models, dsh,
    h('p', { class: 'faint' }, '测试会消耗少量上游额度。接入 DSH 时，密钥还会写入 DSH 当前用户的凭据文件并备份旧配置。DSH 路由保留最近的纯文本对话上下文，不传工具、图片或文件；Responses API 客户端不能直接使用此 Chat Completions 地址。'));

  async function action(fn) {
    if (busy) return;
    busy = true; notice.textContent = '正在执行…'; paint();
    try { notice.textContent = await fn(); toast(notice.textContent, 'good'); }
    catch (error) { notice.textContent = error.message || '操作失败'; toast(notice.textContent, 'bad', 6000); }
    finally { busy = false; paint(); }
  }
  async function connect() {
    notice.textContent = '检查端口、密钥与 /v1/models…';
    const result = await api.peerConnect({ baseUrl: baseUrl.value.trim(), apiKey: key.value.trim() });
    if (!result?.ok) throw Error(result?.error || '对方网关不可用');
    peer = result; key.value = ''; key.type = 'password'; show.textContent = '显示'; paint();
    return `模型列表已验证：${result.models.length} 项，包含 auto`;
  }
  async function testText() {
    notice.textContent = '正在发送简短纯文本请求…';
    const result = await api.peerTest();
    if (!result?.ok) throw Error(result?.error || '短文本请求失败');
    peer = result; paint(); return `文本调用成功：${result.reply}`;
  }
  async function installDsh() {
    notice.textContent = '正在保存 DSH 配置并重启…';
    const result = await api.peerInstallDsh();
    if (!result?.ok) throw Error(result?.error || 'DSH 接入失败');
    peer = result; paint();
    return result.restartNeeded ? '已接入 DSH；请在 DSH 页面重新启动以生效' : 'DSH 已接入并重启；在模型菜单选“Toolbox 额度中枢（文本对话）→ Auto”';
  }
  async function load() {
    const result = await api.peerStatus();
    if (!result?.ok) { notice.textContent = result?.error || '无法读取使用端配置'; return; }
    peer = result;
    if (!chosenRole && result.dsh?.installed) role = 'client';
    if (result.baseUrl) baseUrl.value = result.baseUrl;
    paint();
  }
  function paint() {
    roleButtons.forEach((button, index) => {
      const selected = ['server', 'client', 'both'][index] === role;
      button.classList.toggle('aihub__role--active', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    server.hidden = role === 'client'; client.hidden = role === 'server'; useOwn.hidden = role !== 'both';
    const gateway = getGateway();
    serverState.textContent = gateway?.running ? `运行中 · ${gateway.baseUrl} · 可调度 ${gateway.channels.filter(c => c.ready).length} 个通道` : '尚未启动 · 需要先配置并启用至少一个通道';
    start.textContent = gateway?.running ? '停止本机网关' : '启动本机网关';
    port.disabled = Boolean(gateway?.running);
    connection.textContent = peer?.checkedAt ? `已验证 ${peer.baseUrl} · ${new Date(peer.checkedAt).toLocaleString()} · ${peer.hasKey ? '密钥已保存' : '缺少密钥'}` : peer?.hasKey ? '已有本机密钥；填写地址后可留空沿用。' : '填写对方地址和密钥后检测。';
    models.replaceChildren(...(peer?.models?.length ? peer.models.map(item => h('span', { class: 'aihub__setup-model' }, item.id === 'auto' ? 'auto' : item.name || item.id)) : []));
    dsh.textContent = !peer?.dsh?.available ? '本机未发现 DSH Web；仍可使用通用 Chat Completions 参数。' : peer.dsh.installed ? 'DSH 已接入 · 在模型菜单选择“Toolbox 额度中枢（文本对话）→ Auto”' : '已发现 DSH；检测与文本测试通过后可一键接入。';
    for (const button of [start, check, test, install, all]) button.disabled = busy;
    install.disabled = busy || !peer?.dsh?.available || !peer?.checkedAt;
    test.disabled = busy || !peer?.checkedAt;
  }
  paint();
  return { toggle, panel, paint, load };
}
