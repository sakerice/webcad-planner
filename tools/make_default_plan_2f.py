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
w_n1 = wall(0, 0, BW, 0, 1)
w_e1 = wall(BW, 0, BW, BD, 1)                 # アクセント(チャコール)
w_s1m = wall(0, BD, 6370, BD, 1)              # 白
w_s1e = wall(6370, BD, BW, BD, 1)             # アクセント(玄関ボリューム)
w_w1 = wall(0, BD, 0, 0, 1)

wall(0, 1820, 3640, 1820, 1)          # 浴室・洗面の南壁
wall(1820, 0, 1820, 1820, 1)          # 浴室|洗面
wall(3640, 0, 3640, 1820, 1)          # 洗面|キッチン
wall(6370, 0, 6370, BD, 1)            # 東ゾーン背骨
wall(7280, 0, 7280, 4550, 1)          # 階段室西壁
wall(6370, 1820, 7280, 1820, 1)       # パントリー南
wall(6370, 3640, 7280, 3640, 1)       # トイレ南
wall(7280, 910, 8190, 910, 1)         # 物入南
wall(7280, 6370, 8190, 6370, 1)       # SIC南
wall(7280, 5460, 7280, 6370, 1)       # SIC西
wall(3640, 2275, 5460, 2275, 1, wallHeight=1100)   # 対面キッチン腰壁
# 直下率確保の袖壁。2Fの y3640 / y4550 の壁を6370mmのクリアスパンで受けるのは
# 在来木造では成立しないため、1Fに受けを立ててスパンを4550以下に割る
wall(1820, 3640, 2730, 3640, 1)
wall(4550, 4550, 5460, 4550, 1)

room("浴室", 0, 0, 1820, 1820, 1, texture="tile_floor")
room("洗面脱衣室", 1820, 0, 1820, 1820, 1, texture="tile_floor")
room("キッチン", 3640, 0, 2730, 2275, 1, texture="wood_floor")
room("パントリー", 6370, 0, 910, 1820, 1, texture="wood_floor")
room("物入", 7280, 0, 910, 910, 1, texture="wood_floor")
room("トイレ", 6370, 1820, 910, 1820, 1, texture="tile_floor")
room("階段", 7280, 910, 910, 3640, 1, texture="wood_floor")
room("LDK", 0, 1820, 3640, 5460, 1, texture="wood_floor")
room("", 3640, 2275, 2730, 5005, 1, texture="wood_floor")   # LDK東(ラベルは西に集約)
room("ホール", 6370, 3640, 910, 1820, 1, texture="wood_floor")
room("", 7280, 4550, 910, 910, 1, texture="wood_floor")     # ホール東(階段下)
room("玄関", 6370, 5460, 910, 1820, 1, texture="porch_tile")
room("", 7280, 6370, 910, 910, 1, texture="porch_tile")      # 玄関東(土間)
room("SIC", 7280, 5460, 910, 910, 1, texture="wood_floor")   # シューズクローク

# ── 1F 建具 (flipY=True は -y=北側へ開く)
door("door-fold", 1820, 1000, 780, 1, vertical=True)
door("door-slide-s", 2600, 1820, 780, 1)
door("door-opening", 6370, 900, 780, 1, vertical=True)
door("door-slide-s", 7280, 455, 650, 1, vertical=True)          # 物入(引戸)
door("door-swing-s", 6825, 3640, 650, 1, flipY=True)            # トイレ(室内開き)
door("door-slide", 6370, 4550, 1650, 1, vertical=True)          # LDK↔ホール
door("door-front", 7320, BD, 940, 1, color=COL_DOOR)            # 玄関ドア(外開き)
door("door-swing-s", 2200, 0, 650, 1, flipY=True)               # 勝手口(外開き)
door("door-opening", 7280, 5915, 780, 1, vertical=True)         # SIC

