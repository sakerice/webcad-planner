from pathlib import Path
#!/usr/bin/env python3
"""13.25㎡のリビング吹抜と家事動線を中心にした2階建て・3LDKの既定プラン。

建物外形8190×7280mm、南道路、敷地約150㎡。1階は家事室・家族収納・
庭へ開くLDK。2階は北の子ども室2室と東の主寝室、吹抜に面する廊下。衣類収納を
家具として配置する。家具の正面は設計上0=北、90=東で記述し、出力時に
orient_catalog_furnitureで実モデルの正面軸へ変換する。
調査・採寸・検証記録: docs/default-plans-redesign.md
"""
import json
import os
import sys

M = 910          # 1モジュール
CEIL = 2400      # 旧定数。器具の取付はPlan.ceiling_elevで実天井に合わせる

# 色パレット
# ── 内装のカラーパレット(グレージュ基調) ─────────────────────────────
# 明度は 天井 > 壁 > 建具 > 床 > 家具 の順に単調に下げ、明るい面ほど彩度を
# 落とす(壁・天井 C*≤5 / 床 C*13.7 / 木部アクセント C*20台)。この2つを
# 守っている限り色数を増やしても濁らない。数値は L*/C* の実測。
COL_CEIL = "#F4F2ED"       # 天井 L*95.5 C*2.6
COL_WALL_INT = "#EFEDE7"   # 内壁 L*93.7 C*3.1(生成テクスチャの基調と同じ)
COL_ACCENT = "#6F6B64"     # アクセント壁 L*45.4 C*4.5
COL_STUDY = "#4E5257"      # 書斎(狭い部屋ほど濃色が効く) L*34.7
COL_WHITE = "#F2F0EB"      # 外壁メイン(白塗り壁)
COL_CHARCOAL = "#3A3D40"   # 外壁アクセント(ガルバ)
COL_WOOD = "#8B5E3C"       # 木調アクセント
COL_ROOF = "#2B2B2B"       # 屋根・雨樋・破風・金物
COL_SASH = "#1c1c1c"       # サッシ
COL_DOOR = "#5C4230"       # 玄関ドア(ダークウォールナット)
COL_FENCE = "#222222"      # 黒格子フェンス

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from plan_kit import Plan, load_catalog, wall_setting, finish_cascade, orient_catalog_furniture  # noqa: E402

# 組み立ての決まりごと(座標・高さの基準・カタログ寸法の扱い)は plan_kit が持つ。
# ここが持つのは「この家をどう設計したか」だけにする。
CATALOG = load_catalog(ROOT)
P = Plan(catalog=CATALOG, interior_color=COL_WALL_INT)
wall, room, item = P.wall, P.room, P.item
win, door, light = P.win, P.door, P.light
def dress(window, kind="curtain"):
    return P.dress(window, kind, opened=True)
ceiling_elev, ceiling_mounted = P.ceiling_elev, P.ceiling_mounted
walls, rooms, items = P.walls, P.rooms, P.items

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
wall(0, 1820, 3340, 1820, 1)          # 浴室+洗面|ランドリー
wall(3340, 0, 3340, 2730, 1)          # 水まわり|キッチン
# キッチンとダイニング間の壁・開口枠を撤去。アイランド四周を開放。
# wall(3640, 2730, 6370, 2730, 1)          # 北ゾーン|洋室+LDK
wall(0, 3640, 3340, 3640, 1, interiorColor="#C8BFB1")          # 家事室の南壁 / LDK
wall(3340, 2730, 3340, 3640, 1)       # 家事室の東壁
wall(6370, 1820, 6370, 3640, 1)
wall(6370, 4550, 6370, BD, 1)            # 東ゾーン背骨
wall(7280, 0, 7280, 4550, 1)          # 階段室西壁
wall(6370, 1820, 7280, 1820, 1)       # パントリー南
wall(6370, 3640, 7280, 3640, 1)       # トイレ南

