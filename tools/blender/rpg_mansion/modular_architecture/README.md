# Eight-piece original mansion architecture prototype

This is a local review package for **eight distinct static modules**. It is not an approval to publish or to expand to the proposed 32-piece kit. Existing accepted assets, the app, shared manifests and remote repositories are untouched.

## Start the visual review

- `review/prototype-views-1.png` and `review/prototype-views-2.png`: all eight pieces, each with three-quarter, top, front and rear views.
- `review/joined-assemblies.png`: exterior, interior/underside and top views of three actual GLB assemblies.
- `assemblies/`: full-resolution 1024px assembly views, saved editable assembly sources, actual instance placements and source/model/image hashes.
- `descriptors.json`: per-asset files, measured and practical nominal envelopes, original rights, finish channels, connection datums and placement examples.

All original isolated views are transparent 512px PNGs; assembly views are transparent 1024px PNGs. Contact sheets use a neutral background only for readability. Frame fitting uses projected actual vertices, and the final alpha-pixel bounds require at least 12px clearance on every edge.

## Physical and export contract

- Metres; native Blender +Z up, -Y front; GLB +Y up, +Z front.
- Connection coordinates are explicit in both frames. Convert native Blender `(x,y,z)` to glTF `(x,z,-y)`; apply the same rotation to normals. Each descriptor supplies `constructionPointGltfM`, `assetPointGltfM` and `normalGltf` beside the native fields, plus the construction-to-asset translation in both frames. These are descriptive datums only, without promised snapping or native connection behavior.
- Every individual GLB and its active canonical source use an actual bottom-centre origin. Decorative bounds are **not** used as wall connection planes.
- Primary grid 1200mm, secondary grid 600mm; wall/column baseline 3000mm. Building envelope offsets, including 120mm half-wall thickness, are explicit.
- Each canonical `.blend` has one active export mesh and retains its named native authoring scene. A separate authoring `.blend` is supplied. The two cornices are genuinely monolithic named editable extrusions, so each has one native part rather than arbitrary artificial cuts.
- Rigid translations and quarter-turns only for assembly. No mirrored, recoloured, rescaled or renamed copies are counted as new modules.
- Compact metric UV charts preserve usable precision and are checked on actual exported triangle intersections. Parts are closed and outward wound; physical contacts and exposed coplanar surfaces are audited from actual geometry.
- `w/d/h` are practical integer-mm envelopes. `measuredEnvelopeMm` and validation retain measured float values; independent decoded-GLB bounds must stay within 0.1mm of the nominal values. This rounding never scales the mesh.

## The eight modules

| ID suffix | Nominal W × D × H (mm) | Triangles | Default elevation (mm) |
|---|---:|---:|---:|
| paneled-wall-bay-01 | 1200 × 280 × 3000 | 280 | 0 |
| rectangular-doorway-bay-01 | 1800 × 288 × 3000 | 280 | 0 |
| paneled-return-corner-01 | 720 × 720 × 3000 | 326 | 0 |
| slate-gable-span-01 | 4200 × 1200 × 1548 | 1672 | 2900 |
| gable-end-closure-01 | 3360 × 273 × 1370 | 48 | 3000 |
| stone-cornice-straight-01 | 1200 × 420 × 240 | 40 | 3000 |
| stone-cornice-corner-01 | 720 × 720 × 240 | 62 | 3000 |
| tuscan-support-column-01 | 600 × 600 × 3000 | 1940 | 0 |

## Placement defaults

Grounded walls, doorway, corner and column default to 0mm. The roof bottom defaults to 2900mm: its level bearing seats are 100mm above its bottom, so they meet the 3000mm wall top. The fitted gable and both cornices default to 3000mm.

A 240mm-high cornice raises its top to 3240mm. When deliberately stacking the roof and gable above it, raise both by 240mm: roof bottom 3140mm, gable bottom 3240mm. These are explicit manual-placement examples, not automatic snapping or parametric adjustments.

## Three real assembly proofs

### Wall, doorway and concave return

