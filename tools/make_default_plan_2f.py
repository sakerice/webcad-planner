#!/usr/bin/env python3
"""モダン注文住宅の既定プラン(default_plan.json)を生成する。

東京郊外(東京西部・神奈川・埼玉)の敷地約45坪・南道路を想定した
2階建て 4LDK+書斎。910mmモジュール。意匠は現行の注文住宅の定石に従う:
  - 片流れ屋根(北流れ・南道路側が高い)・軒の出455mm
  - 縦分割ツートーン: 白塗り壁 × 玄関ボリューム(東側)のチャコールガルバ
  - 木調アクセント: バルコニー腰壁・玄関ドア・ポーチ脇の縦格子
  - サッシ・雨樋・破風は黒で統一、窓上端は通り(2030mm)で揃える
  - 南面は壁の面を見せ、開口は掃き出し1+スリットに絞る
  - オープン外構: 土間コン+スリット目地・門柱・シンボルツリー

機能見本も兼ねる: 敷地(3種サーフェス)・基礎・外構・隣家・道路・
外壁テクスチャ・屋根・階段・規格建具・家具・照明を使う。

3D向きの規約(index.html実装から):
  - 直進階段 rot=0: 北端が最下段、南へ上る
  - 廻りコーナー rot=0: 南辺から入り東辺へ抜ける右回り(西抜けは flipX)
  - 外階段/スロープ rot=0: 北端が低く南端が高い
  - 片流れ屋根 rot=0: 南辺が高い
  - window-door は doorOpenState 未指定だと「開」で描画される

usage: python3 tools/make_default_plan_2f.py [出力パス]
"""
import json
import sys

M = 910          # 1モジュール
WALL_T = 120

# 色パレット(リサーチ準拠)
COL_WHITE = "#F2F0EB"      # 外壁メイン(白塗り壁)
COL_CHARCOAL = "#3A3D40"   # 外壁アクセント(ガルバ)
COL_WOOD = "#8B5E3C"       # 木調アクセント
COL_ROOF = "#2B2B2B"       # 屋根・雨樋・破風・金物
COL_SASH = "#1c1c1c"       # サッシ
COL_DOOR = "#5C4230"       # 玄関ドア(ダークウォールナット)
COL_FENCE = "#222222"      # 黒格子フェンス

_id = [1000]
def nid():
    _id[0] += 1
    return _id[0]

walls, rooms, items = [], [], []

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
    """中心座標で配置する。x,y,w,d は回転前の矩形、rot は中心まわりの回転。"""
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

def door(t, cx, cy, w, floor, vertical=False, color=None, **kw):
    depth = {"door-swing": w, "door-swing-s": w, "door-fold": 420,
             "door-fold-w": 420, "door-slide": 150, "door-slide-s": 150,
             "door-pocket": 150, "door-front": 200, "door-opening": 160,
             "door-opening-arch": 160}[t]
    base = {"doorHeight": 2330 if t == "door-front" else 2000,
            "doorOpenState": "closed"}
    base.update(kw)
    return item(t, cx, cy, w, depth, floor, rot=90 if vertical else 0,
                color=color or ("#f8d0a0" if t == "door-front" else "#f8e8c0"),
                **base)

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

# ── 1F 外周壁 (南面は玄関ボリュームで分割し、東側を縦アクセントにする)
w_n1 = wall(0, 0, BW, 0, 1)
w_e1 = wall(BW, 0, BW, BD, 1)                 # アクセント(チャコール)
w_s1m = wall(0, BD, 6370, BD, 1)              # 白
w_s1e = wall(6370, BD, BW, BD, 1)             # アクセント(玄関ボリューム)
w_w1 = wall(0, BD, 0, 0, 1)
# ── 1F 間仕切り
wall(0, 1820, 3640, 1820, 1)          # 浴室・洗面の南壁
wall(1820, 0, 1820, 1820, 1)          # 浴室|洗面
wall(3640, 0, 3640, 1820, 1)          # 洗面|キッチン
wall(6370, 0, 6370, BD, 1)            # 東ゾーン背骨
wall(7280, 0, 7280, 4550, 1)          # 階段室西壁
wall(6370, 1820, 7280, 1820, 1)       # パントリー南/トイレ北
wall(6370, 3640, 7280, 3640, 1)       # トイレ南
wall(7280, 910, 8190, 910, 1)         # 物入南
wall(3640, 1820, 5460, 1820, 1,       # 対面キッチン腰壁
     wallHeight=1100)

