const test=require('node:test'),assert=require('node:assert/strict');
const V3=require('../../assets/js/scene-ir-v3.js');
const f=value=>({value,status:'observed',source:'synthetic test diagram'});
const inferred=value=>({...f(value),status:'inferred',reason:'Derived from independent source dimensions'});
const unknown={value:null,status:'unknown',unknownReason:'not-shown'};
const rect=(x,y,w,d)=>({x,y,w,d});
function fixture(){return {sceneVersion:3,units:'mm',coordinateSystem:'x-east-y-south-clockwise',annotations:[],walls:[],rooms:[],openings:[],objects:[],siteRegions:[],buildingFootprints:[],bindings:[],connections:[]};}
function room(){return {id:'living',floor:f(1),shape:inferred({kind:'rectUnion',rectangles:[rect(0,0,4500,3200),rect(0,3200,2600,1800)]}),boundaryBasis:f('wall-centerline'),name:f('Living / hall')};}
const codes=r=>r.diagnostics.map(d=>d.code);

test('one logical L is retained without rectangular DATA, seam walls or inferred passages',()=>{
 const s=fixture();s.rooms=[room()];const before=JSON.stringify(s);const r=V3.compile(s);
 assert.equal(r.valid,true,JSON.stringify(r.diagnostics));assert.equal(r.canApply,false);assert.equal(r.reconstructionStatus,'retained-preview-only');assert.equal(r.sourcePreview.polygons[0].outer.length,6);
 assert.equal(r.sourceScene.rooms.length,1);assert.deepEqual(r.plan,{walls:[],rooms:[],items:[]});assert.equal(JSON.stringify(s),before);
 assert.equal(V3.contains(r.sourcePreview.polygons[0].outer,{x:4000,y:4500}),false);
 r.sourceScene.rooms[0].name.value='changed';assert.equal(s.rooms[0].name.value,'Living / hall');
});

test('equivalent orthogonal polygon and union retain their original source representation',()=>{
 const s=fixture();s.rooms=[room()];const poly=V3.compile(s).sourcePreview.polygons[0].outer;
 s.rooms[0].shape=inferred({kind:'orthogonalPolygon',outer:poly.slice().reverse()});const r=V3.compile(s);assert.equal(r.valid,true);assert.deepEqual(r.sourceScene.rooms[0].shape,s.rooms[0].shape);assert.deepEqual(r.sourcePreview.polygons[0].outer,poly);
});

test('disconnected unions, point contacts, holes, repeated edges, diagonal and self-crossing polygons reject',()=>{
 const shapes=[{kind:'rectUnion',rectangles:[rect(0,0,10,10),rect(11,0,10,10)]},{kind:'rectUnion',rectangles:[rect(0,0,10,10),rect(10,10,10,10)]},{kind:'rectUnion',rectangles:[rect(0,0,30,10),rect(0,20,30,10),rect(0,10,10,10),rect(20,10,10,10)]},{kind:'orthogonalPolygon',outer:[{x:0,y:0},{x:10,y:0},{x:5,y:0},{x:5,y:10},{x:0,y:10}]},{kind:'orthogonalPolygon',outer:[{x:0,y:0},{x:10,y:1},{x:10,y:10},{x:0,y:10}]},{kind:'orthogonalPolygon',outer:[{x:0,y:0},{x:20,y:0},{x:20,y:20},{x:10,y:20},{x:10,y:-10},{x:0,y:-10}]}];
 for(const shape of shapes){const s=fixture();s.rooms=[{...room(),shape:f(shape)}];const r=V3.compile(s);assert.equal(r.valid,false,JSON.stringify(shape));assert.ok(codes(r).includes('invalid_shape'));}
});

test('independent dimensions preserve basis and chain values; conflicts never rewrite observations',()=>{
 const s=fixture();for(const [id,values,basis] of [['outer',[7200],'outer-face'],['centers',[4500,2500],'wall-centerline'],['clear',[2340,4800],'clear-face'],['chain',[227.5,1137.5],'nominal-module']])s.annotations.push({id,kind:'dimension',literalText:f(values.join('+')),valuesMm:f(values),basis:f(basis)});
 assert.equal(V3.compile(s).valid,true);s.annotations[1].spanMm=f(7200);const r=V3.compile(s);assert.equal(r.valid,false);assert.ok(codes(r).includes('dimension_conflict'));assert.deepEqual(r.sourceScene.annotations[1].valuesMm.value,[4500,2500]);
});

