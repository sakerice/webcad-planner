#!/usr/bin/env python3
"""instance/ ガイドから、GLB家具が実際に描画されていたかを検証する。

## 何のためのチェックか

家具はブラウザ側で GLTFLoader により非同期に読み込まれる
(index.html の ensureGltfModel / _modelLoading 参照)。capture-runner.mjs 側に
「読み込み待ち」を足しても、その待ちが不十分・タイムアウト・将来の変更で
壊れる可能性は残る。このスクリプトはその待ちとは完全に独立に、出力された
ピクセルだけを見て「本当に家具が写っていたか」を事後検証する、最後の砦。

## 何を数えるか、そしてなぜ

instance ガイドは各インスタンスを instance-legend.json が declare する
唯一の色でベタ塗りする (index.html captureInstance3DData: MeshBasicMaterial +
toneMapped:false、アンチエイリアスの縁を除けば厳密一致するフラット色)。
GLB由来の家具インスタンスは legend 上の type が "fmp-" または "im0261-" で
始まる(index.html 内 FMP_CATALOG 等のカタログ命名規約。ensureGltfModel が
実際にロードするURLもこの type から導出される)。壁・部屋・窓・照明・階段等は
GLBを経由しないプロシージャル生成なので対象に含めない -- 対象を家具に絞るのは、
壁が「カメラが近づくにつれ画角から外れて減っていく」のは正常な現象であり、
それを家具の欠落と混同しないため。

判定は「一枚のフレームで欠けているか」ではなく、撮影された全フレームに
わたる**和集合**で「一度でも写ったか」を見る。理由:
  - カメラが動けば、パン・オクルージョン解消などで特定フレームだけ写る/
    写らないという正当な変化が普通に起こる。本チェックはそれを個別フレーム
    単位では一切問題にしない (early/late のフレーム間比較はしない)。
  - しかし「宣言されている家具のほぼ全部が、撮影全体を通じて一度も
    一ピクセルも描かれない」は、正当なフレーミングでは起こりにくい規模の
    欠落であり、非同期ロードが撮影終了までに一度も終わらなかった場合に
    一致する。実際に壊れた pv/renders/T91-ldk-push では、宣言された32件の
    GLB家具のうち写ったのは最大1件(107,910px)のみで、それも最初の1枚
    限りだった。カバレッジ 20% という閾値は、この 1/32 (~3%) を明確に
    捉えつつ、「一部の部屋の家具だけを映すクローズアップショット」のような
    正当な低カバレッジ運用に対しても十分に緩い値として選んでいる
    (立証はできないが、根拠のない厳しい閾値よりは安全側)。

使い方: python3 pv/tools/truth-render/check_scene_readiness.py pv/renders/<shot-id>
"""
import json
import re
import sys
from pathlib import Path

from PIL import Image

GLB_FURNITURE_TYPE_RE = re.compile(r'^(fmp-|im0261-)')
MIN_PIXELS = 16  # アンチエイリアスの縁だけで「写った」と誤判定しないための下限。
COVERAGE_THRESHOLD = 0.2  # 実データ(1/32 ≈ 3%)を明確に捉えつつ、正当な低カバレッジ運用を許す緩さ。


def furniture_entries(legend):
    return [e for e in legend.get('instances', [])
            if GLB_FURNITURE_TYPE_RE.match(e.get('type') or '')]


def legend_color_rgb(entry):
    hexcolor = entry['color'].lstrip('#')
    return tuple(int(hexcolor[i:i + 2], 16) for i in (0, 2, 4))


def colors_present_in_frame(png_path, candidate_rgbs, min_pixels=MIN_PIXELS):
    """png_path 内で、candidate_rgbs のうち min_pixels 以上の面積で写っている色の集合。"""
    im = Image.open(png_path).convert('RGB')
    counts = {}
    for count, rgb in (im.getcolors(maxcolors=4_000_000) or []):
        counts[rgb] = count
    return {rgb for rgb in candidate_rgbs if counts.get(rgb, 0) >= min_pixels}


def check_scene_readiness(shot_dir, coverage_threshold=COVERAGE_THRESHOLD, min_pixels=MIN_PIXELS):
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

    candidates = {legend_color_rgb(e): e for e in furniture}
    seen = set()
    for frame in frames:
        seen |= colors_present_in_frame(frame, candidates.keys(), min_pixels)

    coverage = len(seen) / len(candidates)
    if coverage < coverage_threshold:
        missing_types = sorted({candidates[rgb]['type'] for rgb in candidates if rgb not in seen})
        sample = ', '.join(missing_types[:8])
        if len(missing_types) > 8:
            sample += f', ... (+{len(missing_types) - 8} more)'
        return False, (
            f'scene readiness FAIL: only {len(seen)}/{len(candidates)} ({coverage:.0%}) declared '
            f'GLB furniture instances ever appear across {len(frames)} captured instance frame(s) '
            f'(threshold {coverage_threshold:.0%}). This matches the signature of furniture GLBs '
            f'that never finished loading before capture completed. Missing: {sample}')

    return True, (
        f'scene readiness OK: {len(seen)}/{len(candidates)} ({coverage:.0%}) declared GLB furniture '
        f'instances appear across {len(frames)} captured instance frame(s)')


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
