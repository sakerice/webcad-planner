# Mansion decorative lighting: ten additional constructions

Ten original fixture assemblies extend the separately certified banker lamp, wall lantern, and linear pendant. Together the lighting family has thirteen models. Repeated bulbs, shades, guard members, arms, or candles are components within a model, not extra assets. No recolour-only or uniform-scale variants are counted.

The new constructions are a counterbalanced task lamp, guarded carry lantern, timber-tripod drum floor lamp, stone-base arched reading lamp, upward-bowl torchiere, hexagonal post lantern, twin articulated wall reading fixture, protective-cage pendant, three-stay pleated drum pendant, and three-branch tabletop candelabrum.

## Deliverables and placement

- `authoring_sources/`: ten compressed native Blender files with separately editable parts.
- `sources/`: ten compressed canonical Blender files, each containing Native authoring parts and Validated export scenes, with measured validation records.
- Runtime models: one combined GLB per fixture; metres, +Y up, +Z front, bottom-centred origin. Native Blender authoring uses +Z up and -Y front.
- Catalogue and evidence: transparent 512×512 thumb, top, front, and rear views per model.
- `proofs/`: twelve saved proof sources importing actual delivered GLBs. Ten contain labelled QA support slabs; two contain coloured markers behind actual exported glass.
- `evidence/`: thirty installed views, four actual/control glass images, one overview, and ten compact product/installation review pages. QA slabs and markers are excluded from model counts.

Default bottom elevations are 0 mm for floor models, 740 mm for desktop models, 1450 mm for the twin wall fixture, and 1960 mm for the two pendants. Both pendant canopies meet a 2700 mm ceiling. Exact dimensions and wall/support planes come from current exported geometry and are recorded in `descriptors.json`.

These are static decorative meshes. There are no native light objects or KHR_lights_punctual emitters. Opal bulbs use modest appearance-only material emission; the three wax candles have unlit wicks and no emission. The models do not provide runtime switching, dimming, movable hinges, automatic ceiling following, electrical wiring, or load/electrical certification. Articulated parts describe the modeled construction and remain editable in the native source.

## Geometry and evidence

The source and exported geometry are checked for closed positive-volume parts, true shade openings, physical installation faces, and actual part contact. Functional checks include 153 intended support points (151 source-declared points plus two additional producer/independent carry-ear-to-roof probes), sixteen open-volume rays, and two physical glass thickness probes. The carry handle connects through mounting ears to the roof; the task fixture has physical pivots; both drum shades have real openings and supported sockets; wall and pendant models have actual positive-area mounting faces.

Each model stays within a 6000-triangle budget. Full-surface exact reexport checks cover positions, indices, UVs, normals, and PBR. Packed UV triangles are checked for overlap and flat-face normals are checked against their actual triangle normals. Seventy-four product/proof images are replayed from final saved sources and compared at every RGBA pixel. Thirty-two Blender sources are scanned after decompression and inspected with their saved UI for unwanted paths, dependencies, or external images. Geometry-only and normalized-geometry comparison covers all 207 previously accepted runtime models.

The candelabrum's nonplanar wax caps were explicitly triangulated using the original surface triangles. Their original projected UV charts overlapped, so the final candle model received a new metric UV packing. Exact geometry, winding, and material assignments were preserved, and the other nine models' 114 protected files stayed unchanged. The corresponding QA records describe the final correction and its scope.

## Reproduction and status

Blender 4.3.2 was used. `build.py -- --no-icons` generates native sources and runtime GLBs. `render_batch.py` renders saved final sources, and `build_installation_proofs.py` creates proofs from the exported GLBs. The source-specific replay scripts rerender final sources with deterministic Cycles seed 0, 32 samples, and denoising disabled.

`delivery-files.json` seals the producer payload. Producer checks and a visual direction approval do not replace the separate independent final-byte certificate and final root visual review. The parent bundles these ten models with the separately frozen three lighting prototypes; this directory does not modify that accepted snapshot, the accepted 204-model baseline, the twelve materials, the main application, or any deployment.

## Rights

Original project-authored Blender geometry, materials, and rendered evidence for this project. No third-party geometry, textures, scans, image assets, or paid generation were used. Existing project helpers are copied unchanged and bound by hash. No separate public reuse licence is granted. Dimensions describe intended original designs, not measured historical replicas.