room("浴室", 0, 0, 1820, 1820, 1, texture="tile_floor")
room("洗面脱衣室", 1820, 0, 1520, 1820, 1, texture="tile_floor")
room("ファミリークローゼット", 0, 1820, 1820, 1820, 1, texture="wood_oak")
room("ランドリー", 1820, 1820, 1520, 1820, 1, texture="tile_floor")
wall(1820, 1820, 1820, 3640, 1)
door("door-opening", 1820, 3050, 820, 1, vertical=True)
room("キッチン", 3340, 0, 3030, 3640, 1, texture="wood_oak")
# 南西の13.25㎡を家の中心とする。ソファの真上から2階天井まで開ける。
room("リビング吹抜", 0, 3640, 3640, 3640, 1, texture="wood_oak",
     ceiling={"type": "void", "toFloor": 2})
room("ダイニング", 3640, 3640, 2730, 3640, 1, texture="wood_oak")
room("冷蔵庫スペース", 6370, 0, 910, 1820, 1, texture="wood_oak")
room("階段", 7280, 0, 910, 4550, 1, texture="wood_oak")
room("トイレ", 6370, 1820, 910, 1820, 1, texture="tile_floor")
room("ホール", 6370, 3640, 910, 910, 1, texture="wood_oak")
room("ホール", 6370, 4550, 1820, 910, 1, texture="wood_oak")
room("玄関", 6370, 5460, 1820, 1820, 1, texture="porch_tile")

# ── 1F 建具 (引戸は引き代を戸幅ぶん確保できる位置にだけ置く)
door("door-fold", 1820, 1250, 780, 1, vertical=True)            # 浴室(折戸・脱衣室から)
door("door-swing", 2800, 1820, 780, 1, flipY=True)                        # 洗面→ランドリー
door("door-swing", 2920, 3640, 780, 1, flipY=True)                        # ランドリー↔LDK
door("door-swing-s", 6825, 3640, 650, 1)                        # トイレ(外開き)
door("door-opening", 3340, 3150, 780, 1, vertical=True)  # 洋室↔LDK
door("door-front", 7280, BD, 940, 1, color=COL_DOOR)            # 玄関ドア

# ── 1F 窓 (上端2030の通りで揃える)
dress(win(4350, BD, 1, "25620", 0, 2030))                    # LDK南 大開口
dress(win(1400, BD, 1, "16520", 0, 2030))                    # 洋室南 掃き出し
dress(win(4440, 0, 1, "07409", 950, 1080), "roller")                   # キッチン北(カウンター上)
win(2600, 0, 1, "06905", 2100, 250, kind="fix")       # 洗面北(採光FIX)
win(7735, 0, 1, "06905", 1460, 570)                   # 階段上部の高窓
win(900, 0, 1, "06905", 2100, 250, kind="fix")        # 浴室北(採光FIX)
dress(win(0, 4950, 1, "11909", 950, 1080, vertical=True))    # 洋室西
win(0, 6400, 1, "03613", 660, 1370, vertical=True, kind="casement")   # 洋室西スリット
win(0, 3050, 1, "07409", 1460, 570, vertical=True, kind="fix")    # ランドリー西
win(BW, 6900, 1, "F03613", 660, 1370, vertical=True, kind="fix")      # 玄関東
win(BW, 4200, 1, "F03613", 660, 1370, vertical=True, kind="fix")      # 階段東(踏面の低い側)

# ── 階段 (ホールから北へ上り、頂部コーナーで西へ抜ける)
# 直進は y910-3640、廻りは y0-910。吹き抜けが y3640 で止まるので
# 2階の x7280-8190 / y3640-4550 に床が残り、トイレの扉が床側へ開く
item("stair", 7735, 2275, 910, 2730, 1, rot=180, color="#e8e0c8", stairOrder=1)
_c = item("stair-corner", 7735, 455, 910, 910, 1, rot=0,
          color="#e8e0c8", stairOrder=2)
_c["flipX"] = True

