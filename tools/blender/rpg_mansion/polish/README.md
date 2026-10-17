# Bounded RPG mansion asset delivery

This batch targets the asset-set contract from PR #81. It preserves existing
runtime IDs, millimetre envelopes and finish-channel contracts, restores editable
native sources, refines the sofa and wing chair, and adds two original props.
Application HTML/JavaScript and production deployment are outside this delta.

## Deliverables

- 57 normalized production descriptors in the existing `rpg-mansion` pack
- 57 native `.blend` sources, reproduction scripts, front/rear inspection PNGs
- 57 GLBs and 114 transparent 512 × 512 catalogue/top images
- 48 unchanged assets recovered from original native procedural functions
- Five original kitchen sources and rear renders preserved byte-for-byte
- Measured 460 mm sofa/wing-chair seating surfaces with original envelopes
- An 88-key decorative upright piano and a floor globe with original fantasy coasts

`final-native-asset-review-sheet.png` and its underlying closeups are actual
Blender renders of native sources. They are offline asset evidence, not app
screenshots. The chair's continuous solid backing, connected upholstered wings
and attached welting were checked in rear oblique/detail views. Globe coastlines
are shared native topology, not rectangular patches or imported map imagery.

## Reproduce

From the repository root with Blender 4.3.2:

```sh
blender -b -t 4 --factory-startup --python tools/blender/rpg_mansion/polish/seating.py
blender -b -t 4 --factory-startup --python tools/blender/rpg_mansion/polish/props.py
blender -b -t 2 --factory-startup --python tools/blender/rpg_mansion/restore_sources.py -- --resume
```

The seating/props scripts write models and descriptor patches, not the final
manifest. Legacy builders use `catalogue_metadata.py` to retain the normalized
runtime contract. Do not restore legacy application code to run asset scripts.

Independent verification:

```sh
node --test tools/tests/asset-sets.test.cjs
python3 tools/blender/rpg_mansion/qa_asset_delivery.py --sources --output /tmp/mansion-asset-qa
```

All geometry uses metres, +Y up/+Z front in GLB, a bottom-centred origin, and
material `finishChannel` extras. Globe fixed map colours are not selectable;
its walnut/brass stand uses the declared wood/metal channels. UV mapping is
non-degenerate and stays available for later material application.

## Triangle cost

Sofa: 2,972 triangles. Wing chair: 2,820. Piano: 2,856. Globe: 3,780.
The globe is 804 triangles above its earlier 2,976-triangle prototype, a deliberate
increase for organic constrained coastlines and restrained topology-backed
45-degree graticule. Its builder caps it at 4,400. It is 780 triangles above the
3,000 default guide, below the existing pack's explicit 6,000 ceiling.

## Review limits

This is a bounded quality batch, not a complete high-detail refresh of every
asset. Human app acceptance remains unchecked: set display, placement/facing
between plan and 3D, finish isolation, and saved placement preservation. The
original corner-cupboard rear and other inherited shapes remain unchanged.
No main/PR81 branch update, merge, auto-merge or deployment is included.
