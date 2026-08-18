#!/usr/bin/env python3
"""都市型3階建ての既定プラン(default_plan_3f.json)を生成する。

都心近郊(城南・川崎・横浜内陸)の間口3間・敷地約25坪・南道路の狭小地を想定した
3階建て 3LDK+WIC。910mmモジュール。用途地域は第一種住居地域の想定
(北側斜線は適用外。低層住居専用地域ではこのボリュームは建たない)。

住まい手: 30代共働き夫婦 + 小1の息子 + 保育園の娘。
1階に個室と水まわり、2階にLDK(リビング階段)、3階に寝室群という
都市型の定石。玄関横のシューズクローク、2階パントリー、
主寝室のWICで「狭くても収納は各階に」を通す。

構成(壁グリッドを3層で共有する):
  - 耐力線は x3640(背骨)・x4550(階段室)・y1820・y2730 の4本。
    3階の間仕切りは必ずこの直下に壁がある線に載せるか、
    2730mm以下の短スパンに収める(lint check14)
  - 階段は x4550-5460 に3層積む。直進(y910-3640, 南から北へ上る)+
    頂部廻り(y0-910, 西抜け)。各階の着地は西隣の廊下/ホール
  - 1F: 玄関・SIC・洋室(6帖強)・浴室・洗面・トイレ・納戸
  - 2F: LDK(リビング階段)・キッチン・パントリー・トイレ
  - 3F: 主寝室+WIC・子ども部屋×2(各CL付き)

usage: python3 tools/make_default_plan_3f.py [出力パス]
"""
import os
import sys

M = 910

# 色は2階建てプランと同じ規則(明度 天井>壁>建具>床>家具、明るい面ほど低彩度)。
# 外観は白基調に、階段室の東面だけチャコールのガルバで縦のボリュームを立てる。
COL_WALL_INT = "#EFEDE7"
COL_ACCENT = "#6F6B64"
COL_WHITE = "#F2F0EB"
COL_CHARCOAL = "#3A3D40"
COL_WOOD = "#8B5E3C"
COL_ROOF = "#2B2B2B"
COL_SASH = "#1c1c1c"
COL_DOOR = "#5C4230"
COL_FENCE = "#222222"

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from plan_kit import Plan, load_catalog, wall_setting, finish_cascade  # noqa: E402

CATALOG = load_catalog(ROOT)
P = Plan(catalog=CATALOG, interior_color=COL_WALL_INT)
wall, room, item = P.wall, P.room, P.item
win, door, light = P.win, P.door, P.light

# ───────── 躯体 (footprint 5460×8190 = 6P×9P, 各階44.7㎡) ─────────
BW, BD = 6 * M, 9 * M      # 5460 × 8190

item("foundation", BW / 2, BD / 2, BW, BD, 1, color="#474747",
     foundationHeight=450)

# ══════════ 1F ══════════
w_n1 = wall(0, 0, BW, 0, 1)
w_e1 = wall(BW, 0, BW, BD, 1)                 # 階段室(チャコール)
w_s1 = wall(0, BD, BW, BD, 1)
w_w1 = wall(0, BD, 0, 0, 1)

wall(1820, 0, 1820, 1820, 1)          # 浴室|洗面
wall(3640, 0, 3640, 1820, 1)          # 洗面|トイレ (背骨の北端)
wall(0, 1820, 1820, 1820, 1)          # 浴室|リネン・廊下
wall(1820, 1820, 3640, 1820, 1)       # 洗面|廊下
wall(3640, 1820, 4550, 1820, 1)       # トイレ|廊下
wall(910, 1820, 910, 2730, 1)         # リネン庫|廊下
wall(0, 2730, 3640, 2730, 1)          # 廊下|クローゼット
wall(3640, 2730, 3640, 3640, 1)       # 廊下|クローゼット (背骨)
wall(0, 3640, 3640, 3640, 1)          # クローゼット|洋室 (折戸)
wall(3640, 3640, 3640, 6370, 1)       # 洋室|ホール (背骨)
wall(3640, 6370, 3640, BD, 1)         # 洋室|玄関 (背骨)
wall(4550, 0, 4550, 3640, 1)          # 階段室西壁
wall(4550, 4550, 4550, 6370, 1)       # ホール|納戸
wall(4550, 6370, 4550, 7280, 1)       # 玄関|SIC
wall(4550, 4550, 5460, 4550, 1)       # ホール|納戸
wall(4550, 6370, 5460, 6370, 1)       # 納戸|SIC
wall(4550, 7280, 5460, 7280, 1)       # SIC|玄関
wall(3640, 6370, 4550, 6370, 1)       # 玄関|ホール (上り框)

