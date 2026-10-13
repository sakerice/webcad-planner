"""GLB の中の画像を小さくして（長辺 SIZE px の JPEG に）書き直す。形・骨・動きはそのまま。

Meshy の書き出しは 2048px の PNG を3枚（色・法線・金属/粗さ）持ち、1体 11MB ある。
ウォークスルーの人物は画面の一部にしか映らないので、1024px の JPEG で足りる（約 1/5 になる）。

  python3 tools/characters/shrink_glb_textures.py in.glb out.glb [SIZE=1024]
"""
import io, json, struct, sys
from PIL import Image

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
        if max(im.size) > size:
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
