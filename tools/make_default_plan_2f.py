#!/usr/bin/env python3
"""モダン注文住宅の既定プラン(default_plan.json)を生成する。

東京郊外(東京西部・神奈川・埼玉)の敷地約45坪・南道路を想定した
2階建て 4LDK+書斎。910mmモジュール。

住まい手: 30代共働き夫婦 + 小2の娘 + 2歳の息子 + 猫。
夫は週2リモートワーク(書斎)、料理は横並びダイニングで時短、
リビング北西が子どもの遊び場、休日は南庭と自転車。

意匠(リサーチ準拠):
  - フラットルーフのキューブ型 + 黒フェイシア
  - 縦分割ツートーン: 白塗り壁 × 玄関ボリューム(東側)のチャコールガルバ
  - 木調アクセント: バルコニー腰壁・玄関ドア・ポーチ脇の縦格子
  - サッシ・雨樋・破風は黒で統一、窓上端は2030の通りで揃える
  - オープン外構: 土間コン+スリット目地・門柱・シンボルツリー
  - 木のトーンは2系統: 1階=ウォールナット+籐 / 2階=ライトオーク

3D向きの規約(index.html実装とレビューによる実証):
  - アイテムの rot は「正面が向く方角」: 0=北(-y) / 90=東(+x) /
    180=南(+y) / -90=西(-x)。壁付け家具は壁に背を向ける向きにする
  - 直進階段 rot=0 は北端が最下段。rot=180 で南から北へ上る
  - 廻りコーナー rot=0 は右回り東抜け(西抜けは flipX)
  - 外階段/スロープ rot=0 は北端が低い
  - 建具の flipY=False は +y(南)側へ開く
  - window-door は doorOpenState 未指定だと「開」で描画される
  - 天井高は WALL_H=2400。elev+モデル高がこれを超えると貫通する

usage: python3 tools/make_default_plan_2f.py [出力パス]
"""
import json
import os
import sys

M = 910          # 1モジュール
WALL_T = 120
CEIL = 2400      # WALL_H。elev+モデル高がこれを超えないこと

# 色パレット
COL_WHITE = "#F2F0EB"      # 外壁メイン(白塗り壁)
COL_CHARCOAL = "#3A3D40"   # 外壁アクセント(ガルバ)
COL_WOOD = "#8B5E3C"       # 木調アクセント
COL_ROOF = "#2B2B2B"       # 屋根・雨樋・破風・金物
COL_SASH = "#1c1c1c"       # サッシ
COL_DOOR = "#5C4230"       # 玄関ドア(ダークウォールナット)
COL_FENCE = "#222222"      # 黒格子フェンス

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")

_id = [1000]
def nid():
    _id[0] += 1
    return _id[0]

walls, rooms, items = [], [], []

def _load_catalog():
    cat = {}
    for rel in ("assets/models/furniture_mega/manifest.json",
                "assets/models/interior_model_0_26_1/manifest.json",
                "assets/models/custom/manifest.json"):
        path = os.path.join(ROOT, rel)
        if not os.path.exists(path):
            continue
        with open(path, encoding="utf-8") as f:
            m = json.load(f)
        for i in (m.get("items") or m):
            cat[i["id"]] = (i.get("w"), i.get("d"), i.get("h"))
    return cat

CATALOG = _load_catalog()

# ───────── helpers ─────────
def wall(x1, y1, x2, y2, floor, **kw):
    w = {"id": nid(), "x1": x1, "y1": y1, "x2": x2, "y2": y2, "floor": floor,
         "thick": WALL_T, "color": "#888888", "texture": None, "texScale": 1,
         "locked": True}
    w.update(kw)
    walls.append(w)
    return w

def room(n, x, y, w, d, floor, texture=None, **kw):
    r = {"id": "r%d" % nid(), "type": "room", "x": x, "y": y, "w": w, "d": d,
         "floor": floor, "n": n, "sScale": 1, "sX": 0, "sY": 0, "locked": True}
    if texture:
        r["texture"] = texture
    r.update(kw)
    rooms.append(r)
    return r

def item(t, cx, cy, w, d, floor, rot=0, color=None, locked=True, **kw):
    """中心座標で配置する。家具モデルの w,d はカタログ値で上書きする。

    3D側は高さをカタログ固定のまま w,d だけ引き伸ばすので、カタログと違う
    寸法を書くと「背は同じで横に太った家具」になる。引数は配置意図の記録用。
    """
    if t in CATALOG and (t.startswith("fmp-") or t.startswith("im0261-")):
        cw, cd, _h = CATALOG[t]
        if cw and cd:
            if abs(w - cd) + abs(d - cw) < abs(w - cw) + abs(d - cd):
                cw, cd = cd, cw
            w, d = cw, cd
    it = {"id": nid(), "type": t, "x": round(cx - w / 2, 2), "y": round(cy - d / 2, 2),
          "w": w, "d": d, "rot": rot, "floor": floor,
          "flipX": False, "flipY": False, "sScale": 1, "sX": 0, "sY": 0}
    if color is not None:
        it["color"] = color
        it["colorCustom"] = True
    else:
        it["color"] = None
        it["colorCustom"] = False
    if locked:
        it["locked"] = True
    it.update(kw)
    items.append(it)
    return it

