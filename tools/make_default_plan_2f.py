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
CEIL = 2400      # WALL_H。elev+モデル高がこれを超えないこと

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
from plan_kit import Plan, load_catalog, wall_setting, finish_cascade  # noqa: E402

# 組み立ての決まりごと(座標・高さの基準・カタログ寸法の扱い)は plan_kit が持つ。
# ここが持つのは「この家をどう設計したか」だけにする。
CATALOG = load_catalog(ROOT)
P = Plan(catalog=CATALOG, interior_color=COL_WALL_INT)
wall, room, item = P.wall, P.room, P.item
win, door, light = P.win, P.door, P.light
dress = P.dress
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
wall(0, 1820, 3640, 1820, 1)          # 浴室+洗面|ランドリー
wall(3640, 0, 3640, 2730, 1)          # 水まわり|キッチン
wall(0, 2730, 6370, 2730, 1)          # 北ゾーン|洋室+LDK
wall(2730, 2730, 2730, BD, 1, interiorColor=COL_ACCENT,
     interiorTexture="wall_int")   # 洋室(1F)|LDK ← TV背面のアクセント面
wall(0, 3640, 2730, 3640, 1)          # 押入南 (2F y3640壁の直下支持)
wall(6370, 0, 6370, BD, 1)            # 東ゾーン背骨
wall(7280, 0, 7280, 4550, 1)          # 階段室西壁
wall(6370, 1820, 7280, 1820, 1)       # パントリー南
wall(6370, 3640, 7280, 3640, 1)       # トイレ南
wall(6370, 4550, 7280, 4550, 1)       # 廊下|ホール (x7280-8190 は階段の上り口)
wall(6370, 5460, 8190, 5460, 1)       # ホール|玄関

room("浴室", 0, 0, 1820, 1820, 1, texture="tile_floor")
room("洗面脱衣室", 1820, 0, 1820, 1820, 1, texture="tile_floor")
room("ランドリー", 0, 1820, 3640, 910, 1, texture="tile_floor")
room("キッチン", 3640, 0, 2730, 2730, 1, texture="wood_oak")
room("押入", 0, 2730, 2730, 910, 1, texture="wood_oak")
room("洋室", 0, 3640, 2730, 3640, 1, texture="wood_oak")
room("LDK", 2730, 2730, 3640, 2730, 1, texture="wood_oak")
room("LDK", 2730, 5460, 910, 1820, 1, texture="wood_oak")
# リビングの上は2階の床を張らない。天井高は書かない -- toFloor だけ宣言すれば
# アプリが階高から計算する。手で数字を書くと階高を変えた瞬間に上階の天井と
# 食い違い、スラブの小口が室内に見える
room("リビング", 3640, 5460, 2730, 1820, 1, texture="wood_oak",
     ceiling={"type": "void", "toFloor": 2})
room("パントリー", 6370, 0, 910, 1820, 1, texture="wood_oak")
room("階段", 7280, 0, 910, 4550, 1, texture="wood_oak")
room("トイレ", 6370, 1820, 910, 1820, 1, texture="tile_floor")
room("廊下", 6370, 3640, 910, 910, 1, texture="wood_oak")
room("ホール", 6370, 4550, 1820, 910, 1, texture="wood_oak")
room("玄関", 6370, 5460, 1820, 1820, 1, texture="porch_tile")

