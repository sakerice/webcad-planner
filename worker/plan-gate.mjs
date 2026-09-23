// 読み取りのあと「見直しをもう一度払うか」を決める門。
//
// なぜ在るのか
// ------------
// 読み取り(¥40/ページ)のあと、**必ず**見直し(¥40/ページ)を投げていた。
// 見直しは上積みで、直すところが無ければ同じJSONがそのまま返る。つまり
// 直しどころの無いページでは、¥40 を確実に捨てていた。1日の取り込み回数が
// 5回に絞られているのは、この倍額がそのまま効いている。
//
// 何を根拠に決めるか
// ------------------
// **モデルの答えを、こちらで検算した事実に直してから渡す。** 座標や幾何を
// そのまま判断させない。寸法線の内訳が総寸法と合うか、部屋の面積合計が
// 建物の輪郭をどれだけ埋めているか、玄関ドア・階段・水まわりが在るか——
// どれも決まった計算で出る。出た事実の重みづけだけを Jev に任せる。
//
// 当たり方（実測、jev-1.13.0。**このファイルが作る形の state** で測った値）
// ------------------------------------------------------------------------
//                          1階(素直)  2階(素直)  1階(壊した)
//   consistent                0.76      0.57       0.28
//   completeness(0-4)         2.68      1.74       1.02
//
// 壊した側は、左辺の寸法線が総寸法 9100 に対し内訳の和 7280、部屋が建物の
// 輪郭の48%しか埋めない、トイレが無い、という読み取り。
//
// **素直な2階が、素直な1階よりだいぶ低く出る。** 2階には玄関も水まわりも
// 無く、拠り所が少ないためと思われる。ここを通そうと境目を下げると、壊した
// 側との差が 0.7 段しか残らない。**下げない。** 2階では見直しを払う。
//
// この3例は手で作ったものなので、**当たりの粗さを示すだけで、本番の分布では
// ない。** 返事にはページごとの consistent / completeness をそのまま載せて
// あるので、実際の取り込みでの値を集めてから境目を引き直すこと。
//
// 聞き方で2度外した。記録として残す:
//
// 1. **「見直す価値があるか」は分かれない。** 両方 0.58〜0.85 に張り付いた。
//    見直しはいつでも「価値がある」からである。「辻褄が合っているか」と
//    いう、外から確かめられる問いに変えて分かれた。
// 2. **「欠けているものがあるか」は階で外れる。** 2階には玄関ドアも浴槽も
//    無いのが正しいのに、素直な2階で 0.58 を返した。「その階に要るものだけ
//    数えよ」と書き足しても 0.58 のまま、素直な1階まで 0.20→0.34 に悪化した。
//    **欠けているかどうかは、こちらで数えられる。** 室名と物の種類の対応は
//    決まった表で引けるので、質問ではなく事実として state に入れる。
//
// **迷ったら払う。** 境目(0.55 / 1.9)は素直な側の実測から離し、壊した側からも
// 離した位置に置いてある。少しでも怪しければ従来どおり見直す。間違った間取りを
// 渡すより、¥40 を余分に払うほうが安い。
import { jevAsk, noul, score, choice } from "./jev.mjs";

// ── 見直しの門 ──────────────────────────────────────────────────────

export const REVISE_QUESTIONS = {
  consistent: {
    type: "noul",
    instructions: "The dimension lines, the overall width and depth, and the room layout in this reading are all mutually consistent.",
  },
  completeness: {
    type: "score",
    instructions: "How complete and self-consistent is this floor-plan reading as one floor of a Japanese detached house?",
    criteria: [
      "Badly broken: rooms or dimensions clearly do not add up",
      "Several gaps or contradictions",
      "Usable but with noticeable gaps",
      "Minor gaps only",
      "Complete and self-consistent",
    ],
  },
};

// いちばん素直な側(0.76 / 2.68)の内側。**中間には置かない。**
// 迷いの出たページ(素直な2階の 0.57 / 1.74)は、従来どおり見直しを払う。
const NEED_CONSISTENT = 0.60;
const NEED_COMPLETENESS = 2.2;

const round = (v) => (Number.isFinite(v) ? Math.round(v) : null);

// 室名に対して、図面に必ず描かれる物。**この対応は決まっているので、
// 「欠けていませんか」とモデルに聞かない。** ここで数えて事実として渡す。
// 部分一致で見る（「洗面脱衣室」「ユニットバス」のような書かれ方をするため）。
const FIXTURE_FOR_ROOM = [
  { room: /浴室|バス|風呂/, item: "bath" },
  { room: /トイレ|便所|WC/i, item: "toilet" },
  { room: /洗面|脱衣/, item: "sink" },
  { room: /キッチン|台所|LDK|DK(?![A-Za-z])/i, item: "kitchen" },
];