WIN_W = {"02607": 260, "03613": 405, "06905": 690, "07409": 780,
         "11909": 1235, "16509": 1690, "16511": 1690, "16513": 1690,
         "16520": 1690, "25620": 2600,
         "F03613": 405, "F06013": 600, "F11913": 1235, "F16503": 1690}

def win(cx, cy, floor, std, sill, height, vertical=False, kind="sliding"):
    ww = WIN_W[std]
    t = "window-door" if std in ("16520", "25620") else "window"
    dd = 180 if t == "window-door" else 150
    kw = {}
    if t == "window-door":
        kw["doorOpenState"] = "closed"   # 未指定だと開いた状態で描画される
    return item(t, cx, cy, ww, dd, floor, rot=90 if vertical else 0,
                color="#000000", windowStd=std, windowKind=kind,
                windowSill=sill, windowHeight=height, sashColor=COL_SASH, **kw)

def door(t, cx, cy, w, floor, vertical=False, color=None, flipY=False, **kw):
    depth = {"door-swing": w, "door-swing-s": w, "door-fold": 420,
             "door-fold-w": 420, "door-slide": 150, "door-slide-s": 150,
             "door-pocket": 150, "door-front": 200, "door-opening": 160,
             "door-opening-arch": 160}[t]
    base = {"doorHeight": 2330 if t == "door-front" else 2000,
            "doorOpenState": "closed"}
    base.update(kw)
    it = item(t, cx, cy, w, depth, floor, rot=90 if vertical else 0,
              color=color or ("#f8d0a0" if t == "door-front" else "#f8e8c0"),
              **base)
    it["flipY"] = flipY
    return it

def light(kind, cx, cy, floor, elev, shadow=False):
    size = {"ceiling": 450, "down": 180}[kind]
    inten = {"ceiling": 0.56, "down": 0.72}[kind]
    rng = {"ceiling": 5600, "down": 4400}[kind]
    return item("light-%s" % kind, cx, cy, size, size, floor, elev=elev,
                color="#fff6dd", lightKind=kind, lightShape="point",
                lightColor="#fff6dd", lightIntensity=inten, lightRange=rng,
                lightAngle=64, lightCastShadow=shadow)

# ───────── 建物躯体 (footprint 8190×7280 = 9P×8P) ─────────
BW, BD = 9 * M, 8 * M      # 8190 × 7280

item("foundation", BW / 2, BD / 2, BW, BD, 1, color="#474747",
     foundationHeight=450)

# ══════════ 1F ══════════
# 設計方針: 2階の壁は全て1階の壁の上に載せるか、直交壁で分割して最大スパンを
# 4550mm以下に収める。「リントを通すためだけの袖壁」は置かない。
# 部屋は全て矩形で、無名の余り矩形を作らない(1階は建物面積 59.62㎡ ちょうど)。
w_n1 = wall(0, 0, BW, 0, 1)
w_e1 = wall(BW, 0, BW, BD, 1)                 # アクセント(チャコール)
w_s1m = wall(0, BD, 6370, BD, 1)              # 白
w_s1e = wall(6370, BD, BW, BD, 1)             # アクセント(玄関ボリューム)
w_w1 = wall(0, BD, 0, 0, 1)

wall(1820, 0, 1820, 1820, 1)          # 浴室|洗面
wall(0, 1820, 3640, 1820, 1)          # 浴室+洗面|ランドリー
wall(3640, 0, 3640, 2730, 1)          # 水まわり|キッチン
wall(0, 2730, 6370, 2730, 1)          # 北ゾーン|洋室+LDK
wall(2730, 2730, 2730, BD, 1)         # 洋室(1F)|LDK
wall(6370, 0, 6370, BD, 1)            # 東ゾーン背骨
wall(7280, 0, 7280, 4550, 1)          # 階段室西壁
wall(6370, 1820, 7280, 1820, 1)       # パントリー南
wall(6370, 3640, 7280, 3640, 1)       # トイレ南
wall(7280, 910, 8190, 910, 1)         # 納戸南
wall(6370, 4550, 7280, 4550, 1)       # 廊下|ホール (x7280-8190 は階段の上り口)
wall(6370, 5460, 8190, 5460, 1)       # ホール|玄関

room("浴室", 0, 0, 1820, 1820, 1, texture="tile_floor")
room("洗面脱衣室", 1820, 0, 1820, 1820, 1, texture="tile_floor")
room("ランドリー", 0, 1820, 3640, 910, 1, texture="tile_floor")
room("キッチン", 3640, 0, 2730, 2730, 1, texture="wood_floor")
room("洋室", 0, 2730, 2730, 4550, 1, texture="wood_floor")
room("LDK", 2730, 2730, 3640, 4550, 1, texture="wood_floor")
room("パントリー", 6370, 0, 910, 1820, 1, texture="wood_floor")
room("納戸", 7280, 0, 910, 910, 1, texture="wood_floor")
room("階段", 7280, 910, 910, 3640, 1, texture="wood_floor")
room("トイレ", 6370, 1820, 910, 1820, 1, texture="tile_floor")
room("廊下", 6370, 3640, 910, 910, 1, texture="wood_floor")
room("ホール", 6370, 4550, 1820, 910, 1, texture="wood_floor")
room("玄関", 6370, 5460, 1820, 1820, 1, texture="porch_tile")