# ── 1F 建具 (引戸は引き代を戸幅ぶん確保できる位置にだけ置く)
door("door-fold", 1820, 1250, 780, 1, vertical=True)            # 浴室(折戸・脱衣室から)
door("door-slide-s", 2730, 1820, 780, 1)                        # 洗面→ランドリー
door("door-opening", 3185, 2730, 650, 1)                        # ランドリー↔LDK
door("door-fold-w", 1400, 3640, 1650, 1)                        # 押入(折戸)
door("door-opening", 5005, 2730, 2730, 1)                       # キッチン↔LDK 全面開口
door("door-opening", 6370, 900, 780, 1, vertical=True)          # パントリー
door("door-swing-s", 6825, 3640, 650, 1)                        # トイレ(外開き)
door("door-opening", 6760, 4550, 780, 1)                        # ホール↔廊下
door("door-swing", 2730, 6700, 780, 1, vertical=True, flipX=True)  # 洋室↔LDK
door("door-swing-s", 6370, 4100, 650, 1, vertical=True)         # LDK↔廊下
door("door-opening", 7280, 5460, 1650, 1)                       # 玄関→ホール(上り框)
door("door-front", 7280, BD, 940, 1, color=COL_DOOR)            # 玄関ドア

# ── 1F 窓 (上端2030の通りで揃える)
dress(win(4350, BD, 1, "25620", 0, 2030))                    # LDK南 大開口
dress(win(1400, BD, 1, "16520", 0, 2030))                    # 洋室南 掃き出し
dress(win(5450, 0, 1, "16513", 1200, 830), "roller")                   # キッチン北(カウンター上)
win(2600, 0, 1, "06905", 1460, 570, kind="fix")       # 洗面北(採光FIX)
win(7735, 0, 1, "06905", 1460, 570)                   # 階段上部の高窓
win(900, 0, 1, "06905", 1460, 570, kind="fix")        # 浴室北(採光FIX)
dress(win(0, 4600, 1, "16513", 660, 1370, vertical=True))    # 洋室西
win(0, 6400, 1, "03613", 660, 1370, vertical=True, kind="casement")   # 洋室西スリット
dress(win(0, 2275, 1, "07409", 1260, 770, vertical=True), "roller")    # ランドリー西
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
wall(0, 3640, 6370, 3640, 2)          # 廊下|南ゾーン   (直下: 1F x2730/x6370で分割)
# x6370-7280 の y3640 は廊下から東の廊下への通り抜け
wall(3640, 0, 3640, 2730, 2)          # 洋室A|洋室B     (直下: 1F x3640)
wall(6370, 0, 6370, 2730, 2)          # 洋室B|2Fホール  (直下: 1F x6370)
wall(6370, 3640, 6370, 4550, 2)       # 書斎|廊下       (直下: 1F x6370)
wall(6370, 4550, 6370, BD, 2)         # WIC/書斎|納戸    (直下: 1F x6370)
wall(7280, 910, 7280, 3640, 2)        # 2Fホール|吹抜   (直下: 1F x7280)
# x7280 の y0-910 は廻り段を上がって西へ抜ける口
wall(7280, 3640, 8190, 3640, 2)       # 吹抜の手すり壁
wall(910, 2730, 910, 3640, 2)         # リネン庫|廊下
wall(2730, 3640, 2730, BD, 2)         # 主寝室|WIC     (直下: 1F x2730)
wall(3640, 3640, 3640, 5460, 2)       # WIC|書斎
wall(3640, 5460, 3640, BD, 2)         # WIC|吹抜
# 吹抜の north 側は手すり。壁で塞ぐと2層の抜けが死ぬ
wall(3640, 5460, 6370, 5460, 2, wallStyle="balcony-fence", wallHeight=1100)
wall(6370, 4550, 8190, 4550, 2)       # 廊下|納戸・トイレ
wall(7280, 4550, 7280, BD, 2)         # 納戸|トイレ・収納
wall(7280, 6370, 8190, 6370, 2)       # トイレ|収納