# ── 1F 部屋 (既定プランの部屋は天井高を宣言しない: tools/tests の前提)
room("浴室", 0, 0, 1820, 1820, 1, texture="tile_floor")
room("洗面脱衣室", 1820, 0, 1820, 1820, 1, texture="tile_floor")
room("キッチン", 3640, 0, 2730, 1820, 1, texture="wood_floor")
room("パントリー", 6370, 0, 910, 1820, 1, texture="wood_floor")
room("物入", 7280, 0, 910, 910, 1, texture="wood_floor")
room("トイレ", 6370, 1820, 910, 1820, 1, texture="tile_floor")
room("階段", 7280, 910, 910, 2730, 1, texture="wood_floor")
room("LDK", 0, 1820, 6370, 5460, 1, texture="wood_floor")
room("ホール", 6370, 3640, 1820, 1820, 1, texture="wood_floor")
room("玄関", 6370, 5460, 1820, 1820, 1, texture="porch_tile")

# ── 1F 建具
door("door-fold", 1820, 1000, 780, 1, vertical=True)            # 浴室
door("door-slide-s", 2600, 1820, 780, 1)                        # 洗面
door("door-opening", 6370, 900, 780, 1, vertical=True)          # パントリー
door("door-swing-s", 7280, 455, 650, 1, vertical=True)          # 物入
door("door-swing-s", 6825, 3640, 650, 1)                        # トイレ
door("door-slide", 6370, 4550, 1650, 1, vertical=True)          # LDK↔ホール
door("door-front", 7320, BD, 940, 1, color=COL_DOOR)            # 玄関ドア(木調)
door("door-swing-s", 2200, 0, 650, 1)                           # 勝手口(洗面)

# ── 1F 窓 (道路・庭側は上端2030の通りで揃える。北面は実用サッシ)
win(2000, BD, 1, "25620", 0, 2030)                    # LDK南 大開口掃き出し
win(5460, BD, 1, "F03613", 660, 1370, kind="fix")     # ダイニング南スリット
win(5000, 0, 1, "11909", 900, 970)                    # キッチン北
win(3100, 0, 1, "06905", 900, 570)                    # 洗面北
win(900, 0, 1, "06905", 1030, 570)                    # 浴室北
win(0, 3300, 1, "16513", 660, 1370, vertical=True)    # LDK西
win(0, 5800, 1, "03613", 660, 1370, vertical=True, kind="casement")  # LD西スリット
win(BW, 6100, 1, "F03613", 660, 1370, vertical=True, kind="fix")     # 玄関東スリット
win(BW, 2400, 1, "03613", 1400, 1370, vertical=True, kind="casement")  # 階段東

# ── 階段 (1F→2F: ホール(南)から北へ上り、頂部コーナーで西へ抜ける)
item("stair", 7735, 3185, 910, 2730, 1, rot=180, color="#e8e0c8", stairOrder=1)
it_corner = item("stair-corner", 7735, 1365, 910, 910, 1, rot=0,
                 color="#e8e0c8", stairOrder=2)
it_corner["flipX"] = True    # 西抜け(既定は右回り東抜け)

# ── 2F 外周壁
w_n2 = wall(0, 0, BW, 0, 2)
w_e2 = wall(BW, 0, BW, BD, 2)                 # アクセント
w_s2m = wall(0, BD, 6370, BD, 2)              # 白
w_s2e = wall(6370, BD, BW, BD, 2)             # アクセント
w_w2 = wall(0, BD, 0, 0, 2)
# ── 2F 間仕切り
wall(3640, 0, 3640, 3640, 2)          # 洋室A|B
wall(6370, 0, 6370, 3640, 2)          # 洋室B|トイレ・ホール
wall(0, 3640, 6370, 3640, 2)          # 洋室南(廊下北)
wall(6370, 1365, 7280, 1365, 2)       # 2Fトイレ南
wall(7280, 0, 7280, 910, 2)           # PS西
wall(7280, 910, 8190, 910, 2)         # PS南(吹き抜け北)
wall(7280, 1820, 7280, 4550, 2)       # 階段吹き抜け西(910-1820は昇り口)
wall(0, 4550, 8190, 4550, 2)          # 南ゾーン北壁
wall(4550, 4550, 4550, BD, 2)         # 主寝室|WIC
wall(6370, 4550, 6370, BD, 2)         # WIC|書斎

