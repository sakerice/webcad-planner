# Mansion catalogue expansion and explicit duplicate conversion

Based on PR73 head `2ca9d766390bb89979c4e8202145a09cde10eb95`, isolated branch
`cloud/rpg-expanded-conversion-20261004`. Local review only; no publication,
main merge, deployment, paid generation or new credentials.

## Category coverage

The resolved standard catalogue has 787 models. The inventory groups them by the
existing semantic `tags.json` kinds, because raw source categories contain known
misclassifications. Machine-readable counts and every target ID are in
`tools/assets/rpg-pack-contract/expansion-evidence/catalogue-inventory.json`.

The mansion catalogue grows from 14 to 50 original models, adding **36 different
shapes/functions**, not colour variants:

| Area | Added models |
| --- | --- |
| Seating | Wing armchair, three-seat sofa, chaise, hall bench, stool |
| Tables / study | Six-seat table, round pedestal table, coffee table, console, secretary |
| Bedroom / storage | Single bed, four-poster double bed, nightstand, wardrobe, dresser, linen cupboard |
| Kitchen | Open hutch, worktable, deep butler sink, cast-iron range, wooden icebox |
| Bathroom | Clawfoot tub, cistern toilet, pedestal washstand |
| Lighting | Floor lamp, table lamp, wall sconce, six-arm chandelier |
| Hall / decoration | Gilt mirror, paired curtains, coat tree, umbrella stand, laurel urn, fireplace, radiator, display armour |

Doors, windows, structural walls, utility equipment, modern appliances, children
and pet furnishings are not automatically replaced. The set covers principal
room functions; it does **not** claim an equivalent for every standard asset or
787 distinct mansion models.

## Conversion contract

Candidate pack selection remains a filter only. The separate pane-local
**この案を洋館に変換…** button opens a preview with before/after thumbnails, retained
items, dimensions, cautions and per-object exclusion checkboxes. Optional 3D
comparison reuses `ComparisonCapture.pair` and the existing renderer with the same
camera and lighting for both plans. It is loaded only on explicit request.

`conversion-map.json` lists 313 standard IDs plus 15 native IDs, using exact-ID
matching at runtime. Catalogue kind/dimensions generate the reviewable table;
there is no runtime fuzzy name guess. **Only 20 low-risk decoration mappings are
selected by default.** The other 308 proposals require explicit user selection:
seat/table/bed/support heights, shelf topology and model-specific functions have
not been certified equivalent. The preview allows individual selection and an
explicit select-all action for eligible proposals, followed by 3D review; hard
exclusions cannot be selected. L-shaped/deep/low seating, unusually wide cabinets,
wall/ceiling-mounted models, tall multi-level beds and refrigerator-to-icebox
changes have explicit retention reasons. Source dimensions are only a conservative
shape filter, not proof of equivalent geometry.

Uncertain classes, unknown IDs, attached
items and extreme axis scaling (below 0.25 or above 4) are retained unchanged.

Conversion returns a JSON clone. Original object IDs, coordinates, stored rotation,
floor, elevation, flips, appearance keys and unknown custom fields are retained.
Existing width/depth/height are kept; absent dimensions are resolved from the
source editor/model, not target defaults. Matching finish channels render on the
target. Nonmatching finish keys remain in JSON; some model-specific effects can
be inert. `assetPackConversion` stores version/source/target provenance, without
duplicating large user textures. The unchanged original plan remains available.
Preserving dimensions can stretch the new shape; front conventions differ across
legacy assets, so 3D preview/manual adjustment remains necessary.

Create adds a separate record through existing `ParallelEditors`, then shows it
in the invoking pane (or a free pane). It never overwrites the source plan or
other pane. Four-plan capacity produces an error before mutation. Saving uses the
existing pane/workspace controls. A changed source snapshot/pane invalidates the
preview. Closing or cancelling aborts mapping fetch and disposable 3D capture;
late completion cannot commit a conversion. Duplicate clicks are disabled.

## Model and loading contract

All new GLBs use metres, +Y up, +Z front, bottom-centred origins; manifest dimensions
are millimetres. Original procedural geometry is generated with existing
`model_kit`, `shape_kit`, `build_decor` and the existing renderer. No third-party
geometry/images or paid tools. No separate public reuse license is granted here;
project owners retain licensing decisions. Editable `.blend` sources, UVs,
material channels, front/top/rear previews and final byte/hash validation accompany
every added item. Lamp models are decorative geometry, not new runtime lights.