# ── 1F 建具 (引戸は引き代を戸幅ぶん確保できる位置にだけ置く)
door("door-fold", 910, 1820, 780, 1)                            # 浴室(折戸)
door("door-slide-s", 2730, 1820, 780, 1)                        # 洗面→ランドリー
door("door-slide-s", 1400, 2730, 780, 1, flipX=True)            # ランドリー↔洋室(西へ引く)
door("door-opening", 5915, 2730, 780, 1)                        # キッチン出入口
door("door-opening", 6370, 900, 780, 1, vertical=True)          # パントリー
door("door-swing-s", 7735, 910, 650, 1, flipY=True)             # 納戸
door("door-swing-s", 6825, 3640, 650, 1)                        # トイレ(外開き)
door("door-opening", 6825, 4550, 780, 1)                        # ホール↔廊下
door("door-swing", 2730, 6700, 780, 1, vertical=True, flipX=True)  # 洋室↔LDK
door("door-slide-s", 6370, 5000, 780, 1, vertical=True)         # LDK↔ホール
door("door-opening", 7280, 5460, 1650, 1)                       # 玄関→ホール(上り框)
door("door-front", 7320, BD, 940, 1, color=COL_DOOR)            # 玄関ドア
door("door-swing-s", 5000, 0, 650, 1, flipY=True)               # 勝手口(外開き)

# ── 1F 窓 (上端2030の通りで揃える)
win(4200, BD, 1, "25620", 0, 2030)                    # LDK南 大開口
win(1400, BD, 1, "16520", 0, 2030)                    # 洋室南 掃き出し
win(5300, 0, 1, "16513", 1200, 830)                   # キッチン北(カウンター上)
win(2600, 0, 1, "06905", 1460, 570)                   # 洗面北
win(900, 0, 1, "06905", 1460, 570)                    # 浴室北
win(0, 4200, 1, "16513", 660, 1370, vertical=True)    # 洋室西
win(0, 6400, 1, "03613", 660, 1370, vertical=True, kind="casement")   # 洋室西スリット
win(0, 2275, 1, "07409", 1260, 770, vertical=True)    # ランドリー西
win(BW, 6800, 1, "F03613", 660, 1370, vertical=True, kind="fix")      # 玄関東
win(BW, 2400, 1, "03613", 660, 1370, vertical=True, kind="casement")  # 階段東

# ── 階段 (ホールから北へ上り、頂部コーナーで西へ抜ける)
item("stair", 7735, 3185, 910, 2730, 1, rot=180, color="#e8e0c8", stairOrder=1)
_c = item("stair-corner", 7735, 1365, 910, 910, 1, rot=0,
          color="#e8e0c8", stairOrder=2)
_c["flipX"] = True

# ══════════ 2F ══════════
w_n2 = wall(0, 0, BW, 0, 2)
w_e2 = wall(BW, 0, BW, BD, 2)
w_s2m = wall(0, BD, 6370, BD, 2)
w_s2e = wall(6370, BD, BW, BD, 2)
w_w2 = wall(0, BD, 0, 0, 2)

wall(0, 2730, 6370, 2730, 2)          # 北ゾーン|廊下   (直下: 1F y2730)
# x6370-7280 は2Fホールから廊下への通り抜け(壁を置かない)
wall(0, 3640, 7280, 3640, 2)          # 廊下|南ゾーン   (直下: 1F x2730/x6370で分割)
wall(3640, 0, 3640, 2730, 2)          # 洋室A|洋室B     (直下: 1F x3640)
wall(6370, 0, 6370, 2730, 2)          # 北ゾーン|2Fホール (直下: 1F x6370)
wall(6370, 3640, 6370, BD, 2)         # WIC/書斎|納戸    (直下: 1F x6370)
# x6370 の y2730-3640 は廊下の通り抜け
wall(7280, 0, 7280, 910, 2)           # 2F収納|PS側     (直下: 1F x7280)
wall(7280, 1820, 7280, 4550, 2)       # 吹抜西          (直下: 1F x7280)
# x7280 の y910-1820 は階段着地から2Fホールへの通り抜け
wall(6370, 1820, 7280, 1820, 2)       # 2Fトイレ南      (直下: 1F y1820)
wall(7280, 910, 8190, 910, 2)         # 2F収納南        (直下: 1F y910)
wall(3640, 3640, 3640, BD, 2)         # 主寝室|WIC/書斎
wall(3640, 5460, 6370, 5460, 2)       # WIC|書斎
wall(6370, 4550, 8190, 4550, 2)       # 廊下|納戸

