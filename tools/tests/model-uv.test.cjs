// 自作モデルのUV(GLBの TEXCOORD_0)。
//
// なぜ在るのか
// ------------
// **Blender 側の検査を通ったのに、GLB では UV が潰れていた。**
// glTF の TEXCOORD_0 は「先頭のUV層」であって、Blender で active_render に
// した層ではない。UV を持つ部品(primitive_cube_add は UVMap を作る)と
// 持たない部品(from_pydata は作らない)を join すると層が2枚になり、
// 先頭の空の層が書き出される。デッキ・便器・エアコン・建具がこれだった。
//
// 見た目の症状は「素材を選んでも柄が出ない(単色になる)」。**画面はエラーを
// 出さない**ので、目で見ても「そういう素材なのかな」で通ってしまう。
// ここが落ちると、テクスチャを選べるのに何も起きないモデルが混ざる。
const test = require('node:test');
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { readFileSync } = require('node:fs');

const ROOT = join(__dirname, '..', '..');
const MANIFEST = JSON.parse(readFileSync(join(ROOT, 'assets/models/custom/manifest.json'), 'utf8'));

const COMPONENT = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array, 5121: Uint8Array };
const COUNTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

/** GLB を読み、プリミティブごとに 三角形数 / UVが潰れた数 / UVの有無 を返す。 */
function scanGlb(rel) {
  const buf = readFileSync(join(ROOT, rel));
  const jsonLength = buf.readUInt32LE(12);
  const gltf = JSON.parse(buf.subarray(20, 20 + jsonLength).toString('utf8'));
  const bin = buf.subarray(20 + jsonLength + 8);
  const read = (index) => {
    const a = gltf.accessors[index];
    const view = gltf.bufferViews[a.bufferView];
    const Type = COMPONENT[a.componentType];
    const n = COUNTS[a.type];
    const offset = (view.byteOffset || 0) + (a.byteOffset || 0);
    // Buffer の先頭が Type の境界に乗らないことがあるので、写してから読む
    const bytes = Uint8Array.prototype.slice.call(bin, offset, offset + a.count * n * Type.BYTES_PER_ELEMENT);
    return { data: new Type(bytes.buffer), n };
  };
  let triangles = 0, collapsed = 0, withoutUv = 0;
  for (const mesh of gltf.meshes || []) {
    for (const prim of mesh.primitives) {
      const idx = read(prim.indices).data;
      const count = idx.length / 3;
      triangles += count;
      const uvIndex = prim.attributes.TEXCOORD_0;
      if (uvIndex === undefined) { withoutUv += count; continue; }
      const uv = read(uvIndex).data;
      for (let t = 0; t < count; t++) {
        const [i, j, k] = [idx[t * 3] * 2, idx[t * 3 + 1] * 2, idx[t * 3 + 2] * 2];
        const area = Math.abs((uv[j] - uv[i]) * (uv[k + 1] - uv[i + 1])
                            - (uv[k] - uv[i]) * (uv[j + 1] - uv[i + 1])) / 2;
        if (!(area > 1e-12)) collapsed++;
      }
    }
  }
  return { triangles, collapsed, withoutUv };
}

// model_kit.run() を通して作った品。**ここは1三角形も潰れていてはいけない。**
// 新しく作る自作モデルは必ずここへ足す(足さないと、UVが無いまま出荷できる)。
const UNWRAPPED = [
  'original-bathtub', 'original-toilet', 'original-vanity',
  'original-ac-wall', 'original-ac-wall-wide',
  'original-desk', 'original-desk-work',
  'original-door-flush', 'original-door-slit',
  'original-tree-symbol', 'original-tree-evergreen', 'original-shrub',
  'original-deck-1820', 'original-terrace-tile', 'original-fence-lattice',
  'original-car-stop', 'original-standpipe',
  'original-books-stack', 'original-mug-tray', 'original-vase-tall',
  'original-basket-blanket', 'original-plant-desk', 'original-entry-tray',
  'original-washer-drum', 'original-washer-pan', 'original-laundry-pole',
  'original-ac-wall-slim',
];

test('UV展開を通した品は、UVが1つも潰れていない', () => {
  const items = MANIFEST.items.filter((i) => UNWRAPPED.includes(i.id));
  assert.equal(items.length, UNWRAPPED.length, '一覧のモデルがマニフェストに無い');
  for (const item of items) {
    const { triangles, collapsed, withoutUv } = scanGlb(item.model);
    assert.equal(withoutUv, 0, `${item.id}: ${withoutUv}/${triangles} 三角形に UV が無い`);
    assert.equal(collapsed, 0,
      `${item.id}: ${collapsed}/${triangles} 三角形の UV が1点に潰れている。`
      + 'UV層が2枚になっていないか(glTF は先頭の層を書き出す)');
  }
});

test('UVの無い品は1点も無い', () => {
  // 画面は色と同じ場所に素材の欄を出す。**UVが無いと、選んでも何も起きない。**
  // カーテン4点・ロールスクリーン3点・ランドリー2点がこの状態だった
  // (元のビルダーに UV 展開が入っていなかった)。
  const missing = MANIFEST.items
    .filter((i) => i.provenance === 'original')
    .map((i) => ({ id: i.id, ...scanGlb(i.model) }))
    .filter((r) => r.withoutUv > 0)
    .map((r) => `${r.id} (${r.withoutUv}/${r.triangles})`);
  assert.deepEqual(missing, [], 'UVの無い自作モデルがある。model_kit.run() か unwrap() を通すこと');
});

test('古いビルダーの品も、UVの潰れがこれ以上増えていない', () => {
  // 古い品には、元の形に面積ゼロの面が残っている(ロールスクリーンの巻き芯が
  // 最悪で14%)。**形の側の問題なので直すのは別の仕事**だが、増やさないことは
  // 見る。立水栓は33%だったが、水受けボウルを展開して0%になった。
  const worst = MANIFEST.items
    .filter((i) => i.provenance === 'original' && !UNWRAPPED.includes(i.id))
    .map((i) => ({ id: i.id, ...scanGlb(i.model) }))
    .map((r) => ({ id: r.id, ratio: r.collapsed / r.triangles }))
    .filter((r) => r.ratio > 0.15)
    .map((r) => `${r.id} (${Math.round(r.ratio * 100)}%)`)
    .sort();
  assert.deepEqual(worst, [], 'UVの潰れが15%を超える品がある');
});
