'use strict';
const TITLE = '火山语音（论文讲解）';
function createVoiceConfig({ vault, store }) {
  function credential() {
    const cfg = store.get('research.papertalk.tts', {});
    if (!cfg.vaultId) throw new Error('请先在论文讲解的配音设置中保存火山语音密钥');
    const got = vault.keyOf(String(cfg.vaultId));
    if (!got.ok) throw new Error('火山语音密钥：' + got.error);
    return got.key;
  }
  function status() {
    return { ok:true, provider:'volcengine', configured:Boolean(store.get('research.papertalk.tts.vaultId','')),
      male:'云舟 2.0', female:'小何 2.0', model:'豆包语音合成 2.0' };
  }
  function save(apiKey) {
    const key = String(apiKey || '').trim();
    if (!/^[A-Za-z0-9_.-]{16,256}$/.test(key)) return { ok:false,error:'密钥格式不正确，请粘贴火山语音 API Key' };
    const gate = vault.pinStatus();
    if (gate.hasPin && !gate.unlocked) return {ok:false,error:'请先在密钥箱解锁，再保存语音密钥'};
    const cfg = store.get('research.papertalk.tts',{});
    const existing = cfg.vaultId || vault.list().entries.find(e=>e.title===TITLE && e.url==='https://openspeech.bytedance.com')?.id;
    const saved = vault.save({ id:existing, title:TITLE, url:'https://openspeech.bytedance.com', kind:'api', key,
      tags:['火山语音','论文讲解'], notes:'论文讲解内置配音使用；不包含在源代码或安装包中。' });
    if (!saved.ok) return saved;
    store.set('research.papertalk.tts',{ provider:'volcengine', vaultId:saved.id });
    return status();
  }
  return { credential, status, save };
}
module.exports = {createVoiceConfig};
