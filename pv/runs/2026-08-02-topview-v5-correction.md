# Topview v5 correction diagnostics — 2026-08-02

## Purpose

Test whether Seedance 2.0 can improve material response and daylight while preserving exact current-product geometry. These jobs are diagnostics only and are not approved S07/S08 architectural renders.

## Account and cost gate

- Signed-in Topview Web account: Ultra
- Web UI entitlement at submission: `Unlimited mode - Free`
- Displayed generation cost for every submission: `0`
- API credit balance observed separately: `0.34`
- API estimate for Standard / 720p / 4s / three outputs: `12` credits, so the paid API route was not used
- Board: `house-planner-mobile-PV-2026-07`
- Board URL: <https://www.topview.ai/board/1dcb0110eaf944b2ad5f5f70e3a8a582?tool-type=video-edit>

Web free-queue submissions are not represented reliably by the API credit log; the zero-cost claim here is the explicit value shown in the signed-in Web UI at each submission.

## Shared settings

- Tool: Omni Reference
- Model: Seedance 2.0
- Aspect ratio: 16:9
- Duration: 8 seconds
- Resolution: 720p
- Outputs per job: 1
- Queue monitoring: intentionally omitted

## Jobs

### T61 — exact seated foyer

- Task: `260802_0001_video_edit_3760`
- Source: `pv/references/v4/topview-inputs/walkthrough-seated-foyer-clean.jpg`
- Queue estimate shown after acceptance: approximately 120 minutes
- Prompt:

> Use @Image1 as the exact architectural truth and the first frame. Keep the seated-eye camera completely locked. Over the first two seconds, refine only viewport shading, antialiasing, physically based material response and soft natural daylight, then hold the same view. Preserve the exact stair tread count and turn, corridor width, cabinet, every door and opening, washbasin glimpse, wood-to-tile floor boundary, wall positions, ceiling and camera height. Do not reconstruct or redesign anything. No camera movement, no morphing, no object movement, no people, no added furniture or decor, no text, no logo, no UI, no cuts, no flicker.

### T62 — exact oblique 2F LDK

- Task: `260802_0002_video_edit_6638`
- Source: `pv/references/v4/topview-inputs/interior-oblique-clean.jpg`
- Queue estimate shown after acceptance: approximately 240 minutes
- Prompt:

> Use @Image1 as the exact 2F LDK architectural truth and first frame. Keep this oblique camera locked with no orbit, pan, tilt or zoom. Refine only viewport shading into restrained premium physically based materials and natural Japanese residential daylight, then hold. Preserve the exact divider-wall length and height, stair opening and visible tread geometry, kitchen sink-to-hob order and cabinet depths, sofa length and left chaise, coffee table, round dining table with four chairs, balcony opening, high window, every wall and floor boundary. Do not infer hidden geometry or redesign the plan. No morphing, no furniture movement, no added decor, no people, no text, no logo, no UI, no cuts, no flicker.

### T63 — exact seated 2F LDK

- Task: `260802_0003_video_edit_1659`
- Source: `pv/references/v4/topview-inputs/walkthrough-seated-ldk-sofa-kitchen-clean.jpg`
- Source derivation: deterministic UI-free crop of `pv/references/v4/ui/25-walkthrough-seated-2f-ldk-sofa-kitchen-live.jpg`
- Queue estimate shown after acceptance: approximately 360 minutes
- Prompt:

> Use @Image1 as the exact seated-eye 2F LDK architectural truth and first frame. Keep the camera fully locked and retain the low human-scale composition with visible floor and sofa. Improve only physically based material response, antialiasing and soft daylight, then hold. Preserve the exact sofa length and left chaise, coffee-table edge, kitchen opening, countertop height, tall cabinet and appliance positions, high horizontal window, wall corner, ceiling planes and every floor boundary. Do not invent the dining area, stairs or any off-screen geometry. No camera movement, no reconstruction, no morphing, no people, no added decor, no text, no logo, no UI, no cuts, no flicker.

## Review gate

These tests may reveal whether locked-camera material refinement is useful, but they cannot promote S07/S08 by themselves. Final promotion requires a per-camera AI-render package v2 export containing base, depth, normal, category, instance and legends, followed by geometry review against the exact product capture. A generated result must never become the source for another camera angle.
