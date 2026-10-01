# Preserve unknown dimension evidence

This is a deterministic contract correction, not a measured improvement in Astra recognition. No provider calls, private drawings, or paid evaluation were used.

## Consumer audit and scope

`worker/plan-response-schema.mjs` supplies Vertex's response schema and the OpenAI strict-schema adapter. Previously the adapter required every field, including four numeric edge totals, even for an unlabelled edge. `worker/plan-prompt.mjs` passes `dims` through decoding without numeric conversion. `worker/plan-gate.mjs` was its only arithmetic consumer. Review rendering and application geometry use room rectangles and width/depth, not `dims`. `assets/js/plan-import.js` displays existing notes/warnings using text content; inference explanations use this existing notes channel. The application's saved geometry schema is unchanged.

Both provider schemas now allow explicit null for `dims`, an edge, its total, its chain, or an unreadable chain position. Vertex fields remain optional; OpenAI fields remain required with explicit nullable types. Unrelated optional fields do not become nullable. Core width/depth and room coordinates remain required non-null numeric fields.

`dims` means printed dimension evidence. Inferred values belong in geometry and their explanation belongs in notes, not in the printed-evidence values. Typed observed/inferred metadata is deliberately deferred: it needs a consistent source for every inferred coordinate and a UI presentation before it can be treated as verified provenance. Legacy numeric evidence remains accepted; this change does not retroactively classify it as independently verified observation.

## Deterministic before/after

| Supplied evidence | Previous gate facts | Corrected gate facts |
|---|---|---|
| total=null, parts=null | total=0, sum=null | total=null, sum=null |
| total=1820, parts=[910,null,910] | total=1820, sum=1820 (false complete match) | total=1820, sum=null |
| total=null, parts=[910,910] | total=0, sum=1820 | total=null, sum=1820 |
| total="1820", parts=["910",910] | total=1820, sum=1820 | unchanged |

Blank strings, booleans, nonfinite values and nonpositive physical lengths are unknown evidence, never zero. Unreadable chain entries are not silently removed before summation. Absent or wholly null dimensions do not become fabricated numeric evidence. Existing revision scoring thresholds are unchanged; null evidence remains available to the gate rather than manufacturing agreement.

A no-scale response uses `floors: []` and notes explaining why. The import finish boundary rejects it with HTTP 422, no plan, and no revision candidate. It also rejects missing/nonpositive width or depth without making core geometry nullable. A refused source page prevents a mixed multi-page reading from silently returning only the successful pages. Source pages, notes and usage are retained in this error response. Legacy wall-based results bypass this new floor-footprint check.

## Validation and limits

Run:

```sh
node --test tools/tests/plan-dimension-evidence.test.cjs
node --test tools/tests/*.test.cjs
SKIP_DEPLOY=1 bash build.sh
```

The seven focused tests cover both schema representations, unchanged core geometry types, nullable enums in the adapter, blank evidence, partial chains, legacy numbers and strings, decoder/route preservation, no-scale refusals, mixed pages, and invalid footprints. Broader schema, gate, procedure and specification tests are also exercised.

Positive numeric geometry with no dimension labels can still be valid when scale comes from an explicit user hint or another trustworthy source. Thus `dims:null` by itself does not forbid application. The server cannot prove that a model's positive numeric footprint was grounded in the image; universal scale provenance and a dedicated scale-confirmation flow remain follow-up work. This patch does not claim that prompt instructions alone prevent hallucination. Empty non-floor-plan pages now reject the whole reading instead of silently omitting a page; users should select intended floor-plan pages.

Provider schema syntax was checked against [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs) and [Vertex structured output](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/multimodal/control-generated-output). Hosted acceptance and recognition behavior remain untested.

Local validation (2026-10-01): focused schema/gate/procedure/spec suite 50 passed; complete Node suite 1,296 passed, 2 skipped, 0 failed (1,298 total); lint self-test passed; `SKIP_DEPLOY=1 bash build.sh` passed. These counts are on the independent main-based branch, so they exclude new tests from PRs #66 and #68.