# ── 1F 窓 (上端2030の通りで揃える)
win(2000, BD, 1, "25620", 0, 2030)                    # LDK南 大開口
win(5000, BD, 1, "F11913", 660, 1370, kind="fix")     # ダイニング南FIX
win(5000, 0, 1, "11909", 1060, 970)                   # キッチン北
win(3100, 0, 1, "06905", 1460, 570)                   # 洗面北
win(900, 0, 1, "06905", 1460, 570)                    # 浴室北
win(0, 3300, 1, "16513", 660, 1370, vertical=True)    # LDK西
win(0, 5800, 1, "03613", 660, 1370, vertical=True, kind="casement")
win(BW, 6800, 1, "F03613", 660, 1370, vertical=True, kind="fix")      # 玄関東
win(BW, 2400, 1, "03613", 660, 1370, vertical=True, kind="casement")  # 階段東

# ── 階段 (ホール(南)から北へ上り、頂部コーナーで西へ抜ける)
item("stair", 7735, 3185, 910, 2730, 1, rot=180, color="#e8e0c8", stairOrder=1)
_c = item("stair-corner", 7735, 1365, 910, 910, 1, rot=0,
          color="#e8e0c8", stairOrder=2)
_c["flipX"] = True

# ══════════ 2F ══════════
# 東ゾーンは階段着地から廊下まで一直線の縦動線にし、トイレは北外壁側へ。
# (旧案は上り口の壁が455mm欠落し、トイレが階段室に開放されていた)
w_n2 = wall(0, 0, BW, 0, 2)
w_e2 = wall(BW, 0, BW, BD, 2)
w_s2m = wall(0, BD, 6370, BD, 2)
w_s2e = wall(6370, BD, BW, BD, 2)
w_w2 = wall(0, BD, 0, 0, 2)

wall(3640, 0, 3640, 3640, 2)          # 洋室A|洋室B
wall(5460, 0, 5460, 1365, 2)          # 洋室B|2Fトイレ
wall(5460, 1365, 6370, 1365, 2)       # 2Fトイレ南
wall(5460, 1365, 5460, 2275, 2)       # 洋室B|CL
wall(5460, 2275, 6370, 2275, 2)       # 洋室BのCL南
wall(6370, 0, 6370, 3640, 2)          # 北ゾーン|2Fホール
wall(0, 2730, 1820, 2730, 2)          # 洋室A|CL
wall(1820, 2730, 1820, 3640, 2)       # CL|洋室A(南の張り出し)
wall(0, 3640, 6370, 3640, 2)          # 北ゾーン南壁
wall(7280, 0, 7280, 910, 2)           # 2Fホール|PS
wall(7280, 910, 8190, 910, 2)         # PS南(階段着地の北)
wall(7280, 1820, 7280, 4550, 2)       # 2Fホール|吹き抜け
wall(0, 4550, 8190, 4550, 2)          # 南ゾーン北壁
wall(910, 3640, 910, 4550, 2)         # リネン庫東
wall(4550, 4550, 4550, BD, 2)         # 主寝室|WIC
wall(6370, 4550, 6370, BD, 2)         # WIC|書斎

room("洋室A", 0, 0, 3640, 2730, 2, texture="wood_floor")
room("", 1820, 2730, 1820, 910, 2, texture="wood_floor")     # 洋室A南の張り出し
room("CL", 0, 2730, 1820, 910, 2, texture="wood_floor")
room("洋室B", 3640, 0, 1820, 3640, 2, texture="wood_floor")
room("CL", 5460, 1365, 910, 910, 2, texture="wood_floor")    # 洋室BのCL
room("", 5460, 2275, 910, 1365, 2, texture="wood_floor")     # 洋室B東の張り出し
room("トイレ", 5460, 0, 910, 1365, 2, texture="tile_floor")
room("ホール", 6370, 0, 910, 3640, 2, texture="wood_floor")
room("", 7280, 910, 910, 910, 2, texture="wood_floor")       # 階段着地
room("PS", 7280, 0, 910, 910, 2, texture="wood_floor")
room("リネン庫", 0, 3640, 910, 910, 2, texture="wood_floor")
room("廊下", 910, 3640, 6370, 910, 2, texture="wood_floor")
room("主寝室", 0, 4550, 4550, 2730, 2, texture="wood_floor")
room("WIC", 4550, 4550, 1820, 2730, 2, texture="wood_floor")
room("書斎", 6370, 4550, 1820, 2730, 2, texture="wood_floor")
# x7280-8190 / y1820-4550 は階段吹き抜け(床なし)

