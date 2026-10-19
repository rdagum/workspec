# STORY-000001 — Make the YAML engine lossless-or-loud

Source: `.workspec/items/STORY-000001.md`, `docs/REVIEW-2026-09.md` §1.2 A1 and §4 findings 1, 4, 5, 9, 10.
Gates (this repo, per CLAUDE.md): `node --test`, `node tools/validate-workspec.js .workspec`.
Every step ships its own fixture/test. No new dependencies; browser code path unchanged.

- [x] 1. Strict parse: `parseMapping` throws (with a 1-based line number) on a line indented deeper than its mapping and on a non key/value line. Tests in `test/yaml.test.js`; confirm `parseItem` lands the error in `record.errors`; fixtures that must be rejected live in tests (strings), not in `fixtures/items` (which must parse cleanly).
- [x] 2. Unquoted trailing ` # comment` stripped from scalars (quotes respected, `#` without leading space kept). Flow mappings already parse (keep), unparseable `{...}` throws instead of becoming a string.
- [x] 3. Symmetric scalar escaping: `parseScalar` unescapes `\\ \" \n \t`; `serializeScalar` escapes `\ " \n \t`. Fixture `quoted.md` extended with backslash/tab cases; round-trip tests.
- [x] 4. Multi-line strings without trailing newline serialize as `|-`; with trailing newline stay `|`. Fixture + round-trip test.
- [ ] 5. `patchScalarLine` anchors the key at column 0 (nested `agent.status` never patched). Test.
- [ ] 6. Round-trip guard: `parseItem` computes `record.lossy` (content differs after `stringifyYaml(parseYaml(fm))` with whitespace/comment lines/quote style normalized). `store.saveItem` and `ui/editor.js` honour it: lossy items open raw-YAML only and save raw text verbatim. Tests in `test/parser.test.js` / `test/store.test.js`.
- [ ] 7. Docs: README "Notes & limits" describes the round-trip guard; demo repo `.workspec-demo` still loads with zero errors (test). Full gates.
