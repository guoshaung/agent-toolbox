import { h } from '../../core/ui.js';
import { LIMITS, validatePaths, validatePassword, checkAbort, encryptFiles, decryptPackage, exportPayload, manifestText } from './model.mjs';
const css = `.t093{display:grid;gap:12px;max-width:1150px;margin:auto;color:var(--text)}.t093 label{display:grid;gap:6px}.t093 input,.t093 textarea{font:inherit;padding:8px;border:1px solid var(--line);border-radius:6px;background:var(--bg-sunken);color:var(--text);box-sizing:border-box;max-width:100%}.t093 textarea{width:100%;resize:vertical}.t093 .t093-row{display:flex;gap:10px;flex-wrap:wrap;align-items:end}.t093 .t093-row>label{flex:1;min-width:180px}.t093 .t093-card{border:1px solid var(--line);border-radius:8px;padding:16px;display:grid;gap:10px}.t093 .t093-muted{font-size:13px;line-height:1.6;color:var(--text-dim)}.t093 .t093-status{padding:10px;background:var(--bg-sunken);white-space:pre-wrap;overflow-wrap:anywhere}.t093 .t093-scroll{overflow:auto;max-height:430px}.t093 table{border-collapse:collapse;width:100%;font-size:13px}.t093 th,.t093 td{text-align:left;vertical-align:top;padding:8px;border-bottom:1px solid var(--line);overflow-wrap:anywhere}.t093 .t093-hash{font-family:monospace;min-width:220px}.t093 button:disabled{opacity:.5}`;
const label = (title, node) => h('label', {}, title, node);
export default {
  id: 'T093',
  create(root) {
    let alive = true, active = true, busy = false, nativePending = false, operation = null, selectedFiles = [], encrypted = null, restored = null; const bindings = [], controls = [];
    const files = window.toolbox?.files, protectedText = () => files?.saveTextSupportsCopyOnly === true && typeof files.saveText === 'function', protectedBundle = () => files?.exportBundleSupportsCopyOnly === true && typeof files.exportBundle === 'function';
    const status = h('div', { class: 't093-status', role: 'status', 'aria-live': 'polite' }, '先选文件并核对清单，再加密保存；恢复必须完整认证/哈希核验后预览，再明确点击写新目录。');
    const say = message => { if (alive) status.textContent = message; };
    const listen = (node, event, action) => { node.addEventListener(event, action); bindings.push([node, event, action]); return node; };
    const input = (tag, props) => { const node = h(tag, props); controls.push(node); return node; };
    const button = (title, action, primary = false) => { const node = input('button', { type: 'button', class: primary ? 'btn btn--primary' : 'btn' }); node.textContent = title; return listen(node, 'click', async () => { if (alive && active && !busy) await action(); }); };
    const source = input('input', { type: 'file', multiple: true, 'aria-label': '加密源文件集合' }), directory = input('input', { type: 'file', multiple: true, webkitdirectory: true, 'aria-label': '加密源目录文件集合' });
    const password = input('input', { type: 'password', autocomplete: 'new-password', maxlength: 512, 'aria-label': '加密口令' }), confirm = input('input', { type: 'password', autocomplete: 'new-password', maxlength: 512, 'aria-label': '确认加密口令' });
    const packageFile = input('input', { type: 'file', accept: '.json', 'aria-label': '待解密交付包JSON文件' }), packageText = input('textarea', { rows: 6, maxlength: LIMITS.containerBytes, 'aria-label': '待解密交付包JSON文本', placeholder: '粘贴T093版本1认证加密包JSON，或从上方选择文件。' });
    const decryptPassword = input('input', { type: 'password', autocomplete: 'off', maxlength: 512, 'aria-label': '解密口令' }), sourcePreview = h('div'), encryptedPreview = h('div'), restorePreview = h('div');
    const clearEncrypted = () => { encrypted = null; encryptedPreview.replaceChildren(); };
    const clearRestored = () => { restored = null; restorePreview.replaceChildren(); };
    const clearPasswords = () => { password.value = confirm.value = decryptPassword.value = ''; };
    const table = manifest => h('div', { class: 't093-scroll' }, h('p', {}, `${manifest.files.length}文件 · ${manifest.totalBytes}字节 · SHA-256核验清单`), h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, '相对路径'), h('th', {}, '字节数'), h('th', {}, 'SHA-256'))), h('tbody', {}, ...manifest.files.map(file => h('tr', {}, h('td', {}, file.path), h('td', {}, file.size), h('td', { class: 't093-hash' }, file.sha256))))));
    const refresh = () => {
      if (!alive) return; for (const node of controls) node.disabled = busy || !active;
      if (!busy && active) { encryptButton.disabled = !selectedFiles.length; savePackage.disabled = !encrypted || !protectedText(); saveSourceManifest.disabled = !encrypted || !protectedText(); restoreButton.disabled = !restored || !protectedBundle(); saveRestoreManifest.disabled = !restored || !protectedText(); }
      cancel.disabled = !busy || nativePending || !active;
    };
    const job = async (action, native = false) => {
      if (busy || !active || !alive) return; const controller = new AbortController(); operation = controller; busy = true; nativePending = native; refresh();
      const hooks = { signal: controller.signal, onProgress: message => { if (alive && active && !controller.signal.aborted) say(message); } };
      try { await action(hooks); } catch (error) { if (alive) say(error.message); } finally { if (operation === controller) { operation = null; busy = nativePending = false; clearPasswords(); refresh(); } }
    };
    const validFiles = collection => {
      const list = Array.from(collection || []); validatePaths(list.map(file => file.webkitRelativePath || file.name)); let total = 0;
      for (const file of list) { if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > LIMITS.fileBytes || typeof file.arrayBuffer !== 'function') throw new Error('每个源文件须≤2 MiB并可读取字节。'); total += file.size; if (total > LIMITS.totalBytes) throw new Error('源文件总量超过8 MiB。'); }
      return list;
    };
    const selectFiles = event => {
      if (!alive || !active || busy) return; clearEncrypted(); selectedFiles = []; sourcePreview.replaceChildren(); if (event.currentTarget === source) directory.value = ''; else source.value = '';
      try { selectedFiles = validFiles(event.currentTarget.files); sourcePreview.append(h('p', {}, `待加密${selectedFiles.length}文件，${selectedFiles.reduce((sum, file) => sum + file.size, 0)}字节。选择是替换集合；目录保留webkitRelativePath，包括顶层目录名。`), h('div', { class: 't093-scroll' }, ...selectedFiles.map(file => h('p', {}, `${file.webkitRelativePath || file.name} · ${file.size}字节`)))); say('源文件清单已预览；输入口令并确认后加密，源文件不会被写入。'); } catch (error) { say(error.message); } refresh();
    };
    listen(source, 'change', selectFiles); listen(directory, 'change', selectFiles);
    for (const node of [password, confirm]) listen(node, 'input', () => { if (!busy && alive) { clearEncrypted(); refresh(); say('加密口令已更改，旧加密报告废弃；重新加密。'); } });
    const invalidateRestore = () => { if (!busy && alive) { clearRestored(); refresh(); say('包或解密口令已更改，旧恢复清单废弃；重新认证。'); } };
    listen(packageText, 'input', invalidateRestore); listen(decryptPassword, 'input', invalidateRestore);
    listen(packageFile, 'change', async () => {
      if (!alive || !active || busy) return; clearRestored(); packageText.value = ''; refresh(); const file = packageFile.files?.[0]; if (!file) return;
      await job(async hooks => { if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > LIMITS.containerBytes || typeof file.arrayBuffer !== 'function') throw new Error('加密包文件须为1字节–16 MiB。'); say('正在读取加密包JSON文件…'); const buffer = await file.arrayBuffer(); checkAbort(hooks.signal); if (buffer.byteLength !== file.size) throw new Error('包文件读取大小变化。'); let text; try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer); } catch { throw new Error('加密包文件不是有效UTF-8。'); } packageText.value = text; say('加密包已读取；输入解密口令并点击认证解密。尚未恢复任何文件。'); });
    });
    const encryptButton = button('认证加密已预览文件', async () => {
      const secret = password.value, repeated = confirm.value; clearEncrypted(); refresh();
      await job(async hooks => {
        validatePassword(secret); if (secret !== repeated) throw new Error('两次加密口令不一致（首尾空白保留）。'); const list = validFiles(selectedFiles), inputs = [];
        try { for (let i = 0; i < list.length; i++) { checkAbort(hooks.signal); say(`读取源文件 ${i + 1}/${list.length}`); const buffer = await list[i].arrayBuffer(); checkAbort(hooks.signal); if (buffer.byteLength !== list[i].size) throw new Error('源文件读取大小变化，请重新选择。'); inputs.push({ path: list[i].webkitRelativePath || list[i].name, bytes: new Uint8Array(buffer) }); }
          const result = await encryptFiles(inputs, secret, hooks); checkAbort(hooks.signal); if (!alive || !active) return; encrypted = result; encryptedPreview.replaceChildren(h('h4', {}, '加密成功，保存前核对源清单'), table(result.manifest), h('p', { class: 't093-muted' }, '加密包外层只有固定算法参数、salt、IV和密文，不含文件名/清单。独立清单是明文，会暴露名称和哈希，只有明确点击才另存。')); say('加密包已生成但尚未写文件。请核对清单，再点击保存加密包副本。');
        } finally { for (const item of inputs) item.bytes.fill(0); }
      });
    }, true);
    const decryptButton = button('完整认证解密并核验清单', async () => {
      const secret = decryptPassword.value, text = packageText.value; clearRestored(); refresh();
      await job(async hooks => { const result = await decryptPackage(text, secret, hooks); checkAbort(hooks.signal); if (!alive || !active) return; restored = result; restorePreview.replaceChildren(h('h4', {}, '全部认证、路径与哈希核验通过，待恢复清单'), table(result.manifest), h('p', {}, '当前仅预览，尚未创建目录；核对这些相对路径和字节数后点击写新目录。')); say('全部文件核验通过；仍未写入磁盘。请预览清单后主动点击恢复到新目录。'); });
    }, true);
    const savedStatus = (response, noun) => response?.canceled === true ? '已取消另存。' : response?.ok === true ? `已保存${noun}：${response.path || '所选新目标'}` : `保存失败：${response?.error || '未收到明确成功结果'}${response?.partialPath ? `；需人工核对目录：${response.partialPath}` : ''}`;
    const saveText = (content, name) => job(async hooks => { checkAbort(hooks.signal); if (!protectedText()) throw new Error('缺少copyOnly文本副本能力。'); say('请在另存对话框选择尚不存在的新文件；取消可关闭对话框。'); const response = await files.saveText({ content, extension: 'json', defaultName: name, copyOnly: true }); if (alive && active) say(savedStatus(response, 'JSON副本')); }, true);
    const savePackage = button('保存加密包 JSON 副本', () => encrypted && saveText(encrypted.text, 'T093-encrypted-copy.json'));
    const saveSourceManifest = button('另存源文件明文核验清单', () => encrypted && saveText(manifestText(encrypted.manifest), 'T093-source-manifest-copy.json'));
    const saveRestoreManifest = button('另存已验证明文核验清单', () => restored && saveText(manifestText(restored.manifest), 'T093-verified-manifest-copy.json'));
    const restoreButton = button('已核对预览，恢复到新目录', () => {
      if (!restored || !protectedBundle()) return; const payload = exportPayload(restored);
      return job(async hooks => { checkAbort(hooks.signal); say('请在原生对话框选择新的目录名称，已有目录将拒绝；尚未覆盖任何源文件。'); const response = await files.exportBundle(payload); if (alive && active) say(savedStatus(response, '恢复副本目录')); }, true);
    }, true);
    const cancel = input('button', { type: 'button', class: 'btn' }); cancel.textContent = '取消当前读取/密码运算'; listen(cancel, 'click', () => { if (alive && active && busy && !nativePending) { operation?.abort(); say('已请求取消；WebCrypto/文件读取不能强行中止，等待返回并忽略结果，不会调用写入。'); } });
    const clear = button('清空文件、包、口令和报告', () => { selectedFiles = []; source.value = directory.value = packageFile.value = packageText.value = ''; sourcePreview.replaceChildren(); clearEncrypted(); clearRestored(); clearPasswords(); refresh(); say('已清空界面和本模块引用；不保证擦除运行时已复制的JS字符串。'); });
    root.replaceChildren(h('section', { class: 't093' }, h('style', {}, css), h('h2', {}, '加密交付包'), h('p', { class: 't093-muted' }, '全本地WebCrypto，无网络、无口令上传。1–50文件，每文件≤2 MiB，总≤8 MiB；包≤16 MiB。口令8–256 Unicode码点，首尾空白保留。密码仅内存、不写配置，加密/解密结束后清空输入。'), status,
      h('div', { class: 't093-card' }, h('h3', {}, '1. 选择与预览源文件'), h('div', { class: 't093-row' }, label('多文件（替换集合）', source), label('目录（含顶层相对目录）', directory)), sourcePreview, h('div', { class: 't093-row' }, label('新口令', password), label('再次输入同一口令', confirm)), encryptButton, encryptedPreview, h('div', { class: 't093-row' }, savePackage, saveSourceManifest)),
      h('div', { class: 't093-card' }, h('h3', {}, '2. 认证解密 → 清单预览 → 写新目录'), label('加密包JSON文件', packageFile), label('或粘贴加密包JSON', packageText), label('解密口令', decryptPassword), decryptButton, restorePreview, h('div', { class: 't093-row' }, restoreButton, saveRestoreManifest)),
      h('div', { class: 't093-row' }, cancel, clear), h('p', { class: 't093-muted' }, `副本保护能力：JSON ${protectedText() ? '可用' : '缺失，保存禁用'}；新目录 ${protectedBundle() ? '可用' : '缺失，恢复写入禁用'}。对话框给出最终路径；用户选择后基础层独占创建，新目录已存在则拒绝。`),
      h('details', {}, h('summary', {}, '固定密码参数与内存/文件限制'), h('p', { class: 't093-muted' }, 'PBKDF2-SHA256固定600000次，随机16字节salt、随机12字节IV，AES256-GCM 128bit认证标签；AAD绑定固定容器版本/参数/编码规则及salt/IV。错误口令或密文篡改认证失败；认证后仍需完整路径/大小/规范Base64/SHA-256校验，全部通过才允许恢复。'), h('p', { class: 't093-muted' }, '明文核验清单含文件名、大小和SHA-256，独立保存需自行管理。包大小仍可透露大致内容体积。弱口令仍可能被离线猜测；没有密码找回。取消只忽略异步运算返回，JS字符串/运行时副本不承诺安全擦除。暂停会清空口令和结果，切换功能清理全部输入；原生写入失败会尝试清理新目录，断电/崩溃不保证事务恢复。'))));
    refresh();
    return { activate() { if (alive) { active = true; refresh(); } }, deactivate() { if (alive) { operation?.abort(); active = false; clearPasswords(); clearEncrypted(); clearRestored(); refresh(); say('已暂停并废弃口令/报告；回来需要重新输入口令和核验。'); } }, destroy() { operation?.abort(); alive = active = false; for (const [node, event, action] of bindings) node.removeEventListener(event, action); selectedFiles = []; clearPasswords(); clearEncrypted(); clearRestored(); source.value = directory.value = packageFile.value = packageText.value = ''; sourcePreview.replaceChildren(); root.replaceChildren(); } };
  }
};
