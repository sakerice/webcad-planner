# Fitted six-panel mansion door

One original static door construction for the accepted 1200 × 2400 mm rectangular mansion doorway. No new frame, accessory, colour variant or open-pose catalogue ID is counted.

The actual timber leaf is 1192 mm wide, 2384 mm high and 44 mm thick. Its closed installed bottom is 12 mm above finished floor; left, right and head gaps are 4 mm. Six double-sided recessed panels have solid chamfered fields and closed mitred mouldings. Three brass surface hinges have alternating bored knuckles, retained pins and offset straps. Two attached brass knobs, escutcheons and a surface rim latch/keep complete the construction. The complete catalogue envelope includes the stationary host-side hardware and is 1343 × 220 × 2384 mm.

## Exact host and installation

Use only the unchanged `rpg-mansion-rectangular-doorway-bay-01` accepted host, SHA-256 `09f55c4d0b3070c97afae46d93b5553f027967671319dc4aa956d0e32c67cecc`. The local copy in `inputs/` is byte-identical to the frozen 0712 and 0737 integration snapshots. The actual imported geometry is probed at three depths and three heights to verify x = ±600 mm; the imported head is at 2400 mm. Timber reveal depth is 280 mm, from construction Blender Y −155 to +125 mm. The front architrave is at Y −163 mm, giving a 288 mm overall opening-face span when the architrave is included. These are the geometry's own construction coordinates, not a new standard-door specification.

The accepted herringbone floor is reused at −75 mm to place its finished surface at 0. Board seams/chamfers are real shallow relief; the maximum finished surface is the floor datum. No threshold is added. All host/floor hashes, construction-to-catalogue translations, exact placement matrices, probes and dimensions are recorded in `inputs/accepted-input-manifest.json` and `reports/installation-proof.json`. Blender coordinates are Z-up, front −Y; glTF coordinates are Y-up, front +Z. glTF(x,y,z) = (Blender.x, Blender.z, −Blender.y).

`installationDatums` in the descriptor records the exact inverse origin translation for placing this model against the host's construction frame. `defaultElevation=12` is the leaf's installed floor clearance. The complete hardware envelope is bottom-centred in the standalone GLB, so don't use its overall width to infer leaf width or its XY centre to infer the hinge line. Use the recorded matrices. There is no scaling or mirroring.

Stationary hinge plates and strike fixing ears bed 0.5 mm into the host's front architrave face; moving hinge straps and rim-latch body similarly bed into the timber leaf. This small concealed attachment overlap is intentional. No jamb mortise, wall cut or other host alteration is used. Hinge pin/bore nominal radial clearance is 0.2 mm; alternating knuckles have 1 mm axial gaps. Pin retaining heads contact the fixed end knuckles. The latch bolt is visibly engaged in a surface keep ahead of the unchanged jamb.

## Static and manual limits

The delivered GLB is one combined static closed mesh. Its stationary hinge plates, pins and strike are part of that same mesh. Rotating the whole catalogue model does not operate a door. The catalogue gains no native wall opening/cutting, host association, hinge hierarchy, opening state, animation, collision, route connectivity or traversability.

The closed assembly imports the exact delivered GLB and exact accepted host/floor bytes. The separate editable QA-only open scene uses the same original door vertices, checked against the closed imported GLB at one-micrometre coordinate rounding. It keeps the host, floor and every `stationary-host` component fixed; it translates only `moving-bolt` 35 mm along negative construction X, then rotates `moving-leaf` and the retracted bolt −90 degrees about construction Blender Z through (−610, −180) mm. This is an explicitly manual demonstration, not an extra model or an implemented opening mechanism.

The proof checks triangle-surface intersections at 5-degree increments, including the retracted closed state and the 90-degree pose. It does not certify the continuous swept volume between samples or physical mechanism performance. The 90-degree moving-geometry envelope leaves 1060 mm to the opposite jamb. Proof scenes leave 1300 mm free in front and 900 mm behind. These support the recovered project placement guidelines of 900 mm at doors and 750 mm hall circulation; they are not building, fire, accessibility, security, weather or structural compliance certification.

## Rebuild and review

From this self-contained directory:

```
blender -b -t 2 --python build.py
blender -b -t 2 --python build_proofs.py -- --no-render
blender -b -t 2 --python build.py -- --render-only
blender -b -t 2 --python build_proofs.py
python finalize.py
```

`authoring_sources/` preserves individually named native construction parts with motion-group labels. `sources/` preserves the canonical export and machine validation. `models/` contains the single GLB. `previews/` contains transparent 512 × 512 catalogue views. `evidence/` contains front/back, side, assembled plan, hardware details and QA-open views. `proofs/` contains actual installed closed and explicitly QA-only manual open scenes. The builders don't touch a repository, remote, catalogue manifest or app code. `integration-copy-map.json` is a reviewable path/hash map, not an installation command.

All new geometry and flat PBR materials are original procedural Blender construction for this project. There are no downloaded models, external textures, reference images, linked libraries, credentials, personal information or external image rights. Shared native construction/export helpers are copied from the accepted project workflow, preserving their implementation. Accepted host and floor copies are comparison evidence, not additional new products. Metadata is sanitized; ordinary images are metadata-stripped. Final acceptance is determined by the independent certificate and root visual review, not by this producer README.
