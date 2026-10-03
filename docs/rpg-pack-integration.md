# Asset pack candidates in the existing editor

The existing catalogue search card now offers **日本建築標準** and **RPGアセット**.
RPG selects 14 original mansion assets. Switching filters candidates and search;
it does not convert or remove any placed object. The existing picker card, icons,
placement, model loader, renderer, JSON and history paths are reused.

## Verified baseline and preservation

- Remote PR72 branch: `codex/unified-source-faithful-multifloor-20261002`.
- Verified baseline commit: `0a1af8d3bcf47f1834128fa6dd15302397f22adf`.
- Verified baseline tree: `531637b6ab49e890391562b2066cb1176ced64c3`.
- Preserved prior work: `cloud/rpg-preserved-a6d20a0` at
  `a6d20a0ef427f1d3e6ae4b308c63d4350f1d45e0`.
- Non-destructive merge: `a8c592ee44b4a08dfc95076c4201ace36bc833c4`, tree
  `bfeba3419d610b039d4a0375a3efdfd16db27400`.
- Implementation branch: `cloud/rpg-asset-pack-c072` (preserved locally).

The unavailable Library recovery ZIP was not bypassed. The authorized Git remote
provided the new baseline; its hashes matched exactly. No forced reset, discarded
changes or remote pushes. The 14 reviewed GLBs, Blender sources, pack manifest,
geometry sidecars and standalone pure registry remain byte-identical to their
reviewed versions. Their historical `baseCommit`/`status` describe the asset
snapshot provenance, not this later runtime integration. The two earlier Library
ZIPs remain preserved.

## Runtime wiring

- `app-constants.js` loads the optional RPG manifest alongside existing sources.
  The pure `AssetPackRegistry` validates additions before the existing `FMP_ITEMS`
  lookup receives them. Invalid/colliding RPG registrations are rejected without
  replacing legacy IDs. Existing 787 model IDs remain; the combined lookup has 801.
- `asset-pack-picker.js` adapts the existing sidebar to the pure membership
  registry. It adds one labelled select inside the existing search card, scoped
  to that editor document. Native candidate descriptors are included without
  renaming IDs; common selection/undo/colour/settings controls remain available.
- Candidate switches toggle existing card/category visibility and update existing
  search results/counts. Cards are not rebuilt; manifests and GLBs are not reloaded.
  `asset-catalogue.js` excludes hidden source cards from its existing search.
- A pending placement tool that belongs to the previous pack is cancelled to
  selection. Already-selected objects, placed data and history are retained.
- `parallel-editors.js` stores `cataloguePack` beside pane history/view metadata,
  **outside plan DATA and camera-sync state**. Stash, pane reassignment and saved
  comparison workspace restoration retain each plan's own candidate preference.
  Older records without the field default to 日本建築標準. Standalone editor pack
  selection is transient; no new field is added to exported plan JSON.
- Missing thumbnails keep the card/name selectable and use an existing menu icon.
  Missing/unknown optional pack selection falls back to 日本建築標準. Unknown placed
  IDs and failed model loads retain original data and use the existing renderer's
  generic fallback. Pack selection never limits the all-model lookup.

The control lives inside each pane's existing picker. There is no new top-level
single-plan operation, separate asset gallery, renderer or avatar controller.

## Validation

- `sh tools/run_tests.sh`: all 186 `*.test.cjs` files processed plus lint self-test;
  runner `exit=0`. This is a file count, not a count of individual test cases.
  Browser-dependent tests may use their existing environment-based skips; the
  dedicated browser suites below were run explicitly with installed Chromium.
- Pure registry + geometry contracts: registry 11 + geometry 5 = **16 distinct
  tests**. The earlier portable five are a rerun of the same geometry tests.
- `asset-pack-picker.browser.cjs`: real picker+canvas placement, native undo/redo,
  unchanged prior IndexedDB plan content, JSON download/reimport, repeated mixed
  IDs, independent pane filtering/search, per-pane save, comparison save/reload,
  third-plan preference restore, unknown/missing-pack/model fallback and missing
  thumbnails. Also checks the existing mobile tools sheet at 390px.