room("洋室A", 0, 0, 3640, 2730, 2, texture="wood_floor")
room("洋室B", 3640, 0, 2730, 2730, 2, texture="wood_floor")
room("トイレ", 6370, 0, 910, 1820, 2, texture="tile_floor")
room("収納", 7280, 0, 910, 910, 2, texture="wood_floor")
room("ホール", 6370, 1820, 910, 910, 2, texture="wood_floor")
room("階段ホール", 7280, 910, 910, 910, 2, texture="wood_floor")
room("廊下", 0, 2730, 7280, 910, 2, texture="wood_floor")
room("廊下", 6370, 3640, 910, 910, 2, texture="wood_floor")
room("主寝室", 0, 3640, 3640, 3640, 2, texture="wood_floor")
room("WIC", 3640, 3640, 2730, 1820, 2, texture="wood_floor")
room("書斎", 3640, 5460, 2730, 1820, 2, texture="wood_floor")
room("納戸", 6370, 4550, 1820, 2730, 2, texture="wood_floor")
# x7280-8190 / y1820-4550 は階段吹き抜け(床なし)

# ── 2F 建具
door("door-swing", 1400, 2730, 780, 2, flipY=True, flipX=True)   # 洋室A(室内開き)
door("door-swing", 5000, 2730, 780, 2, flipY=True, flipX=True)   # 洋室B(室内開き)
door("door-swing-s", 6825, 1820, 650, 2, flipY=True)    # 2Fトイレ(室内開き)
door("door-swing-s", 7735, 910, 650, 2, flipY=True)     # 2F収納
door("door-swing", 3100, 3640, 780, 2)                  # 主寝室(室内開き=南)
door("door-fold-w", 4700, 3640, 1650, 2)                # WIC
door("door-swing", 5800, 5460, 780, 2)                  # 書斎(WICから)
door("door-opening", 6825, 3640, 780, 2)                # 2Fホール↔廊下
door("door-slide-s", 6825, 4550, 780, 2)                # 納戸(引戸)

# ── 2F 窓 (上端2030で1Fと通りを揃える)
win(1400, 0, 2, "16513", 660, 1370)                   # 洋室A北
win(0, 1400, 2, "16513", 660, 1370, vertical=True)    # 洋室A西
win(4800, 0, 2, "16513", 660, 1370)                   # 洋室B北
win(6825, 0, 2, "06905", 1460, 570)                   # 2Fトイレ北
win(0, 5000, 2, "16513", 660, 1370, vertical=True)    # 主寝室西
win(1800, BD, 2, "16520", 0, 2030)                    # 主寝室南 掃き出し
win(4800, BD, 2, "16513", 660, 1370)                  # 書斎南
win(BW, 5900, 2, "03613", 660, 1370, vertical=True, kind="casement")  # 納戸東
win(BW, 2400, 2, "F03613", 660, 1370, vertical=True, kind="fix")      # 吹き抜け東

# ── バルコニー (主寝室南・木調腰壁・出910)
item("balcony", 1820, 7735, 3640, 910, 2, color="#c8e8c8")
w_b1 = wall(0, 8190, 3640, 8190, 2, wallStyle="balcony-fence", wallHeight=1100)
w_b2 = wall(0, BD, 0, 8190, 2, wallStyle="balcony-fence", wallHeight=1100)
w_b3 = wall(3640, BD, 3640, 8190, 2, wallStyle="balcony-fence", wallHeight=1100)

# ── 屋根 (フラットルーフのキューブ型・軒の出450)
item("roof", BW / 2, BD / 2, BW + 900, BD + 900, 3, rot=0,
     color=COL_ROOF, roofType="flat", pitch=5, elev=0,
     roofThickness=260, roofSkirt=0, roofEdgeColor=COL_ROOF)
item("roof", 7320, 7660, 1900, 1000, 2, rot=180,
     color=COL_ROOF, roofType="mono", pitch=3, elev=0,
     roofThickness=80, roofSkirt=0, roofEdgeColor=COL_ROOF)

# ══════════ 敷地・外構 ══════════
SX0, SX1 = -M, BW + 2275          # -910 .. 10465
SY0, SY1 = -M, BD + 5005          # -910 .. 12285
SW = SX1 - SX0                    # 11375

item("site-rect", SX0 + SW / 2, -455, SW, 910, 1,
     color="rgba(160,150,130,0.15)", siteSurface="gravel")     # 北 防犯砂利
item("site-rect", SX0 + SW / 2, 4700, SW, 9400, 1,
     color="rgba(100,160,100,0.1)", siteSurface="grass")       # 建物+南庭
item("site-rect", SX0 + SW / 2, 10842.5, SW, 2885, 1,
     color="rgba(150,152,155,0.15)", siteSurface="concrete")   # 駐車場

# 境界: 北・西・東はブロック塀、道路側はオープン外構
item("fence", SX0 + SW / 2, SY0 + 60, SW, 120, 1, color="#c0bcb4")
item("fence", SX0 + 60, (SY0 + 120 + SY1) / 2, 120, SY1 - SY0 - 120, 1,
     color="#c0bcb4")
item("fence", SX1 - 60, (SY0 + 120 + SY1) / 2, 120, SY1 - SY0 - 120, 1,
     color="#c0bcb4")
item("lattice-screen", 250, SY1 - 90, 2000, 60, 1, color=COL_FENCE,
     latticeHeight=1100, fencePattern="vertical", fenceTopStyle="even")
item("lattice-screen", 9550, SY1 - 90, 1600, 60, 1, color=COL_FENCE,
     latticeHeight=1100, fencePattern="vertical", fenceTopStyle="even")
