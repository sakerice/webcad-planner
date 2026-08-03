# house-planner mobile — 映像生成エンジン 設計

作成日: 2026-08-03（JST）
状態: ユーザーレビュー待ち

## 1. 背景

PV制作は v6 まで進んだが品質が要求水準に届かなかった。不満は3点に集約される。

1. 画がショボい（見栄え）
2. 設計と異なる間取りが生成される（忠実度）
3. PV全体の構成・尺・語り口

### 1.1 旧アプローチが行き詰まった構造的原因

v6 の T81〜T83 は、いずれも**同一スクリーンショットからの入れ子crop / 横ずらしcrop**を3キーフレームとして Seedance に渡す設計だった。この設計には2つの欠陥がある。

- 生成される動きは実質2Dの Ken Burns であり、3Dの視差が存在しない。
- 「AIは新規ピクセルを生成してはならない」という運用に寄っていたため、画質の上限が素のWebGLビューポートのスクリーンショットに固定されていた。

さらに T63（Topviewタスク `260802_0003_video_edit_1659`）の失敗は、プロンプト文言の弱さではなく、**単一静止画から画面外へカメラが動いたこと**が原因である。画面外は未知ピクセルなので、モデルは統計的にもっともらしい一般的なキッチンで埋める。

### 1.2 制約の訂正

禁止事項は「AIが1pxも生成しないこと」ではない。**禁止は設計と異なる間取り・構造が現れること**（設置していない壁や椅子が登場する、または消える）に限られる。

光の反射、影、空気感、生活感の追加描写は、むしろ生成AIに担わせたい領域である。three.js 単体ではそこに到達できない。

## 2. 目的

短期の成果物は PV 1本だが、本命は**再現可能なエンジン**である。

- shot spec を入力として、間取りデータから映像を吐けること。
- 将来の製品機能「設計済み住宅の生活シミュレーションムービー」に直結すること。
- PV はそのエンジンの最初の出力物として位置づける。

## 3. 非目標

- Blender への全面移行はしない。本体製品の品質に還元されないため。
- 生成AIに三次元再構成をさせない。カメラワークとオクルージョンは three.js 側の責務とする。
- `index.html` と `assets/default_plan.json` に存在するユーザーの未コミット差分には触れない。
- GitHub Pages を公開仕様や完成PVとして扱わない。レビュー用途に限る。

## 4. アーキテクチャ

原則は **「構造は撮る、質感は生成する」**。

| 層 | 責務 | 真実の所在 |
|---|---|---|
| Layer 1 | 間取り・カメラ・オクルージョン | three.js（設計データ） |
| Layer 2 | 光・反射・空気感・生活感 | Seedance 2.0 |
| Layer 3 | 忠実度の自動判定 | Layer 1 の出力との数値比較 |

Layer 1 が実カメラ移動を三次元でレンダするため、**画面外が存在しない**。カメラが実際に通った経路しか映らないので、T63 の破綻原因が構造的に消える。

### 4.1 データ契約: shot spec JSON

全層をつなぐ唯一の入力。これがあることで「PV1本」ではなく「エンジン」になる。

```jsonc
{
  "id": "S08-ldk-push",
  "plan": "assets/default_plan.json",
  "view": "3d-int",              // 3d-ext | 3d-int
  "fps": 24,
  "duration": 4.0,               // 秒。Topviewの下限に合わせ4秒を基本単位とする
  "resolution": { "width": 1920, "height": 1080 },
  "camera": {
    "interp": "catmull-rom",
    "keys": [                    // 時刻つきカメラキーポイント
      { "t": 0.0, "pos": [x,y,z], "target": [x,y,z], "fov": 75 },
      { "t": 2.0, "pos": [x,y,z], "target": [x,y,z], "fov": 75 },
      { "t": 4.0, "pos": [x,y,z], "target": [x,y,z], "fov": 75 }
    ]
  },
  "guides": ["base", "segmentation", "instance", "edge", "depth", "normal"],
  "guideStride": 6,              // ガイドは全フレームでなく間引いて出力
  "appearance": {
    "preset": "daylight-lived-in",
    "lock": ["walls", "openings", "stairs", "furniture-count"]
  }
}
```

`camera.keys` は手打ちではなく、既存の内観ウォークスルー操作から採取できるようにする（現在のカメラ状態を1キーとして追記する開発用フック）。

### 4.2 Layer 1 — Truth Renderer

#### 既に本体に存在する資産

単一フレーム分の制御画像生成は実装済みである。時間軸だけが欠けている。