# ── 2F 建具
door("door-swing", 2600, 3640, 780, 2, flipY=True)      # 洋室A(室内開き)
door("door-fold-w", 910, 2730, 1650, 2, flipY=True)     # CL
door("door-swing", 5000, 3640, 780, 2, flipY=True)      # 洋室B(室内開き)
door("door-slide-s", 6370, 680, 650, 2, vertical=True)  # 2Fトイレ(引戸)
door("door-slide-s", 5915, 2275, 650, 2)               # 洋室BのCL(引戸・張り出しから)
door("door-slide-s", 910, 4095, 650, 2, vertical=True)  # リネン庫(引戸)
door("door-swing", 3000, 4550, 780, 2)                  # 主寝室(室内開き=南)
door("door-fold", 5950, 4550, 780, 2)                   # WIC
door("door-slide-s", 4550, 4900, 650, 2, vertical=True) # 主寝室↔WIC
door("door-swing", 6900, 4550, 780, 2)                  # 書斎

# ── 2F 窓 (上端2030で1Fと通りを揃える)
win(1500, 0, 2, "16513", 660, 1370)                   # 洋室A北
win(0, 1500, 2, "11909", 1060, 970, vertical=True)    # 洋室A西
win(4500, 0, 2, "16513", 660, 1370)                   # 洋室B北
win(5915, 0, 2, "06905", 1460, 570)                   # 2Fトイレ北
win(0, 5900, 2, "16513", 660, 1370, vertical=True)    # 主寝室西
win(2900, BD, 2, "16520", 0, 2030)                    # 主寝室南 掃き出し
win(7300, BD, 2, "F06013", 660, 1370, kind="fix")     # 書斎南FIX
win(BW, 5900, 2, "03613", 660, 1370, vertical=True, kind="casement")  # 書斎東(開閉可)
win(BW, 2400, 2, "F03613", 660, 1370, vertical=True, kind="fix")      # 吹き抜け東

# ── バルコニー (主寝室南・木調腰壁・出910に収める)
item("balcony", 2730, 7735, 3640, 910, 2, color="#c8e8c8")
w_b1 = wall(910, 8190, 4550, 8190, 2, wallStyle="balcony-fence", wallHeight=1100)
w_b2 = wall(910, 7280, 910, 8190, 2, wallStyle="balcony-fence", wallHeight=1100)
w_b3 = wall(4550, 7280, 4550, 8190, 2, wallStyle="balcony-fence", wallHeight=1100)

# ── 屋根 (フラットルーフのキューブ型)
item("roof", BW / 2, BD / 2, BW + 300, BD + 300, 3, rot=0,
     color=COL_ROOF, roofType="flat", pitch=5, elev=0,
     roofThickness=300, roofSkirt=0, roofEdgeColor=COL_ROOF)
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
item("lattice-screen", 6000, 8300, 2100, 60, 1, rot=90, color=COL_WOOD,
     latticeHeight=2000, fencePattern="vertical", fenceTopStyle="even")
item("custom-block", 6350, 11750, 400, 150, 1, color=COL_CHARCOAL,
     customHeight=1500, name="門柱", texture="galvalume_dark")

# 玄関ポーチ(平坦な踏込み)+階段。ドアが階段の上に直接開かないようにする
item("custom-block", 7320, 7880, 1600, 1200, 1, color="#b9b8b4",
     customHeight=450, name="玄関ポーチ", texture="porch_tile")
item("exterior-stair", 7320, 8930, 1600, 900, 1, rot=180,
     color="#b8b2a8", targetHeight=450, accessSteps=3, texture="porch_tile")
item("custom-block", 7320, 10830, 1100, 2900, 1, color="#b9b8b4",
     customHeight=20, name="アプローチ", texture="porch_tile")
# LDK大開口の外のウッドデッキ(FL450の段差解消)
item("custom-block", 1900, 7800, 2600, 900, 1, color=COL_WOOD,
     customHeight=450, name="ウッドデッキ", texture="wood_cedar")
