# house-planner をワンソースで Web・ネイティブアプリ・ChatGPT に出す設計

- 日付: 2026-11-10
- ブランチ: `feat/one-source-platform`（`origin/main` 2ec12083 から）
- 関連: 課金基盤 `~/Projects/srapps-billing/README.md`（仕様の正本）、間取り読み取りの方針（2026-10-19 合意）

## 1. 何のためにやるか

house-planner mobile（https://cad-planner.srapps.us）を、次の3つの形で出す。

1. Web 版（今のもの）。無料で、広告を出す。
2. ネイティブアプリ（iOS・Android）。サブスクを買うと、AI の機能を月ごとの回数の枠で使える。
3. ChatGPT のアプリ。利用者自身の ChatGPT の契約で AI が動き、こちらは間取りを操作する窓口だけを提供する。

3つを別々に作ると、間取りの扱いが3通りに分かれて直すたびに食い違う。そこで、**間取りを操作する処理を1か所に集め、3つの出口がそれを共有する**。

同時に、大きな機能として「チャットで AI に間取りを作ってもらう・家財を足してもらう」を入れる。手順は利用者と合意済みで、次の2段で考える。

- 一歩め: 図面の画像があれば、既存の読み取り（`/api/ai/read-plan` → `review-plan-3d`）で間取りを起こす。
- 二歩め以降: 開いているプランに対して「洗面所を広く」「寝室にベッドを2つ」と言葉で頼むと、AI がプランへの変更を返し、画面に反映する。家財の追加もここに入る。

図面の無い人向けの「白紙から一括で作る」は、二歩めの仕組みの上に後から足す（合意済みの順番）。

## 2. 目標・やらないこと・失敗とみなすこと

### 目標

- 間取りを変える操作（部屋の追加・寸法変更・壁・建具・家財の配置・移動・削除・設定変更・検査）を、画面に依存しない関数として1か所にまとめる。Web 画面、Worker のチャット、ChatGPT 向けの窓口が同じ関数を呼ぶ。
- チャットで頼んだ変更が、1回の取り消し（undo）で丸ごと戻せる。
- ネイティブアプリは Web と同じソース（`index.html` と `assets/`）を Capacitor で包んで作る。
- AI の利用回数は、アプリでは利用者ごとに srapps-billing の枠で数え、全体の財布の上限は今の `AiQuota` で守り続ける。
- リポジトリの一度きりの作業跡と配信物に混じった不要ファイルを片付け、テストが漏れなく走る状態にする。

### やらないこと（今回の範囲外）

- `index.html` 全体のモジュール分割やバンドラの導入。切り出すのは間取りの操作に関わる部分だけ（利用者決定: 段階的に進める）。
- 3D 描画（`buildWall3D` など）の作り直し。
- Web での販売（Stripe）。課金基盤の決定どおり、Web では買えない。
- 「白紙から一括で作る」専用の画面。チャットの延長で扱う。
- 男性の人物モデルなど、既存の持ち越し項目。

### 失敗とみなすこと（動いても駄目なもの）

- **既存利用者の保存プランが開けなくなる・見た目が変わる。** 互換の黄金テスト（`tools/tests/plan-compat.browser.mjs`）が1件でも変わったら止める。
- AI の答えを、決まりで勝手に書き換えて「直したこと」にする。合意済みの方針どおり、機械で分かる事実は AI に伝えて直させる。
- AI の費用が利用者の数に比例して青天井になる。全体の上限が働かない経路を作らない。
- API キーや秘密値がブラウザ・アプリ・ログ・リポジトリに出る。
- 画面に開発の都合（費用・トークン・秒数・座標）を出す。

## 3. 全体の構成

