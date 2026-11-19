// 古い読み取り(import-plan・revise-plan)の部屋の名前も、新しい読み取り(plan-free-apply.js の ROOM_NAME_MAX)と同じく、
// 見えない文字・制御文字を落として 40 字に切る。中身は plan-settable.js の tidyText(plan-settable.test.cjs が確かめる)。
// ここは、画面の取り込み(plan-import.js の toAppObjects。新旧どちらの読み取りも通る)が名前をそれに通すことを見る。
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const ROOT = join(__dirname, '..', '..');

test('読み取りの取り込み(toAppObjects)は、部屋の名前を tidyText で 40 字に切る', () => {
  const src = readFileSync(join(ROOT, 'assets', 'js', 'plan-import.js'), 'utf8');
  const at = src.indexOf('function toAppObjects(');
  assert.notEqual(at, -1);
  const body = src.slice(at, src.indexOf('\n  }\n', at));
  assert.match(body, /PlanSettable\.tidyText\(r\.n \|\| '', 40\)/);
  assert.match(body, /makeRoom\(\{x: r\.x, y: r\.y, w: r\.w, d: r\.d, floor: floor, n: name\}/);
  const PlanSettable = require(join(ROOT, 'assets', 'js', 'plan-settable.js'));
  assert.equal(Array.from(PlanSettable.tidyText('居'.repeat(60), 40)).length, 40);
  assert.equal(PlanSettable.tidyText('洋室​1', 40), '洋室1');
});