item("exterior-stair", 1900, 8480, 1800, 450, 1, rot=180,
     color="#b8b2a8", targetHeight=450, accessSteps=2)
# 勝手口の外階段
item("exterior-stair", 2200, -360, 900, 700, 1, rot=0,
     color="#b8b2a8", targetHeight=450, accessSteps=3)
# 土間コンのスリット目地
item("custom-block", 2500, 10100, 5000, 100, 1, color="#3f8f4a",
     customHeight=15, name="スリット目地")
item("custom-block", 2500, 11400, 5000, 100, 1, color="#3f8f4a",
     customHeight=15, name="スリット目地")

# 駐車(道路並列)・自転車
item("car", 3450, 10700, 1850, 4500, 1, rot=90, color="#ced1d5")
item("bicycle", 8800, 10200, 580, 1850, 1, rot=0, color="#a8b4c4")
item("bicycle-fold", 9400, 10200, 550, 1450, 1, rot=0, color="#d8a878")

# 植栽
item("tree", 9200, 1100, 1500, 1500, 1, color="#6f855f")
item("tree", 9300, 3600, 1300, 1300, 1, color="#74895f")
item("tree", 8800, 6300, 1500, 1500, 1, color="#7d9268")   # シンボルツリー
item("tree", 9150, 6700, 900, 900, 1, color="#86996f")
item("tree", 5200, 8600, 1500, 1500, 1, color="#7d9268")   # 南庭

# 住宅設備。給湯器はガス1台に統一し、北側通路を塞がない位置へ
item("gas-heater", 300, -250, 470, 240, 1, color="#e8e9eb")
item("meter-box", -70, 1200, 180, 120, 1, rot=90, color="#c8cacc", elev=1600)
item("sewer-pit", 2200, -500, 300, 300, 1, color="#6f7275")
item("sewer-pit", 5600, -500, 300, 300, 1, color="#6f7275")
item("sewer-pit", 8600, -500, 300, 300, 1, color="#6f7275")
item("sewer-pit", 8600, 3600, 300, 300, 1, color="#6f7275")
item("sewer-pit", 7000, 9600, 300, 300, 1, color="#6f7275")
for cx, cy in ((-160, -160), (BW + 160, -160), (-160, BD + 160), (BW + 160, BD + 160)):
    item("downspout", cx, cy, 150, 150, 1, color=COL_ROOF, downspoutTop=5850)

