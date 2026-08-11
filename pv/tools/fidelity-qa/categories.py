#!/usr/bin/env python3
"""カテゴリ別の忠実度判定。「何がどう変わったか、それは有益か」を出す層。

Layer 3 の旧実装は差分を一律に減点した。壁が消えたことと、テーブルにマグ
カップが増えたことが同じ罰則になっていた。ユーザーの要求はそうではない:

    間取りに関わる壁の長さや建具などは変更してはなりません。しかし、人が
    歩いたり食事が置かれていることは生活の想定を示す良い変化です。何がどう
    変わっていてそれが目指す高品質なファサードを作成するのに対して有益か
    どうかです。

そこで製品が既に出しているカテゴリ・セグメンテーション（index.html の
`aiSegmentationLegend()`）を使い、画素をティアに分ける。

  LOCKED  壁・窓/ガラス・建具/開口・屋根・部屋の床スラブ。
          間取りを定義する構造。消失も変位も失敗であり、どのカテゴリの
          どこで起きたかを名指しする。
  SOFT    設備機器・家具。設計上そこに在るべきだが、描画のされ方
          （張地、木目、影、わずかな見え方の差）は変わってよい。
          独自の閾値で別枠報告し、LOCKED の判定を汚さない。
  CONTEXT 敷地外の文脈（隣家・道路・電柱・外構・地面・空）。カメラは
          屋内なので基本的に写らない。報告のみで判定しない。
  FREE    真実側のどのカテゴリにも対応物を持たない、生成側が足した構造。
          **一切減点しない。** 量と位置を測って言葉で述べるだけにする。
          人が歩いている、食事が置かれている、本が開かれている——これらは
          生活の想定を示す良い変化であり、罰する対象ではない。

## なぜ「カテゴリ境界に限定した」エッジを LOCKED の基準にするのか

真実ベースレンダのエッジ地図には2種類のものが混ざっている。

  a) 構造の輪郭 — 壁と床の取り合い、窓枠、建具の見付け。これは間取りが
     変われば必ず動く。
  b) 陰影のディテール — 壁面に落ちた家具の影、間接光のグラデーション、
     木目。これは Layer 2 が **変えてよい**、というより変えるために存在
     する領域である。

旧実装は両者を区別せず一括で recall を測っていたため、正しくリライトした
だけの生成が壁 recall 0.5〜0.7 まで落ちた（実測: gen-2505 / gen-8398）。
つまり「照明が変わった」と「壁が消えた」が同じ数値に化けていた。

そこで LOCKED/SOFT の recall は、ベースレンダのエッジのうち **そのカテゴリ
自身のシルエット（セグメンテーション領域の境界）に乗っているものだけ** を
参照する。これは常にベースレンダのエッジの部分集合なので、

  - 「どのシェーディング済みレンダにも写らない境界を要求しない」という
    既存の正しさ（`edge/` 線画を基準にしない理由）はそのまま保たれる。
  - ピクセル完全な生成は依然として全カテゴリで 1.000 になる（実測）。

一方で陰影だけの変化は分母から外れるので、リライトで不当に落ちなくなる。

## 「捏造」側の再定式化（旧 precision の置き換え）

旧 precision は「生成側のエッジのうち真実に対応物があるもの」の割合であり、
新しい要素が増えるほど下がった。マグカップや人物を描くと点が下がる——
これは product が求めるものと逆向きである。

置き換えるのは **contradiction（矛盾）** である。

    contradiction(C) = |unexplained ∩ dilate(lost(C), r)| / |structure(C)|

    structure(C)  そのカテゴリのシルエット上にある真実ベースレンダのエッジ
    lost(C)       structure(C) のうち生成側に対応が見つからなかった画素
    unexplained   生成側のエッジのうち真実ベースレンダに対応物が無い画素

意味は「そのカテゴリのシルエットが **消え、かつその跡地に真実に無い構造が
描かれている** 割合」である。すなわち置き換え・すり替えの検出。

  - マグ・本・観葉植物・膝掛けは自由空間に足されるだけで、LOCKED の
    シルエットを消さない。よって contradiction に一切寄与しない。
  - 部屋を横切る捏造壁は、床と壁の取り合い線を隠し（lost）、その位置に
    新しい輪郭を置く（unexplained）ので寄与する。
  - 壁を単に消した場合は跡地に新構造が無いので contradiction は上がらない
    が、そちらは recall が落ちて捕まる。2つの指標で消失と捏造を分担する。

### 正直な限界

1. **遮蔽と捏造は原理的に分離できない。** LOCKED のシルエットの前に立った
   人物は、捏造壁と同じく「シルエットが消え、そこに新しい輪郭がある」状態を
   作る。この指標が実際に検出しているのは「LOCKED の輪郭が別の何かに
   置き換わった」であって「壁が捏造された」ではない。床の中央に立つ人物の
   ように取り合い線を跨がない追加物は寄与しないが、壁際に立つ人物は寄与
   する。閾値は「輪郭のうち何割が置き換わったか」の量で切るしかない。
2. **自由空間に浮いた捏造構造は検出できない。** どの LOCKED シルエットも
   隠さない位置に偽の間仕切りが描かれた場合、それは FREE の追加として
   量と位置が報告されるだけで、機械的には不合格にならない。人間が読む
   ための記述はするが、判定はしない。
3. **recall はリライトに対して完全には無感ではない。** シルエット上の
   エッジであっても、生成側のコントラストが `edge_mask` の閾値を割り込めば
   検出できない。実測で gen-2505 の壁シルエット recall は 0.55〜0.73 に
   留まる。閾値は実際の生成系列の分布から決めるしかない。
"""
import numpy as np
from PIL import Image

