const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const s=require('./app-source.cjs').appSource();
const cfg=s.slice(s.indexOf('var SITE_SURFACE_OPTIONS ='),s.indexOf('function siteSurfaceType'));
const fn=s.slice(s.indexOf('function makeGroundSurfaceMaterial'),s.indexOf('function makeSiteSurfaceMaterial'));
test('small surfaces retain physical scale; normal maps are linear and nonmetallic',()=>{
 const ctx={LIGHT_SETTINGS:{env:1},ren:null,applyTextureFlip(){},getTexture3D:k=>k,cloneRepeatReadyTexture:()=>({repeat:{set(x,y){this.x=x;this.y=y;}}}),THREE:{MeshStandardMaterial:function(p){Object.assign(this,p);},Vector2:function(x,y){this.x=x;this.y=y;},NoColorSpace:'linear',RepeatWrapping:1,DoubleSide:2}};
 vm.createContext(ctx);vm.runInContext(cfg+fn,ctx);
 for(const key of ['grass','gravel','sand','concrete']){const m=ctx.makeGroundSurfaceMaterial(key,.5,3,{});assert.equal(m.map.repeat.x,.5/ctx.SITE_SURFACE_OPTIONS[key].tileM);assert.equal(m.normalMap.repeat.x,m.map.repeat.x);assert.equal(m.normalMap.colorSpace,'linear');assert.equal(m.metalness,0);}
});
