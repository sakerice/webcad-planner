# Mansion modular architecture completion

18 newly reconstructed original Blender models: 16 construction families and 2 explicitly non-counted roof-host variants. These are new files generated from documented construction measurements, with new hash identities and fresh validation. Earlier delivered architecture models are unchanged.

## Files and coordinates

Each model has an editable native-parts source, a canonical export source, a GLB, a measured descriptor, and transparent thumbnail, top, front and rear views. Native Blender uses metres, Z up and -Y front. GLB uses metres, +Y up and +Z front. Every delivered model is translated to its actual measured bottom centre; geometry is never scaled to round its catalogue label. Descriptors retain precise measured bounds and the translation between construction and asset coordinates.

For construction placement at P and native Z rotation R, use M = Translation(P) × Rotation(R) × Translation(-constructionToAssetTranslationM). Apply M to the imported GLB object transform. Allowed assembly transforms are rigid translations and 90-degree rotations; do not mirror or rescale joining modules.

## Model schedule

| Model | W × D × H mm | Asset bottom mm | Independent count |
|---|---:|---:|---:|
| 1200mm coursed ashlar wall bay | 1200 × 330 × 3000 | 0 | 1 |
| 1200mm rusticated foundation plinth | 1200 × 420 × 600 | -600 | 1 |
| 1200mm half-timber infill wall bay | 1200 × 310 × 3000 | 0 | 1 |
| 1200mm tall fixed French window bay | 1200 × 370 × 3000 | 0 | 1 |
| 1200mm octagon and cabochon stone floor tile | 1200 × 1200 × 75 | -75 | 1 |
| 3000mm weathered-cap stone wall pilaster | 500 × 300 × 3000 | 0 | 1 |
| 1100mm profiled stone newel post | 300 × 300 × 1100 | 0 | 1 |
| 900mm turned stone balustrade bay | 900 × 240 × 1000 | 0 | 1 |
| 900mm forged oval wrought-iron railing | 900 × 70 × 1000 | 0 | 1 |
| 4200mm stone portico pediment | 4200 × 480 × 1440 | 3000 | 1 |
| Three-sided hollow slate gable hipped end | 4200 × 2100 × 1548 | 2900 | 1 |
| 4200mm standing-seam hollow conical turret roof | 4200 × 4200 × 2280 | 2900 | 1 |
| 4200mm drained flat parapet roof cap | 4200 × 4200 × 665 | 3000 | 1 |
| 2400mm-bearing standing-seam lean-to span | 3000 × 1200 × 1338 | 2900 | 1 |
| 4200mm flat parapet chimney host variant | 4200 × 4200 × 665 | 3000 | 0 |
| 720mm hollow brick chimney with vented rain hood | 720 × 720 × 1780 | 3237.92 | 1 |
| 1080mm fixed-glazing shed dormer | 1080 × 1250 × 939 | 3305 | 1 |
| 1200mm slate gable dormer host variant | 4200 × 1200 × 1548 | 2900 | 0 |

## Installation and compatibility

- Walls use 1200 mm bays, 3000 mm height, a 240 mm core and a consistent exterior face. Rusticated foundation segments start at -600 mm and end at the wall ground datum. Their 420 mm cap/footing supports the pilaster toes.
- The French window is fixed glazing in a true floor-height substrate opening. It does not open or swing. The sloping threshold stays within the 1040 mm substrate aperture, the surround reaches the rear plaster plane, and all eight glass panes are 8 mm thick.
- Pilasters mount with native Y=0 at world Y=-120 mm. Their level 500 × 120 mm rear capital tongue supports the straight cornice at 3000 mm. The exposed front capital has a shallow 5 mm weathering slope.
- Floor modules start at -75 mm for a finished floor datum of 0. In the facade example, tile centres have Y=720 and 1920 mm so the front floor edge meets the foundation rear at Y=120 mm without volume overlap.
- Both 900 mm railing bays fit between 300 mm newels on 1200 mm centres. Stone rails and iron rails contact the low and high newel zones; a 90-degree newel turn is demonstrated.
- The pediment sits on columns centred 3600 mm apart, at a 3000 mm bearing datum. Its 4/7 pitch is not a weather-sealed join to the 0.7-pitch gable roof.
- Gable hip ends use the delivered gable span section, a 0.7 pitch and 55 mm hollow deck. Roof asset bottom 2900 mm puts the 100 mm bearing seats on the 3000 mm wall top.
- The conical turret is a hollow 32-facet roof with an annular bearing. Column capitals contact annular sectors, not their complete square top faces. Its asset bottom is 2900 mm.
- The flat parapet is a complete 4200 mm square cap, not a repeat tile. It starts at 3000 mm. The surface rises 12 mm per metre along native +Y and drains toward the front scupper. The chimney host adds an actual 400 mm square opening; the closed cap remains available.
- Install the chimney on the paired host at construction XY=(900,900) mm, asset bottom=3237.92 mm, rotation=0. Its sloped shoe bears on the membrane and leaves a 400 mm open flue. Rotate host and chimney together to preserve their matching fall.
- The lean-to spans 2400 mm wall centres and repeats every 1200 mm in native Y. Both bearing bottoms sit at 3000 mm when asset bottom is 2900 mm. Its repaired 41 mm deck intercept leaves approximately 1 mm clearance over the low exterior head trim; the higher support is a real timber riser.
- The shed dormer pairs with the gable dormer host. Place its construction origin at (1000,0,2900) mm, rotate +90 degrees around native Z, and place the host at (0,0,2900) mm. The dormer asset bottom is then 3305 mm. In the assembled long room both host and dormer are shifted -600 mm along Y. The host has a real 1000 × 800 mm deck opening and wider 1150 × 900 mm slate cutback.

## Seven assembly proofs

The seven saved assemblies contain 118 actual model instances: facade-floor 17, railing-corner 9, gable-dormer-room 36, flat-chimney-room 23, turret-canopy 14, lean-to-veranda 12 and supported-portico 7. The only dependencies are eight explicitly listed, hash-matched models from the earlier architecture delivery. These do not add to the new-model count. Every cutaway hides whole module instances only.

The two optical proof sources contain white/black test markers behind the actual imported GLB glass. They are verification fixtures, excluded from product and installed assembly counts. Clear controls hide only the glass material partition. Their receipts record the source/model hashes, camera and pixel regions.

## Scope

These are manually installed static meshes. They do not provide native wall cuts, automatic/parametric roofs, stair behavior, collision, opening mechanisms or structural engineering certification. No application, existing scene placement, shared asset manifest or deployment was changed by this production.

## Reproduction

Run build.py inside Blender to author/export models. render.py reopens canonical sources for the four product views. assemblies.py uses actual GLBs and records rigid placement matrices; --build-only saves sources and --render-only reopens them. proof_checks.py measures actual GLB contacts and cavities without builders. replay_sources.py reopens saved sources, regenerates GLBs and images, and compares geometry/UV/PBR/corner normals. review_checks.py checks privacy, dimensions, image margins, and exact decoded image replay. Independent acceptance is separate from producer checks.

Produced and checked with Blender 4.3.2. Standalone numeric/image checks use Python, NumPy, Pillow and zstandard. The five shared source helper files are byte-identical to the earlier delivered helper copies.
