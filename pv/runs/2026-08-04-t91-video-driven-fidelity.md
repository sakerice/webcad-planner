# T91 — video-driven fidelity validation

Status: **truth render complete, Topview submission PENDING (needs a human to attach the files)**
Date prepared: 2026-08-04 (JST)

## What this run tests

The single question this experiment exists to answer:

> Does supplying the real camera path as `@Video1` stop Seedance from inventing architecture, or does it treat the video only as a motion reference and keep hallucinating?

T63 (`260802_0003_video_edit_1659`) failed because a single still image was given and the model moved the camera beyond it, filling unknown pixels with a generic kitchen — an invented hob, range hood, worktop and rear wall.

T91 reproduces that angle, but the camera move is now rendered deterministically from the product's own 3D scene, so the motion is supplied rather than invented.

**The hob and range hood sit at the far west end of the 2F LDK (plan x ≈ 1480–1550 mm) and stay off-frame for the entire move.** They are exactly what T63 fabricated. If they reappear, the route fails again and the design switches to dense keyframes.

## Truth render — must be re-run before the gate

> **The render described below predates the Layer 1 fixes and is incomplete.**
> It has no `instance-legend.json` (the capture hook discarded the legend) and
> no `shot.json`. `report.py` now refuses to run when `instance/` frames exist
> without a legend, because a run that checks no furniture must not be able to
> report PASS. Re-run the capture with the current code — the determinism probe
> first (`pv/tools/truth-render/specs/probe-determinism.json`, now selected by
> `"mode": "determinism-probe"` rather than by its filename), then the shot —
> and confirm `pv/renders/T91-ldk-push/` contains `shot.json` and
> `instance-legend.json` alongside the frame directories. The upload bundle
> below has to be rebuilt from the new render.

Spec: `pv/tools/truth-render/specs/T91-ldk-push.json`

- Shot: 2F Living Dining Kitchen, seated-height push west
- Camera keys (3D metres): `t=0` pos (6.30, 4.20, 1.15) → target (3.00, 4.05, 1.15); `t=2` pos (5.20, …) → target (2.40, …); `t=4` pos (4.10, …) → target (1.80, …); fov 60
- 24 fps, 4.0 s, floor 2, view `3d-int`
- Output: `pv/renders/T91-ldk-push/` (git-ignored)

| kind | files |
|---|---|
| base | 96 |
| edge / instance / segmentation / depth / normal | 9 each (stride 12, terminal frame 95 included) |

Verified by the controller:

- All 141 PNGs are **2560×1440**, a single distinct size across the whole run — exactly 16:9, and uniform, so Layer 3 can compare frame to frame.
- `base.mp4` encoded at 24 fps, 96 frames, 2560×1440, 5.4 MB. Frames extracted back at 0.0 s / 1.958 s / 3.958 s match source frames 0000 / 0047 / 0095 with mean absolute difference ~1.0 (h.264 lossy, as expected).
- The determinism gate passed immediately before this render: `PASS pose A reproducible (59a693d6b143), pose B distinct (07f5ae0d4ab4)`.

## Upload bundle — ready

`pv/renders/T91-upload/` — files are named in upload order.

| file | becomes | note |
|---|---|---|
| `01-Video1-camera-path.mp4` | `@Video1` | 2560×1440, 96 frames, 5.4 MB |
| `02-Image1-t0000.jpg` … `10-Image9-t0095.jpg` | `@Image1`…`@Image9` | 1280×720 JPEG q95, sampled at the guide indices 0, 12, 24, 36, 48, 60, 72, 84, 95 |

Total 6.8 MB.

## Topview settings to use

- Board: `house-planner-mobile-PV-2026-07` / `1dcb0110eaf944b2ad5f5f70e3a8a582`
- Tab: **オムニリファレンス** (Omni Reference)
- Model: Seedance 2.0
- Aspect 16:9 / Length 4s / Resolution 720p / 自動アップスケール OFF
- Mode: **クレジットモード** (4 credits) — chosen deliberately so the verdict arrives immediately. 無制限モード is cost 0 but was queueing 1–6 hours when checked on 2026-08-03. Balance at that time: 490.74.

## Prompt

> `@Video1` defines the exact camera path, room layout, wall positions, openings and occlusion. `@Image1` through `@Image9` are exact frames sampled from that same path in order — treat every one of them as architectural truth. Keep every wall, opening, window, stair tread, counter and furniture item at the identical position, count, orientation and scale as in `@Video1`. Do not add, remove, move, resize or duplicate any architectural element or any furniture. Do not invent a hob, range hood, worktop, rear wall or any kitchen depth that is not already visible. Only upgrade appearance: physically based materials, global illumination, soft contact shadows, realistic daylight falloff, subtle atmospheric depth, and lived-in surface detail confined to surfaces that already exist. No people, no text, no UI, no logo, no watermark, no flicker, no morphing.