from metrics import _legend_name, dilate

LOCKED = "locked"
SOFT = "soft"
CONTEXT = "context"
# FREE は **組み込み分類が決して出さない** 階層である。設計側 (package.json)
# が宣言したときにだけ現れ、「測らない」を意味する。CONTEXT (報告はするが
# 判定しない) とは別物: CONTEXT の部材も仕上げドリフトは測られる。
FREE = "free"

# index.html の aiSegmentationLegend() が出す色 -> (キー, ティア, 説明)。
# index.html は読み取り専用なのでここに写しを持つ。色が食い違ったら
# SEGMENTATION_LEGEND_SOURCE のコメントを頼りに手で合わせること。
SEGMENTATION_LEGEND_SOURCE = "index.html aiSegmentationLegend()"
CATEGORIES = {
    "#ff4b4b": ("walls", LOCKED, "walls: exterior and interior wall solids"),
    "#54c878": ("rooms", LOCKED, "rooms/floor slabs: interior room floor surfaces"),
    "#7b61ff": ("roof", LOCKED, "roof: all roof parts"),
    "#19c7ff": ("windows", LOCKED, "windows/glass: windows, window doors, and glazing"),
    "#ffc928": ("doors", LOCKED, "doors/openings: doors, entrance doors, and wall openings"),
    "#4f8cff": ("fixtures", SOFT, "fixtures/equipment: toilet, bath, sink, washer, fridge, kitchen"),
    "#d45cff": ("furniture", SOFT, "furniture/other placed items"),
    "#70b85f": ("exterior", CONTEXT, "exterior objects: balcony, tree, fence, car, stair, foundation"),
    "#a87948": ("neighbour", CONTEXT, "neighbouring buildings outside the designed site"),
    "#5c6370": ("road", CONTEXT, "public road and pavement outside the designed site"),
    "#f08c46": ("utility", CONTEXT, "utility infrastructure: poles"),
    "#e2ded2": ("ground", CONTEXT, "neutral outside-site context ground"),
    "#d9dde5": ("helper", CONTEXT, "unclassified helper geometry"),
    "#ffffff": ("sky", CONTEXT, "sky/background"),
}

# 判定順を安定させるための並び。dict の挿入順に依存させない。
LOCKED_KEYS = ("walls", "windows", "doors", "roof", "rooms")
SOFT_KEYS = ("fixtures", "furniture")

TIER_OF = {key: tier for (key, tier, _desc) in CATEGORIES.values()}
DESCRIPTION_OF = {key: desc for (key, tier, desc) in CATEGORIES.values()}
# 敷地表面色 (SITE_SURFACE_OPTIONS 由来) はプランごとに変わるため表に持てない。
# 未知色は "unattributed" にまとめ、CONTEXT と同じく報告のみで判定しない。
UNATTRIBUTED = "unattributed"
TIER_OF[UNATTRIBUTED] = CONTEXT
DESCRIPTION_OF[UNATTRIBUTED] = (
    "pixels whose segmentation colour is not in the known legend "
    "(plan-specific site-surface colours, and antialiasing blends on category "
    "borders) — reported, never gated")

