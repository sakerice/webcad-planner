const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'../..');
test('actual Worker extraction packet inventories every existing semantic object type without adding a parallel schema',async()=>{
 const {frozenPacket}=await import('../../worker/scene-ir-v3-contract.mjs'),packet=await frozenPacket(),schema=JSON.parse(packet.schemaText),cap=JSON.parse(packet.capabilitiesText),types=schema.properties.objects.items.properties.objectType.oneOf[0].properties.value.enum;
 assert.deepEqual(cap.extractionInventory.objects,types);assert.match(packet.promptText,/hanging storage, cabinet-like objects, shower fixtures/);assert.match(packet.promptText,/unidentified-symbol with source evidence/);assert.match(packet.promptText,/Inventory each visible object separately/);
 assert.equal(packet.schemaText,fs.readFileSync(path.join(root,'docs/scene-ir/schema-v3.json'),'utf8'));assert.equal(packet.promptText,fs.readFileSync(path.join(root,'docs/scene-ir/extraction-prompt-v3.txt'),'utf8'));assert.equal(packet.capabilitiesText,fs.readFileSync(path.join(root,'docs/scene-ir/capabilities-v3.json'),'utf8'));
});
test('packet states independent opening dimensions and unknowns instead of treating renderer defaults as source',async()=>{
 const {frozenPacket}=await import('../../worker/scene-ir-v3-contract.mjs'),p=await frozenPacket();assert.match(p.promptText,/leafWidthMm is the separate panel width, not automatically the gap width/);assert.match(p.promptText,/Do not infer a pivot coordinate from hingeJamb/);assert.match(p.promptText,/Unknown gap span, leaf width, pivot and hinge-jamb association remain independently unknown/);assert.match(p.promptText,/No renderer texture IDs or roughness in source appearance/);
});
test('inventory guidance preserves unsupported exterior evidence without enabling paid image import or certifying construction',async()=>{
 const {frozenPacket,sceneIRV3Capability}=await import('../../worker/scene-ir-v3-contract.mjs'),p=await frozenPacket(),c=JSON.parse(p.capabilitiesText);assert.match(p.promptText,/balcony floor boundary, railing symbol/);assert.match(p.promptText,/do not silently delete it, invent rail height\/material/);assert.match(c.retainedGeometry.stairs,/not certified 3D/);assert.equal(c.canApply,false);assert.equal(c.imageRouteDefault,'v1');assert.deepEqual(sceneIRV3Capability({},false),{});
});
