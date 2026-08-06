// index.html の instance guide (AI レンダーパッケージの「部材ごとの色分け」)
// が、**宣言した全インスタンスに固有の色を実際に塗る** ことを固定する。
//
// 直した欠陥: GLB 由来の家具 (FMP の InstancedMesh) が丸ごと純黒に落ちていた。
// 実測 pv/renders/T92-ldk-overhead/instance/0000.png:
//   純黒 740,125px = 13.94% / 宣言 73 件のうち発色 36 件 / 家具 36 件が全欠落。
//
// 機構は two-part で、両方をここで機械検証する。
//   A) 同梱 three (r169) のシェーダ前置きの事実 — vertexColors を立てると
//      **頂点側にも** USE_COLOR が立ち `attribute vec3 color` を掛けてしまう。
//   B) 同梱 GLB に COLOR_0 が1つも無い事実 — よって上の attribute は
//      未束縛、WebGL 既定値 (0,0,0,1) が渡り、instance の色は 0 倍になる。
// そのうえで C) index.html が実際に作る guide マテリアルを取り出して評価する。
//
// three.js の実描画はここでは動かない(ブラウザが要る)。ここで固定するのは
// 「どのマテリアル設定になるか」「legend の色が何になるか」だけである。
// 実際の発色は controller がブラウザで再キャプチャして確認する。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const INDEX = join(ROOT, 'index.html');
const THREE_BUILD = join(ROOT, 'assets', 'vendor', 'three', 'build', 'three.module.js');
const LINES = readFileSync(INDEX, 'utf8').split('\n');

// ── index.html からの取り出し ────────────────────────────────────
// 取り違えた断片を評価して「何も検証していないテスト」になるのを防ぐため、
// ヒット数と括弧の釣り合いを必ず検査する。

function sourceFunction(signature) {
  const start = LINES.findIndex(l => l.trim().startsWith(signature));
  assert.ok(start >= 0, `index.html に "${signature}" が見つからない`);
  let depth = 0;
  const out = [];
  for (let i = start; i < LINES.length; i++) {
    out.push(LINES[i]);
    for (const ch of LINES[i]) {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
    }
    if (depth === 0 && out.length > 1) {
      const text = out.join('\n');
      assert.ok(text.trimEnd().endsWith('}'), `"${signature}" の抽出が } で終わっていない`);
      return text;
    }
  }
  assert.fail(`"${signature}" の波括弧が閉じていない`);
}

// 複数行にまたがる var 宣言を、角括弧が釣り合い ; で終わるまで取り出す。
function sourceStatement(prefix) {
  const hits = LINES.map((l, i) => [l, i]).filter(([l]) => l.trim().startsWith(prefix));
  assert.equal(hits.length, 1, `index.html に "${prefix}" で始まる行が ${hits.length} 本ある(1本であるべき)`);
  let depth = 0;
  const out = [];
  for (let i = hits[0][1]; i < LINES.length; i++) {
    out.push(LINES[i]);
    for (const ch of LINES[i]) {
      if (ch === '[') depth++;
      else if (ch === ']') depth--;
    }
    if (depth === 0 && out.join('').trimEnd().endsWith(';')) return out.join('\n');
  }
  assert.fail(`"${prefix}" の角括弧が閉じていない`);
}

const VARIANTS = sourceStatement('var AI_INSTANCE_COLOR_VARIANTS=');
const COLOR_FN = sourceFunction('function aiInstanceColorHex(');
const FALLBACK_FN = sourceFunction('function aiInstanceFallbackColorHex(');
const REF_SOURCE_FN = sourceFunction('function aiRefSource(');
const SUMMARY_FN = sourceFunction('function aiInstanceSummary(');
const CAPTURE_FN = sourceFunction('function captureInstance3DData(');

// ── THREE スタブ ────────────────────────────────────────────────
// r169 の Color の、ここで使われる経路だけを再現する。
//   setHSL(h,s,l) は colorSpace 省略時 **working (linear)** 解釈なので変換なし。
//   getHexString() は省略時 sRGB なので linear -> sRGB 変換が掛かる。
// この非対称が legend の色を決めている。忠実さは
// 「実データ T92 の legend 73 件を1件違わず再現できるか」で下の test が検証する。
const clamp01 = x => (x < 0 ? 0 : x > 1 ? 1 : x);
const linearToSRGB = c => (c < 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 0.41666) - 0.055);
const srgbToLinear = c => (c < 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4));

