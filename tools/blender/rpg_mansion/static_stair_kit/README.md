# Original mansion static stair kit

This is an original Blender-authored, manually assembled timber stair family. The working candidate is not accepted until the independent byte-specific checks and visual review are complete. No paid assets, downloaded models, image textures, or generated recolors are used.

## Ten useful catalogue IDs, four core constructions

- Four core constructions: housed closed-riser flight, ground-supported framed landing, raked turned-spindle guard, horizontal landing guard.
- Three dimensional variants: eighteen-riser flight, eighteen-riser guard, wider return landing. The wider landing adds two center supports but is deliberately counted as a variant of the same framed landing construction.
- Two host-fitting variants: quarter-turn corner guard and return U-shaped guard.
- One connector accessory: terminal handrail receiver newel.

Counts describe construction novelty; they do not count repeats in an assembly, proof-only floors/supports, or preview images as new assets.

## Shared dimensional contract

Blender uses metres, Z up, with the approach at −Y. Exported glTF uses metres, Y up and front +Z. Every catalogue GLB has a bottom-center origin. Each descriptor records the translation from the construction coordinates to the normalized asset coordinates, and each assembly records the complete rigid matrix from the normalized asset.

- Finished-floor storey rise: exactly 3000 mm.
- Eighteen equal risers: 166.666667 mm each.
- Going: 280 mm. Nine-riser flight has eight treads and a 2240 mm run; eighteen-riser flight has seventeen treads and a 4760 mm run.
- The uppermost walking surface is supplied by the 60 mm transition tongue followed by the landing or upper floor. It is not a nineteenth riser.
- Tread width between housed stringers: 1000 mm. The turned guard/newel caps reduce the most restrictive lateral clearance to 960 mm. Both exceed the recovered project's 750 mm circulation benchmark; this is not a building-code certification.
- Square landing: nominal 1160 × 1160 mm deck, at 1500 mm finished height, with four grounded timber supports. Return landing: 2400 × 1160 mm deck with two additional central supports.
- Handrail centerline is 950 mm vertically above the stair pitch line or landing surface. Its round profile is 70 mm diameter. Upper-flight entry changes rail height through the solid newel shaft; it is a static joined assembly, not a smooth continuous generated rail.

## Placing the modules

Use the supplied assembly matrices, not bounding-box matching or arbitrary scaling. The canonical GLBs are imported without mesh editing into the saved assembly scenes.

1. Place a lower flight at its construction start on the lower finished floor.
2. Its last riser is at Y=2240 mm and the transition tongue ends at Y=2300 mm. Place the landing front at Y=2300 mm. Its top is Z=1500 mm. This keeps deck surfaces adjacent rather than overlapping.
3. The head bearing plate undersides are at Z=1310 mm. They sit on the landing's projecting receiving ledge. The landing legs, plinths, cap blocks, aprons and joists provide the visible support path to the lower floor.
4. A straight upper flight starts at the landing's rear edge. A quarter-turn flight starts at its side edge, rotated −90°. A return flight starts beside the lower flight, rotated 180°.
5. The upper flight foot plates extend 60 mm behind the first riser so they bear on the preceding landing. Their protrusion is part of the model and is included in measured bounds.
6. A right raked guard is authored on X=540 mm. Place the same unchanged GLB at construction X−1080 mm for the left side. No mesh mirroring or nonuniform scaling is needed.
7. Horizontal landing rail ends meet the flight's integral newel shafts. They contain only intermediate/corner posts to avoid duplicate end posts.

The descriptors contain exact dimensional datums and the assembly contracts identify intended support interfaces, source hashes, matrices and geometric probes.

## Real floor-opening proof

The joined scenes contain an actual visible 240 mm upper-floor ring with an empty geometric opening, visible columns and a ground slab. The stair head shoes use actual visible floor-edge bearing ledges. These are proof context delivered in the assembly blend, not extra catalogue assets. The opening is not a hidden collision toggle or an automatic hole cut.

The straight/intermediate, quarter-turn and return route scenes isolate the flight/landing joints; their opening contracts list the edges that still need separately placed guards, apart from the access gap. The fourth scene, full-straight-guarded-opening, installs seven actual standard guard panels and eight four-way receiver newels. It guards both long sides and the front edge, with the head reserved for the stair egress. Source pairs for the 18-riser flight/guard and receiver accessory are therefore demonstrated in a real assembly.

A 2100 mm vertical head-clearance envelope is tested along the actual walking surfaces against the visible upper-floor geometry. The initial straight configuration has a 2426.7 mm minimum measured clearance where a floor is overhead; open void samples have no overhead hit. Each final assembly records its own measurements. Under-stair passage is not claimed.

## Existing architecture datums

The read-only accepted architecture references use a 3000 mm wall-top datum and 0 mm finished floor, consistent with this stair kit. The accepted 75 mm octagon/cabochon floor tile defaults to −75 mm elevation: its bottom would be 2925 mm at the upper level to preserve a 3000 mm finished floor. This is dimensional compatibility, not a new installed-geometry certification of those legacy modules. Existing stone newels and wrought-iron panels are not claimed as direct replacements for the new timber raked guards. Reference descriptor hashes are recorded in reports/architecture-datum-reference.json.

## Files and rebuild

- models/: catalogue GLBs; previews/: transparent 512×512 thumbnail and top PNGs.
- authoring_sources/: editable Blender files retaining named construction parts.
- sources/: canonical combined meshes used for GLB export.
- evidence/: front and rear product images; assemblies/: imported-GLB joined scenes, renders and installation contracts.
- descriptors.json: local paths and detailed construction metadata.
- integration-descriptors.json and integration-copy-map.json: standard repository destinations and exact file hashes. These are integration instructions, not an authorization to modify the stopped application.
- rights-and-provenance.json: project-authored geometry and helper lineage.

Build from the self-contained package directory with Blender using build.py; after rebuilding, use the copy map when repository integration is separately authorized. Use --no-icons for the mesh/source milestone, and --render-only to regenerate evidence from canonical meshes. Run assemble.py after the source pairs exist. The generator is self-contained and does not need to read or write accepted family trees.

## Limits

These are manually placed static RPG meshes. They do not cut native walls/floors, link stair ports, compute routes, enforce circulation, supply physics/traversability, or provide structural/load/fire/building-code certification. Existing accepted architecture, garden, lighting and application files are left untouched. The floor-rise and clearance figures describe these stored configurations only.