room("洋室A", 0, 0, 3640, 2730, 2, texture="wood_oak")
room("洋室B", 3640, 0, 2730, 2730, 2, texture="wood_oak")
room("ホール", 6370, 0, 910, 2730, 2, texture="wood_oak")
room("リネン庫", 0, 2730, 910, 910, 2, texture="wood_oak")
room("廊下", 910, 2730, 6370, 910, 2, texture="wood_oak")
room("廊下", 6370, 3640, 1820, 910, 2, texture="wood_oak")
room("主寝室", 0, 3640, 2730, 3640, 2, texture="wood_oak")
room("WIC", 2730, 3640, 910, 3640, 2, texture="wood_oak")
room("書斎", 3640, 3640, 2730, 1820, 2, texture="wood_oak")
# x3640-6370 / y5460-7280 はリビングの吹き抜け(床なし)
room("納戸", 6370, 4550, 910, 2730, 2, texture="wood_oak")
room("トイレ", 7280, 4550, 910, 1820, 2, texture="tile_floor")
room("収納", 7280, 6370, 910, 910, 2, texture="wood_oak")
# x7280-8190 / y0-3640 は階段吹き抜け(床なし)

# ── 2F 建具
door("door-swing", 1600, 2730, 780, 2, flipY=True, flipX=True)   # 洋室A(室内開き)
door("door-swing", 5000, 2730, 780, 2, flipY=True, flipX=True)   # 洋室B(室内開き)
door("door-slide-s", 2250, 3640, 780, 2)                # 主寝室(引戸)
door("door-fold-w", 2730, 4550, 1200, 2, vertical=True) # WIC(主寝室から・折戸)
door("door-swing", 4200, 3640, 780, 2)                  # 書斎(廊下から)
door("door-fold", 910, 3185, 780, 2, vertical=True)     # リネン庫(折戸)
door("door-slide-s", 6825, 4550, 780, 2)                # 納戸(引戸)
door("door-swing-s", 7735, 4550, 650, 2, flipY=True)    # 2Fトイレ(室内開き)
door("door-swing-s", 7280, 6825, 650, 2, vertical=True) # 収納(納戸から)

# ── 2F 窓 (上端2030で1Fと通りを揃える)
dress(win(1400, 0, 2, "16513", 950, 1080), "roller")         # 洋室A北(腰窓950)
dress(win(0, 1400, 2, "16513", 950, 1080, vertical=True), "roller")  # 洋室A西(腰窓950)
dress(win(4800, 0, 2, "16513", 950, 1080), "roller")         # 洋室B北(腰窓950)
win(6825, 0, 2, "06905", 1460, 570)                   # 2Fホール北
dress(win(0, 5000, 2, "16513", 950, 1080, vertical=True))    # 主寝室西(腰窓950)
dress(win(1370, BD, 2, "16520", 0, 2030))                    # 主寝室南 掃き出し(バルコニーへ)
win(4800, BD, 2, "16513", 660, 1370)                  # 吹抜の高窓(南)
win(BW, 5460, 2, "06905", 1460, 570, vertical=True)   # 2Fトイレ東
win(BW, 2400, 2, "F03613", 660, 1370, vertical=True, kind="fix")      # 吹き抜け東
win(5100, 5460, 2, "16513", 1300, 730, kind="fix")    # 書斎→吹き抜けの室内窓(欄間)