test('source objects and diagram colors do not depend on catalog identities, fronts or finish channels',()=>{
 const s=fixture();s.rooms=[room()];s.siteRegions=[{id:'parking',role:f('parking'),shape:f({kind:'rectUnion',rectangles:[rect(-3000,0,2500,5000)]})}];
 s.objects=[{id:'car',objectType:f('car'),semanticExtent:f('asset'),placement:f({domain:'exterior',regionId:'parking'}),sourceFootprint:inferred({center:{x:-1700,y:2500},sizeMm:{w:1800,d:4400},axisX:{x:1,y:0}}),frontDirection:f({x:0,y:-1}),heightMm:unknown,appearance:{diagramColor:f('#668899')}},{id:'chair',objectType:f('chair'),semanticExtent:f('asset'),placement:f({domain:'room',roomId:'living'}),sourceFootprint:inferred({center:{x:1500,y:1500},sizeMm:{w:600,d:600},axisX:{x:1,y:0}}),frontDirection:f({x:0,y:-1}),appearance:{diagramColor:f('#ff8800')}}];
 s.bindings=[{id:'map-car',sourceEntityId:'car',catalogId:f('car'),sizingPolicy:'native'},{id:'map-chair',sourceEntityId:'chair',catalogId:unknown,sizingPolicy:'proxy'}];
 const r=V3.compile(s,{registry:{get:()=>({w:2083,d:4790,front:null})}});assert.equal(r.valid,true);assert.ok(codes(r).includes('mapping_unresolved'));assert.deepEqual(r.diagnostics.find(d=>d.code==='native_size_mismatch').deltaMm,{w:283,d:390});
 assert.equal(r.sourceScene.objects[0].sourceFootprint.value.sizeMm.w,1800);assert.equal(r.sourceScene.objects[0].frontDirection.value.y,-1);assert.equal(r.sourceScene.objects[1].appearance.specifiedMaterial,undefined);assert.equal(r.sourceScene.objects[0].heightMm.value,null);
});

test('source entry drop, tile module and exterior region subtraction remain explicit and separate',()=>{
 const s=fixture();s.rooms=[room(),{...room(),id:'entry',shape:f({kind:'rectUnion',rectangles:[rect(2700,3300,1740,1840)]}),boundaryBasis:f('clear-face'),relativeElevation:{offsetMm:f(-150),relativeToId:f('living')},appearance:{pattern:f('square-grid'),moduleMm:f(300),diagramColor:f('#777777')}}];
 s.buildingFootprints=[{id:'building',shape:inferred({kind:'rectUnion',rectangles:[rect(0,0,7200,8000)]}),boundaryBasis:f('outer-face')}];s.siteRegions=[{id:'parcel',role:f('parcel-boundary'),shape:inferred({kind:'rectUnion',rectangles:[rect(-1000,-1300,12000,11000)]})},{id:'ground',role:f('ground'),shape:inferred({kind:'rectUnion',rectangles:[rect(-1000,-1300,12000,11000)]}),subtractRegionIds:['building'],relativeElevation:{offsetMm:unknown,relativeToId:unknown}}];
 const r=V3.compile(s);assert.equal(r.valid,true,JSON.stringify(r.diagnostics));assert.equal(r.sourceScene.rooms[1].relativeElevation.offsetMm.value,-150);assert.equal(r.sourceScene.rooms[1].appearance.moduleMm.value,300);assert.equal(r.sourceScene.siteRegions[1].relativeElevation.offsetMm.value,null);assert.equal(r.plan.rooms.length,0);assert.equal(r.plan.walls.length,0);
});

test('one physical opening retains distinct leaf pivot and full pocket geometry with no canonical defaults',()=>{
 const s=fixture();s.rooms=[room()];s.walls=[{id:'wall',floor:f(1),start:f({x:0,y:5100}),end:f({x:5000,y:5100}),thicknessMm:f(200)}];
 s.openings=[{id:'gap',floor:f(1),hostWallId:f('wall'),adjacentRoomIds:f(['living',null]),start:f({x:3100,y:5100}),end:f({x:4000,y:5100}),mechanism:f('swing'),leaves:[{id:'leaf',mechanism:f('swing'),hingeJamb:f('start'),pivot:f({x:3100,y:5000}),closedAxis:f({x:1,y:0}),leafWidthMm:f(900),swingSide:f({x:0,y:-1})}]},{id:'pocket-gap',floor:f(1),hostWallId:f('wall'),adjacentRoomIds:f(['living',null]),start:f({x:1000,y:5100}),end:f({x:1900,y:5100}),mechanism:f('pocket'),leaves:[{id:'pocket-leaf',mechanism:f('pocket'),leafWidthMm:f(940),travelDirection:f({x:1,y:0}),travelDistanceMm:f(940),pocketRegion:f({kind:'rectUnion',rectangles:[rect(1900,5050,980,100)]})}]}];
 const r=V3.compile(s);assert.equal(r.valid,true);assert.equal(r.sourceScene.openings[0].start.value.y,5100);assert.equal(r.sourceScene.openings[0].leaves[0].pivot.value.y,5000);assert.equal(r.sourceScene.openings[1].leaves[0].travelDistanceMm.value,940);assert.deepEqual(r.defaults,[]);
});

