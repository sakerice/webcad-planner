# Native mansion source recovery

This recovery restores the 48 unchanged models: all 14 original study assets and
34 expansion assets, excluding the sofa and wing chair handled separately. The
five new modular kitchen models already have their own sources.

## Reproduce safely

From the repository root, with Blender 4.3.2:

```sh
blender -b -t 2 --factory-startup \
  --python tools/blender/rpg_mansion/restore_sources.py -- --resume
```

For a bounded subset, use `--only chair,desk` (slugs, not full IDs). Rendering
uses two CPU threads, 24 Cycles samples, transparent 512 × 512 PNGs. `--samples`
may be set between 16 and 32. Successful per-model checkpoints make interruption
and restart safe; resume verifies each saved source and QA image against its hash.

The wrapper directly calls the existing original geometry functions from
`rpg_mansion/build.py` and `rpg_mansion/expansion/build.py`. It deliberately does
not call either script's manifest-writing `main()` and does not import any GLB
geometry. Shared `model_kit.run()` validates dimensions, bottom-centred origins,
closed meshes, triangle budgets, UV density and the manifest's exact channel set.
It writes a temporary comparison GLB and validation report, never the public GLB.

## Editable native scenes

Each recovered `.blend` has two scenes:

- **Validated export**: the native joined Blender mesh, one final UV atlas,
  material-slot/channel assignments, metres, Z up, front −Y, bottom-centred origin
- **Native authoring parts**: the actual separately editable procedural parts
  captured before joining, retaining the exact native join-normalized coordinates; their UVs
  are intentionally the pre-atlas authoring stage

Capture first evaluates Blender's dependency graph, including the final rod's
rotation and translation. Temporary native part/vertex attributes carry each
original component through Blender's join and the builder's normalization. The
attributes are removed before saving. The two native scenes must have matching
material point support and per-material triangle counts; the recovery stops if
this independent strict check fails. No GLB geometry is imported and no tolerance
is relaxed. Saved scene render paths are Blender-relative, so the sources do not
retain the creating computer's workspace path.

The `SOURCE_RECOVERY_README` text datablock records the original builder path and
hash and the command to regenerate the source. All geometry is original native
procedural geometry from repository functions; no downloaded assets are used.
The glass shards and clue stain intentionally have no selectable finish channel.

## Delivered-byte verification

`checkpoints/<id>.json` compares the temporary regenerated GLB to the actual
published GLB accessors. It records triangles, bounds, material/channel assignment,
finite positions/UVs, degenerate world/UV triangles and order-independent hashes.
Geometry/material hashes round positions to seven decimal places in metres
(0.1 µm). UV comparison pairs each UV with its corresponding vertex position and
material, rather than comparing an unassociated UV point set. Exact UV equality
is reported separately and is never inferred from passing UV-quality checks.

Front and rear QA are actual Blender renders of the recovered geometry, viewed
from −Y and +Y respectively; source geometry is not rotated for these views.
Both original published preview images remain untouched.

`recovery-report.json` summarizes completion, any discrepancy and preservation.
`metadata-map.json` provides sourceBlend/builder/originalBuilder/front/rear paths
for catalogue coordination. `preserved-public-hashes.json` records every reviewed
model/thumb/top SHA-256. Existing validation JSON is also checked byte-for-byte
before and after every batch. No manifest or asset ledger is edited by recovery.

## Bounded source-only repair

The original recovery's final unevaluated rod transform affected 11 secondary
authoring scenes. Their validated export meshes and public GLB/PNG files were
already correct. Those secondary scenes were reconstructed from the original
procedural builders with exact native join-normalized coordinates, preserving
the validated meshes, UVs, material assignments and rendered evidence.
`native-authoring-repair-receipt.json` records the measured before/after support
differences, final source hashes, portability correction and preservation checks.
The original creation-time builder hashes remain unchanged as provenance. When
later catalogue metadata updates change a builder's file hash, the checkpoints
also record a separately verified current-builder hash, tied to the final source
hash and exact regenerated material support, triangle counts and triangle surfaces.

The reproducible repair script defaults to a read-only dry run for those 11
models. It performs no rendering and writes no public assets:

```sh
blender -b -t 2 --factory-startup \
  --python tools/blender/rpg_mansion/source-recovery/repair_authoring_parts.py
```

Add `-- --apply` only to replace the bounded secondary authoring scenes and update
their recovery checkpoint source hashes. Optional `--only` selects comma-separated
slugs and `--output` controls the local receipt/backup directory. Backups and logs
are local QA artifacts and are not part of the asset delivery.
