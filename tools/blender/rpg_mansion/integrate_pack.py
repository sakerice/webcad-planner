"""Codex が納めた洋館セットを、本番のカタログに載せられる形へ取り込む。

    python3 tools/blender/rpg_mansion/integrate_pack.py <納品物を取り出したディレクトリ>

納品物（PR #83、codex/pr81-mansion-assets-20261008 の 71ee491c）は、1点ごとに約100項目の
検証用データを manifest に書き込み、途中経過のファイルも含めて 500MB を超える。そのまま
本番に入れると、サイトを開くたびに 1.1MB の manifest を全員が読み、リポジトリも重くなる。

ここでは次のように取り込む。
- サイト用: モデル(GLB)全点と、縮小画像・平面図用の画像。画像は 256 色に減色して軽くする
  （512px の縮小画像は 1/10 以下になり、見た目は並べても見分けが付かない）
- manifest: カタログに要る項目だけ。英語の名前は日本語に、標準の分類(kind)が当てはまる物には付ける
- 制作の元: 1点につき編集できる .blend 1つ、作るスクリプト、正面・背面の確認画像(JPEG)、検証の記録。
  1点ごとの対応は tools/blender/rpg_mansion/catalogue-sources.json
- それ以外（途中の保存、別案、検証の画像の全部）は取り込まない。納品物のコミットに残っている

**出荷済みの素材は差し替えない。** 本番に出た ID は、利用者のプランが名前で持っている。
作り直した版は別の ID で足し、元の ID はカタログから外して（retired）描画用に残す。
"""
import hashlib
import json
import os
import shutil
import subprocess
import sys

from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
PACK = 'assets/models/packs/rpg-mansion'
TOOLS = 'tools/blender/rpg_mansion'
SRC = os.path.abspath(sys.argv[1])

# 本番に出た版を残し、作り直した版を別 ID で足す（出荷済みの素材は凍結）
REMADE = {'rpg-mansion-sofa-01': 'rpg-mansion-sofa-02', 'rpg-mansion-wing-chair-01': 'rpg-mansion-wing-chair-02'}

# 画面に出す名前。納品物で英語のままだった物
NAMES = {
    'paneled-wall-bay-01': '腰板張りの壁ユニット 1200',
    'rectangular-doorway-bay-01': '四角い開口の壁ユニット 1800',
    'paneled-return-corner-01': '腰板張りの入隅・出隅',
    'slate-gable-span-01': 'スレート切妻屋根ユニット',
    'gable-end-closure-01': '切妻の妻壁',
    'stone-cornice-straight-01': '石の軒蛇腹 1200',
    'stone-cornice-corner-01': '石の軒蛇腹 コーナー',
    'tuscan-support-column-01': 'トスカナ式の柱 3000',
    'plain-plaster-bay-01': '漆喰の壁ユニット 1200',
    'plain-plaster-filler-600-01': '漆喰の壁ユニット 600',
    'exterior-return-corner-01': '漆喰の外壁コーナー',
    'arched-doorway-bay-01': '石のアーチ開口の壁ユニット 1800',
    'raised-sill-fixed-window-bay-01': '腰窓付きの壁ユニット 1200',
    'herringbone-parquet-tile-01': 'ヘリンボーン寄木の床 1200角',
    'coffered-ceiling-panel-01': '格天井のパネル 1200角',
    'mansard-roof-span-01': 'マンサード屋根ユニット',
    'mansard-hipped-end-01': 'マンサード屋根の寄棟端部',
    'garden-multistem-deciduous-tree-01': '株立ちの落葉樹',
    'garden-broad-canopy-tree-01': '枝の広がる庭木',
    'garden-low-shrub-border-01': '低木の植え込み',
    'garden-lattice-fence-bay-01': '格子フェンス',
    'garden-fence-terminal-half-post-01': 'フェンスの端の柱',
    'garden-fence-corner-adapter-01': 'フェンスのコーナー柱',
    'garden-two-riser-deck-step-01': 'デッキの2段ステップ',
    'garden-brick-gate-pier-01': 'レンガの門柱',
    'garden-fan-palm-planter-01': 'ヤシの鉢植え',
    'garden-wall-window-flower-box-01': '窓辺のフラワーボックス',
    'garden-tabletop-fern-01': '卓上のシダ',
    'garden-columnar-conifer-01': '円錐形の針葉樹',
    'garden-standpipe-drain-basin-01': '立水栓と水受け',
    'garden-horizontal-board-fence-01': '横板張りのフェンス',
    'garden-climbing-trellis-planter-01': 'つる植物のトレリス鉢',
    'ashlar-wall-bay-01': '切石積みの壁ユニット 1200',
    'rusticated-plinth-segment-01': '粗石の基壇 1200',
    'half-timbered-infill-bay-01': 'ハーフティンバーの壁ユニット 1200',
    'tall-fixed-french-window-bay-01': '背の高いフランス窓の壁ユニット 1200',
    'octagon-cabochon-floor-tile-01': '八角と小石の石張り床 1200角',
    'stone-wall-pilaster-01': '石の付け柱 3000',
    'stone-newel-post-01': '石の親柱 1100',
    'turned-stone-balustrade-01': '石の手すり（挽物の小柱） 900',
    'wrought-iron-railing-01': '鍛鉄の手すり 900',
    'portico-pediment-01': '玄関ポーチの三角破風',
    'slate-gable-hipped-end-01': 'スレート切妻屋根の寄棟端部',
    'standing-seam-conical-turret-roof-01': '塔の円錐屋根',
    'flat-parapet-roof-cap-01': 'パラペット付きの陸屋根',
    'standing-seam-lean-to-span-01': '片流れ屋根ユニット',
    'flat-parapet-chimney-host-01': 'パラペット付きの陸屋根（煙突用）',
    'hollow-brick-chimney-01': 'レンガの煙突',
    'fixed-shed-dormer-01': '片流れのドーマー窓',
    'gable-dormer-host-01': 'スレート切妻屋根（ドーマー用）',
    'short-paired-curtain-01': '丈の短い両開きカーテン',
    'full-height-traverse-drape-01': '天井高の片開きドレープ',
    'roman-batten-shade-01': '麻のローマンシェード',
    'timber-venetian-blind-01': '木製ブラインド',
    'narrow-roller-screen-01': '幅の狭い麻のロールスクリーン',
    'stair-flight-nine-riser-01': '木の直階段 9段（半階分）',
    'stair-flight-eighteen-riser-01': '木の直階段 18段（1階分）',
    'stair-square-supported-landing-01': '階段の踊り場（正方形）',
    'stair-return-supported-landing-01': '階段の折り返し踊り場',
    'stair-landing-guard-straight-01': '踊り場の手すり（直線）',
    'stair-landing-guard-corner-01': '踊り場の手すり（コーナー）',
    'stair-landing-guard-return-01': '踊り場の手すり（コの字）',
    'stair-guard-nine-riser-01': '階段の手すり 9段用',
    'stair-guard-eighteen-riser-01': '階段の手すり 18段用',
    'stair-terminal-receiver-newel-01': '手すりの端の親柱',
    'garden-supported-oak-terrace-01': 'オーク材のテラス',
    'garden-braced-oak-gate-leaf-01': 'オーク材の門扉',
    'garden-gate-strike-receiver-01': '門扉の受け金具',
    'fitted-six-panel-door-1200-01': '六枚パネルの木製扉（1200開口用）',
}

