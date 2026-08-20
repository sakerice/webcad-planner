#!/usr/bin/env python3
"""都市型3階建ての既定プラン(default_plan_3f.json)を生成する。

■ 敷地と与条件
  都心近郊(城南・川崎・横浜内陸)、間口3間・敷地約25坪・南道路の狭小地。
  東西の隣地境界まで910mm。用途地域は第一種住居地域の想定
  (北側斜線は適用外。低層住居専用地域ではこのボリュームは建たない)。
  住まい手: 30代共働き夫婦 + 小1の息子 + 保育園の娘。

■ 設計の骨格 — 「光は上から採る」
  隣家が910mmまで迫るので、1〜2階の低い窓は塞がれる。そこで
  **3階南の高窓 → 吹き抜け → 2階リビング** という光の井戸を1本通す。
  (docs/quality-team.md「狭小地・3階建ての定石」/ 積水ハウス・トヨタホームの事例)

    3F 南壁の窓 ─┐
                 │  吹き抜け(2F天井高 5.2m)
    2F リビング ─┘  ＋ 掃き出し窓 → バルコニー

■ 階の役割
  1F 迎える階  玄関・納戸・洋室(客間/親世帯)・浴室・洗面・ランドリー・トイレ
  2F 暮らす階  LDK・キッチン・パントリー・トイレ・吹き抜け・バルコニー
  3F 休む階    主寝室+WIC・子ども部屋×2・ホール

■ 住まい方の規則(docs/quality-team.md「住まい方の設計規則」)をどう満たしたか
  - 洗う→干す: 洗濯機(洗面脱衣室)の隣にランドリーを置き、**1階で完結**させた
    [check38]。2階のバルコニーは晴れた日の補助
  - 玄関の見通し: 上り框を玄関の**西側**に振り、ドアの正面は壁で止めた。
    開けても廊下や水まわりまで見通せない [check34]
  - 音: 2階のトイレの直下は1階の廊下。居室の上に載せていない [check35]
  - キッチン: シンク・コンロを北壁の一列に、冷蔵庫を東端に離して
    三辺合計を目安の範囲へ入れた [check36]
  - 採光: 8㎡以上の居室は対角2カ所を基本にした [check37]
  - 収納は使う場所に: 玄関脇の納戸(SIC兼)、キッチン脇のパントリー、
    寝室のWIC、子ども部屋の各クローゼット

■ 構造(壁グリッドを3層で共有する)
  耐力線 x2730 / x3640(背骨) / x4550(階段室西) と y1820 / y2730 / y3640。
  上階の壁はこの直下に壁がある線に載せるか、支持が無い区間は2730mm以下に
  収める [check14]。

usage: python3 tools/make_default_plan_3f.py [出力パス]
"""
import os
import sys

M = 910

# 内装は2階建てプランと同じ規則(明度 天井>壁>建具>床>家具、明るい面ほど低彩度)。
# 2026年の傾向に合わせ、アクセントは深みのあるアースカラー(セージグリーン)。
COL_WALL_INT = "#EFEDE7"      # 内壁 L*93.7 C*3.1
COL_ACCENT = "#6E7566"        # リビングのアクセント壁(セージグリーン) L*46 C*7
COL_BED_ACCENT = "#7A6A5E"    # 主寝室の枕元(クレイ) L*46 C*8
COL_WHITE = "#F2F0EB"         # 外壁メイン(白塗り壁)
COL_CHARCOAL = "#3A3D40"      # 外壁アクセント(ガルバ)
COL_WOOD = "#8B5E3C"          # 木調アクセント
COL_ROOF = "#2B2B2B"
COL_SASH = "#1c1c1c"
COL_DOOR = "#5C4230"
COL_FENCE = "#222222"
COL_SKIRT = "#6B5A48"         # 巾木(木調) — 壁より濃く、床とつなぐ

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from plan_kit import Plan, load_catalog, wall_setting, finish_cascade  # noqa: E402

CATALOG = load_catalog(ROOT)
P = Plan(catalog=CATALOG, interior_color=COL_WALL_INT)
wall, room, item = P.wall, P.room, P.item
win, door, light = P.win, P.door, P.light
dress = P.dress
ceiling_mounted = P.ceiling_mounted

# ───────── 躯体 (footprint 5460×8190 = 6P×9P, 各階44.7㎡) ─────────
BW, BD = 6 * M, 9 * M      # 5460 × 8190

item("foundation", BW / 2, BD / 2, BW, BD, 1, color="#474747",
     foundationHeight=450)

# ══════════════════════════ 1F ══════════════════════════
w_n1 = wall(0, 0, BW, 0, 1)
w_e1 = wall(BW, 0, BW, BD, 1)                 # 東面(階段室・チャコールガルバ)
w_s1 = wall(0, BD, BW, BD, 1)
w_w1 = wall(0, BD, 0, 0, 1)

