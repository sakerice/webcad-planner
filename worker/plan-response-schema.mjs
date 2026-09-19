// AIの返事の「形」。文章でお願いするのではなく、通信の設定として縛る。
//
// なぜ在るのか
// ------------
// 出力の形をプロンプトの本文に書いていた頃、実測で位置の項目名が box_2d から
// box へ勝手に変わって返った。お願いは破られる。Vertex AI の
// generationConfig.responseSchema を使えば、形はモデルの気分ではなく API の
// 制約になる。
//
// ここが持つのは **形だけ**。項目の意味は worker/plan-spec.mjs の仕様書に、
// 読み取りの段取りは worker/plan-prompt.mjs の手順にある。description は
// どの項目かが分かる最小限にとどめ、説明を二重に持たない。
import { ALLOWED_ITEM_TYPES } from "./plan-item-spec.mjs";

const mm = (description) => ({ type: "NUMBER", description });

// 寸法線1辺ぶん。総寸法と、その内訳の並び。
const EDGE = {
  type: "OBJECT",
  description: "その辺の寸法線",
  properties: {
    total: mm("その辺の総寸法"),
    parts: {
      type: "ARRAY",
      description: "内訳",
      items: mm("内訳ひとつ"),
    },
  },
  propertyOrdering: ["total", "parts"],
};

const PART = {
  type: "OBJECT",
  description: "部屋が占める長方形",
  properties: {
    x0: { type: "NUMBER", description: "左端のx" },
    y0: { type: "NUMBER", description: "上端のy" },
    x1: { type: "NUMBER", description: "右端のx" },
    y1: { type: "NUMBER", description: "下端のy" },
  },
  required: ["x0", "y0", "x1", "y1"],
  propertyOrdering: ["x0", "y0", "x1", "y1"],
};

const ROOM = {
  type: "OBJECT",
  description: "部屋",
  properties: {
    name: {
      type: "STRING",
      description: "室名",
    },
    parts: {
      type: "ARRAY",
      description: "その部屋が占める長方形",
      items: PART,
    },
  },
  required: ["name", "parts"],
  propertyOrdering: ["name", "parts"],
};

const ITEM = {
  type: "OBJECT",
  description: "建具・階段・設備",
  properties: {
    type: { type: "STRING", enum: ALLOWED_ITEM_TYPES, description: "種類" },
    x: mm("中心のx"),
    y: mm("中心のy"),
    w: mm("幅"),
    d: mm("奥行き"),
    rot: mm("回転角(度)"),
  },
  required: ["type", "x", "y", "w"],
  propertyOrdering: ["type", "x", "y", "w", "d", "rot"],
};

const FLOOR = {
  type: "OBJECT",
  description: "1つの階",
  properties: {
    floor: {
      type: "INTEGER",
      description: "階数",
    },
    dims: {
      type: "OBJECT",
      description: "寸法線",
      properties: { top: EDGE, bottom: EDGE, left: EDGE, right: EDGE },
      propertyOrdering: ["top", "bottom", "left", "right"],
    },
    width: {
      type: "NUMBER",
      description: "建物の総幅",
    },
    depth: {
      type: "NUMBER",
      description: "建物の総奥行き",
    },
    rooms: {
      type: "ARRAY",
      description: "この階の部屋",
      items: ROOM,
    },
    items: { type: "ARRAY", description: "この階の建具・階段・設備", items: ITEM },
  },
  required: ["floor", "width", "depth", "rooms"],
  propertyOrdering: ["floor", "dims", "width", "depth", "rooms", "items"],
};

export const PLAN_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    floors: {
      type: "ARRAY",
      description: "階ごとの読み取り結果",
      items: FLOOR,
    },
    notes: {
      type: "ARRAY",
      description: "読み取りの記録",
      items: { type: "STRING" },
    },
  },
  required: ["floors"],
  propertyOrdering: ["floors", "notes"],
};
