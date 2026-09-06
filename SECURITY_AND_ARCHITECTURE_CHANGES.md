# Security and Architecture Changes

## Changed

- Added `TranslationManager` with Chrome Translator feature detection, cached paragraph translation, and an Argos sidecar IPC fallback. Ordinary selection and bilingual reading no longer call an LLM or the old remote Youdao endpoint.
- Added stable `p_###` paragraph IDs and a two-pane bilingual reader. Each pane has its own scroll container; IntersectionObserver aligns the matching paragraph and hover highlights both sides.
- Added explicit `AI 精译` to the translation result panel so LLM use is user initiated.
- Added text-anchor highlights persisted under `research.litHighlights.<paper>`, with a selection toolbar and display in the existing annotation panel.
- Added dependency-free local word diff and a `差异` panel for comparing two pasted versions.
- Previous local branch changes also preserve third-party CSP, enable Chromium sandboxing for local windows/webviews, and add focused Electron security tests.

## Not Changed

- No Argos binary, Python environment, or language model is downloaded automatically. The current IPC endpoint reports unavailable until a separately managed local sidecar is installed and started.
- PDF text extraction remains the existing PDF.js implementation. Figures, OCR and arbitrary publisher HTML are not rewritten in this slice.
- Existing AI chat, summary, explanation and Q&A paths remain available. Only ordinary translation is local-first; AI remains available through explicit actions.
- Remote Control, MCP risk prompts, chat-export privacy scanning and the pre-existing Practice Runner Windows runtime failures remain documented in `AUDIT_REPORT.md` and were not changed in this slice.

## Remaining Risks

- Electron 33 may not expose the Chrome Translator API. On such systems the UI correctly reports local translation unavailable until an Argos sidecar is provided.
- Translation cache is stored in the existing JSON config store, not a database; very large papers can increase config size.
- Paragraph extraction from complex PDF layouts is heuristic. Two-column PDFs and scanned documents may yield imperfect paragraph boundaries.
- The current compare panel compares pasted text; automatic arXiv version discovery and figure-aware diff are future work.

## Breaking Changes

None intended. Ordinary translation behavior changes from remote/LLM fallback to local-only with explicit failure when no local provider is available.

## Manual Verification

1. Open a text PDF, switch to `中英双栏`, confirm both panes render immediately and the first visible paragraphs translate without an API key.
2. Scroll either pane and confirm the matching `p_###` paragraph moves into view; toggle `同步滚动 ON/OFF` and hover either side.
3. Select text, use `译` and `高亮`, open `批注`, close/reopen the paper, and confirm the text anchor and tag remain.
4. Open `差异`, paste `static policy` and `adaptive policy`, and confirm deletion/insertions use red strike-through/green highlighting.
5. Click `AI 精译` only when desired and verify the configured AI credential is required then, not for ordinary translation.