# 標準のカタログと同じ分類（tags.json の kinds）。入れると標準の見出しの下に混ざって並ぶ
KINDS = {
    'folding-tea-tray-table-01': 'low-table', 'baize-card-table-01': 'dining-table',
    'octagonal-center-table-01': 'dining-table', 'half-moon-console-01': 'counter-table',
    'pedestal-chess-table-01': 'low-table', 'three-tier-dumbwaiter-01': 'low-table',
    'bow-commode-01': 'chest', 'arched-vitrine-01': 'cabinet', 'slant-bureau-01': 'desk',
    'linen-press-01': 'closet', 'louver-cupboard-01': 'shoe-storage', 'open-etagere-01': 'shelf',
    'oval-pedestal-cabinet-01': 'cabinet', 'apothecary-chest-01': 'chest', 'blanket-coffer-01': 'chest',
    'glazed-credenza-01': 'cabinet', 'tambour-music-01': 'cabinet', 'arched-armoire-01': 'closet',
    'corner-vitrine-01': 'cabinet', 'map-flatfile-01': 'chest', 'letter-pigeonhole-01': 'shelf',
    'garden-standpipe-drain-basin-01': 'garden-equipment',
}

KEEP = ('id', 'name', 'group', 'category', 'kind', 'model', 'thumb', 'top', 'w', 'd', 'h',
        'defaultElevation', 'provenance', 'previewVersion', 'finishChannels')


def short(i):
    return i['id'].replace('rpg-mansion-', '', 1)


def rel(p):
    return os.path.relpath(p, ROOT)


def mm(v):
    v = float(v)
    return int(round(v)) if abs(v - round(v)) < 0.05 else round(v, 1)


def quantize(src, dst):
    im = Image.open(src).convert('RGBA')
    im.quantize(colors=256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.FLOYDSTEINBERG).save(dst, optimize=True)


