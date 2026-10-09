# Targeted exposed-surface repair evidence

SUPERSEDED HISTORICAL EVIDENCE: This document records pre-repair findings only. All defects listed here are resolved in the current geometry-audit.json, which reports zero unresolved findings across all eight prototypes and three assemblies. Use geometry-audit-report.md and geometry-audit.json for current status.

Measured from actual native meshes. Plane coordinates below are construction coordinates in metres; areas are pairwise overlap, not union area. Ground/base caps can be hidden by an installed floor, whereas portal inner faces and uncovered tops/ends remain exposed. Float32 seam slivers narrower than the 0.002 mm positional tolerance are excluded. No geometry was changed.

## rpg-mansion-paneled-wall-bay-01

- Continuous front timber backing ↔ Continuous timber dado rail
  - X = 0.600000: 1050.000 mm²
  - X = -0.600000: 1050.000 mm²
- Continuous front timber backing ↔ Continuous timber skirting
  - Z = 0.000000: 18000.019 mm²
  - X = 0.600000: 2700.003 mm²
  - X = -0.600000: 2700.003 mm²
- Continuous front timber backing ↔ Continuous timber upper rail
  - Z = 3.000000: 18000.019 mm²
  - X = 0.600000: 2100.004 mm²
  - X = -0.600000: 2100.004 mm²
- Continuous front timber backing ↔ Full height plaster structural wall
  - Z = 0.000000: 1199.985 mm²
  - Z = 3.000000: 1199.985 mm²
  - X = 0.600000: 2999.961 mm²
  - X = -0.600000: 2999.961 mm²

## rpg-mansion-rectangular-doorway-bay-01

- Continuous overdoor cornice rail ↔ Continuous timber portal facing with clear opening
  - X = -0.900000: 2100.003 mm²
  - X = 0.900000: 2100.003 mm²
  - Z = 3.000000: 27000.014 mm²
- Continuous plaster piers and lintel with open portal ↔ Continuous timber portal facing with clear opening
  - Z = 0.000000: 599.997 mm²
  - X = -0.600000: 2399.987 mm²
  - Z = 2.400000: 1199.994 mm²
  - X = 0.600000: 2399.987 mm²
  - X = 0.900000: 2999.984 mm²
  - Z = 3.000000: 1799.990 mm²
  - X = -0.900000: 2999.984 mm²
- Continuous plaster piers and lintel with open portal ↔ Portal head timber reveal
  - Z = 2.400000: 288000.005 mm²
- Continuous plaster piers and lintel with open portal ↔ Portal jamb timber reveal -1
  - Z = 0.000000: 28800.001 mm²
  - X = -0.600000: 576000.010 mm²
- Continuous plaster piers and lintel with open portal ↔ Portal jamb timber reveal 1
  - X = 0.600000: 576000.010 mm²
  - Z = 0.000000: 28800.001 mm²
- Continuous timber portal facing with clear opening ↔ Pier skirting -1
  - Z = 0.000000: 2100.001 mm²
  - X = -0.900000: 2700.002 mm²
- Continuous timber portal facing with clear opening ↔ Pier skirting 1
  - Z = 0.000000: 2100.001 mm²
  - X = 0.900000: 2700.002 mm²
- Continuous timber portal facing with clear opening ↔ Portal head timber reveal
  - Z = 2.400000: 19200.004 mm²
- Continuous timber portal facing with clear opening ↔ Portal jamb timber reveal -1
  - Z = 0.000000: 1920.000 mm²
  - X = -0.600000: 38400.008 mm²
- Continuous timber portal facing with clear opening ↔ Portal jamb timber reveal 1
  - X = 0.600000: 38400.008 mm²
  - Z = 0.000000: 1920.000 mm²
- Portal head timber reveal ↔ Portal mitred header architrave
  - Z = 2.400000: 3599.990 mm²
- Portal jamb timber reveal -1 ↔ Portal left mitred architrave
  - Z = 0.000000: 359.999 mm²
  - X = -0.600000: 7199.979 mm²
- Portal jamb timber reveal 1 ↔ Portal right mitred architrave
  - Z = 0.000000: 359.999 mm²
  - X = 0.600000: 7199.979 mm²

## rpg-mansion-paneled-return-corner-01

- Continuous mitred L dado ↔ Continuous mitred L timber backing
  - X = -0.600000: 1050.000 mm²
  - Y = -0.600000: 1050.000 mm²
- Continuous mitred L skirting ↔ Continuous mitred L timber backing
  - X = -0.600000: 2700.002 mm²
  - Z = 0.000000: 14175.008 mm²
  - Y = -0.600000: 2700.002 mm²
- Continuous mitred L timber backing ↔ Continuous mitred L upper
  - Z = 3.000000: 14175.009 mm²
  - Y = -0.600000: 2100.003 mm²
  - X = -0.600000: 2100.003 mm²

## Assembly hollow-roof-gable (world coordinates)

- gable-end-closure ↔ slate-gable-span
  - Y = -0.120000: 52800.012 mm²; bounds [-1.9199999570846558, -0.11999998986721039, 3.0] to [1.9199999570846558, -0.11999998986721039, 3.194000005722046]
  - X = 1.920000: 6240.006 mm²; bounds [1.9199999570846558, -0.11999998986721039, 3.0] to [1.9199999570846558, 0.12000000476837158, 3.0260000228881836]
  - X = -1.920000: 6240.006 mm²; bounds [-1.9199999570846558, -0.11999998986721039, 3.0] to [-1.9199999570846558, 0.12000000476837158, 3.0260000228881836]


## Subsequent real-wall assembly fixture repair

The replacement roof assembly uses four actual wall bays. Its front QA fixture initially overlapped the inward timber finishes of the front side-wall bays. Visible coincident end faces lie at world Y = -0.120 m, in X bands -1.680 to -1.640 m and 1.640 to 1.680 m, with about 52,800 mm² pairwise exposed overlap per side. Ground caps add about 9,600 mm² per side. This is a scene-only QA fixture defect; catalogue assets remained clean. before-fixture-repair.json preserves the measured run and exact hashes. Current status is solely geometry-audit.json.

## Boolean fixture cleanup

The first fitted-pocket Boolean removed the exposed overlaps but left 11 zero/sub-0.002 mm edges and 20 degenerate tessellated triangles. Raw edge connectivity was manifold; repeated coincident vertices were the issue. fixture-cleanup-diagnosis.json anchors that intermediate state by source hash. This historical diagnosis is superseded by the final geometry-audit.json once the producer cleans the fixture.

## Lapped-slate topology revision

A later staggered-slate revision used thin concave n-gon end caps. Its GLB/source triangle match passed, but the imported saved assembly showed reversed geometric triangle normals and nonadjacent intersections in three negative-slope course-five tiles per roof repeat. The affected GLB hash was 0749f06dce81cb550f94f2b22fab12a0f4daf64497bf2becaad33346914da647. The producer replaced those end caps with explicit convex per-station quad strips at the same boundary coordinates. The final audit is run against that replacement and checks actual assembly triangles again.