# ── バルコニー (主寝室南・木調腰壁・出910)
item("balcony", 1365, 7962.5, 2730, 1365, 2, color="#8d867c")
w_b1 = wall(0, 8645, 2730, 8645, 2, wallStyle="balcony-fence", wallHeight=1100)
w_b2 = wall(0, BD, 0, 8645, 2, wallStyle="balcony-fence", wallHeight=1100)
w_b3 = wall(2730, BD, 2730, 8645, 2, wallStyle="balcony-fence", wallHeight=1100)
item("im0261-Shelf-MEGA_PACK_Shelf-shelf-395523_frame_black",
     1800, 8420, 1200, 280, 2, rot=0)                       # 物干し

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
item("car", 3450, 10100, 1800, 4400, 1, rot=90, color="#ced1d5")
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
    (4350, 7150, 0, 1, 2400, 5900, 8600, -90),   # リビング(吹抜の南壁・高所)
    # 西面は2台並ぶ。**それぞれ自分の部屋の真下に置く**こと。近い方から
    # 総当りで対にするので、位置を入れ替えると2階の室内機が1階の室外機に
    # 取られ、「室内機の無い室外機」と「室外機の無い室内機」が同時に出る
    (190, 4100, 90, 1, 2050, -210, 3400, -90),   # 洋室(西外壁)
    (2900, 130, 180, 2, 2050, 3300, -210, 0),    # 洋室A(北壁)
    (5500, 130, 180, 2, 2050, 4400, -210, 0),    # 洋室B(北壁)
    (190, 6700, 90, 2, 2050, -210, 7010, -90),   # 主寝室(西壁)
]
for ix, iy, irot, fl, iel, ox, oy, orot in AC_PAIRS:
    item("fmp-AirConditionerWall01", ix, iy, 800, 260, fl, rot=irot, elev=iel)
    item("ac-outdoor", ox, oy, 800, 300, 1, rot=orot, color="#d8dadc")

# 道路・電柱・隣家
item("road", 5280, SY1 + 2275, 30000, 4550, 1, color="#55585c", contextHeight=70)
item("utility-pole", 10600, SY1 + 4300, 350, 350, 1, rot=0, color="#8c9297",
     contextHeight=6500)
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
item("im0261-Mirror-MEGA_PACK_Mirror-mirror-70923_frame",
     650, 90, 796, 35, 1, rot=180, elev=1000)

# ── 洗面脱衣室 (1坪)
item("washer", 3260, 390, 640, 640, 1, rot=180)
item("fmp-BathroomVanity07", 2250, 300, 682, 426, 1, rot=180)
item("fmp-WashBasin01", 2250, 300, 644, 435, 1, rot=180, elev=695)
item("im0261-Mirror-MEGA_PACK_Mirror-mirror-70923_frame",
     2250, 90, 796, 35, 1, rot=180, elev=1000)

# ── ランドリー (洗う→干す→たたむ→しまう が1階で完結する)
#
# 内法は 3520 × 790 しかない。この寸法では守るべき制約が3つある。
#   1. 奥行300の収納を床置きすると正面に490mmしか残らず、扉が使えない
#      → 収納は必ず**吊る**(FL+900以上)。足元を空ければ通路として使える
#   2. 東半分(x1560-3510)は「洗面→LDK」の通り道。しかも洗面側の引戸は
#      x1560-2340 の壁面へ滑るので、その面に物を付けると戸が全開できない
#      → 収納は x60-1560 の西側だけに寄せる
#   3. 床に置くのは動かす物(ランドリーバスケット)だけ
#   4. 西壁の窓は引違い。開け閉めに室内側600mmが要るので x60-600 は空ける
# 結果、収納を置けるのは x600-1560 の 960mm だけ。ここに吊り戸棚1台と
# その上の棚1枚を重ねる。無理に2台並べると必ず上の4つのどれかを壊す
LDY_N = 1880                                   # 北壁の内法面
LDY_S = 2670                                   # 南壁の内法面
item("im0261-Cabinet-MEGA_PACK_CABINET-cabinet-19565_Frame",
     1080, LDY_N + 150, 750, 300, 1, rot=180, elev=900)    # 吊り戸棚(900-1700)
item("im0261-Shelf-MEGA_PACK_Shelf-shelf-161715", 1080, LDY_N + 133, 816, 266, 1,
     rot=180, elev=1720)                                   # その上の棚(-2370)
item("im0261-Bath-MEGA_PACK_BATH-basket-304967-Gray", 281, LDY_S - 171, 442, 342, 1,
     rot=0)                                                # ランドリーバスケット
item("im0261-Pet-MEGA_PACK_Pet-pet-46694_frame", 900, LDY_S - 84, 360, 167, 1,
     rot=0)                                                # 猫の食器(南壁際)

