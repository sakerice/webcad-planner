# Local v3 mapping review

This adds a reachable correspondence editor inside the existing experimental import review. The image route remains default-off and bounded reconstruction remains local-only. This is not a completed real-plan reconstruction or browser-visual certification.

## Interaction contract

1. Open a source object, room, or opening in the review and choose its correspondence button.
2. For an object, deliberately choose an exact compatible catalogue ID and native dimensions or reviewed source-envelope scaling. Candidates use the existing runtime catalogue. No candidate is selected by default, and no fuzzy name, room use, or desk/table substitution is used.
3. Choose whether to map the known drawing appearance. Regional colors require distinct existing renderer channels or an explicit “source diagram only” choice. Source-only regions retain incomplete status. Room square grids, plank lines, and plain fills use the existing bounded materializer contract; unsupported details stay blocked.
4. Confirm the correspondence, then review the updated diagnostics before Apply. Every committed correspondence change invalidates all prior group reviews and omission decisions. Opening an editor disables Apply; cancelling preserves the last confirmed binding and review. Stale controls cannot change a newer or cancelled result.

Choices are saved as separate `bindingDecisions` containing an unchanged source snapshot. The raw extraction, original scene/bindings, raw response and extraction hash are not modified. Applied reconstruction reports preserve both source and reviewed choices. Confirming correspondence does not place anything in the live plan; Apply still revalidates against current runtime metadata and performs one additive undo step.

## Compatibility and safe exclusions

Candidates require a matching explicit catalogue kind (or audited exact-ID source type), matching semantic extent, available required axes, compatible known envelope/front relationship, and compatible known height. Every offered model shows native width/depth and differences, height/default status, front provenance, available finish channels/default colors, and material uncertainty. Native sizing cannot override a different source envelope. Unverified fronts/bed-head axes and unsupported stairs/semantic extents remain explicit blockers. The chooser does not invent metadata to make an option appear.

The existing catalogue navigator places new furniture and has no selection callback for binding an existing source record. The review therefore reuses its runtime catalogue contract in a bounded select editor, without adding a second furniture-placement action.

## Exact fixture metadata audit

Only these independently inspected represented units gain `individual-fixture` semantics and explicit source-type compatibility:

- `fmp-WashBasin01`: one basin and tap; source type `washbasin`
- `fmp-ShowerSystem01`: one shower system without an enclosure; source type `shower-fixture`
- `fmp-Toilet01`: one bowl/seat/tank toilet; source type `toilet`
- `original-toilet`: one tank-and-bowl toilet; source type `toilet`

Evidence is their actual entries in `assets/models/furniture_mega/manifest.json` or `assets/models/custom/manifest.json` and corresponding `assets/models/previews-v2/<id>-thumb.png`. The original toilet is additionally described by `tools/blender/build_sanitary.py`. Neighboring variants and vanity/room assemblies stay unchanged. Existing basin/toilet +Z evidence is preserved; no new FMP toilet/shower front or bed head axis is claimed. This audit establishes represented units, not source-product identification, dimension equivalence or full renderer fidelity.

## Verification scope

The mapping regression suite drives actual rendered DOM controls and events into the real compiler and Apply, including the retained synthetic full scene. It checks colors/channels, tile module, source dimensions, separate raw/hash preservation, cancellations, changing choices, stale controls, missing catalogue metadata, and fresh review requirements. Its lightweight DOM harness is not a browser engine; CSS layout and browser visual quality remain unverified.

Production code contains no fixture-specific binding answers. Synthetic test mappings represent test actions only, not user approval or source facts. The real Source C plan still has unsupported geometry, opening mechanisms, staircase and unverified model-axis boundaries; selecting mappings cannot remove those diagnostics.

Local checkpoint validation: 212 focused scene/import tests passed, including 18 new rendered-control/event regressions. The aggregate across 141 test files plus the lint self-test passed. JavaScript/HTML syntax, frozen extraction packet hashes, asset certificate checks, and the no-deploy build passed. An independent safety review passed after fixes for a newer legacy read inheriting a stale mapping editor and touch cancellation incorrectly re-enabling Apply. No live extraction request, push, merge, deployment, or browser bypass was performed.
