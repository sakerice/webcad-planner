# Explicit joint registration review

`POST /api/ai/register-plan` is an additional user-requested paid action after per-page extraction. It sends two or three unchanged source-local readings and their matching cropped source-page images together in **one** provider job. It does not run during import, finish, revision, polling failure or Apply.

The request is exactly:

```js
{
  images: [/* data URLs, same order as sourceLocal.floors */],
  sourceLocal: {
    floors: [/* decoded local floors with sourcePageId and sourceIdentity */],
    items: [/* decoded source-local items with floor */],
    marks: [/* decoded source-local marks with floor */]
  },
  sourceSnapshot: JSON.stringify(sourceLocal)
}
```

A request must have unique known floor/page identities, explicit retained header labels that agree with the extracted floors, matching crop hashes, bounded source geometry, and an exact unchanged snapshot. A source with unknown/ambiguous floor identity stays in manual review. Request-time provider, schema, prompt, source-review or proposal overrides are rejected. The provider model and region use the existing import provider resolver.

- Cost is charged once at start: 10 internal quota points per supplied page
- The new action requires a working quota service; unlike the legacy path it fails closed if quota eligibility is unavailable
- OpenAI background jobs return HTTP 202 with one opaque signed `jobs` token. Immediate completion returns HTTP 200 with the proposal
- `POST /api/ai/register-plan-result` accepts only `jobs`, `sourceLocal`, `sourceSnapshot`; no image retransmission or additional quota charge is required
- Pending polls return HTTP 202 with the same `jobs` token. Each poll performs one GET, never another paid generation
- The signed token is specific to this route and bound to the exact snapshot hash, originating connection's IP hash, provider model and a 30-minute expiry. This is **not account authentication**; `/api/ai` retains the application's existing IP-quota access model
- An abort signal propagates into provider transport. A cancelled/incomplete/failed response is never accepted as a completed proposal. Closing the client discards stale results; it cannot guarantee reimbursement or stop a provider job already accepted
- Invalid output is retained in `rawResponse` within the 128-KiB output limit, rejected without normalization/repair and never automatically resubmitted

## Proposal versus approval

The output is `buildingRegistration` version 1, with one entry per exact floor/page binding. Each entry has `anchors`, optional `directions`, source-referencing evidence strings and bounded precision. The generated proposal cannot contain approval flags, transforms, scales, changed source readings, heights, voids, roofs or certified stair links.

Every response says `canApply:false`. `valid:true` means only that the proposal has the expected bounded shape and source bindings. Empty or insufficient evidence is an honest unresolved proposal. The shared rigid registration solver checks independent anchors, unique quarter-turn pose, residuals and source-local extents; fresh user review remains a separate prerequisite. No bounding-box scaling, reflection or coordinate repair occurs in this endpoint.

## Frozen blind native packet

`packet/` contains the generic extraction and joint-registration schemas, actual prompts/specification/knowledge, limits and page-evidence protocol. `manifest.json` hashes every file; `manifest.sha256` hashes the manifest. There are no test-specific dimensions, truth artifacts or reference answers. The corresponding external evaluation copy was frozen before the native run:

- Manifest SHA-256: `d972751172db7f51f01524d7f8c3bc7be11598f278a757b8d80bddb73f679268`
- Generator: `node tools/freeze_plan_registration.mjs <new-output-directory>`

Do not overwrite a packet used by an evaluation. A later contract change needs a new freeze and a distinct evaluation. The native protocol asks for per-page source readings first, then a separate joint proposal, while allowing every original page image to be inspected. It is not evidence of production API timing, cost or end-to-end browser behavior.

## Offline verification

`node --test tools/tests/plan-registration-routes.test.cjs` exercises real Worker dispatch, OpenAI wire helpers and signed polling using injected HTTP/quota fakes. It covers one-call multi-page behavior, source immutability, stale hashes, missing/duplicate/ambiguous identity, request overrides, quota failure, cancellation, job/IP/model binding, rejected provider output, unresolved proposals and packet integrity. No live provider requests are used.

