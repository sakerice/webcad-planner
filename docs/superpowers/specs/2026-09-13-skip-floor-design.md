# スキップフロア 設計

作業ブランチ: `worktree-skip-floor`（`.claude/worktrees/skip-floor`、default-plans の c94caaa から分岐）

## 1. 何を作るのか

同じ階の中に、床の高さが違う区画（スキップフロア／中2階／小上がり）を作れるようにする。
実際のスキップフロア住宅で必要になるものまで含める:

- 任意の高さに持ち上がった床と、その**天井も一緒に上がる**こと
- 持ち上がった床の**下にできる空間**と、そこへ**置ける収納（造作棚）**
- 段差の境界を**任意の高さの壁**（腰壁・手すり壁）で仕切れること
- **段差を上り下りする短い階段**（同一階内の数段）
- 段差の上に立つ壁が高くなったぶん、**その上に載るものだけ**が持ち上がること

## 2. なぜ既存の「床の高さ」では足りないのか

いま既にあるもの:

| 仕組み | 場所 | 範囲 | 天井 |
|---|---|---|---|
| `room.floorRaiseMm`（床上げ） | `roomFloorOffsetMm` | 0〜600mm | **動かない**（UI にも「天井の位置は固定です」と書いてある） |
| `room.ceiling.heightMm`（天井高） | `HeightModel.ceilingHeightMm` | 任意 | 階の床スラブ天端から測る |
| `plan.floors[階].storyHeight`（階高） | `HeightModel.storyHeightMm` | 任意 | — |
| `wall.wallHeight`（壁1枚の高さ） | `wallHeightMm` | 300〜6000mm | 階の床スラブ**下端**から立つ |
| 局所的な支持 | `localSupportTopY` | — | 下階に既定より高い壁があると、**その上に載る床だけ**が壁の天端まで上がる |

`floorRaiseMm` は「玄関土間 +0 / 室内床 +150」のような**仕上げの段差**で、天井は動かない。
スキップフロアは「その区画ごと床も天井も持ち上がる」ものなので、`floorRaiseMm` の上限を
広げるだけでは意味が変わってしまう。そこで **別のフィールドを足し、床上げとは重ねて効く**
ようにする。既存プランは新フィールドを持たないので、寸法は1mmも動かない。

## 3. データモデル

### 3.1 部屋

```js
room.skipLevelMm    // 0〜2400、50mm刻み。省略=0。この区画の床レベル
```

床仕上げ面の高さ（階の床スラブ下端から）は

```
localSupportTopY(...) + floorSlabHeightMForFloor(floor) + skipLevelMm + floorRaiseMm
```

`skipLevelMm` と `floorRaiseMm` は**足し算**。前者は構造の段差、後者は仕上げの段差で、
小上がり和室（+400 の畳コーナー）の上にさらに +150 を乗せる、といった書き方ができる。

### 3.2 天井の扱い

| 部屋の天井指定 | 天井面の位置（階の床スラブ下端から） | 意味 |
|---|---|---|
| 指定なし | **その部屋の上にある物の下端**（= `roomCeilingCapM`） | 従来は階高固定だった。下の壁が高くて上の床が持ち上がっていれば、そこまで届く |
| `ceiling.heightMm = H` | `slab + skipLevelMm + H` | H は**その区画の床から**測る |
| 勾配 / 吹き抜け | 既存のまま + `skipLevelMm` | — |

```
roomCeilingCapM(room) = max( storyHeightM(floor),
                             localSupportTopY(floor+1, 部屋の矩形) - floorBaseY(floor) )
```

下階に高い壁が無ければ `localSupportTopY` は `floorBaseY` をそのまま返すので、
**cap は階高と完全に同値**になる。つまり既存プランの天井は1mmも動かない。

### 3.3 階高は伸ばさない。上に載るものだけが上がる