room("浴室", 0, 0, 1820, 1820, 1, texture="tile_floor")
room("洗面脱衣室", 1820, 0, 1820, 1820, 1, texture="tile_floor")
room("トイレ", 3640, 0, 910, 1820, 1, texture="tile_floor")
room("階段", 4550, 0, 910, 3640, 1, texture="wood_floor")
room("リネン庫", 0, 1820, 910, 910, 1, texture="wood_floor")
room("廊下", 910, 1820, 2730, 910, 1, texture="wood_floor")
room("廊下", 3640, 1820, 910, 1820, 1, texture="wood_floor")
room("クローゼット", 0, 2730, 3640, 910, 1, texture="wood_floor")
room("洋室", 0, 3640, 3640, 4550, 1, texture="wood_floor")
room("ホール", 3640, 3640, 910, 2730, 1, texture="wood_floor")
room("ホール", 4550, 3640, 910, 910, 1, texture="wood_floor")
room("納戸", 4550, 4550, 910, 1820, 1, texture="wood_floor")
room("シューズクローク", 4550, 6370, 910, 910, 1, texture="porch_tile")
room("玄関", 3640, 6370, 910, 1820, 1, texture="porch_tile")
room("玄関", 4550, 7280, 910, 910, 1, texture="porch_tile")

door("door-fold", 1820, 1250, 780, 1, vertical=True)         # 浴室(脱衣室から)
door("door-slide-s", 2250, 1820, 780, 1)                     # 洗面→廊下(引き代は東)
door("door-swing-s", 4095, 1820, 650, 1)                     # トイレ(外開き)
door("door-fold", 910, 2275, 780, 1, vertical=True)          # リネン庫
door("door-fold-w", 1820, 3640, 1650, 1)                     # クローゼット(折戸)
door("door-swing", 3640, 4550, 780, 1, vertical=True, flipX=True)  # 洋室
door("door-swing-s", 4550, 5500, 650, 1, vertical=True)      # 納戸
door("door-fold", 4550, 6825, 780, 1, vertical=True)         # SIC
door("door-opening", 4095, 6370, 780, 1)                     # 玄関→ホール(上り框)
door("door-front", 4200, BD, 940, 1, color=COL_DOOR)         # 玄関ドア

# 窓は全て上端2030の通り
win(910, 0, 1, "06905", 1460, 570, kind="fix")        # 浴室北
win(2730, 0, 1, "06905", 1460, 570, kind="fix")       # 洗面北
win(4095, 0, 1, "03613", 1460, 570, kind="fix")       # トイレ北
win(BW, 2275, 1, "F03613", 660, 1370, vertical=True, kind="fix")   # 階段東
win(1200, BD, 1, "16513", 0, 2030)                    # 洋室南 掃き出し
win(0, 5000, 1, "07409", 1260, 770, vertical=True)    # 洋室西(高窓)
win(BW, 7735, 1, "F03613", 660, 1370, vertical=True, kind="fix")   # 玄関東

item("stair", 5005, 2275, 910, 2730, 1, rot=180, color="#e8e0c8", stairOrder=1)
_c = item("stair-corner", 5005, 455, 910, 910, 1, rot=0,
          color="#e8e0c8", stairOrder=2)
_c["flipX"] = True

# ══════════ 2F ══════════
w_n2 = wall(0, 0, BW, 0, 2)
w_e2 = wall(BW, 0, BW, BD, 2)
w_s2 = wall(0, BD, BW, BD, 2)
w_w2 = wall(0, BD, 0, 0, 2)

wall(2730, 0, 2730, 2730, 2)          # キッチン|トイレ・パントリー (2730短スパン)
wall(2730, 1820, 3640, 1820, 2)       # トイレ|パントリー
wall(3640, 0, 3640, 2730, 2)          # トイレ・パントリー|廊下 (直下: 1F x3640)
wall(0, 2730, 3640, 2730, 2)          # キッチン|LDK 全面開口 (直下: 1F y2730)
wall(3640, 2730, 3640, 3640, 2)       # 廊下|LDK (直下: 1F x3640)
wall(3640, 3640, 3640, BD, 2)         # LDK|LDK 大開口 (直下: 1F x3640)
wall(4550, 910, 4550, 3640, 2)        # 階段室西壁 (y0-910は1Fからの着地口)

