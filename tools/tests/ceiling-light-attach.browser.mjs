// 天井付けの照明（ダウンライト・シーリング・スポット）が、読み込んだプランで取付面
// （部屋の天井仕上げ面、軒下なら屋根の下面）に付いていることを見る。
//
// 経緯: 「1度だけ走る」寄せ直しの済み印が残ったまま既定プランが生成し直され、
// 玄関ポーチの軒下のダウンライトが屋根から約 750mm 浮いていた。印に頼らず
// 毎回寄せる作りに変えたので、既定プラン2件と、印の付いた古いプランで確かめる。
import assert from 'node:assert/strict';
const _pw=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const chromium=_pw.chromium||(_pw.default&&_pw.default.chromium);
const APP=process.env.APP_URL||'http://localhost:8932/';
const browser=await chromium.launch({args:['--use-angle=metal']});
try{
 const page=await browser.newPage({viewport:{width:1280,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(APP);await page.waitForSelector('#asset-swap-entry',{state:'attached',timeout:60000});
 // 既定プラン2件を、ページの読み込み経路（normalizeLegacyFurnitureItems を通る）で開く
 for(const url of ['assets/default_plan.json','assets/default_plan_3f.json']){
  const rows=await page.evaluate(async(url)=>{
   const plan=await (await fetch(url)).json();
   // 古い状態を再現: 済み印が付いたまま、軒下のダウンライトが固定の既定値に戻っている
   plan.planFixes=Object.assign({},plan.planFixes,{ceilingFixtureElev:1,outdoorCeilingFixtureElev:1});
   plan.items.filter(i=>i.type==='light-down').forEach(i=>{ i.elev=2600; });
   _defaultPlanPending=false; DATA=plan; resetHeightGlobalsForPlanLoad(); syncNorthFromPlan(); ensureObjectIds(); ensureExteriorWallSettings(); ensureInteriorWallSettings(); ensureRoofAppearance(); ensureFloorMetadata(); ensureHeightDefaults(); normalizeLegacyFurnitureItems();
   return DATA.items.filter(i=>CEILING_FIXTURE_TOP_MM[i.type]!==undefined&&/^light-/.test(i.type)).map(i=>{
    const want=ceilingAttachElevationMm(i);
    return {type:i.type,floor:i.floor||1,elev:Math.round(i.elev||0),attach:want===null?null:want-CEILING_FIXTURE_TOP_MM[i.type]};
   });
  },url);
  assert.ok(rows.length>10,url+': 照明が少なすぎる');
  const off=rows.filter(r=>r.attach!==null&&Math.abs(r.attach-r.elev)>1);
  assert.deepEqual(off,[],url+': 取付面から離れた照明がある');
  const outdoor=rows.filter(r=>r.elev>3000&&r.elev<4000);
  assert.ok(outdoor.length>=1,url+': 軒下のダウンライト（屋根の下面 3.3m 前後）が無い');
  // 階段室（天井が階段の穴）のダウンライトは、穴の上の階の天井に付く。1階の天井高(2538)の空中に残らない
  const stair=await page.evaluate(()=>DATA.items.filter(i=>i.type==='light-down'&&(roomAtPointOnFloor(i.floor||1,i.x+i.w/2,i.y+i.d/2)||{}).n==='階段').map(i=>{
   const fl=i.floor||1,cx=i.x+i.w/2,cy=i.y+i.d/2;
   // 穴の続く階を上がり、天井のある階（3階建ての階段室は3階）の天井を期待値にする
   let f=fl; while(f<fl+8&&ceilingHasStairHoleAt(f,cx,cy)) f++;
   const ru=roomAtPointOnFloor(f,cx,cy);
   const want=Math.round(((ru?roomFloorTopY(ru):floorTopY(f))+ceilingFinishElevationMm(f,cx,cy)*U-item3DBaseY(i))/U);
   return {id:i.id,floor:fl,elev:Math.round(i.elev),want,attachFloor:f,f1Ceil:ceilingFinishElevationMm(fl,cx,cy)};
  }));
  assert.ok(stair.length>=1,url+': 階段室のダウンライトが見つからない');
  for(const s of stair){
   assert.ok(s.elev>s.f1Ceil+500,url+': 階段室の灯 '+s.id+' が1階の天井高の空中に残っている ('+s.elev+')');
   assert.ok(Math.abs(s.elev-s.want)<=1,url+': 階段室の灯 '+s.id+' が上の階の天井 '+s.want+' に付いていない ('+s.elev+')');
  }
 }
 // 意図して下げたシーリングライト（吊り下げ扱い）は触らない。天井裏に埋まった物は下ろす
 const kept=await page.evaluate(()=>{
  const r=DATA.rooms.find(x=>x.n==='主寝室'||x.n==='LDK'||x.n==='ダイニング');
  const cx=r.x+r.w/2, cy=r.y+r.d/2;
  const low=mkItem('light-ceiling',cx-150,cy-150,0,r.floor,300,300); low.elev=1500;
  const buried=mkItem('light-ceiling',cx+300,cy+300,0,r.floor,300,300); buried.elev=9000;
  DATA.items.push(low,buried);
  snapCeilingLightsToAttachSurface();
  return {low:low.elev,buried:buried.elev,ceil:ceilingFinishElevationMm(r.floor,cx,cy)};
 });
 assert.equal(kept.low,1500,'300mm を超えて下げたシーリングライトは吊り下げとみなして触らない');
 assert.equal(kept.buried,kept.ceil,'天井裏に埋まった照明は天井面へ下ろす');
 assert.deepEqual(errors,[]);
 console.log('ok ceiling lights attached');
}finally{await browser.close();}
