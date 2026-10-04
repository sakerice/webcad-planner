# Legacy copy review repairs

## Scope and prior freeze

This is a separate unpublished workcopy repairing the first legacy integration
package, SHA-256 `9df8a91030b6635c1d7a440b64ffd59dfa5f1422253062fdb85d7b77bb08d5c8`.
The first package and earlier persistence freeze are unchanged. The first
independent review blocked acceptance despite its 126 passing focused tests.
The current producer tests are not independent acceptance or browser readiness.
No remote/main, live user plan, user computer, paid API or deployment changed.

## Seven grouped repairs

1. Immutable save/derive boundaries
   - Descriptor-safe deep snapshots of caller payload and metadata are frozen
     before the first await; validation and serialization use the same snapshot
   - Hidden toJSON, accessors, non-JSON values and sparse arrays are rejected
     without executing serialization hooks; the existing ephemeral `_texObj`
     exclusion is retained
   - A caller cannot change target IDs, metadata or add an invalid zero after
     validation but before serialization. Missing schema support fails closed

2. Original structured-codec binding
   - Original rawStructured is re-encoded using the unchanged codec and compared
     with retained raw bytes, digest and snapshot identity on every proof
   - Replacing rawStructured and rehashing a projected import cannot substitute
     a plan absent from the original archive. Valid structured workspace metadata,
     including Blob bytes, remains supported

3. Actual dirty-source derivation
   - The optional source is a WeakMap-issued ticket from an actual persisted
     source draft with matching plan, base revision and generation
   - Its exact immutable plan is archived in existing rawSources. Digest, draft
     identity/generation and base revision are recorded in origin/migrations and
     reverified by derived reads. The store count remains unchanged
   - A dirty draft can legitimately differ from its saved parent revision; that
     actual source snapshot is durably identified. Arbitrary caller parentPayload,
     stale drafts and serialized tickets cannot grant inherited-zero admission
   - Without a ticket, only the named saved parent revision supplies retained
     records. New invalid source records remain strict-rejected

4. Dismissal freshness
   - Closing/cancelling a modal or showing a newer one invalidates pending legacy
     preparation. Late work cannot reopen a dismissed conversion review

5. Commit freshness
   - File/pane freshness is checked after metadata/proof work and at CAS's write
     boundary. A stale review cannot create a converted head/registration
   - Saved original archives remain independently recoverable when later work
     is cancelled

6. Exterior read purity
   - Wall reads resolve the established effective fallback on a detached view;
     dormant/null/false persisted map fields do not get rewritten by rendering
   - Both existing explicit wall setters retain a real persisted write owner
     without copying unrelated fallback fields during a one-property edit

7. Light read purity
   - 3D, 2D and property-panel reads obtain effective defaults on a detached item
   - Both stored legacy color fields remain intact. Effective rendering continues
     to use lightColor; newly initialized lights and explicit color/kind edits
     retain the established persistent behavior

A separate defensive native-marker typeof check supports the published isolated
legacy StorageAdapter fixture. Explicit native=true still requires the protected
controller and cannot fall back to legacy reads. The published Scene IR lifecycle
test and the new marker-context regressions were verified together outside the
producer package. No published test was removed or weakened.

## Evidence and still-open gates

- All earlier 126 tests remain unchanged
- New producer tests cover each reproduced hook/race, original codec corruption,
  arbitrary source claims, bound dirty snapshots, cancellation through proof/CAS,
  effective wall/light reads, both explicit setters and new-light defaults
- Real vendored Three.js object construction verifies fixture meshes plus
  point/spot/line light color/intensity/range/angle behavior. There is no WebGL
  renderer, GPU, real asset-model or image-equivalence acceptance in this test
- The producer's adapted rerun of the eight reviewer UI contracts passes; a new
  independent review of the final exact package is still required
- Authorized private passive copies were rechecked separately with original
  bytes unchanged and no prior-value changes/removals from real staging

Browser IndexedDB durability/quota, actual UI/mobile behavior, uploads,
WebGL/collision/model rendering, full Scene IR/source-composition UI, backend
protocol acceptance and canonical PR ancestry remain gates. Shared zero-wall
creation/sync/manual save is blocked; no server validator is weakened. Full
model/build inputs are absent. Immutable snapshots and archived dirty-source
snapshots increase transient/storage costs for large plans; browser performance
and quota tests are still needed.