room("キッチン", 0, 0, 2730, 1820, 2, texture="wood_floor")
room("キッチン", 1820, 1820, 910, 910, 2, texture="wood_floor")
room("パントリー", 0, 1820, 1820, 910, 2, texture="wood_floor")
room("トイレ", 2730, 0, 910, 1820, 2, texture="tile_floor")
room("パントリー", 2730, 1820, 910, 910, 2, texture="wood_floor")
room("廊下", 3640, 0, 910, 3640, 2, texture="wood_floor")
room("階段", 4550, 0, 910, 3640, 2, texture="wood_floor")
room("LDK", 0, 2730, 3640, 5460, 2, texture="wood_floor")
room("LDK", 3640, 3640, 1820, 4550, 2, texture="wood_floor")

door("door-swing-s", 3640, 1000, 650, 2, vertical=True)      # トイレ(廊下から)
door("door-swing-s", 3640, 2275, 650, 2, vertical=True)      # パントリー
door("door-opening", 1365, 2730, 1820, 2)                    # キッチン↔LDK
door("door-opening", 3640, 3185, 780, 2, vertical=True)      # 廊下↔LDK
door("door-opening", 3640, 5005, 2730, 2, vertical=True)     # LDK大開口

win(750, 0, 2, "11909", 1200, 830)                    # キッチン北(シンク上)
win(3185, 0, 2, "03613", 1460, 570, kind="fix")       # トイレ北
win(BW, 2275, 2, "F03613", 660, 1370, vertical=True, kind="fix")   # 階段東
win(1365, BD, 2, "25620", 0, 2030)                    # LDK南 大開口(バルコニー)
win(4550, BD, 2, "16513", 660, 1370)                  # LDK東 南窓
win(BW, 5000, 2, "F03613", 660, 1370, vertical=True, kind="fix")   # LDK東
win(0, 4300, 2, "07409", 1260, 770, vertical=True)    # LDK西(高窓)

item("stair", 5005, 2275, 910, 2730, 2, rot=180, color="#e8e0c8", stairOrder=3)
_c2 = item("stair-corner", 5005, 455, 910, 910, 2, rot=0,
           color="#e8e0c8", stairOrder=4)
_c2["flipX"] = True

# バルコニー(LDK南・奥行1P)
item("balcony", 1365, 8645, 2730, 910, 2, color="#8d867c")
w_b1 = wall(0, 9100, 2730, 9100, 2, wallStyle="balcony-fence", wallHeight=1100)
w_b2 = wall(0, BD, 0, 9100, 2, wallStyle="balcony-fence", wallHeight=1100)
w_b3 = wall(2730, BD, 2730, 9100, 2, wallStyle="balcony-fence", wallHeight=1100)

# ══════════ 3F ══════════
w_n3 = wall(0, 0, BW, 0, 3)
w_e3 = wall(BW, 0, BW, BD, 3)
w_s3 = wall(0, BD, BW, BD, 3)
w_w3 = wall(0, BD, 0, 0, 3)

wall(2730, 0, 2730, 1820, 3)          # 洋室A|クローゼット (1820短スパン)
wall(2730, 1820, 3640, 1820, 3)       # クローゼット|洋室A東
wall(3640, 0, 3640, 2730, 3)          # 洋室A|ホール (直下: 2F x3640)
wall(0, 2730, 3640, 2730, 3)          # 洋室A|WIC・廊下 (直下: 2F y2730)
wall(2730, 2730, 2730, 3640, 3)       # WIC|廊下 (910短スパン)
wall(0, 3640, 2730, 3640, 3)          # WIC|主寝室 (折戸・2730短スパン)
wall(2730, 3640, 3640, 3640, 3)       # 廊下|主寝室 (910短スパン)
wall(3640, 3640, 4550, 3640, 3)       # ホール|洋室B (910短スパン)
wall(4550, 3640, 5460, 3640, 3)       # 吹抜(階段)south の手すり壁
wall(3640, 3640, 3640, BD, 3)         # 主寝室|洋室B (直下: 2F x3640)
wall(4550, 910, 4550, 3640, 3)        # 階段吹抜の西壁 (y0-910は着地口)
wall(4550, 3640, 4550, 4550, 3)       # 洋室B|クローゼット
wall(4550, 4550, 5460, 4550, 3)       # クローゼットB南

