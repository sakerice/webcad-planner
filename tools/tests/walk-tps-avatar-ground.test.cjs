const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const three=import('../../assets/vendor/three/build/three.module.js');
async function model(){const T=await three,root={};vm.runInNewContext(fs.readFileSync('assets/js/walk-tps-avatar.js','utf8'),{window:root});const avatar=root.createWalkTpsPlaceholder(T);const feet=[];avatar.group.traverse(m=>{if(m.userData.walkTpsFoot)feet.push(m);});assert.equal(feet.length,2);return {T,avatar,feet};}
function state(y,phase=0,name='idle'){return {mode:'tps',state:name,locked:false,phase,avatar:{x:2,y,z:3,yaw:.7},camera:{verified:true,avatarVisible:true}};}
test('placeholder idle soles contact each actual host floor, including raised and upper floors',async()=>{
 const {T,avatar,feet}=await model();try{for(const floor of [0,.18,3.1]){avatar.pose(state(floor),floor);avatar.group.updateMatrixWorld(true);for(const foot of feet)assert.ok(Math.abs(new T.Box3().setFromObject(foot).min.y-floor)<1e-7);}}finally{avatar.dispose();}
});
test('placeholder walking keeps at least one supporting foot and never penetrates a flat floor',async()=>{
 const {T,avatar,feet}=await model();try{for(let n=0;n<80;n++){avatar.pose(state(.18,n/80,'walking'),.18);avatar.group.updateMatrixWorld(true);const soles=feet.map(m=>new T.Box3().setFromObject(m).min.y);assert.ok(soles.every(y=>y>=.18-1e-7));assert.ok(Math.min(...soles)-.18<1e-7);}}finally{avatar.dispose();}
});
test('mock seated shin fitting returns soles to the floor, then standing restores its dimensions',async()=>{
 const {T,avatar,feet}=await model();try{for(const h of [.3,.45,.6]){const s=state(2.8+h,1,'seated');s.locked=true;avatar.pose(s,2.8);avatar.group.updateMatrixWorld(true);for(const foot of feet)assert.ok(Math.abs(new T.Box3().setFromObject(foot).min.y-2.8)<1e-7);}avatar.pose(state(2.8),2.8);avatar.group.updateMatrixWorld(true);assert.ok(Math.abs(new T.Box3().setFromObject(feet[0]).min.y-2.8)<1e-7);}finally{avatar.dispose();}
});
