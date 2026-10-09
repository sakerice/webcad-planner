# Original walnut storage family: 15 distinct constructions

A coherent original family of walnut, antique-brass and clear-glass furniture:

1. Convex bow-front three-drawer commode
2. Segmental-arch glazed two-door vitrine
3. Closed slant-front writing bureau with wedge cheeks
4. Two-part linen press with lower drawers
5. Pitched-louver ventilated hall cupboard
6. Open turned-post five-tier étagère
7. Six-sided corner vitrine with polygonal fitted shelves
8. Broad six-drawer map flat-file
9. Tambour-shutter music cabinet over folio bays
10. Elliptical pedestal cupboard with curved door
11. Sixteen-drawer apothecary chest with brass label plates
12. Board-and-batten lift-lid blanket coffer
13. Deep double-door armoire with swept arched crown
14. Twelve open correspondence pigeonholes over two drawers
15. Low credenza with glazed ends and central open bays

They are independent construction designs, not recolours or counted renamed
resizes. Closed static models are delivered; door/drawer animation is outside
scope. Each retained named component is actual source geometry. Pulls have
mounting plates/stems, glazing fits its physical frame, shelves meet carcasses,
and joinery has continuous door/shutter backing where needed.

## Dimensions and coverage

Five assets use intended furniture footprints. Ten were authored at distinct
footprints from the existing standard catalogue: cabinet, chest, closet and
shelf profiles. `standard-footprints.json` preserves the declared metadata and
original IDs. The legacy model geometry was not independently measured, so no
measurement or functional-equivalence claim is made. Exact source IDs, selected
footprints and each new form's semantic coverage are in `storage-items.json`.
There is no post-hoc anisotropic mesh normalization.

## Deliverables

- `storage-items.json`: isolated merge descriptors; no shared manifest edits
- `export_sources/`: canonical editable .blend files. The active scene has
  exactly one validated combined export mesh; a separate scene beginning
  `Native authoring parts` retains all named native parts and their UVs
- `authoring_sources/`: extra part-only editable checkpoints
- `evidence/`: 512px front and rear transparent images of every model
- `storage-family-contact-sheet.jpg`: inspection sheet of all 15 forms
- `qa-actual-bytes.json`: independent actual GLB buffer/accessor decoding
- `qa-authoring-sources.json`: reopened named-part manifold/UV checks and
  independent regeneration of geometry, materials, triangles and packed UVs
- `generic-source-qa/source-checkpoint.json`: results from the existing generic
  source QA helper, including active mesh and secondary authoring-scene checks
- `qa-glazing-joints.json`: reopened pane/wood surface contact candidates
- `rights-and-provenance.json`: original status and SHA256 of sources/deliveries
- `delivery-totals.json`: exact file, triangle and byte totals
- `delivery-files.json`: the exact publication allowlist; do not copy unlisted logs, caches, backups, or provisional files
- `delivery-hashes.json`: SHA256/size ledger for every allowed file except the ledger itself
- `qa-namedpart-contact.json`: independent closed-world triangle/containment graph; every model has one ground-supported group and no floating part group
- `qa-joinery-classification.json`: repaired real support gaps and separately classified intentional board/drawer reveals
- `qa-native-files.json`: read-only reopening of all 30 canonical/part-only checkpoints
- `qa-uv-overlap.json`: independent actual packed GLB UV triangle clipping; all 15 have zero significant overlap
- `qa-path-privacy.json`: scans saved bytes plus fully decompressed .blend bytes for private production directories
- `render-source-snapshot.json`: exact source, GLB, and four-view image hashes; only 11 geometry-changed assets were rerendered, all 16 views of the other four assets retain their baseline bytes
- `repair-checkpoint.json`: durable repair completion and original output hash checkpoint
- `sanitize_source_ui.py`: reproducible source-only normalization of unused saved file-browser directories and search/bookmark histories, including inactive spaces
- `source-ui-cleanup-report.json` and `source-ui-cleanup-checkpoint.json`: exact pre/post authored-data signatures for all 30 compressed, reopened editable sources; all 15 GLBs and 60 PNGs remain byte-for-byte identical
- `source-privacy-qa.json`: full decompressed source scan including directory strings without a trailing separator

GLBs use metres, +Y up, +Z front, bottom-centred origins, exactly one mesh, exactly one scene, and exactly
one non-collapsed packed UV channel. English material names carry real
finishChannel extras. Wood, metal and, where relevant, glass are separately
selectable. No texture or external geometry dependency is introduced.

Ordinary models are below 4000 triangles. The reviewed bow commode and slant
bureau are the two exceptions; both remain under the inherited explicit 6000
budget. `model_kit.run` validates dimensions, origin, closed manifold islands,
finite UVs and p95/p05 UV density. Editable parts have local metre-scale UVs;
the active export scene has the final packed atlas. Source reopening reproduces
actual delivery geometry and UV signatures. All production PNG metadata is
stripped and the transparent 512px images are checked for visible clipping.

