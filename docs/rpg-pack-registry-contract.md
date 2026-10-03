# Independent pack registry and TPS geometry contracts

This supplement adds a pure module and measured sidecars. **No editor, picker,
plan store, renderer or TPS controller is connected.** PR72 base is
`6c5fe1819ba388bcfac8055cc94744bd7831d734`; c072 recovery remains blocked. The
reviewed model snapshot `769f44a24e35780bbe69650706e998eef72fee87` and its Library
ZIP remain unchanged, including every GLB, `.blend`, image and original manifest.

## Handoff checkpoint: paused pending latest source and release-safety review

Validation count is **registry 11 + geometry 5 = 16 distinct tests total**.
The portable run repeats the same five geometry tests; it is not five additional
tests and the registry suite alone does not contain 16 tests.

The standalone registry is implemented, but connection to the editor registry,
picker/UI, undo, pane state and TPS is **not implemented**. Support-surface
sidecars are measured proposals and are not consumed by placement code. Floating
tabletop props are therefore **not fixed in the application** by this work.

Further feature work on the old PR72 base is paused. Keep both reviewed Library
ZIPs and this isolated worktree intact while awaiting the latest source handoff
and publication-safety confirmation. No integration, remote push or deployment
is authorized by this checkpoint. Resume against the approved restored source;
do not replace that source with this older checkout.

## Pure registry API

`assets/js/asset-pack-registry.js` exports CommonJS or the inert browser global
`AssetPackRegistry`. Nothing loads it from the editor. There is no selected-pack
singleton, DOM, network, localStorage, plan mutation or model cache.

```js
const registry = AssetPackRegistry.createRegistry(resolvedLegacyDescriptors, [rpgManifest]);
registry.listPacks();                 // 日本建築標準, RPGアセット
registry.listCandidates(pane.packId); // immutable, cached array, selected pack
registry.hasCandidate(assetId, pane.packId);
registry.getAsset(placedItem.type);   // all packs, regardless of selection
registry.listAssets();                // combined lookup definitions
registry.resolvePackId(pane.packId);  // unknown / absent -> japanese-standard
```

Inputs must be acyclic plain JSON descriptors. Registry creation deep-copies and
freezes its own snapshots; it does not freeze or retain mutable caller records.
ID/name/dimensions/extra JSON fields remain unchanged. Pass the already-resolved
legacy map in its existing order, not three raw manifests with overlapping IDs.
No implicit prefix/category reassignment, legacy alias rewriting or plan migration
is performed. Add native placement tool descriptors at the adapter boundary where
the restored editor defines them; control tools such as selection/undo are not
catalogue candidates. Current real-manifest tests cover the 787 resolved model
IDs, while mock tests include native IDs. They do not claim that a c072 native
tool inventory has been inspected.

Each new pack has `id`, `name`, `namespace`, and `items`. Optional `assetIds`
references already-defined assets for shared membership without duplicating or
remapping the asset. References may point to later packs. Duplicate definitions,
duplicate pack IDs/namespaces, out-of-namespace additions, unknown references and
non-JSON input fail the whole new registry construction. The previous registry
and caller inputs are unaffected. Repeated membership references are deduplicated
only in candidate membership; placed objects are never processed or deduplicated.

Unknown/missing selected packs fall back to 日本建築標準, including when the RPG
manifest has not loaded. An explicitly registered empty pack stays empty. A
missing placed asset returns `null`; **it never resolves to a different asset**.
The host must keep the item's original ID/data and existing missing-model display.
Missing thumbnail paths remain missing for picker fallback handling, with no fetch
or substitution in this module. Registry construction is O(assets + memberships);
candidate lookup, pack fallback and asset lookup reuse cached data. Search reuses
`AssetCatalogue.matches` rather than adding another search implementation.

## Existing picker connection points (PR72 observations only)

Revalidate all points against recovered c072 before implementation.

1. `assets/js/app-constants.js`: `loadFurnitureMegaLibrary`, manifest merging and
   `FMP_ITEMS` own all model definitions. Load/register the RPG manifest once
   together with existing sources. Keep all packs resolvable for mixed plans.
   Existing metadata enrichment (`applyCatalogueTag`, `applyFinishChannels`)
   mutates descriptors; run it before taking a registry snapshot or on explicit
   mutable clones. Never pass frozen snapshots to mutating enrichment functions.
2. `renderFurnitureMegaLibrary()` already builds category groups, `asset-tile`
   cards, icons and `setTool` handlers. Its candidate enumeration should use the
   owning pane's pack predicate. Reuse this rendering path, not a new UI/gallery.
   **Do not call `applyFurnitureMegaManifest()` when switching candidates**:
   PR72 also normalizes legacy items, redraws and rebuilds 3D there.
3. `assets/js/asset-catalogue.js`: `entries()` currently scans every
   `.cat-body [data-tool]`, even hidden cards. Use the same pack membership predicate
   for search enumeration and counts, scoped to the owning picker/pane. Simply
   hiding the cards is insufficient. Keep existing query matcher and click route.
4. Keep pane candidate preferences outside `DATA.items` and undo content. The pure
   registry stores no preference, so two panes pass distinct IDs. No top-level
   shared preference should override another pane. Mixed-plan lookup uses
   `getAsset`, never `listCandidates`.
