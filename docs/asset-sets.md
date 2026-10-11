# アセットのセットを足す手順

カタログで「表示するセット」を選べる（標準・洋館・…）。新しいセット（例: 日本古民家）は、
**アプリのコードを触らずに**足せる。この文書は、モデルを作る人（Codex を含む）への発注書を兼ねる。

## 納めるもの

`<set-id>` はセットの ID（英小文字とハイフン。例: `kominka`）。

| 置き場所 | 中身 |
|---|---|
| `assets/models/packs/<set-id>/models/<set-id>-<名前>.glb` | サイト用のモデル |
| `assets/models/packs/<set-id>/previews/<set-id>-<名前>-thumb.png` | カタログの縮小画像（512×512、透過） |
| `assets/models/packs/<set-id>/previews/<set-id>-<名前>-top.png` | 平面図に描く真上の画像（512×512、透過） |
| `assets/models/packs/<set-id>/manifest.json` | セットの物の一覧（下の形式） |
| `tools/blender/<set-id>/` | 編集できる `.blend`、作るためのスクリプト、正面・背面の検証画像 |
| `assets/models/asset-sets.json` | 一覧に1行足す: `{"id":"<set-id>","name":"<画面に出す名前>","mark":"<見出しに付ける1文字>","manifest":"assets/models/packs/<set-id>/manifest.json"}` |
| `docs/legal/asset-sets-ledger.md` | 権利の台帳に1行足す |

## モデルの決まり

- Blender で独自に制作する。外部の素材は仮素材まで（使うなら台帳に出典と利用条件を書き、本採用前に作り直す）
- 単位はメートル、正面は +Z、上は +Y、原点は底面の中心
- 色を変えられるよう、マテリアルを部位ごとに分け、Blender のマテリアルのカスタムプロパティ `finishChannel` に部位名を入れる（例: `wood`, `fabric`, `metal`）
- 実物の寸法で作る（座面の高さ、天板の高さなど）。アプリはモデルを manifest の w/d/h に合わせて伸縮するので、形の比率が実物と違うと歪む

## manifest.json の形式

本番のカタログ（`assets/models/custom/manifest.json` など）と同じ形式。

```json
{
 "set": "<set-id>",
 "name": "<画面に出す名前>",
 "items": [
  {
   "id": "<set-id>-chair-01",
   "name": "画面に出す名前",
   "group": "家具",
   "category": "椅子",
   "kind": "chair",
   "model": "assets/models/packs/<set-id>/models/<set-id>-chair-01.glb",
   "thumb": "assets/models/packs/<set-id>/previews/<set-id>-chair-01-thumb.png",
   "top": "assets/models/packs/<set-id>/previews/<set-id>-chair-01-top.png",
   "w": 520, "d": 550, "h": 1050,
   "defaultElevation": 0,
   "provenance": "original",
   "finishChannels": [{"key": "wood", "label": "木部", "default": "#6b4428"}]
  }
 ]
}
```

- `group` は `住設` / `家具` / `外構` のどれか
- `kind` は標準のカタログと同じ分類名（`assets/models/tags.json` の `kinds` のキー。例: `chair`, `sofa`, `bed`, `light`）。
  入れると、標準の同じ見出し（チェア・ソファ…）の下に混ざって並び、見出しのアイコンにセットの印が付く。
  標準に当てはまる分類が無い物（洋館の「事件跡」など）だけ `kind` を省き、`category` がそのまま見出しになる
- `defaultElevation` は床からの高さ（mm）。壁掛け・天井付け・机の上に置く物だけ入れる
- 色を持たない物（割れたガラスなど）は `finishChannels: []` と明示する

## 置いてある家具の一括差し替え（swap）

`asset-sets.json` のセットに `swap` を書くと、カタログの「表示するセット」の下に「家具を〇〇に差し替える」が出る。
決め方は `assets/js/asset-swap.js`。

| 項目 | 意味 |
|---|---|
| `typeKinds` | カタログに無い組み込みの物の分類（例: `washer` → `laundry`） |
| `prefer` | 物ごとに決め打ちの差し替え先。並びの先頭から、セットに在る物を使う |
| `standIns` | 同じ分類が無い物の代役（例: `tv` → 額絵）。`liftMm` だけ高く掛ける |
| `stretchKinds` | 元の幅のまま伸ばす分類（カーテン・ロールスクリーン・ラグ） |
| `looseKinds` | 大きさの開きを気にしない分類（額・鏡・照明など飾る物） |
| `expand` | 分けて置き直す（テーブルセット → 食卓と椅子、キッチン → 流し台・レンジ・戸棚の並び） |

同じ分類の物は、置いてある大きさ（幅・奥行・高さ）に一番近い物を選ぶ。大きさが2倍以上・半分以下しか無ければ替えずに残す。

## 作り直すとき

**本番に出た物は、同じ ID のまま作り直さない。** 保存プランは家具を ID で持っているので、
モデルを差し替えると、利用者が置いた家具の見た目が黙って変わる。作り直した版は別の ID（`-02` など）で足し、
元の物には manifest で `"retired": true, "retiredBy": "<新しい ID>"` を付ける（カタログには出ず、描画用に残る）。
本番に出た物の一覧は `tools/tests/fixtures/asset-sets/shipped.json`。本番に出したら、ここに足す。

## 受け入れの検査

次が通るまでが納品。

```sh
node --test tools/tests/asset-sets.test.cjs
```

見ているもの: ID がセット名で始まり重複しない、標準のカタログの ID とぶつからない、寸法が正、
モデル・画像のファイルが在る、色の部位の定義が揃っている、独自制作である、名前が日本語である、本番に出た物が差し替えられていない。

検査が通ったら、画面で次を確かめる（ここは人が見る）。

1. カタログの「表示するセット」に新しいセットが出て、押すと物が標準の見出しの下に混ざって並び、見出しに印が付く
2. 1点ずつ置いて、平面図の向きと 3D の正面が合っている（正面が手前を向く）
3. 色の部位を変えると、その部位だけ色が変わる
