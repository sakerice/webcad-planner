# 段0 整理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 一度きりの作業跡と配信物に混じった不要ファイルを片付け、すべてのテストがどこかから走り、PR ごとに CI で回る状態にする。

**Architecture:** 削除・移動は「どこからも参照されていない」ことを grep で確かめてから行う。配信物の混入は `build.sh` の最後に検査スクリプトを足して、ビルドを落とす形で防ぐ（人の注意に頼らない）。画面テストの出力先は1つの補助関数に集め、git 管理外へ向ける。

**Tech Stack:** bash、node（`node:test`）、python3、GitHub Actions。

**Spec:** `docs/superpowers/specs/2026-11-10-one-source-platform-design.md`（4章・5章・3.6 の段0）

## Global Constraints

- 作業ブランチは `feat/one-source-platform` から切った `feat/stage0-cleanup`。main への push・マージは利用者の確認なしにしない。
- 触らない: `index.html`、`assets/js`、`assets/vendor`、`assets/textures`、`assets/models` の現役ディレクトリ、`stone.png`、`japanese_floorplan_parts_sprite_gpt.png`、`japanese_floorplan_parts_sprite_gpt_2.png`、`worker/`、`wrangler*.toml`、`tools/deploy.sh`、`tools/confirm-deploy.sh`、`reference-textures/`、`.dev.vars`、`tools/blender` の `.blend`、既定プランの生成器が当てる `*_review_*.json`。
- テストは出荷する既定間取り（`assets/default_plan.json`、`assets/default_plan_3f.json`）を読まない（`tools/tests/fixture-only.test.cjs` の決まり）。
- コミットメッセージは日本語、末尾に `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。
- 利用者の判断が要る3点（`docs/quality-review` の過去画像、手元の `scratch/`・`output/`、取り込み済みブランチと worktree の削除）は Task 8 で聞き、答えが出るまで手を付けない。

## Review Focus

- 消したファイルが、文字列連結で組み立てたパス（例: `'assets/'+name+'.png'`）から読まれていた → Task 2 で、本番と同じ dist を内蔵ブラウザで開き、コンソールと通信に 404 が無いことを確かめる。
- 大文字小文字だけの改名（`design.md` → `DESIGN.md`）が macOS の git で改名として記録されない → Task 5 で `git ls-files | grep -i design.md` が `DESIGN.md` だけを返すことを確かめる。
- CI（Linux）でだけ落ちるテスト（大文字小文字、`python3` の有無、ブラウザの有無）→ Task 7 で PR を作り、実際の CI の結果を見る。
- 既定プランの生成器を動かしたあと、出力が1バイトでも変わる → Task 6 で生成前後の sha256 を比べる。
- 画面テストの出力先を変えたことで、レビューの手順書が古いパスを指したまま → Task 4 で `docs/` 内の手順書も grep して直す。

---

### Task 1: ルート直下と `scripts/` の作業跡を消す

**Files:**
- Delete: `clean_sprites.py`、`process_generated_floorplan_sprite.py`、`process_generated_floorplan_sprite_set2.py`、`replace_fridge_topdown.py`、`RESUME.md`
- Delete: `scripts/apply_task3.py`、`scripts/apply_task4.py`、`scripts/apply_task5.py`、`scripts/patch_index.py`、`scripts/fix_floor_gap.py`、`scripts/apply_sprite_crops.py`、`scripts/analyze_sprites.py`、`scripts/gen_models.py`、`scripts/check_js.py`
- Move: `scripts/generate_air_conditioner.py` → `tools/blender/generate_air_conditioner.py`、`scripts/gen_textures.py` → `tools/gen_textures.py`
- Test: `tools/tests/repo-hygiene.test.cjs`（新規）

**Interfaces:**
- Produces: `repo-hygiene.test.cjs`。リポジトリ直下に置いてよいファイルの一覧（許可リスト）を持つ。後の Task はここに項目を足す。

- [ ] **Step 1: 失敗するテストを書く**

`repo-hygiene.test.cjs` に `test('リポジトリ直下には決まったファイルだけがある')`。`git ls-files` の結果からルート直下のファイルを集め、許可リスト `['AGENTS.md','CLAUDE.md','DESIGN.md','build.sh','index.html','worker.mjs','wrangler.toml','wrangler.default-plans.toml','.gitignore']` に無いものがあれば失敗する。あわせて `test('scripts/ ディレクトリは無い')`。

- [ ] **Step 2: 失敗を確かめる**

Run: `node tools/tests/repo-hygiene.test.cjs`
Expected: FAIL（`clean_sprites.py` などが列挙される。`DESIGN.md` は Task 5 まで無いので、許可リストにあっても失敗には関係しない）

- [ ] **Step 3: 参照が無いことを確かめてから消す・移す**

消す前に、各ファイル名で `git grep -n <basename>` を走らせ、ヒットが自分自身・`RESUME.md`・`docs/superpowers/plans/2026-0[5-7]-*` だけであることを確かめる。それ以外がヒットしたら、そのファイルは消さずに止めて報告する。`git rm` と `git mv` で行う。

- [ ] **Step 4: テストを通す**

Run: `node tools/tests/repo-hygiene.test.cjs && sh tools/run_tests.sh`
Expected: PASS、`exit=0`

- [ ] **Step 5: コミット** `git commit -m "一度きりの作業スクリプトと古い再開手順を片付ける"`

### Task 2: 配信物から不要ファイルを外し、混入をビルドで止める

**Files:**
- Delete: `assets/{bathtub,bed,car,dining,fridge,grass,kitchen,sink,sofa,tile_floor,toilet,tree,tv,wood_floor}.png`、`assets/japanese_floorplan_parts_sprite_gpt_preview.png`、`assets/japanese_floorplan_parts_sprite_gpt_2_preview.png`、`assets/sprite_crops.json`、`assets/japanese_floorplan_parts_sprite_gpt.json`、`assets/models/{bathtub,bed_double,bed_single,closet,fridge,kitchen,sink,sofa,toilet,tv}.glb`
- Untrack: `assets/.DS_Store`（`git rm --cached`）
- Create: `tools/check_dist.cjs`
- Modify: `build.sh`（`.blend`・`.DS_Store` を dist から消す行と、最後に `node tools/check_dist.cjs dist` を呼ぶ行）
- Test: `tools/tests/check-dist.test.cjs`

**Interfaces:**
- Produces: `node tools/check_dist.cjs <dir>`。`<dir>` の中に `.blend`、`.DS_Store`、`*_preview.png`、`.py` のどれかがあれば、見つけたパスを1行ずつ出して終了コード1。無ければ0。

- [ ] **Step 1: 失敗するテストを書く**

`check-dist.test.cjs`: 一時ディレクトリに `a.blend` と `ok.png` を作り、`check_dist.cjs` を子プロセスで走らせて終了コード1・出力に `a.blend` を含むこと。`ok.png` だけなら終了コード0。

- [ ] **Step 2: 失敗を確かめる** `node tools/tests/check-dist.test.cjs` → FAIL（スクリプトが無い）

- [ ] **Step 3: `check_dist.cjs` を書き、`build.sh` に組み込む**

`build.sh` では `cp -r assets/. dist/assets/` の直後に `find dist \( -name '*.blend' -o -name '.DS_Store' \) -delete` を置き、`check_cloudflare_asset_sizes` の直前に `node tools/check_dist.cjs dist` を置く。

- [ ] **Step 4: 不要ファイルを消す**

各ファイル名（拡張子なしの名前でも）で `git grep -n` し、ヒットが `index.html` 内の別物（`assets/textures/...jpg` を指すキー）や古い計画書だけであることを確かめてから `git rm`。

- [ ] **Step 5: 本物の dist で確かめる**

Run: `SKIP_DEPLOY=1 bash build.sh` → 成功。続けて dist を配信して内蔵ブラウザで開く（`.claude/launch.json` の既存設定を使う）。既定プランを開き、2D と 3D を切り替え、`read_console_messages` と `read_network_requests` で 404 が無いことを確かめる。

- [ ] **Step 6: テストを通す** `sh tools/run_tests.sh` → `exit=0`

- [ ] **Step 7: コミット** `git commit -m "配信物から使っていない画像と編集用ファイルを外し、混入したらビルドを止める"`

### Task 3: どこからも走っていないテストを走らせる

**Files:**
- Modify: `tools/run_browser_tests.sh`（`*.browser.cjs` も拾う）
- Move: `tools/tests/default_plan_quality_test.py` → `tools/default-plans/quality_test.py`（Task 6 で作る置き場。Task 6 より先に行う場合は `tools/default-plans/` をここで作る）
- Modify: `tools/tests/fixture-only.test.cjs`（`tools/tests/` 内の `.py` と `.mjs` も対象にする）
- Modify: `tools/run_tests.sh`（`pv/tools/truth-render/tests/*.test.mjs` と `pv/tools/fidelity-qa/tests/*.py` を走らせる。速さは Step 2 で計る）
- Test: `tools/tests/test-runner-coverage.test.cjs`（新規）

**Interfaces:**
- Produces: 決まり「`tools/tests/` にあるテストファイル（`*.test.cjs`、`*.browser.mjs`、`*.browser.cjs`、`*_test.py`、`lint_selftest.py`）は、`run_tests.sh` か `run_browser_tests.sh` のどちらかが拾う」。

- [ ] **Step 1: 失敗するテストを書く**

`test-runner-coverage.test.cjs`: 2つの実行スクリプトの中のグロブ（`tools/tests/*.test.cjs` など）を読み取り、`tools/tests/` の各テストファイルがどれかに当たるかを調べる。当たらないものがあれば失敗。`app-source.cjs`、`height-runtime.cjs`、`fixtures/` は部品として除外。あわせて `fixture-only` の拡張に対する失敗テスト（`.py` で `default_plan.json` を open している行を見つける）を `fixture-only.test.cjs` に足す。

- [ ] **Step 2: 失敗を確かめ、pv のテストの所要時間を計る**

Run: `node tools/tests/test-runner-coverage.test.cjs` → FAIL（`default-plans-review.browser.cjs`、`preset-start.browser.cjs`、`default_plan_quality_test.py` が列挙される）。`time` で pv のテストを計り、合計 30 秒を超えるなら `run_tests.sh` には入れず、`tools/run_pv_tests.sh` を別に作って CI からだけ呼ぶ。

- [ ] **Step 3: 実行スクリプトを直し、`default_plan_quality_test.py` を移す**

`default_plan_quality_test.py` は出荷物の検査なので、既定プランの生成器の側（`tools/default-plans/`）に移し、`tools/default-plans/check.sh` から `lint_plan.py` と一緒に走らせる。

- [ ] **Step 4: テストを通す** `sh tools/run_tests.sh` → `exit=0`。`sh tools/run_browser_tests.sh` を一度走らせ、新たに拾った2本が通ることを確かめる（落ちたら直す。直せない原因なら報告）。

- [ ] **Step 5: コミット** `git commit -m "どこからも走っていなかったテストを実行スクリプトに載せる"`

### Task 4: 画面テストの出力先を git 管理外へ移す

**Files:**
- Create: `tools/tests/shot-dir.mjs`
- Modify: Task 3 で拾ったものを含む9本（`bath-entry`、`ceiling-designer`、`default-plans-review`、`detail-integration`、`kitchen-system`、`neighbor-detail`、`original-models`、`preset-start`、`sidebar-neighbor`）
- Modify: `.gitignore`（`output/` は既に無視済みなので変更不要なら触らない）
- Test: `tools/tests/shot-dir.test.cjs`

**Interfaces:**
- Produces: `export function shotDir(...parts: string[]): string`。既定は `output/test-shots/<parts>`、環境変数 `SHOT_DIR` があればそれを根にする。呼ぶとディレクトリを作って絶対パスを返す。

- [ ] **Step 1: 失敗するテストを書く**

`shot-dir.test.cjs`（`import()` で読む）: `SHOT_DIR` 未設定で `shotDir('a','b')` が `<repo>/output/test-shots/a/b` を返し、ディレクトリが存在する。`SHOT_DIR=/tmp/x` なら `/tmp/x/a/b`。もう1つ、`tools/tests/*.browser.*` の中に `docs/quality-review` という文字列で書き込む行が無いこと。

- [ ] **Step 2: 失敗を確かめる** → FAIL

- [ ] **Step 3: 9本の書き込み先を `shotDir()` に置き換える**（`.cjs` の2本は `await import()` で読む）。`docs/` 内の手順書で、これらのテストの出力パスを案内している箇所も直す。

- [ ] **Step 4: テストを通す** `sh tools/run_tests.sh` → `exit=0`。画面テストを1本（`bath-entry.browser.mjs`）走らせ、`git status --porcelain docs/` が空であることを確かめる。

- [ ] **Step 5: コミット** `git commit -m "画面テストの撮影画像を docs ではなく output/test-shots に出す"`

### Task 5: `design.md` を `DESIGN.md` に揃える

**Files:**
- Rename: `design.md` → `DESIGN.md`（`git mv design.md tmp.md && git mv tmp.md DESIGN.md`）
- Modify: 小文字の `design.md` を参照している箇所（`git grep -n "design\.md"` で探す。`docs/superpowers/specs/*-design.md` のようなファイル名の一部は除く）

- [ ] **Step 1:** `git grep -n -i "\bdesign\.md"` で参照を洗い出す。
- [ ] **Step 2:** 改名し、参照を `DESIGN.md` に揃える。
- [ ] **Step 3:** `git ls-files | grep -i '^design\.md$'` が `DESIGN.md` だけを返す。`node tools/tests/repo-hygiene.test.cjs` → PASS。
- [ ] **Step 4: コミット** `git commit -m "デザインの決まりのファイル名を、参照どおり DESIGN.md に揃える"`

### Task 6: 既定プランの生成器を `tools/default-plans/` にまとめる

**Files:**
- Move to `tools/default-plans/`: `make_default_plan_2f.py`、`make_default_plan_3f.py`、`plan_kit.py`、`default_plan_review.py`、`default_plan_2f_review.py`、`make_review_patch.py`、`default_plan_site.py`、`default_plan_2f_review_2[3-7].json`、`default_plan_3f_review_2[2-3].json`、`default_plan_3f_user_review.json`（実在するものを `ls tools/default_plan* tools/make_*` で確かめる）
- Modify: 移したスクリプトの import と読み込みパス、`.claude/agents/*.md`・`docs/` の手順書のパス、`tools/lint_plan.py` からの import
- Create: `tools/default-plans/check.sh`（Task 3 の quality_test と `lint_plan.py` を走らせる）

- [ ] **Step 1: 移す前の出力を記録する**

Run: 生成器を今の場所で走らせ（各スクリプト冒頭の使い方の通り、出力先を一時ディレクトリにする）、出力の `sha256sum` を記録する。出力先を変えられない作りなら、`assets/default_plan*.json` の現在の sha256 を記録し、生成後に `git diff --quiet assets/` で比べる。

- [ ] **Step 2: 移してパスを直す**（`git mv`）

- [ ] **Step 3: 移した後の出力が同じであることを確かめる**

Expected: sha256 が Step 1 と一致。違ったら、移動のせいで読むファイルが変わっていないか調べ、直せなければ止めて報告する。

- [ ] **Step 4:** `sh tools/default-plans/check.sh` と `sh tools/run_tests.sh` → 成功。

- [ ] **Step 5: コミット** `git commit -m "既定プランの生成器と当てるパッチを tools/default-plans にまとめる"`

### Task 7: PR ごとに CI でテストを回す

**Files:**
- Create: `.github/workflows/tests.yml`

- [ ] **Step 1:** `pull_request` と `push`（main 以外）で、ubuntu-latest、node 22、python 3.12 を用意し、`sh tools/run_tests.sh` を走らせ、出力に `exit=0` が無ければ失敗させる。`run_tests.sh` は失敗しても終了コード0を返すので、最後の行を `exit $fail` に直す（同じ Task の中で行う）。Task 3 で `run_pv_tests.sh` を作った場合はそれも走らせる。
- [ ] **Step 2:** ブランチを push し、PR を作って CI の結果を見る。Linux でだけ落ちたものは、その場で直す。
- [ ] **Step 3: コミット** `git commit -m "PR ごとにテストを CI で回す"`

### Task 8: 利用者の判断が要る3点を聞き、答えどおりに片付ける

- [ ] **Step 1:** 次の3点を1回のメッセージで聞く（CLAUDE.md の「止まって質問するときの書き方」に従い、容量と、消した場合に失うものを書く）。
  1. `docs/quality-review` の過去レビュー画像（約 275MB、うち同じ画像の複製 73MB）。9月9日以降更新のない `default-plans-review-22/23/24`、`user-review`、`2026-09`、`2f-reset` などを git から外すか。外す場合、履歴には残る（取り出せる）ことも書く。
  2. 手元フォルダ `/Users/nariiwa/Projects/webcad-planner` の git 管理外の置き場: `scratch/`（365MB、5月の Unity レンダと8月の車の試作）、`output/`（217MB、9月の AI レンダと動画）、`.superpowers/sdd`（91MB）。
  3. PR が MERGED か CLOSED で、変更を抱えていないローカルブランチ約55本と、worktree 4つ（`dreamy-shamir-2b1b5d`、`implementation-handoff-cd3850`、`plan-compat-golden`、`/Users/nariiwa/Projects/webcad-sample-fix`）。変更を抱えた worktree（`skip-floor-multiple-add-e12a1e` の16件など）は対象にしない。
- [ ] **Step 2:** 答えどおりに行う。ブランチの削除は `git branch -D` を一覧どおりに行い、リモートのブランチには触らない。
- [ ] **Step 3:** PR の説明に、消したもの・残したもの・理由を書いて更新する。