The 14 reviewed GLBs and their previews/sources/validation files are preserved.
Their manifest is frozen at
`assets/models/packs/rpg-mansion-contract/v0.1.0/reviewed-manifest.json` so original
geometry/seat/support hash contracts remain testable. The v0.1.0 measurement
script now reads this frozen manifest, preventing accidental regeneration against
the expanded catalogue. **No existing seat/socket or
support sidecar is changed.** New seating has no promised TPS socket/reachability.
TPS/automatic support placement remains separate work.

The expanded pack is below 3.5MB total GLBs, each under 250KB and 6,000 triangles.
There are no texture downloads. These are already low-complexity models; no new
LOD framework or decimated duplicate geometry is introduced. Existing GLB lazy
loading, model caches, pane shared pool and instancing remain in use. Switching
candidate lists or opening the thumbnail preview does not fetch GLBs. The paired
3D renderer reuses its cache between A/B and disposes on close/cancel. Thumbnails
use native lazy loading and existing missing-image handling.

## Reproduce and review

```sh
blender -b -t 4 --factory-startup --python tools/blender/rpg_mansion/expansion/build.py -- --no-icons
# Use --only with expansion slugs when rebuilding selected models.
blender -b -t 4 --factory-startup --python tools/blender/rpg_mansion/previews.py -- --only wing-chair,sofa,chaise,bench,stool,dining-table,round-table,coffee-table,console,secretary,worktable,single-bed,canopy-bed,nightstand,wardrobe,dresser,linen-cabinet,kitchen-hutch,butler-sink,range,icebox,bathtub,toilet,washstand,floor-lamp,table-lamp,sconce,chandelier,mirror,curtain,coat-stand,umbrella-stand,planter,fireplace,radiator,armour
python3 tools/assets/rpg-pack-contract/build_conversion_map.py
python3 tools/blender/rpg_mansion/test_pack.py
WEBCAD_PREVIEW_PORT=8947 python3 local-preview/server.py
# In a second terminal:
node tools/blender/rpg_mansion/expansion/browser_qa.cjs
node tools/tests/asset-pack-conversion.browser.cjs
node --test tools/tests/asset-pack-conversion.test.cjs tools/tests/asset-pack-registry.test.cjs tools/tests/rpg-pack-contract.test.cjs
SKIP_DEPLOY=1 bash build.sh
```

The original 14-model builder now refuses to overwrite a larger manifest unless
specific legacy models are selected. The review gallery pages 10 models at a time.
See the expansion evidence directory for measured results and actual browser images.

## Verified results

- 187 test files processed plus lint self-test, runner exit 0. Existing environment
  skips are not counted as browser passes. The focused registry/old-geometry/new-
  conversion suites contain 24 distinct passing tests.
- Delivered-file validation: 3 test methods iterate all 50 models; exact bounds,
  finite exported UVs, no collapsed UV triangles, channels, source files and
  unclipped front/top/rear images pass. Actual 3D gallery loaded all 50 successfully.
- 2,699,504 total GLB bytes, 69,542 triangles, largest model 172,244 bytes and
  maximum 3,576 triangles. Original 14 item definitions and all 84 referenced
  model/source/preview/validation files match the base byte-for-byte.
- Conversion browser: 11 check groups pass, including cancelled delayed GLB capture,
  same-camera before/after, separate plan creation, per-object exclusions,
  source/other-pane isolation, save/reload, native undo/redo and JSON roundtrip,
  stale snapshot refusal, injected save-quota failure with dirty-clone retention and retry, four-plan capacity, unavailable mapping and 390px modal.
- Expanded picker regression and the 3 delayed-model cases pass. 100 repeated pack
  switches retain data/history/dirty and model/GPU counts without extra GLB requests.
- Synthetic 1,000-object conversion (500 mapped), 10 repetitions: see `conversion-performance.json` for timings in local Node, source unchanged. This is not a mobile latency promise.
- `SKIP_DEPLOY=1` build passes. No runtime dependency or external service was added.

Visual inspection caught and fixed cabinet-top coplanar faces and incorrect
rotation pivots on tubular parts before final generation. Final front/back browser
images and regenerated thumbnails reflect those fixes. Earlier failed debug
captures are not delivered as successful evidence.