// 寸法線の検算。総寸法と内訳の和が合っているか。
// **これはこちらで計算できる。** モデルに「合っていますか」と聞かない。
function dimensionCheck(dims) {
  if (!dims || typeof dims !== "object") return null;
  const out = {};
  for (const edge of ["top", "bottom", "left", "right"]) {
    const e = dims[edge];
    if (!e || typeof e !== "object") continue;
    const total = Number(e.total);
    const parts = (Array.isArray(e.parts) ? e.parts : []).map(Number).filter(Number.isFinite);
    if (!Number.isFinite(total) && !parts.length) continue;
    out[edge] = {
      total: round(total),
      sum_of_parts: parts.length ? round(parts.reduce((a, b) => a + b, 0)) : null,
    };
  }
  return Object.keys(out).length ? out : null;
}

function roomFacts(room) {
  const parts = Array.isArray(room && room.parts) ? room.parts : [];
  let area = 0;
  for (const p of parts) {
    const w = Number(p && p.x1) - Number(p && p.x0);
    const d = Number(p && p.y1) - Number(p && p.y0);
    if (Number.isFinite(w) && Number.isFinite(d)) area += Math.abs(w * d);
  }
  return { name: String((room && room.name) || "(名前なし)"), rects: parts.length, area_mm2: round(area) };
}

/**
 * モデルが答えた1ページぶんの JSON を、判断に要る事実だけに畳む。
 * 純粋な関数。**ここにモデルを呼ぶ処理を混ぜない**（検査できなくなる）。
 */
export function pageFacts(page, index = 0) {
  const floors = Array.isArray(page && page.floors) ? page.floors : [];
  return {
    page: index + 1,
    floors: floors.map((f) => {
      const width = Number(f && f.width), depth = Number(f && f.depth);
      const rooms = (Array.isArray(f && f.rooms) ? f.rooms : []).map(roomFacts);
      const items = {};
      for (const it of Array.isArray(f && f.items) ? f.items : []) {
        const type = it && typeof it.type === "string" ? it.type : "";
        if (type) items[type] = (items[type] || 0) + 1;
      }
      const footprint = Number.isFinite(width) && Number.isFinite(depth) ? width * depth : 0;
      const roomArea = rooms.reduce((a, r) => a + (r.area_mm2 || 0), 0);
      const floor = Number(f && f.floor) || null;
      // 室名が在るのに、その部屋に必ず描かれる物が無い組み合わせ。
      const missing = [];
      for (const { room, item } of FIXTURE_FOR_ROOM) {
        const named = rooms.filter((r) => room.test(r.name));
        if (named.length && !items[item]) missing.push({ room: named[0].name, expected_item: item });
      }
      return {
        floor,
        width: round(width),
        depth: round(depth),
        dimension_check: dimensionCheck(f && f.dims),
        rooms,
        room_area_sum_ratio_to_footprint: footprint > 0 ? Number((roomArea / footprint).toFixed(2)) : null,
        items,
        fixtures_expected_but_absent: missing,
        has_entrance_door: Boolean(items["door-front"]),
        has_stair: Boolean(items.stair || items["stair-corner"]),
      };
    }),
    // モデル自身が「読めなかった」と言っていることは、判断の材料として強い。
    model_notes: (Array.isArray(page && page.notes) ? page.notes : []).slice(0, 10).map(String),
  };
}

/**
 * 答えから「このページは見直すか」を決める。純粋な関数。
 * 答えが無い・型が欠けているときは **見直す**（=これまでの動き）。
 */
export function reviseDecision(answers) {
  const c = noul(answers, "consistent");
  const s = score(answers, "completeness");
  if (c === null || s === null) {
    return { revise: true, reason: "no_answer", consistent: c, completeness: s };
  }
  const clean = c >= NEED_CONSISTENT && s >= NEED_COMPLETENESS;
  return {
    revise: !clean,
    reason: clean ? "clean" : c < NEED_CONSISTENT ? "inconsistent" : "incomplete",
    consistent: Number(c.toFixed(2)),
    completeness: Number(s.toFixed(2)),
  };
}

/**
 * ページごとに見直しの要否を決める。
 *
 * env.AI が無い / 判断が得られない / AI_REVISE_GATE=off なら、全ページ
 * 「見直す」を返す。**門が働かないときは、門が無かった頃と同じ動きになる。**
 *
 * AI_REVISE_GATE=shadow のときは判断だけして、要否は常に「見直す」にする。
 * 較正のために、実際に見直しで何件直ったかと突き合わせたいとき用。
 */