test('unsafe IDs, invented extensions, nonfinite/out of bounds numbers, false unknowns and invalid references reject',()=>{
 for(const mutate of [s=>s.rooms[0].id='__proto__',s=>s.rooms[0].onclick='x',s=>s.rooms[0].shape.value.rectangles[0].x=Infinity,s=>s.rooms[0].shape.value.rectangles[0].w=1000001,s=>s.rooms[0].name={value:'Known',status:'unknown'},s=>s.rooms[0].shape.evidenceRefs=['missing'],s=>s.rooms[0].shape.source=' ',s=>s.rooms[0].relativeElevation={offsetMm:f(-150),relativeToId:f('missing')},s=>s.rooms[0].shape={value:null,status:'unknown',unknownReason:'unsupported-by-renderer'}]){const s=fixture();s.rooms=[room()];mutate(s);assert.equal(V3.compile(s).valid,false);}
});

test('unknown shape stays unknown, while known unsupported shape stays nonnull regardless of review options',()=>{
 const s=fixture();s.rooms=[room(),{...room(),id:'unreadable',shape:{value:null,status:'unknown',unknownReason:'unreadable'}}];const r=V3.compile(s,{acceptedReviews:['scene'],acknowledgedOmissions:['living'],acceptedGroups:['rooms:living']});assert.equal(r.valid,true);assert.equal(r.canApply,false);assert.equal(r.sourceScene.rooms[1].shape.value,null);assert.ok(r.sourceScene.rooms[0].shape.value);assert.deepEqual(r.acknowledgedOmissions,[]);
});
module.exports={fixture,room,f,unknown};

test('preview groups expose retained evidence without materialization; region cycles and overflowing extents reject',()=>{
 const s=fixture();s.rooms=[room()];assert.ok(V3.compile(s).reviewGroups[0].evidence.some(e=>e.path==='scene.rooms[0].shape'));
 s.rooms[0].shape=f({kind:'rectUnion',rectangles:[rect(999999,0,10,10)]});assert.equal(V3.compile(s).valid,false);
 s.rooms=[];s.siteRegions=['a','b'].map((id,i)=>({id,role:f('ground'),shape:f({kind:'rectUnion',rectangles:[rect(0,0,10,10)]}),subtractRegionIds:[i?'a':'b']}));assert.ok(codes(V3.compile(s)).includes('cyclic_subtraction'));
});

test('frozen schema and prompt/capability hashes reproduce the runtime contract',()=>{
 const fs=require('node:fs'),crypto=require('node:crypto'),path=require('node:path');const dir=path.resolve(__dirname,'../../docs/scene-ir');const frozen=JSON.parse(fs.readFileSync(path.join(dir,'schema-v3.json')));assert.deepEqual(frozen,V3.schema);
 const manifest=JSON.parse(fs.readFileSync(path.join(dir,'freeze-v3.json')));for(const [file,entry] of Object.entries(manifest.files))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(dir,file))).digest('hex'),entry.sha256);
});
test('signed swing angle inconsistent with known closed axis and swing side rejects without rewriting source',()=>{const s=fixture();s.rooms=[room()];s.walls=[{id:'wall',floor:f(1),start:f({x:0,y:0}),end:f({x:4500,y:0}),thicknessMm:f(120)}];s.openings=[{id:'door',floor:f(1),hostWallId:f('wall'),adjacentRoomIds:f(['living',null]),start:f({x:1000,y:0}),end:f({x:1900,y:0}),mechanism:f('swing'),leaves:[{id:'leaf',mechanism:f('swing'),closedAxis:f({x:1,y:0}),swingSide:f({x:0,y:-1}),angleDeg:f(90)}]}];const before=JSON.stringify(s),r=V3.compile(s);assert.equal(r.valid,false);assert.ok(codes(r).includes('source_angle_direction_conflict'));assert.equal(JSON.stringify(s),before);assert.equal(r.sourceScene.openings[0].leaves[0].angleDeg.value,90);});