wall(1820, 0, 1820, 1820, 1)          # 浴室|洗面
wall(3640, 0, 3640, 1820, 1)          # 洗面|トイレ
wall(4550, 0, 4550, 3640, 1)          # 階段室西壁
wall(0, 1820, 4550, 1820, 1)          # 水まわり北|ランドリー・廊下
wall(1820, 1820, 1820, 3640, 1)       # ランドリー|納戸
wall(2730, 1820, 2730, 3640, 1)       # 納戸|廊下
wall(0, 3640, 4550, 3640, 1)          # 北ゾーン|洋室・ホール
wall(2730, 3640, 2730, BD, 1)         # 洋室|ホール・クローゼット
wall(2730, 5460, 5460, 5460, 1)       # ホール|クローゼット・玄関(上り框はここ)
wall(3640, 5460, 3640, BD, 1)         # クローゼット|玄関

room("浴室", 0, 0, 1820, 1820, 1, texture="tile_floor")
room("洗面脱衣室", 1820, 0, 1820, 1820, 1, texture="tile_floor")
room("トイレ", 3640, 0, 910, 1820, 1, texture="tile_floor")
room("階段", 4550, 0, 910, 3640, 1, texture="wood_floor")
room("ランドリー", 0, 1820, 1820, 1820, 1, texture="tile_floor")
room("納戸", 1820, 1820, 910, 1820, 1, texture="wood_floor")
room("廊下", 2730, 1820, 1820, 1820, 1, texture="wood_floor")
room("洋室", 0, 3640, 2730, 4550, 1, texture="wood_floor")
room("ホール", 2730, 3640, 2730, 1820, 1, texture="wood_floor")
room("クローゼット", 2730, 5460, 910, 2730, 1, texture="wood_floor")
room("玄関", 3640, 5460, 1820, 2730, 1, texture="porch_tile")

# 上り框は玄関の**西寄り**に開ける。玄関ドア(x4800)の正面は壁で止まるので、
# 開けても廊下や水まわりまで見通せない [check34]
# 回遊: 廊下 → ランドリー → 洗面脱衣室 → 浴室。洗濯機は洗面に置き、
# 隣のランドリーで干して畳む。濡れた物を持って階段を上らない [check38]
door("door-fold", 1820, 1250, 780, 1, vertical=True)          # 浴室(脱衣室から)
door("door-slide-s", 2275, 1820, 780, 1)                      # 洗面脱衣室↔ランドリー
door("door-fold-w", 2730, 2730, 1650, 1, vertical=True)       # 納戸(廊下から)
door("door-opening", 1820, 2730, 1650, 1, vertical=True)      # ランドリー↔納戸
door("door-swing-s", 4095, 1820, 650, 1)                      # トイレ(廊下から)
door("door-opening", 3185, 3640, 910, 1)                      # 廊下↔ホール
door("door-swing", 2730, 4950, 780, 1, vertical=True)         # 洋室(ホールから)
door("door-fold", 2730, 6800, 780, 1, vertical=True)          # クローゼット(玄関から)
door("door-opening", 4095, 5460, 910, 1)                      # 玄関→ホール(上り框)
door("door-front", 4800, BD, 940, 1, color=COL_DOOR)          # 玄関ドア

# 窓は上端2030の通りで揃える
win(910, 0, 1, "06905", 1460, 570, kind="fix")        # 浴室北(採光FIX)
win(2730, 0, 1, "06905", 1460, 570, kind="fix")       # 洗面北(採光FIX)
win(4095, 0, 1, "03613", 1460, 570, kind="fix")       # トイレ北
win(BW, 2275, 1, "F03613", 660, 1370, vertical=True, kind="fix")   # 階段東
dress(win(0, 2730, 1, "07409", 1260, 770, vertical=True), "roller")    # ランドリー西(換気)
dress(win(0, 4600, 1, "16513", 660, 1370, vertical=True))    # 洋室 西
dress(win(1400, BD, 1, "16520", 0, 2030))                    # 洋室 南 掃き出し(対角)
win(BW, 7000, 1, "F03613", 660, 1370, vertical=True, kind="fix")   # 玄関東(採光)

item("stair", 5005, 2275, 910, 2730, 1, rot=180, color="#e8e0c8", stairOrder=1)
_c1 = item("stair-corner", 5005, 455, 910, 910, 1, rot=0,
           color="#e8e0c8", stairOrder=2)
_c1["flipX"] = True

# ══════════════════════════ 2F ══════════════════════════
w_n2 = wall(0, 0, BW, 0, 2)
w_e2 = wall(BW, 0, BW, BD, 2)
w_s2 = wall(0, BD, BW, BD, 2)
w_w2 = wall(0, BD, 0, 0, 2)

wall(2730, 0, 2730, 2730, 2)          # キッチン|トイレ・パントリー (直下 1F x2730)
wall(2730, 1820, 3640, 1820, 2)       # トイレ|パントリー (直下 1F y1820)
wall(3640, 0, 3640, 3640, 2)          # 水まわり・LDK|廊下 (直下 1F x3640)
wall(4550, 910, 4550, 3640, 2)        # 廊下|階段 (y0-910 は1Fからの着地口)
# キッチン|LDK は全面開口。支持が無いので2730mm以下に割る [check14]
wall(0, 2730, 1820, 2730, 2)
wall(1820, 2730, 3640, 2730, 2)
wall(3640, 3640, 3640, BD, 2)         # LDK|LDK東 (直下 1F x3640)
wall(3640, 7280, 5460, 7280, 2)       # LDK東|収納

