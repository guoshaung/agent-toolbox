/**
 * 从 PDF 自己身上认领书目信息。
 *
 * 为什么不让人手填：学术 PDF 里几乎都印着 DOI 或 arXiv 编号 —— 那是一把精确钥匙。
 * 拿到它去 Crossref 做**精确查询**，作者、年份、期刊、卷期页全都是准的，
 * 不用猜、不用比对标题相似度、不用人工确认。
 *
 * 找不到钥匙时才退到标题匹配，那条路才需要人挑。
 */

let pdfjsPromise = null;
function loadPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('../../../../node_modules/pdfjs-dist/build/pdf.min.mjs').then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = new URL(
        '../../../../node_modules/pdfjs-dist/build/pdf.worker.min.mjs',
        import.meta.url,
      ).href;
      return lib;
    });
  }
  return pdfjsPromise;
}

/** DOI 常出现在页脚，尾巴容易粘上句点/括号，要削掉 */
function cleanDoi(raw) {
  return String(raw || '').replace(/[.,;:)\]}>]+$/, '').trim();
}

const DOI_RE = /10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+/;
const ARXIV_RE = /arXiv:\s*([a-z-]+(?:\.[A-Z]{2})?\/\d{7}|\d{4}\.\d{4,5})(v\d+)?/i;

/**
 * 读 PDF 的前几页，抠出能用来精确查询的标识。
 * @returns { doi, arxiv, embeddedTitle, embeddedAuthor, sample }
 */
export async function probePdf(file, { pages = 2 } = {}) {
  const buf = await window.toolbox.lit.readPdf(file);
  if (!buf.ok) throw new Error(buf.error);

  const pdfjs = await loadPdfJs();
  const task = pdfjs.getDocument({
    data: new Uint8Array(buf.data),     // pdf.js 会 detach 缓冲区，必须给副本
    standardFontDataUrl: new URL('../../../../node_modules/pdfjs-dist/standard_fonts/', import.meta.url).href,
    cMapUrl: new URL('../../../../node_modules/pdfjs-dist/cmaps/', import.meta.url).href,
    cMapPacked: true,
  });

  const doc = await task.promise;
  try {
    let embeddedTitle = '';
    let embeddedAuthor = '';
    try {
      const info = (await doc.getMetadata())?.info || {};
      embeddedTitle = String(info.Title || '').trim();
      embeddedAuthor = String(info.Author || '').trim();
    } catch { /* 有些 PDF 没有元数据字典，不是错误 */ }

    let text = '';
    for (let i = 1; i <= Math.min(pages, doc.numPages); i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      text += `${content.items.map((item) => item.str).join(' ')}\n`;
    }

    const doiHit = text.match(DOI_RE);
    const arxivHit = text.match(ARXIV_RE);

    return {
      doi: doiHit ? cleanDoi(doiHit[0]) : '',
      arxiv: arxivHit ? arxivHit[1] : '',
      // PDF 元数据里的标题经常是排版软件写的文件名，明显不像标题的就别用
      embeddedTitle: embeddedTitle.length > 8 && !/^(untitled|microsoft word|\d+$)/i.test(embeddedTitle)
        ? embeddedTitle : '',
      embeddedAuthor,
      sample: text.slice(0, 600),
    };
  } finally {
    doc.destroy?.();
    task.destroy?.();
  }
}

/**
 * 认领一篇文献的书目信息。按可靠性从高到低尝试。
 * @returns { ok, meta, via, exact, candidates, error }
 *   via: 'doi' | 'arxiv' | 'pdf-title' | 'filename'
 *   exact 为 true 表示这条结果可以直接写入，不需要人确认
 */
export async function identify(file, { fallbackTitle = '' } = {}) {
  const biblio = window.toolbox.biblio;
  let probe = null;

  if (/\.pdf$/i.test(file)) {
    try {
      probe = await probePdf(file);
    } catch (err) {
      probe = { error: err.message };
    }
  }

  // 1) 正文里的 DOI —— 最可靠
  if (probe?.doi) {
    const result = await biblio.lookup({ doi: probe.doi });
    if (result.ok) return { ok: true, meta: result.best, via: 'doi', exact: true };
  }

  // 2) arXiv 编号 —— 走 arXiv 官方 API。
  //    注意别拿 10.48550/arXiv.xxxx 去问 Crossref：那个 DOI 注册在 DataCite，查不到。
  if (probe?.arxiv) {
    const result = await biblio.lookup({ arxiv: probe.arxiv });
    if (result.ok) return { ok: true, meta: result.best, via: 'arxiv', exact: true };
  }

  // 3) PDF 内嵌标题 / 文件名 —— 只能模糊匹配，要人确认
  const title = probe?.embeddedTitle || fallbackTitle;
  if (title) {
    const result = await biblio.lookup({ title });
    if (result.ok) {
      return {
        ok: true,
        meta: result.best,
        via: probe?.embeddedTitle ? 'pdf-title' : 'filename',
        exact: false,
        score: result.score,
        candidates: result.candidates,
        // 同名提示 / arXiv 直通这两个判定在主进程里做，别在这层丢掉
        ambiguous: result.ambiguous,
        sameNameCount: result.sameNameCount,
        autoImport: result.autoImport,
        best: result.best,
      };
    }
    return { ok: false, error: result.error, probe };
  }

  return { ok: false, error: probe?.error || '这个文件里没找到 DOI / arXiv 编号，也没有可用标题。', probe };
}

export const VIA_LABEL = {
  doi: '正文 DOI',
  arxiv: 'arXiv 编号',
  'pdf-title': 'PDF 内嵌标题',
  filename: '文件名',
};