A 1200mm paneled bay, 1800mm doorway bay, 600mm-datum corner and another actual 1200mm wall bay meet at measured connection planes. The finished doorway is genuinely empty for 1200mm width and 2400mm height through the complete finished depth. Substrate openings are larger to receive the timber reveals; clear faces are timber only. Backing/rail and reveal/architrave interfaces butt together without exposed coincident faces.

### Hollow roof and fitted gable

Two actual 1200mm-run roof spans join along their run. Four actual paneled-wall GLBs, two per side, provide the 240mm bearing walls with centre lines at ±1800mm. Thus the actual outside wall envelope is 3840mm, roof envelope 4200mm, and eave projection beyond each outside wall face 180mm. Pitch slope is 0.7 (about 34.992 degrees).

The roof consists of a thick hollow timber deck, attached slate plates, ridge cap and level bearing seats. Slate courses alternate by a 150mm half-tile stagger and have a real 10mm lap. Clipped half-tiles meet flush across the 1200mm repeat boundary, without a false bevel or grout gap. It does not fill the attic with a solid wedge. The revised gable closes the 3360mm clear space between the bearing seats; the seats close its outer shoulders. This avoids overlap of gable and roof support solids.

One **front doorway/filler wall remains a clearly labelled QA fixture** because this eight-piece subset does not include the required full front-wall infill combination. Its side pockets are fitted to the actual adjacent wall finishes, with Boolean residue removed at a 0.002mm tolerance. It is not a catalog asset and is not counted. This test demonstrates side-wall/roof compatibility and fitted end closure, not a complete closed-building kit.

### Mitred cornice and grounded columns

The continuous L-cornice meets two actual straight cornices. Three actual 3000mm columns support it. Column axes are (0,0), (-1800,0) and (0,-1800)mm on the secondary grid, and top contact is at 3000mm. The proof checks actual supported geometry, not engineering load capacity.

## Verification and scope limits

- `audit/geometry-audit.json`: actual source/GLB topology, positive volumes, corner normals, native connectivity, exposed-surface scan, opening/cavity tests, seam datums and bearing contacts. Exposure probing has explicit numerical tolerances; see its method/limits.
- `packed-uv-overlap-qa.json`: actual exported UV triangle intersection test.
- `all-source-privacy-qa.json`: all 19 compressed native payloads, including saved UI state, scanned for retained private absolute paths.
- `dimensions-placement-qa.json`: actual decoded GLB bounds, nominal-envelope tolerance, origins and placement defaults.
- `image-framing-qa.json`: all 41 delivered image alpha bounds and metadata check.
- `source-replay-inputs.json`: re-export from each reopened saved canonical source, comparing exact cyclic geometry, UVs, full PBR and corner normals.
- `assembly-replay-inputs.json` and `image-replay-qa.json`: real saved-source rerenders and exact decoded RGBA comparisons for all 41 views. No geometry builder is used for replay.
- `review-allowlist.json`: actual hashes of the sealed review files, distinct from publisher approval.

Independent acceptance and parent/root visual approval remain separate. No native wall cutting, wall-graph editing, automatic roof generation, collision, parametric stairs, lighting mechanism, app finish integration, or structural certification is implied. Finish channels support later integration but do not demonstrate it here. The separate finish library is outside this package and outside the eight-model count.

## Reproduce locally

Run from the package/repository root with Blender and Python plus NumPy, Pillow and Zstandard available. These commands write local artifact/evidence files only:

1. `blender -b --threads 3 -P tools/blender/rpg_mansion/modular_architecture/build.py`
2. `blender -b --threads 3 -P tools/blender/rpg_mansion/modular_architecture/render.py`
3. `blender -b --threads 3 -P tools/blender/rpg_mansion/modular_architecture/assemblies.py`
4. `blender -b --threads 3 -P tools/blender/rpg_mansion/modular_architecture/replay_sources.py`
5. `blender -b --threads 3 -P tools/blender/rpg_mansion/modular_architecture/audit/audit_geometry.py`
6. `python tools/blender/rpg_mansion/modular_architecture/check_uv_overlap.py`
7. `python tools/blender/rpg_mansion/modular_architecture/review_checks.py`

Rebuilding is different from read-only replay; source file hashes may change when Blender saves newly generated files. Use the saved delivered sources for validating the sealed evidence.
