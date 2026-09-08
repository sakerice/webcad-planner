const test=require('node:test');
const assert=require('node:assert/strict');
const {matches,dimensions}=require('../../assets/js/asset-catalogue.js');
test('catalogue search accepts full-width letters/digits, mixed case and Japanese categories',()=>{
 const text='Bed01 ベッド fmp-Bed01';
 assert.ok(matches(text,'ｂｅｄ０１'));assert.ok(matches(text,'ベッド BED'));assert.ok(matches(text,'  ベッド　Bed01  '));assert.ok(!matches(text,'ソファ'));assert.ok(matches(text,''));
});
test('dimensions communicate the actual manifest footprint in millimetres',()=>{
 assert.equal(dimensions({w:1210.4,d:2100.2}),'幅 1210 × 奥行 2100 mm');assert.equal(dimensions({w:0,d:2100}),'');assert.equal(dimensions({}),'');
});
