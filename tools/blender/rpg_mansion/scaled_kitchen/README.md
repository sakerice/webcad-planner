# Measured modular scullery family

This is original static period-adapted furniture for the RPG mansion asset set. No third-party mesh, texture, image, paid generation service, or external model was used. Shared primitive, export, UV, and preview helpers are the project's existing Blender tools.

The family contains meaningful installation, storage-layout, capacity, footprint, and fixture differences. Drawer modules at distinct widths are explicit footprint/capacity variants, not new styles. Materials expose separate finish channels; recolors do not increase the inventory count.

## Reproduce

Use Blender 4.3.2, Python 3 with NumPy, Pillow and zstandard, and the repository helpers
listed in `delivery-files.json`. Run from the repository root, in this order:

    blender -b -t 2 --factory-startup --python tools/blender/rpg_mansion/scaled_kitchen/build.py -- --no-icons
    blender -b -t 2 --factory-startup --python tools/blender/rpg_mansion/scaled_kitchen/finalize_sources.py
    blender -b -t 2 --factory-startup --python tools/blender/rpg_mansion/scaled_kitchen/repair_uv_atlas.py
    blender -b -t 2 --factory-startup --python tools/blender/rpg_mansion/scaled_kitchen/sanitize_source_ui.py
    IDS=$(python3 -c 'import json; print(",".join(json.load(open("tools/blender/rpg_mansion/scaled_kitchen/changed-render-ids.json"))))')
    blender -b -t 2 --factory-startup --python tools/blender/rpg_mansion/scaled_kitchen/render_batch.py -- --only "$IDS"
    python3 tools/blender/rpg_mansion/scaled_kitchen/refresh_validation.py
    python3 tools/blender/rpg_mansion/scaled_kitchen/source_privacy.py
    python3 tools/blender/rpg_mansion/scaled_kitchen/qa_batch.py --sources
    python3 tools/blender/rpg_mansion/scaled_kitchen/make_contact_sheets.py
    python3 tools/blender/rpg_mansion/scaled_kitchen/freeze_delivery.py

The supplied image-refresh list is the measured physical-geometry comparison
against `pre-joinery-snapshot.json`: 20 changed assets and two unchanged assets.
It includes the draining stand, whose vertex support changed without a triangle
count change. The bottle rack and glazed wall cabinet preserve all four image
files byte for byte. Do not use UV-only changes as a reason to rerender: the
repair report verifies geometry, cyclic triangle association, materials,
smoothing and normals are unchanged. Fresh production without the supplied
image baseline must render every asset once; later refreshes use a newly measured
change list. Never rebuild, refinalize, or repair a frozen delivery merely to
refresh its hashes.

`build.py -- --only <comma-separated slugs>` rebuilds selected assets and merges successful descriptors without deleting other family entries. `render_batch.py -- --only <comma-separated full asset IDs>` restricts image production. `render_batch.py -- --missing` renders only missing previews/evidence. The family descriptors are a delivery input for the coordinator, not a separate runtime catalogue or application modification.

## Editing

Every canonical `.blend` opens in `Validated export`, containing one combined validated mesh with its UV atlas. Switch to `Native authoring parts` for named separate editable meshes with UVs. This original authoring scene must reproduce the combined export's material point support and triangle counts. Run the builder or rejoin and UV-map at final world size after editing parts.

Blender source axes are metres, Z-up, front -Y. GLB export maps these to metres, +Y-up, +Z-front. The whole-model pivot is the bottom centre of the declared footprint. Dimensions are authored directly; no whole-model stretching is used to force a fixture to fit.

## Counter and fixture contract

Ordinary base-unit worktops are 850mm above the floor. Sink overall height includes the attached swan-neck tap and is a separate 1162.67mm envelope. The ceramic bowl's reopened ring vertices measure approximately 184mm from rolled rim to inner floor; the drain is real geometry. A continuous stone counter has real rounded cutouts under the bowl rims.

The right-return corner is an actual L footprint with a 250mm notch, distinct from the existing left-return asset. The diagonal corner has a genuinely truncated footprint and diagonal cabinet front. Neither is a rectangular block renamed as a corner.

Wall modules require manual rear alignment with a wall. Their default bottom elevation is 1400mm. Cabinets, drawers, doors, taps, stove, and shelves are static GLB furniture; opening, water, heating, native wall-cutting, and other application mechanisms are not claimed.

Exact declared-footprint compatibility refers only to catalogue dimensions and intended role. Legacy geometry or functional replacement is unverified when the legacy binary is absent. A same-size unrelated object is not a substitute.

## Gates and delivery

The builder checks actual bounds, bottom-centred origin, one atlas, material channels, manifold closed components, UV density and per-model triangle budgets. `qa_batch.py` reads actual GLB vertex/index/UV data and PNG bytes. Its family-local `qa_sources.py` reopens each canonical source without saving, re-exports only the active validated scene, and compares geometry/material/UV signatures. The shared checker is unchanged. Strict atlas-overlap and native-component acceptance are separate independent gates; a density-only pass is insufficient to claim those gates passed. Runtime application placement and recolor QA is also a separate gate and must not be inferred from these offline tests.

`refresh_validation.py` records actual annotated GLB bytes, triangles and decoded
UV diagnostics, plus current source/model/builder and image hashes. Contact
sheets are compositions of the delivered PNGs; they do not produce new renders.
`freeze_delivery.py` builds the exact publisher allowlist, per-file SHA-256 ledger,
payload totals and durable checkpoint. The ledger excludes only itself to avoid
a self-referential digest. The checkpoint records offline acceptance as pending
until a named independent final report is supplied by the coordinator.

Ship only the exact paths in `delivery-files.json`: declared GLBs, public 512px
transparent thumb/top PNGs, canonical sources with separate native authoring
parts, component metadata, validation, front/rear evidence, required scripts and
dependencies, provenance, accepted QA reports and final contact sheets. Exclude
caches, build logs, temporary QA re-exports/requests, backups and obsolete
evidence. This delivery does not modify a shared manifest, application, account,
remote branch or deployed site.
