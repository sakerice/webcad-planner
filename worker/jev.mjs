// Jev（TypeSafe の System One モデル）を Worker から呼ぶ薄い層。
//
// なぜ在るのか
// ------------
// 読み取りの周りには「文章は要らないが、判断は要る」場所がある。見直しに
// もう一度 ¥40 を払うか。失敗の原因はどれか。どちらも答えは決まった型に
// 収まるもので、文章を書かせる必要がない。
//
// Jev は文章を書かない。返すのは3つだけ:
//   choice … 提示した選択肢から1つ（確率つき）
//   score  … 段階の期待値（0 〜 段数-1。確率つき）
//   noul   … 真である確率（0〜1）
//
// **提示していない選択肢は返ってこない。** 実行に使う値がこちらの列挙の中に
// 収まるので、返事を解釈し直す工程が要らない。ハルシネーションが混ざる
// 余地もない。
//
// 費用と速さ: 入力 $0.042/1M、**出力は無料**。実測 230〜900ms。
// 見直し1ページ ¥40 に対して、この判断は1回 ¥0.02 に満たない。
//
// **鍵が要らない。** Cloudflare の Workers AI バインディング（env.AI）経由で
// 呼ぶので、この Worker に新しい秘密が増えない。送り先も増えない——間取りは
// 既に R2 と Durable Objects、つまり Cloudflare の中にある。
//
// **質問文は英語で書く。** 公式ドキュメントに "English is the primary
// training language and where accuracy is currently best"、CJK は
// "handled but not equally well" とある。state には日本語の室名がそのまま
// 入る（そこは変えようがない）が、こちらで決められる質問文まで日本語に
// する理由は無い。
//
// **失敗しても呼び出し元を止めない。** ここが返すのは「答え」か null で、
// 例外は投げない。判断が得られなければ、呼ぶ側は判断が無かった頃の動きに
// 戻ればよい。判断のために読み取りを失うのは本末転倒である。

// state は判断に要る事実だけを入れる想定なので、これを超えたら作り方が
// おかしい。32,000トークンの予算に当てる前に、手前で気づけるようにする。
const MAX_STATE_BYTES = 16 * 1024;
// 判断は上積みなので、待つのは短くてよい。実測の最悪が900msだった。
const TIMEOUT_MS = 6000;

export const JEV_MODEL = "typesafe/jev";

export function jevAvailable(env) {
  return Boolean(env && env.AI && typeof env.AI.run === "function");
}

// 返事は経路によって包み方が違う。REST は Cloudflare の封筒と AI Gateway の
// 封筒で二重に包む。バインディングは中身をそのまま返す。どちらでも開けるよう、
// answers を持つ層まで潜る。
function unwrap(body) {
  let node = body;
  for (let depth = 0; depth < 4; depth++) {
    if (node && typeof node === "object" && node.answers) return node.answers;
    if (node && typeof node === "object" && node.result) { node = node.result; continue; }
    return null;
  }
  return null;
}

// 返ってきたものを検める。
//
// Jev は型を外さない作りだが、**そのまま信じる理由にはならない**。ここの
// 目的は、提示していない選択肢をこちらの実行に使わせないこと。1つでも
// 噛み合わなければ、答え全体を捨てる（半端に使うほうが危ない）。
function checkAnswers(questions, answers) {
  if (!answers || typeof answers !== "object") return false;
  for (const [name, q] of Object.entries(questions)) {
    const a = answers[name];
    if (!a || typeof a !== "object") return false;
    if (q.type === "choice") {
      if (!Object.keys(q.criteria).includes(a.choice)) return false;
    } else if (q.type === "score") {
      if (typeof a.score !== "number" || !Number.isFinite(a.score)) return false;
    } else if (q.type === "noul") {
      if (typeof a.noul !== "number" || !(a.noul >= 0 && a.noul <= 1)) return false;
    } else {
      return false;
    }
  }
  return true;
}

/**
 * Jev に1回聞く。判断が得られなければ null を返す（例外は投げない）。
 *
 * @param {object} env                Worker の env。env.AI が無ければ null を返す。
 * @param {object} args
 * @param {object|string} args.state  判断の対象。**指示ではなくデータとして扱われる。**
 * @param {object} args.questions     { 名前: {type, instructions, criteria} }
 * @param {object} [deps]             { aiRun } で差し替えられる（検査用）。
 * @returns {Promise<object|null>}    answers か null
 */
export async function jevAsk(env, { state, questions } = {}, deps = {}) {
  const run = deps.aiRun || (jevAvailable(env) ? (...a) => env.AI.run(...a) : null);
  if (!run) return null;
  if (!questions || typeof questions !== "object" || !Object.keys(questions).length) return null;

  const text = typeof state === "string" ? state : JSON.stringify(state);
  if (new TextEncoder().encode(text).byteLength > MAX_STATE_BYTES) return null;

  try {
    const body = await Promise.race([
      run(JEV_MODEL, { state, questions }),
      new Promise((resolve) => setTimeout(() => resolve(null), TIMEOUT_MS)),
    ]);
    if (!body) return null;
    const answers = unwrap(body);
    return checkAnswers(questions, answers) ? answers : null;
  } catch (e) {
    return null;
  }
}

// 答えの取り出し。**欠けていたら既定値を返す。** 呼ぶ側に
// 「答えがあるか」と「その値」の2つを毎回書かせない。
export function noul(answers, name, fallback = null) {
  const a = answers && answers[name];
  return a && typeof a.noul === "number" ? a.noul : fallback;
}

export function score(answers, name, fallback = null) {
  const a = answers && answers[name];
  return a && typeof a.score === "number" ? a.score : fallback;
}

export function choice(answers, name, fallback = null) {
  const a = answers && answers[name];
  return a && typeof a.choice === "string" ? a.choice : fallback;
}
