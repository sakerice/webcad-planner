"""GLB の中の画像を小さくして（長辺 SIZE px の JPEG に）書き直す。形・骨・動きはそのまま。

Meshy の書き出しは 2048px の PNG を3枚（色・法線・金属/粗さ）持ち、1体 11MB ある。
ウォークスルーの人物は画面の一部にしか映らないので、1024px の JPEG で足りる（約 1/5 になる）。

縮める前に、色の島（UV の島）の外側の余白を、島の縁の色で埋め広げる。Meshy のテクスチャは島が細かく
大量に分かれていて余白がほとんど無く、そのまま縮めると島の縁に隣の島や黒い余白の色が混ざり、
人物の表面に線やすき間が見えた（利用者の指摘）。

  python3 tools/characters/shrink_glb_textures.py in.glb out.glb [SIZE=1024]
"""
import io, json, struct, sys
import numpy as np
from PIL import Image


def shrink_padded(im, size):
    """色の島の外側（黒い余白）を混ぜずに縮め、縮めた後で島の外側を縁の色で埋め広げる。
    黒い余白も一緒に縮めると、島の縁に黒や隣の島の色が混ざって線に見える"""
    a = np.asarray(im.convert('RGB'))
    mask = (a.astype(np.uint16).sum(axis=2) > 15)
    w, h = im.size
    if max(w, h) > size:
        w, h = (size, size) if w == h else (size, round(h * size / w))
    # 余白を 0 にした色と、島の有無を同じように縮め、割り戻す（余白の色が混ざらない）
    pre = Image.fromarray((a * mask[..., None]).astype(np.uint8)).resize((w, h), Image.BOX)
    msk = Image.fromarray((mask * 255).astype(np.uint8)).resize((w, h), Image.BOX)
    c = np.asarray(pre).astype(np.float32); m = np.asarray(msk).astype(np.float32) / 255.0
    filled = m > 0.05
    c[filled] = c[filled] / m[filled][:, None]
    for _ in range(max(4, w // 128)):              # 2048px なら 16px 埋め広げる
        if filled.all(): break
        acc = np.zeros_like(c); cnt = np.zeros(filled.shape, np.float32)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            mm = np.roll(filled, (dy, dx), axis=(0, 1))
            acc += np.roll(c, (dy, dx), axis=(0, 1)) * mm[..., None]; cnt += mm
        grow = (~filled) & (cnt > 0)
        c[grow] = acc[grow] / cnt[grow][:, None]
        filled |= grow
    return Image.fromarray(c.clip(0, 255).astype(np.uint8))


def main(src, dst, size=1024):
    data = open(src, 'rb').read()
    jlen = struct.unpack_from('<I', data, 12)[0]
    j = json.loads(data[20:20 + jlen])
    boff = 20 + jlen
    blen = struct.unpack_from('<I', data, boff)[0]
    bin_ = data[boff + 8: boff + 8 + blen]
    views = [bin_[v.get('byteOffset', 0): v.get('byteOffset', 0) + v['byteLength']] for v in j['bufferViews']]
    for img in j.get('images', []):
        bv = img['bufferView']
        im = Image.open(io.BytesIO(views[bv]))
        im = im.convert('RGB')
        if 'normal' not in (img.get('name') or ''):
            im = shrink_padded(im, size)
        elif max(im.size) > size:
            im = im.resize((size, size) if im.size[0] == im.size[1] else (size, round(im.size[1] * size / im.size[0])), Image.LANCZOS)
        out = io.BytesIO()
        im.save(out, 'JPEG', quality=88 if 'normal' in (img.get('name') or '') else 85, subsampling=0)
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
    main(sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 1024)
