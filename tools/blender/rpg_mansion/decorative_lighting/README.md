# Mansion decorative lighting: three reconstructed prototypes

Three original static fixture models: banker desk lamp, bracketed wall lantern, and one four-head linear pendant. Four pendant heads count as one model. No palette-only variants or QA support slabs count as assets.

The original undelivered binary files were lost. These files are fresh reconstructions from the surviving project-authored geometry recipe, independently reviewable by their new hashes. The lantern repair retains its one-piece upper frame and two physical roof-to-frame hangers; hanger tips end inside the roof wall, with no protrusions through the roof cap.

## Contents and use

- `authoring_sources/`: separately editable original Blender parts, one native scene per file.
- `sources/`: canonical Blender file with both Native authoring parts and Validated export scenes, plus measured validation records.
- Models: one selected combined GLB mesh per asset, metres, +Y up, +Z front, bottom-centred origin. The original Blender parts use +Z up and -Y front.
- Product images: transparent 512×512 thumb, top, front, and rear views.
- `proofs/` and `evidence/`: actual exported GLB mounted on a QA desktop, wall, or ceiling; exported glass marker and no-glass control; labelled visual review sheets.
- `qa/`: measured geometry, part supports, true shade openings, installed contact surfaces, exact geometry/UV/PBR/normal reexport, exact product/proof pixel replays, saved-source privacy, and 204-model duplicate comparison.

Default model-bottom elevations are 740 mm for the banker lamp, 1500 mm for the wall lantern, and 2100 mm for the pendant. The pendant canopy top meets a 2700 mm ceiling. Exact placement planes are recorded in each descriptor. The native sources have no light objects, and GLBs have no KHR_lights_punctual extension. Bulbs use modest appearance-only material emission (strength 0.3). No native runtime illumination, brightness control, wiring, switching, automatic ceiling following, or physical/electrical certification is included.

Finish channels identify metal, glass, ceramic, and, where present, shade materials. Glass is modeled as closed physical geometry with actual exported alpha and transmission. Shade undersides and shade necks are geometrically open where specified.

## Reproduction

With Blender 4.3.2, run `build.py -- --no-icons`, then `render_batch.py` and `build_installation_proofs.py`. Product rendering uses deterministic Cycles seed 0, 32 samples, no denoising, and a transparent neutral studio. Replaying existing final sources does not require rebuilding geometry. Use `render_batch.py -- --replay` and `replay_proofs.py`, followed by the corresponding pixel comparison tools.

`delivery-files.json` seals the producer snapshot. Acceptance is established separately by the root visual review and independent final-byte certificate; a producer checkpoint alone is not acceptance. The first three prototypes will be bundled with the broader useful lighting family rather than delivered separately.

## Rights

Original project-authored Blender geometry, authored materials, and rendered evidence for this project. No third-party models, textures, scans, images, or paid generation were used. Existing project helpers were copied unchanged and are recorded by hash. No separate public reuse licence is granted. Dimensions describe intended original designs, not measured historical replicas.
