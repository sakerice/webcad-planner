const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const html=fs.readFileSync('index.html','utf8');
const ctx={Math};vm.createContext(ctx);vm.runInContext(html.slice(html.indexOf('function computeSunPosition('),html.indexOf('var INTERIOR_WALL_DEFAULT')),ctx);
test('solar noon follows latitude and seasonal declination',()=>{
 for(const [season,degrees] of [['summer',77.7],['equinox',54.3],['winter',30.9]])assert.ok(Math.abs(ctx.computeSunPosition(12,season,0).altitude*180/Math.PI-degrees)<1e-8);
});
test('night sun remains below horizon and cannot illuminate buildings',()=>{
 for(const season of ['summer','equinox','winter']){const sun=ctx.computeSunPosition(0,season,0);assert.ok(sun.y<0);assert.equal(ctx.sunSimDimFactor(sun.altitude),0);assert.equal(ctx.solarNightBlend(sun.altitude),1);}
});
test('orientation rotates shadows but preserves solar elevation and radius',()=>{
 for(const hour of [0,6,12,18,24]){const a=ctx.computeSunPosition(hour,'summer',0),b=ctx.computeSunPosition(hour,'summer',90);assert.equal(a.altitude,b.altitude);assert.ok(Math.abs(Math.hypot(b.x,b.y,b.z)-220)<1e-8);assert.ok(Math.abs(a.x-b.z)<1e-8);}
});
test('summer dawn precedes equinox dawn, which precedes winter dawn',()=>{
 const dawn=s=>{for(let h=0;h<12;h+=.01)if(ctx.computeSunPosition(h,s,0).altitude>0)return h;};assert.ok(dawn('summer')<dawn('equinox'));assert.ok(dawn('equinox')<dawn('winter'));
});