- 100 alternating switches with a mixed plan in real 3D: model cache 2→2,
  geometries 27→27, textures 18→18, GLB requests 2→2, render calls 5→5. Plan JSON,
  history, redo and dirty state were unchanged. Observed switch time mean 2.54ms,
  max 10.8ms on this local software-WebGL fixture; not a mobile-device guarantee.
- Existing native-header and save/reload browser regression results are retained
  with the final handoff evidence. Linux runs adapt only the test harness's Mac
  executable/Metal launch options to `/usr/bin/chromium`/SwiftShader; application
  logic is unchanged.
- `SKIP_DEPLOY=1 bash build.sh`: schema/certificate checks and dist build passed;
  no deployment. Source diff whitespace check passed.

Screenshots and machine-readable results:
`tools/assets/rpg-pack-contract/integration-evidence/`. Desktop comparison shows
the two packs and a mixed 3D scene with independently recoloured chairs. Mobile
capture uses the existing sheet at its search card; only the offline preview
harness banner is hidden in that capture. No product controls are hidden.

## Run locally

```sh
WEBCAD_PREVIEW_PORT=8947 python3 local-preview/server.py
# Fresh browser profile; no user tabs, AI, shared service or external API calls.
APP_URL=http://127.0.0.1:8947/ node tools/tests/asset-pack-picker.browser.cjs
sh tools/run_tests.sh
SKIP_DEPLOY=1 bash build.sh
```

`PLAYWRIGHT_MODULE`, `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` and `RPG_REPORT_DIR`
can override the integration test's installed tooling/output. The pack itself
requires no new runtime dependency. Existing local-preview server retains its
offline restrictions. Deployment remains outside this handoff: no manual wrangler deploy/versions upload,
main merge, automerge or main push. After independent review, the user authorized
a separate feature-branch push and a draft PR dependent on PR72.

## Remaining scope

Measured support surfaces and chair sockets are **sidecars only**, not connected
to placement/TPS. No automatic support-plane placement, avatar sitting,
reachability, pelvis alignment or safe-exit behavior is claimed. Tabletop props
still carry the earlier 750mm hint, so floating/incorrect tabletop height is not
fixed by the pack toggle. Existing manual height controls remain available.
The glass is opaque stylized mesh; the clue stain is a 1mm mesh, not a projected
decal. The measured 0.786m desk, 0.635m table and 0.5135m seat contracts remain ready
for the separate placement/TPS adapter. No avatar controller was added here.

Runtime behavior was checked in local Chromium/SwiftShader, not on a physical
mobile GPU or deployed production site. This is a reviewable feature branch;
deployment and publication are not part of this handoff.

## Additional pre-publication review

`node tools/tests/asset-pack-delayed-model.browser.cjs` gates the chair GLB response
in three fresh Chromium contexts. While the request is pending, each case switches
to the standard pack and cancels the pending placement tool. It then (1) undoes
the chair placement, (2) reselects the RPG pack and desk candidate, or (3) replaces
the pane's plan. After releasing the GLB response, current plan/history/dirty/tool/
pack state and the other pane remain unchanged. Scene selection references show
only the still-placed chair in case 2, no removed chair in cases 1/3, and no
unplaced desk. These three deterministic success-response cases passed; they do
not cover every possible network failure or race.

Publication review of the RPG delta from `0a1af8d`: credential/private Library URL
patterns were absent; the one environment-specific worktree path in this document
was removed. The exported mixed-plan fixture and browser captures originate from
synthetic tests, not user plans. Existing QA text logs total less than 5KB, with
no individual log over 2KB. Source `.blend` files and model/review images are
intentional deliverables. Earlier reviewed Library artifacts remain intact.

The draft PR targets main but depends on **PR72**: its base `0a1af8d` is part of
that unmerged PR, so the main-relative diff includes overlapping PR72 work. Review
the RPG-specific delta against `0a1af8d`. Integrate PR72 first, then reconcile the
RPG branch and merge only its remaining changes; do not merge overlapping work
as independent implementations. Manual-source workflow changes, automatic support
height and TPS integration are outside this RPG change.
