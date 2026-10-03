# Bounded v3 reconstruction checkpoint

This is a local, experimental implementation, not a production release or a complete whole-scene fidelity claim. v1 stays the default image route. The immutable `source-preview.1` extraction packet remains unchanged; these additional renderer capabilities are a separate implementation checkpoint.

## What works

- Source-first schema validation and semantic diagnostics retain original facts, annotation bases, logical room shapes, source envelopes/fronts, colors, relative levels, site regions and independent physical gaps/leaves
- Real image-route dispatch, async job persistence/polling and client staging, exercised through mocks only. Explicit OpenAI JSON mode sends the exact packet, then local validation; it does not misrepresent optional fields/nested oneOf as provider-enforced strict schema
- Feature flag defaults off. Existing IP quota must be healthy. Server advertises availability; client opt-in requires advertisement. One image, no hints, no automatic revise/finish/fallback or second model call. Raw output and hashes are saved before parse
- One editable polygon room per logical source room, using canonical geometry for floor/ceiling meshes, picking, labels, movement, heights, support and save/load. Rectangular legacy rooms keep their old representation
- Exact procedural single swing pivot offsets and single-pocket panel/travel/cavity, plus exact source aperture widths. Static windows use actual runtime vertical normalization. A <=1 mm nominal own-jamb contact allowance is reported explicitly where needed; no zero-collision claim
- Reachable local review controls for exact catalogue/appearance correspondence, deliberate source-envelope scaling, and regional color/source-only choices; cancelled and stale controls cannot apply changes. See [mapping review](V3-MAPPING-REVIEW.md).
- Explicit catalog/appearance decisions separate from raw extraction. Native dimensions cannot replace known source envelopes. Known fronts require audited axes; active car +Z is hash-pinned and procedural fallback is rotated to match it
- Relative first-floor finish mapping with reviewed editor reference datum, fixed-ceiling lowered entry, square tile module and unpatterned flat room appearance
- Additive Apply, one undo, source/report/decision preservation and exact source geometry after normalization/reload

## Safe boundaries

- Pure source preview remains the default `SceneIRV3.compile` mode. Bounded materialization requires `materialization:'bounded-v3'`; every inference/default/model representation remains reviewable
- Review keys include source, binding, concrete defaults, height settings and catalog metadata. Changed source or runtime assumptions invalidate acceptance
- Separate binding decisions carry an unchanged source snapshot. Raw extraction is never amended using fixture truth. Test-only mapping simulations are clearly marked, never treated as user approvals
- Core room/door/level/circulation failures cannot be acknowledged away. Annotation-only symbols remain source diagram overlays, not furniture blockers
- Site regions are read-only 2D source overlays. Explicitly unrenderable appearance regions can remain source-only only with separate reviewed decisions; output status stays incomplete
- Paired/fold/other unimplemented mechanisms and conflicting signed source kinematics remain blocked. Known unsupported pattern/module/region details are not silently mapped to defaults
- Source leaf flips, resizing, rotation and direction presets are disabled until a coherent source-aware edit exists. Movement/open state remain available, but the import validation report is a historical snapshot, not live collision certification
- v3 is local-only. Apply into an active shared room, creating a shared room from v3 DATA, cloud save and shared sync are blocked. Same-version serialization tests are not mixed-client capability negotiation

## Verification and demonstration

Node/VM tests cover real constructors, actual THREE geometry, real normalizers, server quota/job/R2 mocks, false-success cases and additive lifecycle. Browser visual QA could not run because the environment rejected browser launch/local access. Do not treat VM/THREE tests or CPU SVG rendering as browser QA.

The full-scene fixture demonstration uses the unchanged blinded raw extraction plus a separate `simulationOnly:true, notUserApproval:true` mapping artifact. It reproduces the logical L, three rooms, seven walls, five openings and three mapped objects through Apply and reload. Checked values include entry -150 mm, tile 300 mm, pivot inset 100 mm, pocket gap 900/panel 940/travel 940, car source 1800×4400 and north front. All four site regions and the car's unrenderable second/top color remain explicitly source-only.

`tools/simulate_scene_ir_v3.cjs` is a local test harness requiring a test-only decision packet and matching raw hash. It never calls a model or grants product approval. The actual existing JIS SVG exporter can run against its saved DATA, but intentionally omits movable furniture/car, colors and source site overlays; its output is an architectural line export, not a whole-scene screenshot.

No live paid API calls, credentials changes, pushes, main merges or deployment were performed. Build verification uses `SKIP_DEPLOY=1`.
