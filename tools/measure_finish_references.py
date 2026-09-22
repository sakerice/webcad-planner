#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""色を変えられる部位ごとに、柄の明るさ(finishReference)を測る。

    python3 tools/measure_finish_references.py

■ なぜ要るのか
  `neutralizeFinish()`(assets/js/model-quality.js)は、テクスチャの色味を
  輝度に落として指定色を掛ける。そのとき

      出る色 = 指定色 × (テクスチャの輝度 / finishReference)

  で計算するので、**finishReference が柄の平均的な明るさと合っていないと、
  指定した色より暗く(または明るく)出る。**

  手書きだった2点には人が決めた値(0.3 / 0.08)が入っていたが、機械で貼った
  866点には無く、既定の1で効いていた。実機で見ると、濃紺を指定したソファが
  さらに暗い紺になる。柄の平均輝度がおよそ0.5なら、指定色が半分の明るさで
  出るということ。

  ここでは各マテリアルのベースカラー画像を実際に開いて平均輝度を測り、
  assets/models/finishes.json の `references` へ書き戻す。

■ 測り方
  - GLB に埋め込まれた baseColorTexture の画像を取り出して開く
  - sRGB から線形へ戻し、Rec.709 の輝度(0.2126/0.7152/0.0722)の平均を取る
  - **真っ黒・真っ白に寄りすぎた値は使わない**(0.04〜0.9 に収める)。
    外れ値をそのまま使うと、色が飛ぶか潰れる
  - 人が決めた値がある部位は、そのまま残す（実物を見て決めたものが優先）

■ 測れないもの（大半）
  テクスチャの多くは **KTX2(Basis圧縮)** で、Pillow では開けない。展開する
  道具(ktx / toktx / basisu)はこの環境に入っていない。

  そこで、**測れたぶん(JPEGのもの)から部位ごとの中央値を出し、測れなかった
  ものはその代表値を使う**。既定の1をそのまま使うより、指定した色にずっと
  近く出る。1 のままだと、柄の平均輝度が0.36なら指定色が約1/3の明るさで出る。

  KTX2 を開ける道具が入ったら、この代表値は要らなくなる。そのときは
  `defaults` を捨てて、全点を実測に置き換えること。
"""
import io
import json
import os
import struct
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FINISHES = os.path.join(ROOT, 'assets', 'models', 'finishes.json')
# 測った値の使える範囲。外れたら既定(1)のままにする。
LOW, HIGH = 0.04, 0.90
# 画像は縮めてから測る。平均が要るだけなので、原寸で読む必要はない。
SAMPLE = 64


def gltf_and_bin(path):
    with open(path, 'rb') as f:
        data = f.read()
    length = struct.unpack_from('<I', data, 12)[0]
    doc = json.loads(data[20:20 + length])
    rest = data[20 + length:]
    blob = b''
    offset = 0
    while offset + 8 <= len(rest):
        size, kind = struct.unpack_from('<II', rest, offset)
        if kind == 0x004E4942:      # BIN
            blob = rest[offset + 8:offset + 8 + size]
            break
        offset += 8 + size
    return doc, blob


def image_bytes(doc, blob, index):
    image = (doc.get('images') or [])[index]
    if 'bufferView' not in image:
        return None
    view = doc['bufferViews'][image['bufferView']]
    start = view.get('byteOffset', 0)
    return blob[start:start + view['byteLength']]


def mean_luminance(raw):
    """sRGB の画像から、線形の平均輝度を出す。"""
    try:
        img = Image.open(io.BytesIO(raw)).convert('RGB')
    except Exception:
        return None
    img.thumbnail((SAMPLE, SAMPLE))
    total = 0.0
    pixels = list(img.getdata())
    if not pixels:
        return None
    for r, g, b in pixels:
        lin = []
        for v in (r / 255.0, g / 255.0, b / 255.0):
            lin.append(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4)
        total += 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]
    return total / len(pixels)


def main():
    with open(FINISHES, encoding='utf-8') as f:
        data = json.load(f)
    refs = data.get('references') or {}
    kept = measured = skipped = missing = 0

    for url, channels in data['models'].items():
        path = os.path.join(ROOT, url)
        if not os.path.exists(path):
            continue
        try:
            doc, blob = gltf_and_bin(path)
        except Exception:
            continue
        by_name = {m.get('name', ''): m for m in doc.get('materials', [])}
        for material_name in channels:
            if refs.get(url, {}).get(material_name) is not None:
                kept += 1          # 人が決めた値は動かさない
                continue
            material = by_name.get(material_name)
            pbr = (material or {}).get('pbrMetallicRoughness', {})
            tex = pbr.get('baseColorTexture')
            if not tex:
                missing += 1       # 柄が無いものは既定(1)でよい
                continue
            source = (doc.get('textures') or [])[tex['index']].get('source')
            raw = image_bytes(doc, blob, source) if source is not None else None
            value = mean_luminance(raw) if raw else None
            if value is None or not (LOW <= value <= HIGH):
                skipped += 1
                continue
            refs.setdefault(url, {})[material_name] = round(value, 3)
            measured += 1

    # 測れたぶんから、部位ごとの代表値(中央値)を出す。
    # **測れなかったものは、これを使う。** 既定の1より確実に近い。
    from statistics import median
    buckets = {}
    for url, mats in refs.items():
        for name, value in mats.items():
            channel = data['models'].get(url, {}).get(name)
            if channel:
                buckets.setdefault(channel, []).append(value)
    defaults = {c: round(median(v), 3) for c, v in buckets.items() if len(v) >= 3}
    # 測れた部位が無いものにも、近い部位の値を回す（陶器・石は白っぽいので明るめ）
    for channel, fallback in (('leather', 'wood'), ('accent', 'fabric'),
                              ('metal', 'body'), ('ceramic', None), ('stone', None)):
        if channel in defaults:
            continue
        if fallback and fallback in defaults:
            defaults[channel] = defaults[fallback]
        else:
            defaults[channel] = 0.55      # 白物。柄が明るいので基準も高い
    data['defaults'] = defaults

    data['references'] = refs
    with open(FINISHES, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
        f.write('\n')
    print(f'測った {measured} / 人の値を残した {kept} / 柄なし {missing} / 開けず見送り {skipped}')
    print('  部位ごとの代表値: ' + ' / '.join(f'{k}={v}' for k, v in sorted(defaults.items())))


if __name__ == '__main__':
    sys.exit(main())