item("lattice-screen", 6180, 8000, 1500, 60, 1, rot=90, color=COL_WOOD,
     latticeHeight=2400, fencePattern="vertical", fenceTopStyle="even")
item("custom-block", 6350, 11750, 400, 150, 1, color=COL_CHARCOAL,
     customHeight=1500, name="門柱", texture="galvalume_dark")

# 玄関ポーチ(平坦な踏込み)+階段。ドアが階段の上に直接開かないようにする
item("custom-block", 7280, 7880, 1820, 1200, 1, color="#b9b8b4",
     customHeight=450, name="玄関ポーチ", texture="porch_tile")
item("exterior-stair", 7280, 8930, 1820, 900, 1, rot=180,
     color="#b8b2a8", targetHeight=450, accessSteps=3, texture="porch_tile")
item("custom-block", 7320, 10830, 1100, 2900, 1, color="#b9b8b4",
     customHeight=20, name="アプローチ", texture="porch_tile")
# LDK大開口の外のウッドデッキ(FL450の段差解消)
item("fmp-WoodDeck01", 1900, 7800, 2600, 900, 1, rot=0)   # ウッドデッキ(実物モデル)
item("exterior-stair", 1900, 8475, 1800, 450, 1, rot=180,
     color="#b8b2a8", targetHeight=450, accessSteps=3)
# 勝手口の外階段
item("custom-block", 2200, -235, 1200, 350, 1, color="#b9b8b4",
     customHeight=450, name="勝手口ポーチ", texture="porch_tile")
item("exterior-stair", 2200, -590, 900, 360, 1, rot=0,
     color="#b8b2a8", targetHeight=450, accessSteps=2)
# 土間コンのスリット目地

# 駐車(道路並列)・自転車
item("car", 3450, 10250, 1850, 4500, 1, rot=90, color="#ced1d5")
item("bicycle", 8800, 10200, 580, 1850, 1, rot=0, color="#a8b4c4")
item("bicycle-fold", 9400, 10200, 550, 1450, 1, rot=0, color="#d8a878")

# 植栽
item("tree", 9600, 1300, 1500, 1500, 1, color="#6f855f")
item("tree", 9300, 3600, 1300, 1300, 1, color="#74895f")
item("tree", 9500, 6300, 1500, 1500, 1, color="#7d9268")   # シンボルツリー
item("tree", 5000, 8300, 1500, 1500, 1, color="#7d9268")   # 南庭

# 住宅設備。給湯器はガス1台に統一し、北側通路を塞がない位置へ
item("gas-heater", 200, -250, 470, 240, 1, color="#e8e9eb")
item("meter-box", -70, 1200, 180, 120, 1, rot=90, color="#c8cacc", elev=1600)
item("sewer-pit", 5300, -500, 300, 300, 1, color="#6f7275")
item("sewer-pit", 6800, -500, 300, 300, 1, color="#6f7275")
item("sewer-pit", 7900, -500, 300, 300, 1, color="#6f7275")
item("sewer-pit", 8400, 4100, 300, 300, 1, color="#6f7275")
item("sewer-pit", 7000, 9600, 300, 300, 1, color="#6f7275")
item("sewer-pit", 500, 9600, 300, 300, 1, color="#6f7275")
item("sewer-pit", 9600, 7600, 300, 300, 1, color="#6f7275")

# エアコン: 室内機は必ず外壁面。室外機は配管長3m以内に対で置く
AC_PAIRS = [
    # (室内機 cx, cy, rot, floor, 室外機 cx, cy, rot)
    (6180, 6600, -90, 1, 8500, 6600, -90),     # LDK(東壁)
    (2900, 130, 180, 2, 3300, -300, 0),        # 洋室A(北壁)
    (5500, 130, 180, 2, 4400, -300, 0),        # 洋室B(北壁)
    (190, 4200, 90, 2, -330, 4200, 90),        # 主寝室(西壁)
    (6180, 6300, -90, 2, 8500, 5600, -90),     # 書斎(東壁)
]
for ix, iy, irot, fl, ox, oy, orot in AC_PAIRS:
    item("fmp-AirConditionerWall01", ix, iy, 800, 260, fl, rot=irot, elev=2050)
    item("ac-outdoor", ox, oy, 800, 300, 1, rot=orot, color="#d8dadc")

# 道路・電柱・隣家
item("road", 5280, SY1 + 2275, 30000, 4550, 1, color="#55585c", contextHeight=70)
item("utility-pole", 10600, SY1 + 4300, 350, 350, 1, rot=0, color="#8c9297",
     contextHeight=6500)
item("neighbor-house", 14560, 3485, 7280, 6370, 1,
     color="#d7c1a3", contextFloors=2, contextHeight=6300, contextGhost=True)
item("neighbor-house", -4960, 3985, 7280, 6370, 1,
     color="#c9c2b4", contextFloors=2, contextHeight=6300, contextGhost=True)
item("neighbor-house", 4340, -4615, 7280, 6370, 1,
     color="#b9bcc2", contextFloors=2, contextHeight=6300, contextGhost=True)
item("neighbor-building", -3200, SY1 + 6850, 5200, 3600, 1,
     color="#8f98a3", contextFloors=3, contextHeight=9150, contextGhost=True)