# ── 2F 部屋
room("洋室A", 0, 0, 3640, 3640, 2, texture="wood_floor")
room("洋室B", 3640, 0, 2730, 3640, 2, texture="wood_floor")
room("トイレ", 6370, 0, 910, 1365, 2, texture="tile_floor")
room("ホール", 6370, 1365, 910, 2275, 2, texture="wood_floor")
room("物入", 7280, 0, 910, 910, 2, texture="wood_floor")
room("廊下", 0, 3640, 7280, 910, 2, texture="wood_floor")
room("主寝室", 0, 4550, 4550, 2730, 2, texture="wood_floor")
room("WIC", 4550, 4550, 1820, 2730, 2, texture="wood_floor")
room("書斎", 6370, 4550, 1820, 2730, 2, texture="wood_floor")
# x7280-8190 / y910-4550 は階段吹き抜け(床なし)

# ── 2F 建具 (ドア前に家具を置かない配置とセットで決めている)
door("door-swing", 2900, 3640, 780, 2)          # 洋室A
door("door-swing", 4300, 3640, 780, 2)          # 洋室B
door("door-slide-s", 6825, 1365, 650, 2)        # 2Fトイレ(引戸: 便器と干渉しない)
door("door-swing", 3900, 4550, 780, 2)          # 主寝室(ベッドから離した東寄り)
door("door-fold-w", 5460, 4550, 1650, 2)        # WIC
door("door-swing", 6800, 4550, 780, 2)          # 書斎

# ── 2F 窓 (道路・庭側は上端2030で1Fと通りを揃える)
win(1500, 0, 2, "16513", 900, 1370)             # 洋室A北
win(4800, 0, 2, "11909", 900, 970)              # 洋室B北
win(6825, 0, 2, "06905", 1100, 570)             # 2Fトイレ北
win(0, 1500, 2, "11909", 1060, 970, vertical=True)   # 洋室A西
win(0, 5900, 2, "16513", 660, 1370, vertical=True)   # 主寝室西
win(3000, BD, 2, "16520", 0, 2030)              # 主寝室南 掃き出し(バルコニー)
win(7300, BD, 2, "F06013", 660, 1370, kind="fix")    # 書斎南 正方形寄りFIX
win(BW, 5900, 2, "F06013", 660, 1370, vertical=True, kind="fix")  # 書斎東FIX
win(BW, 2400, 2, "F03613", 900, 1370, vertical=True, kind="fix")  # 吹き抜け(1Fと縦連)

# ── バルコニー (主寝室南・木調腰壁)
item("balcony", 2730, 7880, 3640, 1200, 2, color="#c8e8c8")
w_b1 = wall(910, 8480, 4550, 8480, 2, wallStyle="balcony-fence", wallHeight=1100)
w_b2 = wall(910, 7280, 910, 8480, 2, wallStyle="balcony-fence", wallHeight=1100)
w_b3 = wall(4550, 7280, 4550, 8480, 2, wallStyle="balcony-fence", wallHeight=1100)

# ── 屋根 (フラットルーフのキューブ型・軒の出150・深い黒フェイシア)
#    片流れ(mono)は妻側の楔形隙間を壁で塞げないためフラットを採用
item("roof", BW / 2, BD / 2, BW + 300, BD + 300, 3, rot=0,
     color=COL_ROOF, roofType="flat", pitch=5, elev=0,
     roofThickness=300, roofSkirt=0, roofEdgeColor=COL_ROOF)
# 玄関ポーチのフラット庇 (2Fレベル・薄板・建物側が高い)
item("roof", 7320, 7660, 1900, 1000, 2, rot=180,
     color=COL_ROOF, roofType="mono", pitch=3, elev=0,
     roofThickness=80, roofSkirt=0, roofEdgeColor=COL_ROOF)

# ───────── 敷地・外構 ─────────
SX0, SX1 = -M, BW + 2275          # -910 .. 10465
SY0, SY1 = -M, BD + 5005          # -910 .. 12285
SW = SX1 - SX0                    # 11375

item("site-rect", SX0 + SW / 2, -455, SW, 910, 1,
     color="rgba(160,150,130,0.15)", siteSurface="gravel")     # 北側 防犯砂利