# ── キッチン (背面450 / 通路1595 / 対面600)
kx = 3680
for t, w in (("fmp-CabinetD01", 366), ("fmp-CabinetD_Sink", 732),
             ("fmp-CabinetD02", 366), ("fmp-CabinetD03", 364)):
    item(t, kx + w / 2, 2380, w, 519, 1, rot=0)
    kx += w
# コンロはD02+D03の上に丸ごと載せる(シンクと重ねない)
item("fmp-GasStove07", 5143, 2360, 530, 470, 1, rot=0, elev=797)
item("fmp-KitchenExhaust07", 5143, 2370, 466, 466, 1, rot=0, elev=1970)
item("fmp-Refrigerator02", 4060, 420, 640, 695, 1, rot=180)
item("im0261-Cabinet-MEGA_PACK_CABINET-cabinet-149435_frame_brown",
     5320, 300, 1600, 450, 1, rot=180)
item("im0261-Kitchen-MEGA_PACK_kitchen-electronic-298603_Frame_Black",
     4800, 300, 340, 351, 1, rot=180, elev=710)
item("im0261-Kitchen-MEGA_PACK_kitchen-electronic-drip-coffee-machine_red",
     5600, 300, 255, 270, 1, rot=180, elev=710)

# ── LDK: 北がダイニング、南がリビング(TVは西壁・ソファは東から西を向く)
# 4人用のコンパクトなセット。6人用ではリビングの奥行が取れない
item("im0261-Tableset-MEGA_PACK_Tableset-tableset_456939_Frame_Walnutbrown",
     4200, 3750, 1189, 1109, 1, rot=0)
item("im0261-Plant-MEGA_PACK_Plant-plant-230510", 3200, 4000, 618, 719, 1, rot=0)
# TVは西壁、ソファはその正面。東側 x5900-6300 を南北の通り道に残す
item("im0261-Cabinet-MEGA_PACK_CABINET-cabinet-149435_frame_brown",
     3015, 5300, 1600, 450, 1, rot=90)                      # TVボード(西壁)
item("im0261-Tv-MEGA_PACK_tv-electronic-280915", 2900, 5300, 1230, 211, 1,
     rot=90, elev=900)                                      # 壁掛けTV
# パッチワークのラグは橙×黒×白が強く、グリーンのソファと木床に喧嘩する。
# アクセントは壁1面に集約し、床のファブリックは彩度を落とす
item("im0261-Carpet-MEGA_PACK_Carpet-carpet-224774_frame_gray",
     4400, 5300, 2000, 1500, 1, rot=0)
# ソファは長さ1605の3人掛け。1939mmのSofa16では、ダイニングとの間か
# 掃き出し窓の前のどちらかが必ず足りなくなる(部屋に対して大きすぎた)
item("fmp-Sofa21", 5200, 5300, 1605, 756, 1, rot=-90)         # 3人掛け・TVと正対
item("im0261-Table-MEGA_PACK_Table-table-309959", 4100, 5300, 460, 460, 1, rot=0)
item("im0261-Decor-MEGA_PACK_decor-decor-roland_pom_pom_chrysanthemum_flower_frame_li",
     4100, 5300, 270, 209, 1, rot=0, elev=513)
item("im0261-Painting-MEGA_PACK_Painting-painting_366907_Frame_50X70cm_White",
     6290, 3400, 499, 29, 1, rot=-90, elev=1100)

# ── 洋室(1F・客間/子どもの遊び場)
# 西側 x60-660 を南北の通り道として空け、家具は東半分に寄せる
item("im0261-Carpet-MEGA_PACK_Carpet-carpet-29915_frame", 1700, 5000, 2000, 1500, 1,
     rot=0)
item("im0261-Kid-MEGA_PACK_kid-kid-lillabo_frame_wood", 1900, 4900, 1186, 480, 1,
     rot=0)
item("im0261-Pet-MEGA_PACK_Pet-pet-81869_frame_brown", 2400, 5700, 965, 500, 1,
     rot=90)                                                # キャットタワー
