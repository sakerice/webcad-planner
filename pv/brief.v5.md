# house-planner mobile PV v5 — exact-first layered master

- Deliverable: 32-second website / YouTube PV proposal
- Audience: prospective Japanese detached-home owners; housing and design professionals secondarily
- Aspect ratio: 16:9
- Resolution: 1280 × 720 master
- Core promise: the same plan remains continuous from drawing through exterior, interior, seated-eye review, and finished-life visualization
- Story: `描く → 積み上がる → 角度を変えて確かめる → 座って見る → 暮らしを想像する`
- Audio: restrained modern pulse and tactile UI accents; no narration

## v5 decision

The base master must be coherent and publishable without any unapproved generated exterior.

The base layer uses only current product captures, deterministic motion design, and the official logo. The iteration-04 foyer and LDK beauty stills are legacy candidates: they were generated without the AI-render package v2 controls and must not be treated as exact architectural truth. Exterior and interior enhancement layers may be used only after each camera is independently generated from the AI-render package v2 and passes geometry review.

This prevents a visually attractive but incorrect generated house from becoming the architectural truth for later shots.

## Remaining blockers

1. S01: a real, visibly recorded 1F edit.
2. S02: a real, visibly recorded 1F-to-2F switch.
3. S07: an independently generated foyer render that passes exact package-v2 geometry review.
4. S08: an independently generated 2F LDK render that passes exact package-v2 geometry review.
5. Optional exterior enhancement: one or more approved exterior beauty frames generated independently from exact product renders and control packages.

Until S07 and S08 pass, the exact product captures remain the only architectural source of truth and the storyboard must show those enhancement shots as missing.
