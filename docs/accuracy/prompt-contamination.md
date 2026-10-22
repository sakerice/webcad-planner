# Source-specific prompt contamination and neutral examples

The original native evaluation of `tools/tests/fixtures/madori-3f.pdf` is **not held-out image-reading accuracy**. Independent review found that the model-facing knowledge document already contains answers from page 1. A blinded assistant receiving only the image and this prompt still receives those answers. A crop/full-page comparison using that prompt cannot isolate visual reading from copied or anchored values.

At original prompt commit `bbcd75df1d129c8636d3af433663c8c01ca0f6b9`, `worker/plan-knowledge.mjs` emits:

- Total `7,280` and the exact bottom chain `2,275 / 227.5 / 1,137.5 / 910 / 910 / 1,365 / 455`.
- The same chain with one missing value, and its answer `7,280 - 7,052.5 = 227.5`.
- The bedroom's exact two rectangles: `(0,1365)-(3185,2275)` and `(0,2275)-(2275,4095)`.

`worker/plan-spec.mjs` also emits the uncommon sample room name `KB置き場` as an example. The original production request snapshot remains unchanged at `docs/accuracy/2026-10-01/native-sources/extraction-request.json` on PR #66. Its historical results must retain the contamination qualification; do not silently replace that snapshot and relabel the earlier run as clean.

## Proposed production change

Replace the sample-derived chain with an explicitly fictional arithmetic example: `625.5 + 874.5 + 1500 = 3000`, retaining fractional dimensions and the single-missing-part calculation. Explain L-shaped decomposition using ordered symbolic boundaries instead of actual room names and coordinates; preserve non-overlapping parts, a shared room identity, and no internal wall. Remove the sample room-name example from the specification. Treat 910 mm as one possible module with evidence needed for inference, rather than a universal default scale.

These changes remove known prompt answers. They do not establish recognition improvement, remove unknown training-data exposure, or guarantee absence of every possible benchmark overlap. Tests retain the original answer fingerprints as explicit negative assertions against emitted model documents; the failed evaluation is documented rather than hidden.

The parent's new approximate native pass uses its own separately recorded neutralized request, which removes the exact examples without adding this proposal's fictional chain and retains the original module-prior wording. It is not identical to this production proposal. Do not combine their outcomes or attribute that pass's results to this patch. Neither is an Astra API evaluation.

## Validation

Focused knowledge/procedure/specification regression tests check decimal arithmetic guidance, removal of source-specific numeric and room-name fingerprints, symbolic L-shaped decomposition, and unchanged document routing. No model API or credentials are required for these tests. The data schema and user's saved plans are unchanged.

Local validation: 42 focused tests passed and `SKIP_DEPLOY=1 bash build.sh` passed. No new native or hosted-model result is attributed to this patch.
