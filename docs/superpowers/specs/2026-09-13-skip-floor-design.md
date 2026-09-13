# スキップフロア 設計

作業ブランチ: `worktree-skip-floor`（`.claude/worktrees/skip-floor`、default-plans の c94caaa から分岐）

## 1. 何を作るのか

同じ階の中に、床の高さが違う区画（スキップフロア／中2階／小上がり）を作れるようにする。
実際のスキップフロア住宅で必要になるものまで含める:

- 任意の高さに持ち上がった床と、その**天井も一緒に上がる**こと
- 持ち上がった床の**下にできる空間を収納として使える**こと
- 段差の境界を**任意の高さの壁**（腰壁・手すり壁）で仕切れること
- **段差を上り下りする短い階段**（同一階内の数段）
- 段差ぶんだけ**階高が自動で伸びる**こと（上階の床が正しい高さに載る）

## 2. なぜ既存の「床の高さ」では足りないのか

いま既にあるもの:

| 仕組み | 場所 | 範囲 | 天井 |
|---|---|---|---|
| `room.floorRaiseMm`（床上げ） | `roomFloorOffsetMm` | 0〜600mm | **動かない**（UI にも「天井の位置は固定です」と書いてある） |
| `room.ceiling.heightMm`（天井高） | `HeightModel.ceilingHeightMm` | 任意 | 階の床スラブ天端から測る |
| `plan.floors[階].storyHeight`（階高） | `HeightModel.storyHeightMm` | 任意 | — |
| `wall.wallHeight`（壁1枚の高さ） | `wallHeightMm` | 300〜6000mm | 階の床スラブ下端から立つ |

`floorRaiseMm` は「玄関土間 +0 / 室内床 +150」のような**仕上げの段差**で、天井は動かない。
スキップフロアは「その区画ごと床も天井も持ち上がる」ものなので、`floorRaiseMm` の上限を
広げるだけでは意味が変わってしまう。そこで **別のフィールドを足し、床上げとは重ねて効く**
ようにする。既存プランは新フィールドを持たないので、寸法は1mmも動かない。

## 3. データモデル

### 3.1 部屋

```js
room.skipLevelMm    // 0〜2400、50mm刻み。省略=0。この区画の床レベル
room.underFloor     // 'solid'(既定/省略) | 'storage' | 'open'
room.underFloorFace // 'n'|'e'|'s'|'w'（省略=自動: 段差が低い側を向く）
```

床仕上げ面の高さ（階の床スラブ下端から）は

```
floorSlabHeightMForFloor(floor) + skipLevelMm + floorRaiseMm
```

`skipLevelMm` と `floorRaiseMm` は**足し算**。前者は構造の段差、後者は仕上げの段差で、
小上がり和室（+400 の畳コーナー）の上にさらに +150 を乗せる、といった書き方ができる。

### 3.2 天井の扱い（ここが設計の要）

| 部屋の天井指定 | 天井面の位置（階の床スラブ下端から） | 意味 |
|---|---|---|
| 指定なし | 階高そのまま（**従来どおり**） | 段差ぶん頭上が低くなる。小上がり |
| `ceiling.heightMm = H` | `slab + skipLevelMm + H` | H は**その区画の床から**測る。スキップフロア |
| 勾配 / 吹き抜け | 既存のまま + `skipLevelMm` | — |

「指定なし」で天井を持ち上げない理由は再帰の回避でもある。指定なし = 階高、階高 =
段差+天井高 の最大値、とすると循環する。階高を決めるときに見るのは**明示された天井高
だけ**にする。

### 3.3 階高の自動追従

```
storyHeightMmForFloor(floor) = max(
  plan.floors[floor].storyHeight ?? 2700,
  floorSlab + defaultWallHeight,                    // 既存の下限
  max over rooms on floor(                          // 追加
    floorSlab + skipLevelMm + 明示された天井高 )     // 明示が無い部屋は寄与しない
)
```

これで「1階に +1200 のスキップフロア、そこの天井高 2200」と書くと 1階の階高が
3400mm になり、2階の床が正しい高さに載る。既存プランは `skipLevelMm` が無いので
この項は一切効かない。

**限界として明記する**: 階の中でレベルは分かれるが、`floorBaseY(floor)` は階に1つの
ままである。つまり「2階の一部だけが半階ずれた家」を作るときは、2階側の部屋にも
`skipLevelMm` を書く（各階が自分の中でレベルを持つ）。階そのものを半階ずらす
モデルには**しない**——`floorBaseY` は階段・屋根・斜線制限・立面図まで含めて
アプリ全体の基準面なので、そこを分岐させる改修は本件の範囲を大きく超える。

