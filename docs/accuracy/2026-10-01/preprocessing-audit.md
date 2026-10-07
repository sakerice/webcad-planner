# PDF preprocessing and opening-position evidence

## Actual application path

The current application has automatic high-resolution PDF cropping, but it does **not ensure** that every submitted page is a focused crop.

- `assets/js/plan-import.js`: render PDF pages at a 3072 px long edge, then separately at 1024 px for `/api/ai/find-plan`. Locate timeout is 25 seconds. Each accepted box is re-rendered directly from the PDF at 3072 px long edge via `PdfPages.renderRegion`.
- `worker/plan-locate.mjs`: asks for the floor plan plus surrounding dimension lines/numbers, excluding the perspective rendering and title/date/scale labels. `normalizeBox` converts 0–1000 coordinates to fractions, adds a 0.03-page margin on each side, and accepts padded areas between 2% and 85% of the page. This is a geometric sanity filter, not a guarantee of correct content selection.
- A missing box, locate exception/timeout, null crop or crop-render exception retains the original full-page PNG. `locate` discards the server's reason. The PDF crop controls are always hidden, and the final status only reports the page count. No per-page crop preview or manual correction is offered for PDFs.
- Images do have a manual crop preview. The initial selection is the entire image; the user can narrow it. Preview is capped at 1200 px, submission at 3072 px, and raster crops are never upscaled. Submission is PNG on a white canvas.
- Worker limits are 10 MiB decoded image size, eight pages per request, and a request-body cap of `10 MiB * 4 + 256 KiB`. OpenAI requests use `detail: high`, with one image per initial page-reading call. The browser's 3072 px limit does not assert the provider's actual internal processing resolution.

The comments claiming a 3072 px information ceiling were based on historical Gemini measurements. They are not current Astra image-resolution evidence.

## Offline control-flow reproduction

Executed the real `onPlanImportFile` in a VM with a synthetic file and deterministic `PdfPages`/fetch stubs; no PDF was transmitted, no credentials were read, and no API was called. This tests routing/state, not actual rasterization or model localization.

| Stub outcome | Render calls | Selected image | Crop controls | Final status | Read enabled |
|---|---|---|---|---|---|
| valid box and render | pages3072, pages1024, region3072 | cropped | hidden | 1ページを読み取ります。 | yes |
| missing box | pages3072, pages1024 | full sheet | hidden | same | yes |
| crop render throws | pages3072, pages1024, region3072 | full sheet | hidden | same | yes |

Thus full-sheet fallback is silent in the final user-visible state. This is observed code behavior, not an inference from native model scores.

## Existing source resolution

Read-only PyMuPDF inspection of public `tools/tests/fixtures/madori-3f.pdf`, page 1, found the plan is an embedded **1003×859 raster**, placed at PDF coordinates approximately `(138.36,219.60)-(499.44,528.84)`. The adjacent perspective is another 1600×1600 raster. The sheet is approximately 1190.52×841.92 PDF points.

At full-sheet long-edge 3072, the entire embedded plan occupies approximately 932×798 output pixels. A focused crop gives it more of the submitted/model image budget, but PDF re-rendering cannot create new fine detail beyond the embedded raster. Do not describe this particular PDF as vector linework or assume a 3072 px crop contains 3072 px of independent plan detail.

## Parent-supplied native evidence — preliminary

The parent reports that the original full-page pass found 7/8 physical doorways and 8/10 annotated room connections, while a focused crop found 8/8 and 10/10, correcting storage/bath interpretations. Those readings used source-contaminated prompt examples; dimensions and room-coordinate matches are not held-out evidence. This is a single native-assistant comparison, not the production locate/crop pipeline or Astra API.

A fresh pass using the parent's separately recorded neutralized prompt reportedly retained labelled dimensions and room unions and found 8/8 doorways and 10/10 connections. However, the utility-to-hall sliding opening was placed at **x=4110 mm versus an independent pixel annotation near x=4875 mm**, roughly **765 mm along the correct wall**. Treat these values as preliminary parent/scorer evidence until its final annotation report is attached. Correct wall association and adjacency did not detect this location error. Do not fit the prompt to these coordinates, or claim the neutral prompt improves accuracy.

## Minimal next work

Preserve the current high-resolution crop path. Expose, per page, the actual crop and whether it fell back to a full sheet; provide manual adjustment before reading, especially when localization fails. Retain the PDF source and normalized box so manual correction can re-render the selected region. For multi-page PDFs, include page selection rather than silently sending eight pages or omitting extras. This is a reviewable UI proposal, not implemented in this audit.

For evaluation, add source-referenced opening centre/interval error along the wall, not just attachment distance and room adjacency. Use annotation uncertainty/tolerance and retain ambiguous fixture interpretations. A source overlay and typed review-needed evidence would make material position errors visible; they require coordinate mapping through page crop, image scale and plan scale. Neither increased output size nor a stronger topology score alone solves this error.
