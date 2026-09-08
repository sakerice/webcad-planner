const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync('index.html','utf8');const start=html.indexOf('function skySunUv('),end=html.indexOf('function makeSkyTexture(',start);const ctx={Math};vm.createContext(ctx);vm.runInContext(html.slice(start,end),ctx);
test('equirectangular altitude uses angular elevation, with horizon at half height',()=>{assert.equal(ctx.skySunUv({x:1,y:0,z:0},true).v,.5);assert.equal(ctx.skySunUv({x:0,y:1,z:0},true).v,0);assert.equal(ctx.skySunUv({x:0,y:-1,z:0},true).v,1);assert.ok(Math.abs(ctx.skySunUv({x:1,y:1,z:0},true).v-.25)<1e-10);});
test('display sphere and IBL share sun direction with their own UV conventions',()=>{const a=ctx.skySunUv({x:0,y:0,z:1},true),b=ctx.skySunUv({x:0,y:0,z:1},false);assert.equal(a.u,.75);assert.equal(b.u,.25);assert.equal(a.v,b.v);});
test('sunset glow interpolates colour and alpha without a threshold jump',()=>{
 const a=html.indexOf('function blendSkyRgba('),b=html.indexOf('function makeSkyTexture(',a);vm.runInContext(html.slice(a,b),ctx);
 const before=ctx.blendSkyRgba('rgba(255,249,205,0.45)','rgba(255,128,50,0.5)',.499);
 const after=ctx.blendSkyRgba('rgba(255,249,205,0.45)','rgba(255,128,50,0.5)',.501);
 const x=before.match(/[\d.]+/g).map(Number),y=after.match(/[\d.]+/g).map(Number);
 x.forEach((v,i)=>assert.ok(Math.abs(v-y[i])<=1));
 assert.equal(ctx.blendSkyRgba('rgba(255,249,205,0.45)','rgba(255,128,50,0.5)',0),'rgba(255,249,205,0.450)');
});
test('solar twilight reaches night smoothly and direct sunlight vanishes below horizon',()=>{
 const a=html.indexOf('function solarNightBlend('),b=html.indexOf('\nvar INTERIOR_WALL_DEFAULT',a);vm.runInContext(html.slice(a,b),ctx);
 assert.equal(ctx.solarNightBlend(Math.PI/4),0);assert.equal(ctx.solarNightBlend(-Math.PI/6),1);
 assert.equal(ctx.sunSimDimFactor(-.01),0);
 let last=0;for(let deg=4;deg>=-9;deg-=.1){const v=ctx.solarNightBlend(deg*Math.PI/180);assert.ok(v>=last-1e-10);assert.ok(v-last<.02);last=v;}
});
