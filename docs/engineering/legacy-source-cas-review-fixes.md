# Persisted derivation source transaction repairs

This separate unpublished workcopy repairs the exact second legacy-copy freeze,
SHA-256 `f074068fa1af19add70fdbc8f70c5f0d9c77e669005d54e051b3c458966b44f7`.
That source/package and its Library version are preserved. Independent re-review
confirmed the prior UI, appearance, immutable-input and raw-codec probes passed,
but blocked the second freeze on direct repository source-ticket API gaps.

## Bounded changes

- A derivation-source ticket requires nonempty plan/revision/draft identities and
  nonnegative safe-integer generation and baseGeneration values. Omitted,
  undefined, null or malformed metadata fails before an archive/ticket is issued.
  General draft recovery storage remains available; an incomplete draft cannot
  grant inherited legacy-wall admission.
- Derivation verifies the archived sourceOwner against the actual issued ticket
  before creating its child registration. Owner-only corruption cannot create a
  saved child that fails the same ownership checks on subsequent reads.
- The issued registration carries a private immutable source guard. Callers
  cannot supply it through payload/origin fields or commit options.
- The existing final child write transaction reads the source draft, named parent
  revision and raw-source archive together. Before any child revision, head or
  registration write, it compares source identity, revision, generation,
  baseGeneration, exact admitted plan bytes, parent revision bytes/digest, archive
  bytes/digest/codec and every expected sourceOwner field.
- Byte comparison is synchronous inside the transaction. Digests and the
  immutable admitted bytes were proved before entry; no asynchronous hash or
  second transaction creates a source freshness gap.
- Repository CAS is enforced without a host isCurrent callback. Normal host
  cancellation checks remain additive, and stale/corrupted source failures do
  not clear drafts or current edits.

Historical or dirty recovery payloads may still differ from their named saved
parent revision. There is no requirement to equal the latest head. After a child
commits, its archived actual source remains the durable proof; later draft edits
do not invalidate the already committed child. No stores, shared protocol, UI,
appearance/light setters, renderer or geometry validator were redesigned.

## Evidence and limits

All previous 156 anonymous focused tests and their support files remain unchanged.
New direct-API regressions exercise malformed source metadata, source changes
after proof/hash barriers, owner-only corruption, write-free rejection and valid
historical dirty derivation/readback. The IndexedDB implementation in these tests
is the existing serialized transactional contract simulator. Actual browser
durability, quota and lock behavior remain unverified.

Independent review of the new exact freeze remains required. Production build,
canonical feature ancestry, real shared-backend acceptance, browser/mobile UI,
GPU/model/Scene IR rendering and large-plan performance gates remain open.
No private inputs or reports are included in the anonymous source package.
