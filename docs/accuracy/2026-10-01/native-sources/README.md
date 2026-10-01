# Blinded approximate visual extraction inputs

These two PNGs are synthetic source drawings, not recognition outputs. They contain Japanese room labels, dimension chains, windows, doors and fixtures. One has an L-shaped footprint and an L-shaped room. They are provided for an **approximate assistant-model evaluation**, never to be described as Astra API results.

- [Source A](source-a.png)
- [Source B](source-b.png)
- [Exact extraction request](extraction-request.json): source revision, system instruction, complete supporting documents, current extraction prompt and OpenAI-format strict response schema. This file contains no expected answer.
- [Manifest](manifest.json): image dimensions and SHA-256 hashes.

For a blinded run, provide only the selected PNG and extraction request to a fresh evaluator. Do not provide the renderer source, reconstruction comparison, or expected fixture JSON. Use one fresh run per image. Record the actual model identity, whether the strict schema was enforced or only included as text, raw output and elapsed time. Native multimodal input processing is not the same as the application's OpenAI API image pipeline.

Ground truth is deliberately stored elsewhere: `tools/tests/fixtures/native-reading/*.expected.json`. Keep it out of the evaluator's context; use it only after extracting the prediction. Score dimensions, labelled room geometry, wall placement, door/window type, opening width and center, floor identity, room adjacency and invalid-output rejection separately. Do not count JSON validity or a single successful image as general recognition accuracy.

The renderer is `tools/render_accuracy_samples.py` (Pillow + Noto Sans CJK). Source drawings include opening-width labels to make width scoring unambiguous. Some fixture dimensions remain pictorial, just as in typical plans; the extraction prompt specifies catalog defaults. These are small synthetic cases, not a representative distribution of uploaded drawings.