function hue2rgb(p, q, t) {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * 6 * (2 / 3 - t);
  return p;
}

class StubColor {
  constructor(value) {
    this.rgb = [1, 1, 1];
    if (typeof value === 'string') this.setHex(parseInt(value.replace('#', ''), 16));
    else if (typeof value === 'number') this.setHex(value);
  }
  setHex(hex) {
    this.rgb = [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map(v => srgbToLinear(v / 255));
    return this;
  }
  setHSL(h, s, l) {
    h = ((h % 1) + 1) % 1;
    if (s === 0) this.rgb = [l, l, l];
    else {
      const q = l <= 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      this.rgb = [hue2rgb(p, q, h + 1 / 3), hue2rgb(p, q, h), hue2rgb(p, q, h - 1 / 3)];
    }
    return this;
  }
  getHexString() {
    return this.rgb
      .map(c => Math.round(clamp01(linearToSRGB(c)) * 255).toString(16).padStart(2, '0'))
      .join('');
  }
}

class StubBasicMaterial {
  constructor(params) { Object.assign(this, params || {}); this.isMaterial = true; }
  dispose() { this.disposed = true; }
}

class StubInstancedBufferAttribute {
  constructor(array, itemSize) {
    this.array = array;
    this.itemSize = itemSize;
    this.count = array.length / itemSize;
  }
}

const THREE = {
  Color: StubColor,
  MeshBasicMaterial: StubBasicMaterial,
  InstancedBufferAttribute: StubInstancedBufferAttribute,
  DoubleSide: 2,
};

// ── シーンのスタブ ──────────────────────────────────────────────
// material への代入は捕まえる。captureInstance3DData は finally で元に戻すので、
// 差し替えた guide マテリアルはこうしないと観測できない。
function trackMaterial(mesh) {
  let current = new StubBasicMaterial({ tag: 'original' });
  mesh.__originalMaterial = current;
  Object.defineProperty(mesh, 'material', {
    get: () => current,
    set(value) {
      if (value !== mesh.__originalMaterial) mesh.__guideMaterial = value;
      current = value;
    },
  });
  return mesh;
}

function instancedMesh(refs) {
  return trackMaterial({
    isMesh: true,
    isInstancedMesh: true,
    visible: true,
    count: refs.length,
    instanceColor: null,
    userData: { b: true, instanceRefs: refs, selectKind: 'item' },
    // r169 の InstancedMesh#setColorAt と同じ挙動 (未生成なら fill(1) で作る)
    setColorAt(index, color) {
      if (this.instanceColor === null) {
        this.instanceColor = new StubInstancedBufferAttribute(
          new Float32Array(3 * this.count).fill(1), 3);
      }
      this.instanceColor.array.set(color.rgb, index * 3);
      (this.painted ||= [])[index] = '#' + color.getHexString();
    },
  });
}

function plainMesh(ref, kind) {
  return trackMaterial({
    isMesh: true,
    visible: true,
    userData: { b: true, selectRef: ref, selectKind: kind },
  });
}

function runCapture(objects, { data } = {}) {
  const scene = { background: null, fog: null, traverse(cb) { objects.forEach(cb); } };
  const renderer = { render() { }, domElement: { toDataURL: () => 'data:image/png;base64,STUB' } };
  const DATA = data || { walls: [], rooms: [], items: [] };
  const build = new Function(
    'THREE', 'sc3', 'ren', 'DATA', '_gndMesh', 'ensureAiRenderable3D', 'getActive3DCamera',
    'beginAiGuideCaptureResolution', 'endAiGuideCaptureResolution',
    'aiGuideObjectShouldHide', 'aiGuideObjectIsNeighborContext',
    `${VARIANTS}\n${COLOR_FN}\n${FALLBACK_FN}\n${REF_SOURCE_FN}\n${SUMMARY_FN}\n${CAPTURE_FN}\n` +
    'return captureInstance3DData;');
  const capture = build(THREE, scene, renderer, DATA, { sentinel: 'ground' },
    () => true, () => ({}), () => ({}), () => { }, () => false, () => false);
  return capture();
}

function colourFns() {
  const build = new Function('THREE',
    `${VARIANTS}\n${COLOR_FN}\n${FALLBACK_FN}\n` +
    'return {hex:aiInstanceColorHex, fallback:aiInstanceFallbackColorHex, variants:AI_INSTANCE_COLOR_VARIANTS};');
  return build(THREE);
}

// ── A) 同梱 three のシェーダ前置きの事実 ─────────────────────────
// ここが変わると「vertexColors を立てると黒くなる」という前提そのものが
// 崩れる。three を上げたときに黙って前提が変わらないよう固定しておく。
test('three r169: USE_COLOR は頂点側では material.vertexColors だけが立て、フラグメント側は instancingColor でも立つ', () => {
  const src = readFileSync(THREE_BUILD, 'utf8');
  // 頂点前置き: vertexColors のみ
  assert.ok(src.includes('n.vertexColors?"#define USE_COLOR":""'),
    '頂点シェーダ前置きの USE_COLOR 条件が変わっている');
  // フラグメント前置き: instancingColor / batchingColor でも立つ
  assert.ok(src.includes('n.vertexColors||n.instancingColor||n.batchingColor?"#define USE_COLOR":""'),
    'フラグメントシェーダ前置きの USE_COLOR 条件が変わっている');
  // 頂点側 USE_COLOR は color 属性の宣言を伴う
  assert.ok(src.includes('"#elif defined( USE_COLOR )","\\tattribute vec3 color;"'),
    'USE_COLOR 下の attribute vec3 color 宣言が見当たらない');
  // color_vertex は color を掛け、そのあと instanceColor を掛ける
  assert.ok(src.includes('#ifdef USE_COLOR\\n\\tvColor *= color;\\n#endif\\n#ifdef USE_INSTANCING_COLOR\\n\\tvColor.xyz *= instanceColor.xyz;'),
    'color_vertex チャンクの積の順序が変わっている');
});

test('同梱 GLB には COLOR_0 が1つも無い(未束縛 attribute の既定値 0 が掛かる根拠)', () => {
  const files = [];
  (function walk(dir) {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith('.glb')) files.push(p);
    }
  })(join(ROOT, 'assets', 'models'));
  assert.ok(files.length > 100, `GLB が ${files.length} 件しか見つからない`);
  const withColor = [];
  for (const p of files) {
    const buf = readFileSync(p);
    const jsonLen = buf.readUInt32LE(12);
    const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
    for (const mesh of json.meshes || []) {
      for (const prim of mesh.primitives || []) {
        if (Object.keys(prim.attributes || {}).some(k => k.startsWith('COLOR'))) withColor.push(p);
      }
    }
  }
  assert.deepEqual(withColor, [], 'COLOR_0 を持つ GLB が現れた — 前提が変わっている');
});