ZONE_NAMES = (
    ("top-left", "top-centre", "top-right"),
    ("middle-left", "centre", "middle-right"),
    ("bottom-left", "bottom-centre", "bottom-right"),
)


def _rgb(hex_colour):
    h = hex_colour.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def category_masks(segmentation_png, target_size=None):
    """セグメンテーション PNG から カテゴリキー -> bool マスク を作る。

    `target_size` が与えられたら **NEAREST** で縮小してから色を読む。
    instance guide と同じ理由: セグメンテーションは平坦な ID カラーであって
    写真ではない。平滑化リサンプルは隣接カテゴリの色を混ぜ、legend のどこにも
    無い色を作り、厳密一致が何も拾わなくなる（`metrics._instance_hits` の
    ドキュストリング参照）。

    legend に無い色（プラン固有の敷地表面色、レンダラのアンチエイリアスが
    カテゴリ境界に作る中間色）は捨てずに `unattributed` へまとめる。実測では
    T91-ldk-push の 9 フレームで全画素の 0.10〜0.20% がここに落ちる。黙って
    捨てると「どのカテゴリでも無い画素」が存在しないかのような集計になる。
    """
    img = Image.open(segmentation_png).convert("RGB")
    if target_size is not None and img.size != target_size:
        img = img.resize(target_size, Image.NEAREST)
    arr = np.asarray(img)
    masks = {}
    claimed = np.zeros(arr.shape[:2], dtype=bool)
    for hex_colour, (key, _tier, _desc) in CATEGORIES.items():
        hit = np.all(arr == np.array(_rgb(hex_colour), dtype=arr.dtype), axis=-1)
        if hit.any():
            masks[key] = hit
            claimed |= hit
    rest = ~claimed
    if rest.any():
        masks[UNATTRIBUTED] = rest
    return masks


def silhouette(mask: np.ndarray) -> np.ndarray:
    """マスクの内側1画素分の縁（そのカテゴリが別のカテゴリと接する境界）。

    `mask & dilate(~mask, 1)` — 自分の画素のうち、非自分に隣接するもの。
    画像の外周は「別のカテゴリと接している」わけではないが、視野の切れ目
    なので構造の輪郭としては扱わない方が素直に見える。ただし外周を除くと
    画面端で切れた壁の輪郭が丸ごと消えて分母が痩せるため、ここでは除かない
    ——`dilate` は境界で巻き込まないので、外周画素は「外側に非自分がある」
    とは判定されない（`metrics.dilate` 参照）。結果として外周は自動的に
    シルエットに入らない。
    """
    return mask & dilate(~mask, 1)


def structure_edges(base_edges: np.ndarray, mask: np.ndarray, spread: int = 1) -> np.ndarray:
    """そのカテゴリのシルエット上にある真実ベースレンダのエッジ。

    `spread` はシルエット（1画素幅）から何画素まで広げてベースレンダの
    エッジを拾うか。`edge_mask` が境界の **両側** の画素を立てる仕様なので、
    シルエットそのものだけに限ると相手側に立ったエッジ画素を取りこぼす。
    1 で両側が入る。

    返すのは必ず `base_edges` の部分集合であり、ベースレンダに写っていない
    ものを要求することは無い。
    """
    return base_edges & dilate(silhouette(mask), spread)


def category_recall(structure: np.ndarray, generated_near: np.ndarray):
    """シルエット構造のうち、生成側に対応が見つかった割合。

    真実側のシルエット構造が空なら `None`（検証不能）。1.0 を返さないのは
    `metrics._recall_ratio` と同じ理由 — 見るべきものが無かっただけで、
    生成側の忠実さは何も保証されていない。
    """
    total = int(structure.sum())
    if total == 0:
        return None
    return int((structure & generated_near).sum()) / total


def lost_structure(structure: np.ndarray, generated_near: np.ndarray) -> np.ndarray:
    """シルエット構造のうち生成側に対応が無かった画素（消えた輪郭）。"""
    return structure & ~generated_near


