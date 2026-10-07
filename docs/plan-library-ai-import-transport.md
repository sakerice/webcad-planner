# Comparison-pane AI import transport

The comparison pane keeps the existing 間取り図から下書き dialog and its native controller. Normal editor startup and normal transport remain unchanged. This change adds no alternative dialog, backend route, automatic retry, contract downgrade, automatic Apply, room connection, or external renderer.

## Fixed host capability

The early comparison host privately captures its original transport before the existing fetch guard is installed. A single-use initialization handoff is consumed by the actual PlanLibrary host and immediately removed. The retained handoff function cannot issue a second capability. Panes and capture-only previews receive no original transport. Their existing blanket `/api/` and non-GET fetch restrictions and WebSocket restrictions remain in place.

The private capability has exactly these operations:

| Operation | Method | Fixed same-origin path |
| --- | --- | --- |
| quota | GET | /api/ai/quota |
| locate | POST | /api/ai/find-plan |
| read | POST | /api/ai/import-plan |
| read-result | POST | /api/ai/plan-result |
| revise | POST | /api/ai/revise-plan |
| finish | POST | /api/ai/finish-plan |
| register | POST | /api/ai/register-plan |
| register-result | POST | /api/ai/register-plan-result |

POST bodies retain the native JSON schema. The host supplies the fixed JSON content type, same-origin credentials policy and redirect-error policy. There is no caller-controlled URL, method, headers, credentials, Request object, raw fetch, raw Response, room endpoint, WebSocket, or `/api/ai/render` route. The pane receives only a status/ok/text/json response facade, whose body reads check ownership again. HTTP/body/error, usage totals and existing review contracts stay with the native controllers. Failed quota checks are visible in comparison panes.

This is a same-origin application capability and ownership boundary. Same-origin script access is not a security sandbox or a cryptographic separation between the panes and host.

## Actual controller and lifecycle ownership

A private PlanImport registry creates single-use request tickets only at its existing network call sites. Quota, automatic PDF locate, read and reviewed registration have separate operation scopes. Public local lifecycle contexts cannot initiate host transport. PlanFinish receives the same read context and only its fixed finish operation.

PlanLibrary first looks up the actual iframe window, then verifies its actual pane ID and registered PlanImport instance. It rejects forged or foreign contexts/tickets, replay, capture previews and detached/disposed panes. Each chain binds the host session, pane object/window, stable plan ID, host installer epoch, actual editor installer/target generation and exact target snapshot, draft ownership, import epoch, source/request version and exact file/page/crop/mode source key. Registration additionally checks the current review object and exact original source-local snapshot.

Target ownership is based on the editor's independent import generation/snapshot. Camera-only changes are view state and do not retire an import. Same-ID edits, edit/Undo ABA, DATA replacement, committed install, A→C→A, source change, cancellation, a newer request and disposal do retire it. Every outgoing operation, response, parsed body and facade read rechecks the owner. Existing controller catch/finally/apply guards prevent stale work from clearing a newer busy/result/quota state or mutating a different plan.

The host also validates operation order and narrowly permitted payload keys. Read/revise result polls must use only the exact job array returned to that same chain, its current revised flag and extraction contract. Registration polls must use its own exact jobs and original source-local snapshot. Foreign echoed result jobs close the chain. Unexpected contracts on initial reads, revisions and their polls preserve the exact native raw failed response and stop applicability without a downgrade or new read. Legacy replies must omit the extraction-contract field; even explicit falsy values do not count as a legacy contract. Explicit v3 replies must match the requested contract.

The v1 controller's existing behavior is retained: an optional revise quota/server/transport failure can keep the original valid read and continue its native finish analysis. This is neither a revise retry nor a new read. Owner/job/contract denials do not authorize that continuation. Native finish may make its existing second marks request only while the same owner remains current. Foreign contracts on either finish response are retained as failed evidence and cannot enter cached finish analysis. A valid original read can still be reviewed without finish analysis. Registration checks its native building-registration-v1 response contract when provided and prevents a later successful poll from dropping or changing that contract; existing contract-free legacy replies retain their original behavior.

## Evidence, cancellation and limits

Existing session-local detached source mementos, installer rollback, source review, approvals, source CAS, explicit review and one-step Undo are reused. The previous 64 MiB per-plan and 128 MiB per-session encoded-source limits, 16-plan cap and refusal-before-transition/no-eviction behavior are unchanged. No original image/PDF bytes are automatically added to DATA, plan JSON, drafts, revisions or repository raw-source archives. Explicit review JSON export still omits image bytes and requires fresh approvals when resumed. These mementos do not promise browser-reload durability.

Cancellation aborts browser requests and stops native timers/polls. Aborting browser transport does not cancel accepted server work or undo usage/fees. Completed raw evidence and selected source references remain recoverable through the existing session transitions; ordinary close is not an automatic restart.

## Verification boundary

Anonymous controller tests use the real PlanLibrary, PlanImport, PlanFinish and editor ownership/installer code with simulated DOM/IndexedDB and mocked responses for every operation, including quota. These establish bounded controller behavior, not browser IndexedDB durability, native WebGL rendering, mobile reachability, popup behavior, actual AI/backend service correctness, source-reading accuracy or Full Apply acceptance. No live AI/provider/quota calls, paid API, browser-launch workaround, backend change or deploy is needed by this suite.
