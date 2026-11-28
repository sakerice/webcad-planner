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

// 4 枚目（法線）の説明。色と向きの対応は、画面の撮影 captureAiOverrideGuideDataUrl('normal')（index.html）に合わせる。
// three.js r169 の MeshNormalMaterial を両面（DoubleSide）で全体に当てて撮っている:
//   - 法線はカメラから見た向き（view space）。色 = 法線 × 0.5 + 0.5（色空間の変換なし）。
//   - 赤 = 画面の右を向く度合い、緑 = 画面の上を向く度合い、青 = カメラの方を向く度合い。
//   - 両面なので、裏から見えている面も、カメラ側を向いた法線で塗られる。
//   - 何も無い所（背景）は #8080ff（カメラの方を真っすぐ向いた面と同じ色）。
// 例（カメラがほぼ水平のとき）: 床は明るい緑、平らな天井は紫（赤と青が半分、緑が無い）、正面の壁は青紫、
// 右を向いた壁はピンク、左を向いた壁は青緑。傾いた天井は、傾いた向きの分だけ平らな天井と違う色になる。
const NORMAL_GUIDE_LINE = "Image 4 is its surface-orientation map (a camera-space normal map): the colour of each pixel tells which way that surface faces. More red = facing further to the right of the picture, less red = facing left; more green = facing up, less green = facing down; more blue = facing the camera. When the camera looks roughly level, a flat floor is light green, a flat horizontal ceiling is purple (no green), a wall facing the camera is lavender blue. One flat surface has one even colour across it; where the colour changes, the surface turns. Image 4 is only a guide for shape: never copy its colours into the picture.";

// 光の出し方。
//   soft   … 今の既定。明るく柔らかい光。2026-11-26 の試し生成が暗かったので、暗くつぶさない文を入れている。
//   sunlit … 窓から直射日光が入り、窓の形の日だまりと家具のはっきりした影が落ちる見た目。
//            2026-11-27 に利用者から「候補で出していた時のような、光がよく差し込み複雑な陰影ができる見た目の方が映える」と
//            言われて足した。既定をどちらにするか（または表現の選択肢にするか）は利用者の決定待ち。
//            それまでは API の欄を増やさず、Worker の環境変数 AI_RENDER_LIGHTING でだけ切り替える（試しのため）。
export const RENDER_LIGHTINGS = Object.freeze(["soft", "sunlit"]);
export function isRenderLighting(v) {
  return typeof v === "string" && RENDER_LIGHTINGS.includes(v);
}

const LIGHT_LINES = Object.freeze({
  soft: Object.freeze({
    interior: "- Bright natural daylight coming through the windows and openings, a bright and airy exposure with soft fill light, at least as bright as image 1, so the room is well lit and no area is murky or underexposed. Clean, slightly warm white balance with no grey or dull cast.",
    exterior: "- Bright natural daylight, a clear sky and a bright, well balanced exposure, with soft realistic shadows.",
    shadow: "- Soft realistic shadows and ambient occlusion, real material texture (timber grain on wooden parts, plaster, fabric weave, glass, metal).",
  }),
  sunlit: Object.freeze({
    interior: "- Lighting: a clear sunny day with the sun fairly low and strong. Direct sunlight streams in through the windows and openings shown in image 1 and lands inside the room as crisp, sharp-edged patches of sun that copy the shape of those windows (slanted parallelograms divided by the frame and glazing bars), reaching well into the room across the floor and, where they reach, up the walls and over the furniture. The sun patches are clearly the brightest areas of the floor. Every piece of furniture in the light casts a clear, well-defined shadow on the floor, pointing away from the window that lights it, and chair legs and table legs cast thin shadow lines across the sun patches. Each surface sits at its own brightness: sunlit patches, lit walls, walls turned away from the sun and the ceiling all differ, with smooth gradients as the light falls off deeper into the room. This direct sunlight takes priority over any soft-light wording in the style. Shadows stay open and luminous, filled by daylight bouncing off the floor and walls, so detail and the true colour of every surface stay readable in the shade: nothing turns black or murky, and the sunlit patches are bright but never blown out to pure white. Neutral to slightly warm white balance. Sunlight only lights and shades what image 1 already shows: it does not repaint any surface (a beige, grey or tinted ceiling or wall keeps that colour and does not turn white) and it does not change the framing (show exactly what image 1 shows, edge to edge, from the same spot; the sun patches fall inside that same frame).",
    exterior: "- A clear sunny day with the sun to one side: crisp, well-defined shadows cast by the building on the ground and on its own facades (under the eaves, balconies and window reveals), sunlit faces bright but not blown out to white, and shaded faces still open and readable in their true colour, never black.",
    shadow: "- Contact shadows and ambient occlusion where objects meet the floor and walls, real material texture (timber grain on wooden parts, plaster, fabric weave, glass, metal).",
  }),
});

