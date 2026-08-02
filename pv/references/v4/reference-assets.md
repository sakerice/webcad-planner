# house-planner mobile PV — v4 reference assets

Reviewed: 2026-08-01

## Direction locked for this iteration

- Prefer seated-eye walkthrough shots when the lower floor plane materially improves spatial understanding.
- Do not reuse only the mode's first camera. Cover cardinal exterior views, free three-quarter exterior, 1F/2F plans, oblique interior 3D, and multiple walkthrough positions.
- Keep live product capture separate from generated architectural payoff.
- Use the same `assets/default_plan.json` house throughout.

## Approved current-product captures

| ID | File | Status | Role |
|---|---|---|---|
| U41 | `ui/01-plan-1f-live.jpg` | approved | Current 1F plan and site context |
| U42 | `ui/02-plan-2f-live.jpg` | approved | Current 2F LDK plan |
| U43 | `ui/03-exterior-3q-live.jpg` | approved | Current free three-quarter exterior |
| U44 | `ui/04-exterior-north-live.jpg` | approved | Current north elevation camera |
| U45 | `ui/05-exterior-east-live.jpg` | approved | Current east elevation camera |
| U46 | `ui/06-exterior-south-live.jpg` | approved | Current south elevation camera |
| U47 | `ui/07-exterior-west-live.jpg` | approved | Current west elevation camera |
| U48 | `ui/08-interior-3d-baseline-live.jpg` | approved | Current 2F interior 3D overhead view |
| U49 | `ui/09-interior-3d-oblique-a-live.jpg` | approved | Current 2F interior 3D oblique view |
| U410 | `ui/10-interior-3d-oblique-b-live.jpg` | approved | Current 2F interior 3D near-oblique view |
| U411 | `ui/13-walkthrough-standing-baseline-live.jpg` | approved | Standing-eye control frame |
| U412 | `ui/14-walkthrough-seated-baseline-live.jpg` | approved | Seated-eye foyer/stair control frame |
| U413 | `ui/16-walkthrough-seated-map-b-live.jpg` | approved | Seated-eye utility-room position |
| U414 | `ui/18-walkthrough-seated-map-b-look-live.jpg` | approved | Same utility-room position, changed look direction |
| U415 | `ui/21-walkthrough-seated-2f-ldk-a-live.jpg` | candidate | Seated-eye 2F LDK, useful floor visibility but large dark TV area |
| U416 | `ui/25-walkthrough-seated-2f-ldk-sofa-kitchen-live.jpg` | approved evidence | Seated-eye 2F LDK; confirms sofa chaise side and kitchen-left ordering, but not the full S07 composition |

## Approved generated architectural stills

| ID | File | Status | Role |
|---|---|---|---|
| A41 | `../../approved/iteration-04/S07-final-ldk-approved-v1.png` | legacy candidate / approval revoked | Generated without package-v2 depth/normal/category/instance controls; must not be used as architectural truth or as another generation's input |
| A42 | `../../approved/iteration-04/S06-foyer-stair-approved-v1.png` | legacy candidate / approval revoked | Generated without package-v2 depth/normal/category/instance controls; must not be used as architectural truth or as another generation's input |

## Candidate and rejected generated architectural stills

| ID | File | Status | Role |
|---|---|---|---|
| C42 | `../../candidates/iteration-04/ldk/LDK-seated-alternate-candidate-01.png` | candidate | Alternate low/seated S07 LDK angle; continuity 5/5, awaiting user approval before any promotion |
| R41 | `../../candidates/iteration-04/exterior/exterior-beauty-candidate-02.png` | rejected | Different facade/volume/opening geometry; generated from an invalid visual anchor rather than a geometry-control package |
| R43 | `../../candidates/iteration-04/exterior/exterior-beauty-candidate-04.png` | rejected | Inherits Candidate 02's invalid generated house geometry; not an architectural continuity endpoint |

## Clean 16:9 Topview inputs

These are deterministic crops of approved live captures. They contain no generated UI or architecture.

| ID | File | Status | Intended test |
|---|---|---|---|
| T41 | `topview-inputs/walkthrough-seated-foyer-clean.jpg` | approved | Seated-eye micro-dolly stability |
| T42 | `topview-inputs/walkthrough-seated-utility-clean.jpg` | approved | Second room / floor-plane visibility |
| T43 | `topview-inputs/walkthrough-seated-utility-look-clean.jpg` | approved | Same position, alternate viewing direction |
| T44 | `topview-inputs/interior-oblique-clean.jpg` | approved | Interior 3D oblique camera motion |
| T45 | `topview-inputs/exterior-3q-clean.jpg` | approved | Exterior free-camera parallax |
| T46 | `topview-inputs/exterior-east-clean.jpg` | approved | East-view angle control |
| T47 | `topview-inputs/walkthrough-seated-ldk-sofa-kitchen-clean.jpg` | approved evidence | Deterministic crop of U416; exact seated 2F LDK source for locked-camera diagnostics |
| T47 | `topview-inputs/walkthrough-seated-ldk-clean.jpg` | candidate | LDK test only; large dark foreground can dominate |

## Rejected capture positions

The following live captures remain as diagnostic evidence but must not enter the picture edit or Topview inputs:

- `ui/15-walkthrough-seated-map-a-live.jpg`: camera teleported against a door.
- `ui/19-walkthrough-seated-map-c-look-live.jpg`: bed/door occlusion dominates.
- `ui/20-walkthrough-seated-2f-baseline-live.jpg`: camera starts against a door.
- `ui/22-walkthrough-seated-2f-ldk-b-live.jpg`: television fills most of frame.
- `ui/23-walkthrough-seated-2f-ldk-c-live.jpg`: camera is inside furniture.
- `ui/24-walkthrough-seated-2f-ldk-d-live.jpg`: camera is inside a wall.

This confirms that the minimap supports useful viewpoint diversity, but arbitrary taps need a spatial-validity review before capture.

The C07 validation target is not a seated walkthrough composition. Candidate 02 uses an elevated view above the upper stair turn. Its hidden stair and divider relationships were therefore checked against the `2F` `内観3D` overhead and oblique captures U48–U410. Walkthrough captures remain appropriate for S06, where floor visibility and human eye height are the goal.

## Remaining missing sources

- Direct screen recording of a real plan edit from before-state to after-state.
- Direct screen recording of the plan-to-exterior and exterior-to-walkthrough mode switches.
- Direct screen recording of the real 1F-to-2F switch. Two 2026-08-01 automated capture attempts were rejected because the recorded pixels did not contain the verified application-state change; see `../../capture/v4/raw/review.md`.