# ══════════ 1F 家具 ══════════
# ── 浴室 (1坪UB)
item("fmp-BathTub03", 400, 800, 1179, 535, 1, rot=90)
item("fmp-ShowerSystem03", 1200, 300, 281, 451, 1, rot=180)
item("im0261-Mirror-MEGA_PACK_Mirror-mirror-35799_410_frame_black",
     700, 90, 409, 42, 1, rot=180, elev=1000)

# ── 洗面脱衣室 (1坪)
item("washer", 3260, 390, 640, 640, 1, rot=180)
item("fmp-BathroomVanity07", 2250, 300, 682, 426, 1, rot=180)
item("fmp-WashBasin01", 2250, 300, 644, 435, 1, rot=180, elev=695)
item("im0261-Mirror-MEGA_PACK_Mirror-mirror-35799_410_frame_black",
     2250, 90, 409, 42, 1, rot=180, elev=1000)

# ── ランドリー (室内干し。洗う→干す→しまうが1階で完結する)
item("im0261-Shelf-MEGA_PACK_Shelf-shelf-161715", 2600, 2280, 816, 266, 1,
     rot=0, elev=1500)
item("im0261-Bath-MEGA_PACK_BATH-basket-304967-Gray", 3300, 2280, 442, 342, 1,
     rot=0)

# ── キッチン (背面450 / 通路1595 / 対面600)
kx = 3760
for t, w in (("fmp-CabinetD01", 366), ("fmp-CabinetD_Sink", 732),
             ("fmp-CabinetD03", 364)):
    item(t, kx + w / 2, 2380, w, 519, 1, rot=0)
    kx += w
item("fmp-GasStove07", 5000, 2360, 530, 470, 1, rot=0, elev=797)
item("fmp-KitchenExhaust07", 5000, 2370, 466, 466, 1, rot=0, elev=1900)
item("fmp-Refrigerator02", 4060, 420, 640, 695, 1, rot=180)
item("im0261-Cabinet-MEGA_PACK_CABINET-cabinet-149435_frame_brown",
     5320, 300, 1600, 450, 1, rot=180)
item("im0261-Kitchen-MEGA_PACK_kitchen-electronic-298603_Frame_Black",
     4800, 300, 340, 351, 1, rot=180, elev=710)
item("im0261-Kitchen-MEGA_PACK_kitchen-electronic-drip-coffee-machine_red",
     5600, 300, 255, 270, 1, rot=180, elev=710)

# ── LDK: 北がダイニング、南がリビング(TVは西壁・ソファは東から西を向く)
item("im0261-Tableset-MEGA_PACK_Tableset-tableset_614454_Frame_Walnut",
     4700, 3550, 1758, 1329, 1, rot=0)
item("im0261-Plant-MEGA_PACK_Plant-plant-230510", 3100, 3250, 618, 719, 1, rot=0)
item("im0261-Carpet-MEGA_PACK_Carpet-carpet-221115_frame_granada",
     4600, 5500, 2500, 2000, 1, rot=0)
item("im0261-Sofa-MEGA_PACK_Sofa-2-seater_fabric_sofa", 3310, 5500, 1373, 1029, 1,
     rot=90)                                                # 西壁づけ・東を向く
item("im0261-Table-MEGA_PACK_Table-table-309959", 4700, 5500, 460, 460, 1, rot=0)
item("im0261-Decor-MEGA_PACK_decor-decor-roland_pom_pom_chrysanthemum_flower_frame_li",
     4700, 5500, 270, 209, 1, rot=0, elev=513)
item("im0261-Cabinet-MEGA_PACK_CABINET-cabinet-149435_frame_brown",
     6085, 6350, 1600, 450, 1, rot=-90)                     # TVボード(東壁)
item("im0261-Tv-MEGA_PACK_tv-electronic-280915", 6200, 6350, 1230, 211, 1,
     rot=-90, elev=900)                                     # 壁掛けTV
item("im0261-Painting-MEGA_PACK_Painting-painting_366907_Frame_50X70cm_White",
     6290, 4200, 499, 29, 1, rot=-90, elev=1350)
item("im0261-Curtain-MEGA_PACK_Curtain-curtain-177647", 3550, 7150, 1404, 103, 1,
     rot=180)
item("im0261-Curtain-MEGA_PACK_Curtain-curtain-177647", 4850, 7150, 1404, 103, 1,
     rot=180)

# ── 洋室(1F・客間/子どもの遊び場)
item("im0261-Carpet-MEGA_PACK_Carpet-carpet-29915_frame", 1400, 5000, 2000, 1500, 1,
     rot=0)
item("im0261-Kid-MEGA_PACK_kid-kid_ADADA-ROCKING-HORSE_1", 900, 4000, 338, 762, 1,
     rot=0)
item("im0261-Kid-MEGA_PACK_kid-kid-lillabo_frame_wood", 1300, 4700, 1186, 480, 1,
     rot=0)
item("im0261-Kid-MEGA_PACK_kid-kid_691953_Frame_Guliguli_Tiger",
     2350, 5900, 525, 230, 1, rot=70)
