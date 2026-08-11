#!/usr/bin/env python3
"""判定結果を、ユーザーに見せる日本語1〜3行へ落とす（設計 §10）。

    「判定器をそのまま見せない。『間取りは保たれています / 一部の建具が
      変化しています』程度の要約に落とす」

`report.evaluate()` が返した dict をそのまま渡す。判定はここで一切やり直さない
——閾値の比較は `evaluate` にしか無い。ここがやるのは **言い換え** だけである。
数字を作り直す実装にすると、要約と本体の判定が別々に育って食い違う。

## 階層ごとに言い分ける

  LOCKED  壁・窓・建具・屋根・床。**変わったら重大。** 一行目でそう言う。
  SOFT    設備機器・家具。在るべきだが描画は変わってよい。別の行に、
          「許容範囲」と分かる言葉で置く。LOCKED の行に混ぜない。
  FREE    生成側が足したもの（人・食事・本・マグ）。**一行も書かない。**
          減点しないものを要約で話題にすると、読む側は減点されたと読む。

## 「測れなかった」を「問題なし」と言わない

これがこのモジュールの一番の仕事である。判定器には既に検証不能という段が
あり（真値レンダにエッジが無い、パッケージが階層を持たない、参照が仕上げを
見せられなかった）、そこを丸めて「問題ありません」と書くと、**調べた結果
大丈夫だったのか、調べられなかったのかが読者から消える。**

  検証不能 0 件          「間取りは保たれています。」
  検証不能あり・PASS     「確かめられた範囲では間取りは保たれています。
                          ただし N 件は確かめられていません。」
  検証不能で FAIL        「判定できませんでした。」——「変わっています」とは
                          言わない。変わったと分かったわけではないからである。
"""
import re

# `report.evaluate` が組み立てる指摘文の頭。ここだけを読む。
# 例) LOCKED category 'walls' (walls: exterior ...) silhouette recall ...
#     LOCKED instance 'lattice-screen#35' (category 'exterior') recall ...
#     LOCKED finish: instance 'stair#22' (category 'furniture') colour ...
_REASON = re.compile(r"^(LOCKED|SOFT)(?: (finish):)? (category|instance) '([^']+)'")

# 判定不能そのものを理由に落ちたときの印。`evaluate` が index -1 で足す1件。
UNVERIFIABLE_INDEX = -1

# LOCKED カテゴリの日本語。部材名（`type#id`）はアプリが付けた識別子なので
# 訳さずそのまま出す——訳語表をここに置くと、アプリ側に種別が増えた日に
# 要約だけが古い言葉で語る。カテゴリは5つで固定なのでここに持つ。
CATEGORY_JA = {
    "walls": "壁",
    "windows": "窓",
    "doors": "建具・開口",
    "roof": "屋根",
    "rooms": "床",
    "fixtures": "設備機器",
    "furniture": "家具",
}


def _findings(entries):
    """[{index, reasons}] -> [(tier, kind, name)]。フレームの重複は畳む。"""
    out, seen = [], set()
    for entry in entries or []:
        for reason in entry.get("reasons") or []:
            m = _REASON.match(reason)
            if not m:
                continue
            tier, finish, kind, name = m.group(1), m.group(2), m.group(3), m.group(4)
            key = (tier, finish, kind, name)
            if key in seen:
                continue
            seen.add(key)
            out.append({"tier": tier, "finish": bool(finish), "kind": kind, "name": name})
    return out


def _name_list(findings, limit=3):
    """指摘された部材・カテゴリを日本語で並べる。多いときは「ほか N 件」。"""
    labels = []
    for f in findings:
        label = CATEGORY_JA.get(f["name"], f["name"]) if f["kind"] == "category" else f["name"]
        if label not in labels:
            labels.append(label)
    if not labels:
        return ""
    if len(labels) <= limit:
        return "・".join(labels)
    return "・".join(labels[:limit]) + f" ほか{len(labels) - limit}件"


def _real_locked_failures(result):
    """検証不能率だけを理由にした1件を除いた、本当の LOCKED 指摘。"""
    return [f for f in (result.get("locked") or {}).get("failures", [])
            if f.get("index") != UNVERIFIABLE_INDEX]


def _unverifiable_only(result):
    """LOCKED が落ちた理由が「確かめられた範囲が足りない」だけかどうか。"""
    failures = (result.get("locked") or {}).get("failures", [])
    return bool(failures) and not _real_locked_failures(result)


def unverifiable_sentence(result):
    """検証不能を述べる1文。1件も無ければ空文字。

    **PASS のときこそ必要な文である。** 「確かめられた範囲では」と付けずに
    「保たれています」と言い切ると、測れなかった部分まで保証したことになる。
    """
    uv = result.get("unverifiable") or {}
    count = uv.get("count") or 0
    if not count:
        return ""
    total = uv.get("total_checks") or 0
    return (f"ただし{count}件（検査{total}件中）は確かめられていません。"
            "問題が無かったのではなく、測れていません。")


def summarise(result):
    """判定結果 -> 日本語1〜3行のリスト。

    行数は 1〜3。判定器の生の数字は1つも出さない（件数だけは出す——「何件
    確かめられなかったか」は言葉に置き換えられない）。
    """
    verdict = result.get("verdict")
    locked = _findings(_real_locked_failures(result))
    soft = _findings((result.get("soft") or {}).get("findings"))
    uv_line = unverifiable_sentence(result)

    lines = []
    if verdict == "FAIL" and _unverifiable_only(result):
        # 変わったと分かったわけではない。**「変わっています」と書かない。**
        lines.append("判定できませんでした。確かめられた範囲が足りず、"
                     "間取りが保たれているとは言えません。")
        if uv_line:
            lines.append(uv_line)
        return lines

    if verdict == "FAIL":
        names = _name_list(locked)
        lines.append("間取りが変わっています。"
                     + (f"{names}に、設計と違うところがあります。" if names else
                        "設計と違うところがあります。")
                     + "壁の長さや建具は変えてはならない部分です。")
    elif verdict == "SOFT_REGRESSION":
        lines.append("間取り（壁・窓・建具・屋根・床）は保たれています。")
    else:
        lines.append("間取り（壁・窓・建具・屋根・床）は保たれています。"
                     if not uv_line else
                     "確かめられた範囲では、間取り（壁・窓・建具・屋根・床）は保たれています。")

    if soft:
        names = _name_list(soft)
        lines.append((f"{names}の見え方が変わっています。" if names else
                      "一部の設備・家具の見え方が変わっています。")
                     + "間取りではないので、ここは許容範囲です。")

    if uv_line:
        lines.append(uv_line)
    return lines[:3]


def summary_text(result):
    """`summarise` を1つの文字列に。改行区切り。"""
    return "\n".join(summarise(result))
