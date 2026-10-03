# Full source-first mapping review fixture

`v3-mapping-full.json` is the unchanged synthetic residential/site extraction
from `astra-full-fixture.json` used in the Scene IR v3 evaluation. SHA-256:
`7d0615e57db2617c2c63b5cbff7f773183a3563d320bfb0eaceba961ea837ff9`.

The DOM regression exercises explicit simulated review interactions for its
three rooms, five openings, desk, chair, and car. The source has no bindings.
The regression creates them only by operating the rendered mapping controls;
no saved decision file or compiler acceptance options are loaded. The
choices are test-only simulations, not user approval or exact product
identification. Car roof color is explicitly retained as a source-only overlay
because its active certified asset exposes only one generic color channel.

No provider request, browser launch, deployment, or user data is involved.
