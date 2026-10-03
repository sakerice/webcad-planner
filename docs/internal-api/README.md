# Current internal API catalogue contract

This directory records the corrected current request/response shapes. It is
separate from the frozen `5fa5282` clean packet and both completed candidate
runs. Those archives, ledgers and results remain byte-for-byte unchanged.

Catalogue IDs use the existing `SceneCatalogue.cleanId` allowlist:
`^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$`, excluding `__proto__`, `constructor`
and `prototype`. Both `read_catalog.ids` and object binding `catalogId` use
this same validator. They still require exact current registry membership.
IDs remain identifiers; there is no path, file, alias or network resolution.

Plan IDs and binding sourceEntityId keep their existing
`^[a-zA-Z0-9_-]{1,100}$` check. JSON key/prototype, depth, size, source
membership, revision, dependency, physical compiler and approval gates are
unchanged. The binding catalogue must still be non-opening. Of the five
previously rejected period IDs, all five can now be queried, three can enter
ordinary object bindings, and two window models still reject furniture
binding with `unknown_catalogue`. The opening compiler remains the supported
window path; this change adds no renderer or geometry capability.

`read_catalog.response.schema.json` lists all three current material audit
statuses: `unreviewed`, `asset-and-code-audited`, and `audit-mismatch`. An
asset/wiring mismatch retains unverified metadata and requires a new audit.
It does not silently become verified.

API version 1 and scene-catalogue-v1 are unchanged. Use the code/schema hash
and Git commit when pinning this additive identifier correction. Frozen
5fa5282 callers retain their earlier ID/status-schema limitations.

Regression coverage uses a separate synthetic source. Node and browser
contract callbacks return metadata only; they do not claim pixels or native
editor rendering. The browser check uses a fresh profile and dedicated port
65353, blocks external and /api/ traffic, and refuses candidate-run port
65352 and the protected 63239/65236 ports. It reads no candidate run ledger.

```sh
node --test tools/tests/editor-internal-api-catalogue.test.cjs
WEBCAD_PREVIEW_PORT=65353 python3 local-preview/server.py
APP_URL=http://127.0.0.1:65353 OUTPUT_DIR=/tmp/webcad-catalogue-contract \
  node tools/tests/editor-internal-api-catalogue.browser.cjs
```

Validation for this correction: targeted suite 53/53; full Node suite
1876/1876; real-browser contract checks passed for all five queries, three
non-opening bindings, both retained opening guards, one normal binding,
21 invalid values, plan/source constraints and unchanged host/storage.
The browser's four completed metadata callbacks are fixture operations,
with zero native renders, paid calls or AI candidate preview calls.