5. On switch, reconcile only the pending placement tool if it is no longer a
   candidate. Do not select, convert, delete or replace already-placed objects.
   Specific pending-tool behavior and picker control placement need c072 review.
6. Keep existing save/load/JSON/undo/comparison and renderer paths. No new fields
   are required in old plans. Thumbnail error UI, actual model fallback, async
   loading, picker focus/scroll behavior and 3D performance remain integration
   tests; pure tests do not certify those paths.

## TPS sidecars, metres and local geometry

`assets/models/packs/rpg-mansion-contract/v0.1.0/` contains:

- `asset-geometry.json`: all 14 canonical IDs, measured bounds/dimensions, +Y up,
  +Z front, bottom-centred origins and SHA256 model/source revisions.
- `sit-sockets.proposal.json`: **only the upright chair** has a measured candidate.
  The fallen chair is excluded; the other 12 assets are unassessed for sitting.
- `placement-surfaces.proposal.json`: two measured support planes plus four
  tabletop-prop placement rules. Candidates require host checks.
- `validation-final.json`: complete inherited validation records with corrected
  **final** `glb_bytes` after metadata insertion. It records previous counts and
  source paths. Original reviewed reports remain untouched. Geometry, UV and
  triangle results are not reinterpreted by this correction.

The read-only Blender probe identifies the broad upward fabric face in the low
chair cushion, records its polygon index and four vertices, and converts Blender
`(x,y,z)` to glTF `(x,z,-y)`. Contract tests independently locate those vertices
and surface area in the delivered GLB. No models are opened for saving/export.

Upright chair `rpg-mansion-chair-01` / socket `seat-main` / `seat-surface-v1`:

- Seat surface centre: `[0, 0.513499975, 0.017105259]` metres.
- Flat cushion patch: X `[-0.216250017, +0.216250017]`,
  Z `[-0.210526332, +0.244736850]`, Y `0.513499975`.
- Front `[0,0,1]`; surface normal `[0,1,0]`.
- TPS actor yaw 0 faces −Z, so the untransformed local seated yaw is π.
- Proposed approach floor point: `[0,0,0.875000006]`, 0.6m in front of the asset
  bounds. This point is a placement suggestion, **not a navigability result**.

The Y value is the cushion surface, not avatar feet/root/pelvis. Do not bake any
rig-specific correction (including −0.86m) into these sidecars. TPS applies its
rig's pelvis alignment. The host converts model-local points and directions with
instance scale, rotations/facing correction, translation and floor elevation;
derive world yaw from the transformed front, and reject unsuitable tilt/scale.

Only after host path/clearance validation may the host send
`{kind:'sit', signature, pose:{x,y,z,yaw,floor}, approach:{x,y,z}, reachable:true}`.
There is deliberately no `reachable`, floor or avatar-root field in the sidecar.
The runtime signature must include instance identity, model hash, socket revision,
transform and floor; a static metadata revision alone cannot detect a moved chair.
Require explicit `requestSit`, same-floor approach within 1.25m, release on changed
signature/deleted instance, and blocked exit if no safe standing point exists.
No navigation, animation, collision or safe-exit behavior is implemented here.

## Support heights and incident props

Desk `rpg-mansion-desk-01`: measured leather-inset plane Y **0.786m**. Pedestal
table `rpg-mansion-side-table-01`: measured wood plane Y **0.635m**; its brass ring
reaches the model's **0.637m** overall height. A proposed central support disc of
radius 0.235m stays inside the ring, but the host must validate prop footprint and
clearance. The desk uses its measured inset polygon. Prop support must use the
transformed supporting plane and each prop's bottom origin, never blindly 750mm.
The original four props' `defaultElevation:750` remains only a legacy hint in the
reviewed manifest; the supplement explicitly supersedes it for support placement.

Glass shards are opaque stylized mesh, not transparent glass. The blood/clue mark
is a closed 1mm mesh, not a projected shader decal. Its original 1mm floor elevation
hint is for avoiding coplanar flicker; actual floor/world transforms remain host work.

## Run, portable scope and safety

```sh
node --test tools/tests/asset-pack-registry.test.cjs tools/tests/rpg-pack-contract.test.cjs
blender -b -t 4 --factory-startup --python tools/assets/rpg-pack-contract/probe_geometry.py
```

The original asset ZIP is an **overlay**, not a complete checkout. Full generation
requires the PR72 common Blender helpers (`model_kit`, `shape_kit`, `exterior_build`,
`build_decor`); full browser QA requires the checkout's vendored Three.js and
`ModelQuality`. Original pack tests also require the legacy manifests. Their
hashes and these dependencies are documented, not downloaded or copied over c072.

This supplemental ZIP includes only new module/sidecar/test/doc files. With the
original asset ZIP extracted, the geometry-contract Node test needs only Node and
those model/source files; it independently parses GLBs and does not require
Blender, Pillow, Three.js or old manifests. Registry itself needs only JavaScript;
the full registry suite additionally uses the existing search matcher and three
legacy manifests. Blender is needed only to regenerate geometric measurements.

Neither ZIP is a full c072 recovery or an editor implementation. No remote push,
UI integration or deploy. If a subsequent task runs the repository build, it must
set `SKIP_DEPLOY=1` explicitly; this work does not run the build script.