def replacement_spread(radius: int) -> int:
    """消えた輪郭の「跡地」とみなす帯の幅。

    **照合半径 `radius` より必ず大きくなければならない。** `lost` の定義は
    「この画素から半径 `radius` 以内に生成側のエッジが1つも無い」である。
    したがって `dilate(lost, radius) & generated` は **構造的に必ず空** に
    なる。半径をそのまま使うと contradiction は入力に関わらず恒等的に 0.000
    になり、指標が何も測らない（実装中に実際にこの値を出した:
    T91-perfect / gen-2505 / gen-8398 / 合成対照の全 45 フレームで 0.000）。

    帯は「輪郭が別の位置にずれて描き直された」「輪郭の前に別の面が立った」を
    拾える程度に広く、フレームの反対側の無関係な追加物を巻き込まない程度に
    狭く取る。`4 * radius`（既定 radius=2 で 8px @1280x720、視野の 0.6%）を
    採る。
    """
    return max(4 * int(radius), int(radius) + 1)


def category_contradiction(structure: np.ndarray, lost: np.ndarray,
                           unexplained: np.ndarray, radius: int):
    """消えた輪郭の跡地に、真実に無い構造が描かれている割合。

    分母は `structure` 全体（そのカテゴリの輪郭の総量）であって `lost` では
    ない。`lost` を分母にすると、輪郭が 10 画素だけ消えてそこに新構造が
    あった場合に 1.0 になり、輪郭が丸ごと置き換わった場合と区別が付かなく
    なる。「この壁の輪郭の何割がすり替わったか」を測りたいので分母は輪郭全体。

    跡地の帯幅は `replacement_spread(radius)`。照合半径をそのまま使っては
    ならない理由はそちらのドキュストリング参照。

    `structure` が空なら `None`（検証不能）。
    """
    total = int(structure.sum())
    if total == 0:
        return None
    hit = unexplained & dilate(lost, replacement_spread(radius))
    return int(hit.sum()) / total


def zone_of(mask: np.ndarray):
    """マスクの質量が最も乗っている 3x3 ゾーン名と、その占有率を返す。

    連結成分を数えるより粗いが、決定的で速く、人間が読める。「どこで
    起きたか」を1語で言うためだけのもの。
    """
    total = int(mask.sum())
    if total == 0:
        return None, 0.0
    h, w = mask.shape
    best = None
    best_n = -1
    for r in range(3):
        for c in range(3):
            y0, y1 = h * r // 3, h * (r + 1) // 3
            x0, x1 = w * c // 3, w * (c + 1) // 3
            n = int(mask[y0:y1, x0:x1].sum())
            if n > best_n:
                best_n, best = n, ZONE_NAMES[r][c]
    return best, best_n / total


def added_structure(unexplained: np.ndarray, masks: dict) -> dict:
    """生成側が足した「真実に対応物の無い」構造を、真実側のカテゴリ別に集計。

    これが FREE ティアの実体である。**減点には一切使わない。** マグカップ、
    開いた本、観葉植物、ソファに掛けられた膝掛け、歩いている人——生活の
    想定を示す良い変化はここに現れる。量と位置を述べ、有益かどうかの判断は
    人間に渡す。

    キーは「その追加構造が乗っている真実側カテゴリ」。真実側で家具だった
    場所に新しい輪郭が出れば `furniture`、床だった場所なら `rooms`。
    カテゴリは「何を足したか」ではなく「どこに足したか」を表す点に注意。
    生成画像のセグメンテーションは存在しないので、足された物体そのものの
    種別は機械には分からない。
    """
    out = {}
    total = int(unexplained.sum())
    for key, mask in masks.items():
        n = int((unexplained & mask).sum())
        if n == 0:
            continue
        zone, share = zone_of(unexplained & mask)
        out[key] = {
            "pixels": n,
            "share_of_added": n / total if total else 0.0,
            "share_of_category_area": n / int(mask.sum()),
            "zone": zone,
            "zone_share": share,
        }
    return out


INSTANCE_RIM = 2


