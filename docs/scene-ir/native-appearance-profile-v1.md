# Native appearance profile v1 — isolated display only

The existing session-local `read_catalog`, `get_scene` and `preview_patch` API now accepts one optional `appearanceProfile`. It is restricted to `custom-sofa-tailored` with `match-diagram-appearance`. There is no Apply operation, external transport, credentials, arbitrary files/code, or network capability.

```json
{
  "id": "tailored-sofa-regional-colors",
  "version": 1,
  "assetSha256": "d05b95294ee7f2d763b2ede6f2391548a96f3021ad897ab81ec712d79c9d5667",
  "colors": {"body": "#E5E4DB", "seat": "#EEEEE5"}
}
```

This is a hand-authored display assumption from frozen raw 2F, not a new AI candidate run. Both colors must be own primitive hex strings in an exact plain data record and exactly equal the retained raw body/seat values. There must be exactly one raw body and one raw seat. Other regions, missing/duplicate regions, getters, arrays, boxed/coercible strings, extra keys, other IDs/versions/hashes, channels and explicit rotation are rejected by the same validator for the API and direct v3 bindings.

The declared hash is insufficient. The existing native loader verifies the actual full GLB bytes, parsed geometry/accessor data, local transforms, hierarchy, material values, and native root. Its private runtime certificate publishes the catalogue capability. `appearanceProfiles` is separate from generic `finishChannels`; it exposes availability, exact hash/version, colors-only support, native renderer, audit revision, fixed legs/seams, and unverified source-region/material/product semantics. A cold native cache advertises unavailable; the read API does not load assets. The loopback replay warms this exact asset with the existing `ensureGltfModel` loader before reading the catalogue.

The materializer emits only `tailoredSofaColors: {version:1, colors:{body,seat}}`. No generic finish colors, textures, roughness, arbitrary nodes or rotation are copied. Source facts stay exact. The source footprint is 1780×890 mm; the model manifest is 2000×940×1020 mm. The explicitly reviewed width/depth fit leaves native height 1020 mm, position and the existing floor support rule intact. Source height remains unknown. Body affects native backs/arms/base, seat affects the two native seat cushions; Oak legs and Upholstery seam stay native. These part correspondences are display assumptions; diagram-region semantics and physical material are unverified. Lighting and authored maps mean uniform pixel RGB is not guaranteed.

Front certification is independent of colors. Only the exact asset/version is certified +Z: verified Back frame lies toward -Z, seats toward +Z, existing sourceYaw is zero, modelFacingVersion is 1, and native zero-degree +Z/-Z captures show front/back distinctly. The existing normalizer does not add a half turn for this custom ID. Unknown front metadata remains a blocking mapping error; source front/head facts are never inferred or overwritten.

Profile and canonical provenance live in source-snapshot-bound saved decisions and returned diffs. Profile/catalogue context enters review keys. The existing review fieldset adds an explicit dedicated-profile selection and resets approvals on save. All profile compilations and API responses keep Apply/full-reconstruction readiness false, including accepted review groups. The AI extraction schema/prompt/freeze remain byte-identical; the optional display binding schema is exported separately as `SceneIRV3.displaySchema`.

Catalogue capability changes enter its hash and scene revision. The API fences before/after asynchronous install and immediately before completion. The loopback renderer must produce a private native render proof from actual selectable roots; current geometry, colors, non-color surfaces and parent attachment are rechecked when accepting it. Missing/forged/stale proof or fallback cannot be reported as profile success. The source plan DATA/history/redo/dirty/raw/options/camera/storage are untouched by preview; preview plans are memory-only and use the same camera.

## Replay and evidence

Use a new Chrome profile and a dedicated loopback origin; never attach user tabs 63239/65236 or production storage. Start `WEBCAD_PREVIEW_PORT=65360 python3 local-preview/server.py`, then run the `tools/tests/native-appearance-profile.browser.cjs` with `APP_URL` and `OUTPUT_DIR` pointing to that dedicated origin and evidence directory. Playwright and Chrome are external browser-test dependencies. The deterministic fixture has two distinct patches: first omits the dependent room appearance binding and returns diagnostics; second adds it and renders one sofa plus the dependent floor while retaining all full-source diagnostics and deferred entities. It performs no AI/provider calls and does not alter the historical Astra 2/2 ledgers.

The review packet distinguishes full-repository Node checks from its portable focused subset and actual Chrome checks. Its images show a display proposal, not strict source-product shape/material equivalence or complete reconstruction. No push, main update, merge or deployment is included.
