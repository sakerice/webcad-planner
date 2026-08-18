// 起動時の既定間取り選択。
//
// 保存プランの復元も共同編集も無い起動(=既定間取りで始まる起動)にだけ、
// 2階建て/3階建てを選ぶダイアログを出す。ここが壊れる形は3つ:
//   1. 台帳のファイルが実在しない/壊れたJSONを指す
//   2. 編集が始まったあとにダイアログが出て、選択が作業を消す
//   3. 起動の流れから呼び出しが外れて、ダイアログが二度と出ない
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');

const ROOT = join(__dirname, '..', '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

test('台帳の既定間取りは全ファイルが実在し、壁と部屋を持つ', () => {
  const m = html.match(/var PRESET_PLANS=\{[\s\S]*?\n\};/);
  assert.ok(m, 'PRESET_PLANS が index.html に無い');
  const files = [...m[0].matchAll(/file:'([^']+)'/g)].map((x) => x[1]);
  assert.ok(files.length >= 2, '既定間取りが2つ未満: ' + files.join(', '));
  assert.ok(files.includes('assets/default_plan.json'), '2階建てが台帳に無い');
  assert.ok(files.includes('assets/default_plan_3f.json'), '3階建てが台帳に無い');
  for (const f of files) {
    const p = join(ROOT, f);
    assert.ok(existsSync(p), f + ' が実在しない');
    const plan = JSON.parse(readFileSync(p, 'utf8'));
    assert.ok((plan.walls || []).length >= 20, f + ' の壁が少なすぎる');
    assert.ok((plan.rooms || []).length >= 10, f + ' の部屋が少なすぎる');
  }
});

test('ダイアログは既定間取りで始まる起動にだけ出る(作業を消さない)', () => {
  const offer = html.match(/function maybeOfferPresetChoice\(\)\{[\s\S]*?\n\}/);
  assert.ok(offer, 'maybeOfferPresetChoice が無い');
  assert.match(offer[0], /if\(!_defaultPlanPending\) return;/,
    '保存プラン復元後にもダイアログが出る(選択で作業が消える)');
  const choose = html.match(/function choosePresetPlan\(key\)\{[\s\S]*?\n\}/);
  assert.ok(choose, 'choosePresetPlan が無い');
  assert.match(choose[0], /if\(!_defaultPlanPending\) return;/,
    '選択待ちの間に別プランが開かれたときの守りが無い');
});

test('起動の流れ(共同編集→保存復元→既定)の最後に選択が挟まっている', () => {
  const at = html.indexOf('maybeOfferPresetChoice();');
  assert.notEqual(at, -1, '起動時に maybeOfferPresetChoice が呼ばれていない');
  const around = html.slice(at - 300, at);
  assert.match(around, /initSharedRoomFromUrl/, '共同編集の判定より前に出てしまう');
  assert.match(around, /checkStorageOnInit/, '保存プラン復元の判定より前に出てしまう');
});

test('3階建てプランは3層の居室と屋根を持つ', () => {
  const plan = JSON.parse(
    readFileSync(join(ROOT, 'assets', 'default_plan_3f.json'), 'utf8'));
  const floors = new Set(plan.rooms.map((r) => r.floor));
  assert.ok([1, 2, 3].every((f) => floors.has(f)), '3層になっていない');
  assert.ok(plan.items.some((it) => it.type === 'roof' && it.floor === 4),
    '屋根(4層目)が無い');
  const stairs = plan.items.filter((it) => it.type === 'stair');
  assert.equal(stairs.length, 2, '階段が2本(1F→2F, 2F→3F)無い');
  assert.ok(stairs.every((s) => s.x === stairs[0].x && s.y === stairs[0].y),
    '階段が積層されていない(位置がずれている)');
});