def instance_rim(mask: np.ndarray, width: int = INSTANCE_RIM) -> np.ndarray:
    """部材マスクの **内側** の縁だけを取り出す（幅 `width` 画素）。

    カテゴリ側と同じ理屈で、部材ごとの recall も陰影ではなく輪郭で測る。
    ソファの張地の皺やフローリングの木目は Layer 2 が変えてよい領域であり、
    そこを分母に入れるとリライトしただけで部材が「消えた」ことになる。

    重要なのは **マスクの内側に留めること**。`dilate(silhouette, n)` のように
    外へ広げると隣接物体の画素が帯に入り、`metrics.instance_recall` が
    塞いだ抜け穴（物体を消しても、境界を挟んだ隣の物体の無傷な縁が
    radius 以内にあるので満点が付く）がそのまま戻ってくる。内側の縁なら
    その物体自身の画素しか含まないので、両側マスクの保証は崩れない。

    実測（T91-ldk-push, frames 0012-0095, radius=2）。マスク全体 -> 内側縁:

      ピクセル完全な生成の最悪 per-instance (locked)   0.817 -> 0.952
      人物大の物体を床に立てた合成対照の最悪            0.646 -> 0.613
      壁を1枚消した合成対照の最悪                      0.000 -> 0.000

    つまり内側縁への限定が広げるのは **天井側の余裕** であって、
    「足された物」と「消えた構造」の分離ではない。後者は原理的に分離
    できない: 人物大の物体は frame 0012 で `wall#9` の見えている縁の上に
    立ち、その instance recall を 1.000 -> 0.613 まで落とす。壁が消えたのか
    何かが前に立ったのかを、この指標は区別しない——量でしか切れない
    （実測では消去側が 0.000〜0.36 に沈むのに対し、遮蔽側は 0.613 で
    止まる）。閾値はその間に置くしかなく、余裕は広くない。

    `mask` は `metrics.instance_regions` が返す **bbox にクロップ済み** の
    配列であることを想定し、クロップの外側は「その部材ではない」として
    扱う（そのために一度パディングしてから縁を取る）。bbox は定義上その
    部材の外接矩形なので、矩形のすぐ外に部材の画素は無い。パディングしないと、
    矩形をぴったり埋める部材（正対した壁など）で `~mask` が空になり、縁が
    1画素も立たず「検証不能」に化ける。カテゴリ側の `silhouette()` が
    パディングしないのとは意図的に非対称である: あちらの外周は画面の端、
    すなわち視野の切れ目であって別カテゴリとの境界ではない。
    """
    pad = int(width)
    h, w = mask.shape
    padded = np.zeros((h + 2 * pad, w + 2 * pad), dtype=bool)
    padded[pad:pad + h, pad:pad + w] = mask
    rim = padded & dilate(~padded, pad)
    return rim[pad:pad + h, pad:pad + w]


def instance_silhouette_recall(truth_edges: np.ndarray, generated: np.ndarray,
                               regions: dict, radius: int) -> dict:
    """部材ごとに、その部材自身の **内側の縁** でのエッジ再現率を出す。

    `regions` は `metrics.instance_regions()` が返す name -> (bbox, mask)。
    `metrics.instance_recall` と同じく真実側・生成側の **両方** を部材自身の
    画素で絞る（bbox の中身全部ではない）。違うのは、絞り込みに使うのが
    マスク全体ではなくその内側の縁である点だけ。

    真実側にその縁のエッジが1つも無い場合は `None`（検証不能）。1.0 では
    ない理由は `metrics._recall_ratio` 参照。
    """
    out = {}
    for name, (box, mask) in regions.items():
        y0, x0, y1, x1 = box
        rim = instance_rim(mask)
        truth_region = truth_edges[y0:y1, x0:x1] & rim
        generated_region = generated[y0:y1, x0:x1] & rim
        total = int(truth_region.sum())
        if total == 0:
            out[name] = None
            continue
        out[name] = int((truth_region & dilate(generated_region, radius)).sum()) / total
    return out


# ---------------------------------------------------------------------------
# package.json が持ち込む階層 (Task 9)
#
# アプリが動画生成モデルへ渡すパッケージには、**設計そのものから決めた** 階層が
# 入っている (`assets/js/lock-tiers.js`: 開口部と建具はハードロック、家具は
# ソフトロック、周辺環境と注記は計測しない)。上の `CATEGORIES` はセグメン
# テーション画像の色からティアを当てる発見的手法でしかないので、宣言がある
# 部材については宣言が優先される。
#
# なぜ発見的手法では足りないか、実測で言える: T92 で本当に仕上げが変わって
# いた lattice-screen#35 と balcony#20 はセグメンテーション上 exterior=CONTEXT、
# stair#22 / stair-corner#23 は furniture=SOFT に落ちていた。設計側の表では
# 4件とも LOCKED である。ここを取り違えると、間取りを定義する部材が
# 「文脈」として報告だけされて終わる。
#
# 語彙は1つに畳む。package.json は 'LOCKED'/'SOFT'/'FREE' と大文字で書くが、
# このモジュールの外へは常に上の定数 (小文字) だけを出す。2つのまま流すと
# `report.evaluate` の `info["tier"] == LOCKED` が 'LOCKED' に対して静かに
# False になり、ロックされた部材が黙って無検査で通る。
# ---------------------------------------------------------------------------
PACKAGE_SOURCE_3D = "3d"
PACKAGE_SOURCE_PLAN = "plan"