room("キッチン", 0, 0, 2730, 2730, 2, texture="wood_floor")
room("トイレ", 2730, 0, 910, 1820, 2, texture="tile_floor")
room("パントリー", 2730, 1820, 910, 910, 2, texture="wood_floor")
room("廊下", 3640, 0, 910, 3640, 2, texture="wood_floor")
room("階段", 4550, 0, 910, 3640, 2, texture="wood_floor")
room("LDK", 0, 2730, 3640, 3640, 2, texture="wood_floor")
room("LDK", 3640, 3640, 1820, 3640, 2, texture="wood_floor")
room("収納", 3640, 7280, 1820, 910, 2, texture="wood_floor")
# 吹き抜け。天井高は書かない -- toFloor だけ宣言すればアプリが階高から計算する。
# 手で数字を書くと階高を変えた瞬間に上階の天井と食い違う
room("リビング", 0, 6370, 3640, 1820, 2, texture="wood_floor",
     ceiling={"type": "void", "toFloor": 3})

door("door-swing-s", 3640, 1100, 650, 2, vertical=True)       # トイレ(廊下から)
door("door-fold", 3640, 2275, 650, 2, vertical=True)          # パントリー(折戸)
door("door-opening", 910, 2730, 1820, 2)                      # キッチン↔LDK 全面開口
door("door-opening", 3640, 3185, 780, 2, vertical=True)       # 廊下↔LDK
door("door-opening", 3640, 5005, 2730, 2, vertical=True)      # LDK↔LDK東 大開口
door("door-fold-w", 4550, 7280, 1650, 2)                      # 収納(LDK東から)

# 窓はシンクの真上だけ。天板(850)より上に立ち上げ、東のレンジフードと離す
dress(win(932, 0, 2, "07409", 900, 1000), "roller")                    # キッチン北(シンク上)
win(3185, 0, 2, "03613", 1460, 570, kind="fix")       # トイレ北
win(BW, 2275, 2, "F03613", 660, 1370, vertical=True, kind="fix")   # 階段東
dress(win(0, 3900, 2, "16513", 660, 1370, vertical=True))    # LDK西
dress(win(1820, BD, 2, "25620", 0, 2030))                    # リビング南 大開口→バルコニー
win(BW, 5460, 2, "F03613", 660, 1370, vertical=True, kind="fix")   # LDK東

item("stair", 5005, 2275, 910, 2730, 2, rot=180, color="#e8e0c8", stairOrder=3)
_c2 = item("stair-corner", 5005, 455, 910, 910, 2, rot=0,
           color="#e8e0c8", stairOrder=4)
_c2["flipX"] = True

# バルコニー(リビングの南・奥行1P)
item("balcony", 1820, 8645, 3640, 910, 2, color="#8d867c")
w_b1 = wall(0, 9100, 3640, 9100, 2, wallStyle="balcony-fence", wallHeight=1100)
w_b2 = wall(0, BD, 0, 9100, 2, wallStyle="balcony-fence", wallHeight=1100)
w_b3 = wall(3640, BD, 3640, 9100, 2, wallStyle="balcony-fence", wallHeight=1100)

# ══════════════════════════ 3F ══════════════════════════
w_n3 = wall(0, 0, BW, 0, 3)
w_e3 = wall(BW, 0, BW, BD, 3)
w_s3 = wall(0, BD, BW, BD, 3)
w_w3 = wall(0, BD, 0, 0, 3)

wall(2730, 0, 2730, 2730, 3)          # 洋室A|クローゼット (直下 2F x2730)
wall(3640, 0, 3640, BD, 3)            # 背骨 (直下 2F x3640)
wall(4550, 910, 4550, 3640, 3)        # ホール|階段吹抜 (y0-910 は着地口)
wall(3640, 3640, 4550, 3640, 3)       # ホール|洋室B
wall(3640, 7280, 5460, 7280, 3)       # 洋室B|クローゼット
wall(4550, 3640, 5460, 3640, 3)       # 階段吹抜 南の手すり壁
wall(0, 2730, 1820, 2730, 3)          # 洋室A|廊下 (直下 2F y2730 / 2730以下に割る)
wall(1820, 2730, 3640, 2730, 3)
wall(0, 3640, 2730, 3640, 3)          # 廊下|主寝室 (支持なし 2730mm)
wall(2730, 3640, 3640, 3640, 3)       # 廊下|WIC (支持なし 910mm)
wall(2730, 3640, 2730, 6370, 3)       # 主寝室|WIC (支持なし 2730mm)
# 吹き抜けの北壁。腰壁ではなく**壁**にする -- 寝室が吹き抜けに面して開くと
# リビングの音と光が寝室へ抜けてしまう。支持が無いので2730以下に割る
wall(0, 6370, 2730, 6370, 3)
wall(2730, 6370, 3640, 6370, 3)

