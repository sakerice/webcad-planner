# Approximate blinded native visual evaluation — two synthetic cases

This records the independent parent-thread evaluation report supplied on 2026-10-01. The parent reports that separate assistants received only source PNG A or B and the extraction request, without expected answers. Predictions were scored unchanged against commit `bbcd75df1d129c8636d3af433663c8c01ca0f6b9`. Actual assistant model identities and elapsed extraction times were not supplied. The prediction files and scoring logs are in the parent environment, not this checkout; this document records supplied results rather than claiming a fresh local reproduction.

This is **not Astra API evaluation**, does not reproduce production preprocessing or enforced structured-output transport, and does not estimate production accuracy. The two crisp synthetic drawings are a small favorable sample. The extraction request predates the separate nullable-evidence proposal in PR #69.

| Reported measure | A | B |
|---|---:|---:|
| Overall width/depth | exact | exact |
| Four dimension chains, totals and parts | exact | exact |
| Labelled room count and geometry | 7/7 exact | 8/8 exact |
| Floor identity | exact | exact |
| PlanGrid merged wall segments | 10/10 exact | 12/12 exact |
| Geometry diagnostics | none | none |
| Openings: type, centre, width, depth, floor | 11/11 exact | 11/11 exact |
| Actual wall attachment and room adjacency | 11/11 exact | 11/11 exact |
| Equipment: type, centre, catalogue dimensions, rotation | 4/4 exact | 3/4 exact |
| Extra placed items | 0 | 0 |

Room and wall ordering were ignored. All room parts match literally; B's two-part LDK and outdoor notch are retained. Equivalent alternative rectangle segmentation was not exercised. Expected fixtures do not establish quantitative truth for use, level, marks or notes.

The error is B's washbasin at (2150,5800): the reading retains its centre and dimensions in a laundry mark and explains that the circle-in-rectangle was interpreted as a washing machine. The missing sink is a semantic classification miss, not a position error. Equipment recall is 7/8 and precision 7/7 **only for these fixtures**. The renderer's generic basin symbol is ambiguous; preserve this failure when adding better-labelled and intentionally ambiguous examples.

Eight raw opening rotations differ, but production wall-derived orientation, centres and adjacency agree for all 22 openings. The supplied production instructions explicitly derive opening orientation from its wall, so these are not scored as detection failures. Raw values still differ, and rendering paths that bypass wall-derived pose were not verified.

Notes disclose inferred coordinates and unprinted totals. Marks for kitchen components are evidence, not extra placed kitchens. These disclosures are not penalized merely because expected notes were empty. They also show why inferred numbers should remain separate from printed evidence in a future contract.

The parent scorer used exact-commit PlanGrid, PlanImport.toAppObjects, real mkWall/mkItem, getOpeningWallInfo and openingAdjacentRooms. Maximum wall attachment residual was approximately 2.3e-13 mm. Local JSON-schema validation was recorded separately; this does not prove schema enforcement during extraction. No browser/3D screenshot, full Worker HTTP orchestration, rejection case, staircase interpretation, multi-floor alignment, or real-scan robustness was evaluated.

Next evidence should cover permitted real drawings, low-resolution crops, rotation/noise, missing dimensions, multiple floors and varied symbols. Log model/version, time, hashes, schema enforcement and exact preprocessing. Production API evaluation remains subject to explicit budget authorization; the observations above do not identify preprocessing as the cause of production errors.
