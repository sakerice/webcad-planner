# Original mansion tables and desks

Fifteen independently authored furniture forms in a coherent walnut, teal,
antique-brass period style. They extend the mansion catalogue with different
load-bearing arrangements, surface outlines and purposes, rather than changing
only the size or color of one table. No imported furniture geometry, purchased
asset pack, image texture or paid generation service is used.

## Forms

1. Oval dining top with linked double baluster pedestals and six curved feet
2. Concave kidney writing desk with leather inset and four cabriole legs
3. Round library table with a radial drawer drum and four-foot pedestal
4. Open drop-leaf gateleg table with separate supporting gate frames
5. Raised tea tray on an X-shaped folding-style fixed frame
6. Square baize card table on tapered legs
7. Five-plank banquet surface on two through-bridged shaped trestles
8. Octagonal center table with clustered turned supports and crossed stretchers
9. Flat-backed half-moon console with three turned legs and curved Y bracing
10. Physical 64-square chessboard on a slender three-foot pedestal
11. Three-tier serving dumbwaiter with successively smaller trays
12. Three-drawer dressing table with a framed oval silvered mirror
13. Compact Davenport desk with a sloping leather lid and upper pen box
14. Double-sided partners desk with two drawer pedestals and pencil drawers
15. Roll-top desk with a quarter-round fixed slatted cover and curved cheeks

## Contract and source format

All coordinates are authored directly in metres. Blender uses Z up and -Y front;
the GLB exporter maps this to +Y up and +Z front. Envelopes are measured from the
actual vertices, with a bottom-centered origin and no global normalization.
Surface heights are independent design measurements. All meshes are closed,
with one UV layer, finite non-degenerate triangles and explicit English material
names. Used materials carry real `finishChannel` properties and GLB extras.

`descriptors.json` contains the asset-only handoff for the parent catalogue,
including exact dimensions, measured triangles, actual byte counts, finish
defaults, native source paths, preview paths, provenance and hashes. This folder
does not modify a shared manifest, registry, application code, git branch or
remote. Parent integration and actual application rendering are separate work.

The canonical `sourceBlend` has an active combined one-mesh export scene and a
separate scene named `Native authoring parts`. The latter retains every named,
individually editable, UV-mapped part before the combine operation. Independent
authoring-only checkpoints are also kept as `*-authoring.blend`. The native
secondary scene is verified against the actual GLB material point support and
triangle counts. No linked library or external image is needed to open a file.
Both source versions are compressed and have relative render/browser paths.
Appended meshes retain their exact named topology, UV data and finish materials
while Blender weak-library path references are removed by copying and remapping
the datablock. `source-sanitization-qa.json` records exact before/after native
fingerprints; `saved-source-privacy-qa.json` scans decompressed saved files.

Closed connected components are checked individually for consistent, outward
winding and positive world-space signed volume. `repair_winding.py` flips only
inward components and verifies unchanged shape, polygon membership, smoothness,
materials and corner UV associations. Seven reported native parts were repaired
in canonical, native and standalone sources; only four models were rerendered.

Two thin rounded components use separate metric-isometric triangle UV charts
to prevent Smart UV self-overlap. Their existing loop triangles are retained
exactly, including orientation, materials and smoothness. The kidney drawer
face and roll-top bottom handle rail are corrected by `repair_uv_atlas.py`;
their combined atlases are uniformly repacked. Pure-color kidney images are
unchanged. `check_uv_overlap.py` checks actual GLB triangle intersection areas.
Custom loop normals retain their corner associations, with only Blender's
re-encoding quantization (verified vector error below 0.0005, about 0.03 degrees).

All supplied furniture is static. Drawer faces, gateleg frames, folding-style
rails, tambour cover, mirror pins and serving tiers describe construction;
there are no animation, moving-mechanism, live mirror or game-logic claims.

## Reproduce locally

From this isolated repository root, with installed Blender and Python/Pillow:

```sh
blender -b -t 4 --factory-startup --python tools/blender/rpg_mansion/scaled_tables/build.py
bash tools/blender/rpg_mansion/scaled_tables/validate_delivery.sh
```

The common `model_kit` checks dimensions, origin, closed edges, UV density,
material channels and a strict 6000-triangle maximum. Most of the added forms
are under 4000 triangles; the double-pedestal dining and radial library tables
have explicit larger budgets. Geometry is verified before and after export.
All models remain below a one-megabyte individual GLB byte ceiling.

For selective rebuilds, use `--only kidney,drum` or another list of short form
keys. `--no-icons` skips PNG rerendering when geometry has not changed. Each
preview is 512 × 512 RGBA with a transparent, nonempty, unclipped background.
Front and rear evidence uses the same native final mesh as the export. Contact
sheets combine existing rendered images and add labels only.

## Evidence

- `actual-byte-qa.json`: decoded actual GLB bounds, UVs, materials, triangles,
  hashes, bytes and preview alpha/framing checks
- `reopened-source-qa.json`: canonical and authoring-only source comparison
- `native-joint-qa.json`: native closed-part surface contact/containment graph
- `generic-source-qa.json`: the repository generic reopened-source inspector
- `outward-winding-repair-qa.json`: repaired component volumes and shape/UV invariants
- `uv-atlas-repair-qa.json`, `packed-uv-overlap-qa.json`: chart repair and zero-overlap checks
- `family-thumb-contact-sheet.png`, `family-top-contact-sheet.png`,
  `family-rear-contact-sheet.png`: family visual review
- `delivery-summary.json`: final measured delivery totals and provenance hashes

The contact graph uses world-space triangle BVHs and point containment at a
20-micrometre contact tolerance. It checks static part attachment, not working
joinery engineering or simulated moving mechanisms. Source QA and byte QA do
not constitute actual application runtime QA or a mobile performance guarantee.
