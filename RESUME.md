# セッション再開手順（ターミナル再起動後）

## 前提
- Terminal に Full Disk Access を付与してから再起動
- 作業ディレクトリ: `~/Documents/GitHub/webcad-planner`

---

## Step 1: 現状確認

```bash
cd ~/Documents/GitHub/webcad-planner
git log --oneline -8
```

以下のコミットがあれば Tasks 1, 2 は完了済み:
- `dad48d7` feat: update 2D color scheme to architectural drawing style
- `d14b05e` feat: update item default sizes to Japanese housing standards

---

## Step 2: Tasks 3〜5 の適用確認（サブエージェントが編集したが未検証）

```bash
grep -c "function drawHatch" index.html        # Task 3: 1 なら適用済み
grep -c "tatami.toFixed" index.html            # Task 4: 1 なら適用済み
grep -c "lineWidth=1.2" index.html             # Task 5: 1 なら適用済み（引き戸）
```

**0 が返ってきたタスクは未適用** → Step 2b を実行

### Step 2b: 未適用タスクを個別に適用

**Task 3 が未適用の場合（外壁ハッチング）:**
```bash
python3 scripts/apply_task3.py   # ← Step 4 で作成
```

**Task 4 が未適用の場合（畳数表示）:**
```bash
python3 scripts/apply_task4.py
```

**Task 5 が未適用の場合（JIS建具記号）:**
```bash
python3 scripts/apply_task5.py
```

---

## Step 3: Tasks 8〜11 を一括適用（必須）

```bash
python3 scripts/patch_index.py
```

出力例（全て ✓ になること）:
```
Patched: .../index.html
  ✓ Task 8: GLTF_MAP expanded to 12 entries
  ✓ Task 9a: pbrTex helpers added
  ✓ Task 9b: floor PBR texture applied
  ✓ Task 9c: wall siding texture applied
  ✓ Task 10a: RGBELoader CDN script added
  ✓ Task 10b: PMREMGenerator HDR init added
  ✓ Task 11a: fitShadowCamera added
  ✓ Task 11b: fitShadowCamera call added to rebuild3D
  ✓ Task 11c: SAO params tuned
  ✓ Task 11d: Bloom tuned
```

---

## Step 4: アセット生成

```bash
# 依存ライブラリ
pip install Pillow numpy pygltflib -q

# PBRテクスチャ 11枚 → assets/textures/
python3 scripts/gen_textures.py

# 家具GLB 12種 → assets/models/
python3 scripts/gen_models.py

# HDR環境マップ → assets/env/
mkdir -p assets/env
curl -L "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/venice_sunset_1k.hdr" \
     -o assets/env/outdoor.hdr
ls -lh assets/env/outdoor.hdr   # ~800KB であること
```

---

## Step 5: git コミット

```bash
git add -A
git commit -m "feat: quality enhancement - JIS standards, PBR textures, HDR env map, GLB models"
git log --oneline -6
```

---

## Step 6: Cloudflare Pages へデプロイ

```bash
git push origin main
```

デプロイ確認: https://cad-planner.srapps.us

---

## Step 7: 品質チェック（ブラウザ）

- [ ] 2D: 外壁に斜線ハッチングが表示される
- [ ] 2D: 部屋に「14.0畳 / 22.7㎡」が自動表示される
- [ ] 2D: 引き戸がレール2本線、窓が3本平行線
- [ ] 3D: 床に木目テクスチャ、外壁にサイディング
- [ ] 3D: 環境マップ反射（コンソールに `[WebCAD] HDR environment map loaded`）
- [ ] 3D: ソファ・ベッド等 GLB モデルが表示される
- [ ] モバイル: Safari/Chrome iOS で動作確認

品質不足の場合 → Unity WebGL ハイブリッド方式に移行（設計書参照）

---

## 参照ファイル

- 設計書: `docs/superpowers/specs/2026-05-12-threejs-quality-enhancement-design.md`
- 実装計画: `docs/superpowers/plans/2026-05-12-quality-enhancement.md`
- セーフティタグ: `git checkout pre-quality-enhancement` で作業前に戻れる