# エアコン: 室内機は必ず外壁面。室外機は配管長3m以内に対で置く
AC_PAIRS = [
    # (室内機 cx, cy, rot, floor, 室外機 cx, cy, rot)
    (190, 3000, 90, 1, -330, 3000, 90),        # LDK(西壁)
    (800, 190, 180, 2, 1400, -300, 0),         # 洋室A(北壁)
    (4200, 190, 180, 2, 4500, -300, 0),        # 洋室B(北壁)
    (190, 5000, 90, 2, -330, 5000, 90),        # 主寝室(西壁)
    (8000, 5000, -90, 2, 8500, 5000, -90),     # 書斎(東壁)
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
# ── キッチン: 対面ペニンシュラ。東側に910の出入口を残す
item("fmp-CabinetD01", 3885, 1920, 366, 519, 1, rot=0)
item("fmp-CabinetD_Sink", 4434, 1920, 732, 519, 1, rot=0)
item("fmp-CabinetD03", 4982, 1920, 364, 519, 1, rot=0)
item("fmp-GasStove07", 4982, 1900, 530, 470, 1, rot=0, elev=797)
item("fmp-KitchenExhaust07", 4982, 1910, 466, 466, 1, rot=0, elev=1900)  # 島型
item("fmp-Refrigerator02", 4040, 470, 640, 695, 1, rot=180)
item("im0261-Cabinet-MEGA_PACK_CABINET-cabinet-149435_frame_brown",
     5220, 300, 1600, 450, 1, rot=180)                      # 背面カウンター
item("im0261-Kitchen-MEGA_PACK_kitchen-electronic-298603_Frame_Black",
     4700, 300, 340, 351, 1, rot=180, elev=710)
item("im0261-Kitchen-MEGA_PACK_kitchen-electronic-drip-coffee-machine_red",
     5400, 300, 255, 270, 1, rot=180, elev=710)
item("im0261-Plant-MEGA_PACK_Plant-plant-317746", 5700, 240, 403, 84, 1,
     rot=180, elev=710)

# ── ダイニング(カウンター南・横並び配膳)
item("im0261-Tableset-MEGA_PACK_Tableset-tableset_614454_Frame_Walnut",
     4800, 3600, 1758, 1329, 1, rot=0)
item("im0261-Kid-MEGA_PACK_kid-kid-677431_Brown", 4900, 2600, 520, 611, 1, rot=180)

# ── リビング(TVは西壁、ソファは東から西を向く)
item("im0261-Carpet-MEGA_PACK_Carpet-carpet-221115_frame_granada",
     1800, 4900, 2500, 2000, 1, rot=0)
item("im0261-Cabinet-MEGA_PACK_CABINET-cabinet-354290_frame_walnut_brown",
     280, 4900, 2000, 414, 1, rot=90)                       # TVローボード
item("im0261-Tv-MEGA_PACK_tv-electronic-280915", 300, 4900, 1230, 211, 1,
     rot=90, elev=610)
item("im0261-Decor-MEGA_PACK_decor-decor-71718_Frame_NaturalWood",
     300, 4400, 97, 96, 1, rot=90, elev=610)
item("im0261-Sofa-MEGA_PACK_Sofa-Covering_fabric_sofa", 2900, 4900, 2402, 999, 1,
     rot=-90)
item("im0261-Table-MEGA_PACK_Table-table-167288_frame_1190b_urbanacacia",
     1750, 4900, 1167, 779, 1, rot=0)
item("im0261-Decor-MEGA_PACK_decor-decor-roland_pom_pom_chrysanthemum_flower_frame_li",
     1750, 4900, 270, 209, 1, rot=0, elev=359)
item("im0261-Table-MEGA_PACK_Table-table-157282", 3350, 3300, 700, 350, 1, rot=-90)
item("im0261-Lamp-MEGA_PACK_lamp-lamp-31085_2", 3350, 3300, 226, 226, 1,
     rot=0, elev=501)
item("im0261-Decor-MEGA_PACK_decor-clock-116007_Frame_RoseGoldBlack",
     1900, 1915, 303, 42, 1, rot=180, elev=1500)
item("im0261-Painting-MEGA_PACK_Painting-painting_366907_Frame_50X70cm_White",
     6290, 6600, 499, 29, 1, rot=-90, elev=1350)
# カーテン(天井2400を貫通しない丈)
item("im0261-Curtain-MEGA_PACK_Curtain-curtain-177647", 1300, 7150, 1404, 103, 1,
     rot=180)
item("im0261-Curtain-MEGA_PACK_Curtain-curtain-177647", 2700, 7150, 1404, 103, 1,
     rot=180)
item("im0261-Curtain-MEGA_PACK_Curtain-curtain-230615", 90, 3300, 2202, 35, 1,
     rot=90, elev=660)
# 子どもの遊びコーナー
item("im0261-Kid-MEGA_PACK_kid-kid_ADADA-ROCKING-HORSE_1", 400, 3400, 338, 762, 1,
     rot=0)
item("im0261-Kid-MEGA_PACK_kid-kid-lillabo_frame_wood", 900, 2400, 1186, 480, 1,
     rot=0)
item("im0261-Kid-MEGA_PACK_kid-kid_691953_Frame_Guliguli_Tiger",
     900, 3400, 525, 230, 1, rot=70)
# 猫・グリーン・読書椅子
item("im0261-Plant-MEGA_PACK_Plant-Plant_447168_Frame_Brown",
     4800, 6800, 682, 835, 1, rot=0)
item("im0261-Pet-MEGA_PACK_Pet-pet-283245_1_frame", 6100, 6900, 450, 450, 1, rot=0)
item("im0261-Pet-MEGA_PACK_Pet-pet-43005_Frame_Green", 5500, 6900, 520, 520, 1,
     rot=15)

# ── 水まわり
item("fmp-BathTub03", 500, 910, 1179, 535, 1, rot=90)
item("fmp-ShowerSystem03", 1300, 300, 281, 451, 1, rot=180)
item("im0261-Mirror-MEGA_PACK_Mirror-mirror-35799_410_frame_black",
     950, 85, 409, 42, 1, rot=180, elev=1000)
item("washer", 2950, 380, 640, 640, 1, rot=180, color="#dddddd")
item("im0261-Shelf-MEGA_PACK_Shelf-shelf-161715", 2950, 190, 816, 266, 1,
     rot=180, elev=1500)
item("fmp-BathroomVanity07", 3360, 1100, 682, 426, 1, rot=-90)
item("fmp-WashBasin01", 3360, 1100, 644, 435, 1, rot=-90, elev=695)
item("im0261-Mirror-MEGA_PACK_Mirror-mirror-35799_410_frame_black",
     3560, 1100, 409, 42, 1, rot=-90, elev=1000)
item("im0261-Bath-MEGA_PACK_BATH-basket-304967-Gray", 2160, 1450, 442, 342, 1,
     rot=0)
item("fmp-Toilet01", 6825, 2140, 339, 516, 1, rot=180)

# ── パントリー・玄関
item("im0261-Shelf-MEGA_PACK_Shelf-shelf-344463_ModernAcacia-Black",
     6825, 1600, 800, 320, 1, rot=180)
item("im0261-Cabinet-MEGA_PACK_CABINET-cabinet-154332_frame", 7735, 5745,
     780, 430, 1, rot=180)                                  # SIC トール収納
item("im0261-Shelf-MEGA_PACK_Shelf-shelf-310090_frame_natural", 7735, 6140,
     597, 305, 1, rot=0)                                    # SIC 可動棚
item("im0261-Decor-MEGA_PACK_decor-decor_698778_frame", 8000, 7050, 357, 289, 1,
     rot=0)                                                 # 傘立て(土間東の隅)
item("im0261-Plant-MEGA_PACK_Plant-plant-144523_frame", 8020, 6560, 202, 198, 1,
     rot=0)   # 土間東の隅(910幅の土間は通路として空ける)
item("im0261-Mirror-MEGA_PACK_Mirror-mirror-220010_frame_gold",
     6430, 5800, 600, 35, 1, rot=90)
item("im0261-Painting-MEGA_PACK_Painting-painting-503147_50_70_cm",
     7200, 4100, 498, 29, 1, rot=90, elev=1350)

# ══════════ 2F 家具 ══════════
# ── 主寝室
item("fmp-Bed12", 950, 5600, 1660, 1970, 2, rot=180)
item("im0261-Table-MEGA_PACK_Table-table-309959", 2100, 4900, 460, 460, 2, rot=0)
item("im0261-Lamp-MEGA_PACK_lamp-lamp-126685_frame", 2100, 4900, 200, 200, 2,
     rot=0, elev=513)
item("im0261-Cabinet-MEGA_PACK_CABINET-cabinet-65549", 4200, 6600, 1120, 437, 2,
     rot=-90)                                               # ドレッサー
item("fmp-Chair29", 3700, 5600, 430, 442, 2, rot=90)
item("im0261-Plant-MEGA_PACK_Plant-plant-151348_chocolate_frame",
     600, 7000, 395, 386, 2, rot=0)
item("im0261-Curtain-MEGA_PACK_Curtain-curtain-177647", 2100, 7170, 1404, 103, 2,
     rot=180)
item("im0261-Curtain-MEGA_PACK_Curtain-curtain-177647", 3520, 7170, 1404, 103, 2,
     rot=180)

# ── WIC (壁付けクローゼットで歩ける幅を残す)
item("fmp-Closet24", 5300, 6790, 1178, 856, 2, rot=0)
item("fmp-Closet14", 4990, 5800, 952, 773, 2, rot=90)

# ── 洋室A (小2の娘)
item("fmp-Table44", 330, 1200, 1049, 524, 2, rot=90)        # 白デスク
item("fmp-Chair29", 830, 1200, 430, 442, 2, rot=-90)
item("im0261-Lamp-MEGA_PACK_lamp-lamp-573754_frame", 400, 900, 245, 239, 2,
     rot=0, elev=626)
item("fmp-Bed05", 2600, 700, 1112, 1950, 2, rot=90)
item("im0261-Carpet-MEGA_PACK_Carpet-carpet-224774_frame_gray",
     1800, 2000, 2000, 1500, 2, rot=0)
item("im0261-Curtain-MEGA_PACK_Curtain-curtain-177647", 1500, 105, 1404, 103, 2,
     rot=180)
item("im0261-Curtain-MEGA_PACK_Curtain-curtain-179264", 105, 1500, 1400, 63, 2,
     rot=90)
item("im0261-Painting-MEGA_PACK_Painting-painting-503147_50_70_cm",
     3560, 2400, 498, 29, 2, rot=-90, elev=1400)

# ── 洋室B (2歳の息子)
item("im0261-Mattress-MEGA_PACK_Mattress-mattress-40418_SS",
     4400, 1200, 1095, 2036, 2, rot=180)
item("im0261-Carpet-MEGA_PACK_Carpet-carpet-horang_frame_orange_0000",
     4600, 2900, 880, 1189, 2, rot=0)
item("im0261-Kid-MEGA_PACK_kid-kid-lillabo_frame_wood", 4300, 2500, 1186, 480, 2,
     rot=0)
item("im0261-Cabinet-MEGA_PACK_CABINET-cabinet-69585", 4150, 3200, 966, 410, 2,
     rot=180)
item("fmp-Drawer25", 5000, 3300, 292, 366, 2, rot=180)
item("im0261-Curtain-MEGA_PACK_Curtain-curtain-203701_yellow",
     4500, 110, 1300, 152, 2, rot=180, elev=880)

# ── 2Fトイレ
item("fmp-Toilet01", 5915, 320, 339, 516, 2, rot=180)

# ── 書斎
item("im0261-Table-MEGA_PACK_Table-table-175980_frame_brown",
     7830, 6200, 1758, 600, 2, rot=-90)
item("fmp-Chair31", 7200, 6200, 616, 586, 2, rot=90)
item("im0261-Electronic-MEGA_PACK_Electronic-electronic-566595",
     7830, 6200, 420, 402, 2, rot=-90, elev=739)
item("im0261-Lamp-MEGA_PACK_lamp-lamp-25416", 7830, 5600, 161, 273, 2,
     rot=-90, elev=739)
item("im0261-Shelf-MEGA_PACK_Shelf-shelf-172151_frame_brown",
     6900, 7000, 806, 418, 2, rot=0)
item("im0261-Plant-MEGA_PACK_Plant-plant_133259", 6580, 5600, 291, 258, 2, rot=0)

# ══════════ 照明 ══════════
light("ceiling", 1800, 4900, 1, 2380, shadow=True)   # リビング
light("ceiling", 4800, 3600, 1, 2380, shadow=True)   # ダイニング
light("down", 4300, 900, 1, 2380)
light("down", 5400, 900, 1, 2380)
light("down", 4700, 1900, 1, 2380)                   # キッチン手元
light("down", 2700, 950, 1, 2380)
light("down", 900, 950, 1, 2380)
light("down", 6825, 2700, 1, 2380)
light("down", 6900, 4600, 1, 2380)
light("down", 7300, 6300, 1, 2380)
light("down", 7320, 7900, 1, 2600)                   # 玄関ポーチ

light("ceiling", 1800, 1400, 2, 2380)                # 洋室A
light("down", 910, 3180, 2, 2380)                    # CL
light("ceiling", 4500, 1800, 2, 2380)                # 洋室B
light("down", 5915, 700, 2, 2380)                    # 2Fトイレ
light("down", 6825, 1500, 2, 2380)                   # 2Fホール
light("down", 6825, 3000, 2, 2380)
light("down", 7735, 1400, 2, 2380)                   # 階段着地
light("down", 2000, 4100, 2, 2380)                   # 廊下
light("down", 5000, 4100, 2, 2380)
light("ceiling", 1800, 5900, 2, 2380, shadow=True)   # 主寝室
light("down", 5400, 5800, 2, 2380)                   # WIC
light("down", 7400, 5800, 2, 2380)                   # 書斎

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
