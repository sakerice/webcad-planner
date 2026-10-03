# Scene IR v2: bounded reconstruction compiler

Status: local experimental implementation based on `d41e98d`. It is **not** a replacement for the image-reading endpoint, a completed extraction redesign, or proof of image reconstruction quality. No paid model calls are required by this code.

## Architecture and safety boundary

- `assets/js/scene-ir.js` validates a versioned, evidence-bearing extraction and compiles only an allowlist into ordinary editor DATA objects
- `scene-catalogue.js` derives exact IDs, native dimensions and supported finish channels from the actual loaded manifests and built-ins; it excludes legacy aliases such as `desk -> fmp-Table01` and removed `tv`
- `scene-opening-geometry.js` owns the procedural door leaf/motion dimensions used by the actual 3D renderer and the compiler. There is no 40-point backing-wall sampling in this path
- Existing image extraction, saved-plan format, legacy nearest-wall import and v1 schema remain available. New imported openings have an additive `openingHostWallId`. Existing objects without it retain their old behavior
- `PlanImport.previewSceneIR(scene)` is pure with respect to live DATA, IDs and undo. `stageSceneIR(scene)` populates the existing review dialog only. The existing Apply action revalidates against current catalogue/height settings, allocates/remaps IDs, preserves existing work and uses one undo entry
- Strict scenes skip the legacy fixture picker, automatic slider flipping and global legacy furniture migration. Repeated Apply on the same staged strict scene is a no-op
- The IR and full diagnostic/evidence report remain available in the staged compiler result and persist separately in additive top-level sceneReconstructionReports. Original source, mapped IDs, import translation, defaults, review decisions and explicitly unplaced entities survive local save/load/export and undo. They are not arbitrary geometry properties

## Evidence and gating

See `schema-v2.json` and `extraction-prompt-v2.txt`. Every source-bearing field is `{value,status,source?,reason?}`. Status is `observed`, `inferred` or `unknown`. Unknown has `value:null`; observed/inferred facts need a source reference, and inference needs a reason.

Diagnostic severity:

- `error`: invalid geometry, unresolved required type/pose/reference, unrepresentable observed parameter, unsupported datum or unsafe property. Apply is blocked; partial valid objects are available for inspection but are not silently applied. Eligible unresolved furniture can be explicitly classified by the user as noncritical decoration and acknowledged leave-unplaced; the omitted record remains visible and persisted, and the result is labeled incomplete. Stairs/circulation, unsafe fields and physical-fit errors cannot be waived
- `review`: exact catalogue choice inferred from a symbol, or non-native asset scaling. An explicit path in `acceptedReviews` or an object-level acceptedReviewGroups decision is needed. Expandable object groups in the existing review dialog retain field-level evidence and allow explicit object-level confirmation
- `warning`: ordinary missing/unknown noncritical heights, finishes and similar values. Preview/Apply can use the identified editor default. No default is marked source-observed

Suggestions, such as tile for normalized 玄関/浴室/洗面所 use, are not applied automatically. Native asset height/appearance and default mirrors/elevation are reported separately from source measurements. Product selection and footprint are distinct: an exact asset ID does not establish that the product appears in the drawing.

## Supported first slice

- Axis-aligned walls and rectangular rooms in mm; room bounds are corners, opening/furniture poses are centers until one final conversion
- Explicit wall/adjacent-room references; complete span fit, no silent snapping or clamping
- Procedural swing/front doors: world hinge/latch and swing-side conversion, across all wall directions/reversed endpoints
- Single sliders/pocket doors: actual `w+60mm` leaf and `w+30mm` travel, continuous exact backing for the complete closed-to-open leaf envelope (including the extra 30 mm at the closed end), other wall openings and swept-wall collisions
- Two-leaf bypass door-slide: actual `0.54*w` leaves, `0.46*w` travel inside the opening. The renderer only supports the moving track on positive host normal; an unrepresentable opposite track is rejected
- Windows/window-door: strict host/span and actual runtime vertical normalization; moving sash trajectories are explicitly not modeled
- `door-opening` and required room-to-room traversable connections. Stairs cannot substitute for wall apertures
- Explicit room `floorRaiseMm`, `skipLevelMm`, `floorMaterial` and `floorColor`. Negative finish offsets require an already-v2 target height model and must fit its slab bounds. They do not shift the ceiling
- Exact furniture/catalogue placement with mirror, rotation, elevation/support references, rotated full footprint checks, real finish colors/textures/roughness channels; built-in car uses generic color
- `floorDatum:'target-model-finish'` is required for numerical absolute finish offsets. A source relative annotation is represented by `{relativeToRoomId:...}`. The bounded resolver supports first-floor reference rooms at the same structural level, verifies actual offset bounds, and preserves the original observed delta separately from the derived absolute editor offset. A known reference offset works directly; inheriting the editor reference-room default requires explicit review and is labeled an assumption, never a source measurement. A drawn `−150` is not silently reinterpreted as the application's absolute offset
- Registered texture IDs only. Unknown IDs, remote URLs, prototype fields, arbitrary `item.h` and silently ignored generic FMP color are rejected

## Explicit limitations

