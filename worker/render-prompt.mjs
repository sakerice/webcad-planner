// アプリの中で生成する AIレンダー（POST /api/ai/render）の指示文。
//
// なぜ Worker が組み立てるのか
// ----------------------------
// 利用者の文は受け取らない。画面を通さずに API を直接呼ばれても、任意の絵を作る道具として
// 使えないようにするため（設計書 docs/superpowers/specs/2026-11-27-ai-render-in-app-design.md）。
// 決まった preset と view だけを受け、指示文はここで組む。
//
// 土台は画面の buildAiRenderPrompt（index.html。「画像AI用データ」に入る長い指示文）の
// 「Strict requirements」と「Negative prompt」の考え方で、形を変えずに質感だけを上げる。
// 2026-11-26 の試し生成では、その長い指示文は色と設備まで元に忠実だったが暗かったので、
// 自然な昼の光と明るい露出を頼む文を足している。短い指示文では IH がガスコンロに、扉が木目に
// 変わったので、設備の種類と仕上げの色を変えない文を必ず入れる。
//
// preset の id と表現の文は、画面の AI_IMAGE_PRESETS（index.html）と合わせる。画面に preset を足したら、
// ここにも足すこと（足さないと、その preset は 400 で断られる）。

// 表現ごとの文。画面の AI_IMAGE_PRESETS の style と同じ文（そちらは「画像AI用データ」に入る）。
// painterly は「絵画的な見た目を避ける」という既定の文を外す鍵（水彩を頼みながら禁じないため）。
const PRESETS = Object.freeze({
  "life": Object.freeze({
    painterly: false,
    style: "photorealistic architectural photography of a home that is lived in, natural daylight pouring through the openings and filling the space with soft indirect light, every surface reading as real material with age and use in it (grain in the timber, weave in the fabric, a sheen on the stone), subtle lived-in material character on existing objects only, without adding props, clean modern Japanese residential presentation",
  }),
  "life-watercolor": Object.freeze({
    painterly: true,
    style: "watercolour architectural illustration of a home that is lived in, soft washes carrying the colour with pigment edges, paper grain and gentle colour bleeding past the boundaries, warm daylight blooming through the openings and pooling on the floor, subtle lived-in material character on existing objects only, without adding props, painterly throughout while the room still reads as a real Japanese home",
  }),
  "architectural": Object.freeze({
    painterly: false,
    style: "photorealistic architectural photography, natural daylight, clean modern Japanese residential presentation, every surface reading as real material with grain in the timber, weave in the fabric and a sheen on the stone, professional completion photography preserving all existing furniture and fixtures, without adding people",
  }),
  "facade-watercolor": Object.freeze({
    painterly: true,
    style: "architectural facade watercolour on warm white textured paper, delicate precise ink linework, restrained translucent pigment washes, subtle granulation and soft atmospheric background; preserve the exact source perspective, roof silhouette, window and door positions, facade proportions and all designed objects. Keep architectural edges legible and fixed; pigment bleeding is limited to surface interiors and background. Do not convert the perspective into a flat elevation or redesign the building",
  }),
});

export const RENDER_PRESET_IDS = Object.freeze(Object.keys(PRESETS));
export const RENDER_VIEWS = Object.freeze(["interior", "exterior"]);

export function isRenderPreset(id) {
  return typeof id === "string" && Object.prototype.hasOwnProperty.call(PRESETS, id);
}
export function isRenderView(view) {
  return typeof view === "string" && RENDER_VIEWS.includes(view);
}

// 指示文。preset と view 以外は受け取らない（ほかの欄を渡されても読まない）。
export function buildRenderPrompt({ preset, view }) {
  if (!isRenderPreset(preset)) throw new Error("unknown preset");
  if (!isRenderView(view)) throw new Error("unknown view");
  const p = PRESETS[preset];
  const interior = view === "interior";
  const subject = interior ? "the interior of a modern Japanese house" : "the exterior of a modern Japanese house and its site";
  const lines = [
    `Image 1 is a 3D render of ${subject}. Image 2 is its depth map (darker = nearer, lighter = farther). Image 3 is its outline map (the edges of every designed element).`,
    `Turn image 1 into a finished ${p.painterly ? "illustration" : "photograph"} of the same scene. Style: ${p.style}.`,
    "This is a lighting and material pass over image 1, not a redesign. The colours in image 1 are the real paint and finish colours the owner chose: keep the hue and lightness of every surface and only add realistic light, shade and texture.",
    "",
    "Keep the design exactly as it is:",
    "- Same camera, perspective, framing, horizon and crop as image 1. Do not zoom out, widen the view or reveal anything beyond the edges of image 1.",
    "- Every wall, ceiling, floor boundary, window, door, opening, stair, built-in fixture, appliance and piece of furniture stays at the same position, size, shape and count as in image 1. Count the chairs, windows and doors in image 1 and keep exactly that many.",
    "- Do not add, remove, move, resize, merge or split anything. Do not replace an object with a different kind of object.",
    "- Objects cut off at the edges of image 1 (a door, a window, a wall, a piece of furniture), even a thin sliver of a frame, stay in the picture, cut off at the same place.",
    "- Keep the type of every fixture and appliance: an induction (IH) cooktop stays a flat induction cooktop, a range hood stays the same hood, a refrigerator stays a refrigerator.",
    "- Keep the colour of every surface as in image 1. Doors keep exactly their colour in image 1: a pale cream or yellow painted door stays pale cream or yellow and never becomes wood. Each wall keeps its own colour: a wall painted a different colour from the others (an accent wall) stays that colour and does not turn white. Window frames keep their colour and style (dark frames stay dark, sliding windows stay sliding). Floors, worktops, cabinets and fabrics keep their colour and material.",
    "- Use images 2 and 3 to keep every outline and the depth order aligned with image 1.",
    "",
    "Improve only light and material realism:",
    interior
      ? "- Bright natural daylight coming through the windows and openings, a bright and airy exposure with soft fill light, at least as bright as image 1, so the room is well lit and no area is murky or underexposed. Clean, slightly warm white balance with no grey or dull cast."
      : "- Bright natural daylight, a clear sky and a bright, well balanced exposure, with soft realistic shadows.",
    "- Soft realistic shadows and ambient occlusion, real material texture (timber grain on wooden parts, plaster, fabric weave, glass, metal).",
    p.painterly
      ? "- A painterly treatment is intended, but it must not move, blur away or invent any edge shown in image 3."
      : "- Crisp, photographic detail. Avoid painterly or illustration looks.",
    "",
    "Never add people, animals, vehicles, plants, decorative props, text, logos, signatures or watermarks.",
  ];
  return lines.join("\n");
}