export async function reviseAdvice(pages, env, deps = {}) {
  const list = Array.isArray(pages) ? pages : [];
  const mode = String((env && env.AI_REVISE_GATE) || "on").toLowerCase();
  const always = list.map((_, i) => ({ page: i + 1, revise: true, reason: "gate_off" }));
  if (!list.length || mode === "off") return { mode: "off", pages: always, skipAll: false };

  const judged = await Promise.all(list.map(async (page, i) => {
    const answers = await jevAsk(env, { state: pageFacts(page, i), questions: REVISE_QUESTIONS }, deps);
    return { page: i + 1, ...reviseDecision(answers) };
  }));

  if (mode === "shadow") {
    return { mode: "shadow", pages: judged.map((p) => ({ ...p, revise: true, shadow: !p.revise })), skipAll: false };
  }
  return { mode: "on", pages: judged, skipAll: judged.every((p) => !p.revise) };
}

// ── 失敗したときの、次の一手 ────────────────────────────────────────
//
// これまでの文面は、エラーの種類と HTTP のステータスから決め打ちだった。
// ai_bad_response はどんな原因でも「図面がはっきり写るように囲み直して
// ください」になる。実際の原因は、囲みが広すぎる・狭すぎる・そもそも平面図が
// 写っていない・画像が小さすぎる、と別物である。
//
// **文面は Jev に書かせない（書けない）。** こちらが用意した行動の中から
// 1つ選ばせるだけなので、画面に出る日本語は最後までこちらの管理下にある。
// 選択肢に無ければ unknown が返り、これまでの文面に戻る。

export const NEXT_STEP_QUESTION = {
  next_step: {
    type: "choice",
    instructions: "A floor-plan drawing was sent to a reading model and the result could not be used. Which single action is most likely to make the next attempt succeed?",
    criteria: {
      recrop_tighter: "Only the floor plan should be selected: the image also contains elevations, perspectives, title blocks or several drawings",
      recrop_wider: "The selection cut off part of the floor plan, including its dimension lines; a wider selection is needed",
      single_page: "Too many pages were sent at once; sending one page at a time would work better",
      better_scan: "The image is too small or too blurred for the line work and dimension figures to be read",
      not_a_floorplan: "The image does not contain a floor plan at all",
      too_complex: "The plan itself is outside what this reader can express (curved or angled walls, split levels, very unusual shapes)",
      retry: "Nothing is wrong with the input; the attempt simply failed and should be repeated",
      unknown: "There is not enough information to tell",
    },
  },
};

/**
 * 失敗の状況を、判断に要る事実だけに畳む。純粋な関数。
 * **画像そのものは渡さない**（Jev は画像を受け取れない。1.13.0 時点で
 * 入力はテキストのみ）。渡すのは、こちらが既に数えている事実だけ。
 */
export function failureFacts({ error, pageCount, imageBytes, mimeTypes, problems, pages } = {}) {
  const facts = {
    failure: String(error || "unknown"),
    pages_sent: Number(pageCount) || 0,
    image_bytes: (Array.isArray(imageBytes) ? imageBytes : []).map((n) => Number(n) || 0).slice(0, 8),
    image_types: [...new Set((Array.isArray(mimeTypes) ? mimeTypes : []).map(String))],
  };
  if (Array.isArray(problems) && problems.length) facts.schema_problems = problems.slice(0, 20).map(String);
  if (Array.isArray(pages) && pages.length) {
    facts.reading = pages.slice(0, 8).map((p, i) => {
      const f = pageFacts(p, i);
      return {
        page: f.page,
        floors: f.floors.map((fl) => ({
          floor: fl.floor,
          width: fl.width,
          depth: fl.depth,
          room_names: fl.rooms.map((r) => r.name),
          items: fl.items,
        })),
        model_notes: f.model_notes,
      };
    });
  }
  return facts;
}

/**
 * 次の一手を1つ選ぶ。選べなければ null（呼ぶ側はこれまでの文面に戻る）。
 */
export async function nextStep(facts, env, deps = {}) {
  const answers = await jevAsk(env, { state: facts, questions: NEXT_STEP_QUESTION }, deps);
  const picked = choice(answers, "next_step");
  if (!picked || picked === "unknown") return null;
  const a = answers.next_step;
  const confidence = typeof a.confidence === "number" ? a.confidence : null;
  // 確信の薄い助言は、外れたときに利用者を遠回りさせる。**黙っているほうがよい。**
  if (confidence !== null && confidence < 0.3) return null;
  return { step: picked, confidence };
}
