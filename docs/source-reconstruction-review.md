# Source reconstruction review

This candidate keeps the existing source → Scene IR → compiler → native editor pipeline. It makes all full-source blockers reachable during partial review, exposes narrowly audited refrigerator/cabinet/sink representations through existing mapping controls, and adds offline review-file import/export and saved-evidence resume.

Source facts and unknowns remain unchanged. Candidate selection is a separate display decision, not product identification or a measurement. Physical bypass-door motion, stair rise/connections/voids, inconsistent adjacency, unsupported types and unknown required fields remain unresolved. Sink installation height, support, countertop cutout and plumbing are not certified. Full-source Apply-ready remains zero for the three reported source pages; a successful partial preview is not full reconstruction.

Partial Apply followed by native saving existed in the base commit. This candidate does not grant a new persistence permission. The internal API's `memoryOnly:true` preview route and its save prohibition are unchanged. Ordinary Apply requires the existing explicit partial selection and review controls, and stores the full original IR/raw evidence and deferred ledger in the native reconstruction report. Reopening evidence clears approval tokens and does not overwrite manual native edits.

See [file transaction safeguards](source-review-file-transactions.md) for delayed PDF/image handling, interaction generations, Apply races, bounded UTF-8 exports and the version-2 lossless review codec.

## Inputs and reproducibility

The required inputs and GLBs are already tracked in the clean base `0a1af8d3bcf47f1834128fa6dd15302397f22adf`. The frozen v3 2F fixture is `local-preview/frozen-page-2.json`, raw SHA256 `c98e9213665b0527fae907a19d145d8a038db8f82bd049c57b74607add05485c`. The separate public legacy/native three-floor fixture and PDF must not be reported as the missing frozen v3 pages 1/3. Those newer pages are still unavailable following a signed Library transfer 403; no bypass or new extraction was used.

Run commands from the repository root. Node 24, Python 3, Playwright and Chromium are required for the complete browser evidence; no production service, user browser profile or new credentials are needed. Tests use fresh offline profiles. Build with `SKIP_DEPLOY=1`.

```sh
node --test tools/tests/*.test.cjs
node tools/check-html-js.cjs
python3 tools/tests/lint_selftest.py
SKIP_DEPLOY=1 bash build.sh
WEBCAD_PREVIEW_PORT=65372 python3 local-preview/server.py
# Separate shell:
APP_URL=http://127.0.0.1:65372 node tools/tests/scene-review-reference-race.browser.cjs
APP_URL=http://127.0.0.1:65372 node tools/tests/scene-review-large-file.browser.cjs
APP_URL=http://127.0.0.1:65372 node tools/tests/scene-review-flow.browser.cjs
APP_URL=http://127.0.0.1:65372 node tools/tests/scene-storage-sink-native.browser.cjs
```

`tools/audit_storage_mapping_delta.cjs` is a historical comparison tool, not a dependency of the full test suite or build. It additionally requires Git object `6a6491d9beb4b0e3435e45481f49f13fec9f7a71`; a source-only squash does not provide that history. The separate private review-history bundle preserves exact comparison commits.

Large generated diagnostics, duplicate raw/report exports, screenshots and full logs are retained in the review artifacts rather than added to this public candidate. The original QA commits are preserved separately. No new source correction, paid call, deployment or production plan change is authorized by this candidate. Keep the PR in Draft pending independent review of the transaction fixes and UI.

Follow-up 8d1e2e7 routes the saved native evidence button through the same bounded packet codec. A 5,685,751-byte valid Unicode synthetic performance fixture, generated from a copy without changing the frozen raw, was explicitly partially applied, saved through the native UI, loaded after a fresh browser document reload, and reopened with that button. Raw, all 256 source annotations, all 20 original object/deferred entries, and the entire stored report remained unchanged; review approval tokens reset. Machine-readable results are retained in the separate review artifact.
