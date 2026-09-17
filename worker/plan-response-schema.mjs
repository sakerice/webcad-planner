// AIの返事の「形」。文章でお願いするのではなく、通信の設定として縛る。
//
// なぜ在るのか
// ------------
// これまで出力の形はプロンプトの本文に書いていた。つまり**お願い**だった。
// 実測で、位置の項目名が box_2d から box へ勝手に変わって返ったことがある。
// お願いは破られる。Vertex AI の generationConfig.responseSchema を使えば、
// 形はモデルの気分ではなく API の制約になる。
//
// もうひとつの狙いは、**項目の意味をプロンプトの本文から追い出す**こと。
// 「x,y は開口の中心です」といった説明は、本文に長々と書くと手順が読みにくく
// なるうえ、項目と説明が離れて食い違う。description に書けば項目に貼り付く。
//
// 形は「階ごとの入れ子」にしてある。読み取りの手順が階ごとのくり返しなので、
// 出力もそのとおりの形にするほうが、モデルにとっても素直になる。
import { ALLOWED_ITEM_TYPES } from "./plan-item-spec.mjs";

const mm = (description) => ({ type: "NUMBER", description });

// 寸法線1辺ぶん。総寸法と、その内訳の並び。
const EDGE = {
  type: "OBJECT",
  description: "その辺の寸法線。総寸法と内訳",
  properties: {
    total: mm("その辺の総寸法(mm)。いちばん外側の寸法線の数値"),
    parts: {
      type: "ARRAY",
      description: "内訳の数値を、左から(縦の辺なら上から)順に並べたもの。合計は total と一致すること",
      items: mm("内訳ひとつ(mm)。227.5 や 1137.5 のような .5 で終わる値もそのまま入れる"),
    },
  },
  propertyOrdering: ["total", "parts"],
};

const WALL = {
  type: "OBJECT",
  description: "壁1枚。芯線(壁の中心を通る線)の線分で表す",
  properties: {
    x1: mm("始点のx(mm)"),
    y1: mm("始点のy(mm)"),
    x2: mm("終点のx(mm)"),
    y2: mm("終点のy(mm)"),
    thick: mm("壁の厚み(mm)。図に書かれていなければ外周も間仕切りも 120"),
  },
  required: ["x1", "y1", "x2", "y2"],
  propertyOrdering: ["x1", "y1", "x2", "y2", "thick"],
};

const LABEL = {
  type: "OBJECT",
  description: "図に書かれている室名の文字と、その文字がある位置",
  properties: {
    text: {
      type: "STRING",
      description: "図に書かれているとおりの室名。畳数の表記((4.5帖)など)は含めない。読めない文字は出さない",
    },
    x: mm("その文字の中心のx(mm)"),
    y: mm("その文字の中心のy(mm)"),
  },
  required: ["text", "x", "y"],
  propertyOrdering: ["text", "x", "y"],
};

const ITEM = {
  type: "OBJECT",
  description: "建具・階段・水まわりの設備のひとつ",
  properties: {
    type: { type: "STRING", enum: ALLOWED_ITEM_TYPES, description: "ものの種類" },
    x: mm("**中心**のx(mm)。左上の角ではない"),
    y: mm("**中心**のy(mm)。左上の角ではない"),
    w: mm("幅(mm)。壁に沿う向きの長さ。建具なら開口の幅"),
    d: mm("奥行き(mm)。壁に直交する向きの長さ。建具は壁の厚みぶん程度でよい"),
    rot: mm("回転(度)。0で幅が東西を向く。建具は壁から自動で決まるので省略してよい"),
  },
  required: ["type", "x", "y", "w"],
  propertyOrdering: ["type", "x", "y", "w", "d", "rot"],
};

const FLOOR = {
  type: "OBJECT",
  description: "1つの階。平面図1枚ぶん",
  properties: {
    floor: {
      type: "INTEGER",
      description: "何階か。1階なら1、2階なら2。図の見出し(「1階平面図」など)で判断する",
    },
    dims: {
      type: "OBJECT",
      description: "読み取った寸法線。4辺それぞれ。読めない辺は省く",
      properties: { top: EDGE, bottom: EDGE, left: EDGE, right: EDGE },
      propertyOrdering: ["top", "bottom", "left", "right"],
    },
    walls: { type: "ARRAY", description: "この階の壁。外周と間仕切りの両方", items: WALL },
    labels: { type: "ARRAY", description: "この階に書かれている室名。範囲は出さない", items: LABEL },
    items: { type: "ARRAY", description: "この階の建具・階段・水まわりの設備", items: ITEM },
  },
  required: ["floor", "walls"],
  propertyOrdering: ["floor", "dims", "walls", "labels", "items"],
};

export const PLAN_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    floors: {
      type: "ARRAY",
      description: "階ごとの読み取り結果。図にある階の数だけ並べる",
      items: FLOOR,
    },
    notes: {
      type: "ARRAY",
      description:
        "読めなかったところ、他の情報から補って決めたところを、日本語で1行ずつ。" +
        "補ったものは「何を、何から、どう決めたか」を書く",
      items: { type: "STRING" },
    },
  },
  required: ["floors"],
  propertyOrdering: ["floors", "notes"],
};
