# v3 checkpoint and next implementation gate

Historical plan at the source-freeze checkpoint. The subsequently implemented bounded local runtime is documented in `V3-BOUNDED-CHECKPOINT.md`; frozen extraction packet files remain immutable.

This checkpoint is a source contract and pure staged preview, not complete reconstruction. The v1 image route remains the default. v2 archived scenes keep their compiler. v3 never falls through to v1 or receives rectangular DATA approximations. `SceneIRV3.compile` retains source facts, derives polygon preview geometry, reports mapping differences and returns `canApply:false` even if all facts are observed or review/omission options are supplied. `valid` describes source/schema consistency separately from materialization eligibility. No v3 DATA/shared persistence is claimed.

## Reproducible extraction freeze

Run `node tools/freeze_scene_ir_v3.cjs`. The JSON Schema is generated from the same descriptors used by the runtime validator, preventing schema/validator field drift. `freeze-v3.json` hashes schema, prompt and capabilities. Its input set excludes fixtures, truths, previous raw extractions and review prose. Fresh extraction receives only this packet and the authorized original image. Save original raw response, image hash, packet hashes, provider/model and request contract before parsing. Never patch raw extraction based on truth. New corrections are independently versioned review decisions or a fresh extraction.

The validator supports its emitted bounded JSON Schema subset; provider adapters must explicitly verify their structured-output support for nested oneOf/additionalProperties before being enabled. Source type/shape validation is separate from later runtime fidelity checks. Current checks include finite/safe fields, evidence state and refs, logical room simple connectivity, dimensions with optional independent chain total, semantic reference types, unit directions and catalog mismatch warnings. It does not certify opening collision, region subtraction occupancy or full object containment, and it does not claim all geometry constraints have been solved.

## Mock image-route integration, no paid calls

1. Extend import-plan request with allowlisted `extractionContract:'scene-ir-v3'`. Require an explicit server feature gate plus eligibility. No parameter means unchanged v1. Deny unknown or unauthorized contracts before provider work. Do not accept external prompt/schema/catalog URLs.
2. Persist contract and freeze hash in the job. For mocks, inject a provider adapter which returns a frozen synthetic v3 response. Reuse actual upload/auth/quota/job/poll code paths without invoking paid services. No automatic second call or v1 retry for v3 failures.
3. plan-result dispatches based on persisted contract, validates v3 with the exact frozen schema and semantic validator, and returns raw plus typed source and validation diagnostics. Never run v1 normalize/grid/finish logic over v3. Failure remains diagnosable and cannot be mistaken for legacy success.
4. Existing client `stageSceneIR` uses explicit version routing. Add an experimental image-read toggle only after UI review. Until a v3 revise contract exists, block legacy revise on v3 jobs before the request. Show source facts separately from bindings and materialization blockers. The preview result carries source polygons, objects and openings without writing live DATA.
5. Mock tests: flag-off v1 golden requests/responses; unauthorized v3; nested provider-schema contract; polling contract retention; malformed v3 no fallback; v3 raw hash preserved; pure stage; forced Apply cannot mutate; revise blocked. Live extraction is a separate authorized evaluation using the same packet.

## Next bounded materialization checkpoint

Implement shared `roomGeometry` helpers and one logical DATA room shape, with legacy rectangle fallback. Explicit walls remain explicit. No virtual seams, independently editable tessellation rooms, or legacy wall inference. Inventory/update actual floor/ceiling builders, hit-testing, furniture containment, labels, room height lookup, move/resize/delete, save/load/undo and shared delta producers/consumers before claiming polygon support. Canonical polygon bounds are a derived cache, not occupied area. Verify L/stepped room floor continuity and entry exclusion, including boundary-basis handling against incident wall thickness.

Then add explicit source-to-catalog decisions for existing compatible assets: retain source envelopes/fronts, require verified canonical front metadata for exact rotations, report native dimensional deltas, and apply reviewed scaling only when requested. Offset pivots/pocket dimensions remain blocked until renderer and compiler share that exact geometry. Site overlays and unsupported stair/fold diagrams may remain typed preview-only; they must not be declared faithful physical 3D.

Release gates: additive Apply and one undo; source/decision persistence; shared two-client round-trip including mixed-version read-only protection; mocked image route staging; browser 2D/3D review against original source. General v1 default changes require a separate decision. Local tests/build use `SKIP_DEPLOY=1`; no push, main merge or deploy is part of this checkpoint.
