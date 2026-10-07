'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {runtime,fixture,clone}=require('./parallel-view-preferences-support.cjs');
test('A/B installs restore independent runtime preferences and controller floor camera; missing legacy fields use defaults',async()=>{
 const r=runtime(),c=r.ctx;c.ST.showGrid=false;c.ST.showDim=false;c.ST.snap=455;Object.assign(c.LIGHT_SETTINGS,{hour:7,season:'winter',haze:.8,room:.9});c.CeilingDesigner.setSurface('ceiling');c.camExt.position.set(2,-5,3);const a=clone(r.editor.state());
 await r.editor.install(fixture('B',180));assert.equal(c.ST.ceilingView,false);assert.equal(c.ST.showGrid,true);assert.equal(c.ST.showDim,true);assert.equal(c.ST.snap,10);assert.equal(c.LIGHT_SETTINGS.hour,13);assert.equal(c.LIGHT_SETTINGS.haze,undefined);assert.equal(c.LIGHT_SETTINGS.northDeg,180);assert.equal(c.DATA.autoRoomLights,false);
 const b=clone(r.editor.state());await r.editor.install(a.plan,a);assert.deepEqual(clone(r.editor.view()),a.view);assert.equal(c.LIGHT_SETTINGS.northDeg,45);assert.equal(c.DATA.autoRoomLights,false);c.CeilingDesigner.setSurface('floor');assert.deepEqual(c.camExt.position.toArray(),[1,8,4]);assert.equal(c.orbit.minPolarAngle,0);assert.equal(c.orbit.maxPolarAngle,Math.PI);
 await r.editor.install(b.plan,b);assert.equal(c.ST.ceilingView,false);assert.equal(c.LIGHT_SETTINGS.hour,13);assert.equal(c.LIGHT_SETTINGS.northDeg,180);
});
test('failed ceiling exit rebuild restores public and private view, preferences, DATA identity and history',async()=>{
 const r=runtime(),c=r.ctx;c.CeilingDesigner.setSurface('ceiling');c.ST.showGrid=false;c.ST.snap=910;c.LIGHT_SETTINGS.hour=22;const before=r.editor.captureInstallState(),surface=clone(c.CeilingDesigner.captureViewContext());r.fail('build');await assert.rejects(r.editor.install(fixture('B',270)),/synthetic build fault/);
 assert.equal(c.DATA,before.data);assert.deepEqual(clone(r.editor.view()),clone(before.view));assert.deepEqual(clone(c.CeilingDesigner.captureViewContext()),surface);assert.deepEqual(c.HISTORY,['A-history']);assert.deepEqual(c.REDO_HISTORY,['A-redo']);c.CeilingDesigner.setSurface('floor');assert.deepEqual(c.camExt.position.toArray(),surface.floorCamera.pos);
});
test('camera apply keeps target preferences and DATA, uses its ceiling orbit limits before restoring upward camera',()=>{
 const r=runtime(),c=r.ctx;c.CeilingDesigner.setSurface('ceiling');c.ST.snap=455;c.LIGHT_SETTINGS.hour=7;const target=clone(r.editor.view()),data=JSON.stringify(c.DATA),history=c.HISTORY.slice();target.twoD={zoom:3,panX:1,panY:2};target.camera.pos=[1,-9,4];r.editor.applyView(target);assert.equal(c.ST.ceilingView,true);assert.equal(c.ST.snap,455);assert.equal(c.LIGHT_SETTINGS.hour,7);assert.equal(c.orbit.maxPolarAngle,Math.PI-.01);assert.deepEqual(c.camExt.position.toArray(),[1,-9,4]);assert.equal(JSON.stringify(c.DATA),data);assert.deepEqual(c.HISTORY,history);
 r.editor.applyView({twoD:{zoom:4,panX:3,panY:5}});assert.equal(c.ST.ceilingView,true);assert.equal(c.LIGHT_SETTINGS.hour,7);assert.equal(c.ST.snap,455);
});
test('option-only input/change notifications do not request camera propagation or dirty/history changes',()=>{
 const r=runtime(),c=r.ctx,before=JSON.stringify(c.DATA),history=c.HISTORY.slice();c.LIGHT_SETTINGS.hour=8;r.emit('input');c.ST.snap=100;r.emit('change');assert.deepEqual(c.notifications,[{id:'pane-A',cameraChanged:false},{id:'pane-A',cameraChanged:false}]);assert.equal(c.DIRTY,false);assert.equal(JSON.stringify(c.DATA),before);assert.deepEqual(c.HISTORY,history);c.ST.panX+=10;r.emit('wheel');assert.equal(c.notifications.at(-1).cameraChanged,true);
});
test('view restore whitelists lighting and rejects nonfinite values without copying north/plan auto lights',()=>{
 const r=runtime(),c=r.ctx;r.editor.applyView({preferences:{snap:NaN,lighting:{northDeg:330,autoRoomLights:true,hour:99,haze:-1,cloud:Infinity,room:3,sun:-5,season:'invalid',timeOfDay:'invalid',futureKey:'ignored'}}});assert.equal(c.LIGHT_SETTINGS.northDeg,45);assert.equal(c.DATA.autoRoomLights,false);assert.equal(c.LIGHT_SETTINGS.hour,24);assert.equal(c.LIGHT_SETTINGS.haze,0);assert.equal(c.LIGHT_SETTINGS.cloud,undefined);assert.equal(c.LIGHT_SETTINGS.room,1.2);assert.equal(c.LIGHT_SETTINGS.sun,0);assert.equal(c.LIGHT_SETTINGS.season,'equinox');assert.equal(c.LIGHT_SETTINGS.timeOfDay,'day');assert.equal(c.LIGHT_SETTINGS.futureKey,undefined);
});
test('surface view restoration and failed install never migrate admitted legacy ceilingAreas or dirty untouched DATA',async()=>{
 const r=runtime(),c=r.ctx;c.DATA.rooms[0].ceilingAreas=[{id:'legacy-ceiling',x:100,y:100,w:1000,d:1000,offset:-150}];const raw=JSON.stringify(c.DATA);
 const v=clone(r.editor.view());v.surface={ceilingView:true,floorCamera:null};r.editor.applyView(v);assert.equal(JSON.stringify(c.DATA),raw);assert.equal(c.DIRTY,false);const before=r.editor.captureInstallState();r.fail('build');await assert.rejects(r.editor.install(fixture('B')));assert.equal(c.DATA,before.data);assert.equal(JSON.stringify(c.DATA),raw);
});
test('restoring 2D ceiling private camera does not require a ready THREE engine',()=>{
 const r=runtime(),c=r.ctx;c.CeilingDesigner.setSurface('ceiling');const saved=clone(r.editor.view());c.setView('2d');saved.view='2d';delete c.THREE;r.editor.applyView(saved);assert.equal(c.ST.view,'2d');assert.deepEqual(clone(c.CeilingDesigner.captureViewContext().floorCamera),saved.surface.floorCamera);
});
test('legacy missing surface install exits 2D ceiling with native floor orbit defaults',async()=>{
 const r=runtime(),c=r.ctx;c.CeilingDesigner.setSurface('ceiling');c.setView('2d');assert.equal(c.orbit.minPolarAngle,.01);await r.editor.install(fixture('B'));assert.equal(c.ST.ceilingView,false);assert.equal(c.CeilingDesigner.captureViewContext().floorCamera,null);assert.equal(c.orbit.minPolarAngle,0);assert.equal(c.orbit.maxPolarAngle,Math.PI);
});
test('2D ceiling remount installs before delayed THREE, retaining private stash as serializable arrays',async()=>{
 const first=runtime();first.ctx.CeilingDesigner.setSurface('ceiling');first.ctx.setView('2d');const saved=clone(first.editor.state()),r=runtime();r.ctx.ST.view='2d';r.ctx.camExt=null;r.ctx.orbit=null;r.ctx.ren=null;r.ctx.threeModulesReady=false;delete r.ctx.THREE;assert.equal(await r.editor.install(saved.plan,saved),true);assert.equal(r.ctx.ST.ceilingView,true);assert.deepEqual(clone(r.ctx.CeilingDesigner.captureViewContext().floorCamera),saved.view.surface.floorCamera);
});
