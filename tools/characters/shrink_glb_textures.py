"""GLB の中の画像を小さくして（長辺 SIZE px の JPEG に）書き直す。形・骨・動きはそのまま。

Meshy の書き出しは 2048px の PNG を3枚（色・法線・金属/粗さ）持ち、1体 11MB ある。
ウォークスルーの人物は画面の一部にしか映らないので、1024px の JPEG で足りる（約 1/5 になる）。

縮める前に、色の島（UV の島）の外側の余白を、島の縁の色で埋め広げる。Meshy のテクスチャは島が細かく
大量に分かれていて余白がほとんど無く、そのまま縮めると島の縁に隣の島や黒い余白の色が混ざり、
人物の表面に線やすき間が見えた（利用者の指摘）。

島かどうかは、メッシュの UV の三角形を画像に塗って決める（色では決めない）。Meshy の書き出しは余白が
黒でなく白っぽく塗られている所が多く、色で決めると白い余白が島に数えられて残り、遠目で使う縮小版の画像
（ミップマップ）で髪や服の継ぎ目に白い点々が出た（利用者の指摘、2026-11-05）。

clean を付けると、髪とセーターの上に浮いた点や細い筋（Meshy の色の画像に描き込まれている物）を、周りの色で塗る。
周りの 11x11 画素の7割以上が髪の茶色かセーターの緑なのに自分だけ違う色の画素だけを対象にするので、
顔（周りが肌色）の目・口・眉には触らない。

  python3 tools/characters/shrink_glb_textures.py in.glb out.glb [SIZE=1024] [clean]
"""
import io, json, struct, sys
import numpy as np
from PIL import Image


def _accessor(j, views, i):
    acc = j['accessors'][i]
    bv = j['bufferViews'][acc['bufferView']]
    raw = views[acc['bufferView']]
    comp = {5126: np.float32, 5125: np.uint32, 5123: np.uint16, 5121: np.uint8}[acc['componentType']]
    ncomp = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[acc['type']]
    stride = bv.get('byteStride') or np.dtype(comp).itemsize * ncomp
    off = acc.get('byteOffset', 0)
    a = np.ndarray((acc['count'], ncomp), comp, raw, off, (stride, np.dtype(comp).itemsize))
    return a.copy() if ncomp > 1 else a[:, 0].copy()


def uv_mask(j, views, image_index, w, h):
    """その画像を色に使うメッシュの UV の三角形を塗った島の範囲（縁を1画素広げる）。使う物が無ければ None"""
    from PIL import ImageDraw
    tex_ids = [t for t, tx in enumerate(j.get('textures', [])) if tx.get('source') == image_index]
    mats = [m for m, mt in enumerate(j.get('materials', []))
            if mt.get('pbrMetallicRoughness', {}).get('baseColorTexture', {}).get('index') in tex_ids]
    if not mats: return None
    canvas = Image.new('L', (w, h), 0); dr = ImageDraw.Draw(canvas)
    for mesh in j['meshes']:
        for pr in mesh['primitives']:
            if pr.get('material') not in mats or 'TEXCOORD_0' not in pr['attributes']: continue
            uv = _accessor(j, views, pr['attributes']['TEXCOORD_0']) * (w, h)
            idx = _accessor(j, views, pr['indices']) if 'indices' in pr else np.arange(len(uv))
            for t in idx.reshape(-1, 3):
                dr.polygon([tuple(uv[k]) for k in t], fill=255, outline=255)
    m = np.asarray(canvas) > 0
    grown = m.copy()                                 # 縁の画素も、なめらかに読むときに使われるので含める
    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)): grown |= np.roll(m, (dy, dx), axis=(0, 1))
    return grown


def _box(x, r):
    c = x.copy()
    for ax in (0, 1):
        acc = np.zeros_like(c)
        for d in range(-r, r + 1): acc += np.roll(c, d, ax)
        c = acc
    return c / (2 * r + 1) ** 2


def clean_flat_specks(im, r=5, need=0.72, rounds=3):
    """髪の茶色・セーターの緑の広がりの中に浮いた点や筋を、周りの同じ色の平均で塗る"""
    a = np.asarray(im.convert('RGB')).astype(np.float32)
    for _ in range(rounds):
        R, G, B = a[..., 0], a[..., 1], a[..., 2]
        hair = (R > G + 15) & (G > B + 8) & (R < 170) & (R > 60)
        green = (G > R + 30) & (G > B + 12) & (G < 160)
        for cls in (hair, green):
            f = cls.astype(np.float32)
            frac = _box(f, r)
            tgt = (~cls) & (frac >= need)
            mean = np.stack([_box(a[..., k] * f, r) for k in range(3)], -1) / np.maximum(frac, 1e-6)[..., None]
            a[tgt] = mean[tgt]
    return Image.fromarray(a.clip(0, 255).astype(np.uint8))


