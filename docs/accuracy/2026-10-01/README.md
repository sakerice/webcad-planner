# Floor-plan reconstruction accuracy: 2026-10-01

This is an **offline, synthetic geometry evaluation**, not an Astra/image-recognition benchmark. No hosted model requests were made, no credentials were read, and no drawings were transmitted. The five fixtures represent known extraction coordinates; they isolate what the assembler does after recognition. The 100 mm strip is a geometry stress case, not a proposed habitable room.

Baseline: `d41e98db4f08a74e617752aa4168e05284896b43` (main at branch creation).

## Same-fixture results

| Fixture | Labelled area error before (mm²) | After (mm²) | Opening center offsets before (mm) | After (mm) |
|---|---:|---:|---|---|
| Metric 1000 mm partition | 180000 | 0 | 90, 0 | 0, 0 |
| Narrow 100 mm strip | 200000 | 0 | 100 | 0 |
| L-shaped exterior recess | 188100 | 0 | 90 | 0 |
| Courtyard | 293906.25 | 0 | 90 | 0 |
| Conventional 910 mm module | 0 | 0 | 0 | 0 |

Opening centers on a wall: **2/6 → 6/6**. Rooms lost: **1 → 0**. The narrow-strip fixture loses its A/B adjacency before and preserves it after; all other expected adjacency graphs are preserved. These are geometry attachment and adjacency measurements, **not door/window detection accuracy or navigable connectivity**.

- Labelled area error is the exact area where expected and reconstructed room labels differ, including outside vs inside. The evaluator subdivides at all expected and actual boundaries; it does not use approximate raster sampling.
- Opening offset is the shortest perpendicular distance from an annotated center to a same-orientation wall spanning that center. Tolerance for “on wall” is 0.001 mm. It does not check opening width, swing, identification, or destination-room correctness.
- Adjacency means two differently named room rectangles share a positive-length edge. Touching at a corner is not adjacency.
- Expected and actual rectangle geometry, labels and positions are the same inputs to both implementations. No claim is made that a model would read them correctly from an image.

Machine-readable results: [before.json](before.json), [after.json](after.json).
Visual comparisons: [partition before](before/metric-partition.svg), [partition after](after/metric-partition.svg), [narrow strip before](before/narrow-strip.svg), [narrow strip after](after/narrow-strip.svg), [recess before](before/l-shaped-recess.svg), [recess after](after/l-shaped-recess.svg), [courtyard before](before/courtyard.svg), [courtyard after](after/courtyard.svg).

## Root causes and changes

1. `PlanGrid` used a fixed 227.5 mm grid plus cell-center sampling. Exact 1000 mm coordinates became 910 mm. Rectangle readings now use their own validated boundary coordinates, preserving the existing wall/room topology algorithm and output schema. Legacy cell/grid input retains its convention. Existing saved plans do not run through this assembler.
2. Invalid, out-of-bounds, overlapping or excessively dense rectangle geometry now produces diagnostics and no partial reconstruction. A maximum of 256 coordinates per axis bounds cell allocation. One invalid floor invalidates the reconstruction of the complete reading. The Worker returns HTTP 422 with diagnostics instead of offering partial geometry as an import candidate. This does not modify the application's import/apply transaction boundary.
3. The review gate previously saw room counts and area totals, so an overlap and equal-sized gap could cancel. It now includes assembler diagnostics and cannot skip review for invalid geometry, even if a classifier would give it a high score. A test verifies this without making any model call.
4. The review image outlined each rectangle part, falsely dividing L-shaped rooms, and drew the bounding rectangle as a heavy exterior wall. It now draws each room's union perimeter and separate dimension lines. Courtyards, overlaps within one room and partial shared edges are regression-tested.
5. The prompt's room-area check previously demanded equality with `width × depth`. It now compares to the observed interior outline, retains exterior recesses/courtyards, and records uncertainty in notes. This instruction change is **not model-evaluated**.

## Reproduce

Run from repository root:

```sh
git show d41e98db4f08a74e617752aa4168e05284896b43:assets/js/plan-grid.js > /tmp/plan-grid-baseline.cjs
node tools/benchmark_plan_geometry.cjs /tmp/plan-grid-baseline.cjs /tmp/accuracy-before > /tmp/accuracy-before.json
node tools/benchmark_plan_geometry.cjs assets/js/plan-grid.js /tmp/accuracy-after > /tmp/accuracy-after.json
node --test tools/tests/plan-*.test.cjs tools/tests/worker-routes.test.cjs
node --test tools/tests/*.test.cjs
SKIP_DEPLOY=1 bash build.sh
```

