// 読み取りの AI に渡す「設定できる項目」の表（assets/js/plan-settable.js）が、アプリの実物とずれていないか。
//
// なぜ在るのか
// ------------
// 渡す項目を指示文と取り込みに手で書いていた頃、設定パネルの項目の多くが AI に渡っておらず、
// 車・駐車場は置く手段が無く、フェンスは答えても黙って捨てられていた（2026-10-20 利用者の指摘）。
// アプリの仕様が変わったときに、表の更新し忘れをここで捕まえる:
//   - 設定パネルに項目を足した → AI に渡すか（SETTINGS）渡さないか（NOT_PASSED）を決めるまで落ちる
//   - アプリに物の種類を足した → 読み取りで置くか置かないか（TYPES_NOT_PLACED）を決めるまで落ちる
//   - 選択肢・範囲・既定の奥行きをアプリ側で変えた → 表との食い違いで落ちる
//   - AI に教えた種類が、取り込みで何にも置けない → 落ちる（黙って捨てない）
const test = require('node:test');
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');

const ROOT = join(__dirname, '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const mod = (p) => import(require('node:url').pathToFileURL(join(ROOT, p)).href);
const PlanSettable = require(join(ROOT, 'assets', 'js', 'plan-settable.js'));
const PlanFreeApply = require(join(ROOT, 'assets', 'js', 'plan-free-apply.js'));

// 設定パネルを組み立てるファイル。項目は入力欄の onchange などから呼ばれる関数で書き込まれる。
const PANEL_FILES = ['assets/js/app-state.js', 'assets/js/app-constants.js', 'assets/js/ceiling-designer.js', 'index.html'];
const PANEL_SRC = PANEL_FILES.map(read).join('\n');

// パネルの項目: updateSelectedProp('項目名', …) の項目名と、それ以外の書き込み関数の名前。
function panelEntries() {
  const out = new Set();
  for (const m of PANEL_SRC.matchAll(/updateSelectedProp\(\\'([A-Za-z0-9_]+)\\'/g)) out.add(m[1]);
  const panelOnly = PANEL_FILES.slice(0, 3).map(read).join('\n');
  for (const m of panelOnly.matchAll(/on(?:change|input)=\\?"([A-Za-z0-9_]+)\(/g)) {
    if (m[1] !== 'updateSelectedProp' && !/^(upload|finish|if$)/.test(m[1])) out.add(m[1]);
  }
  return out;
}

// アプリの定数（var 名 = {…} / […]）を取り出す。
function grab(src, name) {
  const at = src.search(new RegExp('var\\s+' + name + '\\s*='));
  assert.ok(at >= 0, name + ' がアプリに無い（前提が変わった）');
  const open = src.slice(at).search(/[[{]/) + at;
  const close = src[open] === '{' ? '}' : ']';
  let depth = 0, end = -1;
  for (let j = open; j < src.length; j++) {
    if (src[j] === src[open]) depth++;
    else if (src[j] === close) { depth--; if (!depth) { end = j + 1; break; } }
  }
  // 別の実行環境で作った値は型の比較で食い違うので、JSON で写してから返す。
  return JSON.parse(JSON.stringify(vm.runInNewContext('(' + src.slice(open, end) + ')')));
}

test('設定パネルの項目は、すべて「AI に渡す」か「渡さない（理由つき）」に分けてある', () => {
  const passed = new Set();
  for (const part of Object.keys(PlanSettable.SETTINGS)) for (const s of PlanSettable.SETTINGS[part]) passed.add(s.panel);
  const missing = [...panelEntries()].filter((k) => !passed.has(k) && !PlanSettable.NOT_PASSED[k]);
  assert.deepEqual(missing, [], '設定パネルに、読み取りで扱いを決めていない項目がある。assets/js/plan-settable.js の SETTINGS（AI に渡す）'
    + 'か NOT_PASSED（渡さない理由）に足すこと: ' + missing.join(', '));
});

test('表に書いた項目は、いまも設定パネルに在る（古い項目を残さない）', () => {
  const entries = panelEntries();
  for (const part of Object.keys(PlanSettable.SETTINGS)) {
    for (const s of PlanSettable.SETTINGS[part]) assert.ok(entries.has(s.panel), `${part}.${s.key} の入口 ${s.panel} が設定パネルに無い`);
  }
  const stale = Object.keys(PlanSettable.NOT_PASSED).filter((k) => !entries.has(k));
  assert.deepEqual(stale, [], 'NOT_PASSED に、もう設定パネルに無い項目がある: ' + stale.join(', '));
});

test('アプリの物の種類は、すべて「読み取りで置く」か「置かない（理由つき）」に分けてある', () => {
  const ISIZES = grab(read('assets/js/app-constants.js'), 'ISIZES');
  const placed = new Set([
    ...PlanSettable.OPENINGS.map((o) => o.type),
    ...PlanSettable.EXTERIOR.map((e) => e.type),
    ...PlanSettable.SITE.map((e) => e.type),
  ]);
  const missing = Object.keys(ISIZES).filter((t) => !placed.has(t) && !PlanSettable.TYPES_NOT_PLACED[t]);
  assert.deepEqual(missing, [], 'アプリに、読み取りで扱いを決めていない種類がある。plan-settable.js の OPENINGS / EXTERIOR '
    + 'か TYPES_NOT_PLACED に足すこと: ' + missing.join(', '));
  const unknown = [...placed, ...Object.keys(PlanSettable.TYPES_NOT_PLACED)].filter((t) => !ISIZES[t]);
  assert.deepEqual(unknown, [], 'アプリに無い種類を書いている: ' + unknown.join(', '));
});

test('窓・扉の既定の奥行きは、アプリの既定寸法と同じ', () => {
  const ISIZES = grab(read('assets/js/app-constants.js'), 'ISIZES');
  for (const o of PlanSettable.OPENINGS) {
    if (o.d != null) assert.equal(o.d, ISIZES[o.type].d, `${o.type} の奥行きがアプリ（${ISIZES[o.type].d}）とずれている`);
  }
});

test('選択肢はアプリの選択肢と同じ', () => {
  const state = read('assets/js/app-state.js');
  assert.deepEqual(PlanSettable.FLOOR_MATERIALS.map((c) => c[0]), grab(state, 'ROOM_FLOOR_MATERIAL_OPTIONS').map((c) => c[0]), '床材');
  // 床材を floorMaterial に寄せるときの一覧(画面と Worker の PlanSchema・既定プランの生成器 plan_kit.py)も、
  // 描画が床材として読むキー(FLOOR_PBR_STEM)と同じであること。ずれると、寄せた後に描く床が変わるか、寄せ残る。
  const sorted = (a) => a.slice().sort();
  const stems = Object.keys(grab(read('index.html'), 'FLOOR_PBR_STEM'));
  assert.deepEqual(sorted(PlanSettable.FLOOR_MATERIALS.map((c) => c[0])), sorted(stems), '設定できる床材と描画の床材');
  const PlanSchema = require(join(ROOT, 'assets', 'js', 'plan-schema.js'));
  assert.deepEqual(sorted(PlanSchema.FLOOR_MATERIAL_KEYS), sorted(stems), 'PlanSchema.FLOOR_MATERIAL_KEYS と描画の床材');
  const kit = read('tools/default-plans/plan_kit.py').match(/FLOOR_MATERIAL_KEYS = \(([^)]*)\)/);
  assert.ok(kit, 'plan_kit.py に FLOOR_MATERIAL_KEYS が無い');
  assert.deepEqual(sorted([...kit[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1])), sorted(stems), 'plan_kit.py の FLOOR_MATERIAL_KEYS と描画の床材');
  assert.deepEqual(PlanSettable.SITE_SURFACES.map((c) => c[0]), Object.keys(grab(state, 'SITE_SURFACE_OPTIONS')), '敷地の地面');
  // パネルの <option value="…"> から、その項目の選択肢を拾う（直書きの選択肢）。
  const optionsOf = (key) => {
    const at = state.indexOf("updateSelectedProp(\\'" + key + "\\'");
    assert.ok(at >= 0, key + ' の欄が無い');
    const end = state.indexOf('</select>', at);
    const near = state.slice(at, end);
    const vals = [...near.matchAll(/value="([a-z-]+)"/g)].map((m) => m[1]);
    const arr = [...near.matchAll(/\[\s*'([a-z-]+)'\s*,\s*'/g)].map((m) => m[1]);
    return new Set(vals.concat(arr));
  };
  for (const part of ['opening', 'stair', 'object']) {
    for (const s of PlanSettable.SETTINGS[part]) {
      // 敷地の地面は表（SITE_SURFACE_OPTIONS）から作る選択欄なので、上で表どうしを突き合わせている。
      if (!s.choices || s.choices === PlanSettable.SITE_SURFACES) continue;
      const app = optionsOf(s.panel);
      for (const c of s.choices) assert.ok(app.has(c[0]), `${s.key} の選択肢 ${c[0]} が設定パネルに無い（パネル: ${[...app].join(', ')}）`);
    }
  }
});

test('数の範囲は、設定パネルの入力欄の範囲を越えない', () => {
  const state = read('assets/js/app-state.js');
  for (const part of Object.keys(PlanSettable.SETTINGS)) {
    for (const s of PlanSettable.SETTINGS[part]) {
      if (!s.num) continue;
      const at = state.indexOf("updateSelectedProp(\\'" + s.panel + "\\'");
      if (at < 0) continue;
      const tag = state.slice(state.lastIndexOf('<input', at), at);
      const min = /min="(-?\d+)"/.exec(tag), max = /max="(-?\d+)"/.exec(tag);
      if (min) assert.ok(s.num[0] >= Number(min[1]), `${s.key} の下限 ${s.num[0]} がパネル（${min[1]}）より小さい`);
      if (max) assert.ok(s.num[1] <= Number(max[1]), `${s.key} の上限 ${s.num[1]} がパネル（${max[1]}）より大きい`);
    }
  }
});

test('AI に教える物の種類は、すべて取り込みで何かに置ける（黙って捨てない）', async () => {
  const { OBJECT_KINDS } = await mod('worker/plan-free.mjs');
  const tags = JSON.parse(read('assets/models/tags.json')).items;
  const lost = OBJECT_KINDS.filter((k) => !PlanFreeApply.typeForKind(k, 600, tags));
  assert.deepEqual(lost, [], '取り込みで置けない種類を AI に教えている: ' + lost.join(', '));
  assert.equal(new Set(OBJECT_KINDS).size, OBJECT_KINDS.length, '同じ種類を二度教えている');
});

test('AI への説明に、表の項目がすべて出る', async () => {
  const { buildFreePrompt } = await mod('worker/plan-free.mjs');
  const text = buildFreePrompt({ pages: 1 });
  for (const part of Object.keys(PlanSettable.SETTINGS)) for (const s of PlanSettable.SETTINGS[part]) assert.ok(text.includes(s.key + '（'), s.key);
  for (const o of PlanSettable.OPENINGS) assert.ok(text.includes(o.type + ' = '), o.type);
  for (const e of PlanSettable.EXTERIOR.concat(PlanSettable.SITE)) assert.ok(text.includes(e.kind + ' = '), e.kind);
});

test('set の値は、範囲と選択肢を確かめてから入れる', () => {
  const out = PlanSettable.applySettings('opening', 'window', [
    { key: 'windowKind', value: 'fix' }, { key: 'windowSill', value: '99999' }, { key: 'doorHeight', value: '2000' },
    { key: 'color', value: '#f00' }, { key: 'windowHeight', value: 'たかい' },
  ], {});
  assert.deepEqual(out, { windowKind: 'fix', windowSill: 3000 }, '窓に扉の項目・知らない項目・数でない値は入れない');
  assert.deepEqual(PlanSettable.applySettings('opening', 'window', [{ key: 'windowKind', value: 'round' }], {}), {});
  // 答えは「key=value; key=value」の文字列で来る。
  assert.deepEqual(PlanSettable.applySettings('opening', 'window', 'windowKind=casement; windowHeight = 900', {}), { windowKind: 'casement', windowHeight: 900 });
  assert.deepEqual(PlanSettable.applySettings('object', 'site-zone', 'name=駐車スペース;surface=concrete_brush', {}), { name: '駐車スペース', surface: 'concrete_brush' });
  assert.deepEqual(PlanSettable.applySettings('room', null, [{ key: 'ceilingHeight', value: '2400' }], {}), { ceiling: { type: 'flat', heightMm: 2400 } });
  assert.deepEqual(PlanSettable.applySettings('room', null, [{ key: 'void', value: 'yes' }, { key: 'ceilingHeight', value: '2400' }], {}, { floor: 1 }),
    { ceiling: { type: 'void', toFloor: 2 } }, '吹抜けを天井高より優先する');
});

test('床材を書かなかったときの説明が、アプリの実際の既定と同じ', async () => {
  // 「部屋の名前から決まる」と説明していたが、実際は玄関も浴室もフローリングになっていた。
  // AI は説明を信じて床材を書かず、土間がフローリングのまま下がった（2026-11-01）。
  const { buildFreePrompt } = await mod('worker/plan-free.mjs');
  assert.match(buildFreePrompt({ pages: 1 }), /floorMaterial（床材。書かなければフローリング（標準））/);
  const html = read('index.html');
  const fn = html.slice(html.indexOf('function makeRoomFloorMaterial'), html.indexOf('function makeRoomFloorMaterial') + 600);
  assert.match(fn, /roomFloorMaterialKey\(r\)\|\|\(isWet\?'tile_floor':'wood_floor'\)/, 'アプリの既定が変わったら説明も直す');
});

test('土間（floorLevel=doma）は、設定パネルの「玄関土間」と同じ計算で取り込む', () => {
  assert.deepEqual(PlanSettable.applySettings('room', null, 'floorLevel=doma; floorMaterial=tile_floor', {}), { floorLevel: 'doma', floorMaterial: 'tile_floor' });
  // 深さは床の厚みで決まる。パネルのプリセットと取り込みが別々に計算すると、片方だけ直したときに食い違う。
  const constants = read('assets/js/app-constants.js'), imp = read('assets/js/plan-import.js');
  const panel = constants.slice(constants.indexOf('function selectedRoomFloorHtml'), constants.indexOf('function selectedRoomFloorHtml') + 400);
  assert.match(panel, /domaFloorRaiseMm\(r\.floor\)/, '設定パネルの玄関土間が domaFloorRaiseMm を使っていない');
  assert.match(imp, /made\.floorLevel === 'doma'[^\n]*domaFloorRaiseMm\(floor\)/, '取り込みが domaFloorRaiseMm を使っていない');
  assert.match(imp, /delete made\.floorLevel/, 'アプリの部屋に floorLevel を残さない（保存の形を変えない）');
});

test('土間の深さは HeightModel の1か所で出す（画面のパネル・取り込み・AI・Worker が共有）', () => {
  const HeightModel = require('../../assets/js/height-model.js');
  assert.equal(HeightModel.domaFloorRaiseMm({}, 1), 0, '床を下げられない高さモデルでは 0');
  assert.equal(HeightModel.domaFloorRaiseMm({ heightDefaults: { modelVersion: 2 } }, 1), -160, '床厚の既定 180 → 基礎の天端＋20');
  const p = { heightDefaults: { modelVersion: 2, floorThickness: 220, perFloor: true }, floors: { 2: { floorThickness: 260 } } };
  assert.deepEqual([HeightModel.domaFloorRaiseMm(p, 1), HeightModel.domaFloorRaiseMm(p, 2)], [-200, -240]);
  assert.equal(HeightModel.domaFloorRaiseMm({ heightDefaults: { modelVersion: 2, floorThickness: 220 }, floors: { 2: { floorThickness: 260 } } }, 2), -200, '階ごとの設定は perFloor のときだけ');
  // SETTINGS の floorLevel の選択肢は、すべて深さに直せる
  const def = PlanSettable.SETTINGS.room.find((d) => d.key === 'floorLevel');
  def.choices.forEach(([v]) => assert.equal(typeof HeightModel.floorLevelRaiseMm(p, 1, v), 'number', v));
  assert.equal(HeightModel.floorLevelRaiseMm(p, 1, 'nope'), null);
  // 画面(app-constants.js)と Worker は、深さを自分で計算せず HeightModel を呼ぶ
  const constants = read('assets/js/app-constants.js');
  const fn = constants.slice(constants.indexOf('function domaFloorRaiseMm'), constants.indexOf('function domaFloorRaiseMm') + 200);
  assert.match(fn, /HeightModel\.domaFloorRaiseMm\(/);
  assert.match(read('worker/plan-ctx-factory.mjs'), /HeightModel\.floorLevelRaiseMm\(work, room\.floor, value\)/);
  assert.match(read('assets/js/plan-data.js'), /HeightModel\.floorLevelRaiseMm\(DATA,room\.floor,value\)/);
});

// AI で土間にした部屋を、AI で通常の高さ(±0)に戻せなかった(2026-11-25)。戻す選択肢 normal は
// 編集(チャット・MCP の setProps)だけで使い、読み取り(図面→間取り)の指示文と取り込みは1文字も変えない。
test('土間をやめる normal は編集だけの選択肢で、読み取りの説明と取り込みには出ない', async () => {
  const def = PlanSettable.SETTINGS.room.find((d) => d.key === 'floorLevel');
  assert.deepEqual(def.choices.map((c) => c[0]), ['doma'], '読み取りの選択肢は土間だけのまま');
  assert.ok(Array.isArray(def.editChoices) && def.editChoices.some((c) => c[0] === 'normal'), '編集の選択肢に normal がある');
  // 読み取りの説明(describe と freeSpec)に normal は出ない
  assert.doesNotMatch(PlanSettable.describe('room', 'rooms').join('\n'), /normal/);
  const { buildFreePrompt } = await mod('worker/plan-free.mjs');
  assert.doesNotMatch(buildFreePrompt({ pages: 1 }), /normal=/);
  // 編集の印が無い(読み取りの)適用は断って rejected に残す。印があれば受ける
  const rejected = [];
  assert.deepEqual(PlanSettable.applySettings('room', null, 'floorLevel=normal', {}, { floor: 1, rejected }), {});
  assert.deepEqual(rejected, ['floorLevel=normal']);
  assert.deepEqual(PlanSettable.applySettings('room', null, 'floorLevel=normal', {}, { floor: 1, edit: true }), { floorLevel: 'normal' });
  assert.deepEqual(PlanSettable.applySettings('room', null, 'floorLevel=doma', {}, { floor: 1, edit: true }), { floorLevel: 'doma' });
  // 編集の印は true のときだけ(真っぽい値で読み取りが編集の選択肢を受けない)
  assert.deepEqual(PlanSettable.applySettings('room', null, 'floorLevel=normal', {}, { edit: 'yes' }), {});
});

test('normal の深さは 0(設定パネルの「床の構造面 ±0mm」と同じ)', () => {
  const HeightModel = require('../../assets/js/height-model.js');
  const p = { heightDefaults: { modelVersion: 2, floorThickness: 220, perFloor: true }, floors: { 2: { floorThickness: 260 } } };
  [p, {}].forEach((plan) => [1, 2].forEach((fl) => assert.equal(HeightModel.floorLevelRaiseMm(plan, fl, 'normal'), 0)));
  const def = PlanSettable.SETTINGS.room.find((d) => d.key === 'floorLevel');
  def.editChoices.forEach(([v]) => assert.equal(typeof HeightModel.floorLevelRaiseMm(p, 1, v), 'number', v));
  // パネルの ±0 の選択肢は値 0
  const constants = read('assets/js/app-constants.js');
  const panel = constants.slice(constants.indexOf('function selectedRoomFloorHtml'), constants.indexOf('function selectedRoomFloorHtml') + 900);
  assert.match(panel, /<option value="0">床の構造面 ±0mm<\/option>/);
});