def to_jpeg(src, dst):
    im = Image.open(src).convert('RGBA')
    bg = Image.new('RGB', im.size, 'white')
    bg.paste(im, mask=im.split()[3])
    bg.save(dst, quality=82, optimize=True)


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def main():
    delivered = json.load(open(os.path.join(SRC, PACK, 'manifest.json')))
    shipped = json.loads(subprocess.check_output(['git', 'show', 'origin/main:' + PACK + '/manifest.json'], cwd=ROOT))
    shipped_ids = {i['id'] for i in shipped['items']}
    kinds = json.load(open(os.path.join(ROOT, 'assets/models/tags.json')))['kinds']

    pack = os.path.join(ROOT, PACK)
    for sub in ('models', 'previews'):
        os.makedirs(os.path.join(pack, sub), exist_ok=True)
    tools = os.path.join(ROOT, TOOLS)

    # 制作の元: スクリプトと説明は全部（軽い）。.blend などは1点ごとに要る物だけ
    for dirpath, _, files in os.walk(os.path.join(SRC, TOOLS)):
        for f in files:
            if f.endswith(('.py', '.md', '.cjs')) or f == '.gitignore':
                s = os.path.join(dirpath, f)
                d = os.path.join(tools, os.path.relpath(s, os.path.join(SRC, TOOLS)))
                os.makedirs(os.path.dirname(d), exist_ok=True)
                if os.path.abspath(d) != os.path.abspath(__file__):
                    shutil.copy2(s, d)

    items, sources = [], {}
    for i in delivered['items']:
        iid = i['id']
        new_id = REMADE.get(iid, iid)
        out = {k: i[k] for k in KEEP if k in i and i[k] not in (None, '')}
        out['id'] = new_id
        s = short(i)
        if s in NAMES:
            out['name'] = NAMES[s]
        if not out.get('kind') and s in KINDS:
            out['kind'] = KINDS[s]
        if out.get('kind') and out['kind'] not in kinds:
            raise SystemExit(f'{iid}: 分類 {out["kind"]} が tags.json に無い')
        for k in ('w', 'd', 'h'):
            out[k] = mm(out[k])
        if out.get('defaultElevation'):
            out['defaultElevation'] = mm(out['defaultElevation'])
        else:
            out.pop('defaultElevation', None)
        out['provenance'] = 'original'
        for k, sub in (('model', 'models'), ('thumb', 'previews'), ('top', 'previews')):
            name = os.path.basename(i[k]).replace(iid, new_id, 1)
            dst = os.path.join(pack, sub, name)
            if k == 'model':
                shutil.copy2(os.path.join(SRC, i[k]), dst)
            else:
                quantize(os.path.join(SRC, i[k]), dst)
            out[k] = rel(dst)
        items.append(out)

        # 1点ごとの制作の元
        src_rec = {}
        for k in ('sourceBlend', 'validation'):
            if i.get(k):
                d = os.path.join(ROOT, i[k])
                os.makedirs(os.path.dirname(d), exist_ok=True)
                shutil.copy2(os.path.join(SRC, i[k]), d)
                src_rec[k] = i[k]
        for k in ('front', 'rear'):
            if i.get(k) and os.path.exists(os.path.join(SRC, i[k])):
                d = os.path.join(ROOT, os.path.splitext(i[k])[0] + '.jpg')
                os.makedirs(os.path.dirname(d), exist_ok=True)
                to_jpeg(os.path.join(SRC, i[k]), d)
                src_rec[k] = rel(d)
        if i.get('builder'):
            src_rec['builder'] = i['builder']
        src_rec['glbSha256'] = sha256(os.path.join(pack, 'models', os.path.basename(out['model'])))
        sources[new_id] = src_rec

    # 本番に出た版で作り直されたものは、元の ID を描画用に残しカタログから外す
    for old in shipped['items']:
        if old['id'] in REMADE:
            keep = dict(old)
            keep['retired'] = True
            keep['retiredBy'] = REMADE[old['id']]
            for k in ('model', 'thumb', 'top'):
                blob = subprocess.check_output(['git', 'show', 'origin/main:' + old[k]], cwd=ROOT)
                open(os.path.join(ROOT, old[k]), 'wb').write(blob)
            quantize(os.path.join(ROOT, old['thumb']), os.path.join(ROOT, old['thumb']))
            quantize(os.path.join(ROOT, old['top']), os.path.join(ROOT, old['top']))
            items.append(keep)

    missing = shipped_ids - {i['id'] for i in items}
    if missing:
        raise SystemExit('本番に出た ID が消える: ' + ', '.join(sorted(missing)))

    doc = {'set': 'rpg-mansion', 'name': '洋館',
           'note': 'TRPG・ゲームの舞台作り向けの洋館セット。Blender で独自制作。正面 +Z・上 +Y・原点は底面中心。寸法は mm。'
                   '1点ごとの制作の元(.blend・確認画像・検証の記録)は tools/blender/rpg_mansion/catalogue-sources.json。'
                   'retired の物はカタログに出さず、置いてあるプランの描画のためだけに残す。',
           'items': items}
    with open(os.path.join(pack, 'manifest.json'), 'w') as f:
        # 1点1行。サイトを開くたびに全員が読むので、字下げで膨らませない
        f.write('{"set":"rpg-mansion","name":"洋館","note":' + json.dumps(doc['note'], ensure_ascii=False) + ',"items":[\n')
        f.write(',\n'.join(json.dumps(i, ensure_ascii=False, separators=(',', ':')) for i in items))
        f.write('\n]}\n')
    with open(os.path.join(tools, 'catalogue-sources.json'), 'w') as f:
        json.dump({'deliveredCommit': '71ee491c', 'items': sources}, f, ensure_ascii=False, indent=1)
        f.write('\n')
    print(f'{len(items)} 点（うちカタログから外した版 {sum(1 for i in items if i.get("retired"))}）')


if __name__ == '__main__':
    main()