room("洋室A", 0, 0, 2730, 2730, 3, texture="wood_floor")
room("クローゼット", 2730, 0, 910, 2730, 3, texture="wood_floor")
room("ホール", 3640, 0, 910, 3640, 3, texture="wood_floor")
room("廊下", 0, 2730, 3640, 910, 3, texture="wood_floor")
room("主寝室", 0, 3640, 2730, 2730, 3, texture="wood_floor")
room("WIC", 2730, 3640, 910, 2730, 3, texture="wood_floor")
room("洋室B", 3640, 3640, 1820, 3640, 3, texture="wood_floor")
room("クローゼット", 3640, 7280, 1820, 910, 3, texture="wood_floor")

door("door-slide-s", 2275, 2730, 780, 3)                      # 洋室A(引戸・廊下から)
door("door-fold", 2730, 1365, 780, 3, vertical=True)          # クローゼット(洋室Aから)
# 4.5帖に開き戸を付けるとベッドと当たる。引戸にして枕元を南壁につける [check25]
door("door-slide-s", 1365, 3640, 780, 3)                      # 主寝室(廊下から)
door("door-fold-w", 2730, 4400, 1200, 3, vertical=True)       # WIC(主寝室から)
door("door-swing-s", 4095, 3640, 650, 3)                      # 洋室B(ホールから)
door("door-fold-w", 4100, 7280, 900, 3)                       # クローゼット(洋室Bから)
door("door-opening", 3640, 3185, 910, 3, vertical=True)       # ホール↔廊下

dress(win(2040, 0, 3, "11909", 660, 1370), "roller")                   # 洋室A 北(机の上)
dress(win(0, 1365, 3, "07409", 1200, 830, vertical=True), "roller")    # 洋室A 西(高窓・ベッドの上)
win(BW, 2275, 3, "F03613", 660, 1370, vertical=True, kind="fix")   # 階段東
dress(win(0, 4700, 3, "16513", 660, 1370, vertical=True))    # 主寝室 西
# 1820幅の部屋にベッド(1050)を置くと、カーテン(奥行150)を吊る余地が無い。
# 奥行50のロールスクリーンにして、ベッドの脇に通り道を残す [check19/22]
dress(win(BW, 4900, 3, "16513", 1000, 1030, vertical=True), "roller")  # 洋室B 東
# ★この家の要。吹き抜けの上に開けた高窓から、2階リビングへ光を落とす
win(1820, BD, 3, "16513", 1400, 900, kind="fix")      # 吹き抜け 南の高窓

# ══════════════════════════ 屋根 ══════════════════════════
item("roof", BW / 2, BD / 2, BW + 900, BD + 900, 4, rot=0,
     color=COL_ROOF, roofType="flat", pitch=5, elev=0,
     roofThickness=260, roofSkirt=0, roofEdgeColor=COL_ROOF)
item("roof", 4550, 8570, 1820, 1000, 2, rot=180,
     color=COL_ROOF, roofType="mono", pitch=3, elev=0,
     roofThickness=80, roofSkirt=0, roofEdgeColor=COL_ROOF)   # 玄関庇

# ══════════════════════════ 敷地・外構 ══════════════════════════
SX0, SX1 = -M, BW + M             # -910 .. 6370
SY0, SY1 = -M, BD + 2275          # -910 .. 10465
SW = SX1 - SX0                    # 7280

item("site-rect", SX0 + SW / 2, (SY0 + BD) / 2, SW, BD - SY0, 1,
     color="rgba(100,160,100,0.1)", siteSurface="grass")
item("site-rect", SX0 + SW / 2, (BD + SY1) / 2, SW, SY1 - BD, 1,
     color="rgba(150,152,155,0.15)", siteSurface="concrete")

item("fence", SX0 + SW / 2, SY0 + 60, SW, 120, 1, color="#c0bcb4")
item("fence", SX0 + 60, (SY0 + 120 + SY1) / 2, 120, SY1 - SY0 - 120, 1,
     color="#c0bcb4")
item("fence", SX1 - 60, (SY0 + 120 + SY1) / 2, 120, SY1 - SY0 - 120, 1,
     color="#c0bcb4")
# 道路からリビングの掃き出し窓を直接見せない縦格子(オープン外構の目隠し)
# 道路からリビングの掃き出し窓を直接見せない縦格子。
# 窓の屋外1500mmは空ける必要があるので、境界寄りに立てる [check15]
item("lattice-screen", 1400, 9800, 2400, 60, 1, color=COL_WOOD,
     latticeHeight=1500, fencePattern="vertical", fenceTopStyle="even")

# 玄関ポーチ+外階段。ドアが段の上に直接開かないよう平坦な踏込みを挟む
item("custom-block", 4550, 8645, 1820, 910, 1, color="#b9b8b4",
     customHeight=450, name="玄関ポーチ", texture="porch_tile")
item("exterior-stair", 4550, 9550, 1820, 900, 1, rot=180,
     color="#b8b2a8", targetHeight=450, accessSteps=3, texture="porch_tile")
