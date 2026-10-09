# Unknown dimension contract audit — no contract change in this PR

The current Vertex schema makes `dims` optional, but the OpenAI adapter puts every property into `required` and does not add nullability. Thus OpenAI's strict schema requires all four edges, their numeric totals and their parts arrays, even if the image has no such dimension labels. `width` and `depth` likewise have no representation for unknown scale. Notes can describe uncertainty, but they do not prevent a required number from appearing as apparently measured geometry.

A local read-only reproduction confirmed: `dimsRequired: true`; `edgesRequired: [top,bottom,left,right]`; `totalType: number`. Passing a hypothetical `dims.top.total = null` to the current gate becomes `{total: 0, sum_of_parts: null}` because `Number(null)` is zero. Therefore adding nullable fields to the provider schema alone would be incorrect.

A compatible change needs a coordinated contract design, not a prompt-only edit:

1. Distinguish observed, derived and unknown dimensions. Null must mean unknown; zero is a valid coordinate but never an unknown physical length.
2. Permit absent/unreadable dimension edges and entries in both provider schemas; update the OpenAI adapter's optional/null handling with strict-schema regressions.
3. Change decoding, validation, dimension checks, revision facts, display and evaluation to retain unknowns without `Number(null)` coercion. Width/depth without sufficient scale evidence must remain non-applicable and request scale rather than fabricate it.
4. Preserve legacy numeric readings and saved-plan schema compatibility. New extraction evidence should remain separate from saved plan geometry unless explicitly adopted.

This affects provider output, intermediate extraction and rejection/revision behavior. No unreviewed schema rewrite or automatic scale inference is included here. The two blinded source images include dimension evidence; their evaluation does not establish correct handling of unknown scale.
