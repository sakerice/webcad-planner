const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync('index.html','utf8');
function source(name){return html.match(new RegExp('function '+name+'\\(\\)\\{[\\s\\S]*?\\n\\}'))[0];}
function setup(){let verified=false,cameras=0;const button={attrs:{},setAttribute(k,v){this.attrs[k]=v;}};
 const ctx={WALK:{eyePreset:'stand'},WalkTps:{cameraVerified:()=>verified},document:{getElementById:()=>button},walkApplyCamera(){cameras++;},noteCam3DInput(){},invalidate3D(){}};
 vm.createContext(ctx);vm.runInContext(source('updateWalkEyePresetButton')+'\n'+source('toggleWalkEyePreset'),ctx);
 return {ctx,button,setVerified:v=>verified=v,cameras:()=>cameras};}
test('verified TPS disables FPS-only eye height and direct activation cannot change the stored preset',()=>{
 const t=setup();t.setVerified(true);t.ctx.updateWalkEyePresetButton();assert.equal(t.button.disabled,true);assert.match(t.button.innerHTML,/TPS/);t.ctx.toggleWalkEyePreset();assert.equal(t.ctx.WALK.eyePreset,'stand');assert.equal(t.cameras(),0);
});
test('FPS fallback restores the saved preset and its real camera-height action',()=>{
 const t=setup();t.ctx.toggleWalkEyePreset();assert.equal(t.ctx.WALK.eyePreset,'sit');t.setVerified(true);t.ctx.updateWalkEyePresetButton();t.setVerified(false);t.ctx.updateWalkEyePresetButton();assert.equal(t.button.disabled,false);assert.equal(t.button.attrs['aria-pressed'],'true');assert.match(t.button.innerHTML,/座り/);t.ctx.toggleWalkEyePreset();assert.equal(t.ctx.WALK.eyePreset,'stand');assert.equal(t.cameras(),2);
});
test('ordinary FPS has no dependency on a loaded TPS runtime',()=>{
 const t=setup();delete t.ctx.WalkTps;t.ctx.updateWalkEyePresetButton();assert.equal(t.button.disabled,false);t.ctx.toggleWalkEyePreset();assert.equal(t.ctx.WALK.eyePreset,'sit');
});