## Bounded reconstruction and actual native evaluation

`assets/js/plan-registration.js` builds every immutable local floor with PlanGrid
before registering generated walls and room pieces. V1 items/marks use centre
coordinates; runtime item top-left conversion happens once in `toAppObjects`.
Only rigid quarter-turns and translation are accepted. Printed dimension
conflicts are separate from anchor residuals; no common-bounding-box scaling or
stair snapping is performed. The existing `floorsOverlap` is called in the actual
import/registration pipeline, with an additional adjacent-room footprint check.
These checks are conservative consistency checks, not structural certification.

The review panel displays source-local diagrams, retained UP/DN marks and dashed
stair symbols, a registered plan overlay, proposed transforms, point/direction
residuals and each evidence precision. A numerical residual of zero is only
algebraic consistency of proposed correspondences, not independently established
raster, architectural or 3D accuracy. Source measurements may refer to wall
reference lines; this path does not certify inside faces versus wall centrelines.
Unknown source headers require a separate explicit title/floor decision.

Every multi-floor draft remains blocked until each pose is explicitly reviewed
and the user acknowledges **partial building assembly**. This retains all source
stairs/marks/notes and unmodified source readings in the reconstruction report,
but defers all multi-floor stair items. Existing editor heights and any omitted
v1 item-depth catalogue defaults are display assumptions. No measured storey
height, stair rise, landing/slab opening, room void, roof or foundation is created
by this bounded path. Stair UP/DN adjacency remains source evidence: the current
joint endpoint does not produce certified stair links. The helper's optional
explicit same-physical-arrival-point check is not a shipped staircase model or
a claim that UP bases and DN arrivals must share XY coordinates.

Apply recompiles the current source/decision snapshots, refuses stale crop or
proposal state and active shared editing, and does not perform global legacy
migration. Cancel does not allocate IDs or change geometry/history. A committed
result is consumed before fallible rendering callbacks; a render failure keeps
Undo available and cannot reapply the same building. Local save/load and Undo
retain the additive report, while generic sharing remains gated until compatible
mixed-client preservation exists.

The frozen packet was used for a fresh blinded native Astra reading of the
existing three-page `madori-3f.pdf`. The untouched result is checked in at
`tools/tests/fixtures/registration/native-astra-three-floor.raw.json` with SHA-256
`1cad2db87fc357cd17a9431376ffaf594058140f2a7ff897fcb2c83e6d1386d7`.
It is not production API timing/cost evidence. Native opaque page IDs are retained
as native wrapper provenance, not recast as runtime data-URL hash attestations.
The native regression runs the real merge/decode/finalization/solver, first with
no approval (blocked), then separately with test-only simulated DOM reviews and
partial acknowledgment. Its F1/F2 identity and F3 +455mm Y proposals preserve the
smaller, stepped 3F and do not scale it. Native 3F anchor uncertainty is 85–100mm;
zero fit residual does not erase that uncertainty. Four source stair items are
deferred; arrival-only DN marks remain in source evidence. This establishes a
bounded registration improvement, not full source-faithful 3D reconstruction.

Verification includes solver, actual DOM review/Apply, interruption/repetition,
source identity, provider-route mocks, actual constructor/host alignment and
cardinal rotation tests. The optional localhost cloud-browser preview was blocked
with `net::ERR_BLOCKED_BY_CLIENT`; no bypass or live-browser visual pass is claimed.

A persistent expandable partial-import notice is refreshed from the saved report
on normal redraw, including reload and Undo. It identifies affected floors and
the deferred stair count and keeps the height/connection/void/roof caveat visible
after Apply. Deferred source symbols are shown in the pre-Apply source diagrams;
this checkpoint does not provide a post-Apply generic editable/static source
geometry overlay.
