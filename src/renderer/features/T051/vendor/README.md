# js-yaml browser module

Unmodified `dist/js-yaml.mjs` from the repository's installed js-yaml **4.3.2**. Runtime imports stay within T051; no Node `require`, package installation, CDN or network fetch. MIT license is preserved in `LICENSE` and the upstream module header.

Official source/API: https://github.com/nodeca/js-yaml/blob/4.3.2/README.md
Official distribution: https://github.com/nodeca/js-yaml/blob/4.3.2/dist/js-yaml.mjs
Official license: https://github.com/nodeca/js-yaml/blob/4.3.2/LICENSE

SHA-256 of this module: `cea276c7e15f409a1adbe5d177aba7824398a474f7cf702bd57962c7d570636f`.

T051 uses single-document `load` with `JSON_SCHEMA`, `json:false` (duplicate mappings throw), `maxDepth:8`, `maxTotalMergeKeys:0` and warnings rejected. Before calling it, T051 conservatively forbids all `&`, `*`, `!`, `?`, `{`, `}`, `[`, `]`, `<<` candidates and directives/explicit complex keys, including candidates inside strings/comments. Block mappings and block sequences only; empty containers must use JSON. This deliberate limited support prevents alias/merge graph expansion. Post-parse depth/node/type/path checks apply to JSON and YAML alike. JSON_SCHEMA in upstream accepts broader numeric syntax than strict JSON and null spelling variants; no claim of strict JSON-number grammar for YAML.