// 指示文。preset と view と、4 枚目（法線）を添えるか（withNormal）と、光の出し方（lighting）だけを受け取る
// （ほかの欄を渡されても読まない。lighting が知らない値なら soft）。
export function buildRenderPrompt({ preset, view, withNormal = false, lighting = "soft" }) {
  if (!isRenderPreset(preset)) throw new Error("unknown preset");
  if (!isRenderView(view)) throw new Error("unknown view");
  const p = PRESETS[preset];
  const interior = view === "interior";
  const light = LIGHT_LINES[isRenderLighting(lighting) ? lighting : "soft"];
  const subject = interior ? "the interior of a modern Japanese house" : "the exterior of a modern Japanese house and its site";
  const normal = withNormal === true;
  const lines = [
    `Image 1 is a 3D render of ${subject}. Image 2 is its depth map (darker = nearer, lighter = farther). Image 3 is its outline map (the edges of every designed element).` +
      (normal ? " " + NORMAL_GUIDE_LINE : ""),
    `Turn image 1 into a finished ${p.painterly ? "illustration" : "photograph"} of the same scene. Style: ${p.style}.`,
    "This is a lighting and material pass over image 1, not a redesign. The colours in image 1 are the real paint and finish colours the owner chose: keep the hue and lightness of every surface and only add realistic light, shade and texture.",
    "",
    "Keep the design exactly as it is:",
    "- Same camera, perspective, framing, horizon and crop as image 1. Do not zoom out, widen the view or reveal anything beyond the edges of image 1.",
    // 2026-11-27 の本物の生成で「吹き抜け上部の傾いた天井が平らな天井と下がり壁に置き換わった」と見えたが、のちに 3D を調べると
    // 既定の 2 階建ての 1 階 LDK の天井は平らで、傾いて見えたのは平らな天井が吹き抜けへ切れる縁を下から斜めに見た線だった。
    // それでも、傾いた天井や吹き抜けのあるプランで形を保たせるため、この文は残している。
    // 1 枚目の天井は陰の無い一色の面なので、形は輪郭（3 枚目）と深度（2 枚目）から読ませる。
    (normal
      ? "- The ceiling is part of the design. Its shape comes from images 1, 2, 3 and 4 together: follow its edges in image 3, its depth in image 2 and its tilt in image 4. The tilt of every ceiling and wall follows image 4: a ceiling area whose colour in image 4 differs from a flat ceiling's purple is sloped, and stays sloped at that angle. A ceiling"
      : "- The ceiling is part of the design. Its shape comes from images 1, 2 and 3 together: follow its edges in image 3 and its depth in image 2. A ceiling") +
      " surface that is one continuous plane in image 1 stays one continuous plane with the same tilt: a sloped ceiling stays sloped at the same angle and meets the walls along the same lines, a high or double-height ceiling (a void open to the floor above) stays high and open. Never flatten a sloped or stepped ceiling into a flat one, and never split it into a flat ceiling plus a dropped wall (bulkhead or soffit) or a recessed void. Do not add a beam, a step or any ceiling edge that is not in image 3; keep the steps and beams that are there. Wherever a wall meets the ceiling in image 1, it meets it directly along that same line: do not insert a vertical band of wall, a soffit face or a recess between the top of a wall and the ceiling.",
    "- Every wall, ceiling, floor boundary, window, door, opening, stair, built-in fixture, appliance and piece of furniture stays at the same position, size, shape and count as in image 1. Count the chairs, windows and doors in image 1 and keep exactly that many.",
    "- Do not add, remove, move, resize, merge or split anything. Do not replace an object with a different kind of object.",
    "- Every wall keeps each corner and jog where it turns at the same place as in image 1. Do not straighten a wall or add a new corner.",
    "- Objects cut off at the edges of image 1 (a door, a window, a wall, a piece of furniture), even a thin sliver of a frame, stay in the picture, cut off at the same place.",
    "- Keep the type of every fixture and appliance: an induction (IH) cooktop stays a flat induction cooktop, a range hood stays the same hood, a refrigerator stays a refrigerator.",
    "- Keep the colour of every surface as in image 1. Doors keep exactly their colour in image 1: a pale cream or yellow painted door stays pale cream or yellow and never becomes wood. Each wall keeps its own colour: a wall painted a different colour from the others (an accent wall) stays that colour and does not turn white. Window frames keep their colour and style (dark frames stay dark, sliding windows stay sliding). Floors, worktops, cabinets and fabrics keep their colour and material.",
    normal
      ? "- Use images 2, 3 and 4 to keep every outline, the depth order and the direction of every surface aligned with image 1."
      : "- Use images 2 and 3 to keep every outline and the depth order aligned with image 1.",
    "",
    "Improve only light and material realism:",
    interior ? light.interior : light.exterior,
    light.shadow,
    p.painterly
      ? "- A painterly treatment is intended, but it must not move, blur away or invent any edge shown in image 3."
      : "- Crisp, photographic detail. Avoid painterly or illustration looks.",
    "",
    "Never add people, animals, vehicles, plants, decorative props, text, logos, signatures or watermarks.",
    // 図面にあるダウンライトは 3D の絵（1 枚目）には写らず、輪郭（3 枚目）にだけ小さな輪として出る（2026-11-27 に確かめた）。
    // 「ダウンライトを足すな」とだけ書くと 3 枚目と食い違うので、3 枚目に描かれた照明はその位置に小さく描いてよい、とする。
    "Never add ceiling or wall equipment that neither image 1 nor image 3 shows: no smoke detectors, no ceiling lights, no light switches, no power sockets or outlets, no vents, air-conditioner units or sprinkler heads. A light fitting that image 3 draws on the ceiling (for example a small ring for a downlight) may be shown at exactly that spot as a small fitting of that size; add no downlights or recessed lights anywhere else. Plain ceiling and wall surfaces stay plain.",
  ];
  return lines.join("\n");
}
