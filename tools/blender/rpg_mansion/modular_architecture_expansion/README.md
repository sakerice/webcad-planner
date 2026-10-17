# Original mansion architecture expansion: sealed nine-asset subset

This isolated package currently contains **9 deliverable assets in 8 independent construction families**. The 600 mm plain-plaster filler is explicitly a width-only variant of the 1200 mm bay and adds no independent construction count. Sixteen proposed construction families are outside this subset and will be produced in a separate tree after this subset is sealed.

The frozen first-eight architecture package, delivered furniture, shared app manifests, user plans, remotes and deployments are untouched. Nothing here applies the separately proposed finish library. All geometry and current simple materials are original native Blender work, with no external images or models.

## Review first

- `review/joined-mansard-room.png`: complete installed exterior and true top, room cutaway, installed ceiling underside, 12-panel coffer array, and hollow roof underside.
- `review/expansion-views-1.png` through `-3.png`: all nine assets in hero, true top, front and rear views. The coffered ceiling hero deliberately shows its underside.
- `assemblies/joined-mansard-room.blend` and `.json`: editable assembly made from **41 actual exported GLB instances, with no QA fixtures**. JSON records the exact source model hashes, rigid matrices, both coordinate frames, and the whole-instance visibility omissions for each cutaway. The saved native scene contains every instance.
- `assembly-measurements-qa.json`: actual triangle-intersection measurements of 48 wall/floor/ceiling joins, 32 roof-bearing sites, 14 shell-section contacts, 819 arch through-rays and 245 attic-cavity samples.

## Nine initial deliverables

| Asset | Nominal W × D × H, mm | Construction role |
|---|---:|---|
| Plain plaster bay | 1200 × 300 × 3000 | Unpanelled wall, exterior stone bands, inner timber skirting |
| Plain plaster filler | 600 × 300 × 3000 | Width-only closure variant; `variantOf` plain bay; not a new family |
| Exterior return corner | 760 × 760 × 3000 | Continuous convex exterior bands and concave interior skirting |
| Arched doorway bay | 1800 × 317 × 3000 | True arched wall hole, separate stone jambs and voussoirs |
| Raised-sill fixed window | 1200 × 360 × 3000 | Real aperture occupied by fixed four-pane glazing, mullion and transom |
| Herringbone parquet tile | 1200 × 1200 × 75 | Physical clipped herringbone boards and continuous substrate |
| Coffered ceiling panel | 1200 × 1200 × 140 | Real underside recess, timber beam ring and plaster infill |
| Mansard span | 4200 × 1200 × 1930 | Hollow two-pitch deck, lapped slate, flashings and level bearings |
| Mansard hipped end | 4200 × 2100 × 1930 | Hollow three-sided closure and U-shaped bearing system |

Nominal dimensions remain separate from measured float bounds. No geometry is resized to round a label. Every source has named editable native parts and one active canonical export mesh; GLBs use metres, +Y up, +Z front, and actual bottom-centred origins.

## Why these extend the frozen first eight

The plain bay is the proposed unpanelled exterior wall construction. Its matching exterior corner carries convex exterior stone trim, unlike the first set's concave paneled return. The arched portal has a different true opening shape and stone support parts; the fixed window has a closed wall aperture with real separate glazing. Floors and recessed ceilings introduce new horizontal connection systems. The mansard span introduces a real pitch break, and its hipped end closes three roof planes without a solid attic wedge. The filler exists only because a 1800 mm portal plus 600 mm closure fills the actual 2400 mm front run between corner-arm endpoints.

## Connection and installation contract

- Native construction frame: Blender `(x,y,z)`, +Z up, -Y front. Export frame: glTF `(x,z,-y)`, +Y up, +Z front. Descriptors contain points, normals and construction-to-bottom-centre translations in both frames.
- Grid: 1200 mm primary, 600 mm secondary. Actual joins use these explicit connection planes and rigid quarter-turn transforms, never the decorative bounding boxes.
- Room wall centrelines: **3600 × 4800 mm**. Core inside clear footprint: **3360 × 4560 mm**. Stone/skirting finishes reduce the interior locally at their own elevations.
- Floor asset bottom: **-75 mm**; finished floor: **0 mm**. The 3 × 4 substrate/board array extends 120 mm under the perimeter wall cores. The herringbone geometry and board-color phase both repeat at 1200 mm.
- Wall bottom: **0 mm**; wall top: **3000 mm**.
- Ceiling asset bottom: **2860 mm**; recessed plaster underside: **2960 mm**; ceiling top: **3000 mm**. The 3 × 4 perimeter beam rings embed 120 mm into wall heads and are capped by the actual roof bearing seats. No native wall cutting or parametric connection behavior is claimed.
- Roof asset bottom: **2900 mm**; all bearing bottoms: **3000 mm**; ridge-cap top: **4830 mm**. Roof width is 4200 mm against the 3840 mm wall-core outer width, giving **180 mm eaves**. The final full roof length is 5400 mm against 5040 mm wall-core length, also giving 180 mm end eaves.
- With a deliberate 240 mm cornice stack, move the entire roof system up 240 mm: bottom 3140 mm and bearings 3240 mm. This is an explicit manual placement example.