item("custom-block", 3000, 9550, 1200, 900, 1, color="#b9b8b4",
     customHeight=20, name="アプローチ", texture="porch_tile")
item("fmp-GatePost01", 5000, 10350, 400, 200, 1, rot=180)

item("bicycle", 700, 10150, 580, 1850, 1, rot=90, color="#a8b4c4")
item("bicycle-fold", 2600, 10150, 550, 1450, 1, rot=90, color="#d8a878")
item("tree", 3050, 8650, 1000, 1000, 1, color="#6f855f")
item("gas-heater", 5200, -350, 470, 240, 1, rot=0)
item("meter-box", -160, 700, 180, 120, 1, rot=90, elev=1600)
for sy in (-500, 1500, 4000):
    item("sewer-pit", 5900, sy, 300, 300, 1, color="#6f7275")

# エアコン。室内機は必ず外壁面、室外機は吹き出しを建物の外へ向ける [check30]
# 室内機は窓の真上に置かない。カーテンレールの上端(窓上端+100)と
# 室内機の下端(FL+2050)がぶつかる [check22]
AC_PAIRS = [
    # (室内機 cx, cy, rot, floor, elev, 室外機 cx, cy, rot)
    (190, 5500, 90, 2, 2050, -330, 5600, -90),   # LDK(西外壁・窓より南)
    (800, 3835, 180, 3, 2050, -330, 4400, -90),  # 主寝室(廊下側の壁)
    (600, 190, 180, 3, 2050, 600, -310, 0),      # 洋室A(北外壁・窓より西)
]
for ix, iy, irot, fl, iel, ox, oy, orot in AC_PAIRS:
    item("fmp-AirConditionerWall01", ix, iy, 800, 260, fl, rot=irot, elev=iel)
    item("ac-outdoor", ox, oy, 800, 300, 1, rot=orot, color="#d8dadc")

# 道路・電柱・隣家。隣地境界まで910mmの近さで3階建てが建つ
item("road", 2730, SY1 + 2275, 30000, 4550, 1, color="#55585c", contextHeight=70)
item("utility-pole", 6700, SY1 + 435, 350, 350, 1, rot=0, color="#8c9297",
     contextHeight=6500)
item("neighbor-house", 10920, 4000, 7280, 6370, 1, rot=180,
     color="#d7c1a3", contextFloors=3, contextHeight=9300, contextGhost=True)
item("neighbor-house", -5460, 4000, 7280, 6370, 1, rot=180,
     color="#c9c2b4", contextFloors=2, contextHeight=6300, contextGhost=True)
item("neighbor-house", 2730, -4095, 7280, 6370, 1, rot=0,
     color="#b9bcc2", contextFloors=2, contextHeight=6300, contextGhost=True)

# ══════════════════════════ 1F 家具 ══════════════════════════
# ── 浴室 (1坪UB)
item("fmp-BathTub03", 400, 800, 1179, 535, 1, rot=90)
item("fmp-ShowerSystem03", 1250, 260, 281, 451, 1, rot=180)
item("im0261-Mirror-MEGA_PACK_Mirror-mirror-70923_frame",
     700, 90, 796, 35, 1, rot=180, elev=1000)

# ── 洗面脱衣室。洗濯機はランドリーへの引戸(x2275)の脇。洗う→干すが最短
item("fmp-BathroomVanity07", 2600, 300, 682, 426, 1, rot=180)
item("fmp-WashBasin01", 2600, 300, 644, 435, 1, rot=180, elev=695)
item("im0261-Mirror-MEGA_PACK_Mirror-mirror-70923_frame",
     2600, 90, 796, 35, 1, rot=180, elev=1000)
item("washer", 3300, 390, 640, 640, 1, rot=180)

# ── ランドリー(室内干し・畳む・しまう)。床は空け、収納は吊る
item("im0261-Cabinet-MEGA_PACK_CABINET-cabinet-19565_Frame",
     500, 2030, 750, 300, 1, rot=180, elev=900)
item("im0261-Cabinet-MEGA_PACK_CABINET-cabinet-19565_Frame",
     1290, 2030, 750, 300, 1, rot=180, elev=900)
item("im0261-Shelf-MEGA_PACK_Shelf-shelf-161715", 900, 2013, 816, 266, 1,
     rot=180, elev=1720)
item("im0261-Bath-MEGA_PACK_BATH-basket-304967-Gray", 700, 3400, 442, 342, 1,
     rot=0)
item("im0261-Shelf-MEGA_PACK_Shelf-shelf-161715", 2275, 2050, 816, 266, 1,
     rot=180)                                              # 納戸の棚(上下2段)
item("im0261-Shelf-MEGA_PACK_Shelf-shelf-161715", 2275, 2050, 816, 266, 1,
     rot=180, elev=1200)
item("im0261-Shelf-MEGA_PACK_Shelf-shelf-161715", 2275, 3400, 816, 266, 1,
     rot=0)