// ── B) 製品側: guide マテリアルと legend ─────────────────────────

test('InstancedMesh の guide マテリアルは vertexColors を立てない', () => {
  const refs = [{ type: 'fmp-CabinetD01' }, { type: 'fmp-Refrigerator03' }];
  const mesh = instancedMesh(refs);
  runCapture([mesh]);
  const generated = mesh.__guideMaterial;
  assert.ok(generated, 'guide マテリアルが記録されていない');
  assert.ok(!generated.vertexColors,
    'vertexColors が立っている — GLB には color 属性が無いので instance の色が 0 倍され純黒になる');
});

test('InstancedMesh の各インスタンスに legend の色がそのまま塗られる', () => {
  const refs = [{ type: 'fmp-CabinetD01' }, { type: 'fmp-Refrigerator03' }, { type: 'fmp-GasStove07' }];
  const mesh = instancedMesh(refs);
  const { legend } = runCapture([mesh], { data: { walls: [], rooms: [], items: refs } });
  assert.equal(legend.length, 3);
  assert.deepEqual(mesh.painted, legend.map(e => e.color),
    'setColorAt に渡された色が legend の色と一致しない');
  for (const entry of legend) {
    assert.notEqual(entry.color, '#000000', `${entry.type} が黒`);
    assert.notEqual(entry.color, '#ffffff', `${entry.type} が背景色と同じ白`);
  }
  assert.deepEqual(legend.map(e => e.source), ['items', 'items', 'items']);
  assert.deepEqual(legend.map(e => e.type), refs.map(r => r.type));
});

