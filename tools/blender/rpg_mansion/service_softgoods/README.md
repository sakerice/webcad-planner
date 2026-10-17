# Period service and narrow-hall soft goods

Candidate release: four useful IDs, three new core constructions and one functional-footprint variant. Independent source QA, root visual acceptance and installed application verification are required before promotion. Nothing here changes the accepted250 models, twelve source materials, saved plans, application code or production deployment.

## Bounded bill

- `rpg-mansion-period-range-canopy-01`: original hollow period canopy/flue with wall-bearing plates. Fitted to the actual accepted750×650×863.5mm cast-iron range. Measured underside1610mm, vertical hob clearance746.5mm. Exact envelope940×778×1210mm. Place its canonical origin29mm toward the room relative to the range centre, at1610mm elevation, so its rear plates meet the wall35mm behind the range back. This is a static display mesh, not verified heating or ventilation equipment.
- `rpg-mansion-manual-wash-tub-board-01`: original open zinc wash tub on timber stand, with separately editable ribbed washboard. The tub floor is525mm and rolled rim870mm. Board feet meet the basin floor and two attached cleats bear on the rim. Tub underside and timber bearers meet at504mm. Static empty washing scene; no fluid, washing, cloth or powered-washer behavior.
- `rpg-mansion-hinged-timber-drying-frame-01`: original deployed A-frame. Four grounded legs, eight drying rods supported at both ends, two through-pivots with washers, and pinned spread-limit braces. The joints are visible fixed geometry; no folding mechanism, load certification or clothes simulation.
- `rpg-mansion-narrow-hall-runner-01`: original geometry for a760×3000×7.6mm runner. Useful footprint variant of the accepted rug role, contributing zero new core constructions. A1250mm hall cannot fit the accepted1400×2000mm rug at either right angle; the runner leaves245mm of floor on each side. No copied or detached prior geometry.

## Avoided duplicate work

The read-only audit reopens all22 accepted bed sources and both ranges, inspects their native authoring scenes, records named parts, material channels, actual bounds and exact source/model SHA-256 values. All22 beds retain editable mattress, cover and pillow geometry, including the two early beds whose native parts are in a second saved scene. The existing kitchen range already has a static oven door and stove body. We do not add a duplicate oven or detach old bedding to make extra catalogue IDs. An internal oven cavity, operable oven door and independent bedding catalogue object remain unclaimed.

The following modern/occupancy roles stay explicitly unfilled pending a later scope decision: TV/AV; powered refrigeration; microwave/dishwasher/small cooking appliance; powered washer and pan; AC/fan/purifier/vacuum; outdoor compressor/boiler/meter; child-specific furnishings/toys; pet furniture/bowls/cages. No period object is labeled as one of these substitutes.

## Proof scenes

Four saved static `.blend` arrangements import byte-identical accepted project GLBs from `proofs/inputs`, plus the exact new product GLBs. Only rigid placement transforms are used. Inputs have a hash manifest. Room floors/walls are excluded QA fixtures, not new catalogue products.

1. Kitchen/scullery: canopy above the accepted cast-iron range, beside accepted sink and draining stand. Records measured hob clearance, wall bearing and1375mm front working aisle.
2. Manual laundry: washing tub and drying frame beside accepted sink and drainer. Records floor contact, a1208.5mm front aisle,813.4mm between the tub and drying frame, and no overlap with rear equipment.
3. Narrow hall: runner between cutaway sidewalls, with accepted console and mirror. Records width need, floor contact,7.6mm maximum walking plane and900mm console-front clearance.
4. Existing bedroom: accepted servant bed with its existing bedding, with1050mm side clearances and1550mm foot clearance. Zero new bedding items.

The room and source measurements are project fit checks, not building regulations, engineering or collision/navigation certification. The application gets ordinary static catalogue objects; native walls, openings, rooms, stairs, cloth, ventilation and mechanism semantics are not implemented.

## Targeted QA repairs

The revised candidate corrects only identified joint and surface defects: inward canopy bracket tips, a butt flue seam, recessed washstand rail ends, smooth tub-wall-seated lifting loops, flat positive-area drying-frame foot caps and nonoverlapping runner border corners. The rod/pivot positions and all four outer envelopes stay unchanged. The exact19 changed native parts and every unchanged part signature are recorded in `reports/qa-repair-part-preservation.json`. The first frozen candidate remains historical and is not an accepted release.

## Artifacts and reproducibility

- `build.py`, `forms.py`, `common.py`, `helpers/`: self-contained original Blender construction and export pipeline, including copied project helpers with provenance.
- `authoring_sources/`: editable separate native parts, metric units, outward closed mesh components and per-part UVs.
- `sources/`: canonical single-mesh `.blend` and measured validation files.
- `models/`: static GLB2 with metres, +Y up, +Z front, bottom-centred origin, one UV atlas and explicit material finish channels.
- `previews/`: transparent512×512 catalogue thumb/top PNGs.
- `evidence/`: front/rear/side/underside images, installed proof renders and deliberately false-colored material witnesses.
- `reports/`: original-source audit, measured contacts, delivered-byte checks, source/input hashes and room-fit evidence.
- `integration-descriptors.json`, `integration-copy-map.json`: ordinary catalogue metadata and exact destination mapping for a separately authorized review copy.
- `checkpoints/`: immutable work milestones. These are not acceptance certificates.

Build with `blender -b -t 2 --python build.py`; render with `-- --render-only`; create saved room proofs with `build_proofs.py`; inspect native contacts with `verify_native.py`; inspect actual exported bytes and PNG pixels with `python verify_actual.py`; finalize metadata with `python finalize.py`. Rendering uses64-sample Cycles without denoising because this Blender build has no OpenImageDenoise support. Product images use original flat PBR materials; no external image textures, paid models, paid generation or imports from external asset sites.

Original authorship is recorded, but this package does not invent a new public license. Existing project-owner distribution terms apply.