# ══════════ 2F ══════════
w_n2 = wall(0, 0, BW, 0, 2)
w_e2 = wall(BW, 0, BW, BD, 2)
w_s2m = wall(0, BD, 6370, BD, 2)
w_s2e = wall(6370, BD, BW, BD, 2)
w_w2 = wall(0, BD, 0, 0, 2)

# 階段は廻り段(y910-1820)を上がりきって西へ抜ける。着地する x6370-7280 を
# 南北に通したホールにして、トイレの中に降り立たないようにする。
# 吹抜は廻り段を含む y910-3640。y3640-4550 は下から5段ぶんで頭上2359mm残る。
wall(0, 2730, 6370, 2730, 2)          # 北ゾーン|廊下   (直下: 1F y2730)
wall(0, 3640, 3640, 3640, 2, wallStyle="solid", wallHeight=1100)
wall(3640, 3640, 6370, 3640, 2)          # 廊下|南ゾーン   (直下: 1F x2730/x6370で分割)
# x6370-7280 の y3640 は廊下から東の廊下への通り抜け
wall(3640, 0, 3640, 2730, 2)          # 洋室A|洋室B     (直下: 1F x3640)
wall(6370, 0, 6370, 2730, 2)          # 洋室B|2Fホール  (直下: 1F x6370)
wall(6370, 3640, 6370, 4550, 2)       # 書斎|廊下       (直下: 1F x6370)
wall(6370, 4550, 6370, BD, 2)         # 書斎|洗面・収納    (直下: 1F x6370)
wall(7280, 910, 7280, 3640, 2)        # 2Fホール|吹抜   (直下: 1F x7280)
# x7280 の y0-910 は廻り段を上がって西へ抜ける口
wall(7280, 3640, 8190, 3640, 2)       # 吹抜の手すり壁
wall(3640, 3640, 3640, 5460, 2)       # 主寝室|書斎
wall(3640, 5460, 3640, BD, 2)         # 主寝室|吹抜
# 書斎は閉じた壁と高い室内窓で、吹抜への音・光の漏れを抑える。

wall(6370, 4550, 8190, 4550, 2)       # 廊下|トイレ・洗面
wall(6370, 6370, 8190, 6370, 2)       # トイレ|収納

room("洋室A", 0, 0, 3640, 2730, 2, texture="wood_oak")
room("洋室B", 3640, 0, 2730, 2730, 2, texture="wood_oak")
room("ホール", 6370, 0, 910, 2730, 2, texture="wood_oak")
room("ギャラリー", 0, 2730, 7280, 910, 2, texture="wood_oak")
room("廊下", 6370, 3640, 1820, 910, 2, texture="wood_oak")
room("主寝室", 3640, 3640, 2730, 3640, 2, texture="wood_oak")

# x0-3640 / y3640-7280 はリビングの吹き抜け(床なし)
room("トイレ・洗面", 6370, 4550, 1820, 1820, 2, texture="tile_floor")
room("リネン収納", 6370, 6370, 1820, 910, 2, texture="wood_oak")
# x7280-8190 / y0-3640 は階段吹き抜け(床なし)

# ── 2F 建具
door("door-swing", 1600, 2730, 780, 2, flipY=True, flipX=True)   # 洋室A(室内開き)
door("door-swing", 5000, 2730, 780, 2, flipY=True, flipX=True)   # 洋室B(室内開き)
door("door-swing", 6370, 4100, 780, 2, vertical=True, flipY=True)                # 主寝室(引戸)
                  # 書斎(廊下から)
door("door-swing-s", 7735, 4550, 650, 2, flipY=True)    # 2Fトイレ(室内開き)
door("door-fold", 6825, 6370, 780, 2) # リネン収納(洗面から)