item("im0261-Pet-MEGA_PACK_Pet-pet-43005_Frame_Green", 3100, 4100, 520, 520, 1,
     rot=15)
item("im0261-Cabinet-MEGA_PACK_CABINET-cabinet-19565_Frame",
     420, 5475, 750, 300, 1, rot=90)
item("im0261-Curtain-MEGA_PACK_Curtain-curtain-177647", 900, 7150, 1404, 103, 1,
     rot=180)
item("im0261-Curtain-MEGA_PACK_Curtain-curtain-177647", 1900, 7150, 1404, 103, 1,
     rot=180)
item("im0261-Curtain-MEGA_PACK_Curtain-curtain-230615", 100, 4200, 2202, 35, 1,
     rot=90, elev=660)

# ── トイレ・パントリー・玄関
item("fmp-Toilet01", 6825, 2140, 339, 516, 1, rot=180)
item("im0261-Bath-MEGA_PACK_BATH-bath-l933_all_in_one_washbasin_frame",
     6825, 3280, 555, 470, 1, rot=180)
item("im0261-Shelf-MEGA_PACK_Shelf-shelf-344463_ModernAcacia-Black",
     6825, 300, 800, 320, 1, rot=180)
item("im0261-Cabinet-MEGA_PACK_CABINET-cabinet-143628_frame_1_naturalwood",
     6640, 6500, 830, 400, 1, rot=90)                       # 下駄箱(西壁)
item("im0261-Mirror-MEGA_PACK_Mirror-mirror-220010_frame_gold",
     8110, 6500, 600, 35, 1, rot=-90)
item("im0261-Plant-MEGA_PACK_Plant-plant-143525_frame", 7850, 7000, 451, 458, 1,
     rot=0)
item("im0261-Painting-MEGA_PACK_Painting-painting-503147_50_70_cm",
     7200, 4200, 498, 29, 1, rot=90, elev=1350)

# ══════════ 2F 家具 ══════════
# ── 主寝室
item("fmp-Bed12", 1550, 5200, 1660, 1970, 2, rot=180)
item("im0261-Table-MEGA_PACK_Table-table-309959", 2650, 4700, 460, 460, 2, rot=0)
item("im0261-Lamp-MEGA_PACK_lamp-lamp-126685_frame", 2650, 4700, 200, 200, 2,
     rot=0, elev=513)
item("fmp-Drawer40", 3320, 6300, 1366, 515, 2, rot=-90)
item("im0261-Plant-MEGA_PACK_Plant-plant-151348_chocolate_frame",
     400, 6900, 395, 386, 2, rot=0)
item("im0261-Curtain-MEGA_PACK_Curtain-curtain-177647", 1200, 7150, 1404, 103, 2,
     rot=180)
item("im0261-Curtain-MEGA_PACK_Curtain-curtain-177647", 2400, 7150, 1404, 103, 2,
     rot=180)
item("im0261-Curtain-MEGA_PACK_Curtain-curtain-230615", 100, 5000, 2202, 35, 2,
     rot=90, elev=660)

# ── WIC (壁付けクローゼットで通路を残す)
item("fmp-Closet24", 4400, 4200, 1178, 856, 2, rot=180)
item("fmp-Closet14", 5800, 4200, 952, 773, 2, rot=180)

# ── 書斎
item("im0261-Table-MEGA_PACK_Table-table-175980_frame_brown",
     5000, 6800, 1758, 600, 2, rot=180)
item("fmp-Chair31", 5000, 6150, 616, 586, 2, rot=180)
item("im0261-Electronic-MEGA_PACK_Electronic-electronic-566595",
     5000, 6800, 420, 402, 2, rot=180, elev=739)
item("im0261-Lamp-MEGA_PACK_lamp-lamp-25416", 5750, 6800, 161, 273, 2,
     rot=180, elev=739)
item("im0261-Shelf-MEGA_PACK_Shelf-shelf-172151_frame_brown",
     3910, 6000, 806, 418, 2, rot=90)
item("im0261-Curtain-MEGA_PACK_Curtain-curtain-230615", 4800, 7150, 2202, 35, 2,
     rot=180, elev=660)

# ── 洋室A (小2の娘)
item("fmp-Table44", 2900, 340, 1049, 524, 2, rot=180)
item("fmp-Chair29", 2900, 900, 430, 442, 2, rot=0)
item("im0261-Lamp-MEGA_PACK_lamp-lamp-573754_frame", 3300, 340, 245, 239, 2,
     rot=180, elev=626)
item("fmp-Bed05", 760, 1100, 1112, 1950, 2, rot=180)
item("fmp-Closet14", 2900, 2280, 952, 773, 2, rot=0)
item("im0261-Carpet-MEGA_PACK_Carpet-carpet-224774_frame_gray",
     1800, 1900, 2000, 1500, 2, rot=0)
item("im0261-Curtain-MEGA_PACK_Curtain-curtain-230615", 1400, 100, 2202, 35, 2,
     rot=180, elev=660)
item("im0261-Curtain-MEGA_PACK_Curtain-curtain-230615", 100, 1400, 2202, 35, 2,
     rot=90, elev=660)

# ── 洋室B (2歳の息子)
item("im0261-Mattress-MEGA_PACK_Mattress-mattress-40418_SS",
     4250, 1100, 1095, 2036, 2, rot=180)
