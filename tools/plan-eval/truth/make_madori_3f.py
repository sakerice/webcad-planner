#!/usr/bin/env python3
"""正解プラン: tools/tests/fixtures/madori-3f.pdf（3階建て、7280×4095）。

読み取りの採点（tools/plan-eval/score.cjs）が比べる相手。**図面の寸法線から起こした。**
各要素の memo は確認画面（tools/plan-eval/review.py）に出す説明。
壁・部屋・建具に加え、扉の吊り元と開く側、階段の上る向き、図面に描かれた家具と設備、
外構（スロープ・ポーチ・バルコニー）も正解に含める（2026-10-18 利用者の指示。家具も読み取りで再現する）。
家具の向きは「正面が向く方角」で書く（N/E/S/W。ベッドは足元の方角）。

座標は1階の外壁の北西の角（芯）を原点にしたミリメートル。3階も同じ原点で、
図面どうしの位置関係（階段が上下で重なる）をそのまま持つ。

図面に名前の書かれていない部屋（洗面脱衣室・トイレ・廊下・ホール）は、
描かれている設備から人が付けた名前にしてある。

    python3 tools/plan-eval/truth/make_madori_3f.py
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", ".."))
from plan_kit import Plan, orient_catalog_furniture  # noqa: E402

P = Plan()
wall, room, item = P.wall, P.room, P.item


def _with_memo(make):
    """plan_kit の窓・扉は memo を受けないので、作った後に書き足す。"""
    def wrapped(*a, memo=None, **kw):
        obj = make(*a, **kw)
        if memo:
            obj["memo"] = memo
        return obj
    return wrapped


win, door = _with_memo(P.win), _with_memo(P.door)
SILL, HEAD = 900, 2000          # 腰窓の窓台と上端（採点には効かない）
DIR = {"N": (0, -1), "S": (0, 1), "E": (1, 0), "W": (-1, 0)}
ROT = {"N": 0, "E": 90, "S": 180, "W": 270}


def _wall_dir(cx, cy, f):
    """建具が吸い付く壁（400mm 以内で最寄り）の向き。アプリは建具の左右をこの向きで決める。"""
    best = None
    for w in P.walls:
        if w["floor"] != f:
            continue
        x1, y1, x2, y2 = w["x1"], w["y1"], w["x2"], w["y2"]
        L = ((x2 - x1) ** 2 + (y2 - y1) ** 2) ** 0.5
        ux, uy = (x2 - x1) / L, (y2 - y1) / L
        t = max(0, min(L, (cx - x1) * ux + (cy - y1) * uy))
        d = ((cx - x1 - ux * t) ** 2 + (cy - y1 - uy * t) ** 2) ** 0.5
        if d <= 400 and (best is None or d < best[0]):
            best = (d, ux, uy)
    assert best, "建具の近くに壁が無い: %s,%s" % (cx, cy)
    return best[1], best[2]


def swing(t, cx, cy, w, f, hinge, opens, vertical=False, memo=None):
    """扉を「吊り元の端（方角）」と「開く側（方角）」で置く。左右の値（flipX/flipY）は壁の向きから決める。

    開き戸: 吊り元は flipX=False で壁の始点側、弧は flipY=False で壁の進行方向の右手側。
    折戸:   山形の出る側が開き戸と逆（flipY=False で左手側）。
    """
    ux, uy = _wall_dir(cx, cy, f)
    nx, ny = -uy, ux                                  # 進行方向の右手（画面で時計回りに90°）
    hx, hy = DIR[hinge]
    ox, oy = DIR[opens]
    flip_x = hx * ux + hy * uy > 0
    right = ox * nx + oy * ny > 0
    flip_y = right if t.startswith("door-fold") else not right
    d = door(t, cx, cy, w, f, vertical=vertical, flipY=flip_y, flipX=flip_x, memo=memo)
    d["hinge"], d["opens"] = hinge, opens             # 採点と確認画面のための記録（アプリは読まない）
    return d


def fur(t, cx, cy, w, d, f, face, memo=None):
    """家具・設備を「正面の方角」で置く。w は正面から見た幅、d は奥行き。

    組み込みの洗濯機は正面が rot+180 の側（tools/lint_plan.py の _front_dir と同じ決まり）。
    カタログ家具は最後に orient_catalog_furniture がモデルの正面軸へ直す。
    """
    rot = (ROT[face] + (180 if t == "washer" else 0)) % 360
    it = item(t, cx, cy, w, d, f, rot=rot)
    it["face"] = face
    if memo:
        it["memo"] = memo
    return it


def hwin(cx, cy, f, std, **kw):
    """横向きの壁（y が一定）に載る窓。"""
    high = std.startswith("03") or std.startswith("06")
    return win(cx, cy, f, std, 1100 if high else SILL, HEAD - (1100 if high else SILL), **kw)


def vwin(cx, cy, f, std, **kw):
    """縦向きの壁（x が一定）に載る窓。"""
    high = std.startswith("03") or std.startswith("06")
    return win(cx, cy, f, std, 1100 if high else SILL, HEAD - (1100 if high else SILL), vertical=True, **kw)


# ══════════════════════════ 1階 ══════════════════════════
F = 1
wall(0, 0, 7280, 0, F)
wall(7280, 0, 7280, 1820, F)
wall(5460, 1820, 7280, 1820, F, memo="浴室|KB置き場、東の455はポーチの上の外壁")
wall(6825, 1820, 6825, 4095, F, memo="玄関の壁（東の455はポーチ＝屋外）")
wall(0, 4095, 7280, 4095, F)
wall(0, 0, 0, 4095, F)
wall(0, 1365, 3185, 1365, F, memo="ファミリークロゼット|洋室")
wall(3185, 0, 3185, 2275, F, memo="クロゼット・洋室|洗面脱衣室")
wall(3185, 2275, 5460, 2275, F, memo="洗面脱衣室|廊下")
wall(5460, 0, 5460, 4095, F, memo="浴室・廊下|KB置き場")
wall(2275, 2275, 3185, 2275, F, memo="洋室|廊下")
wall(2275, 2275, 2275, 4095, F, memo="洋室|廊下・トイレ")
wall(2275, 3185, 4550, 3185, F, memo="廊下|トイレ・収納")
wall(3640, 3185, 3640, 4095, F, memo="トイレ|収納")
wall(4550, 3185, 4550, 4095, F, memo="収納|階段")

room("ファミリークロゼット", 0, 0, 3185, 1365, F)
room("洋室", 0, 1365, 3185, 910, F)     # L字（下の長方形と2つで1室）
room("洋室", 0, 2275, 2275, 1820, F)
room("洗面脱衣室", 3185, 0, 2275, 2275, F)
room("浴室", 5460, 0, 1820, 1820, F)
room("廊下", 2275, 2275, 3185, 910, F)
room("廊下", 4550, 3185, 910, 910, F)   # 階段の上り口
room("トイレ", 2275, 3185, 1365, 910, F)
room("収納", 3640, 3185, 910, 910, F)
room("KB置き場", 5460, 1820, 1365, 2275, F)

hwin(3640, 0, F, "03613")
vwin(0, 2855, F, "06905")
hwin(2615, 4095, F, "03613")
hwin(4895, 4095, F, "06905")
door("door-slide", 2360, 1365, 1500, F, memo="クロゼットの引違い")
door("door-slide", 3185, 750, 1060, F, vertical=True, memo="クロゼット→洗面")
door("door-slide", 4480, 2275, 1500, F, memo="洗面→廊下")
swing("door-fold", 5460, 1375, 760, F, "N", "W", vertical=True, memo="浴室（洗面側へ折れる）")
swing("door-swing", 2730, 2275, 780, F, "E", "N", memo="洋室（洋室側へ開く）")
swing("door-swing", 2615, 3185, 600, F, "W", "N", memo="トイレ（廊下側へ開く）")
swing("door-swing-s", 3910, 3185, 370, F, "W", "N", memo="収納（観音開きの左）")
swing("door-swing-s", 4280, 3185, 370, F, "E", "N", memo="収納（観音開きの右）")
door("door-opening", 5460, 3345, 490, F, vertical=True, memo="階段の上り口→KB置き場")
swing("door-front", 6825, 3140, 910, F, "S", "E", vertical=True, memo="玄関（ポーチ側へ開く）")
# 階段: 廊下から南へ入り、廻り部で西へ折れて、トイレ・収納の上を西へ上る。
item("stair-corner", 5005, 3640, 910, 910, F, rot=180)["memo"] = "廻り部（北から入り西へ抜ける・1〜3段）"
item("stair", 3412.5, 3640, 910, 2275, F, rot=90)["memo"] = "直進部（西へ上る・4〜12段）"
fur("bed-s", 571, 3010, 970, 1950, F, "N", memo="ベッド（頭は南の壁）")
fur("bed-s", 1714, 3010, 970, 1950, F, "N", memo="ベッド（頭は南の壁）")
fur("washer", 5034, 448, 640, 640, F, "S", memo="洗濯機")
fur("sink", 3534, 1735, 718, 550, F, "E", memo="洗面台")
fur("bath", 6370, 502, 1570, 735, F, "S", memo="浴槽")
fur("toilet", 3175, 3613, 380, 680, F, "W", memo="便器")
fur("original-shoe-counter", 5926, 3812, 762, 396, F, "N", memo="ベンチ収納（茶色の箱）")
# 外構: ポーチ（建物の東の帯と、その先の段）とスロープ。
fur("original-terrace-tile", 7052, 2958, 455, 2275, F, "N", memo="ポーチ（建物内の屋外の帯）")
fur("original-terrace-tile", 7852, 3074, 1143, 1115, F, "N", memo="ポーチの先の段")
fur("ramp", 7898, 1444, 1050, 1970, F, "S", memo="スロープ（南の段へ上る）")

# ══════════════════════════ 2階 ══════════════════════════
F = 2
wall(0, 0, 7280, 0, F)
wall(7280, 0, 7280, 2275, F)
wall(5460, 2275, 7280, 2275, F, memo="LDK|バルコニー")
wall(5460, 2275, 5460, 4095, F, memo="階段|バルコニー")
wall(0, 4095, 5460, 4095, F)
wall(0, 0, 0, 4095, F)
wall(2275, 0, 2275, 955, F, memo="キッチン脇の袖壁")
wall(910, 3185, 910, 4095, F, memo="収納の東（収納の前は開いている）")
wall(2275, 3185, 4550, 3185, F, memo="階段の吹き抜けの腰壁")

room("LDK", 0, 0, 7280, 2275, F)
room("LDK", 0, 2275, 5460, 910, F)
room("LDK", 910, 3185, 1365, 910, F)
room("収納", 0, 3185, 910, 910, F)

hwin(1260, 0, F, "03613")
hwin(5460, 0, F, "16509")
vwin(7280, 1475, F, "06905")
hwin(1480, 4095, F, "06905")
hwin(4895, 4095, F, "06905")
win(6390, 2275, F, "16520", 0, 2030, memo="バルコニーへの掃き出し")
vwin(5460, 3180, F, "06905")
item("balcony", 6370, 3185, 1820, 1820, F)["memo"] = "バルコニー"
item("stair-corner", 5005, 3640, 910, 910, F, rot=180)["memo"] = "廻り部（北から入り西へ抜ける・1〜3段）"
item("stair", 3412.5, 3640, 910, 2275, F, rot=90)["memo"] = "直進部（西へ上る・4〜12段）"
fur("fridge", 423, 439, 650, 690, F, "S", memo="冷蔵庫")
fur("fmp-CabinetA01", 296, 1650, 1309, 457, F, "E", memo="カップボード")
fur("kitchen", 1875, 1186, 2237, 652, F, "W", memo="キッチン（ペニンシュラ）")
fur("dining-table", 3420, 912, 864, 1604, F, "N", memo="ダイニングテーブル")
fur("fmp-Chair01", 2768, 574, 450, 450, F, "E", memo="椅子")
fur("fmp-Chair01", 2768, 1250, 450, 450, F, "E", memo="椅子")
fur("fmp-Chair01", 4046, 574, 450, 450, F, "W", memo="椅子")
fur("fmp-Chair01", 4046, 1250, 450, 450, F, "W", memo="椅子")
fur("sofa", 5574, 545, 1803, 903, F, "S", memo="ソファ")
fur("fmp-Table33", 5638, 1587, 1202, 591, F, "N", memo="センターテーブル")
fur("tv", 3852, 2845, 1490, 355, F, "N", memo="テレビ台")

# ══════════════════════════ 3階 ══════════════════════════
F = 3
wall(0, 910, 3185, 910, F)
wall(3185, 455, 3185, 910, F)
wall(3185, 455, 5915, 455, F)
wall(5915, 455, 5915, 4095, F)
wall(0, 4095, 5915, 4095, F)
wall(0, 910, 0, 4095, F)
wall(2275, 910, 2275, 4095, F, memo="趣味部屋①|トイレ・ホール・階段")
wall(2275, 2275, 3185, 2275, F, memo="トイレ|ホール")
wall(3185, 910, 3185, 3185, F, memo="トイレ・ホール|趣味部屋②")
wall(3185, 3185, 4095, 3185, F, memo="趣味部屋②|階段")
wall(4095, 3185, 4095, 4095, F, memo="階段|床上げ収納")
wall(5005, 3185, 5005, 4095, F, memo="床上げ収納|収納（どちらも趣味部屋②へ開いている）")

room("趣味部屋①", 0, 910, 2275, 3185, F)
room("趣味部屋②", 3185, 455, 2730, 2730, F)
room("トイレ", 2275, 910, 910, 1365, F)
room("ホール", 2275, 2275, 910, 910, F)
room("床上げ収納", 4095, 3185, 910, 910, F)
room("収納", 5005, 3185, 910, 910, F)

hwin(1365, 4095, F, "16509")
hwin(2610, 910, F, "03613")
vwin(5915, 2270, F, "16509")
hwin(2610, 4095, F, "03613")
door("door-slide-s", 2275, 2750, 800, F, vertical=True, memo="趣味部屋①")
swing("door-swing", 2850, 2275, 600, F, "W", "S", memo="トイレ（ホール側へ開く）")
swing("door-swing", 3185, 2730, 760, F, "S", "E", vertical=True, memo="趣味部屋②（部屋側へ開く）")
fur("toilet", 2730, 1350, 380, 680, F, "S", memo="便器")

orient_catalog_furniture(P.items)

P.dump(os.path.join(HERE, "madori-3f.json"))