### Mansard mating system

The centre span joins at native y = ±600 mm. Each hipped end has its span join at native y = 0, transverse bearing centre at y = -1800 mm and end eave at y = -2100 mm. Put one span at the room centre, one end at y = -600 mm, and a second end rotated 180° at y = +600 mm.

The upper roof slope is 5/12 and the lower slope is 1.5. The knee datum is x = ±1200 mm, z = 1350 mm relative to the roof bottom. The deck is 55 mm thick vertically. Slate plates are 15 mm thick, alternate by half a 300 mm tile, and have physical 10 mm laps except where the flashed knee replaces a normal course lap. Knee-flashing undersides meet actual slate tops at the same plane; neither the flashing nor the continuous deck has a fabricated gap at the repeat join. No load capacity or building-code certification is implied.

### Actual openings

The stone arch is 1200 mm wide at its 1800 mm springline, with a 2400 mm crown. Its inner curve consists of 24 actual semicircular chords. **It is not a 1200 × 2400 mm rectangular clearance box.** The projecting keystone begins at the crown and does not reduce it. Geometry rays check the complete finished wall depth.

The window's substrate aperture is 920 mm wide, from 800 to 2600 mm high. Its timber frame leaves a 760 mm-wide glazed field from 880 to 2520 mm, subdivided by real mullion/transom solids. Glazing is fixed, lightly tinted, and uses alpha 0.10 with roughness 0.08. The final exported pane material preserves visible transmission and a subtle tint; it remains actual 8 mm geometry. This asset does not cut a separate native wall or provide opening sash/door behavior.

## Quality evidence and remaining approval

Current producer checks include native-source privacy, precise GLB bounds and origin/connection conversion, actual UV triangle intersections, real assembly ray contacts, actual alpha margins, and fresh reopened-source geometry/PBR/UV/normal and image replay. Independent topology/contact/corner-normal/exposed-face certification is separately owned; its live preflight is not a final approval. Root visually accepted the joined room and all three asset sheets, and authorized the clearer glazing finish recorded here. Final independent certification binds the exact sealed allowlist; it is supplied separately without modifying these frozen files.

Measured ray contacts use double-precision actual triangle intersections. Small barycentric edge tolerance admits float32 quarter-turn endpoint error; it corresponds to at most 0.00672 mm on the largest measured triangle, below the 0.1 mm join tolerance. Approximate BVH distances are not used for reported support gaps.

## Reproduce in this isolated repository only

1. `blender -b --threads 3 -P tools/blender/rpg_mansion/modular_architecture_expansion/build.py`
2. `blender -b --threads 3 -P tools/blender/rpg_mansion/modular_architecture_expansion/render.py`
3. `blender -b --threads 3 -P tools/blender/rpg_mansion/modular_architecture_expansion/assemblies.py`
4. `blender -b --threads 3 -P tools/blender/rpg_mansion/modular_architecture_expansion/proof_checks.py`
5. `python tools/blender/rpg_mansion/modular_architecture_expansion/check_uv_overlap.py`
6. `blender -b --threads 3 -P tools/blender/rpg_mansion/modular_architecture_expansion/replay_sources.py`
7. `python tools/blender/rpg_mansion/modular_architecture_expansion/review_checks.py`

Rebuilds can change native source hashes. Use saved sources for checking a sealed snapshot. For compact delivery, regenerated replay PNG/GLB outputs are not duplicated in the archives. The current hash-bound replay reports and recipes are included, and all 42 delivered view images remain included across the two archive groups.

Frozen helper copies are recorded with their original byte hashes; adapted helpers have separate expansion names. No helper import writes to a frozen source path.