def shrink_padded(im, size, mask=None):
    """色の島の外側（余白）を混ぜずに縮め、縮めた後で島の外側を縁の色で埋め広げる。
    余白も一緒に縮めると、島の縁に黒や隣の島の色が混ざって線に見える"""
    a = np.asarray(im.convert('RGB'))
    if mask is None: mask = (a.astype(np.uint16).sum(axis=2) > 15)
    w, h = im.size
    if max(w, h) > size:
        w, h = (size, size) if w == h else (size, round(h * size / w))
    # 余白を 0 にした色と、島の有無を同じように縮め、割り戻す（余白の色が混ざらない）
    pre = Image.fromarray((a * mask[..., None]).astype(np.uint8)).resize((w, h), Image.BOX)
    msk = Image.fromarray((mask * 255).astype(np.uint8)).resize((w, h), Image.BOX)
    c = np.asarray(pre).astype(np.float32); m = np.asarray(msk).astype(np.float32) / 255.0
    filled = m > 0.05
    c[filled] = c[filled] / m[filled][:, None]
    for _ in range(max(16, w // 32)):              # 2048px なら 64px 埋め広げる（遠目の縮小版でも余白の色が届かない幅）
        if filled.all(): break
        acc = np.zeros_like(c); cnt = np.zeros(filled.shape, np.float32)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            mm = np.roll(filled, (dy, dx), axis=(0, 1))
            acc += np.roll(c, (dy, dx), axis=(0, 1)) * mm[..., None]; cnt += mm
        grow = (~filled) & (cnt > 0)
        c[grow] = acc[grow] / cnt[grow][:, None]
        filled |= grow
    return Image.fromarray(c.clip(0, 255).astype(np.uint8))


def main(src, dst, size=1024, clean=False):
    data = open(src, 'rb').read()
    jlen = struct.unpack_from('<I', data, 12)[0]
    j = json.loads(data[20:20 + jlen])
    boff = 20 + jlen
    blen = struct.unpack_from('<I', data, boff)[0]
    bin_ = data[boff + 8: boff + 8 + blen]
    views = [bin_[v.get('byteOffset', 0): v.get('byteOffset', 0) + v['byteLength']] for v in j['bufferViews']]
    for ii, img in enumerate(j.get('images', [])):
        bv = img['bufferView']
        im = Image.open(io.BytesIO(views[bv]))
        im = im.convert('RGB')
        if 'normal' not in (img.get('name') or ''):
            mask = uv_mask(j, views, ii, *im.size)
            if clean and mask is not None: im = clean_flat_specks(im)      # 色の画像だけ（金属・粗さの画像は使われない）
            im = shrink_padded(im, size, mask)
        elif max(im.size) > size:
            im = im.resize((size, size) if im.size[0] == im.size[1] else (size, round(im.size[1] * size / im.size[0])), Image.LANCZOS)
        out = io.BytesIO()
        im.save(out, 'JPEG', quality=88 if 'normal' in (img.get('name') or '') else 90, subsampling=0)
        views[bv] = out.getvalue()
        img['mimeType'] = 'image/jpeg'
    # 並べ直す（各区切りは4バイト境界）
    buf = bytearray()
    for i, v in enumerate(views):
        while len(buf) % 4: buf.append(0)
        j['bufferViews'][i]['byteOffset'] = len(buf)
        j['bufferViews'][i]['byteLength'] = len(v)
        buf += v
    while len(buf) % 4: buf.append(0)
    j['buffers'] = [{'byteLength': len(buf)}]
    js = json.dumps(j, separators=(',', ':')).encode()
    while len(js) % 4: js += b' '
    total = 12 + 8 + len(js) + 8 + len(buf)
    with open(dst, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total))
        f.write(struct.pack('<II', len(js), 0x4E4F534A)); f.write(js)
        f.write(struct.pack('<II', len(buf), 0x004E4942)); f.write(buf)

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 1024, 'clean' in sys.argv[4:])