item("im0261-Pet-MEGA_PACK_Pet-pet-43005_Frame_Green", 1400, 5800, 520, 520, 1,
     rot=15)

# ── トイレ・パントリー・玄関
item("fmp-Toilet01", 6600, 2140, 339, 516, 1, rot=180)
# 造作の手洗いカウンター。単色の箱のままだと「置き忘れたブロック」に見える。
# 木の天板として仕上げる
item("custom-block", 7008, 2150, 496, 423, 1, rot=-90, color="#a9866a",
     customHeight=750, name="手洗いカウンター", texture="wood_cedar")
item("fmp-WashBasin04", 7008, 2150, 496, 423, 1, rot=-90, elev=750)
item("im0261-Shelf-MEGA_PACK_Shelf-shelf-344463_ModernAcacia-Black",
     6825, 1550, 800, 320, 1, rot=0)
item("im0261-Cabinet-MEGA_PACK_CABINET-cabinet-306913_frame_brown",
     6726, 6300, 1003, 591, 1, rot=90)                      # 下駄箱(西壁)
item("im0261-Mirror-MEGA_PACK_Mirror-mirror-498995_frame_light_brown",
     7964, 6360, 468, 333, 1, rot=-90)
item("im0261-Plant-MEGA_PACK_Plant-plant-143525_frame", 7900, 6950, 451, 458, 1,
     rot=0)
item("im0261-Painting-MEGA_PACK_Painting-painting-503147_50_70_cm",
     7200, 4200, 498, 29, 1, rot=-90, elev=1100)

# ══════════ 2F 家具 ══════════
# ── 主寝室
# 枕元は北壁につける。南は掃き出し窓の室内側1000mmが要るので、
# 頭を南に振ると壁から1m浮いた「置いただけ」の据わりになる [check5/30]
item("fmp-Bed14", 1200, 4650, 1546, 1899, 2, rot=180)
item("im0261-Table-MEGA_PACK_Table-table-309959", 2350, 5400, 460, 460, 2, rot=180)
item("im0261-Lamp-MEGA_PACK_lamp-lamp-126685_frame", 2350, 5400, 200, 200, 2,
     rot=180, elev=513)
item("im0261-Plant-MEGA_PACK_Plant-plant-151348_chocolate_frame",
     2470, 6900, 395, 386, 2, rot=0)

# ── WIC (壁付けクローゼットで通路を残す)

# ── 収納の中身。扉を開けて床しか無い部屋を無くす
# 押入(奥行910・中段付き)。下段に布団用の枕棚、上段に季節物
item("im0261-Shelf-MEGA_PACK_Shelf-shelf-395523_frame_black",
     700, 2950, 1200, 280, 1, rot=180)
item("im0261-Shelf-MEGA_PACK_Shelf-shelf-395523_frame_black",
     2000, 2950, 1200, 280, 1, rot=180)
item("im0261-Shelf-MEGA_PACK_Shelf-shelf-161715", 700, 2930, 816, 266, 1,
     rot=180, elev=1500)
item("im0261-Shelf-MEGA_PACK_Shelf-shelf-161715", 1900, 2930, 816, 266, 1,
     rot=180, elev=1500)
item("im0261-Bath-MEGA_PACK_BATH-basket-304967-Gray", 700, 3400, 442, 342, 1,
     rot=180)

# リネン庫(910角)。タオル・シーツを3段で
item("im0261-Shelf-MEGA_PACK_Shelf-shelf-310090_frame_natural",
     215, 3185, 597, 305, 2, rot=90)
item("im0261-Shelf-MEGA_PACK_Shelf-shelf-310090_frame_natural",
     215, 3185, 597, 305, 2, rot=90, elev=700)
item("im0261-Shelf-MEGA_PACK_Shelf-shelf-310090_frame_natural",
     215, 3185, 597, 305, 2, rot=90, elev=1400)