`plan.floors[階].storyHeight`（= 家全体の基準面 `floorBaseY`）は**触らない**。
代わりに、既に在る `localSupportTopY`（「下階に既定より高い壁があれば、その上に載る床
だけがその天端まで上がる」）を、段差の上に立つ壁まで見えるように広げる:

```
壁の天端 = 下階の床天端 + wallSkipBaseMm(壁) + wall.wallHeight
```

`wallSkipBaseMm(w)` は、その壁が接している部屋の `skipLevelMm` の最大値
（`wallAdjacentRoomsCeiling` と同じ両側サンプリング）。

これで「1階に +1200 のスキップフロア、その上に 2400 の壁」と書くと、その壁の天端は
3600 になり、**その真上に載る2階の床・屋根だけ**が 3600 へ持ち上がる。家全体の階高も、
段差を作っていない場所の2階の床も動かない。

壁そのものの足元も同じ考えで揃える。壁の平面フットプリントが**すべて**高い支持の上に
在るときだけ、その壁は持ち上がった床から立つ（`wallBaseSupportY`）。一部しか載って
いない壁は従来どおり `floorBaseY` から立てる——持ち上げると載っていない側に穴が開く。
判定を「全部覆われているときだけ」にするのは、既にある `wallStackedAboveCapM` と同じ
考え方である。

**限界として明記する**: 階の中でレベルは分かれるが、`floorBaseY(floor)` は階に1つの
ままである。つまり「2階の一部だけが半階ずれた家」を作るときは、2階側の部屋にも
`skipLevelMm` を書く（各階が自分の中でレベルを持つ）。

### 3.4 壁

壁は従来どおり `floorBaseY(階)` から立つ（段差の蹴上げ面を兼ねるので、下ろさないと
低い側に穴が開く。例外は 3.3 の「全部が高い支持に載っている壁」）。変えるのは**上端**:

- 個別指定なし: `wallCeilingHeightM` が接する部屋の天井高の最大を採る。
  3.2 で天井が上がれば壁も自動で伸びる。**変更不要**。
- 個別指定あり（腰壁1100 など）: `wallDisplayHeightM` を
  `wallSkipBaseMm(w) + wallHeight + slab` にする。
  段差の縁に立てた手すり壁が、持ち上がった床から 1100mm になる。

### 3.5 階段

```js
item.stairTarget  // 'upper'(既定/省略) | 'level'
```

- `'upper'`: 従来どおり。上階の床まで上がる。段数も従来どおり `FLOOR_H` から出す
  （ここを実際の上り高さに変えると既存プランの段数が動くので触らない）。
- `'level'`: **同じ階の中の段差**を上る。
  - 上り高さ = 階段グループの走行軸の両端 300mm 外側で `roomFloorAt` を採り、その差。
    差が 50mm 未満なら「その階の最大 skipLevel − 足元のレベル」を代わりに使う。
  - 足元は低い側のレベル。段数は実際の上り高さから `stairStepCount` で出す。
  - 上階の床に**吹き抜け穴を開けない**（`stairwellQuadsForFloor` から除外）。
  - 同じ階の持ち上がった床と平面で重なるときは**その床に穴を開ける**
    （既存の `stairwellHolesForRoom` の仕組みを同一階のレベル階段に対して使う）。
  - ウォークスルーでは階を変えずに足元だけ坂面化する。

### 3.6 段差の下の空間と造作棚

`skipLevelMm + floorRaiseMm` が 400mm 以上ある部屋では、床下を**中空**にする。
低いレベルの部屋に面した側は開いた状態にし、外壁側・同じレベルの部屋側は塞ぐ。
400mm 未満（小上がり）は使える空間にならないので従来どおり solid のまま。
`skipLevelMm` を持たない既存プランは条件に入らないので、生成されるジオメトリは
1つも変わらない。

収納はそこへ**置くアイテム**にする。新しい種類 `shelf-built-in`「造作棚」:

- **壁に接している**（背面が同じ階の壁から 120mm 以内で、壁とほぼ平行）と、
  その壁に支持された**横板だけ**の棚になる（縦板なし）。
- **何も無い空間**に置かれていると、両端に**縦板**を立てた独立の棚になる。
- 幅・奥行きは自由。棚板の枚数 `shelfCount`（1〜8、既定3）と
  全体高さ `shelfHeight`（既定 900mm）を持つ。板厚 25mm。

段差の下へ置くための基準:

```js
item.baseLevel   // 'floor'(既定/省略) | 'under'
```

`'under'` のアイテムは、その部屋の持ち上がった床ではなく**その階の床天端**に置かれる
（= 段差の下の空間に入る）。段差のある部屋の中に居るアイテムにだけ、プロパティ欄に
この選択を出す。

## 4. どこを直すか

| 層 | ファイル | 内容 |
|---|---|---|
| 高さモデル | `assets/js/height-model.js` | `skipLevelMm(plan, room)`、`DEFAULTS.skipLevelMaxMm` |
| 高さ解決 | `assets/js/app-constants.js` | `roomSkipLevelMm` / `wallSkipBaseMm` / `localSupportTopY` / `wallBaseSupportY` / `roomFloorTopY` / `roomCeilingCapM` / `roomCeilingHeightM` / `roomRenderedCeilingMm` / `wallDisplayHeightM` / 造作棚の寸法・色・名前 |
| 高さ解決 | `assets/js/app-state.js` | `ceilingFinishElevationMm`、部屋・階段・造作棚のプロパティ欄 |
| 3D | `index.html` | 段差ブロックの中空化、造作棚の生成、`item3DBaseY` の `baseLevel`、レベル階段の上り高さ・穴、壁の足元、ウォークスルーの足元と段差の登れなさ |
| 2D | `assets/js/draw-2d.js` | 段差レベルのラベル、段差の境界線、造作棚の棚板表現 |
| 図面 | `index.html`（JIS SVG） | 平面図の部屋ラベルに `FL+1200` を添える |
| 取り込み | `assets/js/plan-schema.js` | 新フィールドの範囲検査（警告） |
| 検査 | `tools/tests/skip-floor.test.cjs`（新規） | 下記 |

## 5. 検査

新規 `tools/tests/skip-floor.test.cjs`（既存テストと同じ node:vm 方式）:

1. `skipLevelMm` を持たない部屋は、床天端・天井・階高・壁高が**1mmも動かない**
2. `skipLevelMm=1200` の部屋の床天端が +1200 になる（床上げと足し算になる）
3. 天井高を明示した段差部屋で、天井が段差ぶん一緒に上がる
4. 段差の上に立つ壁の天端が `段差 + 壁高` になり、その上に載る床だけが上がる
5. 一部しか高い支持に載っていない壁は、足元が `floorBaseY` のまま
6. 腰壁（`wallHeight=1100`）が段差の上から 1100mm になる
7. `stairTarget='level'` の階段の上り高さが段差と一致し、段数がそれに追従する
8. `stairTarget='level'` の階段は上階の床に穴を開けない
9. `baseLevel='under'` のアイテムが段差の下（その階の床天端）に置かれる
10. 造作棚が、壁に接していれば縦板なし・離れていれば縦板ありになる
11. `plan-schema` が新フィールドの範囲外を警告として挙げる

既存の全単体検査（`sh tools/run_tests.sh`）と描画の指紋
（`sh tools/run_browser_tests.sh render-fingerprint`）が通ることを完了条件にする。

## 6. やらないこと

- 階そのものを半階ずらすモデル（`floorBaseY` の分岐）。3.3 の限界として明記する。
- スキップフロアを跨ぐ屋根・斜線制限の特別扱い。壁が高くなれば `localSupportTopY` 経由で
  屋根の足元は追従する。
- 段差の自動検出（「隣り合う部屋の高さが違うから階段を置く」）。置くのは利用者。
