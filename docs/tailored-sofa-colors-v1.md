# Tailored sofa: explicit native color opt-in v1

This change wires native colors for `custom-sofa-tailored` only. It reuses the existing property card, history/save mechanism, native GLTF renderer, and `ModelQuality.applyFinishes`. It adds no source/display-binding API capabilities or catalogue finish channels.

## Audited asset and exact routing

- Asset: `assets/models/refined/sofa_tailored_v1.glb`
- Full GLB SHA-256: `d05b95294ee7f2d763b2ede6f2391548a96f3021ad897ab81ec712d79c9d5667`
- Seat: nodes 8 and 11, each its sole primitive/material 0.
- Body/back/arms: nodes 0, 1, 4, 7, 9 and 12, each its sole primitive/material 0.
- Material 0: `Woven upholstery`; material 1 (legs) and material 2 (seams) stay native.

The loader inspects the same full bytes passed to GLTFLoader. The private certificate records the 14 known nodes, primitive/material routing, geometry bytes, local transforms and authored material values. Shared-pane clones transfer the certificate through a WeakMap. Neither shared cache objects nor base materials receive finish-channel tags. Root box fitting and existing height placement remain unchanged.

An asset-byte, runtime-node, geometry or authored-material mismatch rejects the new wiring. The existing native renderer still loads/renders the model; its property card reports `未監査のモデル構成です。部位の色指定は適用せず、従来の表示を保ちます。` No geometry substitution or inferred orientation is added.

## Saved compatibility contract

The user explicitly clicks `部位の色を指定する` on the selected sofa's existing property card. The item then contains:

```json
{"tailoredSofaColors":{"version":1,"colors":{}}}
```

Changing the two color inputs writes only explicitly chosen color values:

```json
{"tailoredSofaColors":{"version":1,"colors":{"seat":"#ff3300","body":"#0055ff"}}}
```

Only exact version 1, the keys `seat`/`body` and primitive string six-digit hex colors are accepted. Coercible arrays, boxed strings, custom prototypes, inherited fields and accessors are rejected without string coercion or getter invocation; real plain records from other editor panes and null-prototype records remain supported. Empty colors, no opt-in and unknown versions cause no material clones or new color application. Old `finishColors.body/seat`, `finishTextures` and `finishRoughness` remain dormant, unmodified saved values. Reset sets the new colors to `{}` and returns the original native material/pixels, retaining those legacy fields. Other catalogue items and their existing finishing behavior are unaffected.

The target's local UI has colors only. It does not expose texture or roughness controls, and existing texture/roughness setters still reject these channels. It does not mutate manifest dimensions, height fitting, geometry, node transforms, maps, roughness, sheen, default colors, GLB bytes, catalogue parameter capabilities or source facts.

Only runtime instance materials for chosen regions are cloned/tagged, then passed to `ModelQuality.applyFinishes` with colors alone. Temporary tagged clones are disposed immediately; final clones use the existing scene disposal path. Unspecified regions continue to reference their native materials. Active opted colors bypass the existing instancing fast path so deselection cannot silently discard the specified colors.

## Evidence and reproduction

Portable Node checks (22 tests; source/dependencies are included in the review packet):

```sh
node --test tools/tests/tailored-sofa-finish.test.cjs tools/tests/model-details.test.cjs
```

The packet's `verify-portable.py` constructs a fresh source subset using only the archive contents, checks its hashes and runs these 22 tests. No npm install, complete catalogue, other GLBs, private plans, network or repository clone is required.

Complete-repository checks (34 focused tests, and the full regression suite) are separate:

```sh
node --test tools/tests/tailored-sofa-finish.test.cjs tools/tests/model-details.test.cjs tools/tests/model-quality.test.cjs
node tools/check-html-js.cjs
```

`model-quality.test.cjs` includes catalogue-wide model/thumbnail/top existence checks and `precision_car_v1.glb` attribution validation. Those tests require the complete original catalogue assets; they are not portable archive claims. The review packet does not copy that large unrelated catalogue.

The review packet includes the native pre-change JSON/PNG baseline, anonymous fixtures, the Chrome harness, full regression logs, immutable hashes and renderer captures. Run its `feature.browser.cjs` against a disposable offline server/profile. It accepts `WEBCAD_REPO`, `WEBCAD_ORIGIN`, `WEBCAD_EVIDENCE_DIR` and `PLAYWRIGHT_MODULE`; its fresh Chrome profile and storage namespace are generated per run. The evidence directory must contain the packet's `before-native.json` and `before-native.png`. The script runs no AI, source candidate, Apply, paid API or production operation.

```sh
WEBCAD_PREVIEW_PORT=65358 python3 local-preview/server.py
# In another terminal, with the extracted packet paths:
WEBCAD_REPO=/path/to/recovered/repo WEBCAD_ORIGIN=http://127.0.0.1:65358 WEBCAD_EVIDENCE_DIR=/path/to/packet/evidence PLAYWRIGHT_MODULE=/path/to/playwright node /path/to/packet/browser/feature.browser.cjs
```

Use a new unused loopback port if 65358 is occupied. Never attach to the user's 63239/65236 or historical Astra 65352 profiles/tabs/storage. The packet's baseline is captured at the unchanged parent HEAD `c072bad031d2b88bcdc5426e11ce6636dcdbdbd6`; `baseline.browser.cjs` is an optional script to record that HEAD in an independent checkout, not an instruction to reset an existing working tree.

Native Chrome evidence covers exact old/empty/reset pixel and material equality; seat-only/body-only regions; untouched legs/seams/geometry/maps/roughness/sheen/box/height; 2 real panes with 2 instances each; 8 rebuild/reset cycles with 128 cloned materials disposed once; host DATA/history/dirty and existing storage equality; save/fresh read in a private namespace; and a semantically identical response with changed GLB JSON padding whose hash mismatch disables new colors while preserving exact native pixels and showing the review message.

The +/-Z pictures are separate native visual references. Registry front certification remains unknown. Source region semantics, diagram color/product matching, front certification and the next source/API review remain outstanding. Historical paid/source-candidate runs remain 2/2 in each ledger, with no new runs. This is an unpushed local implementation for review; no production update is performed.