These are project-original geometry and materials with no downloaded models,
images, textures, paid generation or separate public reuse license inferred.

## Reproduce

From this isolated `repo` directory, retained native sources are the authoritative
editable geometry. repair_delivery.py is an idempotent active-scene rebuild of
those sources; build.py is the original procedural design recipe with the same
joinery corrections. Reopening/rebuilding does not require a new model or any
external source:

    blender -b -t 3 --factory-startup --python tools/blender/rpg_mansion/scaled_storage/repair_delivery.py
    blender -b -t 4 --factory-startup --python tools/blender/rpg_mansion/scaled_storage/previews_changed.py
    blender -b -t 3 --factory-startup --python tools/blender/rpg_mansion/scaled_storage/qa_contacts.py
    blender -b -t 3 --factory-startup --python tools/blender/rpg_mansion/scaled_storage/qa_native_files.py

Optional original procedural regeneration, followed by the remaining gates:

    blender -b -t 3 --factory-startup --python tools/blender/rpg_mansion/scaled_storage/build.py -- --no-icons
    blender -b -t 3 --factory-startup --python tools/blender/rpg_mansion/scaled_storage/previews.py
    python3 tools/blender/rpg_mansion/scaled_storage/qa.py
    blender -b -t 2 --factory-startup --python tools/blender/rpg_mansion/scaled_storage/generic_source_qa.py
    blender -b -t 2 --factory-startup --python tools/blender/rpg_mansion/scaled_storage/qa_sources.py
    blender -b -t 2 --factory-startup --python tools/blender/rpg_mansion/scaled_storage/qa_glazing_joints.py
    python3 tools/blender/rpg_mansion/scaled_storage/contact_sheet.py
    python3 tools/blender/rpg_mansion/scaled_storage/finalize.py
    python3 tools/blender/rpg_mansion/scaled_storage/qa_uv_overlap.py
    python3 tools/blender/rpg_mansion/scaled_storage/qa_final.py

Blender 4.3.2 was used locally. Shared construction helpers are unmodified copies of the
existing repository helpers. Storage-only export_contract.py limits GLB export
to the selected active scene; qa_support.py keeps reopened-source report paths relative. QA invokes the generic helper functions only;
it does not invoke their pinned-baseline/main comparison command. No app code,
plans, shared registry, remote branches, production, accounts or user-computer
environments are changed. Browser/editor runtime verification remains an
integration step. These results are file-level and native-source checks.

## Final repair scope

All 15 original designs and exterior dimensions remain intact. Real joints are
small, named furniture components: seated crown undersides; brass rail sockets;
mounted pegs and hardware; hollow drawer trays and narrow housed runners; and
an actual coffer bottom with two narrow lid battens. No giant concealed support
blocks or decorative exemptions are used. Intentional moving-front reveals and
board seams remain visible while their assemblies have physical support.
Canonical sources are orphan-purged, use relative render paths, and keep both
the one-mesh active export scene and separate editable named native-part scene.
The final sources contain 721 UV-valid named components. Five clear glass panes
have measured native-frame contact. Actual GLB totals are 41,868 triangles and
1,873,980 bytes. All 15 are within the inherited 6,000-triangle budget; 13 are
below 4,000 triangles. Browser/editor runtime verification is not claimed.

## Saved UI metadata normalization

After visual and actual-byte acceptance, unused saved file-browser directories
were normalized to the relative source folder in all 15 canonical and 15
part-only checkpoints. Active and inactive saved spaces were covered. These
are metadata/UI-only source changes. Exact signatures preserve every mesh,
UV layer and mesh attribute, corner normal, object transform, material node
graph, custom property, native component, scene, world and collection. Each
source was compactly saved and reopened. No geometry regeneration, GLB export,
render, or image processing ran. All 15 accepted models and all 60 accepted
four-view PNGs retain their original bytes. Existing geometry, contact,
reexport and render evidence is explicitly rebound to the unchanged authored
data, while the original pre-cleanup hashes remain recorded.

To reproduce this source-only pass and refresh the evidence bindings:

    blender -b -t 2 --factory-startup --python tools/blender/rpg_mansion/scaled_storage/sanitize_source_ui.py
    blender -b -t 2 --factory-startup --python tools/blender/rpg_mansion/scaled_storage/qa_native_files.py
    python3 tools/blender/rpg_mansion/scaled_storage/source_privacy.py
    python3 tools/blender/rpg_mansion/scaled_storage/rebind_source_ui.py
    python3 tools/blender/rpg_mansion/scaled_storage/qa_final.py

The sanitizer is resumable: sources already bound to a completed unchanged
source hash are left untouched. It never changes model or image deliverables.
