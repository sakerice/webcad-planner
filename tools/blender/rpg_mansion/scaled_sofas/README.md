# Mansion sofa family

This isolated family contains 18 original native Blender furniture assets in 15
structural design families. Three explicitly labeled capacity/return-layout
variants are useful variants, not new styles or palette-only inflation. The
three representative prototypes received parent visual approval; full-family
release acceptance remains subject to independent QA and final parent review.

## Coordinate and construction contract

- Source: metres, Z-up, front -Y, bottom-centre origin
- Export: metres, Y-up, front +Z, bottom-centre origin
- Actual cushion support top: 460 mm, independent of overall height
- Native files retain named construction parts and an active `Validated export`
  scene containing exactly one combined mesh; GLB contains exactly one mesh
  and one scene, exported only from that selected active scene
- Real curved/chamfered parts, closed outward-wound component shells, attached
  upholstery welts/buttons, rounded upholstered roll-cap shoulders and static
  modeled contact paths to the floor
- Actual used finish channels: walnut wood, antique brass metal, velvet/leather
  fabric. Original PBR material graphs contain no imported textures
- Every native/export polygon receives an actual-diagonal metric unfolded UV
  chart, uniformly packed without overlapping triangle area. Compact 2D chart
  staging avoids float32 precision loss on shallow curved-cushion triangles
- Native source and inactive saved file-browser directory histories are
  sanitized to relative paths. Sources are compactly saved without libraries,
  weak references or external image dependencies

The 61 declared standard sofa demand profiles describe 62 catalogue IDs. Five
have model files in the source inventory. Declared dimensions are compatibility
references only. No absent legacy mesh is claimed measured, copied or matched.
None of these props promises an interactive recline, fold, mechanism or physics.

## Reproduce and validate

From the repository root, with Blender 4.3.2 and Python with numpy, Pillow and
zstandard available:

```
blender -b -t 2 --python tools/blender/rpg_mansion/scaled_sofas/build.py -- --no-icons
blender -b -t 2 --python tools/blender/rpg_mansion/scaled_sofas/render_batch.py
blender -b -t 2 --python tools/blender/rpg_mansion/scaled_sofas/qa_native.py
python tools/blender/rpg_mansion/scaled_sofas/qa_bytes.py
python tools/blender/rpg_mansion/scaled_sofas/qa_normals_dedupe.py
python tools/blender/rpg_mansion/scaled_sofas/qa_coplanar.py
python tools/blender/rpg_mansion/scaled_sofas/qa_exact_replay.py
python tools/blender/rpg_mansion/scaled_sofas/make_contact_sheet.py
python tools/blender/rpg_mansion/scaled_sofas/freeze_delivery.py
```

Native QA reopens sources read-only, measures actual connected cushion shells,
checks positive closed-component volumes and opposite adjacent-face winding,
compares original parts to the canonical mesh, independently tests contacts
using triangle BVHs/complete-vertex containment, and regenerates temporary GLB
files. Byte QA decodes delivered triangles, verifies dimensions/origin/materials,
clips actual packed UV triangles to detect self-overlap, scans complete
compressed native payloads for private paths, and compares source replay with
actual geometry, UV mapping and full PBR materials. Additional normal QA checks
unit/finite normals, triangle-winding alignment and exact source-reexport normal
arrays. Exact replay QA also compares every decoded index and vertex attribute,
world-space triangle positions, UV mappings and PBR values with no rounding or
numeric tolerance. The Chesterfield has an explicit 4,200-triangle budget for its rounded arm
shoulders and recessed tufts; the other models target at most 4,000 triangles.
All four images are projection-fitted and checked for at least 12 transparent
pixels at every edge. Geometry-only signatures ignore materials so palette-only duplicates
cannot pass unnoticed. A decoded-triangle coplanar gate also rejects same-facing
overlapping surfaces with an unobstructed outward ray. Opposing contact faces and
floor-bottom contacts are excluded; this check is not a complete CSG proof.

A stricter normal gate exposed a genuine thin sewn-welt corner defect in the
prototypes: the original sweep frame switched axes mid-path. The generator now
uses one stable least-aligned axis for each planar sweep, eliminating twisted
welts. Prototype changes are documented in `qa/prototype-repair-delta.json`.
The final stricter individual-corner test then found inward corner normals on
three narrow sharp-turn welts. Only their shading flags were changed; exact
position, triangle winding, UV and material invariants are recorded in
`qa/shading-only-repair.json` and `qa/exact-replay.json`. The Chesterfield rear
was separately closed with an attached inset upholstered band; its final
4,160 triangles remain within the approved 4,200 limit. Only these four models
needed final-view refreshes; the other fourteen asset/source/view sets stayed
byte-identical to the preceding review candidate.

`delivery-files.json` and `SHA256SUMS.txt` freeze only intended assets, editable
sources, generator scripts, evidence and QA. Temporary re-exports below
`qa/regenerated`, logs, caches and old prototype snapshots are not delivery.
Shared model-kit/readers remain unchanged from the baseline; family-specific
geometry, export, UV and source policies live in this directory. A producer
seal is not independent certification or a claim of publication.