```
            ┌──────────── 同じソース（index.html + assets/）────────────┐
            │  Web 版（広告あり）          ネイティブアプリ（Capacitor）   │
            │        チャット欄 ─┐               チャット欄 ─┐              │
            └────────────────────┼───────────────────────────┼──────────────┘
                                 ▼                           ▼
   ChatGPT ──MCP──▶  Cloudflare Worker（今の worker.mjs に足す）
                      ├ /api/ai/chat        … Claude に道具付きで頼む（SSE）
                      ├ /mcp                … ChatGPT アプリの窓口
                      ├ /api/ai/read-plan 等 … 既存の読み取り
                      ├ /api/rooms/*        … 既存の共有ルーム（Durable Object + R2）
                      └ srapps-billing（Service Binding）… 権利と回数の枠
                                 │
                                 ▼
                 間取りの操作部品 plan-core（UMD、ブラウザ・Worker・Node で共通）
```

### 3.1 間取りの操作部品（plan-core）

置き場所は `assets/js/plan-core/`。形式は既存の手本（`plan-check.js`、`plan-free-apply.js`）と同じ UMD にする。ブラウザは `<script>` で、Worker は `import X from "../assets/js/plan-core/x.js"` で、テストは `require` で読む。

中身は次の5つ。それぞれ1本の PR で切り出し、前の段が本番に出てから次へ進む（3.6 の順番）。

1. **読み込みの正規化** `normalizeLoadedPlan(plan, ctx)`
   今は同じ手順が7か所（`loadPlanFromStorage`、`doImport`、`applySharedPatch`、`plan-library.js` の `loadIntoEditor`、`compare-mode.js`、`plan-import.js`、`plan-data.js` の `loadPreset`）に書かれ、中身が少しずつ違う。1つにまとめる。グローバルの `DATA` ではなく引数の `plan` を直し、`WALL_H` などのグローバルへの写しは呼ぶ側に残す。
2. **物を作る関数** `makeWall` / `makeItem` / `makeRoom`
   今の `mkWall` / `mkItem` を、id の発行とカタログ（`ISIZES`、manifest の寸法）を `ctx` で受け取る形にする。`index.html` 側の `mkWall` / `mkItem` は、これを呼ぶ薄い包みとして残す。
3. **差分の適用** `applyPatch`
   `worker/shared.mjs` の `applyPatch` と `index.html` の `applySharedPatch` を1つにする。共有する欄の範囲が今は両者で違うので、どちらに揃えるかは切り出しの PR で決めて説明に書く。
4. **操作（コマンド）** `applyOperations(plan, ops, ctx) → { plan, changedIds, warnings, errors }`
   1つの操作は `{ op: "addRoom", args: {...} }` の形。最初に用意する操作は次のとおり。
   - `addRoom` / `resizeRoom` / `renameRoom`（部屋）
   - `addWall` / `removeWall`
   - `placeItem`（家財・建具・設備。カタログの種類名で指定する）
   - `moveObject` / `rotateObject` / `deleteObjects`
   - `setProps`（設定できる項目は `assets/js/plan-settable.js` の `SETTINGS` を正本として使う）
   吸着（扉窓を壁へ、階段、格子）は `DATA` でなく引数の `plan` を見るように直して、操作の中で使う。操作が失敗したら、その操作だけを `errors` に入れて残りは続けず、**プランは変えずに返す**（全部か無しか）。
   画面側の `placeItem` / `delSel` / `updateSelectedProp` は「`saveState` → 操作 → 描画」の薄い包みに変える。undo は今の JSON スナップショット方式のままにする。
5. **検査** `inspectPlan(plan)`
   `PlanSchema.validatePlan`、`PlanCheck.knowledgeWarnings`、`PlanStructure.floorsOverlap` を束ねる。チャットと ChatGPT の「検査」道具に使う。`tools/lint_plan.py` の項目を移すのは今回はしない。

座標と単位は今の保存形のまま（mm、+x 東、+y 南、物の `x,y` は回転前の外接矩形の北西角）。ただし AI に渡す操作の引数は、読み取りと同じく**中心座標**で受け、操作の中で角に直す（読み取りの `toAppObjects` と同じ約束）。

### 3.2 操作の定義を1か所に置く

操作ごとに「名前・説明・引数の JSON Schema」を `assets/js/plan-core/operations-catalog.js` に1回だけ書く。ここから次の2つを生成する。

