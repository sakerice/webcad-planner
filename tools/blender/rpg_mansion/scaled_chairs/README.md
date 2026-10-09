# Original mansion chair family: 24 forms

Isolated local production. No shared catalog, manifest, remote branch or
application behavior is changed. Final acceptance requires the independent
reviewer and parent visual review; a local passing receipt is not publication.

All 24 forms differ in back/support topology, useful seating task or capacity.
Finish colors are editable channels and are never counted as models. Native
Blender geometry is original; no external geometry, images or textures are used.
All rocking, folding and adjustable-looking forms are static props.

Each asset has a part-only compressed authoring `.blend`, plus a compressed
canonical `.blend` with one active export mesh and a separate native-part scene.
Each GLB contains one mesh in one scene. Authoring is in metres, Z-up / -Y front;
glTF is metres, +Y-up / +Z front, at bottom-centre. Intended width/depth/height are
measured from decoded geometry, without normalized object scaling. The broad
seat surfaces reach 460 mm; cane and saddle surfaces have their actual structure
checked separately. The prayer-room form has a low footrest, not an accessible
kneeling platform beneath its seat. Benches declare seating capacity two only
where the main seat is 1355 mm wide.

Declared standard catalog footprints and nearest references are metadata targets
only. They do not verify unseen legacy geometry, clearances or equivalence.
No automatic substitution or historical reproduction claim is made.

The three representative prototypes were approved before expansion. During full
QA, genuine defects were repaired: caned bergere reeds now follow the oval's
depth plane; ladder/reused rear-leg designs have attached floor endings; the
short slipper feet use a monotonic shortened lathe profile; shield spindles are
joined. Coplanar cushion/side overlays on scoop and X stools were removed,
and the cane stool uses one continuous hollow frame to avoid overlapping corners.
The approved curved-rocker model/source/images are preserved.

Metric UV charts unfold warped quads about their real tessellation diagonal,
then use a uniform atlas packing scale. GLB checks cover actual bounds, finish
channels, geometry, normals, PBR, PNG alpha margins, UVs, budgets and bytes.
Native sources are reopened read-only for manifold/winding, part contacts,
privacy, and a full geometry/UV/PBR/normal-matching re-export. Additional checks
cover physical floor contacts and material-independent normalized-surface dedupe.
These are static contact checks, not load simulation or mechanism engineering.

Every model has transparent 512 px thumbnail, top, front and rear renders.
The camera fits actual evaluated camera-space vertices, and final alpha bounds
must leave at least 12 px on every edge. Saved source render paths and browser
UI paths are sanitized before sealing. The common qa_asset_delivery.py helper is
unchanged from accepted SHA256
55befe8339de8e6089340e865186bdd1008cf9ed5ee53486ced779172459cee9.

Reproduce from the repository root (requires Blender 4.3.2, Python NumPy,
Pillow and zstandard):

    blender -b -t 4 --factory-startup --python tools/blender/rpg_mansion/scaled_chairs/build.py -- --no-icons
    blender -b -t 4 --factory-startup --python tools/blender/rpg_mansion/scaled_chairs/render.py
    python tools/blender/rpg_mansion/scaled_chairs/finalize_metadata.py
    python tools/blender/rpg_mansion/scaled_chairs/qa_family.py
    python tools/blender/rpg_mansion/scaled_chairs/check_uv_overlap.py
    python tools/blender/rpg_mansion/scaled_chairs/source_privacy.py
    blender -b -t 4 --factory-startup --python tools/blender/rpg_mansion/scaled_chairs/qa_family.py -- --sources
    blender -b -t 4 --factory-startup --python tools/blender/rpg_mansion/scaled_chairs/qa_contacts.py
    python tools/blender/rpg_mansion/scaled_chairs/qa_shading.py --require-reexport
    python tools/blender/rpg_mansion/scaled_chairs/qa_distinct_support.py
    python tools/blender/rpg_mansion/scaled_chairs/contact_sheet.py
    python tools/blender/rpg_mansion/scaled_chairs/freeze_delivery.py

`--only key,key` limits a build or render. Production increments were at most 12
assets. Use `delivery-files.json` as the exact publish allowlist. It excludes
logs, debug scripts, private-path scratch requests, regenerated QA GLBs, caches
and stale prototype-only evidence. The allowlist does not include itself.