test('legend の色は全インスタンスで一意 — 量子化衝突する id を含めても', () => {
  // 実測: 黄金角の色相列は variant 0 だけだと id=11 と id=388 がどちらも
  // #dd5df2 になる。500 件並べれば必ずその領域に入る。
  const refs = Array.from({ length: 500 }, (_, i) => ({ type: `item-${i}` }));
  const mesh = instancedMesh(refs);
  const { legend } = runCapture([mesh], { data: { walls: [], rooms: [], items: refs } });
  assert.equal(legend.length, 500);
  const colours = legend.map(e => e.color);
  assert.equal(new Set(colours).size, 500, '同じ色が2つ以上の部材に割り当てられた');
  assert.ok(!colours.includes('#000000') && !colours.includes('#ffffff'));
});

test('variant 0 は従来値のまま — 実データ T92 の legend 73 件を1件違わず再現する', () => {
  const legend = JSON.parse(readFileSync(
    join(ROOT, 'pv', 'renders', 'T92-ldk-overhead', 'instance-legend.json'), 'utf8')).instances;
  assert.equal(legend.length, 73);
  const { hex } = colourFns();
  for (const entry of legend) assert.equal(hex(entry.id), entry.color, `id=${entry.id}`);
});

test('guide 用 instanceColor は使い回され、キャプチャのたびに作り直されない', () => {
  const refs = [{ type: 'fmp-Chair14' }, { type: 'fmp-Chair37' }];
  const mesh = instancedMesh(refs);
  runCapture([mesh]);
  const first = mesh.userData._aiGuideInstanceColor;
  assert.ok(first, 'guide 用 instanceColor が userData に残っていない');
  runCapture([mesh]);
  assert.equal(mesh.userData._aiGuideInstanceColor, first,
    '2回目のキャプチャで作り直された — three は捨てた属性の GL バッファを解放しない');
});

test('キャプチャ後に元のマテリアルと instanceColor が戻る(通常表示は変えない)', () => {
  const refs = [{ type: 'fmp-Sofa39' }];
  const mesh = instancedMesh(refs);
  const original = mesh.__originalMaterial;
  runCapture([mesh]);
  assert.equal(mesh.material, original);
  assert.equal(mesh.instanceColor, null);
  assert.equal(mesh.visible, true);
});

test('InstancedMesh でない部材は従来どおり単色マテリアルで塗られる', () => {
  const wall = { type: 'wall', floor: 2 };
  const mesh = plainMesh(wall, 'wall');
  const { legend } = runCapture([mesh], { data: { walls: [wall], rooms: [], items: [] } });
  assert.equal(legend.length, 1);
  assert.equal(legend[0].source, 'walls');
  assert.equal(mesh.__guideMaterial.color, legend[0].color);
  assert.ok(!mesh.__guideMaterial.vertexColors);
});

test('同じ ref が複数メッシュに現れても legend は1件・同じ色', () => {
  const sofa = { type: 'fmp-Sofa39' };
  const a = instancedMesh([sofa]);
  const b = instancedMesh([sofa]);
  const { legend } = runCapture([a, b], { data: { walls: [], rooms: [], items: [sofa] } });
  assert.equal(legend.length, 1);
  assert.deepEqual(a.painted, b.painted);
});

test('fallback 色は使用済みの色を返さない', () => {
  const { fallback } = colourFns();
  const used = new Set();
  for (let id = 1; id <= 200; id++) {
    const hex = fallback(id, used);
    assert.match(hex, /^#[0-9a-f]{6}$/);
    assert.ok(!used.has(hex), `fallback が重複色 ${hex} を返した`);
    assert.ok(hex !== '#000000' && hex !== '#ffffff');
    used.add(hex);
  }
});