# WIC。引戸の引き代(x2430-3030 / y4940-5720)と前面通行帯を外して東壁へ寄せる
item("im0261-Shelf-MEGA_PACK_Shelf-shelf-344463_ModernAcacia-Black",
     3420, 5400, 800, 320, 2, rot=-90)
item("im0261-Shelf-MEGA_PACK_Shelf-shelf-344463_ModernAcacia-Black",
     3420, 6400, 800, 320, 2, rot=-90)

# 納戸。910幅の細長い部屋で、突き当たりにもう1つ収納がある。床に棚を置くと
# 奥へ通れなくなるので、床は空けて壁に吊り棚を並べる [check19]
# 北は引戸の前面通行帯(y4610-5210)、南は収納の開き戸の開閉スペース
# (y6500-7150)。棚を置けるのは間の1290mmだけなので、そこに3段重ねる
# 棚の高さは650。段の間隔はそれ以上あけないと棚同士がめり込む [check22]
for _ey in (600, 1300):
    item("im0261-Shelf-MEGA_PACK_Shelf-shelf-161715", 6563, 5855, 816, 266, 2,
         rot=90, elev=_ey)
    item("im0261-Shelf-MEGA_PACK_Shelf-shelf-161715", 7087, 5855, 816, 266, 2,
         rot=-90, elev=_ey)

# 収納(910角・納戸から)。開き戸の開き代(x6955-7605)を外して東壁へ
item("im0261-Shelf-MEGA_PACK_Shelf-shelf-310090_frame_natural",
     7970, 6825, 597, 305, 2, rot=-90)
item("im0261-Shelf-MEGA_PACK_Shelf-shelf-310090_frame_natural",
     7970, 6825, 597, 305, 2, rot=-90, elev=700)
item("im0261-Shelf-MEGA_PACK_Shelf-shelf-310090_frame_natural",
     7970, 6825, 597, 305, 2, rot=-90, elev=1400)

# ── 書斎
# デスクは南壁に背を付け、正面(引き出し側)を北=室内へ向ける。rot は
# 「正面が向く方角」なので、南壁に付けて rot=180 にすると壁と向かい合って
# 座る場所が無くなる。モニタも同じ向きに揃えないと椅子から背面を見ることになる
item("im0261-Table-MEGA_PACK_Table-table-175980_frame_brown",
     5100, 5090, 1758, 600, 2, rot=0)
item("fmp-Chair31", 5100, 4450, 616, 586, 2, rot=180)     # デスクと正対
item("im0261-Tv-MEGA_PACK_tv-electronic-126724_frame",
     5100, 5090, 726, 225, 2, rot=0, elev=739)            # モニタ
item("im0261-Lamp-MEGA_PACK_lamp-lamp-25416", 5800, 5090, 161, 273, 2,
     rot=0, elev=739)
item("im0261-Shelf-MEGA_PACK_Shelf-shelf-310090_frame_natural",
     6150, 4300, 597, 305, 2, rot=-90, elev=1100)          # 壁付けの飾り棚
item("im0261-Decor-MEGA_PACK_decor-decor-shop_the_look", 6150, 4300, 246, 106, 2,
     rot=-90, elev=1750)

# ── 洋室A (小2の娘)
item("fmp-Table44", 2900, 340, 1049, 524, 2, rot=180)
item("fmp-Chair29", 2900, 900, 430, 442, 2, rot=0)
item("im0261-Lamp-MEGA_PACK_lamp-lamp-573754_frame", 3300, 340, 245, 239, 2,
     rot=180, elev=626)
# 窓装飾は壁から出る。ロールスクリーン(50)の先まで枕元を下げる [check22]
item("fmp-Bed05", 760, 1150, 1112, 1950, 2, rot=180)
item("fmp-Closet14", 2900, 2280, 952, 773, 2, rot=0)
item("im0261-Kid-MEGA_PACK_kid-kid_691953_Frame_Guliguli_Tiger",
     2200, 1400, 525, 230, 2, rot=70)