# package.json の階層語 -> このモジュールの定数。
PACKAGE_TIER_WORDS = {"LOCKED": LOCKED, "SOFT": SOFT, "FREE": FREE}


def normalise_package_tier(word):
    """'LOCKED' -> LOCKED。既にこのモジュールの定数ならそのまま返す。

    知らない語は **例外**。組み込み分類へ黙って落とすと、綴りを間違えた表の
    せいで設計が LOCKED と言った部材が無検査で通り得る。読めない表は読めない
    と言う方が安全側に倒れる。
    """
    if word in (LOCKED, SOFT, FREE, CONTEXT):
        return word
    key = str(word).upper()
    if key in PACKAGE_TIER_WORDS:
        return PACKAGE_TIER_WORDS[key]
    raise ValueError(
        f"unknown lock tier {word!r} in the video material package: expected one of "
        f"{sorted(PACKAGE_TIER_WORDS)}. Refusing to guess — a tier this gate cannot "
        "read would silently leave the part ungated.")


def package_source(package) -> str:
    """パッケージの素材の種類。`'3d'` か `'plan'`。

    欄が無いパッケージ (Task 7 が最初に書き出した版) はすべて3D経路なので
    `'3d'` に落とす。
    """
    if not package:
        return PACKAGE_SOURCE_3D
    return str(package.get("source") or PACKAGE_SOURCE_3D).lower()


def package_instances(package):
    """package.json の `instances` を、色を持つものだけ取り出して返す。

    アプリが書き出す1件は `{id, color, type, floor, tier}`
    (`index.html` の `videoPackageJson` / `packageInstances`)。**色を持たない
    entry は落とす** — 色は instance ガイドの画素と対でしか意味を持たず、
    平面図経路の一覧 (`planInstanceList`) は色を持たないので、そのまま legend に
    仕立てると「切り出せない部材の名前」だけが並ぶ嘘になる。

    `instances` を持たないパッケージ (Task 4 が最初に書き出した版) では空配列。
    """
    out = []
    for entry in ((package or {}).get("instances") or []):
        if not isinstance(entry, dict):
            continue
        colour = entry.get("color")
        if not colour:
            continue
        out.append(entry)
    return out


def package_legend(package):
    """package.json の `instances` から instance-legend.json と同じ形を作る。

    真値ディレクトリに `instance-legend.json` が無い場合 —— ユーザーが手元で
    判定を回すとき —— でも、**パッケージだけで部材名が出せる**ようにするための
    ものである。名前を付けるのは `metrics._legend_name` そのもので、命名規則を
    ここへ写し取らない (写すと metrics 側が変わった日に、名前だけが黙ってずれる)。

    色を持つ entry が1つも無ければ `None`。呼び出し側は「パッケージからは
    legend を作れなかった」として従来どおり振る舞う。
    """
    entries = package_instances(package)
    if not entries:
        return None
    return {"version": 2, "instances": entries}


def package_instance_tier_table(package):
    """package.json の `instances` -> `{'#rrggbb': tier}`。無ければ `None`。

    `lockTiers` と同じ色→階層の表だが、出どころは部材の一覧の方である。
    両方ともアプリ側の `LockTiers.tierOf(type)` から出るので中身は一致する。
    それでも両方読むのは、`instances` の方が **部材名と対で** 来るからで、
    ここを読まないと「色の表はあるが名前が無い」状態が残る。
    """
    out = {}
    for entry in package_instances(package):
        tier = entry.get("tier")
        if tier is None:
            continue
        out[str(entry["color"]).lower()] = normalise_package_tier(tier)
    return out or None


