# RPG mansion pack 0.1.0

Independent native asset deliverable, **not registered in the editor**. Built on
PR72 `6c5fe1819ba388bcfac8055cc94744bd7831d734`; c072 recovery is still pending
because consumer-local Library download failed. No claim of compatibility with
the unseen c072 pane implementation is made. No deployment or remote push.

14 original models share walnut, oxblood velvet, teal leather and antique brass:
chair, writing desk, filled bookcase, candlestick, original geometric moon picture,
locked chest, rug, pedestal table, mantel clock, sealed letter, key, fallen chair,
stylized glass shards and a non-photorealistic burgundy clue stain. The fallen
chair reuses the new upright chair generator. No downloaded geometry, imagery,
paid generation services, external asset packs, bodies or injury details.

## Deliverables

- `assets/models/packs/rpg-mansion/manifest.json`: versioned independent pack.
- `models/`: 14 GLBs. All use metres, +Y up, +Z front, bottom-centred origins.
- `previews/`: 512px transparent top and front three-quarter PNGs.
- `tools/blender/rpg_mansion/work/`: 14 editable `.blend` originals, rear PNGs,
  and model-kit validation results. Sources retain materials, mesh islands and UVs;
  they are joined meshes as required by the shared pipeline, not modifier stacks.
- `evidence/`: browser front/back screenshots and measured runtime results.
- `build.py`, `previews.py`, `render_config.py`: repeatable local generation.
- `test_pack.py`, `browser_qa.cjs`: delivered-file and runtime validation.

Manifest dimensions and `defaultElevation` are millimetres. The picture's origin
is its lower edge; mount against a wall with its face pointing into the room.
Tabletop objects default to 750mm, but the future placement adapter must respect
the actual supporting surface. Incident sheets default to 1mm above the floor.
The clue stain is closed 1mm geometry, **not a shader decal projector**; use the
placement elevation to avoid coplanar flicker. Glass is deliberately opaque and
stylized. The candle is unlit and introduces no runtime light source.

## Reproduce on the existing repository base

Requires Blender (validated with distro 4.3.2). The existing `model_kit.run()` is
reused unchanged for manifold, dimension, origin, budget, finish-channel and UV
checks. Shared shape helpers, exporters and icon framing are also reused.

```sh
blender -b -t 4 --factory-startup --python tools/blender/rpg_mansion/build.py -- --no-icons
blender -b -t 4 --factory-startup --python tools/blender/rpg_mansion/previews.py
python3 tools/blender/rpg_mansion/test_pack.py
python3 -m http.server 8946
# In another terminal, using installed Playwright and Chromium:
node tools/blender/rpg_mansion/browser_qa.cjs
```

Open `http://127.0.0.1:8946/assets/models/packs/rpg-mansion/review.html`.
This is an isolated QA gallery using the repository's vendored Three.js loader
and `ModelQuality` utility. It neither reads nor writes plans. Gallery objects
are scaled individually for legibility; dimensions are measured **before** that
display scaling. `CHROMIUM_PATH` and `APP_URL` can override the browser and server.

Running `build.py` without `--no-icons` produces all outputs in one pass.
`--only chair,desk` rebuilds selected assets without rewriting the full manifest.
Do not use `--no-export` for release generation. The environment lacks
OpenImageDenoise; the pack adapter disables it, renders 64 Cycles samples, and
adds 40% thumbnail framing margin to avoid clipping. Shared source files are
unchanged. UV failures in thin bevels were fixed by limiting bevel size to 1/4
of the thinnest part and simplifying the candle wick.

## Validation and remaining integration

Tests inspect the actual GLB accessors for UV collapse and finite coordinates,
namespaced ID collisions against all three legacy manifests, editable sources,
material channels, geometry budgets and uncut/nonempty previews. Browser tests
load all 14 GLBs and verify world-space dimensions and bottom-centred origins.
The independent gallery supports front/back visual inspection. All GLBs combined
are below 1MB, 13,480 triangles; largest model is the 3,576-triangle bookcase.
Software WebGL timings in evidence are a local observation, not a mobile promise.

Pending after c072 recovery: candidate pack toggle, picker search filtering,
pane-local preference, mixed-plan save/load/undo/comparison tests, thumbnail and
registry fallback paths, placement elevation integration and real editor 3D QA.
No legacy IDs, manifests, renderer source, stored plans or editor UI were edited.
Do not merge an entire older checkout into c072. Transfer only these two new
directories and revalidate dependencies. Reuse the combined existing model
registry, filtering candidate cards/search only; never unload a pack registry
when changing visible candidates. Existing objects must continue resolving IDs.

Do not run any deployment. If a later task needs a build, set `SKIP_DEPLOY=1`
explicitly: the base build script has a CI deployment path.