item("im0261-Carpet-MEGA_PACK_Carpet-carpet-224774_frame_gray",
     1800, 1900, 2000, 1500, 2, rot=0)

# ── 洋室B (2歳の息子)
item("fmp-Bed03", 4250, 1150, 1050, 1932, 2, rot=180)
item("fmp-Closet14", 5923, 1900, 952, 773, 2, rot=-90)
item("im0261-Carpet-MEGA_PACK_Carpet-carpet-horang_frame_orange_0000",
     5000, 2200, 880, 1189, 2, rot=0)
# 北壁に付けると窓のカーテン(FL+660から下がる)へ天板が食い込むので東壁に回す
item("im0261-Cabinet-MEGA_PACK_CABINET-cabinet-69585", 6105, 700, 966, 410, 2,
     rot=-90)
item("im0261-Kid-MEGA_PACK_kid-kid_ADADA-ROCKING-HORSE_1", 4100, 2350, 338, 762, 2,
     rot=90)

# ── 2Fトイレ・納戸
item("fmp-Toilet01", 7735, 6050, 339, 516, 2, rot=0)
item("custom-block", 7918, 5450, 496, 423, 2, rot=-90, color="#a9866a",
     customHeight=750, name="手洗いカウンター", texture="wood_cedar")
item("fmp-WashBasin04", 7918, 5450, 496, 423, 2, rot=-90, elev=750)

# ══════════ 照明 ══════════
light("ceiling", 4400, 5150, 1, shadow=True)   # リビング
# 吹き抜けのシーリングファン。天井5280の直下に吊る(器具高さ350)
# ファンはキャノピー上端が天井面に来る高さで吊る(elev = 天井 - モデル高)
ceiling_mounted("fmp-CeilingFan01", 5005, 6370, 1, w=1200, d=1200, rot=0)
# 吹き抜けの照明は天井(FL+5388)の埋込。以前はファンの下に直付け器具を
# 宙吊りにしていて、何にも留まっていない円盤が浮いていた。
# ファンの回転域(φ1200)を避けて2灯に振り分ける
light("down", 4180, 6060, 1)
light("down", 5830, 6680, 1)
light("ceiling", 4700, 3550, 1, shadow=True)   # ダイニング
light("ceiling", 1400, 5000, 1)                # 洋室(1F)
light("down", 4300, 700, 1)
light("down", 5500, 700, 1)
light("down", 4700, 2400, 1)                   # キッチン手元
light("down", 2700, 900, 1)
light("down", 900, 900, 1)
light("down", 1800, 2280, 1)                   # ランドリー
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
light("down", 6825, 5900, 2)                   # 2F納戸
# 有効幅790mmの廊下で至近から見上げるので、中心が1.4m前後になる高さにする
item("im0261-Painting-MEGA_PACK_Painting-decor-355748_frame_500",
     2400, 2800, 500, 10, 2, rot=180, elev=1050)
item("im0261-Painting-MEGA_PACK_Painting-decor-355748_frame_500",
     4200, 2800, 500, 10, 2, rot=180, elev=1050)
item("im0261-Painting-MEGA_PACK_Painting-decor-476641_frame",
     5900, 2800, 600, 31, 2, rot=180, elev=1050)
light("down", 1500, 3180, 2)                   # 廊下
light("down", 4500, 3180, 2)
light("ceiling", 1200, 5200, 2, shadow=True)   # 主寝室
light("down", 3185, 4400, 2)                   # WIC北
light("down", 3185, 6300, 2)                   # WIC南
light("down", 5100, 4300, 2)                   # 書斎
light("down", 455, 3185, 2)                    # リネン庫

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
P.dump(out, **{k: v for k, v in plan.items()
               if k not in ("walls", "rooms", "items")})