# ── トイレ(手洗いはタンク上。910幅にカウンターを足すと扉が開かない)
item("fmp-Toilet01", 4095, 318, 339, 516, 1, rot=180)
# 棚は北窓(台1460)の見付けに掛かるので西壁へ。便器の真上は空ける [check40]
item("im0261-Shelf-MEGA_PACK_Shelf-shelf-161715", 3835, 700, 816, 266, 1,
     rot=90, elev=1500)

# ── 洋室(客間・将来の親世帯)。西窓と南の掃き出しで対角採光
# 西窓(台660)の見付けと、東の扉の有効幅600mmの両方を外す位置 [check40/42]
item("fmp-Bed14", 1150, 4700, 1546, 1899, 1, rot=180)
# ナイトテーブルは枕元の東。背中を北壁につける(rot=0 だと正面が壁を向く) [check30]
item("im0261-Table-MEGA_PACK_Table-table-309959", 2400, 4000, 460, 460, 1, rot=180)
item("im0261-Lamp-MEGA_PACK_lamp-lamp-126685_frame", 2400, 4000, 200, 200, 1,
     rot=180, elev=513)
item("im0261-Carpet-MEGA_PACK_Carpet-carpet-29915_frame", 1300, 6300, 2000, 1500, 1,
     rot=0)
item("im0261-Cabinet-MEGA_PACK_CABINET-cabinet-149435_frame_brown",
     285, 6700, 1600, 450, 1, rot=90)
item("im0261-Plant-MEGA_PACK_Plant-plant-151348_chocolate_frame",
     300, 7800, 395, 386, 1, rot=0)
# 掃き出し窓(1690)は左右2枚。1枚だと両端143mmずつガラスが出る [check28]

# ── 玄関・ホール・クローゼット(SIC)
item("im0261-Cabinet-MEGA_PACK_CABINET-cabinet-306913_frame_brown",
     3995, 6800, 1003, 591, 1, rot=90)                     # 下駄箱(西壁)
item("im0261-Mirror-MEGA_PACK_Mirror-mirror-498995_frame_light_brown",
     5240, 5900, 468, 333, 1, rot=-90)
# SICの棚は東壁に背をつけ、正面(西)を通路へ向ける [check30/31]
item("im0261-Shelf-MEGA_PACK_Shelf-shelf-344463_ModernAcacia-Black",
     3420, 6100, 800, 320, 1, rot=-90)                     # SICの棚
item("im0261-Shelf-MEGA_PACK_Shelf-shelf-344463_ModernAcacia-Black",
     3420, 7700, 800, 320, 1, rot=-90)
# 絵はホール南壁(玄関との境)に掛ける。正面は北=ホール側 [check30/31]
item("im0261-Painting-MEGA_PACK_Painting-painting-503147_50_70_cm",
     3200, 5414, 498, 29, 1, rot=0, elev=1100)

# ══════════════════════════ 2F 家具 ══════════════════════════
# ── キッチン。シンク・コンロを北壁の一列に、冷蔵庫を東壁へ離して
#    ワークトライアングルの三辺合計を目安(3600〜6000)へ入れる [check36]
kx = 200
for t, w in (("fmp-CabinetD01", 366), ("fmp-CabinetD_Sink", 732),
             ("fmp-CabinetD02", 366), ("fmp-CabinetD03", 364)):
    item(t, kx + w / 2, 320, w, 519, 2, rot=180)
    kx += w
item("fmp-GasStove07", 1742, 320, 572, 507, 2, rot=180, elev=797)
item("fmp-KitchenExhaust07", 1742, 320, 466, 466, 2, rot=180, elev=1970)
item("fmp-Refrigerator02", 2320, 1900, 640, 695, 2, rot=-90)
# 家電はシンク上の窓(x542-1322)を塞ぐので、天板の西端へ寄せる [check40]
item("im0261-Kitchen-MEGA_PACK_kitchen-electronic-298603_Frame_Black",
     380, 320, 340, 351, 2, rot=180, elev=900)

# ── パントリー・2Fトイレ
item("im0261-Shelf-MEGA_PACK_Shelf-shelf-161715", 3185, 2013, 816, 266, 2,
     rot=180, elev=1500)
# コーヒーはパントリーで淹れる。天板の上は調理のために空けておく
item("im0261-Shelf-MEGA_PACK_Shelf-shelf-310090_frame_natural",
     3185, 2040, 597, 305, 2, rot=180)
item("im0261-Kitchen-MEGA_PACK_kitchen-electronic-drip-coffee-machine_red",
     3185, 2040, 255, 270, 2, rot=180, elev=650)
item("fmp-Toilet01", 3185, 318, 339, 516, 2, rot=180)
# 910幅のトイレでは、扉の前面600mmを引くと西壁に棚を吊る余地が無い。
# 南壁(便器の向かい)に回す
item("im0261-Shelf-MEGA_PACK_Shelf-shelf-161715", 3185, 1607, 816, 266, 2,
     rot=0, elev=1600)

# ── ダイニング(キッチンの真南)
# 置き場所は動線で決まる。開口の前に600mmの通り道を残し[check13]、
# 卓の東西それぞれに1166mmの通路を残して南のリビングへ抜けられるようにする
item("im0261-Tableset-MEGA_PACK_Tableset-tableset_456939_Frame_Walnutbrown",
     1820, 4000, 1189, 1109, 2, rot=0)