room("洋室A", 0, 0, 2730, 2730, 3, texture="wood_floor")
room("洋室A", 2730, 1820, 910, 910, 3, texture="wood_floor")
room("クローゼット", 2730, 0, 910, 1820, 3, texture="wood_floor")
room("ホール", 3640, 0, 910, 3640, 3, texture="wood_floor")
room("WIC", 0, 2730, 2730, 910, 3, texture="wood_floor")
room("廊下", 2730, 2730, 910, 910, 3, texture="wood_floor")
room("主寝室", 0, 3640, 3640, 4550, 3, texture="wood_floor")
room("洋室B", 3640, 3640, 910, 4550, 3, texture="wood_floor")
room("洋室B", 4550, 4550, 910, 3640, 3, texture="wood_floor")
room("クローゼット", 4550, 3640, 910, 910, 3, texture="wood_floor")

door("door-slide-s", 3640, 2275, 780, 3, vertical=True)      # 洋室A(引戸)
door("door-fold", 3185, 1820, 780, 3)                        # 洋室A クローゼット
door("door-fold-w", 1365, 3640, 1650, 3)                     # WIC(主寝室から)
door("door-swing", 3185, 3640, 780, 3)                       # 主寝室(廊下から)
door("door-swing", 4095, 3640, 780, 3)                       # 洋室B(ホールから)
door("door-fold", 4550, 4095, 780, 3, vertical=True)         # 洋室B クローゼット

win(1365, 0, 3, "16513", 660, 1370)                   # 洋室A北
win(4095, 0, 3, "03613", 1460, 570, kind="fix")       # ホール北
win(BW, 2275, 3, "F03613", 660, 1370, vertical=True, kind="fix")   # 階段東
win(1820, BD, 3, "16511", 660, 1370)                  # 主寝室南
win(0, 6000, 3, "07409", 1260, 770, vertical=True)    # 主寝室西(高窓)
win(5005, BD, 3, "07409", 660, 1370)                  # 洋室B南

# ══════════ 屋根 ══════════
item("roof", BW / 2, BD / 2, BW + 900, BD + 900, 4, rot=0,
     color=COL_ROOF, roofType="flat", pitch=5, elev=0,
     roofThickness=260, roofSkirt=0, roofEdgeColor=COL_ROOF)
item("roof", 4550, 8570, 1820, 1000, 2, rot=180,
     color=COL_ROOF, roofType="mono", pitch=3, elev=0,
     roofThickness=80, roofSkirt=0, roofEdgeColor=COL_ROOF)   # 玄関庇

# ══════════ 敷地・外構 (間口3間の狭小地) ══════════
SX0, SX1 = -M, BW + M             # -910 .. 6370
SY0, SY1 = -M, BD + 2275          # -910 .. 10465
SW = SX1 - SX0                    # 7280

item("site-rect", SX0 + SW / 2, (SY0 + BD) / 2, SW, BD - SY0, 1,
     color="rgba(100,160,100,0.1)", siteSurface="grass")       # 建物まわり
item("site-rect", SX0 + SW / 2, (BD + SY1) / 2, SW, SY1 - BD, 1,
     color="rgba(150,152,155,0.15)", siteSurface="concrete")   # 南の土間コン

item("fence", SX0 + SW / 2, SY0 + 60, SW, 120, 1, color="#c0bcb4")
item("fence", SX0 + 60, (SY0 + 120 + SY1) / 2, 120, SY1 - SY0 - 120, 1,
     color="#c0bcb4")
item("fence", SX1 - 60, (SY0 + 120 + SY1) / 2, 120, SY1 - SY0 - 120, 1,
     color="#c0bcb4")

# 玄関ポーチ+外階段。ドアが段の上に直接開かないよう平坦な踏込みを挟む
item("custom-block", 4550, 8645, 1820, 910, 1, color="#b9b8b4",
     customHeight=450, name="玄関ポーチ", texture="porch_tile")
item("exterior-stair", 4550, 9550, 1820, 900, 1, rot=180,
     color="#b8b2a8", targetHeight=450, accessSteps=3, texture="porch_tile")
item("fmp-GatePost01", 5000, 10350, 400, 200, 1, rot=180)

item("bicycle", 5900, 9300, 580, 1850, 1, rot=0, color="#a8b4c4")
item("tree", 2850, 9250, 1300, 1300, 1, color="#6f855f")
item("gas-heater", 900, -350, 470, 240, 1, rot=0)