# ── 2F 窓 (上端2030で1Fと通りを揃える)
dress(win(1400, 0, 2, "16513", 950, 1080), "roller")         # 洋室A北(腰窓950)
dress(win(0, 1400, 2, "16513", 950, 1080, vertical=True), "roller")  # 洋室A西(腰窓950)
dress(win(4800, 0, 2, "16513", 950, 1080), "roller")         # 洋室B北(腰窓950)
win(6825, 0, 2, "06905", 1460, 570)                   # 2Fホール北
win(0, 5000, 2, "16513", 400, 1630, vertical=True, kind="fix")    # 主寝室西(腰窓950)
win(1820, BD, 2, "16513", 400, 1630, kind="fix")                    # 主寝室南 掃き出し(バルコニーへ)
dress(win(4230, BD, 2, "07409", 1100, 930), "roller")
dress(win(5680, BD, 2, "07409", 1100, 930, kind="casement"), "roller")                  # 吹抜の高窓(南)
win(BW, 5460, 2, "06905", 1460, 570, vertical=True)   # 2Fトイレ東
win(BW, 2400, 2, "F03613", 660, 1370, vertical=True, kind="fix")      # 吹き抜け東
    # 書斎→吹き抜けの室内窓(欄間)

# ── 屋根 (フラットルーフのキューブ型・軒の出450)
item("roof", BW / 2, BD / 2, BW + 900, BD + 900, 3, rot=0,
     color=COL_ROOF, roofType="flat", pitch=5, elev=0,
     roofThickness=260, roofSkirt=0, roofEdgeColor=COL_ROOF)
item("roof", 7280, 7660, 1820, 1000, 2, rot=180,
     color=COL_ROOF, roofType="mono", pitch=3, elev=0,
     roofThickness=80, roofSkirt=0, roofEdgeColor=COL_ROOF)

# ══════════ 敷地・外構 ══════════
SX0, SX1 = -M, BW + 2275          # -910 .. 10465
# 北の空きは1820。軒先(y-450)から境界(y-1820)まで1370あり、
# 北側斜線 5m+1.25D = 6712 > 建物高さ6110 を満たす
SY0, SY1 = -2 * M, BD + 4095      # -1820 .. 11375
SW = SX1 - SX0                    # 11375

item("site-rect", SX0 + SW / 2, -910, SW, 1820, 1,
     color="rgba(160,150,130,0.15)", siteSurface="gravel")     # 北 防犯砂利
item("site-rect", SX0 + SW / 2, 4245, SW, 8490, 1,
     color="rgba(100,160,100,0.1)", siteSurface="grass")       # 建物+南庭