# ── リビング。テレビは西壁、ソファはその正面 [check39]
# 東側(x2790-3580)は上から下まで空けておく。ここが廊下→LDK東→吹き抜けの通り道
item("im0261-Cabinet-MEGA_PACK_CABINET-cabinet-149435_frame_brown",
     300, 6000, 1600, 450, 2, rot=90)
item("im0261-Tv-MEGA_PACK_tv-electronic-280915", 260, 6000, 1230, 211, 2,
     rot=90, elev=900)
item("im0261-Carpet-MEGA_PACK_Carpet-carpet-224774_frame_gray",
     1400, 6000, 2000, 1500, 2, rot=90)
item("fmp-Sofa16", 2400, 6000, 1939, 774, 2, rot=-90)
item("im0261-Table-MEGA_PACK_Table-table-309959", 1470, 6000, 460, 460, 2, rot=90)
item("im0261-Decor-MEGA_PACK_decor-decor-roland_pom_pom_chrysanthemum_flower_frame_li",
     1470, 6000, 270, 209, 2, rot=90, elev=513)
# 吹き抜けの下(y6370-8190)は光の間。床には何も置かない。緑はLDK東の窓辺へ
item("im0261-Plant-MEGA_PACK_Plant-plant-230510", 5050, 4300, 618, 719, 2, rot=0)

# ── 2F 収納(LDK東の南端)。折戸を開けたときに床しか無い状態にしない
item("im0261-Shelf-MEGA_PACK_Shelf-shelf-344463_ModernAcacia-Black",
     4150, 7960, 800, 320, 2, rot=0)
item("im0261-Shelf-MEGA_PACK_Shelf-shelf-344463_ModernAcacia-Black",
     5000, 7960, 800, 320, 2, rot=0)
item("im0261-Painting-MEGA_PACK_Painting-decor-476641_frame",
     3520, 4300, 600, 31, 2, rot=-90, elev=1100)
# 吹き抜けのシーリングファン。天井5.2mの空気を回す
ceiling_mounted("fmp-CeilingFan01", 1820, 7280, 2, w=1200, d=1200, rot=0)

# ══════════════════════════ 3F 家具 ══════════════════════════
# ── 洋室A(小1の息子)。北窓と西窓で対角採光
# 壁際はカーテンが下りている。西壁から344mm、北窓のカーテン下端(y117)から
# 8mm離して置く。ベッドは高さ882mmでカーテンの下端660mmより高い [check22]
item("fmp-Bed05", 850, 1100, 1112, 1950, 3, rot=180)
item("fmp-Table44", 2100, 340, 1049, 524, 3, rot=180)
item("fmp-Chair29", 1950, 900, 430, 442, 3, rot=0)
item("im0261-Carpet-MEGA_PACK_Carpet-carpet-224774_frame_gray",
     1500, 2100, 2000, 1500, 3, rot=0)
item("im0261-Lamp-MEGA_PACK_lamp-lamp-573754_frame", 2350, 340, 245, 239, 3,
     rot=180, elev=626)                                    # 机上のライト
# 北窓は机の真上。カーテンを吊ると天板に掛かるので、ここはロールスクリーン
# の想定でカーテンを置かない [check22]
# 西は高窓(台1200)。カーテンは吊らない
# 洋室Aのクローゼット(910幅の壁面収納)。奥行773のCloset14は壁にめり込むので、
# 305mmの浅い棚を南北の妻壁に付ける。中央は折戸の開き代として空ける [check2/4]
# 910幅のクローゼットは、折戸の畳み代(y915-1815)と引戸の戸袋面(y2430-3030)
# を外すと北の妻壁しか残らない。そこに浅い棚を2段積む [check2/24]
item("im0261-Shelf-MEGA_PACK_Shelf-shelf-310090_frame_natural",
     3185, 215, 597, 305, 3, rot=180)
item("im0261-Shelf-MEGA_PACK_Shelf-shelf-310090_frame_natural",
     3185, 215, 597, 305, 3, rot=180, elev=700)
item("im0261-Kid-MEGA_PACK_kid-kid_691953_Frame_Guliguli_Tiger",
     3185, 215, 525, 230, 3, rot=180, elev=1350)           # 棚の上のぬいぐるみ

# ── 主寝室。枕元をクレイのアクセント壁にし、西の2窓で通風
# 枕元を南(吹き抜けの北壁=クレイのアクセント壁)につける。頭上に絵を掛ける
item("fmp-Bed14", 1300, 5355, 1546, 1899, 3, rot=0)
item("im0261-Table-MEGA_PACK_Table-table-309959", 2350, 5900, 460, 460, 3, rot=0)
item("im0261-Lamp-MEGA_PACK_lamp-lamp-126685_frame", 2350, 5900, 200, 200, 3,
     rot=0, elev=513)
item("im0261-Carpet-MEGA_PACK_Carpet-carpet-29915_frame", 1400, 4600, 2000, 1500, 3,
     rot=0)