# エアコン(規則は2階建てプランと同じ: 室内機は外壁面・室外機は外向き・対で置く)
AC_PAIRS = [
    # (室内機 cx, cy, rot, floor, elev, 室外機 cx, cy, rot)
    (190, 4200, 90, 2, 2050, -330, 4200, -90),   # LDK(西外壁)
    (190, 5000, 90, 3, 2050, -330, 5600, -90),   # 主寝室(西外壁)
]
for ix, iy, irot, fl, iel, ox, oy, orot in AC_PAIRS:
    item("fmp-AirConditionerWall01", ix, iy, 800, 260, fl, rot=irot, elev=iel)
    item("ac-outdoor", ox, oy, 800, 300, 1, rot=orot, color="#d8dadc")

# 道路・電柱・隣家(南道路の並び。隣家は境界910の近さで建つ)
item("road", 2730, SY1 + 2275, 30000, 4550, 1, color="#55585c", contextHeight=70)
item("utility-pole", 6700, SY1 + 435, 350, 350, 1, rot=0, color="#8c9297",
     contextHeight=6500)
item("neighbor-house", 10920, 4000, 7280, 6370, 1, rot=180,
     color="#d7c1a3", contextFloors=3, contextHeight=9300, contextGhost=True)
item("neighbor-house", -5460, 4000, 7280, 6370, 1, rot=180,
     color="#c9c2b4", contextFloors=2, contextHeight=6300, contextGhost=True)
item("neighbor-house", 2730, -4095, 7280, 6370, 1, rot=0,
     color="#b9bcc2", contextFloors=2, contextHeight=6300, contextGhost=True)

# ══════════ 家具 ══════════
# ── 1F 水まわり
item("fmp-BathTub03", 400, 800, 1179, 535, 1, rot=90)
item("fmp-ShowerSystem03", 1200, 300, 281, 451, 1, rot=180)
item("im0261-Mirror-MEGA_PACK_Mirror-mirror-70923_frame",
     650, 90, 796, 35, 1, rot=180, elev=1000)
item("washer", 3260, 390, 640, 640, 1, rot=180)
item("fmp-BathroomVanity07", 2250, 300, 682, 426, 1, rot=180)
item("fmp-WashBasin01", 2250, 300, 644, 435, 1, rot=180, elev=695)
item("im0261-Mirror-MEGA_PACK_Mirror-mirror-70923_frame",
     2250, 90, 796, 35, 1, rot=180, elev=1000)
item("fmp-Toilet01", 4095, 320, 339, 516, 1, rot=180)

# ── 1F 洋室 (親世帯/客間にもなる個室)
item("fmp-Bed14", 1000, 4850, 1546, 1899, 1, rot=180)
item("im0261-Table-MEGA_PACK_Table-table-309959", 2200, 4200, 460, 460, 1, rot=0)

# ── 2F キッチン (北壁一列・I型)
kx = 180
for t, w in (("fmp-CabinetD01", 366), ("fmp-CabinetD_Sink", 732),
             ("fmp-CabinetD02", 366), ("fmp-CabinetD03", 364)):
    item(t, kx + w / 2, 320, w, 519, 2, rot=180)
    kx += w
item("fmp-GasStove07", 1643, 320, 572, 507, 2, rot=180, elev=797)
item("fmp-KitchenExhaust07", 1643, 320, 466, 466, 2, rot=180, elev=1970)
item("fmp-Refrigerator02", 2400, 410, 640, 695, 2, rot=180)
item("fmp-Toilet01", 3185, 320, 339, 516, 2, rot=180)

# ── 2F LDK (TVは西壁・ソファと正対。ダイニングはキッチン開口の南)
item("im0261-Tableset-MEGA_PACK_Tableset-tableset_456939_Frame_Walnutbrown",
     900, 3900, 1189, 1109, 2, rot=0)
item("im0261-Cabinet-MEGA_PACK_CABINET-cabinet-149435_frame_brown",
     300, 5800, 1600, 450, 2, rot=90)
item("im0261-Tv-MEGA_PACK_tv-electronic-280915", 260, 5800, 1230, 211, 2,
     rot=90, elev=900)
item("im0261-Carpet-MEGA_PACK_Carpet-carpet-224774_frame_gray",
     1100, 5800, 2000, 1500, 2, rot=90)
