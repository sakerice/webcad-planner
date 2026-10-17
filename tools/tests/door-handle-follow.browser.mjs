// ウォークスルーで扉が開くとき、取っ手(レバー・丸座・プッシュプルバー・引手)が
// 扉と一緒に動くことを見る。
//
// 経緯: 描画の最適化でグループ内の同じ材質のメッシュを1つに統合している
// (mergeGroupMeshes)。比較モード(PR #93)で統合がサブグループの奥まで降りる
// ようになり、開き戸の回転軸グループ(pivot)に noMerge が無かったため、
// 取っ手の部品が統合されて回転軸の外(建具グループ直下)へ付け替えられた。
// 結果、扉だけが回って取っ手が壁に残った。引き違い戸の可動側の引手は、
// それ以前から可動戸ではなく建具グループに付いていて動かなかった。
//
// 判定は「開閉アニメが動かす物(pivot / slideMesh)を実際に開閉位置へ動かし、
// 金物の世界座標が扉と同じだけ動いたか」で見る。構造(親子関係)ではなく結果で見る。
import assert from 'node:assert/strict';
const _pw=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const chromium=_pw.chromium||(_pw.default&&_pw.default.chromium);
const browser=await chromium.launch({args:['--use-angle=metal']});
try{
 const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.APP_URL||'http://localhost:8932/');await page.waitForFunction(()=>window.THREE&&typeof buildWinFrames==='function');await page.evaluate(()=>init3D());
 const result=await page.evaluate(()=>{
  DATA.walls=[mkWall(0,0,4000,0,1,120,'#dddddd')];
  const out=[];
  // 金物の材質色。index.html の建具生成で使っている色と同じ。
  const HW={lever:'b9bcc0',pull:'55504a',knob:'9fa4a9'};
  function hardwareMeshes(grp){
    const list=[];grp.traverse(o=>{if(o.isMesh&&o.material&&o.material.color&&Object.values(HW).includes(o.material.color.getHexString()))list.push(o);});return list;
  }
  function center(o){o.updateWorldMatrix(true,false);return new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());}
  for(const type of ['door-swing','door-front','door-slide','door-slide-s','door-fold']){
   const it=mkItem(type,1000,-50,0,1);it.doorOpenState='closed';DATA.items=[it];
   sc3=new THREE.Scene();_doorAnims=[];buildWinFrames(1);
   if(!_doorAnims.length)throw Error('Missing door animation for '+type);
   const grp=_doorAnims[0].grp;
   const hw=hardwareMeshes(grp);
   const before=hw.map(center);
   // 開閉アニメがやることをそのまま再現する
   for(const d of _doorAnims){ if(d.pivot) d.pivot.rotation.y=d.openY; else if(d.slideMesh) d.slideMesh.position.x=d.openX; }
   grp.updateWorldMatrix(true,true);
   const after=hw.map(center);
   const moved=hw.map((m,i)=>before[i].distanceTo(after[i])>0.05);
   // 引き違い戸は固定戸の引手が残るので「動いた物が在る」で見る。
   // それ以外は金物が全部動く(丁番は吊元にあるので回っても動かない→除く)。
   const hinge=hw.map(m=>m.geometry.parameters&&m.geometry.parameters.width===0.012);
   out.push({type,hardware:hw.length,moved:moved.filter(Boolean).length,
     stuck:hw.filter((m,i)=>!moved[i]&&!hinge[i]).length});
  }
  return out;
 });
 for(const row of result){
  assert.ok(row.hardware>0,row.type+': 金物が無い');
  if(row.type==='door-slide'){ assert.ok(row.moved>0,row.type+': 可動戸の引手が動かない'); }
  else { assert.equal(row.stuck,0,row.type+': 扉と一緒に動かない金物がある'); }
 }
 assert.deepEqual(errors,[]);console.log(JSON.stringify(result,null,2));
}finally{await browser.close();}
