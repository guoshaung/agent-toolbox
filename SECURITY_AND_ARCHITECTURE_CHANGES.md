# Security and Architecture Changes

## Changed

- Added `TranslationManager` with Chrome Translator feature detection, cached instances, scientific-token protection, and paragraph translation caching. Ordinary selection and bilingual reading never fall through to an LLM or remote translation endpoint.
- Added an optional Argos Python sidecar over stdio. It starts on demand, uses a minimal environment, limits text size and time, reports missing Python/package/models separately, and only downloads English/Chinese models after explicit confirmation.
- Added stable `p_###` paragraph IDs and a two-pane bilingual reader. Each pane has its own scroll container; IntersectionObserver aligns the matching paragraph, prioritizes visible translation work, and highlights matching paragraphs on hover. The split ratio is draggable and a Chinese-only view is available.
- Added explicit `AI 精译` to the translation result panel so LLM use is user initiated.
- Added text-anchor highlights persisted under `research.litHighlights.<paper>`, with four colors, eight research tags, filtering, paragraph/page navigation, and visible restoration in bilingual text.
- Added dependency-free local word diff and a `差异` panel for comparing two pasted versions.
- Previous local branch changes also preserve third-party CSP, enable Chromium sandboxing for local windows/webviews, and add focused Electron security tests.

## Not Changed

- No Python environment or `argostranslate` package is installed automatically. The user must install the optional Python package; language-model download is then an explicit in-app action.
- PDF text extraction remains the existing PDF.js implementation. Figures, OCR and arbitrary publisher HTML are not rewritten in this slice.
- Existing AI chat, summary, explanation and Q&A paths remain available. Only ordinary translation is local-first; AI remains available through explicit actions.
- Remote Control, MCP risk prompts, chat-export privacy scanning and the pre-existing Practice Runner Windows runtime failures remain documented in `AUDIT_REPORT.md` and were not changed in this slice.

## Remaining Risks

- Electron 33 may not expose the Chrome Translator API. On such systems the UI correctly reports local translation unavailable until an Argos sidecar is provided.
- Translation cache is stored in the existing JSON config store, not a database; very large papers can increase config size.
- Paragraph extraction from complex PDF layouts is heuristic. Two-column PDFs and scanned documents may yield imperfect paragraph boundaries.
- Text highlights can only be restored precisely in parsed bilingual paragraphs. In the canvas-backed PDF view the saved page anchor supports navigation, but selected glyph-range restoration is not yet implemented.
- Word alignment between original and translation is unavailable from Chrome/Argos; cross-language selections therefore do not guess a corresponding word. The matching paragraph is marked instead.
- The current compare panel compares pasted text; automatic arXiv version discovery, sentence-aware change grouping, and figure-aware diff are not implemented.

## Breaking Changes

None. The legacy remote translation preload method remains available for compatibility, but the research reader no longer calls it. Its default path is Chrome Translator then optional local Argos, with explicit failure when neither is available.

## Verification

- Focused translation, Argos, diff and Electron security tests: **11 passed, 0 failed, 0 skipped**.
- Full `npm.cmd run check`: **61 total, 59 passed, 2 failed, 0 skipped**.
- Both full-suite failures are the pre-existing Windows Practice Runner assumptions: it requires a `python3` command and a `sqlite3` executable. They are unrelated to this translation change and remain documented in `AUDIT_REPORT.md`.
- The Argos stdio protocol was started against the local Python installation and correctly returned `package-missing`; the optional `argostranslate` package/model is not installed on this machine, so a real translation result could not be verified here.
- Electron UI smoke testing was not run in this non-interactive environment.

## Manual Verification

1. Open a text PDF, switch to `中英双栏`, confirm both panes render immediately and visible paragraphs translate without an API key. If Argos is not installed, confirm the error identifies the missing package/model instead of calling an LLM.
2. Scroll either pane and confirm the matching `p_###` paragraph moves into view; toggle `同步滚动 ON/OFF` and hover either side.
3. Drag the separator between 30/70 and 70/30, switch between bilingual and Chinese-only display, then reopen bilingual mode and confirm the ratio remains.
4. Select text, choose a color and research tag, save it, open `Highlights`, filter and jump to the matching paragraph. Close/reopen the paper and confirm the text anchor remains.
5. Open `差异`, paste `static policy` and `adaptive policy`, and confirm deletion/insertions use red strike-through/green highlighting.
6. Click `AI 精译` only when desired and verify the configured AI credential is required then, not for ordinary translation.