def lock_tier_table(package):
    """package.json -> `{'#rrggbb': tier}`。無ければ `None`。

    `None` は「このパッケージは色→階層の宣言を持たない」であって
    「階層が無い」ではない。呼び出し側は組み込み分類へそのまま落ちる
    ——既存の PV 実行 (package.json 自体が無い) と同じ道である。

    平面図経路のパッケージは `lockTiers: null` を持つ。色は instance ガイドの
    画素と対にして初めて意味を持つのに、その画素が存在しないからである
    (パッケージの `instances` は階層を持つが色を持たないので、判定器が
    ガイド画像から切り出した部材とは結べない)。
    """
    if not package:
        return None
    declared = package_instance_tier_table(package)
    tiers = package.get("lockTiers")
    if not isinstance(tiers, dict) or not tiers:
        # `lockTiers` が無くても部材の一覧が階層を持っていれば読む。両方無い
        # ときだけ `None`（＝組み込み分類へ落ちる）。
        return declared
    table = dict(declared or {})
    # `lockTiers` は判定器が実際に画素を切り出す色でそのまま引かれる表なので、
    # 食い違ったときはこちらを採る。`instances` は表に無い色を埋めるために読む。
    table.update({str(colour).lower(): normalise_package_tier(tier)
                  for colour, tier in tiers.items()})
    return table


def tier_for(colour, builtin_key, table):
    """部材の階層。表があればそれが優先、無ければ組み込み分類。

    `colour` はその部材の instance ガイド色、`builtin_key` は
    `dominant_category()` が返したカテゴリキー。**表が `None` のときの戻り値は
    従来の `TIER_OF.get(builtin_key, CONTEXT)` と1ミリも違わない** —
    package.json を持たない既存の PV 実行がここを通っても何も変わらない。
    """
    if table and colour:
        text = str(colour)
        # `lock_tier_table()` は鍵を小文字へ正規化するが、この関数は生の
        # `package['lockTiers']` を直接渡されても正しく答える必要がある
        # (呼び出し側が正規化を1つ忘れただけで階層が黙って組み込み分類へ
        # 落ちる、という形の事故を作らないため)。
        for candidate in (text.lower(), text.upper(), text):
            declared = table.get(candidate)
            if declared is not None:
                return normalise_package_tier(declared)
    return TIER_OF.get(builtin_key, CONTEXT)


def unmeasurable_finish_colours(package) -> set:
    """`shadowLift.unliftableColors` — モデルが本当に見られなかった部材の色。

    暗部持ち上げをかけてもなお床の輝度を割ったまま残った面である。実測
    (Task 7 §3.3) では 73色中4件で、最大のものは黒いTV画面 —— 「影」ではなく
    「情報がそもそも無い面」なのでトーンカーブで直す対象ではない。

    こういう面の仕上げドリフトを、見えていた面と同じ閾値で罰するのは、
    こちらのレンダの落ち度をモデルに付け替えることになる。
    """
    lift = (package or {}).get("shadowLift") or {}
    return {str(c).lower() for c in (lift.get("unliftableColors") or []) if c}


def legend_colours(legend) -> dict:
    """instance-legend.json -> 部材名 -> ガイド色 (小文字)。

    色→階層の表と、判定器が使う部材名を結ぶ唯一の輪である。名前は
    `metrics._legend_name` をそのまま呼んで付ける: ここに命名規則を写し取ると、
    metrics 側が変わった日に **階層だけが黙って別の部材へ付く**。
    """
    out = {}
    for entry in ((legend or {}).get("instances") or []):
        colour = entry.get("color")
        if not colour:
            continue
        out[_legend_name(entry)] = str(colour).lower()
    return out


def dominant_category(mask: np.ndarray, masks: dict):
    """あるマスク（instance の自画素）が最も多く重なるカテゴリキーを返す。

    instance のティアをここから決める。index.html の `aiSegmentColorForObject`
    にある type -> 色の対応表をこちら側に複製すると、本体が更新されたときに
    黙ってズレる。実際に吐かれたセグメンテーション画像を読む方が、同じ
    レンダから来ている以上ズレようがない。

    どのカテゴリとも重ならなければ `None`。
    """
    best, best_n = None, 0
    for key, cat in masks.items():
        n = int((mask & cat).sum())
        if n > best_n:
            best_n, best = n, key
    return best
