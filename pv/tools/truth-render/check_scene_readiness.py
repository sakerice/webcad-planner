#!/usr/bin/env python3
"""instance/ ガイドから、GLB家具が実際に描画されていたかを検証する。

## 何のためのチェックか

家具はブラウザ側で GLTFLoader により非同期に読み込まれる
(index.html の ensureGltfModel / _modelLoading 参照)。capture-runner.mjs 側に
「読み込み待ち」を足しても、その待ちが不十分・タイムアウト・将来の変更で
壊れる可能性は残る。このスクリプトはその待ちとは完全に独立に、出力された
ピクセルだけを見て「本当に家具が写っていたか」を事後検証する、最後の砦。

## 何を数えるか、そしてなぜ (v2: 色一致ではなく面積で見る)

最初のバージョンは「legend が宣言する各家具インスタンスの色が instance/
フレームのどこかに厳密一致で写っているか」を数えていた。これは実際には
機能しなかった: pv/renders/T91-ldk-push (読み込み待ちが効いて家具が
frame 0 から映っている、正しいレンダ) で検証すると 0/32 で FAIL していた。
instance/*.png を直接目視すると、GLB家具は legend が宣言する色ではなく
**単色の黒 (0,0,0)** で描かれている。壁・部屋・照明・窓など GLB を経由しない
プロシージャル生成物は宣言色と厳密一致する (実測で確認済み)。つまり
「家具インスタンスは instance ガイド上で declare された固有色になる」という
前提そのものが GLB 家具については成立していなかった -- これは
capture-runner.mjs 側の読み込み待ちとは無関係な、instance ガイド生成側の
別の未解決の色付けの癖であり、この検証コードの守備範囲外 (index.html は
このタスクでは変更しない)。旧実装はこの癖のせいで「家具が揃っている
run」でも「家具が全く無い run」でもほぼ同じ 0〜数 % しか報告できず、
実質的に何も見分けていなかった。

そこで v2 は色の厳密一致をやめ、**面積の消去法**で家具の存在を見る:
  1. legend が宣言する「家具ではない」インスタンス (壁・部屋・照明・窓・
     階段等) の色集合を求める。これらは同期的に存在し、captureInstance3DData
     (index.html) が漏れなく単色化することを実測で確認済み。
  2. 背景色 (index.html: sc3.background = 0xffffff) と、この非家具色集合の
     どちらにも一致しないピクセルの面積比を「家具に帰属できる面積」とする。
     背景でも壁でも部屋でも照明でも窓でもないのに写っているものは、この
     シーンで残る唯一のカテゴリ = 非同期ロードされる GLB 家具でしかあり
     得ない。家具自身の宣言色が(将来 instance ガイド側の癖が直って)正しく
     出力されるようになった場合もこの面積に含まれる -- 家具の宣言色は
     "非家具色集合" に入らないため、この定義は色一致・黒塗りのどちらの
     実装でも壊れない。

## フレーム間の見方: 「一度でも」ではなく「最初の方から」

旧実装は撮影された全フレームの和集合で「一度でも写ったか」を見ていた
(カメラのパン・オクルージョン解消で特定フレームだけ写る/写らないという
正当な変化を、個別フレーム単位では問題にしないため)。これは面積ベースの
判定にも引き継ぎたい発想だが、実際に壊れたケースの実測データに対しては
和集合だけでは不十分と分かった: 壊れたレンダでは「エッジ密度が最初は
未装飾の部屋相当 (7007) のまま推移し、家具の非同期ロードが完了した
ごく終盤になって家具相当の水準 (~18800) へ跳ね上がる」という形で家具が
"最終的には" 現れていた。そのフレームだけを見れば和集合チェックは
PASS してしまい、まさに検出したい「撮影開始時点で家具の読み込みが
終わっていなかった」事故を見逃す。

そのため v2 は「撮影全体の先頭 ~20% (最低1フレーム) の中で、家具に
帰属できる面積が閾値を超えるフレームが少なくとも1つあるか」を見る。
これは「読み込みが撮影開始前に完了していたか」という本来の問いに直接
答える形になっている: 完了していれば最初の方のフレームから家具面積が
乗っているはずで、間に合っていなければ最初の方のフレームは(壁だけの)
低い面積のまま推移するはず。

カメラのパンによる「特定の家具インスタンスだけが特定フレームで
見切れる/隠れる」という正当な変化にこの判定が誤反応しないのは、
判定対象が個々の家具の色一致ではなく「家具全体に帰属する面積の
集計値」だからである。実測 (T91-ldk-push, 9枚の instance フレーム) では
先頭付近から終盤にかけて 23%〜47% の範囲で緩やかに増減しており、
これは同一の閾値 (後述) に対して終始大きく余裕を持って超過する
一方、アンチエイリアスの縁だけによるノイズ (同じフレームで実測
0.14% 程度) とは 2桁以上の差がある。

## 閾値の根拠

- FURNITURE_MASS_THRESHOLD = 5%: 実測ノイズ床 (縁のアンチエイリアスのみ、
  0.14%) の約36倍上、実際に家具が揃った run の最小観測値 (23.4%) の
  約1/5 に取っており、両側に十分な余裕がある。
- EARLY_WINDOW_FRACTION = 20% (最低1フレーム): 壊れたレンダの実測
  (エッジ密度の跳ね上がりが撮影のごく終盤だった) に基づく。先頭
  ~20%のどこにも家具面積が乗っていなければ、撮影開始時点で家具の
  読み込みが終わっていなかったとみなす。

## 既知の限界

このチェックは「壁・部屋・照明・窓等の非家具インスタンスは同期的に
存在し必ず正しく単色化される」という、T91-ldk-push での実測に基づく
前提に依存している。仮に将来、家具以外の何らかのオブジェクト種別が
同様に単色化されない/legend化されない状況が生じた場合、そのオブジェクトの
面積も「家具に帰属する面積」として誤ってカウントされ得る (=
本チェックは家具の非表示を見逃す方向にしか間違えない実装ではない点に
注意)。また、意図的に「部屋に入る前の廊下など家具が全く写らない前半」
を持つ正当なショットがもし将来存在するなら、このチェックは誤って
FAIL する。今回の対象ショット (家具のある部屋へ押し込むカメラワーク)
にはそのような区間はなく、実測でも先頭フレームから家具面積が乗っている。

使い方: python3 pv/tools/truth-render/check_scene_readiness.py pv/renders/<shot-id>
"""
import json
import math
import re
import sys
from pathlib import Path