item("im0261-Carpet-MEGA_PACK_Carpet-carpet-horang_frame_orange_0000",
     5600, 1700, 880, 1189, 2, rot=0)
item("im0261-Cabinet-MEGA_PACK_CABINET-cabinet-69585", 5800, 400, 966, 410, 2,
     rot=180)
item("fmp-Drawer25", 6100, 2400, 292, 366, 2, rot=-90)
item("im0261-Curtain-MEGA_PACK_Curtain-curtain-230615", 4800, 100, 2202, 35, 2,
     rot=180, elev=660)

# ── 2Fトイレ・納戸
item("fmp-Toilet01", 6825, 400, 339, 516, 2, rot=180)
item("im0261-Shelf-MEGA_PACK_Shelf-shelf-157369", 7500, 6900, 1100, 420, 2, rot=0)

# ══════════ 照明 ══════════
light("ceiling", 4300, 5300, 1, 2380, shadow=True)   # リビング
light("ceiling", 4400, 3600, 1, 2380, shadow=True)   # ダイニング
light("ceiling", 1400, 5000, 1, 2380)                # 洋室(1F)
light("down", 4300, 700, 1, 2380)
light("down", 5500, 700, 1, 2380)
light("down", 4700, 2400, 1, 2380)                   # キッチン手元
light("down", 2700, 900, 1, 2380)
light("down", 900, 900, 1, 2380)
light("down", 1800, 2280, 1, 2380)                   # ランドリー
light("down", 6825, 2700, 1, 2380)
light("down", 6825, 4100, 1, 2380)
light("down", 7300, 5000, 1, 2380)
light("down", 7300, 6300, 1, 2380)
light("down", 7320, 7900, 1, 2600)                   # 玄関ポーチ

light("ceiling", 1800, 1400, 2, 2380)                # 洋室A
light("ceiling", 5000, 1400, 2, 2380)                # 洋室B
light("down", 6825, 900, 2, 2380)                    # 2Fトイレ
light("down", 6825, 2280, 2, 2380)                   # 2Fホール
light("down", 7735, 1400, 2, 2380)                   # 階段着地
light("down", 1500, 3180, 2, 2380)                   # 廊下
light("down", 4500, 3180, 2, 2380)
light("ceiling", 1800, 5400, 2, 2380, shadow=True)   # 主寝室
light("down", 5000, 4400, 2, 2380)                   # WIC
light("down", 4800, 6300, 2, 2380)                   # 書斎
light("down", 7280, 5900, 2, 2380)                   # 納戸

# ══════════ 注記 ══════════
item("memo", 1200, -1600, 2200, 500, 1, color="#fff3a6",
     noteText="モダン2階建てモデルプラン 4LDK+書斎\n敷地約150㎡ / 延床約117㎡(35坪)")
item("ruler", SX0 + SW / 2, SY1 + 600, SW, 120, 1, color="#2f80ed")

# ══════════ 外装カスケード ══════════
def wall_setting(color, texture):
    return {"color": color, "texture": texture,
            "textureFlipX": False, "textureFlipY": False}

ext_walls_map = {}
for w in (w_e1, w_s1e, w_e2, w_s2e):
    ext_walls_map[str(w["id"])] = wall_setting(COL_CHARCOAL, "galvalume_dark")
for w in (w_b1, w_b2, w_b3):
    ext_walls_map[str(w["id"])] = wall_setting(COL_WOOD, "wood_cedar")

plan = {
    "walls": walls,
    "rooms": rooms,
    "items": items,
    "floorMetadata": {
        "1": {"role": "residential", "occupiable": True},
        "2": {"role": "residential", "occupiable": True},
        "3": {"role": "roof", "occupiable": False},
    },
    "exteriorWallSettings": {
        "whole": {"linked": False, "color": COL_WHITE, "texture": "plaster_white",
                  "textureFlipX": False, "textureFlipY": False},
        "floors": {str(f): {"linked": False, "color": COL_WHITE,
                            "texture": "plaster_white",
                            "textureFlipX": False, "textureFlipY": False}
                   for f in (1, 2, 3, 4)},
        "walls": ext_walls_map,
        "faces": {},
    },
    "interiorWallSettings": None,
    "roofAppearance": {
        "whole": {"linked": True, "color": COL_ROOF, "texture": None,
                  "textureFlipX": False, "textureFlipY": False},
        "floors": {},
    },
    "exteriorDetail": {"gutters": True, "gutterColor": COL_ROOF},
    "viewState": {
        "twoD": {"zoom": 0.85, "panX": 120, "panY": 60},
        "ext": {"pos": [17.5, 10.5, 18.5], "target": [4.1, 2.2, 3.6]},
        "int": {"pos": [6.1, 1.85, 5.0], "target": [1.2, 1.15, 4.6]},
    },
}

out = sys.argv[1] if len(sys.argv) > 1 else "assets/default_plan.json"
with open(out, "w", encoding="utf-8") as f:
    json.dump(plan, f, ensure_ascii=False, indent=1)
print("wrote %s  walls=%d rooms=%d items=%d" % (out, len(walls), len(rooms), len(items)))
