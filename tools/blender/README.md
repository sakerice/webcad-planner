# Blender コンテキストモデル制作パイプライン

`assets/models/context/*.glb`(隣家・周辺ビル・車・自転車・電柱)を
Blenderで生成・更新するためのスクリプト一式。

## ファイル構成

| ファイル | 役割 |
|---|---|
| `context_models.blend` | 全モデルを含む作業用シーン(プレビュー用ライト/カメラ入り) |
| `house_kit_build.py` | **隣家パーツキット**(nh_seg_*/nh_corner/nh_balcony ほか)。単体で実行するとGLB書き出しまで行う |
| `bldg_build.py` | 周辺ビル(bd_*: base/mid/top) |
| `car_build.py` | 白セダン(car_*)。カローラE210実寸(4495×1745×1435/WB2640)参照 |
| `bike_build.py` / `fbike_build.py` | ママチャリ / 折りたたみ自転車 |
| `pole_build.py` | 電柱 |
| `export_glbs.py` | 全モデルをGLBへエクスポート(モジュール用エンプティへ自動親子付け) |
| `car_meshy_reduce.py` | **Meshy製ハッチバック**(高密度メッシュ)をリダクションして `car_hatchback.glb` を書き出す |
| `blender_mcp_addon.py` | Blenderに入れるソケットアドオン(port 9876, blenderMCP互換) |
| `blender_startup.py` | GUI起動時にアドオンを読み込むスタートアップ |
| `bmcp.py` | アドオンへコードを送るCLIクライアント |
| `render/*.py` | 各モデルのプレビューレンダー(出力先: `$WEBCAD_RENDER_OUT` または `/tmp/webcad-render/`) |

## ワークフロー

### 隣家(neighbor_house_kit.glb)

隣家だけは一体モデルではなく**実寸パーツキット**として書き出す。
アプリ側(`index.html` の NEIGHBOR HOUSE KIT セクション)が 910mm(1P)
グリッドにパーツを並べて組み立てるため、隣家のサイズを変えても
サッシ・玄関ドア・シャッター・バルコニー・軒の出は実寸のまま保たれる。

GUIもMCPも不要で、`bpy` モジュール(PyPI)さえあれば単体で走る。

```bash
pip install bpy                                  # Blender 4.2 / Python 3.11
python3 tools/blender/house_kit_build.py         # 組み立て → GLB書き出し
python3 tools/blender/house_kit_build.py --no-export   # 寸法確認のみ
```

パーツ名(`nh_seg_win_l` など)と原点の約束は `index.html` の
`NH_SEG_PART` / `nhAttach()` と一対一で対応している。**名前と原点を
変えるときは必ず両方を直すこと。**

### その他のモデル(車・周辺ビル・自転車・電柱)

```bash
# 1. Blender(GUI)をアドオン付きで起動しておく
/Applications/Blender.app/Contents/MacOS/Blender tools/blender/context_models.blend \
  --python tools/blender/blender_startup.py &

# 2. ビルドスクリプトを流す(モデルを作り直す)
python3 tools/blender/bmcp.py code tools/blender/car_build.py

# 3. プレビューレンダーで確認
python3 tools/blender/bmcp.py code tools/blender/render/car_render.py

# 4. GLBへエクスポート
python3 tools/blender/bmcp.py code tools/blender/export_glbs.py

# 5. .blendを保存
echo "import bpy; bpy.ops.wm.save_as_mainfile(filepath='$(pwd)/tools/blender/context_models.blend')" \
  | python3 tools/blender/bmcp.py code /dev/stdin
```

### Meshy製ハッチバック(car_hatchback.glb)

`car_build.py` の白セダンとは別系統。Meshyが出力した約197万トライアングル
+ 2048px テクスチャ3枚のモデルを、Web配信できる約6万トライアングルへ落とす。

```bash
# 1. Meshy の .glb / .blend を開いた Blender をアドオン付きで起動しておく
# 2. リダクション + GLB書き出し
python3 tools/blender/bmcp.py code tools/blender/car_meshy_reduce.py
# 3. テクスチャ1024px化 + WebP + Draco圧縮
./tools/slim_car_hatchback.sh
# 4. ブラウザで既存セダンと見比べる(scratch/ はGit管理外)
python3 tools/dev_server.py 8945   # → http://localhost:8945/scratch/car-compare.html
```

押さえておくこと:

- **ポリゴンを削りすぎると造形が溶ける。** 3万トライアングルまで落とすと
  パネルの合わせ目・窓枠・テールランプが消える。元メッシュは完全にクリア
  なので、これは常にデシメートのやりすぎが原因。**平滑化で誤魔化さないこと**
  (造形が余計に溶ける)。6万 + 吸着/法線転写でほぼ元どおりになる。
- **デシメート後は元メッシュへ Shrinkwrap で吸着させ、法線を Data Transfer
  で転写する。** 間引きは頂点を元の面から1mm以下だけ浮き沈みさせるが、
  光沢のあるボディを浅い角度から見ると効いてくる。ポリゴンを増やすより安い。
