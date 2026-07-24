# Blender コンテキストモデル制作パイプライン

`assets/models/context/*.glb`(隣家・周辺ビル・車・自転車・電柱)を
Blenderで生成・更新するためのスクリプト一式。

## ファイル構成

| ファイル | 役割 |
|---|---|
| `context_models.blend` | 全モデルを含む作業用シーン(プレビュー用ライト/カメラ入り) |
| `house_build.py` | 隣家(nh_*: base/mid/roof + 独立ノードnh_balc) |
| `bldg_build.py` | 周辺ビル(bd_*: base/mid/top) |
| `car_build.py` | 白セダン(car_*)。カローラE210実寸(4495×1745×1435/WB2640)参照 |
| `bike_build.py` / `fbike_build.py` | ママチャリ / 折りたたみ自転車 |
| `pole_build.py` | 電柱 |
| `export_glbs.py` | 全モデルをGLBへエクスポート(モジュール用エンプティへ自動親子付け) |
| `blender_mcp_addon.py` | Blenderに入れるソケットアドオン(port 9876, blenderMCP互換) |
| `blender_startup.py` | GUI起動時にアドオンを読み込むスタートアップ |
| `bmcp.py` | アドオンへコードを送るCLIクライアント |
| `render/*.py` | 各モデルのプレビューレンダー(出力先: `$WEBCAD_RENDER_OUT` または `/tmp/webcad-render/`) |

## ワークフロー

```bash
# 1. Blender(GUI)をアドオン付きで起動しておく
/Applications/Blender.app/Contents/MacOS/Blender tools/blender/context_models.blend \
  --python tools/blender/blender_startup.py &

# 2. ビルドスクリプトを流す(モデルを作り直す)
python3 tools/blender/bmcp.py code tools/blender/house_build.py

# 3. プレビューレンダーで確認
python3 tools/blender/bmcp.py code tools/blender/render/house_render.py

# 4. GLBへエクスポート
python3 tools/blender/bmcp.py code tools/blender/export_glbs.py

# 5. .blendを保存
echo "import bpy; bpy.ops.wm.save_as_mainfile(filepath='$(pwd)/tools/blender/context_models.blend')" \
  | python3 tools/blender/bmcp.py code /dev/stdin
```

## 注意点(ハマりどころ)

- **GLB更新後は `index.html` の `MODEL_ASSET_VER` を必ず+1する。**
  ブラウザHTTPキャッシュ対策。忘れると本番ユーザーに旧モデルが表示され続ける。
- **glTFエクスポーターは `matrix_parent_inverse` を無視する。**
  エンプティへ親子付けするメッシュは、頂点データを `data.transform()` で
  アンカー基準ローカルへベイクし、子のローカル変換はゼロにすること
  (`house_build.py` の nh_balc 処理が実装例)。
- **`matp()` はマテリアルを名前で再利用するため、過去に設定した
  Emission等の入力が残存する。** 再定義時は Emission Strength=0 を明示する。
- 家・ビルはアプリ側でフロア数に応じて base/mid/roof(top) を積み上げるため、
  ノード名は変更しないこと。バルコニー(nh_balc)は伸縮に追従させない独立ノード。
