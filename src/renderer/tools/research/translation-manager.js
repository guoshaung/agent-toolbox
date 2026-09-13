/** Local-first translation manager for research reading. */
const VERSION = 'local-v2';

function hash(value) {
  let h = 2166136261;
  for (const ch of String(value)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16);
}

const SCIENTIFIC_TOKEN_PATTERNS = [
  /https?:\/\/[^\s)\]}]+/gi,
  /\bdoi:\s*\S+|\b10\.\d{4,9}\/[\w.()/:;-]+/gi,
  /\[(?:\d+\s*[,\-–]?\s*)+\]/g,
  /\b(?:Figure|Fig\.?|Table|Algorithm)\s+[A-Z]?\d+\b/gi,
  /\$[^$\n]+\$|\\\([^\n]+?\\\)|\\\[[\s\S]+?\\\]/g,
  /\b[A-Z]\([^\n)]{1,100}\)/g,
  /[α-ωΑ-Ω]+/g,
  /\b(?:GPT-\d+(?:\.\d+)?|[A-Z][A-Za-z0-9-]*(?:Bench|Eval)|[A-Za-z]+(?:Bench|Eval)|[A-Z]{2,}[A-Z0-9-]*)\b/g,
];

export function protectScientificText(text) {
  let protectedText = String(text || '');
  const replacements = [];
  for (const pattern of SCIENTIFIC_TOKEN_PATTERNS) {
    protectedText = protectedText.replace(pattern, (value) => {
      const token = `\uE000${replacements.length.toString(36)}\uE001`;
      replacements.push({ token, value });
      return token;
    });
  }
  return { protectedText, replacements };
}

export function restoreScientificText(text, replacements) {
  let restored = String(text || '');
  for (const { token, value } of replacements || []) restored = restored.split(token).join(value);
  return restored;
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

  getCached(text, { sourceLanguage = 'en', targetLanguage = 'zh' } = {}) {
    return this.cache.get(this.key(String(text || '').trim(), sourceLanguage, targetLanguage)) || null;
  }

  async translateParagraph(text, { sourceLanguage = 'en', targetLanguage = 'zh', paragraphId, onProgress, allowRemote = false } = {}) {
    const source = String(text || '').trim();
    if (!source) return { ok: true, translation: '', provider: 'none' };
    const key = this.key(source, sourceLanguage, targetLanguage);
    const cached = this.cache.get(key);
    if (cached?.translation) return { ...cached, cached: true };
    const { protectedText, replacements } = protectScientificText(source);
    let result;
    let localFailure = null;
    if (this.detectProvider() === 'chrome') {
      try {
        onProgress?.({ state: 'initializing', message: '正在初始化本地翻译模型…' });
        const translator = await this.initTranslator(sourceLanguage, targetLanguage, (loaded, total) => onProgress?.({ state: 'downloading', loaded, total }));
        result = { ok: true, translation: restoreScientificText(await translator.translate(protectedText), replacements), provider: 'chrome', paragraphId };
      } catch (error) {
        localFailure = { error: error.message, provider: 'unavailable', paragraphId };
        onProgress?.({ state: 'fallback', message: error.message });
      }
    }
    if (!result && globalThis.window?.toolbox?.translation?.argos) {
      try {
        const argos = await globalThis.window.toolbox.translation.argos({ text: protectedText, sourceLanguage, targetLanguage });
        if (argos?.ok && argos.translation) {
          result = { ok: true, translation: restoreScientificText(argos.translation, replacements), provider: 'argos', paragraphId };
        } else if (argos) {
          localFailure = {
            ok: false,
            error: argos.error || '本地翻译不可用。请安装并启动 Argos Translate，或主动点击“AI 精译”。',
            code: argos.code,
            canInstall: Boolean(argos.canInstall),
            provider: 'unavailable',
            paragraphId,
          };
        }
      } catch { /* explicit unavailable result below */ }
    }
    if (!result && allowRemote && source.length <= 1800 && globalThis.window?.toolbox?.lit?.translate) {
      try {
        onProgress?.({ state: 'remote', message: '正在使用快速翻译服务…' });
        const remote = await globalThis.window.toolbox.lit.translate(protectedText, { interactive: true });
        if (remote?.ok && remote.translation) {
          result = {
            ok: true,
            translation: restoreScientificText(remote.translation, replacements),
            provider: 'remote',
            paragraphId,
          };
        } else if (remote?.error) {
          localFailure = { ok: false, error: remote.error, provider: 'unavailable', paragraphId };
        }
      } catch (error) {
        localFailure = { ok: false, error: error.message, provider: 'unavailable', paragraphId };
      }
    }
    if (!result) {
      result = localFailure || {
        ok: false,
        error: '本地翻译不可用。请安装并启动 Argos Translate，或主动点击“AI 精译”。',
        provider: 'unavailable',
        paragraphId,
      };
    }
    if (result.ok) {
      this.cache.set(key, {
        paperId: this.paperId,
        paragraphId,
        source,
        originalText: source,
        translatedText: result.translation,
        translation: result.translation,
        sourceLanguage,
        targetLanguage,
        provider: result.provider,
        createdAt: Date.now(),
      });
      // 每段成功后必须等待持久化完成，再翻译下一段。这样中途关闭、崩溃或断网
      // 都只会补译尚未保存的段落，不会让已经产生费用的译文丢失。
      await this.config?.set(`research.translationCache.${this.paperId}`, Object.fromEntries(this.cache));
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
  getArgosStatus() { return globalThis.window?.toolbox?.translation?.argosStatus?.(); }
  installArgosModels() { return globalThis.window?.toolbox?.translation?.installArgosModels?.(); }
  destroy() { for (const instance of this.instances.values()) instance.destroy?.(); this.instances.clear(); }
}

export { hash };
