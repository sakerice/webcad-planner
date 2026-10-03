# Wall-height display-only API review packet

Corrected README text for the existing `0a0b976` review packet. This document supersedes only its wording claims about validation, experiment scope, provenance, dependency safety, and image presentation; the saved packet, implementation, and validation results are unchanged.

This packet reviews a minimal one-wall numeric display assumption. It is not an AI candidate input or a new Astra experiment. Both frozen Astra runs remain 2/2 and their 56 pinned files are unchanged.

The API accepts at most one explicit finite 300..6000mm wallHeight proposal, for an explicitly selected existing non-opening-host wall. The source and reason strings are checked only for string type, non-whitespace content, and a maximum length of 500 characters; their meaning, evidentiary validity, and image-reference correctness are not verified. Separately, the API checks sourceHash/baseRevision/version, target wall and explicit selection, origin, and numeric bounds. unreviewed and sourceMeasured:false are server-owned. The fixed origin label explicit-display-assumption does not authenticate caller provenance or mechanically distinguish user-specified numbers from AI guesses. Source facts are unchanged. The materializer applies the already-validated HeightModel value while constructing the wall, before compile returns. No plan post-patch, Apply, persistence, arbitrary parameters or transport is added.

The outcome is an isolated preview API that passes an unreviewed explicit numeric proposal to the existing per-wall height behavior. It does not judge numeric validity from the original drawing or complete visualization of undetermined heights. The validator does not reject multi-floor or step-level dependencies. Native browser success on the synthetic first-floor fixture does not certify multi-floor safety or invariance of other rendered structures.

Requested value, generated wallHeight, native mesh effective height, bbox and renderer floor/ceiling context are reported separately. In the synthetic fixture, 1100mm requests produce a 1280mm mesh because the native renderer includes a 180mm floor slab. Clearing the override restores the editor default and its ceiling link. Failed/stale/cancelled operations do not replace the last successful wall display baseline.

Evidence: browser/browser-wall-height-results.json contains the native requests/responses, independent mesh measurements, same-camera checks, save guard rejection, and full before/after DATA/history/dirty/source/options/local/session/IndexedDB equality. PNGs are real native-editor captures. Browser setup disables damping before the integrity baseline, following the existing capture-pose behavior, so floating-point settling does not make the scene revision nondeterministic. The fixture uses only explicit synthetic test numbers, no AI candidate preview or paid call.

sourceMeasured:false and unreviewed are present in JSON/reports, without a dedicated indication inside the images. Every image shared must carry a caption identifying a synthetic test, an unreviewed display assumption, requested and mesh heights, and unverified reconstruction of the original drawing. Use the per-image text in wall-height-image-sharing-captions.md.

source/ contains the portable target-test subset plus dependencies. From that directory, run:

```sh
node --test tools/tests/editor-internal-api-wall-height.test.cjs tools/tests/editor-internal-api.test.cjs tools/tests/editor-internal-api-lifecycle.test.cjs tools/tests/editor-internal-api-catalogue.test.cjs tools/tests/scene-material-api.test.cjs tools/tests/scene-ir-v3-materialize.test.cjs tools/tests/scene-catalogue-object-audit.test.cjs tools/tests/scene-catalogue-fixture-audit.test.cjs tools/tests/height-model.test.cjs tools/tests/scene-ir-v3-routing.test.cjs
```

The full Node suite and browser rerun require a complete checkout at the pinned commit in source-hashes.json. Browser invocation and port restrictions are documented in source/docs/quality-review/opening-contract-packet/internal-api-schemas/wall-height-display-contract.md. This subset is not a standalone website.

For this experiment, no numeric height overrides were generated for the original drawing, and the existing source-only portions of the frozen results were left as recorded. This is an experiment policy, not a general API guarantee: a compilable explicitly selected wall without an override is generated at the editor default height, and a valid explicit numeric proposal is accepted as an unreviewed display-only assumption with sourceMeasured:false. No new overlay/ghost renderer, furniture scale/material editing, OAuth/token, external MCP, paid call, push, merge or deploy is included. The pre-existing untracked performance-plan document is preserved.
