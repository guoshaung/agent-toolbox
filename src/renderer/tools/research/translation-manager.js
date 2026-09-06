/** Local-first translation manager for research reading. */
const VERSION = 'local-v1';

function hash(value) {
  let h = 2166136261;
  for (const ch of String(value)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16);
}

export class TranslationManager {
  constructor({ config, paperId } = {}) {
    this.config = config;
    this.paperId = paperId || 'selection';
    this.instances = new Map();
    this.cache = new Map(Object.entries(config?.get(`research.translationCache.${this.paperId}`, {}) || {}));
  }

  detectProvider() {
    if (typeof globalThis.Translator === 'object' || typeof globalThis.Translator === 'function') return 'chrome';
    if (globalThis.window?.toolbox?.translation?.argos) return 'argos';
    return 'unavailable';
  }

  async initTranslator(sourceLanguage, targetLanguage, onProgress) {
    const key = `${sourceLanguage}-${targetLanguage}`;
    if (this.instances.has(key)) return this.instances.get(key);
    if (!globalThis.Translator?.create) throw new Error('Chrome Translator API 不可用');
    const instance = await globalThis.Translator.create({
      sourceLanguage, targetLanguage,
      monitor: (monitor) => monitor.addEventListener?.('downloadprogress', (event) => onProgress?.(event.loaded, event.total)),
    });
    this.instances.set(key, instance);
    return instance;
  }

  key(text, sourceLanguage, targetLanguage) {
    return hash(`${this.paperId}\n${text}\n${sourceLanguage}\n${targetLanguage}\n${VERSION}`);
  }

  async translateParagraph(text, { sourceLanguage = 'en', targetLanguage = 'zh', paragraphId, onProgress } = {}) {
    const source = String(text || '').trim();
    if (!source) return { ok: true, translation: '', provider: 'none' };
    const key = this.key(source, sourceLanguage, targetLanguage);
    const cached = this.cache.get(key);
    if (cached?.translation) return { ...cached, cached: true };
    let result;
    if (this.detectProvider() === 'chrome') {
      try {
        onProgress?.({ state: 'initializing', message: '正在初始化本地翻译模型…' });
        const translator = await this.initTranslator(sourceLanguage, targetLanguage, (loaded, total) => onProgress?.({ state: 'downloading', loaded, total }));
        result = { ok: true, translation: await translator.translate(source), provider: 'chrome', paragraphId };
      } catch (error) { onProgress?.({ state: 'fallback', message: error.message }); }
    }
    if (!result && globalThis.window?.toolbox?.translation?.argos) {
      try {
        const argos = await globalThis.window.toolbox.translation.argos({ text: source, sourceLanguage, targetLanguage });
        if (argos?.ok && argos.translation) result = { ok: true, translation: argos.translation, provider: 'argos', paragraphId };
      } catch { /* explicit unavailable result below */ }
    }
    if (!result) result = { ok: false, error: '本地翻译不可用。请安装并启动 Argos Translate，或主动点击“AI 精译”。', provider: 'unavailable', paragraphId };
    if (result.ok) {
      this.cache.set(key, { source, translation: result.translation, provider: result.provider, paragraphId, at: Date.now() });
      this.config?.set(`research.translationCache.${this.paperId}`, Object.fromEntries(this.cache));
    }
    return result;
  }

  translateSelection(text, options = {}) { return this.translateParagraph(text, options); }
  async translateBatch(items, options = {}) {
    const out = [];
    for (const item of items || []) out.push(await this.translateParagraph(item.source || item.text, { ...options, paragraphId: item.paragraphId }));
    return out;
  }
  async translateStreaming(items, { onItem, ...options } = {}) {
    for (const item of items || []) onItem?.(item, await this.translateParagraph(item.source, { ...options, paragraphId: item.paragraphId }));
  }
  destroy() { for (const instance of this.instances.values()) instance.destroy?.(); this.instances.clear(); }
}

export { hash };