## After the generation returns

1. Download the mp4 to `/tmp/T91.mp4`.
2. Extract the frames and give them the truth frame indices. `report.py` pairs
   frames purely by filename, but `extract_video_frames.swift` names its output
   by **centisecond** (`frame_0050.png` for t=0.5 s) while the truth frames are
   named by frame index (`0012.png`). Run the mapping rather than renaming by
   hand — the two conventions coincide only at index 0, so a hand rename
   matches exactly one file. Run the block below from the repository root.
3. Run the gate (command further down).

```sh
python3 - <<'PY'
import pathlib, subprocess
shot = pathlib.Path('pv/renders/T91-ldk-push')
out  = pathlib.Path('/tmp/T91-frames')
fps  = 24
# The indices come from the truth render itself, so this cannot drift from
# the shot spec's guideStride.
idx   = sorted(int(p.stem) for p in (shot / 'edge').glob('*.png'))
times = [i / fps for i in idx]
out.mkdir(parents=True, exist_ok=True)
subprocess.run(['swift', 'pv/tools/extract_video_frames.swift',
                '/tmp/T91.mp4', str(out)] + [f'{t:.7f}' for t in times],
               check=True)
for i, t in zip(idx, times):
    # extract_video_frames.swift names by centisecond: round(second * 100), %04d
    (out / f'frame_{round(t * 100):04d}.png').rename(out / f'{i:04d}.png')
print(f'mapped {len(idx)} frames: {idx}')
PY
```

For this shot that is indices `0 12 24 36 48 60 72 84 95` at times
`0.0 0.5 1.0 1.5 2.0 2.5 3.0 3.5 3.9583334`, i.e. the extractor writes
`frame_0000 frame_0050 frame_0100 frame_0150 frame_0200 frame_0250
frame_0300 frame_0350 frame_0396`, which the loop renames to
`0000 0012 0024 0036 0048 0060 0072 0084 0095`. `report.py` now refuses to
run unless every truth edge frame found a counterpart, so a bad mapping fails
loudly instead of printing `PASS — 1 frames compared`.

Then the gate:

```
python3 pv/tools/fidelity-qa/report.py \
  --truth pv/renders/T91-ldk-push --generated /tmp/T91-frames \
  --min-recall 0.90 --min-precision 0.85 --min-instance-recall 0.90 \
  --json pv/runs/T91-fidelity.json
```

`report.py` now requires a third threshold, `--min-instance-recall`, in
addition to `--min-recall`/`--min-precision` (see "Thresholds" below for why
it is separate). The generated frames are 1280x720 and the truth frames are
2560x1440; `report.py` **downscales the truth base render down** to the
generated frame's resolution and says so once on stderr. That note is
expected, not a warning sign. (Earlier revisions of this tool did the reverse
— upscaled the generated frame up to the truth's resolution — which was
wrong: see "Comparison basis changed" below.)

### Comparison basis changed (2026-08-04)

The controller ran this gate end to end against real render output for the
first time and it failed a generation that was **pixel-perfect** (the truth
`base/` renders themselves, downscaled to 1280x720 to imitate Topview's 720p
output, fed back in as the "generated" frames). Two bugs, now fixed:

1. **Recall's reference was wrong.** Recall compared generated edges against
   `edge/<index>.png` — a synthetic line drawing derived from the instance
   map. That drawing marks silhouette boundaries that are invisible in any
   shaded render (a same-tone wall meeting another wall, an occluded
   outline). An instance like `wall#2` scored recall 0.000 against a
   pixel-perfect reproduction because there was nothing to see there in the
   first place. (Precision had already been moved off the line drawing onto
   the truth `base/` render in an earlier fix; recall needed the same move,
   for the same reason.) Recall is now measured against the truth **base**
   render's edges, exactly like precision. `edge/` is no longer read as a
   comparison reference by either metric — it is only used to enumerate
   which frame indices carry guide data (`instance/`, `segmentation/`,
   `depth/`, `normal/` are all written at the same guideStride-thinned
   indices). `instance/` + `instance-legend.json` keep their existing job of
   defining per-instance bounding boxes; that did not change.
2. **The resize direction was backwards.** The gate upscaled the 720p
   generated frame up to the truth's 2560x1440. Upscaling blurs it, real
   intensity steps fall below `edge_mask`'s threshold, and real edges
   disappear. Measured on the perfect generation: upscaling generation to
   truth size scored recall 0.255–0.752 across the guide frames; downscaling
   truth to generated size scored 1.000 on every frame. The gate now
   downscales the truth base render down to the generated frame's
   resolution (`Image.LANCZOS`), never the reverse.

