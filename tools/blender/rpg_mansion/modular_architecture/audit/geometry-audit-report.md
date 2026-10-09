# Modular architecture geometry evidence

Production evidence only. Final independent acceptance and expansion approval remain separate.

Scope: 8 prototypes and 3 actual saved assembly scenes. Inputs were unchanged; exact file hashes and repository-relative paths are in geometry-audit.json.

Result: 0 current hard findings; 0 assets with exposed cross-part duplicate surfaces.

## Actual source and GLB checks

- Reads native authoring meshes and the active canonical source scene. Decodes GLB binary POSITION, NORMAL, and index buffers with node transforms, rather than trusting descriptors or prior validation JSON.
- Every actual GLB/source triangle must match a native-part triangle including orientation within 0.002 mm. Coincident opposing contact faces are kept in separate solid partitions.
- Each closed component is independently checked for two oppositely directed edge uses, positive signed volume, finite positions, nondegenerate triangles, and nonadjacent triangle self-intersections.
- Tests actual stored corner normals for finite unit length, correct outward hemisphere, and alignment on flat faces. Smooth turned-column normals are intentionally allowed to differ from face normals.
- Native-part contact graph and all coplanar cross-part overlaps are independently measured. Opposing butt contacts and buried overlaps are distinguished from exposed same-facing duplicate surfaces. Exposure uses outward samples against the union of constituent closed solids.

- rpg-mansion-paneled-wall-bay-01: 13 native solids, 280 triangles; dimensions 1200.000, 280.000, 3000.000 mm; smallest closed volume 0.00164219833 m³; lowest actual corner-normal dot 0.9999999; contact groups 1; exposed duplicate pairs 0.
- rpg-mansion-rectangular-doorway-bay-01: 15 native solids, 280 triangles; dimensions 1800.000, 288.000, 3000.000 mm; smallest closed volume 0.000625589916 m³; lowest actual corner-normal dot 0.9999999; contact groups 1; exposed duplicate pairs 0.
  - Portal: 1200.000048 × 2400.000095 mm, measured over 330 width and 330 height rays. All 1089 through-rays clear; 0 triangles intersect the continuous inset opening prism.
- rpg-mansion-paneled-return-corner-01: 13 native solids, 326 triangles; dimensions 720.000, 720.000, 3000.000 mm; smallest closed volume 0.00124581671 m³; lowest actual corner-normal dot 0.9999999; contact groups 1; exposed duplicate pairs 0.
- rpg-mansion-slate-gable-span-01: 66 native solids, 1672 triangles; dimensions 4200.000, 1200.000, 1548.000 mm; smallest closed volume 0.000688199657 m³; lowest actual corner-normal dot 0.9999999; contact groups 1; exposed duplicate pairs 0.
  - Actual roof deck vertical thickness 54.999948 mm; eave X positions [-2099.9999046325684, 2099.9999046325684] mm. Each bearing is measured independently: [{'name': 'Continuous level wall bearing seat -1', 'bottomMm': 100.00000149011612, 'widthMm': 240.00000953674316, 'xCentreMm': -1799.9999523162842}, {'name': 'Continuous level wall bearing seat 1', 'bottomMm': 100.00000149011612, 'widthMm': 240.00000953674316, 'xCentreMm': 1799.9999523162842}].
  - Slates: 62 individually closed tiles; courses alternate [4, 5, 4, 5, 4, 5, 4] tiles with measured half-tile stagger. 96 actual adjacent-course lap contacts; X overlap 9.999990463256836 to 10.000109672546387 mm; every measured lap has positive opposing contact area: True.
- rpg-mansion-gable-end-closure-01: 4 native solids, 48 triangles; dimensions 3360.000, 273.000, 1370.000 mm; smallest closed volume 0.0029826506 m³; lowest actual corner-normal dot 0.9999999; contact groups 1; exposed duplicate pairs 0.
- rpg-mansion-stone-cornice-straight-01: 1 native solids, 40 triangles; dimensions 1200.000, 420.000, 240.000 mm; smallest closed volume 0.0932040041 m³; lowest actual corner-normal dot 0.9999999; contact groups 1; exposed duplicate pairs 0.
- rpg-mansion-stone-cornice-corner-01: 1 native solids, 62 triangles; dimensions 720.000, 720.000, 240.000 mm; smallest closed volume 0.0858308858 m³; lowest actual corner-normal dot 0.9999999; contact groups 1; exposed duplicate pairs 0.
- rpg-mansion-tuscan-support-column-01: 3 native solids, 1940 triangles; dimensions 600.000, 600.000, 3000.000 mm; smallest closed volume 0.0431999626 m³; lowest actual corner-normal dot 0.9056626; contact groups 1; exposed duplicate pairs 0.

## Saved assembly joins and local supports

### cornice-column