Run the build **after** tests, not concurrently: the deploy-guard tests themselves run `build.sh` and share `dist/`. The first broad run collided with a simultaneous build; the isolated deploy-guard rerun passed all 10 tests and the separate no-deploy build passed. Targeted suite after review fixes: 288 passed. Full suite: 1318 passed, 2 skipped, 0 failed. Full final results are recorded in `validation.txt`.

Transport-only tests previously used empty-room successful model responses; they now use a valid synthetic rectangular room. Their assertions still exercise transport, usage, quota and review behavior. No recognition result is inferred from these mocked responses.

## Pipeline inspected and remaining work

- Provider routing: import defaults to OpenAI `gpt-6-astra` when OpenAI is configured; endpoint is `https://api.openai.com/v1/responses`, background jobs with polling, images use `detail: high`. Vertex remains the alternate provider. This describes source-code routing, not verified live account configuration. Header comments in `routes-ai.mjs` still describe older Vertex-only residency and should not be treated as the current privacy contract.
- Browser preprocessing: white background, PNG, up to 3072 px. PDF.js renders each page and a 1024 px locate image; successful locate crops are rerendered from PDF at 3072 px. Locate can use Vertex Gemini or OpenAI fallback. The bundled PDF is present but no model evaluation was performed on it.
- Intermediate representation: per-floor mm rectangles, dimensions, items and optional notes/marks. Saved-plan schema remains unchanged. Explicit coordinates can still be incorrectly extracted; preserving them faithfully does not establish their truth.
- Dimension chains are collected and summarized but not yet reconciled into corrected coordinates. Missing-measurement/provenance semantics need a separate compatible schema change; the OpenAI strict-schema adapter currently forces optional fields to be supplied.
- Coordinate preservation may expose tiny contradictory overlaps that fixed-grid sampling previously concealed. These now require correction/retry rather than silent guessing. No automatic tolerance-based snapping was introduced.
- Room adjacency is tested locally; opening type, width, rotation, target wall/room connectivity, OCR, scale, image crop quality and cross-floor registration still need real image ground truth and authorized model runs.
- Audit follow-ups outside this change: duplicate floor renumbering, dropped page notes in multi-page merge, page-local cross-floor stair assumptions, and dropped `room.use` during application. These were not silently bundled into this PR.
- No main push, merge, deployment, external document upload or paid API request occurred. For a real end-to-end comparison, obtain explicit authorization for synthetic image data sent to the endpoint/model above and a bounded payment budget. A proposed first batch is five images, one request each, with a US$5 total cap and no automatic locate/revise calls; verify actual model availability/pricing before executing. This is a proposed budget, not measured cost or spending permission.

## Independent review follow-up

The first draft rejected bad geometry before the browser could invoke revision. HTTP 422 now retains raw `pages`, usage, and an explicit `revisionCandidate` marker, but never a `plan`. The browser permits one existing revision pass for this candidate and only enables Apply after the Worker validates its repaired output. Quota errors, network errors, no render, and still-invalid repairs leave the result unset and Apply disabled. A five-case browser-orchestration/real-Worker-route regression uses a mocked OpenAI transport; no hosted model is contacted.

Distinct coordinate lines separated by 1 mm or less now produce diagnostics and no walls, rather than silently generating near-coincident full-thickness walls. This is a review requirement, not snapping: input values remain unchanged. Tests cover 0.001, 0.5 and 1 mm gaps; the exact 100 mm stress case remains valid. This conservative rule may flag small offsets even when they occur in different parts of a floor; such readings require review rather than guessed correction.

## Review visuals and wider deterministic coverage

[Three-panel source/before/after PNG](source-before-after.png) shows the 90 mm partition drift explicitly. It visualizes specified coordinates and reconstruction, not image recognition.

`plan-opening-objects.test.cjs` additionally exercises actual Worker assembly, `toAppObjects`, real `mkItem`, wall attachment, adjacent-room lookup and walk-gap semantics for five supplied opening types. It checks center/width/depth/rotation preservation, same-floor matching, door vs window properties, catalog fallback and windows remaining excluded from door-only walk gaps. These are object-generation regressions, not detected-opening accuracy or a 3D/browser rendering test.

The [blinded native input package](native-sources/README.md) keeps source PNGs and exact prompt/schema separate from expected JSON. It is prepared for approximate assistant-model evaluation only; no predictions have been scored yet. [Unknown-dimension audit](unknown-dimensions-audit.md) documents the contract changes still needed without changing that schema in this PR.
