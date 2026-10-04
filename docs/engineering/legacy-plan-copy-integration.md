# Explicit original-preserving legacy copies

## Status and exact baseline

Unpublished R&D integration, not release-ready or pushable. The initial legacy
freeze was blocked by independent review; its repair scope and current evidence
are in [legacy-copy-review-fixes.md](legacy-copy-review-fixes.md). This work is derived
from the reviewed shared-plan-persistence-lifecycle-fixes source package, SHA-256
`19dadfd0a6f026ec37637d3a3d5b3036a88a1e95bf5a43f221e48efb72c9343d`.
Its archive declares source commit `187d7ffbe77faf8b430ac3a48b93dba4604272e4`;
that declaration is not verified canonical Git ancestry. No main, remote, user
computer, live user plan, paid API or deployment was modified. The preceding
freeze remains unchanged.

## Existing components reused

- The same `PlanRepositoryLab` database, six stores, rawSources/migrations,
  revisions, CAS, transaction completion and readback hashes
- The same `PlanLibrary` inventory, native editor, dirty choices, protected
  install, drafts, recovery, duplicate/history, native-to-comparison handoff
- The unchanged strict `PlanSchema` and unchanged reviewed dry-run helper
- The established wall/face maps and real appearance lookup functions

No new database, map namespace, renderer or parallel prototype toolbar is added.

## Activation and user choice

Old browser-store sources are listed read-only. Selecting a source archives it
without changing the source store. Original inventory rows offer read-only
inspection and conversion review. A selected JSON file that is strict-invalid
but convertible opens the same review; it cannot replace the current plan.
Malformed or ambiguous conversions are visibly blocked.

The review explains retained entities/settings, exact inert walls, the ID mapping
and settings-key copies. An explicit commit creates a separate plan identity with
verified origin. Opening it is a separate deliberate inventory selection. No
startup rewrite or silent geometry repair occurs. Cancellation, stale requests,
quota/transaction/install faults preserve current edits and archived originals.
Modal epochs and current-file checks suppress dismissed late reviews and stale
commit work through proof and immediately before CAS writes.

## Trust and narrow zero-wall admission

Copy lineage is in head.origin plus a registration in the existing migrations
store, not a payload permission field. It binds the verified raw-source digest,
original source entry and import revision, deterministic conversion candidate
and initial converted revision. Raw structured values are re-encoded against the retained codec bytes during
proof; checking only their self-hashed projected import is insufficient. Saves
and derivations snapshot descriptor-safe immutable caller data and metadata
before asynchronous validation. Every admitted repository read/save/restore,
duplicate, recovery and independent derivation verifies that lineage. Original
and conversion revisions remain individually hash-checked. Derived registrations
also bind their parent plan/revision and, for dirty-source derivation, an exact
archived source snapshot issued from the persisted draft. Arbitrary caller parent
payloads are not authority. The service supplies this origin itself.

An in-memory WeakMap-issued capability is passed by the host's protected install
and is restored on install rollback. Serializing it does not preserve authority.
Flags in JSON or a forged origin alone cannot issue a capability.

Only exact retained coincident-endpoint wall records may be omitted from the
validation projection. Actual DATA retains those wall records and settings
unchanged. All entity IDs must remain present and unique within each full
collection, including omitted inert walls. The full object-count limit is still
checked. All other geometry/floor/thickness/entity checks run through the
unchanged strict schema. Editing an inert record while it remains zero-length
fails admission; correcting it into strictly valid geometry is allowed. Ordinary
new/AI/source content remains strict. Derivations may inherit only exact inert
records present in their actual source snapshot; new invalid content cannot
borrow the allowance.

The helper still refuses ambiguous known identity references, and never
recursively rewrites arbitrary numeric maps. Numeric wall ID 0 (including -0)
remapping is additionally blocked: the established renderer treats numeric zero
as a coordinate-key fallback, so remapping would change active/dormant appearance.
String "0" does not have that ambiguity. No renderer semantics are changed.

## Data and appearance preservation

Dormant/unknown exterior wall and face keys remain in their original maps during
sync, stage, save, reload and export. Renderers still look up their recognized
exact keys. The old roof-shape migration adds whole/floor defaults while retaining
old root keys, unknown optional fields and existing floor settings. Whole/floor
appearance precedence and texture orientation retain the established behavior.
Wall reads use detached effective fallbacks and leave stored null/false values
unchanged; explicit setters use the persisted write owner. Light rendering and
properties use detached effective defaults, retaining both existing color fields
while rendering the established lightColor interpretation. New-light defaults
and intentional color/kind edits still persist.

Issued copies skip inherited furniture/coordinate normalization so conversion
cannot remove historical TV records, resize doors or relocate fixtures. Default
strict imports retain their existing normalizers. Issued-copy staging also rejects
any inherited migration that would remove or change existing JSON values, while
allowing missing defaults to be added; unsupported optional-data shapes fail
visibly before installation. Save/export retain the issued
capability outside JSON; ephemeral `_texObj` handling remains the existing codec.

Portable exported JSON cannot carry trusted admission. Plain strict reimport
rejects retained zero walls; the original-preserving conversion review is the
supported local reimport route. A portable signed/archive trust protocol is not
implemented.

## Verification and limits

Run `node --test tools/tests/*.test.cjs` with Node 18+.

- The original 63 focused persistence/import/shared-lifecycle tests are untouched
- The original 31 dry-run regressions and helper are unchanged
- New lineage tests exercise forged origin/capability, hash/import/candidate
  mismatch, missing/duplicate IDs, added/changed inert records, unrelated errors,
  quota/rollback, strict new data, retained-only derivation and numeric-zero IDs
- New host tests exercise native save/reload, fresh-session restore, comparison,
  explicit file conversion review, cancellation, recovery, derivation, a real
  RPG helper conversion and retained-source composition
- Actual-source tests exercise native stage, IDs/heights/roof/settings, real
  exterior/interior face geometry and appearance, texture orientation, furniture
  guard and JSON export/reimport behavior

Additional render-read tests construct real vendored Three.js meshes/lights in
Node without a WebGL renderer. Host tests use the inherited transactional
IndexedDB/DOM/pane simulator; their
pane validation wrapper is not a renderer. Actual-source appearance/stage tests
run the real listed helpers, with unrelated draw/model/browser operations
isolated. Shared responses in earlier tests remain synthetic. Authorized private
copies were also passively exercised separately and are excluded from this
package and public fixtures/reports.

Still unverified: actual browser IndexedDB durability/quota, real UI interaction
and mobile layout, WebGL/collision/model rendering, uploads, full Scene IR review
and source-composition UI, backend/shared protocol semantics and canonical Git
ancestry. Full model/build inputs are absent. Zero-wall shared create/sync is
blocked before normalization, requests or dirty clearing; unsupported incoming
shared plans fail protected install without discarding current edits. No server
validator is weakened and no shared legacy readiness is claimed.

Lineage verification deliberately rereads/hash-checks the original and reruns the
reviewed helper. Multi-megabyte plans and deeper derivation chains can incur
significant repeated main-thread cloning/hash work. Chains are bounded at 32 and
fail closed beyond that depth. Browser performance/size/quota QA is required
before rollout; no durable cache or storage-engine redesign is included.