- RELEASE BLOCKER for general replacement: rectangular-only logical rooms regress v1 multipart-room representation. Keep v1 available until a successor shape schema/compiler preserves multipart continuity without virtual internal walls.
- sceneReconstructionReports now participates in ordinary collaborative delta sync; actual browser patch builder, server applyPatch and client patch application are tested. Like other top-level shared fields, concurrent competing updates use the existing field replacement semantics; conflict-aware report-history merging is not introduced here.
- Production image prompt/response schema and backend route still use v1. This branch exposes an opt-in staging API and synthetic fixtures; it does not silently enroll live users into a new model contract
- Source shape polygons, wall/ceiling/roof/site face-map appearance, grouped symbols and general semantic asset resolution are not implemented
- Fold/arch door kinematics and model-backed opening GLB geometry are not certified. A registered openingModel is still blocked until its model-specific geometry is verified
- Exterior cars may explicitly use hostRoomId:null without invented rooms/walls; site/parking boundary containment and other exterior furniture domains are not yet certified.
- Furniture containment is against declared host room rectangles. It is not a full furniture-to-furniture circulation simulation or general polygonal-room check
- World-facing conversion is not assumed from unverified model metadata. Explicit canonical editor rotation is preserved; derived facing conversion remains unresolved
- Explicit drag/paste/gizmo release can rebind strict openings; numeric/nudge edits preserve exact inputs and bind only an exact matching wall or detach explicitly. Group move keeps valid host references. Passive rendering never rebinds. Deleted/reversed host stays unresolved until an explicit opening edit. These edits do not retroactively certify the source IR's motion/backing/collision assessment; explicit detached-state UI and full visual QA remain release-review concerns
- Existing height models are never globally migrated by import. New-plan height-model selection and upper-floor/different-structural-level relative datum resolution remain separately reviewed integrations
- No browser visual QA was possible in the assigned environment (previous browser socket/localhost restrictions). Node tests execute actual constructors, height helpers, save normalization and shared renderer parameters; that is not a substitute for final visual review

## Local verification

Do not rely on `tools/run_tests.sh` exit status: its current baseline prints a failure counter without exiting nonzero. Use direct Node testing:

```sh
node --test tools/tests/scene-ir.test.cjs tools/tests/scene-opening-geometry.test.cjs
node --test tools/tests/*.test.cjs
python3 tools/tests/lint_selftest.py
node tools/check-html-js.cjs
for f in assets/js/scene-*.js assets/js/plan-import.js assets/js/plan-finish.js assets/js/draw-2d.js; do node --check "$f" || exit 1; done
env -u WORKERS_CI SKIP_DEPLOY=1 bash build.sh
```

The verified build command only creates dist. Do not push/merge main, invoke deployment or run paid extraction to validate this branch.

## Fresh native evaluation packet

- `extraction-prompt-v2.txt`: evidence-based image-to-IR instructions
- `schema-v2.json`: JSON Schema, generated by `node tools/generate_scene_ir_schema.cjs`
- `capability-subset-v2.json`: bounded actual catalogue candidates for the first image test
- `capabilities-v2.json`: full audit snapshot of the loaded catalogue/built-ins, not a source-product claim
- `tools/tests/fixtures/scene-ir/entry-desk-car.json`: hand-authored synthetic end-to-end fixture, not model-reading evidence

For an offline native-output check, the test runtime can execute the real application constructors and imported registry without a browser or paid calls:

```js
const {runtime}=require('./tools/tests/scene-fixtures.cjs');
const context=runtime();
// context.DATA is an explicitly selected isolated v2 test plan, never the user's live plan.
const result=context.PlanImport.previewSceneIR(require('/absolute/path/to/native-output.json'));
console.log(JSON.stringify(result,null,2));
```

Keep native image accuracy, IR validity, supported-capability coverage and Apply readiness separate in the evaluation. Do not omit unsupported observed windows/folds or unresolved furniture to inflate a pass rate.

## Next schema/route requirements from independent image review

Do not silently revise the frozen evaluation packet. A successor must preserve logical multipart/orthogonal-polygon rooms (v1 PlanGrid accepts room.parts and creates no wall between same-room parts); source annotation/dimension-chain constraints distinct from inferred clear geometry; catalog-independent semantic object type; grouped paired-door leaves; structured stair continuation; object axis/head-end independent of model front; and drawing color/visual evidence distinct from specified material. Site/parking/ground domains need their own containment model instead of invented indoor rooms.

The fresh source-C and full-fixture extractions demonstrate these representation gaps. Raw input and before/after compiler reports are kept separately in the local evaluation directory. Schema validity, source fidelity, runtime capability coverage, Apply readiness and reconstruction completeness are different measurements. The next integration step after independent review is an actual image-to-successor-IR route, keeping v1 compatibility and all preview/Apply/undo boundaries.

## Verified local checkpoint (2026-10-02)

Final full Node run: 1,362 tests, 1,360 passed, 2 skipped, 0 failed. Independent review also passed 75 focused tests and 40 translated/reversed-host sweep checks; a 0.01 mm support shortage was rejected. Python lint self-tests passed; all edited JS and HTML inline JS syntax checks passed; `git diff --check` passed. `env -u WORKERS_CI SKIP_DEPLOY=1 bash build.sh` produced dist successfully and explicitly did not deploy. Browser visual QA was not run.

Independent review drove fixes for strict host editing lifecycle, local/shared report persistence, actual legacy ceiling-elevation migration, floor-specific/raised-floor window normalization, malformed input diagnostics, and the baseline v1 grid-normalization assertion. Remaining full-fixture failures are documented representation/capability gaps, not a dimensions-only extraction score.