from PIL import Image

GLB_FURNITURE_TYPE_RE = re.compile(r'^(fmp-|im0261-)')
BACKGROUND_RGB = (255, 255, 255)  # index.html captureInstance3DData(): sc3.background = 0xffffff
FURNITURE_MASS_THRESHOLD = 0.05  # 根拠はモジュール docstring 参照(ノイズ床の約36倍上、実測家具面積の約1/5)。
EARLY_WINDOW_FRACTION = 0.2  # 撮影全体の先頭何割を「開始時点」とみなすか。根拠はモジュール docstring 参照。


def furniture_entries(legend):
    return [e for e in legend.get('instances', [])
            if GLB_FURNITURE_TYPE_RE.match(e.get('type') or '')]


def legend_color_rgb(entry):
    hexcolor = entry['color'].lstrip('#')
    return tuple(int(hexcolor[i:i + 2], 16) for i in (0, 2, 4))


def non_furniture_declared_colors(legend):
    """この run の legend が宣言する、GLB家具*ではない*インスタンスの色集合。

    壁・部屋・照明・窓・階段等プロシージャル生成物は同期的に存在し、
    captureInstance3DData (index.html) が漏れなく単色化する(実測で確認
    済み)。この集合に含まれないピクセルは、家具に帰属できる。
    """
    return {legend_color_rgb(e) for e in legend.get('instances', [])
            if not GLB_FURNITURE_TYPE_RE.match(e.get('type') or '')}


def furniture_mass_fraction(png_path, non_furniture_rgbs, background_rgb=BACKGROUND_RGB):
    """png_path のうち、背景でも非家具の宣言色でもないピクセルの面積比 (0.0〜1.0)。"""
    im = Image.open(png_path).convert('RGB')
    w, h = im.size
    total = w * h
    if total == 0:
        return 0.0
    colors = im.getcolors(maxcolors=total) or []
    explained = sum(count for count, rgb in colors
                     if rgb == background_rgb or rgb in non_furniture_rgbs)
    return (total - explained) / total


def check_scene_readiness(shot_dir, mass_threshold=FURNITURE_MASS_THRESHOLD,
                           early_window_fraction=EARLY_WINDOW_FRACTION):
    """(ok, message) を返す。副作用なし・ファイルは一切書かない。"""
    shot_dir = Path(shot_dir)
    legend_path = shot_dir / 'instance-legend.json'
    if not legend_path.exists():
        return True, 'no instance-legend.json; nothing to check (this shot did not capture the instance guide)'

    legend = json.loads(legend_path.read_text())
    furniture = furniture_entries(legend)
    if not furniture:
        return True, 'legend declares no GLB-backed furniture instances (type fmp-*/im0261-*); nothing to check'

    instance_dir = shot_dir / 'instance'
    frames = sorted(instance_dir.glob('*.png')) if instance_dir.exists() else []
    if not frames:
        return False, (
            f'legend declares {len(furniture)} GLB furniture instance(s) but no instance/ '
            'frames were captured at all')

    non_furniture_rgbs = non_furniture_declared_colors(legend)
    fractions = [furniture_mass_fraction(f, non_furniture_rgbs) for f in frames]

    early_count = max(1, math.ceil(len(frames) * early_window_fraction))
    early_fractions = fractions[:early_count]
    early_peak = max(early_fractions)
    run_peak = max(fractions)

    if early_peak < mass_threshold:
        return False, (
            f'scene readiness FAIL: GLB furniture pixel coverage reaches only {early_peak:.1%} of '
            f'frame area across the first {early_count}/{len(frames)} captured instance frame(s) '
            f'(threshold {mass_threshold:.0%}), even though the legend declares {len(furniture)} '
            f'GLB furniture instance(s) for this run (run-wide peak coverage: {run_peak:.1%}). This '
            f'matches the signature of furniture GLBs that had not finished loading when capture began.')

    return True, (
        f'scene readiness OK: GLB furniture pixel coverage reaches {early_peak:.1%} of frame area '
        f'within the first {early_count}/{len(frames)} captured instance frame(s) (threshold '
        f'{mass_threshold:.0%}), consistent with {len(furniture)} declared GLB furniture instance(s) '
        f'having finished loading before capture began (run-wide peak coverage: {run_peak:.1%}).')


def main():
    if len(sys.argv) < 2:
        print('usage: check_scene_readiness.py <shot-render-dir>', file=sys.stderr)
        return 2
    ok, message = check_scene_readiness(sys.argv[1])
    prefix = 'PASS' if ok else 'FAIL'
    stream = sys.stdout if ok else sys.stderr
    print(f'{prefix} {message}', file=stream)
    return 0 if ok else 1


if __name__ == '__main__':
    raise SystemExit(main())
