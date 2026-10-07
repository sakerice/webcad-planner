# Original mansion kitchen additions

This is an additive, manual-placement batch for the integrated review candidate.
It starts from PR76 commit `20e3cbabe925901225be9cb7305d2a1a648c571c`.
The existing fifty model definitions and their GLBs/previews remain unchanged.

## Five shapes

| Model | Dimensions mm | Placement |
| --- | --- | --- |
| Double-door base cupboard | 600 × 650 × 850 | Floor; stone countertop at 850mm |
| Three-drawer base | 450 × 650 × 850 | Floor; stone countertop at 850mm |
| L-return corner cupboard | 900 × 900 × 850 | Floor; real 250mm front-left return notch |
| Shallow wall cupboard | 600 × 350 × 700 | Wall; bottom starts at 1400mm |
| Brass cookware rack | 800 × 180 × 550 | Wall; bottom starts at 1450mm |

All fronts are +Z in glTF, +Y is up, sizes are metres in GLB and millimetres in
the manifest, and origins are bottom-centred. Cabinet support heights are
authored directly, not obtained by compressing the existing tall hutch.
Countertop edges have a physical 3mm bevel, so the broad flat support plane is
slightly inset from the nominal outline.

These are static shapes: the drawer and cupboard fronts do not animate, the
base units contain no sink/dishwasher/cooker, and rack cookware is fixed. The
wall items require manual alignment of the rear mounting face and a clearance
check. Nonzero existing `defaultElevation` behaviour prevents floor defaults;
`placementHint`/notes do not claim automatic wall snapping or a load-rated mount.

## Conversion boundary

This batch adds **zero source-to-target conversion mappings**. The exact 328
existing proposals and their 22 target models are preserved. Standard kitchen
size families, sink/cooker fixtures, cutout cabinets and dishwasher options are
not converted to these decorative models. Source GLBs for the low modular
cabinet/corner families were unavailable for a reliable compatibility audit.
Consequently, these five manual assets do not resolve bulk kitchen conversion.

## Provenance and reproduction

Original procedural Blender geometry using the existing project `model_kit`,
walnut/antique-brass/limestone palette, UV/export validators and thumbnail
renderer. No third-party geometry, image assets, paid generation, new runtime
dependency or separate renderer. The project owner retains licensing decisions;
this document grants no separate public reuse licence.

Editable `.blend` sources, validation JSON and rear review images are under
`tools/blender/rpg_mansion/kitchen/work/`. Public GLBs and transparent front/top
previews use the existing pack directories. Preview metadata is stripped.
The previous fifty-item manifest is frozen as the v0.2.0 reviewed manifest.

```sh
blender -b -t 4 --factory-startup --python tools/blender/rpg_mansion/kitchen/build.py
python3 tools/blender/rpg_mansion/test_pack.py
node --test tools/tests/rpg-kitchen-assets.test.cjs tools/tests/asset-pack-registry.test.cjs tools/tests/asset-pack-conversion.test.cjs tools/tests/asset-pack-footprint.test.cjs tools/tests/rpg-pack-contract.test.cjs
```

For a preview-only rebuild, use the existing `rpg_mansion/previews.py` with
`--only kitchen-base-cupboard,kitchen-drawer-base,kitchen-corner-base,kitchen-wall-cupboard,kitchen-pan-rack`.
Do not rebuild the original fifty models to refresh this batch.

## Acceptance limits

Offline Blender images and actual GLB-buffer/source tests support geometry,
material-channel, pivot, unit, bounds, normals, UV and framing checks. They are
not GLTFLoader, browser/GPU, mobile, room-clearance, collision, mounting or
automatic support-placement acceptance. Native kitchen functions stay intact
because no functional source object is replaced. No merge/main/deployment is
authorized by this candidate.