- **「表面が細かく波打つ」ように見えたら、まずビューア側のシャドウを疑う。**
  平行光源に `shadow.bias` / `normalBias` を入れていないと、セルフシャドウの
  モアレ(shadow acne)がボディ全面に出て、メッシュの欠陥と見分けがつかない。
  `index.html` は `bias=-0.00018` / `normalBias=0.018` を設定済み。
  `scratch/car-compare.html` でこれを入れ忘れて、モデル側を何時間も疑った。
#### テクスチャを外せない理由(検討済み・不採用)

「UVもテクスチャも捨てて、既存セダンと同じ単色マテリアルの塗り分けにする」
案を実装して捨てた。**このモデルは塗装・ガラス・黒樹脂の区別をテクスチャ
しか持っておらず、ジオメトリ側に境目が無い。** 具体的には:

- 窓ガラスには空の映り込みが焼き込まれている。色だけ見ると青くて明るく、
  塗装と区別がつかない。窓の中に白い三角形が散る。
- 窓枠の折れ角はデシメート後だと緩い箇所があり、折れ線で囲んで塗りつぶす
  方法(クリースパッチ / シードからの領域拡張)はどちらも漏れる。ガラスが
  ルーフやドアまで広がるか、逆にガラスがボディに飲まれるかのどちらか。
- 単色マテリアルにすると境界が三角形単位になり、ふちがギザつく。境界を
  またぐ辺だけ細分して対処したが、6万→8.6万トライアングルに増えたうえ
  上記の誤分類は消えない。

QuadriFlow によるリトポロジーも試した。2万クアッド(描画コストは約4万
トライアングル相当)で、同コストのデシメート版より明らかに造形が溶ける。
デシメートは曲率の高いところへポリゴンを集めるので、この用途では強い。

結論として、テクスチャ(実質はマスク)を持たせたまま `色 × テクスチャ` で
塗り分けるのが、このモデルでは唯一まともに動く方法。

- **ボディ塗装面はテクスチャの彩度で機械的に切り出している。** ベースカラー
  テクスチャ上で塗装だけが青(彩度0.6)、窓・タイヤ・グリル・メッキは無彩色
  という前提に依存する。塗装が無彩色(白/黒/グレー)のMeshyモデルには
  そのままでは使えない。赤いテールランプを巻き込まないよう「青 > 赤」も
  条件に入れている。
- **CarBody と CarDetail は同じベースカラーテクスチャを共有する。**
  塗装/トリムの見た目の境界はテクスチャ(ピクセル単位)が持ち、マテリアル
  分割は「色変更が効くかどうか」だけを決める。分割で境界を作ると三角形の
  形にギザついてどうにもならない。書き出し時にテクスチャの塗装部分は
  白基調のグレースケールへ置換してあるので、`色 × テクスチャ` で
  指定色がそのまま出る。
- **この方式は `index.html` の `applySelectableColor()` に依存する。**
  同関数はテクスチャ付きマテリアルを色変更の対象外にするが、
  `userData.tintMap` が立っているものだけ例外にしてある。フラグは
  `configureCarGlbMaterials()` が `CarBody` に立てる。
  **マテリアル名を変えると色変更が効かなくなる。**
- Meshy(glTF)由来のオブジェクトは `rotation_mode` が `QUATERNION` のことがあり、
  `rotation_euler` への代入が黙って無視される。向きを変える処理では必ず
  `rotation_mode = 'XYZ'` を先に入れる。
- 車の前は glTF の -Z。既存 `car_sedan.glb` と揃っていないと、アプリ上で
  車だけ真横を向く。`stage_join_and_place()` に assert を入れてある。

## 注意点(ハマりどころ)

- **GLB更新後は `index.html` の `MODEL_ASSET_VER` を必ず+1する。**
  ブラウザHTTPキャッシュ対策。忘れると本番ユーザーに旧モデルが表示され続ける。
- **glTFエクスポーターは `matrix_parent_inverse` を無視する。**
  エンプティへ親子付けするメッシュは、頂点データを `data.transform()` で
  アンカー基準ローカルへベイクし、子のローカル変換はゼロにすること
  (`house_kit_build.py` の `anchor_parts()` は全パーツの変換を適用して
  この問題自体を避けている)。
- **`matp()` はマテリアルを名前で再利用するため、過去に設定した
  Emission等の入力が残存する。** 再定義時は Emission Strength=0 を明示する。
- 周辺ビルはアプリ側でフロア数に応じて bd_base/bd_mid/bd_top を積み上げるため、
  ノード名は変更しないこと。
- **隣家パーツは絶対にスケールされない前提で作る。** 幅が910の倍数でない
  パーツを足すとベイ割りに載らない。無地パネルだけは端数吸収のため
  横方向にスケールされる。
- **外壁テクスチャに方向性のある模様(横目地・縦目地・うねり)を入れないこと。**
  端数吸収でスケールした端部ベイだけ模様のピッチが変わり、縞がずれて見える。
  外壁は等方な微粒子ノイズのみ(`make_wall_image`)。