item("site-rect", SX0 + SW / 2, 3640, SW, 7280, 1,
     color="rgba(100,160,100,0.1)", siteSurface="grass")       # 庭(芝)
item("site-rect", SX0 + SW / 2, 7280 + 5005 / 2, SW, 5005, 1,
     color="rgba(150,152,155,0.15)", siteSurface="concrete")   # 南側 駐車場

# 境界: 北・西・東はブロック塀、道路側はオープン外構(門柱+コーナー格子のみ)
item("fence", SX0 + SW / 2, SY0 + 60, SW, 120, 1, color="#c0bcb4")        # 北
item("fence", SX0 + 60, (SY0 + 120 + SY1) / 2, 120, SY1 - SY0 - 120, 1,
     color="#c0bcb4")                                                     # 西
item("fence", SX1 - 60, (SY0 + 120 + SY1) / 2, 120, SY1 - SY0 - 120, 1,
     color="#c0bcb4")                                                     # 東
item("lattice-screen", 250, SY1 - 90, 2000, 60, 1, color=COL_FENCE,
     latticeHeight=1100, fencePattern="vertical", fenceTopStyle="even")   # 南西コーナー黒格子
item("lattice-screen", 9550, SY1 - 90, 1600, 60, 1, color=COL_FENCE,
     latticeHeight=1100, fencePattern="vertical", fenceTopStyle="even")   # 南東コーナー黒格子
# 門柱 (外壁アクセントと同素材のチャコール)
item("custom-block", 2500, SY1 - 500, 400, 150, 1, color=COL_CHARCOAL,
     customHeight=1500, name="門柱", texture="galvalume_dark")

# 玄関ポーチ・スロープ・勝手口 (外階段/スロープは rot=0 で南が高い)
item("exterior-stair", 7320, BD + 460, 1600, 900, 1, rot=180,
     color="#b8b2a8", targetHeight=450, accessSteps=3, texture="porch_tile")
item("ramp", 5150, BD + 910, 900, 1820, 1, rot=180,
     color="#b8b2a8", targetHeight=450)
item("exterior-stair", 2200, -360, 900, 700, 1, rot=0,
     color="#b8b2a8", targetHeight=450, accessSteps=3)
# ポーチ脇の木調縦格子(目隠し)
item("lattice-screen", 6000, 8300, 1900, 60, 1, rot=90, color=COL_WOOD,
     latticeHeight=2200, fencePattern="vertical", fenceTopStyle="even")
# タイル貼りアプローチ (ポーチから道路へ)
item("custom-block", 7320, 10230, 1100, 4090, 1, color="#b9b8b4",
     customHeight=20, name="アプローチ", texture="porch_tile")
# 土間コンのスリット目地(芝ライン)
item("custom-block", 1900, 9200, 5400, 100, 1, color="#3f8f4a",
     customHeight=15, name="スリット目地")
item("custom-block", 1900, 10600, 5400, 100, 1, color="#3f8f4a",
     customHeight=15, name="スリット目地")

# 駐車場まわり
item("car", 3600, 9750, 1850, 4500, 1, rot=0, color="#ced1d5")
item("bicycle", 9140, 8400, 580, 1850, 1, rot=0, color="#a8b4c4")
item("bicycle-fold", 9800, 8350, 550, 1450, 1, rot=0, color="#d8a878")

# 植栽 (東側の庭 + 玄関脇のシンボルツリー株立ち)
item("tree", 9200, 1100, 1500, 1500, 1, color="#5d8f52")
item("tree", 9300, 3600, 1300, 1300, 1, color="#5d8f52")
item("tree", 8800, 6300, 1500, 1500, 1, color="#6a9a58")   # シンボルツリー
item("tree", 9150, 6700, 900, 900, 1, color="#7aa862")     # 株立ちの添え