item("site-rect", SX0 + SW / 2, 9932.5, SW, 2885, 1,
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
item("lattice-screen", 1000, 9130, 1600, 60, 1, color=COL_WOOD,
     latticeHeight=1100, fencePattern="vertical", fenceTopStyle="even")
item("lattice-screen", 4800, 9130, 1800, 60, 1, color=COL_WOOD,
     latticeHeight=1100, fencePattern="vertical", fenceTopStyle="even")
# 機能門柱。表札・インターホン・ポスト・照明が付いた実物のモデル。
# custom-block の板1枚では「未完成のフィン」にしか見えなかった
item("fmp-GatePost01", 6130, 11250, 400, 200, 1, rot=180)

# 玄関ポーチ(平坦な踏込み)+階段。ドアが階段の上に直接開かないようにする
item("custom-block", 7280, 7880, 1820, 1200, 1, color="#b9b8b4",
     customHeight=450, name="玄関ポーチ", texture="porch_tile")
item("exterior-stair", 7280, 8930, 1820, 900, 1, rot=180,
     color="#b8b2a8", targetHeight=450, accessSteps=3, texture="porch_tile")
item("custom-block", 7100, 9930, 1100, 2880, 1, color="#b9b8b4",
     customHeight=20, name="アプローチ", texture="porch_tile")
# 掃き出し窓の外のウッドデッキ(FL450の段差解消)。壁面に付けて2台連続させる
# デッキの正面(幕板側)は南=庭に向く。モデルの正面は +Y なので rot=180
item("fmp-WoodDeck01", 1750, 7730, 2600, 900, 1, rot=180)   # 洋室の前
item("fmp-WoodDeck01", 4354, 7730, 2600, 900, 1, rot=180)   # LDK大開口の前
item("exterior-stair", 2900, 8630, 1800, 900, 1, rot=180,
     color="#8a7256", targetHeight=450, accessSteps=3, texture="wood_cedar")

# 駐車(道路並列)・自転車
# 車体色は明るいグレーにしない。白っぽい背景と柔らかい照明では明暗差が
# 出ず、ボンネットの膨らみもキャラクターラインもパネルの分割線も
# 全部消える(同じモデル・同じカメラで色だけ変えて確認した)。
# 中間色にすると面の流れとグリーンハウスとの対比が出る
item("car", 3450, 10100, 1800, 4400, 1, rot=90, color="#2f6ea8")
item("bicycle", 8800, 10200, 580, 1850, 1, rot=0, color="#a8b4c4")
item("bicycle-fold", 9400, 10200, 550, 1450, 1, rot=0, color="#d8a878")

# 植栽
item("tree", 9600, 1300, 1500, 1500, 1, color="#6f855f")
item("tree", 9300, 3600, 1300, 1300, 1, color="#74895f")
item("tree", 9500, 6300, 1500, 1500, 1, color="#7d9268")   # シンボルツリー
item("tree", 9500, 8400, 1500, 1500, 1, color="#7d9268")   # 東の緑

# 住宅設備。給湯器はガス1台に統一し、北側通路を塞がない位置へ
item("lattice-screen", 1750, -520, 3500, 60, 1, color=COL_FENCE,
     latticeHeight=1800, fencePattern="vertical", fenceTopStyle="even")
item("gas-heater", 200, -250, 470, 240, 1, color="#e8e9eb")
item("meter-box", -70, 1200, 180, 120, 1, rot=90, color="#c8cacc", elev=1600)
item("sewer-pit", 6300, -500, 300, 300, 1, color="#6f7275")
item("sewer-pit", 6800, -500, 300, 300, 1, color="#6f7275")
item("sewer-pit", 7900, -500, 300, 300, 1, color="#6f7275")
item("sewer-pit", 8400, 3200, 300, 300, 1, color="#6f7275")
item("sewer-pit", 5900, 9300, 300, 300, 1, color="#6f7275")
item("sewer-pit", 500, 9600, 300, 300, 1, color="#6f7275")

# エアコン。守る決まりは3つ。
#   1. 居室には必ず室内機を置く。室外機だけが外に並ぶと、屋外から見たときに
#      「中にエアコンが無い部屋の室外機」に見える
#   2. 室内機は必ず外壁面。冷媒管は外壁を貫通するので内壁には付かない
#   3. 室外機の**正面(吹き出し)を建物の外へ向ける**。壁を向けると風が戻る
#      (rot は正面が向く方角。西の壁際なら -90 = 西向き)
AC_PAIRS = [
    # (室内機 cx, cy, rot, floor, elev, 室外機 cx, cy, rot)
    (4150, 130, 180, 1, 2050, 5300, -210, 0),    # キッチン+ダイニング(北外壁)
    # 南の外壁は大開口とデッキで埋まっているので、室外機はデッキ東端の
    # 脇(デッキとポーチ格子の間)に縦置きし、吹き出しは西の芝生側へ逃がす
       # リビング(吹抜の南壁・高所)
    # 西面は2台並ぶ。**それぞれ自分の部屋の真下に置く**こと。近い方から
    # 総当りで対にするので、位置を入れ替えると2階の室内機が1階の室外機に
    # 取られ、「室内機の無い室外機」と「室外機の無い室内機」が同時に出る
    (190, 4100, 90, 1, 2050, -210, 3400, -90),   # 洋室(西外壁)
    (2900, 130, 180, 2, 2050, 3300, -210, 0),    # 洋室A(北壁)
    (5500, 130, 180, 2, 2050, 4400, -210, 0),    # 洋室B(北壁)
    (5500, 7150, 0, 2, 2150, 5900, 8600, -90),   # 主寝室(西壁)
]
for ix, iy, irot, fl, iel, ox, oy, orot in AC_PAIRS:
    item("fmp-AirConditionerWall01", ix, iy, 800, 260, fl, rot=irot, elev=iel)
    item("ac-outdoor", ox, oy, 800, 300, 1, rot=orot, color="#d8dadc")

# 道路・電柱・隣家
item("road", 5280, SY1 + 2275, 30000, 4550, 1, color="#55585c", contextHeight=70)
# 東西の隣家はこの家と同じ道路(南)に面するので、玄関側=南を向く(rot=180)。
# 既定の rot=0 のままだと3軒とも道路に背を向けて建つ
item("neighbor-house", 14560, 3485, 7280, 6370, 1, rot=180,
     color="#d7c1a3", contextFloors=2, contextHeight=6300, contextGhost=True)
item("neighbor-house", -4960, 3985, 7280, 6370, 1, rot=180,
     color="#c9c2b4", contextFloors=2, contextHeight=6300, contextGhost=True)
# 北の家は反対側(北)の道路に面するので、こちらへは背面(北向き=rot 0)を見せる
item("neighbor-house", 4340, -4615, 7280, 6370, 1, rot=0,
     color="#b9bcc2", contextFloors=2, contextHeight=6300, contextGhost=True)
item("neighbor-building", -3200, SY1 + 6850, 5200, 3600, 1,
     color="#8f98a3", contextFloors=3, contextHeight=9150, contextGhost=True)

# ══════════ 1F 家具 ══════════
# ── 浴室 (1坪UB)
item("fmp-BathTub03", 400, 800, 1179, 535, 1, rot=90)
item("fmp-ShowerSystem03", 1200, 300, 281, 451, 1, rot=180)

# ── 洗面脱衣室 (1坪)
item("washer", 2930, 390, 640, 640, 1, rot=0)
item("fmp-BathroomVanity07", 2230, 300, 682, 426, 1, rot=180)
item("fmp-WashBasin01", 2230, 300, 644, 435, 1, rot=180, elev=695)

# ── 家事室とファミリー収納。洗面→干す→しまうを同じ階で完結。
item("original-wardrobe", 910, 2170, 1000, 580, 1, rot=180)
item("original-laundry-cabinet", 2130, 2350, 900, 500, 1, rot=90)
ceiling_mounted("original-laundry-rail", 2630, 2850, 1, w=1100, d=80)

# ── キッチン: 2560mmの調理列と背面収納。二人で立つ中央通路は約1.4m。
# 四方が壁から離れたシンクアイランド。加熱は北壁に寄せる。
item("original-kitchen-island", 4805, 2800, 2100, 900, 1, rot=90, flipX=True, kitchenRole="sink", kitchenWorkPoint={"x":-420,"y":80})
item("original-kitchen-cooking", 4990, 390, 2560, 650, 1, rot=180, kitchenRole="stove", kitchenWorkPoint={"x":750,"y":0})
item("fmp-KitchenExhaust07", 5740, 293, 466, 466, 1, rot=180, elev=1970, color="#44484b")
# 冷蔵庫は東側のアルコーブへ。アイランドの引き出し前に置かない。
item("fmp-Refrigerator02", 6800, 450, 640, 695, 1, rot=180)
item("im0261-Kitchen-MEGA_PACK_kitchen-electronic-298603_Frame_Black", 3940, 390, 340, 351, 1, rot=180, elev=850)

# ── LDK: 旧客間を統合。西のソファ・北のTV・東のダイニング。
# 家事室の引戸正面、玄関から庭へ向かう東側の通路を空ける。
item("im0261-Tableset-MEGA_PACK_Tableset-tableset_614454_Frame_Walnut",
     4660, 5480, 1758, 1329, 1)
item("original-sideboard",
     1820, 3910, 1400, 420, 1, rot=180)
item("im0261-Tv-MEGA_PACK_tv-electronic-280915", 1820, 3860, 1230, 211, 1,
     rot=180, elev=760)
item("original-sofa", 1820, 5710, 2100, 900, 1, rot=0,
     finishColors={"fabric":"#C4BDAF", "wood":"#705842"})
item("im0261-Table-MEGA_PACK_Table-table-309959", 3150, 5550, 460, 460, 1)
item("im0261-Plant-MEGA_PACK_Plant-plant-230510", 6000, 6600, 618, 719, 1)


# ── トイレ・パントリー・玄関
item("fmp-Toilet01", 6600, 2140, 339, 516, 1, rot=180)
# 造作の手洗いカウンター。単色の箱のままだと「置き忘れたブロック」に見える。
# 木の天板として仕上げる
item("custom-block", 7008, 2150, 496, 423, 1, rot=-90, color="#a9866a",
     customHeight=750, name="手洗いカウンター", texture="wood_cedar")
item("fmp-WashBasin04", 7008, 2150, 496, 423, 1, rot=-90, elev=750)
item("original-shoe-counter",
     6635, 6370, 1600, 410, 1, rot=90, finishColors={"body":"#B39A78"})                      # 下駄箱(西壁)

# ══════════ 2F 家具 ══════════
# 主寝室は吹抜の東へ。北の衣類収納前に600mm、ベッド両脇に約500mm。
item("original-bed", 5005, 5960, 1600, 2150, 2, rot=180,
     finishColors={"fabric":"#D6CBB8", "wood":"#80634A"})
item("original-wardrobe", 4200, 3990, 1000, 580, 2, rot=180)
item("original-wardrobe", 5200, 3990, 1000, 580, 2, rot=180)
item("im0261-Table-MEGA_PACK_Table-table-309959", 3960, 5130, 460, 460, 2, rot=180)
item("im0261-Lamp-MEGA_PACK_lamp-lamp-126685_frame", 3960, 5130, 200, 200, 2,
     rot=180, elev=513)

# ── 収納の中身。扉を開けて床しか無い部屋を無くす

# リネン収納は浴室用品・季節物。廊下と兼用した細い納戸は作らない。
# ── 洋室A（ベッド・机・衣類収納）
item("fmp-Table44", 2900, 340, 1049, 524, 2, rot=180)
item("fmp-Chair29", 2900, 900, 430, 442, 2, rot=0)
item("im0261-Lamp-MEGA_PACK_lamp-lamp-573754_frame", 3300, 340, 245, 239, 2,
     rot=180, elev=626)
# 窓装飾は壁から出る。ロールスクリーン(50)の先まで枕元を下げる [check22]
item("fmp-Bed05", 760, 1150, 1112, 1950, 2, rot=180)
item("original-wardrobe", 3000, 2380, 1000, 580, 2, rot=0)

# ── 洋室B（ベッド・机・衣類収納）
item("fmp-Bed05", 4246, 1150, 1112, 1950, 2, rot=180)
item("original-wardrobe", 6020, 2100, 1000, 580, 2, rot=-90)
item("fmp-Table44", 5720, 340, 1049, 524, 2, rot=180)
item("fmp-Chair29", 5720, 1000, 430, 442, 2, rot=0)
item("im0261-Lamp-MEGA_PACK_lamp-lamp-573754_frame", 6050, 340, 245, 239, 2, rot=180, elev=626)
# 北壁に付けると窓のカーテン(FL+660から下がる)へ天板が食い込むので東壁に回す

# ── 2Fトイレ・洗面
item("fmp-Toilet01", 7735, 6050, 339, 516, 2, rot=0)
item("custom-block", 7918, 5450, 496, 423, 2, rot=-90, color="#a9866a",
     customHeight=750, name="手洗いカウンター", texture="wood_cedar")
item("fmp-WashBasin04", 7918, 5450, 496, 423, 2, rot=-90, elev=750)

# ══════════ 照明 ══════════
# 吹き抜けのシーリングファン。天井5280の直下に吊る(器具高さ350)
# ファンはキャノピー上端が天井面に来る高さで吊る(elev = 天井 - モデル高)
ceiling_mounted("fmp-CeilingFan01", 1820, 5460, 1, w=1200, d=1200, rot=0)
# 吹き抜けの照明は天井(FL+5388)の埋込。以前はファンの下に直付け器具を
# 宙吊りにしていて、何にも留まっていない円盤が浮いていた。
# ファンの回転域(φ1200)を避けて2灯に振り分ける
light("down", 700, 4400, 1)
light("down", 2900, 6650, 1)
light("down", 4660, 5480, 1, shadow=True)   # ダイニング
light("down", 4300, 700, 1)
light("down", 5500, 700, 1)
light("down", 4805, 2800, 1)                   # キッチン手元
light("down", 2700, 900, 1)
light("down", 900, 900, 1)
light("down", 1800, 2900, 1)                   # ランドリー
light("down", 6825, 2700, 1)
light("down", 6825, 4100, 1)
light("down", 7300, 5000, 1)
light("down", 7300, 6300, 1)
light("down", 7750, 6950, 1)                   # 玄関土間
light("down", 6825, 900, 1)                    # パントリー
light("down", 7735, 400, 1)                    # 階段の上り切り
light("down", 7735, 2300, 1)                   # 階段直進部
light("down", 7280, 7900, 1, 2600)                   # 玄関ポーチ

light("ceiling", 1800, 1400, 2)                # 洋室A
light("ceiling", 5000, 1400, 2)                # 洋室B
light("down", 7735, 5200, 2)                   # 2Fトイレ
light("down", 6825, 800, 2)                    # 2Fホール北
light("down", 6825, 2100, 2)                   # 2Fホール南
light("down", 7100, 4100, 2)                   # 2F廊下(東)
light("down", 6825, 5900, 2)                   # 2F洗面
# 有効幅790mmの廊下で至近から見上げるので、中心が1.4m前後になる高さにする
light("down", 1500, 3180, 2)                   # 廊下
light("down", 4500, 3180, 2)
light("ceiling", 5005, 5600, 2, shadow=True)   # 主寝室
light("down", 4660, 5480, 2)                   # 主寝室収納前
                   # 主寝室収納前
                   # 書斎

# ══════════ 注記 ══════════
item("memo", 1200, -1600, 2200, 500, 1, color="#fff3a6",
     noteText="モダン2階建てモデルプラン 3LDK・大吹抜・家事室\n敷地約150㎡ / 建物外形8.19×7.28m\n13.25㎡のリビング吹抜・家事収納動線")
item("ruler", SX0 + SW / 2, SY1 + 600, SW, 120, 1, color="#2f80ed")

# ══════════ 外装カスケード ══════════
def wall_setting(color, texture):
    return {"color": color, "texture": texture,
            "textureFlipX": False, "textureFlipY": False}

ext_walls_map = {}
for w in (w_e1, w_s1e, w_e2, w_s2e):
    ext_walls_map[str(w["id"])] = wall_setting(COL_CHARCOAL, "galvalume_dark")

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
    "interiorWallSettings": {
        "whole": {"linked": False, "color": COL_WALL_INT, "texture": "wall_int",
                  "textureFlipX": False, "textureFlipY": False},
        "floors": {str(f): {"linked": False, "color": COL_WALL_INT,
                            "texture": "wall_int",
                            "textureFlipX": False, "textureFlipY": False}
                   for f in (1, 2, 3, 4)},
        "faces": {},
    },
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
orient_catalog_furniture(P.items)

# Keep the entrance at datum and the interior floors flush.
from default_plan_review import finish_raised_floors
finish_raised_floors(plan)
from default_plan_2f_review import apply_review_23
apply_review_23(plan)
# Review 24 is an exact user checkpoint; do not reapply layout corrections.
from default_plan_review import apply_patch_file
apply_patch_file(plan, "default_plan_2f_review_24.json")
review24 = json.loads(Path(__file__).with_name("default_plan_2f_review_24.json").read_text())
plan.update(review24["metadata"])
for collection, order in review24["order"].items():
    by_id = {obj["id"]: obj for obj in plan[collection]}
    plan[collection] = [by_id[object_id] for object_id in order]
with open(out, "w", encoding="utf-8") as f:
    json.dump(plan, f, ensure_ascii=False, indent=1)