With both fixes, the perfect generation (truth `base/` renders downscaled to
1280x720 and fed back in) scores exactly:

```
 frame  recall  precision   worst per-instance recall
     0   1.000      1.000                       1.000
    12   1.000      1.000                       1.000
    24   1.000      1.000                       1.000
    36   1.000      1.000                       1.000
    48   1.000      1.000                       1.000
    60   1.000      1.000                       1.000
    72   1.000      1.000                       1.000
    84   1.000      1.000                       1.000
    95   1.000      1.000                       1.000
```

**This is the calibration anchor.** A correct implementation of this gate
must score 1.000/1.000 (whole-frame and every named instance) on a
pixel-perfect reproduction at a different resolution — that is now pinned by
a regression test (`pv/tools/fidelity-qa/tests/test_report.py`,
`PixelPerfectDifferentResolutionTest`) and must never regress.

### Thresholds — NOT CALIBRATED

`--min-recall 0.90 --min-precision 0.85 --min-instance-recall 0.90` are
placeholders. **None of the three numbers is calibrated.**

Whole-frame recall/precision and per-instance recall are now on the same
comparison basis (both reference the truth base render), so the old
"truth-versus-truth line drawing" caveat no longer applies — but the
distribution a *real* photorealistic generation produces is still unknown.
Layer 2 legitimately adds material and lighting detail beyond any render, so
whole-frame precision is expected to sit below 1.0 even when the
architecture is perfect. A perfect-generation measurement only proves the
gate can reach 1.000; it says nothing about where a real generation's floor
sits.

**The real values have to come from the first real generated output.** Run
the gate with deliberately permissive thresholds (`--min-recall 0.50
--min-precision 0.10 --min-instance-recall 0.50`), read the distribution in
`rows` (including every `rows[].instances` entry), look at the frames by eye,
and choose cuts that separate the frames/instances that are visibly broken
from the ones that are not. Record the chosen values and the reasoning here
before any production shot is gated on them. Until that is done, a PASS from
this gate means only "the comparison ran", not "the thresholds were met in a
meaningful sense".

**Two thresholds to discover, not one.** Per-instance recall and whole-frame
recall have very different sensitivity and should not share a cut point.
Measured directly: erasing one object's designed bounding box from an
otherwise-perfect frame moved whole-frame recall only 1.000 → 0.942 (six
points — the room's own outline dominates the pixel count), while that
object's own per-instance recall fell 1.000 → 0.173, and every other instance
stayed at 0.770–0.971. A real generation's legitimate appearance changes will
move the whole-frame number by a similar handful of points, so whole-frame
recall cannot be the primary gate — it cannot tell "Layer 2 did its normal
job" from "an object vanished". `--min-instance-recall` should end up
stricter than `--min-recall`; discover both from the real distribution
before setting either.

Reference points measured on truth frames only, kept for context and **not**
usable as thresholds: two byte-identical frames (old truth-versus-truth line
drawing basis) scored recall 1.0000 / precision 1.0000; two genuinely
different camera poses in the same room scored recall 0.3228 / precision
0.5316. Both were measured under the old truth-versus-truth precision
definition and predate the comparison-basis change above — kept here only so
they are not confused with the new anchor.

## Result

PENDING — nothing has been submitted to Topview yet.

How to read the numbers:

- **Per-instance recall** (`rows[].instances`) is the **primary signal**. It
  names a specific piece of designed furniture the generator dropped or
  altered, and separates cleanly from ordinary appearance-only changes (see
  "Two thresholds to discover" above). It requires `instance-legend.json`,
  which the truth render now writes; `report.py` refuses to run if the
  instance frames are there without it.
- **Whole-frame recall falling** ⇒ design structure went missing somewhere in
  the frame. Measured against the truth **base render**'s edges (not the
  line drawing — see "Comparison basis changed"). This is a coarse guard, not
  the primary verdict: a single vanished object barely moves it.
- **Whole-frame precision falling** ⇒ the generated frame contains structure
  with no counterpart in the truth base render of the same camera pose. It
  does *not* detect a fabricated hob directly — a hob and a rug texture are
  both "edges the base render does not have", and only the magnitude and the
  per-instance numbers distinguish them. Treat a precision drop as a pointer
  to which frames to look at, and confirm a fabricated hob or hood by eye on
  those frames. Also a coarse guard, not the primary verdict.

Branch decision once the verdict is in:

- **Structure held** — keep this architecture and move production shots to 無制限モード (cost 0).
- **Structure did not hold** — drop `@Video1` as the primary constraint and switch to dense keyframes (`@Image1`–`@Image9` at ~0.5 s spacing).

## Not changed by this run

S07 and S08 remain `missing`. A pass here validates the pipeline, not those shots, and must not promote them to `approved`.