- Rigid transforms: True. Contact groups: 1. Exposed cross-module duplicate pairs: 0.
- Corner bearing column ↔ stone-cornice-corner: 144000.009 mm² opposing contact faces.
- Cornice return straight ↔ South grounded bearing column: 72000.041 mm² opposing contact faces.
- Cornice return straight ↔ stone-cornice-corner: 77669.977 mm² opposing contact faces.
- West grounded bearing column ↔ stone-cornice-straight: 72000.018 mm² opposing contact faces.
- stone-cornice-corner ↔ stone-cornice-straight: 77670.001 mm² opposing contact faces.
- Corner bearing column: ground 0.000000 mm, capital top 3000.000000 mm, cornice underside 3000.000000 mm, gap 0.000000 mm.
- South grounded bearing column: ground 0.000000 mm, capital top 3000.000000 mm, cornice underside 3000.000000 mm, gap 0.000000 mm.
- West grounded bearing column: ground 0.000000 mm, capital top 3000.000000 mm, cornice underside 3000.000000 mm, gap 0.000000 mm.

### hollow-roof-gable

- Rigid transforms: True. Contact groups: 1. Exposed cross-module duplicate pairs: 0.
- East actual paneled bearing wall 1 ↔ East actual paneled bearing wall 2: 772904.358 mm² opposing contact faces.
- East actual paneled bearing wall 1 ↔ QA fixture front wall with real open door: 878042.350 mm² opposing contact faces.
- East actual paneled bearing wall 1 ↔ Second roof repeat: 0.000 mm² opposing contact faces.
- East actual paneled bearing wall 1 ↔ gable-end-closure: 5520.000 mm² opposing contact faces.
- East actual paneled bearing wall 1 ↔ slate-gable-span: 287999.994 mm² opposing contact faces.
- East actual paneled bearing wall 2 ↔ Second roof repeat: 287999.987 mm² opposing contact faces.
- East actual paneled bearing wall 2 ↔ slate-gable-span: 0.000 mm² opposing contact faces.
- QA fixture front wall with real open door ↔ West actual paneled bearing wall 1: 878041.389 mm² opposing contact faces.
- QA fixture front wall with real open door ↔ gable-end-closure: 795359.931 mm² opposing contact faces.
- Second roof repeat ↔ West actual paneled bearing wall 1: 0.000 mm² opposing contact faces.
- Second roof repeat ↔ West actual paneled bearing wall 2: 287999.937 mm² opposing contact faces.
- Second roof repeat ↔ slate-gable-span: 315785.668 mm² opposing contact faces.
- West actual paneled bearing wall 1 ↔ West actual paneled bearing wall 2: 772903.955 mm² opposing contact faces.
- West actual paneled bearing wall 1 ↔ gable-end-closure: 5519.977 mm² opposing contact faces.
- West actual paneled bearing wall 1 ↔ slate-gable-span: 287999.915 mm² opposing contact faces.
- West actual paneled bearing wall 2 ↔ slate-gable-span: 0.000 mm² opposing contact faces.
- gable-end-closure ↔ slate-gable-span: 1077456.585 mm² opposing contact faces.
- Roof bearing/wall interfaces: 10 measured support samples; maximum absolute vertical gap 0.0 mm. Roof and wall interface elevations are recorded individually in JSON.
- Hollow attic: 650 cavity samples below the actual roof underside, 0 occupied. Eaves: {'west': 179.99982833862305, 'east': 179.99982833862305, 'roofWidth': 4199.999809265137, 'wallExteriorSpan': 3840.0001525878906}.

### wall-door-corner

- Rigid transforms: True. Contact groups: 1. Exposed cross-module duplicate pairs: 0.
- Return straight paneled bay ↔ paneled-return-corner: 772905.083 mm² opposing contact faces.
- paneled-return-corner ↔ rectangular-doorway-bay: 771537.008 mm² opposing contact faces.
- paneled-wall-bay ↔ rectangular-doorway-bay: 771536.989 mm² opposing contact faces.
- Assembled portal: 1199.999928 × 2400.000095 mm; continuous clearance pass True.

## Findings and limits

- No unresolved geometry findings in this run.
- Earlier exposed portal/trim/roof–gable overlaps are documented in exposed-surface-repair-targets.md as superseded repair evidence. That file is not the current status.
- Clear-opening tests use a 0.008 mm inset to avoid claiming boundary surfaces are an obstruction. Same-facing seam slivers below the 0.002 mm positional tolerance are excluded.
- Exposure classification samples clipped overlap polygons; it is not an exact constructive-solid-geometry union theorem. No collision, physics, load-bearing engineering certification, or visual acceptance is implied.
- Reproduction: run Blender in background with audit/audit_geometry.py, then run summarize_geometry_audit.py with Python. Run audit_selftest.py in Blender for the independent synthetic regression cases. No production blend is saved or mesh edited by these scripts.