- Worker のチャットで Claude に渡す道具（tool）の定義
- ChatGPT アプリの MCP の道具の定義

引数の選択肢（家財の種類、設定項目）は `plan-settable.js` と `object-knowledge.js` から作り、手で書かない（読み取りの `plan-free.mjs` と同じやり方）。読み取りで、enum や anyOf が多いと Claude に「文法が大きすぎる」と断られた経験があるので、家財の種類は enum にせず文字列で受け、操作の中で照合して、合わなければ候補を `errors` に入れて返す。

### 3.3 チャット（Web とネイティブアプリ共通）

**前提: Worker は当面 Cloudflare の無料プランで動かす**（利用者決定）。無料プランは1リクエストの計算時間が 10ms まで（2026-10-29 更新の公式の上限表で確認）。そのため、Worker の中で Claude と何往復もしたり、プラン全体（約 93KB）を毎回読んで操作を当てたりはしない。**往復を回すのはブラウザ、Worker は鍵を持って1往復ずつ取り次ぐだけ**にする。今の読み取り（`worker/anthropic.mjs`）が「Worker では返事を読み解かない」作りにしているのと同じ考え方。

- 画面: 右下（スマホでは下）にチャット欄を開くボタンを置く。チャット欄の中で、画像を添付すると一歩めの読み取りに、文章だけなら二歩めの変更に進む。読み取りは既存の `runPlanImport` をそのまま呼び、チャット欄には進み具合だけを出す。
- 1回の依頼の流れ:
  1. ブラウザが `POST /api/ai/chat` に、会話の履歴・プランの要約（部屋・寸法・家財の一覧。プラン全体は送らない）・選択中の物の id を送る。
  2. Worker は回数を数え（3.5）、Claude に 3.2 の道具の定義を付けて1回だけ呼び、返事をそのまま SSE で流す（読み解かない）。
  3. ブラウザが返事の中の道具の呼び出しを読み、plan-core の `applyOperations` を**作業用の写し**に当てる。結果（変わった物・警告・失敗）を道具の結果として履歴に足し、もう一度 `/api/ai/chat` を呼ぶ。
  4. Claude が道具を呼ばずに返事を終えたら、写しを本物のプランに入れる。直前に `saveState` を1回だけ呼ぶので、1回の依頼が1回の undo で丸ごと戻る。
- 回数の数え方: 1回の依頼の最初の呼び出しで回数を1つ使い、Worker は署名つきの「依頼の札」を返す。同じ依頼の2回め以降はこの札を付けて呼び、回数を数えない。札には往復の上限（仮に 8 回）と有効期限を入れ、Worker が確かめる（既存の `plan-result` の受付番号と同じ HMAC 署名のやり方）。
- 費用: 道具の定義とプランの要約は毎回同じなので、Claude のプロンプトキャッシュを使う。
- 見直し: 読み取りで効いた「AI 自身に3Dで見直させる」は、チャットでは最初は入れない。変更が小さく、利用者がその場で見て次の依頼で直せるため。必要になったら `PlanSnapshot.capture` を使う形で後から足す。

### 3.4 ChatGPT アプリ（MCP）

- 同じ Worker に `/mcp`（Streamable HTTP）を足す。MCP の道具は 3.2 の操作に、次の4つを加えたもの。
  - `create_plan`（空のプランで共有ルームを作る）
  - `open_plan`（共有ルームの URL を受け取り、そのプランを対象にする）
  - `get_plan`（プランの要約を返す）
  - `inspect_plan`
