# Mansion catalogue expansion and explicit object-set replacement

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

The existing catalogue search is the first sidebar control. A compact secondary
**オブジェクトセットの入れ替え** button opens the existing pane-local conversion
dialog, with two grouped operations:

- **オブジェクトリストの差し替え** changes only the left catalogue candidates
- **現在の間取りのオブジェクト一斉差し替え** replaces eligible placed objects

Both dropdowns are draft selections. Selecting alone does not apply either
operation; each group has its own explicit **オブジェクトを差し替え** button.
New/ordinary lists default to 日本建築標準; saved RPG list selections are retained.
The placed-object dropdown reflects Japanese/RPG membership; mixed layouts
require selecting a destination rather than pretending they are Japanese.
The existing per-object review, thumbnails, dimensions, cautions and retention
reasons are reused. Optional 3D comparison reuses `ComparisonCapture.pair` and
the same renderer, camera and lighting; it loads only on explicit request.

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

**元の間取りを残して別プランを作成** is checked by default. It creates an
independent ID through the existing common `PlanLibrary`/`ParallelEditors`
repository, source ticket and CAS path. The original live editor, saved head,
other panes, unknown fields and legacy-copy lineage remain protected. The copy
is retained in the common inventory as a dirty draft and can be opened through
the ordinary plan switcher. The four-plan limit blocks before creation.

Unchecking uses the existing native edit transaction, `saveState()` Undo step,
and `EditorPane` capture/rollback hooks. It stays on the same current plan ID,
preserves the prior history, and does not immediately persist a saved revision.
Normal edit/draft behavior remains in use. Geometry and IDs are never normalized
through JSON import. Failed rendering, tool/catalogue refresh or validation rolls
back the same native memento. In-place replacement is disabled during active
shared-room editing; the independent-copy option remains available.

The exact correspondence also supports a conservative Japanese return trip:
only valid v2 provenance with the known source/target/revision and a verifiably
preserved effective height may identify an original. Bare RPG objects,
many-to-one ambiguity, stale or corrupt provenance, attachments and incompatible
heights are retained with an explicit reason. Provenance/custom fields are kept,
and the same correspondence can be reapplied; no second reverse mapping table
or guessed Japanese model is introduced.

A changed source snapshot, identity, installation or edit epoch (including
edit→Undo) invalidates the preview. Closing/cancelling aborts mapping fetch and
disposable 3D capture; late completions cannot apply to another plan. Duplicate
clicks and cancellation while the native commit is busy are guarded.

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

## Object-set UI redesign verification

The redesigned controls have source/Node acceptance only. The controller tests
execute the real catalogue/picker/dialog/converter plus native history and
rollback functions against anonymous DOM contract fixtures. Independent review
also exercised the actual native sofa resolvers and actual legacy admission/CAS
repository. The affected browser scripts now use current native library flows,
but they have not been executed for this redesign: permitted cloud-browser
navigation is blocked. No screenshot, mobile geometry, touch or WebGL pass is
claimed for the redesigned UI. This change adds no models or category coverage.

## Historical expansion verification (before this UI redesign)

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