### 3.4 壁

壁は従来どおり `floorBaseY(階)` から立つ（段差の蹴上げ面を兼ねるので、下ろさないと
低い側に穴が開く）。変えるのは**上端**だけ。

- 個別指定なし: `wallCeilingHeightM` が接する部屋の天井高の最大を採る。
  3.2 で天井が上がれば壁も自動で伸びる。**変更不要**。
- 個別指定あり（腰壁1100 など）: `wallDisplayHeightM` を
  `隣接部屋の skipLevelMm の最大 + wallHeight + slab` にする。
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
  - 段数は実際の上り高さから `stairStepCount` で出す（既存関数をそのまま使う）。
  - 上階の床に**吹き抜け穴を開けない**（`stairwellQuadsForFloor` から除外）。
  - 逆に、同じ階の持ち上がった床と平面で重なるときは**その床に穴を開ける**
    （既存の `stairwellHolesForRoom` の仕組みを、同一階のレベル階段に対して使う）。

### 3.6 床下収納

持ち上がった床の下（`skipLevelMm + floorRaiseMm` の厚み）を、solid のままにするか
中空にするかを部屋が持つ。

- `'solid'`（既定）: 現状のまま。**生成されるジオメトリは1つも変わらない。**
- `'storage'`: 中空にし、指定した面に建具（引き戸状の面材）を並べる。
  1枚あたり最大 900mm で等分し、目地 6mm、引手の窪みを付ける。
- `'open'`: 中空にするが建具は付けない（見せる収納・オープン棚）。

厚みが 400mm 未満のときは収納として成立しないので、UI では選べるが
「400mm 以上で有効」と注記し、レンダは solid にフォールバックする。

## 4. どこを直すか

| 層 | ファイル | 内容 |
|---|---|---|
| 高さモデル | `assets/js/height-model.js` | `skipLevelMm(plan, room)`、`DEFAULTS.skipLevelMaxMm` |
| 高さ解決 | `assets/js/app-constants.js` | `roomSkipLevelMm` / `roomFloorTopY` / `roomCeilingHeightM` / `roomRenderedCeilingMm` / `storyHeightMmForFloor` / `wallDisplayHeightM` / `roomUnderFloorMode` ほか |
| 高さ解決 | `assets/js/app-state.js` | `ceilingFinishElevationMm`（段差ぶん引く）、部屋のプロパティ欄 |
| 3D | `index.html` | 床スラブ/段差ブロック/床下収納の生成、レベル階段の上り高さ・穴、ウォークスルーの足元 |
| 2D | `assets/js/draw-2d.js` | 段差レベルのラベル、段差の境界線、床下収納の破線 |
| 図面 | `index.html`（JIS SVG） | 平面図の部屋ラベルに `FL+1200` を添える |
| 取り込み | `assets/js/plan-schema.js` | 新フィールドの範囲検査（警告） |
| 検査 | `tools/tests/skip-floor.test.cjs`（新規） | 下記 |

## 5. 検査

新規 `tools/tests/skip-floor.test.cjs`（既存テストと同じ node:vm 方式）:

1. `skipLevelMm` を持たない部屋は、床天端・天井・階高・壁高が**1mmも動かない**
2. `skipLevelMm=1200` の部屋の床天端が +1200 になる
3. 天井高を明示した段差部屋で、天井が段差ぶん一緒に上がる
4. 天井高を明示**しない**段差部屋では天井が動かない（頭上が低くなる）
5. 階高が `slab + skipLevel + 天井高` まで自動で伸びる。明示なしの部屋では伸びない
6. 腰壁（`wallHeight=1100`）が段差の上から 1100mm になる
7. `stairTarget='level'` の階段の上り高さが段差と一致し、段数がそれに追従する
8. `stairTarget='level'` の階段は上階の床に穴を開けない
9. `underFloor='storage'` のとき床下が中空になり、`'solid'` では従来のジオメトリ
10. `plan-schema` が新フィールドの範囲外を警告として挙げる

既存の全単体検査（`sh tools/run_tests.sh`）と描画の指紋
（`sh tools/run_browser_tests.sh render-fingerprint`）が通ることを完了条件にする。
指紋が動いたら、それは既存プランの絵が変わったということなので、直す。

## 6. やらないこと

- 階そのものを半階ずらすモデル（`floorBaseY` の分岐）。3.3 の限界として明記する。
- スキップフロアを跨ぐ屋根・斜線制限の特別扱い。階高が伸びれば自動で追従する。
- 段差の自動検出（「隣り合う部屋の高さが違うから階段を置く」）。置くのは利用者。