- 既存のプランを ChatGPT で直せるようにする（利用者決定）。画面に「ChatGPT で開く」ボタンを置き、押すと今のプランで共有ルームを作り、ChatGPT に貼る文（ルームの URL 入り）をコピーする。
- 無料プランの 10ms の中で、ルームのプランに操作を当てて保存できるかは**まだ確かめていない**。段5の最初に、実物大のプラン（既定プラン約 93KB）で計る。収まらなければ、プランの読み書きを階ごとの単位に分けるなどの作りに変える。Durable Object も無料プランでは SQLite 方式しか使えないので、`CollaborationRoom` がそれで動いていることも合わせて確かめる。
- プランの置き場所は、既存の共有ルーム（`CollaborationRoom`、Durable Object + R2）を使う。ChatGPT の会話ごとに1つのルームを作り、道具を呼ぶたびにルームのプランへ操作を当てて保存する。共有ルームの WebSocket がそのまま働くので、利用者が house-planner の画面で同じルームを開いていれば、変更がその場で映る。
- 利用者に返すもの: 変更の要約と、「house-planner で開く」リンク（ルームの URL）。ChatGPT の画面の中に間取りの絵を出す部品（Apps SDK の画面部品）は、2段めで入れる。
- 公開の範囲: まず ChatGPT の開発者モードで、利用者自身が使えるところまで（利用者決定）。公開ディレクトリへの申請は、srapps-billing 側で進むプライバシーポリシーの整備に合わせて行う。
- 認証: 最初は認証なし。ルームの id（推測できない長さ）を知っていることを権限とする。課金も広告も付けない。ただし ChatGPT 経由で Worker が AI を呼ぶことは無いので、こちらの AI 費用はかからない。ルームの作成には接続元ごとの回数制限を付ける。
- 図面の読み取り（画像）は ChatGPT アプリでは提供しない。読み取りはこちらの Claude を使うため費用がかかるから。

### 3.5 ネイティブアプリ・課金・広告

- `apps/native/` に Capacitor のプロジェクトを置く。Web のビルド結果（`dist/`）を中身として使う。npm が必要なのはこのディレクトリの中だけにし、リポジトリ直下に `package.json` は置かない（直下に置くと、`assets/js` の UMD を Node が読むときの扱いと、Workers Builds の手順が変わるため）。
- Worker から srapps-billing の部品（`@sakerice/srapps-billing-server`）や MCP の SDK を読み込む方法は、段5・段7の着手時に決める（作る人の判断）。候補は `worker/package.json` を置いてビルドの手順で `npm ci` する形。
- 課金は srapps-billing の README 11 章のチェックリストどおりに組み込む。サービス ID は `house-planner`。
  - 売るもの（カタログ案、srapps-billing への PR で決める）: サブスク1種に、月ごとの AI 利用回数の枠と広告非表示の権利を付ける。
  - チャットと読み取りは、Worker で `reserveUsage()` を通ったときだけ AI を呼ぶ。画面の表示で判断しない。
  - 設定画面に「購入を復元」「サブスクの管理」「データを削除」「自分のデータを見る」を置く。
- Web 版の広告:
  - Google AdSense を使う。出す場所は、作業の邪魔にならない場所に限る（開始画面・プラン一覧・保存後の画面など）。**作図中の 2D・3D の画面には出さない。**
  - アプリの中（WebView）では広告を読み込まない。アプリ内での判定には `shouldShowAds()` を使う。
- 回数の数え方（利用者決定: Web とアプリの未購入者に小さな無料の試用枠を設ける）:
  - サブスクの権利がある利用者（資格情報ヘッダーが有効）は、srapps-billing の枠で数える。
  - それ以外（Web、アプリの未購入者）は、今の IP ごとの上限で数える。試用は1日1回程度に絞る。
  - srapps-billing の「AI の無料分は設けない」は基本方針として残し、サービスの責任で試用枠を設けることを例外として基盤の仕様に書き足す（別セッションで依頼済み）。
  - 全体の財布の上限は `AiQuota` が両方を数える。
  - `takeQuota` が数えられなかったときに通してしまう今の動き（fail-open）は、チャットでは止める側（fail-closed）にする。

### 3.6 進める順番（それぞれ別の PR、main へのマージは毎回利用者の確認を取る）

