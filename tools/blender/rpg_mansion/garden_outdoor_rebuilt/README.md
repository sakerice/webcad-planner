# Original mansion garden assets

This candidate contains 15 editable original Blender assets: three historical garden IDs reconstructed with new geometry bytes, ten new core forms, and two usable fence join accessories. The package represents 13 core constructions, of which ten are novel. Historical reconstructed IDs must not be counted again as novel additions.

The authoring files retain named native construction parts. Canonical sources contain the validated export mesh. Runtime files are GLB with metres, +Y up, +Z front, and a bottom-centred origin. The three historical IDs are newly reconstructed and are not exact recovery of the earlier binary files. All 15 require fresh independent acceptance.

## Contents

- `models/`: runtime GLB files
- `authoring_sources/`: editable native Blender parts
- `sources/`: canonical Blender meshes and measured validation
- `previews/` and `evidence/`: 512-pixel transparent thumb, top, front and rear product views
- `reports/`: explicit branch/leaf support contacts and measured delivery summary
- `installation_proofs/`: actual unmodified GLBs assembled in saved Blender scenes, with contact/ray reports and four views per case
- `integration-descriptors.json`: standard repository paths and material-channel objects for review by an integrator
- `integration-copy-map.json`: exact source-to-destination mapping and hashes; does not perform integration
- `delivery-files.json`: file hashes for this candidate

No application code, accepted baseline, installed catalogue, or deployed site is changed by this delivery.

## Reproduction

Run Blender 4.3.2 from this self-contained directory with `blender -b -t 4 --python build.py`. `-- --only slug --no-icons` builds one source/model pair. `-- --render-only --views top,front,rear` renders existing canonical sources without rebuilding the geometry. `build_installation_proofs.py` imports the actual delivered GLBs. `python finalize_delivery.py` produces measured metadata and the explicit integration map after every required image is present.

Do not run the generator as if the integrated repository copy were the original self-contained staging directory. Reproduce here, validate, then apply the explicit integration copy map if integration is authorized.

## Construction and installation

The lattice and horizontal board fence share a 1,820 mm module pitch and matching inward half posts. Actual terminal half-post and corner-adapter GLBs close free and right-angle joints. The proof assembles three bays, two terminals, and one corner. Accessory IDs contribute zero core constructions.

The deck has three continuous grounded stepped stringers, six boards at 160 and 320 mm, real risers/ties, and a 1 mm bearing seat. The brick pier has a structural core, bonded brick cladding, weather cap, standoff receivers, and two male gate pins. The gate installation proof includes excluded female collars to establish fit and bearing, not a delivered gate.

The standpipe basin is a continuous hollow stone shell. Three downward cavity probes reach the actual floor, and a vertical gravity-clearance ray from outside the tap reaches the basin floor. This is geometric clearance, not fluid simulation. The wall box includes two physical wall plates and diagonal braces; its default elevation is 900 mm. Planters retain actual inner cavities and contained soil.

The broadleaf trees and hedge use closed rounded leaves rooted on real secondary branches. The conifer uses fine closed needles in layered attached sprays. All plants have editable coherent branch hierarchies. There are no floating random leaf cards or unrequested LOD products. Material variation reuses a small set of foliage and bark primitives.

## Limits and rights

These are static original visual assets. Manual placement and installation dimensions are supplied; automatic snapping, structural loads, building-code compliance, horticultural viability, wind animation, and fluid simulation are not certified. Proof-only floors, walls, and gate collars are excluded from asset counts.

All geometry is authored in native Blender from original procedural construction. No third-party geometry, textures, images, or paid generation is used. The helper files are existing original project tooling copied into this isolated candidate. Rights and source hashes are recorded in `rights-and-provenance.json`. No separate public reuse license is granted.