| 関数 | 位置 | 用途 |
|---|---|---|
| `getActive3DCamera()` | index.html:16717 | 現在の内観/外観カメラ取得 |
| `captureCurrent3DDataUrl()` | index.html:16736 | 任意倍率の高解像度ベースレンダ |
| `beginAiGuideCaptureResolution()` / `endAiGuideCaptureResolution()` | index.html:16772 / 16784 | キャプチャ解像度の一時変更と復帰 |
| `captureSegmentation3DDataUrl()` | index.html:16852 | 部屋・部材セグメンテーション |
| `captureAiOverrideGuideDataUrl('depth' \| 'normal')` | index.html:16891 | 深度 / 法線 |
| `captureInstance3DData()` | index.html:16977 | インスタンスID画像 + legend |
| `makeEdgeDataUrlFromSegmentation()` | index.html:17036 | 構造エッジ |

これらは index.html:17504 付近で ZIP（`base_render.png` / `edge_guide.png` / `segmentation_guide.png` / `depth_guide.png` / `normal_guide.png` / `instance_guide.png` / 各legend / `ai-instructions.md`）に束ねられている。

#### 追加が必要なもの

1. **カメラパス駆動** — shot spec の `camera.keys` を Catmull-Rom で補間し、フレーム時刻ごとにアクティブカメラへ適用する。
2. **連番バッチ出力** — 1フレームごとに base を、`guideStride` ごとに各ガイドを出力する。
3. **自動化された起動経路** — 専用キャプチャページからヘッドレス駆動し、ファイルとして保存する。

#### 実装方針と本体保護

`index.html` は19457行の単一ファイルであり、ユーザーの未コミット差分も乗っている。したがって**本体を書き換えるのではなく、フックを1点だけ露出させる**方針を取る。

- `index.html` への変更は「デバッグ用グローバルの露出」に限定する。既存関数の呼び出し口を `window.__PV_CAPTURE__` として公開するだけで、既存の挙動は一切変えない。
- 露出はURLパラメータ（例 `?pvCapture=1`）でガードし、通常利用時には何も起きないようにする。
- パス補間、連番ループ、ファイル保存、shot spec の解釈はすべて `pv/tools/truth-render/` 側に置く。

この分離により、ユーザーの既存差分と衝突する面積を最小化する。

#### 出力レイアウト

```
pv/renders/<shot-id>/
  shot.json              # 使用した shot spec の実体コピー
  base/0000.png …        # 全フレーム
  segmentation/0000.png … # guideStride 間引き
  instance/0000.png …
  edge/0000.png …
  depth/0000.png …
  normal/0000.png …
  instance-legend.json
  segmentation-legend.json
  base.mp4               # Layer 2 への入力
```

### 4.3 Layer 2 — Appearance Generation

#### Topview 実測仕様（2026-08-03 確認）

- モード: オムニリファレンス / 画像から動画 / テキストから動画。使用するのは**オムニリファレンス**。
- モデル: Seedance 2.0。
- アップロード受理形式: `.jpg,.jpeg,.png,.webp,.bmp,.mp4,.mov,.avi,.wav,.mp3`。複数可。**動画入力が可能**。
- プロンプト公式例: 「`@Image1` を最初のフレーム、`@Image2` を最後のフレームにして、`@Video1` のように踊らせる」。
- 尺: 4s〜15s の1秒刻み。アスペクト比 16:9。解像度 720p。自動アップスケール有り（既定OFF）。
- 課金: **クレジットモード**＝1秒1クレジット（4s→4クレジット、優先速度）。**無制限モード**＝cost 0 だが 2026-08-03 時点でキュー混雑、待ち1〜6時間。
- 残高: 490.74 クレジット。
- Board: `house-planner-mobile-PV-2026-07` / `1dcb0110eaf944b2ad5f5f70e3a8a582`。

#### 入力の組み立て

- `@Video1` = Layer 1 の `base.mp4`（動きと構造のドライバ）
- `@Image1..@ImageN` = 同じパスから等間隔で抜いた真実フレーム（上限9枚）

動きと構造に二重の拘束をかけた上で、プロンプトは質感・光・空気感・生活感のみを要求する。三次元の再構成は一切依頼しない。

#### プロンプトテンプレート（骨格）

> `@Video1` defines the exact camera path, layout and occlusion. Keep every wall, opening, stair tread, window and furniture item at the identical position, count and scale as in `@Video1`. `@Image1..N` are exact frames from that same path — treat them as architectural truth. Do not add, remove, move or resize any architectural element or furniture. Only upgrade appearance: physically based materials, global illumination, contact shadows, soft daylight falloff, subtle atmosphere, and lived-in details confined to surfaces that already exist. No new objects, no text, no UI, no logo, no people unless requested.

