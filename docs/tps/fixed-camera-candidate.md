# Fixed-distance TPS camera candidate

Base: PR #76 commit `20e3cbabe925901225be9cb7305d2a1a648c571c`. This is an isolated, unpublished implementation candidate. Independent review and real GPU/mobile visual acceptance are still required.

## Behavior

- Selected TPS keeps a 2.6 m optical-centre-to-body-target distance. Stairs, room ceiling types, hidden furniture and pending model/rebuild flags do not select FPS automatically
- Native WALK movement, wall/door aperture collision, floor/stair elevation and action/exit clearance remain in use
- Native automatic floor transitions retain held movement in free FPS/TPS. Explicit view/plan/manual-floor changes still clear input; locked actions retain their safety behavior
- Actual invalid camera projection or player pose holds only the last finite TPS camera composition and clears movement, retaining current action/exit safety diagnostics, with a short recovery status. First-entry invalid data does not install invented coordinates
- Only built geometry intersecting sampled camera-to-body sight lines gets a temporary, editor-owned faded material clone. Nonoccluding meshes remain unchanged. Fade materials preserve texture references and baseline opacity/alpha cutout; shared sources are never modified
- A low-opacity, presentation-only foot-contact shadow follows native standing ground. The procedural avatar, body constants, gait and lack of real motion assets are unchanged

## Ownership and instance shader contract

Regular mesh fading follows the existing cutaway material clone pattern. Material arrays are restored by identity, with newer external material edits preserved. Rebuild invalidation, FPS/exit/reset, scene replacement and pane disposal restore originals and dispose only owned materials/geometry.

Individual instanced-mesh fading uses a private cloned geometry with one `InstancedBufferAttribute` named `walkTpsFade`. Original instance matrices, colours and native culling/base matrices are not changed. Nonoccluding instances have fade value 0; occluding instances have value 1. The selected material clones add one float varying and apply `1 - 0.82 * fade` to diffuse alpha after the unchanged native Three alpha-test/coverage branch. Original shader hooks and cache keys are composed. Authored source defines (including live null-prototype dictionaries) are copied into a private dictionary because Three r169 clone/copy resets built-in constructor defines. ShaderMaterial/RawShaderMaterial, unsupported built-in instance materials and source shader hooks missing required injection anchors are reported as unsupported rather than silently changed. Incompatible shader hooks restore original materials/geometry and never receive a partial fade injection. Private geometry is reused across ordinary frames and recreated after source geometry/material contract changes. Cache contracts include every source attribute identity/storage/version, UV/normal/index/morph data and live material baseline values (including roughness/metalness, vectors, textures and clipping planes). Regular alpha-to-coverage materials with alpha testing get a narrowly scoped native-coverage opacity correction; ordinary regular materials use only the material-clone pattern.

Node tests exercise actual Three r169 shader-library strings, hook composition, native alpha-test/ALPHA_TO_COVERAGE preservation, material arrays, original-resource isolation, per-instance values and disposal. They do not compile or render GLSL on a GPU. GPU shader acceptance is a hard release gate.

## Verification

`node --test tools/tests/walk-tps-*.test.cjs tools/tests/walk-aperture-clearance.test.cjs`: 118 tests passed. This includes all six original adversarial review repros as permanent regression coverage, plus real asset hash/geometry checks using the existing bathtub and sofa files, action/exit safety, the fixed-camera household-feature matrix, per-view material/instance ownership, and repeated reset/re-entry checks. The aggregate repository suite and build were not run for this isolated candidate.

The existing FPS camera functions were also compared with the exact main blob in 108 analytic pose cases, and the automatic stair floor-transition input regression was reproduced and corrected using the actual production movement/ground functions. These are CPU/source checks, not visual acceptance.

## Outstanding acceptance

- Independent review of exact candidate bytes
- Real renderer shader compilation, transparent/textured wall and ceiling appearance, shadow/lighting behavior and instance sorting/depth behavior
- Desktop, portrait/mobile and compact landscape walkthroughs, doorway/ceiling/stair/atrium transitions, repeated view switching, rebuilding and multiple editor panes
- Real GPU resource/memory recovery and frame-time budget
- Finished licensed rigged character and natural walk/sit/bath animation, coherent user-adjustable person profile and foot planting. This candidate does not claim those are finished
- Right-bottom HUD relocation is owned by a separate change and is not included here

No main update, merge or deployment has been performed.
