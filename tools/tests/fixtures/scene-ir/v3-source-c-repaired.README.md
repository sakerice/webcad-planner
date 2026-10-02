# Source C repaired v3 regression

`v3-source-c-repaired.json` is the unchanged previously reviewed extraction from
`astra-source-c-repair-1.json`, used by the offline placement-context regression.
It is not a new extraction or a hand-edited floor mapping. Its 18 wall, 8 room,
and 13 opening floor facts remain unknown because the floor label was not printed.

The test supplies a separate user placement context and checks all 39 runtime
floor blockers disappear while unsupported opening mechanisms still block Apply.
No provider request, asset approval, or materialization approval is performed.
