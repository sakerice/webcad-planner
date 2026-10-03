# Source review file transactions

This follow-up fixes two independently reproduced issues in `ad9770b`. It does not change source geometry, catalogue certificates, native save permissions, or the internal API's memory-only preview contract.

## Delayed comparison files cannot replace later work

A PDF/image read belongs to the review body, source version, request version, file generation and interaction generation at its start. The comparison-file adapter rechecks that ownership before decoding and after decoding. It also checks busy, mapping-editor and applied/partial-opened states at completion.

Opening a mapping editor, switching floors (including switching away and back), or starting Apply advances the interaction generation. Canceling a mapping does not revive an older file operation. A newer PDF and closing/resetting the review invalidate old file generations. Results that no longer own the operation are discarded without staging a replacement review or clearing inputs. If the same review is still present, the status explains that the file was not applied and asks the user to select it again after confirming or canceling their mapping edit.

This supersedes the earlier review-flow README's claim that mapping edits could not be overwritten: the earlier tests did not exercise a PDF that finished while a mapping editor was open, or after partial Apply. Both races are now covered.

## Bounded save/reopen format

Both decode and export use the same **8,388,608 UTF-8 byte** limit. File-size and string-size checks agree for Japanese characters, supplementary Unicode characters, and surrogate replacement bytes.

Small review exports retain version 1. When version 1 would exceed the limit because `sceneIR` duplicates `extraction.rawResponse`, version 2 may replace the structured `sceneIR` with `sceneEncoding: "raw-response-v1"`. This is allowed only when parsing the exact retained raw response yields a Scene IR that is identical to the staged source. The raw response itself is retained byte-for-byte as a string; separate mapping choices remain separate. Both external memo exports and the native “saved evidence” button pass through the same bounded packet codec. The decoder reconstructs the source from that raw and resets approvals, as for version 1. It rejects ambiguous packets containing both the version-2 reference and a separate source object.

If a lossless, bounded export cannot be made, the Save button reports that **nothing was written** and leaves the current review intact. No oversized file is downloaded with a success message. The codec does not truncate, rewrite or replace source evidence. It does not raise the decode limit or claim compatibility with older applications that only understand review format 1.

The large regression uses synthetic annotations added to a copied fixture, not a changed frozen extraction. A schema-valid 5,685,751-byte input saves as 5,699,782 bytes in version 2 and reopens with exact raw equality. In the dedicated browser run, import took about 1.7 seconds, export 0.14 seconds, and resume 1.9 seconds; these are one local run, not a performance guarantee.

## Verification

- Node: real mapping controls, open→cancel, reversed PDF completion, newer file, close, actual floor-change hook with a round trip, pending and completed partial Apply, busy/applied guards, and late failures.
- Browser: six real PDF-decode scenarios preserve unsaved mapping choices and prevent an applied review from reopening.
- Large-file browser: ordinary import, Save download, and reopen of the version-2 file; then explicit one-wall partial Apply, native Save, a fresh browser document reload, saved-workspace load, and the native saved-evidence button. Exact raw, all 256 source annotations, all 20 source objects/deferred entries and the entire stored native report remain unchanged; adoption tokens reset. This closes the native-button route missed by 77269e5, which still serialized duplicate source/raw directly.
- UTF-8 exact-limit and one-byte-over tests; mismatched or oversized raw cannot produce a successful unreadable export.
- Full suite: 1,963 tests, 1,961 passed, 2 existing skips, 0 failures. Syntax, lint and `SKIP_DEPLOY=1` build pass. Ordinary native review/save/resume is rerun separately.

```sh
node --test tools/tests/scene-review-flow.test.cjs tools/tests/json-import.test.cjs
node --test tools/tests/*.test.cjs
node tools/check-html-js.cjs
python3 tools/tests/lint_selftest.py
SKIP_DEPLOY=1 bash build.sh
WEBCAD_PREVIEW_PORT=65372 python3 local-preview/server.py
# Separate shell, Playwright and /usr/bin/chromium installed:
APP_URL=http://127.0.0.1:65372 node tools/tests/scene-review-reference-race.browser.cjs
APP_URL=http://127.0.0.1:65372 node tools/tests/scene-review-large-file.browser.cjs
APP_URL=http://127.0.0.1:65372 node tools/tests/scene-review-flow.browser.cjs
```

No extra AI/paid calls, deployment or source-fact corrections are part of this fix. Full-source reconstruction remains unresolved; partial preview and file round trips are not evidence of full reconstruction accuracy.