item("im0261-Painting-MEGA_PACK_Painting-decor-355748_frame_500",
     1300, 6304, 500, 10, 3, rot=0, elev=1500)

# ── WIC (主寝室から折戸。奥に閉じ込めず、寝室の短辺側に付ける)
# 910幅なので中で振り向けない。浅い棚を南北の妻壁に付ける [check4]
item("im0261-Shelf-MEGA_PACK_Shelf-shelf-310090_frame_natural",
     3428, 5500, 597, 305, 3, rot=-90)
item("im0261-Shelf-MEGA_PACK_Shelf-shelf-310090_frame_natural",
     3185, 6100, 597, 305, 3, rot=0)

# ── 洋室B(保育園の娘)。東窓と南窓で対角採光
item("fmp-Bed03", 4825, 5400, 1050, 1932, 3, rot=180)
item("im0261-Carpet-MEGA_PACK_Carpet-carpet-horang_frame_orange_0000",
     4300, 6600, 880, 1189, 3, rot=0)
item("im0261-Kid-MEGA_PACK_kid-kid_ADADA-ROCKING-HORSE_1", 4700, 6800, 338, 762, 3,
     rot=0)
# 洋室Bのクローゼット(奥行910)。中身は浅い棚2つ
item("im0261-Shelf-MEGA_PACK_Shelf-shelf-310090_frame_natural",
     4100, 7900, 597, 305, 3, rot=0)
item("im0261-Shelf-MEGA_PACK_Shelf-shelf-310090_frame_natural",
     5000, 7900, 597, 305, 3, rot=0)

# ── ホール・廊下
item("im0261-Shelf-MEGA_PACK_Shelf-shelf-310090_frame_natural",
     4095, 212, 597, 305, 3, rot=180, elev=1100)
item("im0261-Decor-MEGA_PACK_decor-decor-shop_the_look", 4095, 212, 246, 106, 3,
     rot=180, elev=1750)
item("im0261-Painting-MEGA_PACK_Painting-decor-355748_frame_500",
     700, 2790, 500, 10, 3, rot=180, elev=1450)

# ══════════════════════════ 照明 ══════════════════════════
# 取付高さは plan_kit が部屋の天井から計算する(手で書かない)
light("down", 910, 910, 1)                     # 浴室
light("down", 2730, 900, 1)                    # 洗面
light("down", 900, 2500, 1)                    # ランドリー
light("down", 2275, 2500, 1)                   # トイレ
light("down", 4095, 900, 1)                    # 収納
light("down", 3640, 2700, 1)                   # 廊下
light("ceiling", 1365, 5900, 1, shadow=True)   # 洋室
light("down", 3185, 4400, 1)                   # ホール
light("down", 3185, 6600, 1)
light("down", 4095, 5000, 1)                   # 納戸
light("down", 4550, 7000, 1)                   # 玄関
light("down", 5005, 500, 1)                    # 階段
light("down", 4550, 8600, 1, elev=2600)        # ポーチ(庇下)

light("down", 700, 700, 2)                     # キッチン
light("down", 1900, 700, 2)
light("down", 1400, 2100, 2)
light("down", 3185, 900, 2)                    # 2Fトイレ
light("down", 3185, 2275, 2)                   # パントリー
light("down", 4095, 900, 2)                    # 廊下
light("down", 4095, 2700, 2)
light("ceiling", 1820, 4000, 2, shadow=True)   # ダイニング(食卓の中心)
light("down", 4550, 4300, 2)                   # LDK東
light("down", 4550, 6300, 2)
light("down", 4550, 7700, 2)                   # 2F 収納
light("down", 5005, 500, 2)                    # 階段
# 吹き抜けは天井(FL+5208)の埋込。ファンの回転域を避けて振り分ける
light("down", 700, 6900, 2)
light("down", 2900, 7700, 2)

light("ceiling", 1365, 1365, 3)                # 洋室A
light("down", 3185, 1365, 3)                   # クローゼット
light("down", 4095, 900, 3)                    # ホール
light("down", 4095, 2700, 3)
light("down", 900, 3185, 3)                    # 廊下
light("down", 2700, 3185, 3)
light("ceiling", 1365, 5000, 3, shadow=True)   # 主寝室
light("down", 3185, 5000, 3)                   # WIC
light("ceiling", 4550, 5500, 3)                # 洋室B
light("down", 4550, 7500, 3)

# ══════════════════════════ 注記 ══════════════════════════
item("memo", 1200, -1600, 2200, 500, 1, color="#fff3a6",
     noteText="都市型3階建てモデルプラン 3LDK+WIC\n"
              "敷地約76㎡(23坪) / 延床約134㎡(40坪)\n"
              "3階の高窓→吹き抜け→2階リビングへ光を落とす")
item("ruler", SX0 + SW / 2, SY1 + 600, SW, 120, 1, color="#2f80ed")

# ══════════════════════════ 仕上げのカスケード ══════════════════════════
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
        "int": {"pos": [2.4, 5.0, 6.9], "target": [0.3, 4.6, 6.9]},
    },
)