| 段 | 中身 | 利用者にとって変わること |
|---|---|---|
| 0 | 整理（4章）。不要ファイルの削除、テストの漏れを直す | 配信が約13MB軽くなる。テストがすべて走る |
| 1 | plan-core: 読み込みの正規化を1つに | 読み込み方による見た目の違いがなくなる |
| 2 | plan-core: 物を作る関数と差分の適用 | 共同編集の欄の食い違いがなくなる |
| 3 | plan-core: 操作と検査、画面の包みの置き換え | 見た目の変化は無し（土台） |
| 4 | チャット（二歩め）を Web に出す。一歩めの読み取りをチャット欄から呼べるようにする | 言葉で間取りを直し、家財を置ける |
| 5 | ChatGPT アプリ（MCP）、ルーム経由 | ChatGPT から間取りを作れる |
| 6 | Web 版の広告 | — |
| 7 | ネイティブアプリ（Capacitor）、srapps-billing の配備、ストアと課金 | アプリで AI を回数の枠で使える |

ストアと課金は後回しにする（利用者決定）。段7に入る前に、srapps-billing の共通サーバーの配備に Cloudflare の有料プランが要る件を、利用者が改めて判断する。Apple の開発者アカウントは準備済み、Google Play は審査待ち（2026-11-10 時点）。外に出る操作（配備・RevenueCat・ストアの設定）は一つずつ利用者の確認を取る。

段1〜3は、保存プランの互換テストと既存のテストが全部通ることを条件にする。

## 4. 既存コードのレビューで見つかったこと

今回の作業で直すもの:

1. 読み込みの正規化が7か所にばらばらにあり、中身が食い違っている（`loadPlanFromStorage` に `resetHeightGlobalsForPlanLoad` が無い、`loadPreset` が外壁の設定を補わない）。段1で直す。
2. ブラウザの読み込みでは `PlanSchema.validatePlan` が呼ばれていない。段1では検査を**警告として記録するだけ**にし、読み込みは止めない（止めると今開けているプランが開けなくなりうるため）。
3. 差分の適用が Worker とブラウザで二重にあり、共有する欄の範囲が違う。段2で直す。
4. `/api/ai/*` に認証が無く、回数制限が数えられないときに通す。チャットでは止める側にする（3.5）。既存の読み取りの扱いは変えない。
5. id の付け方が5通りある（数値、`'rm_'+Date.now()`、`'rm_'+nextId`、`'rm'+n`、`'p'+n`）。plan-core では id 発行を `ctx` の1か所にまとめる。既存のプランの id は書き換えない。
6. テストが一部どこからも走っていない。`*.browser.cjs` の2本、`default_plan_quality_test.py`、`pv/tools` のテストが該当する。段0で実行の仕組みに載せる。`default_plan_quality_test.py` は既定間取りを直接読んでいて「テストから既定間取りを読まない」決まりに反するので、決まりの検査（`fixture-only.test.cjs`）が `.py` も見るようにする。
7. CI でテストが走っていない（GitHub Actions は PV だけ）。段0で、PR ごとに `tools/run_tests.sh` を走らせる仕組みを足す。ブラウザのテストは重いので手元のまま。
8. 画面テストの出力先が `docs/quality-review/` で、テストを回すたびに未追跡の PNG がたまる。出力先を git 管理外（`output/test-shots/`）に変え、レビューに残したい画像だけを手で docs に置く運用にする。
9. `AGENTS.md` などは `DESIGN.md` を参照しているのに、ファイル名は `design.md`。大文字小文字を区別する環境で見つからないので、`DESIGN.md` に名前を揃える。

一覧に留めるもの（今回は直さない）:

- プラン全体の版番号が無く、移行は個別の印に頼っている。plan-core の段1で `schemaVersion` を足すかは、段1の PR で判断する。
- `index.html` のトップレベル関数 912 個、`buildWall3D` 606 行など、3D 側の巨大な関数。
- `tools/lint_plan.py` と `tools/plan_kit.py` が、平面の幾何を Python で別に書いている（三つ目の実装）。

## 5. ファイルとディレクトリの整理（段0）

消す・動かすもの（どこからも参照されていないことを確認済み）:

- ルート直下: `clean_sprites.py`、`process_generated_floorplan_sprite.py`、`process_generated_floorplan_sprite_set2.py`、`replace_fridge_topdown.py`、`RESUME.md` を消す。入力が `/private/tmp` に決め打ちで、もう再実行できない。
- `scripts/`: 一度きりのパッチ（`apply_task3〜5.py`、`patch_index.py`、`fix_floor_gap.py`、`apply_sprite_crops.py`、`analyze_sprites.py`、`gen_models.py`、`check_js.py`）を消す。現役のエアコンの生成元 `generate_air_conditioner.py` は `tools/blender/` へ、テクスチャの生成元 `gen_textures.py` は `tools/` へ移す。`scripts/` は空になるので消す。
- `assets/`: 参照の無い PNG 14枚（`bathtub`、`bed`、`car`、`dining`、`fridge`、`grass`、`kitchen`、`sink`、`sofa`、`tile_floor`、`toilet`、`tree`、`tv`、`wood_floor`）、`*_preview.png` 2枚、`sprite_crops.json`、`japanese_floorplan_parts_sprite_gpt.json`、`assets/models/` 直下の参照の無い GLB 10個を消す。`assets/.DS_Store` を git の管理から外す。
- `build.sh`: `.blend` と `.DS_Store` を配信物に入れないようにする。
- テストの名前: `*.browser.cjs` の2本を `*.browser.mjs` に揃えるか、実行の仕組みに `.cjs` も載せる。

置き場所を作るもの:

- 既定プランの生成器とパッチ（`make_default_plan_*.py`、`*_review_*.json`、`plan_kit.py` など）を `tools/default-plans/` にまとめる。生成器の import と読み込みのパスを直し、作り直した既定プランが今のものと1バイトも変わらないことを確かめる。

利用者の判断が要るもの（8章）:

- `docs/quality-review` の過去レビュー画像（約 275MB、うち同じ画像の複製 73MB）
- 手元フォルダの git 管理外の置き場（`scratch/` 365MB、`output/` 217MB）と、取り込み済みのブランチ・worktree の削除

触らないもの: `reference-textures/`（権利上、外に出さない資料）、`.dev.vars`（秘密値）、`tools/blender` の `.blend`（編集できる元データを残す方針）、既定プランの生成器が当てるパッチ json。

## 6. 作る人に任せること

- plan-core の各ファイルの分け方、関数の細かい名前。
- 操作の引数の細部（部屋の寸法を中心＋幅奥行きで受けるか、四辺で受けるか、など）。AI が間違えにくい方を、試して選ぶ。
- チャット欄の見た目（DESIGN.md と既存の UI に揃える）。
- Claude のモデル（読み取りと同じ `claude-opus-5-5` から始め、費用を見て `claude-sonnet-5-5` と比べる）。
- MCP サーバーの実装方法（公式 SDK を使うか、手で書くか）。

## 7. 利用者が決めたこと（2026-11-10）

- チャットは「既存の読み取りで一歩め、以降は会話で直す」順で作る。白紙から一括で作るのは後。
- ChatGPT 版は ChatGPT のアプリ（MCP）にする。利用者の API キーを預かる形にはしない。まず開発者モードで使い、公開はプライバシーポリシーの整備に合わせる。既存のプランを ChatGPT から開けるようにする。
- リファクタリングは段階的に進める（`index.html` 全体の作り直しはしない）。
- Web 版は無料で広告を出す。
- Cloudflare は当面無料プランで進める。
- AI の無料の試用枠を Web とアプリの未購入者に小さく設ける。srapps-billing の仕様に例外として書き足す。
- ストアと課金は進める前提だが、順番は後（段7）。

## 8. まだ決めていないこと（段の着手時に利用者に聞く）

- `docs/quality-review` の過去レビュー画像（約 275MB、うち複製 73MB）を git に残すか、別の場所へ移すか。（段0）
- 手元フォルダの git 管理外の置き場（`scratch/` 365MB、`output/` 217MB）と、取り込み済みのブランチ・worktree（約55本）を消すか。（段0）
- サブスクの価格と、月ごとの AI の回数。（段7、srapps-billing のカタログ PR で決める）
