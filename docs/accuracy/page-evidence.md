# Preserve extraction page evidence

This follow-up is independent of the geometry changes in PR #66. It changes page assembly and one room metadata copy; it does not alter the saved-plan schema, current-plan mutation rules, or hosted model selection.

## Reproduced failures

- Page 1 containing floors `[1,2]` followed by page 2 containing floor `[2]` previously produced `[1,2,2]`. The fallback to `page index + 1` did not even guarantee a unique identity.
- Three repeated floor-1 sheets previously became floors `[1,2,3]`, inventing two floor identities without evidence.
- Joining multiple pages retained only `floors`, discarding their top-level uncertainty notes.
- `toAppObjects` rebuilt rooms but omitted `use`, losing the image reader's classification before the editable room was stored.

## Resulting behavior

`mergeReadPages` preserves explicit unique floor numbers regardless of PDF order. Duplicate, missing, non-integer, unsupported, or unidentifiable multi-page floor identities return HTTP 422 (`ai_ambiguous_floors`) without any applicable or partial plan. The response preserves raw pages, uncertainty notes and usage, and explicitly disables automatic page-local revision: an independent rereading cannot establish which conflicting sheet is authoritative. The UI tells the user to select the intended floor drawing and supply its floor number.

Unique page notes retain a page-number prefix in the existing notes channel. Original notes remain unchanged in `pages`; successful responses retain the existing 20-note display limit. Import, revision and background polling use the same assembly helper. Existing single-page legacy wall/label responses pass through unchanged. Numeric-string floor labels remain accepted. Room `use` is copied only when provided as a nonempty string; no default is invented, and input objects are unchanged.

## Local regression evidence

`tools/tests/plan-pages.test.cjs` covers non-sequential page order, the two reproduced duplicate-floor cases, duplicates within one page, null/missing/zero/fractional/out-of-range identities, no partial candidate, retained notes, legacy single-page input and editable room-use preservation.

`tools/tests/worker-routes.test.cjs` covers the real import/revision/polling handlers with mocked provider responses and verifies page-note provenance. Transport success tests now supply distinct floor numbers rather than relying on automatic renumbering.

These tests make no real hosted model requests and establish no OCR/recognition accuracy claim. Remaining work includes selecting individual PDF pages in the UI, explicit user resolution of duplicated sheets, and recognizing uncertain floor labels from actual images.

Validation on this branch: targeted plan/Worker tests 273 passed; full Node suite 1303 passed, 2 skipped, 0 failed; `SKIP_DEPLOY=1 bash build.sh` passed. This branch starts from main `d41e98d`, not the PR #66 branch, so its test count excludes PR #66's additional tests. Local logs: `/tmp/page-evidence-targeted.log`, `/tmp/page-evidence-full.log`, `/tmp/page-evidence-build.log`.