ショット種別ごとの追加拘束（階段段数、キッチン並び、開口位置など）は shot spec の `appearance.lock` から生成する。

#### 分割方針

生成は4秒単位で行い、連結は編集で行う（既存 `pv/tools/concatenate_video_clips.swift`）。長尺を一度に生成させない。

### 4.4 Layer 3 — Fidelity QA

**これが従来欠けていた層である。** 目視レビューでは「壁が生えた」「椅子が消えた」を安定して検出できない。

#### 処理

1. Seedance 出力を `pv/tools/extract_video_frames.swift` でフレーム展開する。
2. Layer 1 の同時刻フレームと突き合わせる。

#### 判定指標

| 指標 | 基準 | 検出対象 |
|---|---|---|
| 構造エッジ一致率 | `edge/` との IoU および Chamfer 距離 | 壁・開口・階段の移動や生成 |
| 部屋占有差 | `segmentation/` の色域ごとの面積差・重心ずれ | 間取りの改変 |
| インスタンス存否 | `instance/` + `instance-legend.json` | 家具の消失・新規出現 |

`instance-legend.json` が部材IDと色の対応を持っているため、**どの家具が消えたかを名指しで報告できる**。

#### 出力

shot ごとに PASS / FAIL と、失敗フレーム番号・破綻した部材名を含むレポートを出す。閾値割れは自動 reject とし、採用可否を人間の主観から切り離す。

閾値の初期値は検証ショットの実測から決める。設計時点で数値を仮置きしない。

## 5. 検証計画

最大の未確定事項は、**`@Video1` がピクセル構造のロックとして働くのか、単なる動きの参照にすぎないのか**である。Topview の公式プロンプト例（「`@Video1` のように踊らせる」）は motion transfer 寄りの言い回しであり、構造保持は保証されていない。

したがって最初の1本は機能検証に充てる。

- 対象: T63 と同一の 2F LDK 画角。過去に失敗した条件を再現する。
- 差分: 単一静止画ではなく、Layer 1 が出した実カメラ移動 `base.mp4` で駆動する。
- 設定: Seedance 2.0 / オムニリファレンス / 720p / 16:9 / 4s / **クレジットモード**（判定を即時に得るため）。
- 判定: Layer 3 の数値で PASS / FAIL を出す。目視では決めない。

結果による分岐:

- **構造が保たれた場合** — 本設計のまま本番ショットへ展開する。本番分は無制限モード（cost 0）に切り替える。
- **保たれなかった場合** — `@Video1` を主拘束から外し、密なキーフレーム（`@Image1..9`）主体へ設計を切り替える。4秒あたり9枚なら約0.5秒間隔で真実フレームを与えられる。

## 6. コスト方針

ユーザー決定: **検証のみクレジットモード**を使う。判定実験に 4s × 数本（10〜20クレジット）を充て、設計が固まってからの本番生成は無制限モード（cost 0）へ回す。残高490.74に対し十分な余裕がある。

既存の Topview テストは勝手にキャンセル・削除しない。ZUBASH Board へ混ぜない。

## 7. リスクと未確定事項

| # | リスク | 影響 | 対応 |
|---|---|---|---|
| 1 | `@Video1` が構造ロックでない | 設計の中核が崩れる | 第5節の検証で先に潰す。ダメなら密キーフレームへ切替 |
| 2 | `index.html` が単一19457行、ユーザー差分が乗っている | 衝突・巻き込み事故 | 変更をグローバル露出1点に限定し、URLパラメータでガード |
| 3 | 出力が720pに制限される | PV最終品質 | 自動アップスケールの併用可否を検証時に確認する |
| 4 | 無制限モードのキュー待ち1〜6時間 | 本番反復速度 | 本番は並列投入し、待ち時間中に別ショットのLayer 1を進める |
| 5 | 生活感の付与が家具の新規生成に化ける | 忠実度 | `appearance.lock` とLayer 3のインスタンス存否判定で機械的に検出 |

## 8. スコープ外だが記録すべき事項

- S01 / S02 は実際の製品操作の画面収録が未実施。本エンジンの対象外であり、別途収録が必要。
- S07 / S08 は高品質v2レンダーが未承認のため `missing` のままとする。本検証の成功をもって approved に昇格させない。
- `scroll-world` は seam rule と scrub engine の参考候補にとどめる。インストール・外部APIキー設定・有料生成は行わない。
