# Shared native-editor and comparison persistence slice

Historical baseline documentation: this describes the preceding 63-test freeze.
The subsequent explicit legacy-copy integration and its current limits are in
[legacy-plan-copy-integration.md](legacy-plan-copy-integration.md).

## Review status

This is an **unpublished integration patch**, not a release-ready migration.
It makes the protected repository the ordinary editor's save/load route. The
strict JSON installation gate can reject plans that the old normal-storage
loader accepted without validation. Cross-floor reused IDs and zero-length
walls need a deliberate compatibility policy before this becomes the default
production route. No IDs are remapped, walls deleted, finish maps pruned, or
legacy originals modified by this patch.

## Reused components

- `PlanRepositoryLab`: existing revision CAS, transaction completion, readback
  digest verification, drafts, views and exact raw-source archives
- `PlanLibrary`: existing inventory, dirty-change choices, history, duplication,
  retained IDs and two-pane comparison controller
- `EditorPane.install`: existing native JSON staging/render transaction,
  including rollback of DATA, history, dirty state, camera and native settings
- Ordinary native toolbar and save/load actions, plus the current-plan selector,
  history and duplicate components reused from the library

The ordinary editor is not replaced by an iframe or read-only preview. The
repository's historical lab name is retained to avoid creating another store or
losing existing protected plans; it is not a release-readiness claim.

## Route matrix

| Route | Editor / identity | Read / write behavior |
| --- | --- | --- |
| Ordinary root editor | One native runtime, stable current plan ID | Protected revision CAS/drafts; no legacy startup copy |
| Ordinary reload | Same plan ID, fresh draft/view session | Dirty draft or current verified head; stale clean drafts and cached clean activations cannot override newer heads |
| Explicit blank / preset URL | Fresh native plan ID/session | Does not reuse an old selected plan as its write target |
| Normal to comparison | Same plan ID, separate comparison session | Unsaved checkpoint/dirty draft retained before opening; source stays dirty |
| Comparison editor pane | Existing child runtime, host-owned plan ID | Same repository/controller; at most two live runtimes and four retained IDs |
| Comparison save to normal reload | Same revision head | Clean session loads newest head; dirty stale session retains edits for CAS recovery |
| Read-only preview | No writable plan identity | Save prohibited; no legacy-adapter fallback |
| User-selected legacy original | Explicit copy and verify | Raw bytes archived independently; legacy stores unchanged; unsupported data can fail installation |
| Shared-room ordinary editor | Native runtime, room-derived local ID | Shared lifecycle binds the room ID on initial/retry/refresh/create; independent switching blocked while joined |
| Missing library / pane dependency | No alternative writer | Fail closed with visible error, without legacy overwrite |

Switch/install/view failures preserve current identity and native state. Save
failure preserves dirty edits. Request-success alone does not complete a save.
Repository `canClean` and a stable editor snapshot are required to clear dirty.

## Legacy reference hazards requiring follow-on review

The runtime currently mixes scoped and unscoped object identity:

- `baseRoomOf` and landing lookup resolve an ID **and floor**
- Wall-face editing, wall selection and some exterior updates find the first
  wall by ID alone
- Roof-merge deletion collects item IDs and filters across the whole plan
- Shared baselines, upserts/removes and restored selection use collection plus
  ID, without floor
- Schema duplicate-ID checks are per collection across the whole plan

Allowing every cross-floor duplicate through the gate would not prove edits are
safe. A follow-on must audit and make relevant local operations floor-aware while
preserving original IDs/references, or provide a reviewed compatibility/read-only
route. Shared-room identity needs a separate protocol-compatibility decision.
Do not silently renumber objects or save a failed load as a blank/default plan.

## Verification

`node --test tools/tests/plan-library-native.test.cjs tools/tests/json-import.test.cjs tools/tests/shared-plan-lifecycle.test.cjs`

New public tests use synthetic fixtures and a process-memory IndexedDB contract
simulator with staged writes, serialized transactions, aborts and rollback.
Coverage includes native/child routing, IDs/sessions, reload, CAS/quota, malformed
raw archives, cancellation, install/view-write failure, dirty generations,
derived plans and two-pane layout. Existing native JSON regressions also run.

This does not verify browser durability, WebGL appearance, mobile toolbar layout,
full native legacy furniture/appearance migrations or deployment compatibility.
Recovered runtime lacks full model/build assets. Full build and browser QA remain
unverified. Private sample copies are tested separately and never checked into
repository fixtures, logs, publication artifacts or this document.

## Independent-review repairs

- Shared auto-save returns an explicit committed/can-clean outcome. A socket
  checkpoint or own-client acknowledgement clears dirty only when that result
  still matches the room, current plan ID, shared version and serialized payload,
  and the payload matches a server-confirmed outgoing save/patch snapshot
- Initial join, retry, refresh and room creation use one identity handoff. The
  previous ordinary plan/draft stays independently recoverable. A joined-room
  identity mismatch fails before any ordinary-head write. Leaving the room keeps
  the current room-derived local identity rather than returning to an unrelated
  ordinary write target
- Activating a cached clean plan re-reads its verified head. A newer head replaces
  only clean cached state; stale dirty cache/drafts remain recoverable and retain
  their CAS basis

Real function fault regressions cover quota, canClean, non-saved outcomes, changes
made both during local save and before socket acknowledgement delivery, room join
retry/create/refresh/leave, same-lifecycle clean reactivation, collapsed comparison
reopen and dirty-cache preservation. Fetch/WebSocket responses are synthetic; no
external API call or production change is exercised by these tests.

## Shared lifecycle boundary repairs

Room installs reuse `EditorPane.captureInstallState/restoreInstallState`, the
same rollback used by native JSON installation. They preserve DATA, undo/redo,
dirty state, selected-object references, drag/options, camera/walk, native
settings and catalogue selection, together with the prior plan record, local
identity, room state and URL. Input is temporarily inert during installation and
its awaited draft/view writes. Socket connection is deferred until this boundary
commits; it is refreshed after a native room install while the existing view is
retained on refresh. A failed target draft/view write restores the original live
state and view; any already committed recovery draft remains independently
recoverable. Existing heads are not advanced by joining.

Socket events, their local-save completions, HTTP replies, delayed sync/local
save/reconnect work and room fetches check their originating room lifecycle.
Superseded events cannot mutate the replacement room, including after leaving or
reconnecting to the same room. A failed bootstrap cannot resume an ordinary plan
while still joined under another identity.

Patch, manual-save and room-creation baselines use the acknowledged outgoing
snapshot rather than newer unsent DATA. Edits made while the request is pending
remain dirty and produce a subsequent patch. A prior-room flush cannot initiate
a later room's save.

The package contains 63 passing focused tests (including the 11 existing JSON
regressions). Shared network and renderer faults are synthetic. Browser support
and visual/input behavior of the native transaction remain browser-QA work.
This patch does not change the legacy schema/ID/appearance migration policy:
exact archived originals are protected, but inherited `syncExteriorWallSettings`
and appearance migrations can change editable copies. Exact raw preservation
must not be described as exact editable appearance preservation.