# 住宅設備 (外部)。雨樋・竪樋の金物は黒で統一
item("ac-outdoor", 4300, -300, 800, 300, 1, color="#d8dadc")
item("ac-outdoor", 5400, -300, 800, 300, 1, color="#d8dadc")
item("ac-outdoor", 8500, 2400, 800, 300, 1, rot=90, color="#d8dadc")
item("water-heater", 6500, -470, 630, 760, 1, color="#e8e9eb")
item("gas-heater", -180, 5100, 470, 240, 1, rot=90, color="#e8e9eb")
item("meter-box", -70, 2990, 180, 120, 1, rot=90, color="#c8cacc", elev=1600)
item("sewer-pit", 1500, -455, 300, 300, 1, color="#6f7275")
item("sewer-pit", 5000, -455, 300, 300, 1, color="#6f7275")
item("sewer-pit", 7000, 7600, 300, 300, 1, color="#6f7275")
for cx, cy in ((-160, -160), (BW + 160, -160), (-160, BD + 160), (BW + 160, BD + 160)):
    item("downspout", cx, cy, 150, 150, 1, color=COL_ROOF, downspoutTop=5850)

# 道路・電柱・隣家 (電線はrot=0でX方向=道路と平行に張られる)
item("road", 5280, SY1 + 2275, 16380, 4550, 1, color="#55585c", contextHeight=70)
item("utility-pole", 10600, SY1 + 250, 350, 350, 1, rot=0, color="#8c9297",
     contextHeight=6500)
item("neighbor-house", 10920 + 3640, 300 + 3185, 7280, 6370, 1,
     color="#d7c1a3", contextFloors=2, contextHeight=6300, contextGhost=True)
item("neighbor-house", -8600 + 3640, 800 + 3185, 7280, 6370, 1,
     color="#c9c2b4", contextFloors=2, contextHeight=6300, contextGhost=True)
item("neighbor-house", 700 + 3640, -7800 + 3185, 7280, 6370, 1,
     color="#b9bcc2", contextFloors=2, contextHeight=6300, contextGhost=True)
item("neighbor-building", -3200, SY1 + 4550 + 500 + 1800, 5200, 3600, 1,
     color="#8f98a3", contextFloors=3, contextHeight=9150, contextGhost=True)

# ───────── 家具・住設 (1F) ─────────
# キッチン: 対面ペニンシュラ (腰壁の内側にキャビネット列、通路側=北を向く)
kx = 3700
for t, w in (("fmp-CabinetD01", 410), ("fmp-CabinetD02", 410),
             ("fmp-CabinetD_Sink", 760), ("fmp-CabinetD03", 370),
             ("fmp-CabinetD04", 370)):
    item(t, kx + w / 2, 1460, w, 600, 1, rot=180)
    kx += w
item("fmp-GasStove07", 5465, 1440, 530, 470, 1, rot=180, elev=797)
item("fmp-KitchenExhaust02", 5465, 1450, 750, 575, 1, rot=180, elev=2086)
item("fmp-Refrigerator03", 5970, 440, 700, 700, 1, rot=180)
item("custom-block", 4450, 305, 1500, 450, 1, color="#d9d4c9",
     customHeight=900, name="カップボード")
# ダイニング
item("fmp-Table35", 4600, 2700, 1269, 619, 1, rot=0)
item("fmp-Chair37", 4300, 2200, 384, 440, 1, rot=180)
item("fmp-Chair37", 4950, 2200, 384, 440, 1, rot=180)
item("fmp-Chair37", 4300, 3200, 384, 440, 1, rot=0)
item("fmp-Chair37", 4950, 3200, 384, 440, 1, rot=0)
# リビング (西壁にTV)
item("custom-block", 350, 5000, 450, 1500, 1, color="#4a4038",
     customHeight=500, name="TVボード")
item("im0261-Tv-MEGA_PACK_tv-electronic-126724_frame", 330, 5000, 726, 225, 1,
     rot=90, elev=500)
item("im0261-Sofa-MEGA_PACK_Sofa-2-seater_modular_sofa", 2450, 5000, 1200, 983, 1,
     rot=270)
item("fmp-Sofa39", 3350, 5000, 566, 712, 1, rot=-90)   # 掃き出し窓前1mを空ける
item("fmp-Table27", 1500, 5050, 897, 860, 1, rot=0)
# 水まわり (浴槽は西壁沿い: 東側の折戸と干渉しない)
item("fmp-BathTub03", 500, 910, 1680, 762, 1, rot=90)
item("washer", 2950, 380, 640, 640, 1, color="#dddddd")
item("fmp-BathroomVanity07", 3400, 1100, 700, 460, 1, rot=-90)
item("fmp-WashBasin01", 3400, 1100, 700, 460, 1, rot=-90, elev=700)
item("fmp-Toilet01", 6825, 2350, 460, 700, 1, rot=180)
# 玄関・パントリー
item("custom-block", 7985, 6200, 380, 1200, 1, color="#8a7a63",
     customHeight=1000, name="下駄箱")   # 玄関ドアの開閉域(x<=7790)の外