item("fmp-Sofa16", 1600, 5800, 1939, 774, 2, rot=-90)
item("im0261-Plant-MEGA_PACK_Plant-plant-230510", 5000, 7700, 618, 719, 2, rot=0)

# ── 3F 寝室
item("fmp-Bed05", 700, 1200, 1112, 1950, 3, rot=180)          # 洋室A
item("fmp-Bed14", 1500, 6500, 1546, 1899, 3, rot=180)         # 主寝室
item("im0261-Table-MEGA_PACK_Table-table-309959", 2700, 7600, 460, 460, 3, rot=0)
item("fmp-Bed03", 4550, 6600, 1050, 1932, 3, rot=180)         # 洋室B

# ══════════ 照明 (取付高さは plan_kit が天井から計算する) ══════════
light("down", 910, 910, 1)                     # 浴室
light("down", 2730, 900, 1)                    # 洗面
light("down", 4095, 900, 1)                    # 1Fトイレ
light("down", 2275, 2275, 1)                   # 廊下
light("down", 4095, 2730, 1)                   # 廊下(南北)
light("ceiling", 1820, 5900, 1, shadow=True)   # 洋室
light("down", 4095, 5000, 1)                   # ホール
light("down", 5005, 4095, 1)                   # ホール(框前)
light("down", 4095, 7280, 1)                   # 玄関
light("down", 5005, 500, 1)                    # 階段
light("down", 4550, 8600, 1, elev=2600)        # ポーチ(庇下)

light("down", 900, 900, 2)                     # キッチン
light("down", 2000, 900, 2)
light("down", 3185, 900, 2)                    # 2Fトイレ
light("down", 4095, 1365, 2)                   # 2F廊下
light("down", 4095, 2900, 2)
light("ceiling", 1820, 4500, 2, shadow=True)   # LDK(ダイニング)
light("ceiling", 1820, 6800, 2)                # LDK(リビング)
light("down", 4550, 4550, 2)                   # LDK東
light("down", 4550, 6800, 2)
light("down", 5005, 500, 2)                    # 階段

light("ceiling", 1365, 1365, 3)                # 洋室A
light("down", 4095, 1000, 3)                   # 3Fホール
light("down", 4095, 2900, 3)
light("down", 1365, 3185, 3)                   # WIC
light("ceiling", 1820, 6000, 3, shadow=True)   # 主寝室
light("ceiling", 4700, 6300, 3)                # 洋室B

# ══════════ 注記 ══════════
item("memo", 1200, -1600, 2200, 500, 1, color="#fff3a6",
     noteText="都市型3階建てモデルプラン 3LDK+WIC\n敷地約83㎡ / 延床約134㎡(40坪)")
item("ruler", SX0 + SW / 2, SY1 + 600, SW, 120, 1, color="#2f80ed")

# ══════════ 外装カスケード ══════════
ext_walls_map = {}
for w in (w_e1, w_e2, w_e3):
    ext_walls_map[str(w["id"])] = wall_setting(COL_CHARCOAL, "galvalume_dark")
for w in (w_b1, w_b2, w_b3):
    ext_walls_map[str(w["id"])] = wall_setting(COL_WOOD, "wood_cedar")

out = sys.argv[1] if len(sys.argv) > 1 else "assets/default_plan_3f.json"
P.dump(
    out,
    floorMetadata={
        "1": {"role": "residential", "occupiable": True},
        "2": {"role": "residential", "occupiable": True},
        "3": {"role": "residential", "occupiable": True},
        "4": {"role": "roof", "occupiable": False},
    },
    exteriorWallSettings=dict(
        finish_cascade(COL_WHITE, "plaster_white"), walls=ext_walls_map),
    interiorWallSettings={k: v for k, v in
                          finish_cascade(COL_WALL_INT, "wall_int").items()
                          if k != "walls"},
    roofAppearance={
        "whole": {"linked": True, "color": COL_ROOF, "texture": None,
                  "textureFlipX": False, "textureFlipY": False},
        "floors": {},
    },
    exteriorDetail={"gutters": True, "gutterColor": COL_ROOF},
    viewState={
        "twoD": {"zoom": 0.85, "panX": 140, "panY": 40},
        "ext": {"pos": [15.5, 11.5, 19.5], "target": [2.7, 3.4, 4.0]},
        "int": {"pos": [4.5, 1.85, 5.2], "target": [1.2, 1.15, 4.2]},
    },
)