item("custom-block", 6820, 350, 780, 350, 1, color="#cfc8ba",
     customHeight=1800, name="棚")
# エアコン (壁掛け)
item("fmp-AirConditionerWall01", 1000, 1960, 800, 260, 1, rot=180, elev=2200)

# ───────── 家具 (2F) ─────────
item("fmp-Bed11", 1104, 5460, 1680, 2087, 2, rot=90)   # 西壁沿い横置き(掃き出し窓前1mを空ける)
item("fmp-Drawer40", 750, 7050, 1200, 452, 2, rot=180)   # 掃き出し窓(x1655-)を塞がない
item("fmp-AirConditionerWall01", 900, 4760, 800, 260, 2, rot=0, elev=2200)
item("custom-block", 5450, 6900, 1600, 550, 2, color="#cfc8ba",
     customHeight=1700, name="収納")
item("fmp-Table34", 1000, 400, 1200, 600, 2, rot=180)          # 洋室A 机
item("futon_set", 2600, 1800, 1000, 2100, 2, color="#d8d0e8")  # ドア開閉域の外
item("fmp-Table43", 4400, 320, 1200, 522, 2, rot=180)          # 洋室B 机
item("futon_set", 5600, 2000, 1000, 2100, 2, color="#d8d0e8")
item("fmp-Table34", 7400, 6300, 1200, 600, 2, rot=90)          # 書斎 机(東窓下)
item("fmp-Chair14", 6820, 6300, 520, 505, 2, rot=90)
item("fmp-Toilet01", 6825, 500, 460, 700, 2, rot=0)

# ───────── 照明 ─────────
for cx, cy, sh in ((2200, 4500, True), (4500, 3300, True)):
    light("ceiling", cx, cy, 1, 2380, shadow=sh)
light("down", 4200, 900, 1, 2380)
light("down", 5400, 900, 1, 2380)
light("down", 2700, 950, 1, 2380)
light("down", 900, 950, 1, 2380)
light("down", 6825, 2800, 1, 2380)
light("down", 6900, 4550, 1, 2380)
light("down", 7300, 6300, 1, 2380)
light("down", 7320, 7600, 1, 2600)     # 玄関ポーチ(庇下)
light("ceiling", 1800, 1800, 2, 2380)
light("ceiling", 5000, 1800, 2, 2380)
light("ceiling", 2200, 5900, 2, 2380, shadow=True)
light("down", 2500, 4100, 2, 2380)
light("down", 5500, 4100, 2, 2380)
light("down", 6825, 2500, 2, 2380)
light("down", 5460, 5900, 2, 2380)
light("down", 7280, 5900, 2, 2380)
light("down", 6825, 700, 2, 2380)
light("down", 7735, 2700, 2, 2380)     # 吹き抜け(階段上部)

# ───────── 注記 ─────────
item("memo", 1200, -1600, 2200, 500, 1, color="#fff3a6",
     noteText="モダン2階建てモデルプラン 4LDK+書斎\n敷地約150㎡ / 延床約109㎡")
item("ruler", SX0 + SW / 2, SY1 + 600, SW, 120, 1, color="#2f80ed")

# ───────── 外装のカスケード設定 ─────────
def wall_setting(color, texture):
    return {"color": color, "texture": texture,
            "textureFlipX": False, "textureFlipY": False}

accent_walls = [w_e1, w_s1e, w_e2, w_s2e]
wood_walls = [w_b1, w_b2, w_b3]
ext_walls_map = {}
for w in accent_walls:
    ext_walls_map[str(w["id"])] = wall_setting(COL_CHARCOAL, "galvalume_dark")
for w in wood_walls:
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
        # whole/floor とも linked=false にして壁単位の上書きを効かせる
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
        "int": {"pos": [2.6, 2.0, 5.6], "target": [5.2, 1.6, 3.2]},
    },
}

out = sys.argv[1] if len(sys.argv) > 1 else "assets/default_plan.json"
with open(out, "w", encoding="utf-8") as f:
    json.dump(plan, f, ensure_ascii=False, indent=1)
print("wrote %s  walls=%d rooms=%d items=%d" % (out, len(walls), len(rooms), len(items)))
