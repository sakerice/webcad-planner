// 画面の状態(ST)と間取りの実体(DATA)、その保存・復元・取り消し。
//
// index.html のインライン script から、中身を1文字も変えずに切り出した。
// ───── STATE ─────
var ST = {
  floor:1, view:'2d', tool:'select', selected:null,
  multiSelected:[],
  zoom:1, panX:60, panY:60,
  drawing:false, drawPts:[],
  mouseW:{x:0,y:0}, snap:10, showGrid:true, showDim:true,
  placingRot:0,
  isPanning:false, panStart:{x:0,y:0}, panOrigin:{x:0,y:0}, selectAll:false,
  mobileShift:true, shiftKey:true, multiSelectMode:false,
  _snapState:null  // stores active edge-snap info for visual feedback
};

// ─── Edge Snap (object-to-object + grid) ──────────
var EDGE_SNAP_THRESH = 80; // mm — object-edge snap when Shift is held

var RULER_THICKNESS_MM = 120;
var WALK_ROUTE_THICKNESS_MM = 140;
var WALK_EYE_HEIGHT_MM = 1550;
var WALK_EYE_PRESETS_MM = {sit:1050,stand:1650};
var WALK_DEFAULT_SPEED_MPS = 1.2;
var LIGHT_ITEM_TYPES = {'light-ceiling':1,'light-down':1,'light-spot':1};
var LIGHT_KIND_TO_TYPE = {ceiling:'light-ceiling',down:'light-down',spot:'light-spot'};
// 影を落とせる配置ライトの上限。シャドウマップはスポット系+1回/シーリング+6回の
// 追加描画になるため無制限にはできないが、メッシュ統合等の最適化で余力ができたので
// PC=8灯・タッチ端末=4灯まで許可する(超過分は従来通り遮蔽なし)
function maxInteriorShadowLights(){
  return ((typeof navigator!=='undefined')&&(navigator.maxTouchPoints||0)>0)?4:8;
}
var _activeInteriorShadowLightCount = 0;
function isPlanAnnotationType(type){
  return type==='memo' || type==='ruler' || type==='walk-route';
}
function isLightItemType(type){
  return !!LIGHT_ITEM_TYPES[type];
}
function lightKindFromType(type){
  if(type==='light-down') return 'down';
  if(type==='light-spot') return 'spot';
  return 'ceiling';
}
function lightTypeForKind(kind){
  return LIGHT_KIND_TO_TYPE[kind]||'light-ceiling';
}
function lightKindLabel(kind){
  return {ceiling:'シーリングライト',down:'ダウンライト',spot:'スポットライト'}[kind]||'シーリングライト';
}
function lightShapeLabel(shape){
  return shape==='line'?'線ライト':'点ライト';
}
// 天井仕上げ面の厚み。buildRoomCeilingMesh が天井面をここだけ下げて置く。
var CEILING_FINISH_M=0.012;
// 天井仕上げ面の高さ(mm)。**その階の床仕上げ面から測る**(=アイテムの elev と
// 同じ基準)。基準の取り違えが照明の浮き/埋まりの原因だったので、変換はここへ
// 集約する:
//   roomCeilingHeightM ... 床スラブ下端(floorBaseY)から
//   item の elev       ... 床仕上げ面(floorTopY)から
//   天井面のメッシュ    ... ceilY - CEILING_FINISH_M
// 部屋の天井仕上げ面の高さ(mm)。**その部屋の仕上げ床から**測る(= elev と同じ基準)。
// スキップフロアの段差も床上げも引く。elev は仕上げ床からなので、段差ぶん床が
// 上がっていれば、天井までの寸法はその分だけ縮む。
function roomCeilingElevationMm(room){
  if(!room||!isFinite(room.x)) return null;
  var fl=room.floor||1;
  return Math.round((roomCeilingHeightM(room)-floorSlabHeightMForFloor(fl)-CEILING_FINISH_M)/U)
    -(roomFloorOffsetMm(room)+roomSkipLevelMm(room));
}
function ceilingFinishElevationMm(floor,cx,cy){
  var fl=floor||1;
  var r=(isFinite(cx)&&isFinite(cy))?roomAtPointOnFloor(fl,cx,cy):null;
  if(r) return roomCeilingElevationMm(r);
  return Math.round((wallFullHeightM(fl)-floorSlabHeightMForFloor(fl)-CEILING_FINISH_M)/U);
}
// 天井付けの器具(照明・物干し)を、天井の動きに追従させる。
//
// **保つのは「天井からの下がり」である。** 天井に直付けのものは直付けのまま、
// 意図して下げてあるペンダントはその下がりのまま動く。elev は仕上げ床からなので、
// 動かす量は「床から天井までの高さ」の差そのものになる。
//
// 天井が動く操作は、段差・床上げ・天井高・天井の種類と複数ある。**どれか1つだけを
// 直しても、残りで器具が取り残される**ので、書き込む側を1か所に集めてここを通す。
function shiftRoomCeilingFixtures(room,deltaMm){
  if(!room||!deltaMm||typeof DATA==='undefined'||!DATA||!DATA.items) return 0;
  var n=0;
  DATA.items.forEach(function(it){
    if(!it) return;
    if(CEILING_FIXTURE_TOP_MM[it.type]===undefined && it.type!=='original-laundry-rail') return;
    if(roomAtPointOnFloor(it.floor,it.x+it.w/2,it.y+it.d/2)!==room) return;
    it.elev=(Number(it.elev)||0)+deltaMm;
    n++;
  });
  return n;
}
// 天井が動きうる書き換えを包む。前後の天井高を測り、差のぶんだけ器具を動かす。
function followRoomCeiling(room,mutate){
  var before=roomCeilingElevationMm(room);
  mutate();
  if(before===null) return;
  var after=roomCeilingElevationMm(room);
  if(after!==null&&after!==before) shiftRoomCeilingFixtures(room,after-before);
}
// 天井付けの器具が「くっつく面」の取付高さ(mm, **そのアイテムの足元から**)。
//
// 部屋の中なら天井仕上げ面。部屋の外でも、**上に屋根が架かっていればその下面**が
// 取り付け面である(軒天のダウンライト、ポーチの照明)。屋外を一律に「天井が無い」
// として触らずにいたため、固定の既定値のまま軒から離れて浮いていた。
// 上に何も無い場所では null を返し、呼び出し側は触らない。
//
// **足元が部屋と屋外で違う**ことに注意する。屋内は床仕上げ面、屋外は地面
// (item3DBaseY が返す)。屋根の下面はワールドの高さなので、足元を引いて戻す。
function ceilingAttachElevationMm(it){
  if(!it) return null;
  var fl=it.floor||1;
  var cx=(it.x||0)+(it.w||0)/2, cy=(it.y||0)+(it.d||0)/2;
  if(roomAtPointOnFloor(fl,cx,cy)) return ceilingFinishElevationMm(fl,cx,cy);
  var items=(typeof DATA!=='undefined'&&DATA&&DATA.items)?DATA.items:null;
  if(!items) return null;
  var roofs=items.filter(function(o){
    return o&&o.type==='roof'&&!o.hidden3D&&(o.floor||1)>=fl;
  });
  var under=roofTopLimitAtPlanPoint(roofs,cx,cy);
  if(under===null) return null;
  return Math.round((under-CEILING_FINISH_M-item3DBaseY(it))/U);
}
// 照明の既定の取付高さ。旧実装は wallFullHeightM-160 という当て推量で、
// 1階は天井から148mm下に浮き、2階は32mm上=天井裏に埋まっていた。
// 部屋が分かるなら、その部屋の天井(吹き抜けを含む)に合わせる。
function defaultLightElevationMm(floor,cx,cy){
  return Math.max(1800,ceilingFinishElevationMm(floor||ST.floor||1,cx,cy));
}
function ensureLightDefaults(it){
  if(!it || !isLightItemType(it.type)) return it;
  var kind=lightKindFromType(it.type);
  if(!it.lightKind || !LIGHT_KIND_TO_TYPE[it.lightKind]) it.lightKind=kind;
  if(!it.lightShape) it.lightShape='point';
  if(!it.lightColor) it.lightColor=it.color&&/^#/.test(String(it.color))?it.color:'#fff6dd';
  if(!isFinite(Number(it.lightIntensity))) it.lightIntensity=it.lightKind==='spot'?0.9:(it.lightKind==='down'?0.72:0.56);
  if(!isFinite(Number(it.lightRange))) it.lightRange=it.lightKind==='spot'?5200:(it.lightKind==='down'?4400:5600);
  if(!isFinite(Number(it.lightAngle))) it.lightAngle=it.lightKind==='spot'?32:64;
  if(it.lightCastShadow===undefined) it.lightCastShadow=true;
  if(!isFinite(Number(it.elev))){
    // 軒下に置いた照明は、上の屋根の下面へ付ける。屋内は従来どおり天井へ。
    var attach=ceilingAttachElevationMm(it);
    it.elev=(attach===null)
      ? defaultLightElevationMm(it.floor,it.x+it.w/2,it.y+it.d/2)
      : Math.max(1800,attach);
  }
  it.color=it.lightColor;
  return it;
}
function contextStoryHeightMm(){
  // 隣家・周辺ビルの階高。設計対象の建物の階高とは別概念なので、高さモデルを通さない。
  return Math.round(Math.max(FLOOR_H||2700,WALL_H||2400,2700));
}
function contextStoryHeightM(){
  return contextStoryHeightMm()*U;
}
function defaultContextFloors(type){
  if(type==='neighbor-building') return 4;
  if(type==='neighbor-house') return 2;
  return 1;
}
function clampContextFloors(type,floors){
  var max=type==='neighbor-building'?12:(type==='neighbor-house'?3:1);
  return Math.max(1,Math.min(max,Math.round(Number(floors)||defaultContextFloors(type))));
}
// 隣家の屋根(寄棟・軒の出200mm)の高さ。
// 基本は固定値だが、小さい隣家では勾配がきつくなりすぎるため実寸から抑える。
// 建物の高さ表示と3Dモデルを一致させるので、アイテムが分かる場合は実寸から算出する。
function contextRoofExtraHeightMm(type,it){
  if(type==='neighbor-building') return 450;
  if(type==='neighbor-house'){
    if(it&&isFinite(Number(it.w))&&isFinite(Number(it.d))&&it.w>0&&it.d>0){
      return Math.round(nhRoofHeightM(Number(it.w)*U,Number(it.d)*U)/U);
    }
    return Math.round(nhRoofHeightM(ISIZES['neighbor-house'].w*U,ISIZES['neighbor-house'].d*U)/U);
  }
  return 0;
}
function contextHeightFromFloors(type,floors,it){
  floors=clampContextFloors(type,floors);
  return Math.round(floors*contextStoryHeightMm()+contextRoofExtraHeightMm(type,it));
}
function getContextFloors(it){
  if(!it || (it.type!=='neighbor-building' && it.type!=='neighbor-house')) return 1;
  if(isFinite(Number(it.contextFloors))) return clampContextFloors(it.type,it.contextFloors);
  var h=Number(it.contextHeight);
  if(isFinite(h)){
    return clampContextFloors(it.type,(h-contextRoofExtraHeightMm(it.type,it))/Math.max(1,contextStoryHeightMm()));
  }
  return defaultContextFloors(it.type);
}
function defaultContextExteriorHeight(type){
  if(type==='neighbor-building' || type==='neighbor-house') return contextHeightFromFloors(type,defaultContextFloors(type));
  if(type==='utility-pole') return 6500;
  if(type==='road') return 70;
  return 400;
}
function getContextExteriorHeight(it){
  if(!it || !isContextExteriorItemType(it.type)) return 400;
  if(it.type==='neighbor-building' || it.type==='neighbor-house') return contextHeightFromFloors(it.type,getContextFloors(it),it);
  var h=Number(it.contextHeight);
  if(!isFinite(h)) h=defaultContextExteriorHeight(it.type);
  var max=it.type==='road'?200:30000;
  return Math.max(20,Math.min(max,h));
}
function isLineAnnotationTool(type){
  return type==='ruler' || type==='walk-route';
}
function isObjectLocked(obj){
  return !!(obj && obj.locked);
}
function setObjectLocked(obj,locked){
  if(!obj) return;
  if(locked) obj.locked=true;
  else delete obj.locked;
}
function getAllLockableObjects(){
  return DATA.walls.concat(DATA.rooms,DATA.items);
}
var LOCK_FIXTURE_TYPES = {
  bath:1,toilet:1,sink:1,kitchen:1,fridge:1,washer:1,'light-ceiling':1,'light-down':1,'light-spot':1
};
var LOCK_FURNITURE_TYPES = {
  sofa:1,loveseat_2p:1,low_table:1,'dining-table':1,dining_6:1,round_table_4:1,
  'bed-d':1,'bed-s':1,semi_double_bed:1,futon_set:1,desk:1,tv:1,
  'custom-block':1,closet:1,shoe_cabinet:1
};
function getLockFmpItem(it){
  if(!it || !it.type) return null;
  return getFmpItem(it.fmpId||it.type) || getFmpItem(bestFmpType(it.type));
}
function isLockFixtureItem(it){
  if(!it || !it.type) return false;
  var fmp=getLockFmpItem(it);
  return !!(LOCK_FIXTURE_TYPES[it.type] || (fmp && fmp.group==='住設'));
}
function isLockFurnitureItem(it){
  if(!it || !it.type) return false;
  var fmp=getLockFmpItem(it);
  return !!(LOCK_FURNITURE_TYPES[it.type] || (fmp && fmp.group==='家具' && !isBuildingComponentFmpItem(fmp)));
}
function isLockJoineryItem(it){
  if(!it || !it.type) return false;
  var fmp=getLockFmpItem(it);
  return !!(isOpeningItemType(it.type) || (fmp && isBuildingComponentFmpItem(fmp)));
}
function getLockCategoryObjects(category){
  if(category==='wall') return DATA.walls.slice();
  if(category==='floor') return DATA.rooms.concat(DATA.items.filter(function(it){return it.type==='balcony';}));
  if(category==='base') return DATA.items.filter(function(it){return it.type==='site-rect'||it.type==='foundation';});
  if(category==='roof') return DATA.items.filter(function(it){return it.type==='roof';});
  if(category==='joinery') return DATA.items.filter(isLockJoineryItem);
  if(category==='fixtures') return DATA.items.filter(isLockFixtureItem);
  if(category==='furniture') return DATA.items.filter(isLockFurnitureItem);
  if(category==='walk') return DATA.items.filter(function(it){return it.type==='walk-route';});
  return [];
}
function setLockOnObjects(list,locked){
  var changed=list.filter(function(obj){return isObjectLocked(obj)!==!!locked;});
  if(!changed.length){ syncLockBatchUi(); return; }
  sharedMarkObjectsDirty(changed);
  saveState();
  changed.forEach(function(obj){ setObjectLocked(obj,locked); });
  if(ST.selected && changed.indexOf(ST.selected)>=0) updateProps();
  syncLockBatchUi();
  draw2d();
  if(ren) rebuild3D();
}
function setAllObjectLocks(locked){
  setLockOnObjects(getAllLockableObjects(),locked);
  closeMobilePanels();
}
function setLockCategory(category,locked){
  setLockOnObjects(getLockCategoryObjects(category),locked);
}
function syncLockBatchUi(){
  [
    ['wall','lock-cat-wall'],
    ['floor','lock-cat-floor'],
    ['base','lock-cat-base'],
    ['roof','lock-cat-roof'],
    ['joinery','lock-cat-joinery'],
    ['fixtures','lock-cat-fixtures'],
    ['furniture','lock-cat-furniture'],
    ['walk','lock-cat-walk']
  ].forEach(function(pair){
    var el=document.getElementById(pair[1]);
    if(!el) return;
    var objs=getLockCategoryObjects(pair[0]);
    var lockedCount=objs.filter(isObjectLocked).length;
    el.checked=objs.length>0 && lockedCount===objs.length;
    el.indeterminate=lockedCount>0 && lockedCount<objs.length;
    el.disabled=objs.length===0;
  });
}
function selectedLockControlHtml(it){
  var locked=isObjectLocked(it);
  var html='<div class="pr"><label class="lock-control-label">';
  html+='<input data-lock-control type="checkbox" '+(locked?'checked':'')+' onchange="updateSelectedProp(\'locked\',this.checked)">編集をロック';
  html+='</label>';
  if(locked) html+='<div class="lock-status-note">ロック中です。解除するまで削除・移動・寸法/座標変更はできません。</div>';
  html+='</div>';
  html+=selectedVisibilityControlHtml(it);
  return html;
}
// AIレンダーの画角調整などのため、オブジェクト単位で3D表示を一時制御できるようにする。
// 壁: 自動カットアウェイの上書き(常に表示/非表示)。アイテム・部屋: 非表示チェック
function selectedVisibilityControlHtml(it){
  if(!it) return '';
  if(it.x1!==undefined && it.x2!==undefined){
    var v=it.vis3D||'auto';
    var html='<div class="pr"><div class="pl">3D表示</div><select class="pi" onchange="updateSelectedProp(\'vis3D\',this.value===\'auto\'?\'\':this.value)">';
    html+='<option value="auto"'+(v==='auto'||v===''?' selected':'')+'>自動(内観で自動透過)</option>';
    html+='<option value="show"'+(v==='show'?' selected':'')+'>常に表示(透過しない)</option>';
    html+='<option value="hide"'+(v==='hide'?' selected':'')+'>一時的に非表示</option>';
    html+='</select></div>';
    if(v==='hide') html+='<div class="lock-status-note">この壁は3Dに表示されません(2Dでは編集できます)。</div>';
    return html;
  }
  if(it.type==='room'){
    var html2='<div class="pr"><label class="lock-control-label"><input type="checkbox" '+(it.hidden3D?'checked':'')+' onchange="updateSelectedProp(\'hidden3D\',this.checked)">3Dで一時的に非表示(床・天井)</label></div>';
    if(it.hidden3D) html2+='<div class="lock-status-note">3Dビューに表示されません(2Dでは編集できます)。</div>';
    return html2;
  }
  if(it.type){
    var html3='<div class="pr"><label class="lock-control-label"><input type="checkbox" '+(it.hidden3D?'checked':'')+' onchange="updateSelectedProp(\'hidden3D\',this.checked)">3Dで一時的に非表示</label></div>';
    if(it.hidden3D) html3+='<div class="lock-status-note">3Dビューに表示されません(2Dでは編集できます)。</div>';
    return html3;
  }
  return '';
}
// ── 部屋の天井の設定 (Task 13) ─────────────────────────────────────────────
// 受け口 (room.ceiling / room.ceilingHeight) も、屋根から勾配天井を導く実装も
// 入っていたのに、触る手段がコンソールしか無かった。ここが唯一の入口になる。
//
// **空欄が既定**である。保存済みプランは ceiling も ceilingHeight も持たないので、
// この欄を開いて何も触らなければプランは1バイトも変わらない。**描画しただけで
// フィールドを書き込まないこと**。書き込みは onchange から updateSelectedProp
// を通る経路だけ(=ロック判定・undo・再描画を既存と共有する)。
//
// 日本の注文住宅の実務値。2400 が標準、2500 がゆとり、2200 は水回り・廊下、
// 2100 は下がり天井で、建築基準法施行令21条の居室天井高の下限でもある。
var CEILING_HEIGHT_PRESETS_MM=[
  [2400,'2400mm（標準）'],
  [2500,'2500mm（ゆとり）'],
  [2200,'2200mm（水回り・廊下）'],
  [2100,'2100mm（下がり天井・居室の下限）']
];
function roomCeilingTypeValue(room){
  if(roomIsVoidCeiling(room)) return 'void';
  return roomDeclaresSlopedCeiling(room)?'sloped':'flat';
}
// 明示された平天井高(mm)。指定が無ければ空文字を返す = 入力欄が空欄になる。
// 空欄と 0 を混ぜないこと。0 を書くと既定へ落ちて「指定なし」と区別できなくなる。
function roomFlatCeilingInputMm(room){
  var c=room&&room.ceiling;
  if(c&&isPositiveNumber(c.heightMm)) return Math.round(c.heightMm);
  if(room&&isPositiveNumber(room.ceilingHeight)) return Math.round(room.ceilingHeight);
  return '';
}
function roofTypeLabel(roofItem){
  var t=(roofItem&&roofItem.roofType)||'gable', name=t;
  roofTypeOptions().forEach(function(o){ if(o[0]===t) name=o[1]; });
  return name;
}
// 部屋の名前を画面で名指しするときの文字列。名前が無い部屋は ID で呼ぶ。
function roomDisplayLabel(room){
  if(!room) return '';
  return (room.floor||1)+'階の'+(room.n?'「'+room.n+'」':objectIdLabel(room));
}
// 勾配天井が作れない理由。作れるなら空文字を返す (Task 14-3)。
// 黙って平らにするのが最悪なので、選べない側にも必ず理由を添える。
function roomSlopedCeilingBlockReason(room){
  var above=roomAboveRoom(room);
  if(!above) return '';
  return 'この部屋の上には'+roomDisplayLabel(above)+
    'が載っています。勾配天井は天井を張らずに屋根裏側へ抜ける形なので、上に床がある階では作れません（成立するのは上に部屋が無い部屋だけです）。';
}
function selectedRoomCeilingHtml(it){
  if(!it||it.type!=='room') return '';
  if(typeof HeightModel==='undefined'||!HeightModel) return '';
  var type=roomCeilingTypeValue(it);
  var blocked=roomSlopedCeilingBlockReason(it);
  var html='<div class="ph" style="margin-top:12px">天井</div>';
  html+='<div class="pr"><div class="pl">天井の種類</div><select class="pi" onchange="updateSelectedCeilingType(this.value)">';
  html+='<option value="flat"'+(type==='flat'?' selected':'')+'>平ら</option>';
  // 選べないときは選択肢を残したまま無効にする。消してしまうと「勾配という考えが
  // 無い」ように見え、なぜ作れないのかを言う場所も無くなる。
  html+='<option value="sloped"'+(type==='sloped'?' selected':'')+
    ((blocked&&type!=='sloped')?' disabled':'')+'>勾配'+(blocked?'（この部屋では作れません）':'')+'</option>';
  var voidBlocked=roomVoidBlockReason(it);
  html+='<option value="void"'+(type==='void'?' selected':'')+
    ((voidBlocked&&type!=='void')?' disabled':'')+'>吹き抜け'+
    (voidBlocked?'（この部屋では作れません）':'')+'</option>';
  html+='</select></div>';
  if(blocked&&type!=='void') html+='<div class="lock-status-note">'+blocked+'</div>';
  if(type==='void'){
    // 高さは入力させない。階高から決まる値なので、手で書かせると階高を変えた
    // 瞬間に上階の天井と食い違い、スラブの小口が室内に見える。
    var toF=roomVoidTargetFloor(it);
    html+='<div class="pr"><div class="pl">抜き先の階</div><input class="pi" type="number" min="'+
      ((it.floor||1)+1)+'" max="8" step="1" value="'+toF+
      '" onchange="updateSelectedVoidToFloor(this.value)"></div>';
    if(voidBlocked){
      html+='<div class="lock-status-note">'+voidBlocked+'</div>';
    } else {
      html+='<div class="lock-status-note">'+toF+'階の天井まで抜けます（現在 '+
        roomRenderedCeilingMm(it)+'mm）。高さは階高から計算するので入力は要りません。'+
        '縁には手すり壁（壁のスタイル=バルコニー手すり）を必ず置いてください。</div>';
    }
    return html;
  }
  // 「レンダが実際に置いた面」から取る。入力値をそのまま書き返すと、階高で
  // 丸められたときに欄が嘘をつく。
  var renderedMm=roomRenderedCeilingMm(it);
  var storyMm=storyHeightMmForFloor(it.floor);
  html+=roomSetbackCeilingNoteHtml(it);
  if(type==='flat'){
    var cur=roomFlatCeilingInputMm(it);
    html+='<div class="pr"><div class="pl">天井高プリセット</div><select class="pi" onchange="updateSelectedFlatCeilingMm(this.value)">';
    html+='<option value=""'+(cur===''?' selected':'')+'>指定なし（階高をそのまま天井にする）</option>';
    CEILING_HEIGHT_PRESETS_MM.forEach(function(p){
      html+='<option value="'+p[0]+'"'+(cur===p[0]?' selected':'')+'>'+p[1]+'</option>';
    });
    html+='</select></div>';
    html+='<div class="pr"><div class="pl">天井高 (mm)</div><input class="pi" type="number" min="0" step="10" placeholder="空欄=指定なし" value="'+cur+'" onchange="updateSelectedFlatCeilingMm(this.value)"></div>';
    if(cur===''){
      html+='<div class="lock-status-note">指定なしです。この部屋の天井は今までどおり階高いっぱい（現在 '+renderedMm+'mm）に置かれます。</div>';
    } else if(renderedMm<cur){
      html+='<div class="lock-status-note">'+cur+'mm は階高 '+storyMm+'mm を超えるため、'+renderedMm+'mm に丸めて描いています（階高を上げると上階の床ごと家全体が動くので、丸めるのは天井の側）。</div>';
    }
    return html;
  }
  var shape=roomRenderedCeilingShape(it);
  var roof=roofItemOverRoom(it);
  if(shape&&shape.type==='sloped'){
    html+='<div class="pr"><div class="pl">平面図のラベル</div><input class="pi" type="text" value="'+roomRenderedCeilingLabel(it)+'" readonly></div>';
  }
  if(roof){
    // 屋根が載っている部屋では、高さを決めるのは屋根である。手で書ける欄を
    // 出すと画面の数字と描かれる天井が食い違う。読み取り専用で見せるだけにする。
    html+='<div class="pr"><div class="pl">天井の決まり方</div><input class="pi" type="text" value="屋根から自動（屋根 '+objectIdLabel(roof)+'）" readonly></div>';
    html+='<div class="pr"><div class="pl">屋根の形状</div><input class="pi" type="text" value="'+roofTypeLabel(roof)+'" readonly></div>';
    html+='<div class="pr"><div class="pl">屋根の勾配 (°)</div><input class="pi" type="text" value="'+Math.round(roof.pitch||30)+'" readonly></div>';
    if(shape&&shape.type==='sloped'){
      html+='<div class="pr"><div class="pl">低い側 (mm)</div><input class="pi" type="text" value="'+shape.lowMm+'" readonly></div>';
      html+='<div class="pr"><div class="pl">高い側 (mm)</div><input class="pi" type="text" value="'+shape.highMm+'" readonly></div>';
    }
    html+='<div class="lock-status-note">高さは屋根が決めます（屋根下面から '+CEILING_UNDER_ROOF_OFFSET_MM+'mm 下がった面）。屋根の勾配や形を変えると天井もついてきます。</div>';
  } else {
    var c2=it.ceiling||{};
    var lowMm=isPositiveNumber(c2.lowMm)?Math.round(c2.lowMm):HeightModel.DEFAULTS.slopedLowMm;
    var highMm=isPositiveNumber(c2.highMm)?Math.round(c2.highMm):HeightModel.DEFAULTS.slopedHighMm;
    var dir=(typeof c2.direction==='number'&&isFinite(c2.direction))?Math.round(c2.direction):0;
    html+='<div class="pr"><div class="pl">低い側 (mm)</div><input class="pi" type="number" min="0" step="50" value="'+lowMm+'" onchange="updateSelectedSlopedCeiling(\'lowMm\',this.value)"></div>';
    html+='<div class="pr"><div class="pl">高い側 (mm)</div><input class="pi" type="number" min="0" step="50" value="'+highMm+'" onchange="updateSelectedSlopedCeiling(\'highMm\',this.value)"></div>';
    html+='<div class="pr"><div class="pl">向き (°)</div><input class="pi" type="number" step="15" value="'+dir+'" onchange="updateSelectedSlopedCeiling(\'direction\',this.value)"></div>';
    html+='<div class="lock-status-note">向きは 0 が北、時計回り。低い側から高い側へ向かう向きです。この部屋の上に屋根はありません。屋根を載せると、これらの値ではなく屋根が天井を決めます。</div>';
    if(shape&&shape.type==='sloped'&&shape.highMm<highMm){
      // 丸めが起きるのは上に部屋がある階だけになった (Task 14-2)。なぜ丸まったのかを
      // 「階高を超えたから」で止めず、上に何が載っているかまで言う。
      html+='<div class="lock-status-note">高い側 '+highMm+'mm は階高 '+storyMm+'mm を超えるため、'+shape.highMm+'mm に丸めて描いています。'+
        (blocked?'上に部屋がある階なので、階高より上へは伸ばせません（理由は上のとおり）。':'')+'</div>';
    } else if(shape&&shape.type==='sloped'&&shape.highMm>storyMm&&!blocked){
      html+='<div class="lock-status-note">高い側 '+shape.highMm+'mm は階高 '+storyMm+'mm を超えていますが、この部屋の上には部屋がないので丸めずにそのまま描いています（小屋裏へ抜ける形です）。</div>';
    }
  }
  html+='<div class="lock-status-note">勾配天井の天井面が見えるのは外観3Dだけです（内観3Dは天井を作りません）。壁の上辺は内観3Dでも勾配に沿って切れます。</div>';
  return html;
}
// 天井の仕上げ（色・テクスチャ）の欄 (Task 22)。
// 床テクスチャの欄と同じ書き方・同じ入れ物で、置き場所だけ天井の欄の下。
// 天井の高さの欄(selectedRoomCeilingHtml)と分けてあるのは、あちらが type==='flat'
// の途中で return する形をしているためで、仕上げは平らでも勾配でも同じように要る。
//
// **描いただけでは部屋に何も書かない。** 書き込みは onchange から
// updateSelectedProp を通る経路だけ(=ロック判定・undo・再描画を既存と共有する)。
function selectedRoomCeilingFinishHtml(it){
  if(!it||it.type!=='room') return '';
  var hasColor=!!it.ceilingColor;
  var hasTex=!!it.ceilingTexture;
  var html='<div class="ph" style="margin-top:12px">天井の仕上げ</div>';
  html+='<div class="pr"><div class="pl">天井カラー</div><input class="pi" type="color" value="'+(it.ceilingColor||CEILING_DEFAULT_COLOR)+'" onchange="updateSelectedProp(\'ceilingColor\',this.value)"></div>';
  if(hasColor) html+='<button class="pbtn sec" onclick="updateSelectedProp(\'ceilingColor\',null)">天井カラー解除</button>';
  html+='<div class="pr"><div class="pl">天井テクスチャ</div><input class="pi" type="file" accept="image/*" onchange="uploadRoomCeilingTex(this)"></div>';
  if(hasTex) html+='<button class="pbtn sec" onclick="updateSelectedProp(\'ceilingTexture\',null)">天井テクスチャ解除</button>';
  html+=textureFlipControlsHtml(
    'updateSelectedProp(\'ceilingTextureFlipX\','+(!it.ceilingTextureFlipX)+')',
    'updateSelectedProp(\'ceilingTextureFlipY\','+(!it.ceilingTextureFlipY)+')',
    {texture:it.ceilingTexture,textureFlipX:it.ceilingTextureFlipX,textureFlipY:it.ceilingTextureFlipY},
    false);
  if(!hasColor&&!hasTex){
    html+='<div class="lock-status-note">未設定です。この部屋の天井は今までどおり既定の色（'+CEILING_DEFAULT_COLOR+'）で描かれます。</div>';
  } else if(hasTex&&hasColor){
    html+='<div class="lock-status-note">テクスチャを設定しているあいだ、天井カラーは効きません（画像が優先されます）。</div>';
  }
  // 「設定したのに何も起きない」に見える2つの場合を、その場で言う。
  html+='<div class="lock-status-note">天井面が見えるのは外観3Dだけです（内観3Dは天井を作りません）。平らな天井にも勾配天井にも同じ仕上げが乗ります。</div>';
  if(typeof roomHasCoverAbove==='function'&&!roomHasCoverAbove(it)){
    html+='<div class="lock-status-note">この部屋の上には部屋も屋根もありません。天井面そのものが作られないので、仕上げを設定しても外観3Dには出ません（上に屋根を載せると出ます）。</div>';
  }
  return html;
}
// 「宣言が効いたのか、斜線が効いたのか」を画面で言い分ける。斜線由来の勾配天井は
// 部屋の ceiling 宣言を必要としないので、宣言欄だけを見ていると理由が読めなくなる。
function roomSetbackCeilingNoteHtml(room){
  var rs=setbackRoofsForRoom(room);
  if(!rs.length) return '';
  var p=roomCeilingProfile(room);
  var kinds=rs.map(function(r){ return r.setbackKind==='north'?'北側斜線':'道路斜線'; }).join('・');
  var declared=roomDeclaresSlopedCeiling(room);
  return '<div class="lock-status-note">この部屋は<b>'+kinds+'で削られています</b>。'+
    (declared
      ? '勾配は手動で宣言されており、そのうえで斜線の面でも頭を押さえられています（低い方が勝ちます）。'
      : '勾配天井は宣言ではなく<b>削った結果として</b>現れています（下の「天井の種類」は宣言欄で、ここでは効いていません）。')+
    '当たっていない場所の天井高は動かしていません。'+
    ((p&&p.reason)?'（適用: '+(p.reason==='setback'?'斜線':'宣言')+'）':'')+'</div>';
}
// ── 斜線制限（建築基準法56条）の設定UI。既存の選択プロパティ欄の中に置く ──
// 数値（勾配・基準高さ）は assets/js/setback-law.js からしか読まない。
function setbackZoneOptionsHtml(cur){
  var law=setbackLawApi();
  var h='<option value=""'+(!cur?' selected':'')+'>未設定（斜線制限を使わない）</option>';
  if(!law) return h;
  law.ZONES.forEach(function(z){
    h+='<option value="'+z.id+'"'+(cur===z.id?' selected':'')+'>'+escHtml(z.label)+'</option>';
  });
  return h;
}
// 画面に出すための素の値。siteSetbackConfig と違い「用途地域だけ選んで
// まだ何も有効にしていない」途中の状態も返す。
function siteSetbackRaw(it){
  var s=(it && it.setback && typeof it.setback==='object')?it.setback:null;
  var law=setbackLawApi();
  var zone=(s && law && law.zone(s.zone))?s.zone:'';
  return {zone:zone, road:!!(s&&s.road), north:!!(s&&s.north),
    northBaseMm:(s&&s.northBaseMm!==undefined)?s.northBaseMm:null,
    northSlope:(s&&s.northSlope!==undefined)?s.northSlope:null,
    roadSlope:(s&&s.roadSlope!==undefined)?s.roadSlope:null};
}
// 用途地域の既定値と、手入力があればその値。パネルの入力欄に出す「今効いている数」。
function siteSetbackEffective(it){
  var law=setbackLawApi();
  var cur=siteSetbackRaw(it);
  var z=law?law.zone(cur.zone):null;
  var nb=setbackOverrideNum(cur.northBaseMm,SETBACK_BASE_MIN_MM,SETBACK_BASE_MAX_MM);
  var ns=setbackOverrideNum(cur.northSlope,SETBACK_SLOPE_MIN,SETBACK_SLOPE_MAX);
  var rs=setbackOverrideNum(cur.roadSlope,SETBACK_SLOPE_MIN,SETBACK_SLOPE_MAX);
  return {
    northBaseMm:(nb===null)?((z&&law.northBaseMm(z.id))||0):nb, northBaseCustom:nb!==null,
    northSlope:(ns===null)?(law?law.NORTH_SLOPE:1.25):ns, northSlopeCustom:ns!==null,
    roadSlope:(rs===null)?((z&&law.roadSlope(z.id))||1.25):rs, roadSlopeCustom:rs!==null
  };
}
function setbackCustomMark(on){ return on?'<b>（手入力）</b>':'（用途地域の既定）'; }
function siteSetbackPanelHtml(it){
  var law=setbackLawApi();
  if(!law) return '';
  var cur=siteSetbackRaw(it);
  var h='<div class="ph" style="margin-top:12px">斜線制限（法56条）</div>';
  h+='<div class="pr"><div class="pl">用途地域</div><select class="pi" onchange="updateSelectedSetback(\'zone\',this.value)">'+setbackZoneOptionsHtml(cur.zone)+'</select></div>';
  if(!cur.zone){
    h+='<div class="lock-status-note">用途地域を選ぶと制限面が出ます。</div>';
    return h;
  }
  // 前面道路が無ければ道路斜線は成立しない。成立しない設定は出さない。
  // 角地では前面道路が2本以上ある。**全部**の幅員を出す（1本だけ出すと、
  // 出ていない道路の斜線が効いていないように読める）。
  var roads=setbackRoadItems(it).filter(function(r){ return setbackRoadWidthMm(r)>0; });
  var eff=siteSetbackEffective(it);
  // 手入力かどうかは印1つで足りる。条文の既定は「手で入れ替えたときだけ」
  // 1行で出す。欄の数字が既定そのもののときに「既定は○○」と併記するのは
  // 同じことを二度言っているだけなので出さない。
  var anyCustom=false;
  function mark(on){ if(on) anyCustom=true; return on?'<span style="color:#e94560">*</span>':''; }
  if(roads.length){
    h+='<div class="pr"><label class="lock-control-label"><input type="checkbox" '+(cur.road?'checked':'')+' onchange="updateSelectedSetback(\'road\',this.checked)">道路斜線</label></div>';
    h+='<div class="pr"><div class="pl">勾配 1:'+mark(eff.roadSlopeCustom,law.ROAD_SLOPE_RESIDENTIAL+' / '+law.ROAD_SLOPE_OTHER)+'</div><input class="pi" type="number" min="'+SETBACK_SLOPE_MIN+'" max="'+SETBACK_SLOPE_MAX+'" step="0.05" value="'+eff.roadSlope+'" onchange="updateSelectedSetback(\'roadSlope\',this.value)"></div>';
    h+='<div class="pr"><div class="pl">道路幅員</div><input class="pi" type="text" readonly value="'+
      roads.map(function(r){ return Math.round(setbackRoadWidthMm(r))+'mm'; }).join(' / ')+
      (roads.length>1?'（角地・'+roads.length+'本）':'')+'"></div>';
  } else {
    h+='<div class="lock-status-note">道路を置くと道路斜線が使えます。</div>';
  }
  // 北側斜線は低層住専・中高層住専にしか無い。無い用途地域では欄ごと出さない。
  if(law.hasNorthLimit(cur.zone)){
    h+='<div class="pr"><label class="lock-control-label"><input type="checkbox" '+(cur.north?'checked':'')+' onchange="updateSelectedSetback(\'north\',this.checked)">北側斜線</label></div>';
    h+='<div class="pr"><div class="pl">基準高さ (mm)'+mark(eff.northBaseCustom,law.NORTH_BASE_LOW_MM+' / '+law.NORTH_BASE_MID_MM)+'</div><input class="pi" type="number" min="'+SETBACK_BASE_MIN_MM+'" max="'+SETBACK_BASE_MAX_MM+'" step="100" value="'+eff.northBaseMm+'" onchange="updateSelectedSetback(\'northBaseMm\',this.value)"></div>';
    h+='<div class="pr"><div class="pl">勾配 1:'+mark(eff.northSlopeCustom,law.NORTH_SLOPE)+'</div><input class="pi" type="number" min="'+SETBACK_SLOPE_MIN+'" max="'+SETBACK_SLOPE_MAX+'" step="0.05" value="'+eff.northSlope+'" onchange="updateSelectedSetback(\'northSlope\',this.value)"></div>';
  }
  if(anyCustom){
    h+='<div class="lock-status-note"><span style="color:#e94560">*</span> は手入力（用途地域の既定ではありません）。'+
      '条文の既定は 道路勾配 住居系'+law.ROAD_SLOPE_RESIDENTIAL+'・それ以外'+law.ROAD_SLOPE_OTHER+
      '／北側 低層住専'+law.NORTH_BASE_LOW_MM+'mm・中高層住専'+law.NORTH_BASE_MID_MM+'mm、勾配'+law.NORTH_SLOPE+'。</div>';
  }
  h+='<div class="lock-status-note">⚠ 設計中の当たりを見るための面です。確認申請には使えません。</div>';
  // 長い断り書きは畳む。**消さない**: 何を見ていないかを書いていないと
  // 「だいたい合っている」と読まれる。既定で閉じているだけで中身は同じ。
  h+='<details class="prop-details"><summary>詳しく（効き方と、見ていないもの）</summary>';
  h+='<div class="lock-status-note">制限面より上に出た部分を実際に削ります。切り口には斜線に沿った片流れ屋根が架かり、'+
    'その下の部屋は自動で勾配天井になります（屋根下面から '+CEILING_UNDER_ROOF_OFFSET_MM+'mm 下）。壁の上端も同じ屋根で切られます。'+
    '家具は削りません。制限面と寸法の表示は「寸法」ボタンで出し入れします（消しても削りは効いたままです）。</div>';
  if(roads.length>1){
    h+='<div class="lock-status-note">角地です。道路ごとに制限面を引き、どの点でもいちばん低い制限が効きます。</div>';
  }
  h+='<div class="lock-status-note">基準高さと勾配は自治体によって違うので手で入れ直せます（<span style="color:#e94560">*</span>付きが手入力）。'+
    '用途地域を選び直すと手入力は消え、その地域の既定に戻ります。</div>';
  // 誤解されると危険なので、何を見ていないのかまで書く。「参考です」だけでは
  // 「だいたい合っている」と読まれる。
  // Task 26-3: 以前はここで「実際の審査より **厳しい側** に出ます」と保証していた。
  // 見ていないのが緩和だけなら本当だが、**絶対高さ制限(法55条)と日影規制は
  // そもそも実装していない**。第一種低層住専で 10.5m に設計しても何も言わない
  // ＝ 緩い側へ振れる道が1本開いている。保証を外し、その1本を名指しする。
  h+='<div class="lock-status-note">素の条文どおりの面だけを引いています。'+
    'セットバックによる緩和（法56条2項）・天空率（同7項）・2項道路の中心後退・高低差の緩和は<b>1つも見ていません</b>。'+
    'そのぶんは厳しい側へ出ますが、<b>「必ず厳しい側」ではありません</b>: '+
    '<b>絶対高さ制限（法55条。低層住専の10m／12m）と日影規制（法56条の2）は未実装です。</b>'+
    '第一種低層住専で最高高さ10.5mに設計しても、この画面は何も言いません。</div>';
  h+='<div class="lock-status-note">真北はこのプランの方位（現在 '+setbackNorthDeg()+'°）から取っています。'+
    '光の設定の「北の方角」で変えられます。敷地が真北を向いていないときは合わせてください。</div>';
  h+='</details>';
  return h;
}
function updateSelectedSetback(key,val){
  var it=ST.selected;
  if(!it || it.type!=='site-rect') return;
  var law=setbackLawApi();
  var cur=siteSetbackRaw(it);
  if(key==='zone'){
    cur.zone=(law && law.zone(val))?val:'';
    // Task 21-3: 用途地域は既定値の出どころである。選び直したら手入力は消し、
    // その地域の既定へ戻す。残すと「画面に出ている地域」と「効いている数」が
    // 食い違ったまま気付けない。パネルにもそう書いてある。
    cur.northBaseMm=null; cur.northSlope=null; cur.roadSlope=null;
  }
  else if(key==='road') cur.road=!!val;
  else if(key==='north') cur.north=!!val;
  else if(key==='northBaseMm') cur.northBaseMm=setbackOverrideNum(val,SETBACK_BASE_MIN_MM,SETBACK_BASE_MAX_MM);
  else if(key==='northSlope') cur.northSlope=setbackOverrideNum(val,SETBACK_SLOPE_MIN,SETBACK_SLOPE_MAX);
  else if(key==='roadSlope') cur.roadSlope=setbackOverrideNum(val,SETBACK_SLOPE_MIN,SETBACK_SLOPE_MAX);
  // 効かない用途地域の北側斜線は書き残さない。使われない値が後で効きはじめるのが最悪。
  if(!cur.zone || !law || !law.hasNorthLimit(cur.zone)) cur.north=false;
  if(!cur.zone){ updateSelectedProp('setback',null); return; }
  var next={zone:cur.zone, road:cur.road, north:cur.north};
  // 上書きが無いときは鍵そのものを書かない。**斜線を触っていないプランの保存内容を
  // 1バイトも増やさない**ためで、既定値を書き込むと条文が変わったとき追随できなくなる。
  if(cur.northBaseMm!==null && cur.northBaseMm!==undefined) next.northBaseMm=cur.northBaseMm;
  if(cur.northSlope!==null && cur.northSlope!==undefined) next.northSlope=cur.northSlope;
  if(cur.roadSlope!==null && cur.roadSlope!==undefined) next.roadSlope=cur.roadSlope;
  updateSelectedProp('setback',next);
}
function updateSelectedVoidToFloor(v){
  var room=ST.selected;
  if(!room||room.type!=='room'||!roomIsVoidCeiling(room)) return;
  var n=Math.round(Number(v));
  if(!isFinite(n)) return;
  n=Math.max((room.floor||1)+1,Math.min(8,n));
  updateSelectedProp('ceiling',{type:'void',toFloor:n});
}
function updateSelectedCeilingType(v){
  var room=ST.selected;
  if(!room||room.type!=='room') return;
  if(v==='void'){
    // 上に部屋が残っていると床が張られたままで吹き抜けにならない。
    // 黙って平天井に落とすのが最悪なので、書き込む側でも止める。
    if(roomVoidBlockReason(room)) return;
    updateSelectedProp('ceiling',{type:'void',toFloor:(room.floor||1)+1});
    return;
  }
  if(v!=='sloped'){
    // 「平ら」は空欄へ戻す = 受け口ごと消す。既存プランと同じ状態。
    updateSelectedProp('ceiling',null);
    return;
  }
  // 上に部屋がある階では勾配天井は成立しない (Task 14-3)。選択肢を無効にしてある
  // ので普通は届かないが、書き込む側でも止める -- 黙って平天井になるのが最悪。
  if(roomSlopedCeilingBlockReason(room)) return;
  var c={type:'sloped',lowMm:HeightModel.DEFAULTS.slopedLowMm};
  // 屋根が載っているなら高い側と向きは屋根が決める。使われない数字を書き残すと、
  // 後で屋根を消したときに身に覚えのない値が効きはじめる。
  if(!roofItemOverRoom(room)){
    c.highMm=HeightModel.DEFAULTS.slopedHighMm;
    c.direction=0;
  }
  updateSelectedProp('ceiling',c);
}
function updateSelectedFlatCeilingMm(v){
  var room=ST.selected;
  if(!room||room.type!=='room') return;
  var mm=Number(v);
  if(!isPositiveNumber(mm)){ updateSelectedProp('ceiling',null); return; }
  updateSelectedProp('ceiling',{type:'flat',heightMm:Math.round(mm)});
}
function updateSelectedSlopedCeiling(field,v){
  var room=ST.selected;
  if(!room||room.type!=='room') return;
  var cur=room.ceiling||{};
  var c={type:'sloped',
    lowMm:isPositiveNumber(cur.lowMm)?Math.round(cur.lowMm):HeightModel.DEFAULTS.slopedLowMm,
    highMm:isPositiveNumber(cur.highMm)?Math.round(cur.highMm):HeightModel.DEFAULTS.slopedHighMm,
    direction:(typeof cur.direction==='number'&&isFinite(cur.direction))?cur.direction:0};
  var n=Number(v);
  if(field==='direction'){ if(isFinite(n)) c.direction=n; }
  else if(isPositiveNumber(n)) c[field]=Math.round(n);
  updateSelectedProp('ceiling',c);
}
function clearAll3DHidden(){
  var n=0;
  DATA.walls.forEach(function(w){ if(w.vis3D){ delete w.vis3D; n++; } });
  DATA.items.forEach(function(it){ if(it.hidden3D){ delete it.hidden3D; n++; } });
  DATA.rooms.forEach(function(r){ if(r.hidden3D){ delete r.hidden3D; n++; } });
  if(!n){ alert('3D非表示・表示上書きの設定はありません。'); return; }
  sharedForceFullSync();
  saveState();
  draw2d(); if(ren) rebuild3D();
  if(ST.selected) updateProps();
}
function setPropsBodyHtml(body,html,it){
  body.innerHTML=html;
  body.classList.toggle('is-locked',isObjectLocked(it));
  if(!isObjectLocked(it)) return;
  body.querySelectorAll('input,select,textarea,button').forEach(function(el){
    if(el.hasAttribute('data-lock-control')) return;
    el.disabled=true;
  });
}

function rectSnapBounds(x,y,w,d,rot){
  var cx=x+w/2, cy=y+d/2, rad=(rot||0)*Math.PI/180;
  var ex=Math.abs(Math.cos(rad))*w/2+Math.abs(Math.sin(rad))*d/2;
  var ey=Math.abs(Math.sin(rad))*w/2+Math.abs(Math.cos(rad))*d/2;
  return {left:cx-ex,right:cx+ex,top:cy-ey,bottom:cy+ey,cx:cx,cy:cy};
}
function getEdgeCandidates(excludeId){
  var ex={}, ey={}, cx={}, cy={};  // deduplicate edges and centers separately
  var fl=ST.floor;
  DATA.items.filter(function(it){return it.floor===fl&&it.id!==excludeId&&it.type!=='site-rect'&&!isPlanAnnotationType(it.type);}).forEach(function(it){
    if(!isFiniteCanvasValue(it.x) || !isFiniteCanvasValue(it.y) || !isFiniteCanvasValue(it.w) || !isFiniteCanvasValue(it.d)) return;
    var b=rectSnapBounds(it.x,it.y,it.w,it.d,it.rot||0);
    [b.left,b.right].forEach(function(v){ex[Math.round(v)]=v;});
    [b.top,b.bottom].forEach(function(v){ey[Math.round(v)]=v;});
    cx[Math.round(b.cx)]=b.cx; cy[Math.round(b.cy)]=b.cy;
  });
  DATA.rooms.filter(function(r){return r.floor===fl;}).forEach(function(r){
    [r.x,r.x+r.w].forEach(function(v){ex[Math.round(v)]=v;});
    [r.y,r.y+r.d].forEach(function(v){ey[Math.round(v)]=v;});
    cx[Math.round(r.x+r.w/2)]=r.x+r.w/2; cy[Math.round(r.y+r.d/2)]=r.y+r.d/2;
  });
  DATA.walls.filter(function(w){return w.floor===fl;}).forEach(function(w){
    var half=wallThicknessMm(w)/2;
    if(Math.abs(w.x2-w.x1)<Math.abs(w.y2-w.y1)){
      var wx=(w.x1+w.x2)/2;
      [wx-half,wx+half].forEach(function(v){ex[Math.round(v)]=v;});
      cx[Math.round(wx)]=wx;
      [Math.min(w.y1,w.y2),Math.max(w.y1,w.y2)].forEach(function(v){ey[Math.round(v)]=v;});
    }else{
      var wy=(w.y1+w.y2)/2;
      [wy-half,wy+half].forEach(function(v){ey[Math.round(v)]=v;});
      cy[Math.round(wy)]=wy;
      [Math.min(w.x1,w.x2),Math.max(w.x1,w.x2)].forEach(function(v){ex[Math.round(v)]=v;});
    }
  });
  return {
    edgeX:Object.values(ex), edgeY:Object.values(ey),
    centerX:Object.values(cx), centerY:Object.values(cy),
    // Resize snapping intentionally uses physical edges, not center lines.
    x:Object.values(ex), y:Object.values(ey)
  };
}

function nearestAxisDelta(values,candidates,thresh){
  var best=null, min=thresh;
  values.forEach(function(v){candidates.forEach(function(c){
    var delta=c-v, dist=Math.abs(delta);
    if(dist<min){min=dist;best={delta:delta,target:c};}
  });});
  return best;
}
function snapRectOriginToGrid(x,y,w,d,rot){
  var step=Number(ST.snap)||0;
  if(!step) return {x:x,y:y};
  var b=rectSnapBounds(x,y,w,d,rot);
  function gridDelta(values){
    var best=null,min=Infinity;
    values.forEach(function(v){
      var delta=Math.round(v/step)*step-v, dist=Math.abs(delta);
      if(dist<min){min=dist;best=delta;}
    });
    return best||0;
  }
  // Snap a physical edge—not merely the stored origin/center—to the configured grid.
  return {x:x+gridDelta([b.left,b.right]),y:y+gridDelta([b.top,b.bottom])};
}
function applyEdgeSnap(x, y, w, d, excludeId, rot){
  var thresh=EDGE_SNAP_THRESH;
  var cands=getEdgeCandidates(excludeId);
  var b=rectSnapBounds(x,y,w,d,rot||0);
  // Edge-to-edge alignment always wins while it is within the snap threshold.
  var bestX=nearestAxisDelta([b.left,b.right],cands.edgeX,thresh);
  var bestY=nearestAxisDelta([b.top,b.bottom],cands.edgeY,thresh);
  // Only fall back to center alignment when no edge match is available.
  if(!bestX) bestX=nearestAxisDelta([b.cx],cands.centerX,thresh);
  if(!bestY) bestY=nearestAxisDelta([b.cy],cands.centerY,thresh);
  return {
    x:bestX?x+bestX.delta:x, y:bestY?y+bestY.delta:y,
    snapX:!!bestX, snapXVal:bestX?bestX.target:null,
    snapY:!!bestY, snapYVal:bestY?bestY.target:null
  };
}

function normalizeTextureOrientationTarget(obj){
  if(!obj) return obj;
  if(obj.textureFlipX===undefined) obj.textureFlipX=false;
  if(obj.textureFlipY===undefined) obj.textureFlipY=false;
  return obj;
}
function setTextureSettingValue(obj,key,value){
  if(!obj) return;
  obj[key]=value;
  if(key==='texture' && !value){
    obj.textureFlipX=false;
    obj.textureFlipY=false;
  }
  // 巾木は「未指定(=上位の設定に任せる)」ならフィールドを持たない。
  // null を残すと保存 JSON が「一度も触っていない設定」と別物になる
  if(key==='skirting' && (value===null||value===undefined)) delete obj.skirting;
  if(key==='skirtingColor' && !value) delete obj.skirtingColor;
}
function appearanceWithTextureOrientation(color, texture, source, owner, prefix){
  var flipX=false, flipY=false;
  if(texture && owner){
    flipX=!!(prefix ? owner[prefix+'FlipX'] : owner.textureFlipX);
    flipY=!!(prefix ? owner[prefix+'FlipY'] : owner.textureFlipY);
  }
  return {color:color,texture:texture||null,source:source,textureFlipX:flipX,textureFlipY:flipY};
}
function textureFlipControlsHtml(updateX, updateY, owner, disabled){
  if(!owner || !owner.texture) return '';
  var dis=disabled?' disabled':'';
  return '<div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:5px">'
    + '<button class="pbtn sec '+(owner.textureFlipX?'active':'')+'" style="padding:3px 8px;margin-top:0" onclick="'+updateX+'"'+dis+'>左右反転</button>'
    + '<button class="pbtn sec '+(owner.textureFlipY?'active':'')+'" style="padding:3px 8px;margin-top:0" onclick="'+updateY+'"'+dis+'>上下反転</button>'
    + '</div>';
}
function selectedTextureFlipControlsHtml(it){
  return textureFlipControlsHtml(
    'updateSelectedProp(\'textureFlipX\','+(!it.textureFlipX)+')',
    'updateSelectedProp(\'textureFlipY\','+(!it.textureFlipY)+')',
    it,
    false
  );
}
function selectedTextureUploadHtml(it,label){
  var applied=!!(it&&it.texture);
  return '<div class="pr"><div class="pl">'+label+'</div>'
    + '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">'
    + '<label class="pbtn sec" style="margin-top:0;cursor:pointer">'
    + (applied?'画像を変更':'画像を選択')
    + '<input type="file" accept="image/*" style="display:none" onchange="uploadTex(this)">'
    + '</label>'
    + '<span style="font-size:10px;color:'+(applied?'#287a4b':'#7a8fb0')+'">'
    + (applied?'✓ 適用済み':'未適用')
    + '</span></div></div>';
}

function faceRuleMode(setting, appearance){
  var mode=setting&&setting.mode;
  if(mode==='custom'||mode==='whole'||mode==='floor'||mode==='inherit') return mode;
  if(appearance&&appearance.source==='floor') return 'floor';
  if(appearance&&appearance.source==='wall') return 'inherit';
  return 'whole';
}

function renderFaceRuleControls(kind, wall, faceKey, setting, appearance){
  var updateFn=kind==='interior'?'updateInteriorFaceSetting':'updateExteriorFaceSetting';
  var uploadFn=kind==='interior'?'uploadInteriorFaceTex':'uploadExteriorFaceTex';
  var mode=faceRuleMode(setting,appearance);
  var group=kind+'-face-rule-'+wall.id+'-'+faceKey;
  var defaultColor=kind==='interior'?INTERIOR_WALL_DEFAULT:'#e8e0cc';
  var colorValue=setting.color||appearance.color||defaultColor;
  var texLabel=textureStateLabel(setting.texture);
  var html='';
  function radio(value,label){
    html += '<label class="face-rule"><input type="radio" name="'+group+'" '+(mode===value?'checked':'')+' onchange="'+updateFn+'('+wall.id+',\''+faceKey+'\',\'mode\',\''+value+'\')"> '+label+'</label>';
  }
  radio('custom','個別設定を利用');
  radio('whole','家全体に合わせる');
  radio('floor',(wall.floor||1)+'Fに合わせる');
  radio('inherit',(kind==='interior'?'内観':'外観')+'カラー設定に任せる');
  html += '<div class="face-custom-row" style="opacity:'+(mode==='custom'?1:0.42)+'">';
  html += '<span class="face-muted">個別カラー</span>';
  html += '<input type="color" value="'+colorValue+'" oninput="'+updateFn+'('+wall.id+',\''+faceKey+'\',\'color\',this.value,true)" onchange="'+updateFn+'('+wall.id+',\''+faceKey+'\',\'color\',this.value,true)" onblur="finishAppearanceColorInput()" '+(mode!=='custom'?'disabled':'')+'>';
  html += '</div>';
  html += '<div style="margin-top:7px;opacity:'+(mode==='custom'?1:0.42)+'"><div class="face-muted" style="margin-bottom:4px">個別テクスチャ</div><input type="file" accept="image/*" style="font-size:10px;width:100%;max-width:100%" onchange="'+uploadFn+'(this,'+wall.id+',\''+faceKey+'\')" '+(mode!=='custom'?'disabled':'')+'></div>';
  html += '<div class="face-muted" style="margin-top:5px">テクスチャ: '+texLabel+' '+(setting.texture?'<button class="pbtn sec" style="padding:3px 8px;margin-top:4px" onclick="'+updateFn+'('+wall.id+',\''+faceKey+'\',\'texture\',null)">解除</button>':'')+'</div>';
  html += textureFlipControlsHtml(
    updateFn+'('+wall.id+',\''+faceKey+'\',\'textureFlipX\','+(!setting.textureFlipX)+')',
    updateFn+'('+wall.id+',\''+faceKey+'\',\'textureFlipY\','+(!setting.textureFlipY)+')',
    setting,
    mode!=='custom'
  );
  if(kind==='interior'){
    // 巾木は壁紙カラーと同じカスケード。既定は「内観カラー設定に任せる」で、
    // この面だけ変えたいときに あり/なし を明示する
    var faceObj=getWallInteriorFaces(wall).find(function(f){return interiorFaceKey(wall,f)===faceKey;});
    var skResolved=resolveSkirtingForFace(wall,faceObj);
    var skOwn=setting.skirting;   // undefined=任せる / true / false
    var skSel=(skOwn===undefined)?'inherit':(skOwn===false?'off':'on');
    html += '<div class="face-custom-row" style="margin-top:7px"><span class="face-muted">巾木</span>';
    html += '<select onchange="'+updateFn+'('+wall.id+',\''+faceKey+'\',\'skirting\',this.value===\'inherit\'?null:this.value===\'on\')">';
    html += '<option value="inherit" '+(skSel==='inherit'?'selected':'')+'>内観カラー設定に任せる（現在: '+(skResolved.on?'あり':'なし')+'）</option>';
    html += '<option value="on" '+(skSel==='on'?'selected':'')+'>あり (60mm)</option>';
    html += '<option value="off" '+(skSel==='off'?'selected':'')+'>なし</option>';
    html += '</select></div>';
    if(skResolved.on){
      html += '<div class="face-custom-row"><span class="face-muted">巾木カラー</span>';
      html += '<input type="color" value="'+(setting.skirtingColor||skResolved.color||colorValue)+'" onchange="'+updateFn+'('+wall.id+',\''+faceKey+'\',\'skirtingColor\',this.value)"></div>';
      if(setting.skirtingColor) html += '<button class="pbtn sec" style="padding:3px 8px;margin-top:4px" onclick="'+updateFn+'('+wall.id+',\''+faceKey+'\',\'skirtingColor\',null)">壁紙の色に戻す</button>';
    }
  }
  return html;
}

function updateProps(){
  // 「複数選択: ON (n個)」の表示は選択が変わるたびに更新する。
  // タッチでは何個掴んでいるかが画面のどこにも出ないと、追加できているのか
  // 分からない(タブレットではこれが唯一の手掛かりになる)。
  if(typeof updateMultiSelectButton==='function') updateMultiSelectButton();
  var body = document.getElementById('props-body');
  if(!ST.selected) {
    body.classList.remove('is-locked');
    document.getElementById('props').classList.remove('show');
    return;
  }
  document.getElementById('props').classList.add('show');
  var it = ST.selected;
  if(it.sScale === undefined) { it.sScale = 1; it.sX = 0; it.sY = 0; }
  var html = '';
  var fmpInfo=getFmpItem(it.type);
  var typeName = (fmpInfo&&fmpInfo.name) || ILABELS[it.type] || (it.type==='room'?'部屋':'要素');
  var selectedCount=explicit2DSelection().length;
  document.getElementById('props-title').textContent = selectedCount>1
    ? selectedCount+'件を選択中（'+typeName+'）'
    : typeName + ' の設定';
  // Update mobile header
  var icons={bath:'🛁',toilet:'🚽',sink:'🚿',kitchen:'🍳',fridge:'📦',sofa:'🛋','bed-d':'🛏','bed-s':'🛏',desk:'🖥',tv:'📺','custom-block':'▣','light-ceiling':'💡','light-down':'💡','light-spot':'💡',memo:'✎',ruler:'↔','walk-route':'↝',closet:'👗',bicycle:'🚲','bicycle-fold':'🚲',stair:'🪜','stair-corner':'↱',room:'⬜','door-swing':'🚪','door-swing-s':'🚪','door-slide':'⇔','door-fold':'🚪','door-fold-w':'🚪','door-slide-s':'⇢','door-pocket':'⇥',window:'🪟','window-door':'⇔','door-opening':'▯','door-opening-arch':'⌒',wall:'━',fence:'🧱','wood-fence':'▥','lattice-screen':'▥','neighbor-building':'▥','neighbor-house':'⌂',road:'═','utility-pole':'│','ac-outdoor':'❄','water-heater':'♨','gas-heater':'🔥','meter-box':'🔌','sewer-pit':'🕳','downspout':'〡',foundation:'▰','exterior-stair':'▤',ramp:'▱'};
  var icon=icons[it.type]||'⚙';
  var mobIcon=document.getElementById('mob-prop-icon'), mobName=document.getElementById('mob-prop-name'), mobSize=document.getElementById('mob-prop-size');
  if(mobIcon) mobIcon.textContent=icon;
  if(mobName) mobName.textContent=typeName;
  if(mobSize&&!isPlanAnnotationType(it.type)&&it.w&&it.d) mobSize.textContent=Math.round(it.w)+'×'+Math.round(it.d)+'mm';
  else if(mobSize) mobSize.textContent='';
  // Auto-expand on first selection if not already showing
  var propsEl=document.getElementById('props');
  if(!propsEl.classList.contains('prop-expanded')&&!isMobileLayout()){
    // desktop: always show body
  }
  html += selectedLockControlHtml(it);
  if(it.type==='memo'){
    html += '<div class="ph">メモ</div>';
    html += '<div class="pr"><div class="pl">テキスト</div><textarea class="pi note-textarea" oninput="updateSelectedNoteText(this.value)" onblur="finishSelectedNoteText()">'+escHtml(it.noteText||'')+'</textarea></div>';
    html += '<div class="pr"><div class="pl">背景色</div><input class="pi" type="color" value="'+(it.color||'#fff3a6')+'" onchange="updateSelectedProp(\'color\',this.value)"></div>';
    html += selectedModelFinishesHtml(it);
  html += selectedDeleteButtonHtml();
    setPropsBodyHtml(body,html,it);
    return;
  }
  if(it.type==='ruler'){
    html += '<div class="ph">定規</div>';
    html += '<div class="pr"><div class="pl">測定長さ (mm)</div><input class="pi" type="number" min="'+RULER_MIN_LEN_MM+'" max="'+RULER_MAX_LEN_MM+'" step="10" value="'+Math.round(rulerLengthMm(it))+'" onchange="updateSelectedRulerLength(this.value)"></div>';
    html += '<div class="pr" style="font-size:10px;color:#889;padding:0 2px 6px">置いたあとでも数値で入れ直せます。1点目は動かず、2点目だけが同じ向きに伸び縮みします</div>';
    html += '<div class="pr"><div class="pl">補助線の長さ(mm)</div><input class="pi" type="number" step="100" value="'+Math.round(Number(it.extLen)||0)+'" onchange="updateSelectedProp(\'extLen\',+this.value)"></div>';
    html += '<div class="pr" style="font-size:10px;color:#889;padding:0 2px 6px">両端から測定対象へ垂直に伸びる補助線。負の値で反対側に伸びます</div>';
    html += '<div class="pr"><div class="pl">線の色</div><input class="pi" type="color" value="'+(it.color||'#2f80ed')+'" onchange="updateSelectedProp(\'color\',this.value)"></div>';
    html += selectedModelFinishesHtml(it);
  html += selectedDeleteButtonHtml();
    setPropsBodyHtml(body,html,it);
    return;
  }
  if(it.type==='walk-route'){
    var walkLen=walkRouteLengthMm(it);
    var walkSpeed=walkRouteSpeedMps(it);
    var walkDuration=walkRouteDurationSec(it);
    var isWalking=isWalkthroughRouteActive(it);
    var isDrawingRoute=ST.drawing && ST.tool==='walk-route' && ST.selected===it;
    html += '<div class="ph">ウォークルート</div>';
    html += '<div class="pr"><div class="pl">ルート長さ</div><input class="pi" type="text" value="'+formatWalkRouteDistance(walkLen)+'" readonly></div>';
    html += '<div class="pr"><div class="pl">区間数</div><input class="pi" type="text" value="'+walkRouteSegmentCount(it)+'" readonly></div>';
    html += '<div class="pr"><div class="pl">歩行速度 (m/s)</div><input class="pi" type="number" min="0.1" max="3" step="0.1" value="'+walkSpeed.toFixed(1)+'" onchange="updateWalkRouteSpeed(+this.value)"></div>';
    html += '<div class="pr"><div class="pl">再生時間</div><input class="pi" type="text" value="'+walkDuration.toFixed(1)+'秒" readonly></div>';
    html += '<div class="pr"><div class="pl">線の色</div><input class="pi" type="color" value="'+(it.color||'#10b981')+'" onchange="updateSelectedProp(\'color\',this.value)"></div>';
    if(isDrawingRoute) html += '<button class="pbtn" data-lock-control type="button" onclick="finishWalkRouteDrawing()">ルート確定</button>';
    html += isWalking
      ? '<button class="pbtn" data-lock-control type="button" onclick="stopWalkthrough()">再生を停止</button>'
      : '<button class="pbtn" data-lock-control type="button" onclick="playSelectedWalkthroughRoute()">外観3Dで再生</button>';
    html += selectedModelFinishesHtml(it);
  html += selectedDeleteButtonHtml();
    setPropsBodyHtml(body,html,it);
    return;
  }
  html += '<div class="pr"><div class="pl">ID</div><input class="pi" type="text" value="'+objectIdLabel(it)+'" readonly></div>';
  html += stackOrderControlsHtml(it);

  if(it.x1 !== undefined && it.x2 !== undefined) {
    html += '<div class="pr"><div class="pl">始点 X (mm)</div><input class="pi" type="number" value="'+Math.round(it.x1)+'" onchange="updateSelectedProp(\'x1\',+this.value)"></div>';
    html += '<div class="pr"><div class="pl">始点 Y (mm)</div><input class="pi" type="number" value="'+Math.round(it.y1)+'" onchange="updateSelectedProp(\'y1\',+this.value)"></div>';
    html += '<div class="pr"><div class="pl">終点 X (mm)</div><input class="pi" type="number" value="'+Math.round(it.x2)+'" onchange="updateSelectedProp(\'x2\',+this.value)"></div>';
    html += '<div class="pr"><div class="pl">終点 Y (mm)</div><input class="pi" type="number" value="'+Math.round(it.y2)+'" onchange="updateSelectedProp(\'y2\',+this.value)"></div>';
    html += '<div class="pr"><div class="pl">壁厚 (mm)</div><input class="pi" type="number" value="'+it.thick+'" onchange="updateSelectedProp(\'thick\',+this.value)"></div>';
    html += '<div class="pr"><div class="pl">壁高さ (mm)</div><input class="pi" type="number" min="300" max="6000" step="10" value="'+Math.round(wallHeightMm(it))+'" onchange="updateSelectedProp(\'wallHeight\',+this.value)"></div>';
    html += '<div class="pr"><div class="pl">設置高さ</div><select class="pi" onchange="updateSelectedProp(\'wallBand\',this.value)">';
    [['full','通常'],['low','低位のみ'],['high','高位のみ']].forEach(function(opt){
      html += '<option value="'+opt[0]+'" '+((it.wallBand||'full')===opt[0]?'selected':'')+'>'+opt[1]+'</option>';
    });
    html += '</select></div>';
    html += '<div class="pr"><div class="pl">上部形状</div><select class="pi" onchange="updateSelectedProp(\'wallTopShape\',this.value)">';
    [['flat','通常'],['slope','斜め切り落とし'],['round','丸型切り落とし']].forEach(function(opt){
      html += '<option value="'+opt[0]+'" '+((it.wallTopShape||'flat')===opt[0]?'selected':'')+'>'+opt[1]+'</option>';
    });
    html += '</select></div>';
    html += '<div class="pr"><div class="pl">形状対象</div><select class="pi" onchange="updateSelectedProp(\'wallTopSide\',this.value)">';
    [['both','両辺'],['start','始点側'],['end','終点側']].forEach(function(opt){
      html += '<option value="'+opt[0]+'" '+(wallTopSide(it)===opt[0]?'selected':'')+'>'+opt[1]+'</option>';
    });
    html += '</select></div>';
    html += '<div class="pr"><div class="pl">壁材</div><select class="pi" onchange="updateSelectedProp(\'wallStyle\',this.value)">';
    [['solid','通常壁'],['vertical-lattice','縦格子'],['horizontal-lattice','横格子'],['balcony-fence','バルコニーフェンス']].forEach(function(opt){
      html += '<option value="'+opt[0]+'" '+((it.wallStyle||'solid')===opt[0]?'selected':'')+'>'+opt[1]+'</option>';
    });
    html += '</select></div>';
    // 巾木の有無と色は壁単位ではなく**内観面ごと**(下の「壁紙カラー(内観面)」)。
    // 壁は両面が別の部屋に面するので、壁単位だと部屋ごとの統一が取れない。
    if((it.thick||0)<120){
      html += '<div class="pr"><div class="pl">カラー</div><input class="pi" type="color" value="'+(it.color||'#888')+'" onchange="updateSelectedProp(\'color\',this.value)"></div>';
      html += '<div class="pr"><div class="pl">壁テクスチャ</div><input class="pi" type="file" accept="image/*" onchange="uploadTex(this)"></div>';
      if(it.texture) html += '<button class="pbtn sec" onclick="updateSelectedProp(\'texture\',null)">テクスチャ解除</button>';
      html += selectedTextureFlipControlsHtml(it);
    }
    if((it.thick||0)>=120){
      var faces=getWallInteriorFaces(it);
      html += '<div class="ph" style="margin-top:12px">壁紙カラー（内観面）</div>';
      if(!faces.length){
        html += '<div style="font-size:9px;color:#7a8fb0;margin-top:5px">この壁は両面が外観カラー対象です。</div>';
      }
      faces.forEach(function(face,idx){
        var fs=getInteriorFaceSetting(it,face);
        var faceKey=interiorFaceKey(it,face);
        var ap=resolveInteriorFaceAppearance(it,face);
        html += '<div class="face-card">';
        html += '<div class="face-card-title">内面 '+(idx+1)+'</div>';
        html += renderFaceRuleControls('interior',it,faceKey,fs,ap);
        html += '</div>';
      });
      html += '<div style="font-size:9px;color:#7a8fb0;margin-top:5px">壁紙の全体・階別カラーは「内観カラー設定」で設定します。</div>';
      html += '<button class="pbtn sec" onclick="toggleInteriorColorPanel()" style="margin-top:6px">内観カラー設定を開く</button>';
      var extFaces=getWallExteriorSpans(it);
      if(extFaces.length){
        html += '<div class="ph" style="margin-top:12px">外観カラー（外観面）</div>';
        extFaces.forEach(function(face,idx){
          var efs=getExteriorFaceSetting(it,face);
          var faceKey=exteriorFaceKey(it,face);
          var ap=resolveExteriorFaceAppearance(it,face);
          html += '<div class="face-card">';
          html += '<div class="face-card-title">外面 '+(idx+1)+'</div>';
          html += renderFaceRuleControls('exterior',it,faceKey,efs,ap);
          html += '</div>';
        });
        html += '<div style="font-size:9px;color:#7a8fb0;margin-top:5px">外観の全体・階別カラーは「外観カラー設定」で設定します。</div>';
        html += '<button class="pbtn sec" onclick="toggleExteriorColorPanel()" style="margin-top:6px">外観カラー設定を開く</button>';
      }
    }
    html += selectedModelFinishesHtml(it);
  html += selectedDeleteButtonHtml();
    setPropsBodyHtml(body,html,it);
    return;
  }
  
  html += '<div class="pr"><div class="pl">位置 X (mm)</div><input class="pi" type="number" value="'+Math.round(it.x)+'" onchange="updateSelectedProp(\'x\',+this.value)"></div>';
  html += '<div class="pr"><div class="pl">位置 Y (mm)</div><input class="pi" type="number" value="'+Math.round(it.y)+'" onchange="updateSelectedProp(\'y\',+this.value)"></div>';
  
  // 道路は w が道路に沿った長さ、d が幅員。「幅 W / 奥行 D」のままだと
  // 幅を変えたいのに長さの欄を触ることになる(既定プランは w=30000/d=4550)。
  // 値の持ち方は変えず、呼び名だけその物に合わせる。
  var wLabel=(it.type==='road')?'道路長 (mm)':'幅 W (mm)';
  var dLabel=(it.type==='road')?'幅員 (mm)':'奥行 D (mm)';
  if(it.w !== undefined && !isWindowLikeType(it.type)) {
    html += '<div class="pr"><div class="pl">'+wLabel+'</div><input class="pi" type="number" value="'+Math.round(it.w)+'" onchange="updateSelectedProp(\'w\',+this.value)"></div>';
  }
  if(it.d !== undefined && !isWindowLikeType(it.type)) {
    html += '<div class="pr"><div class="pl">'+dLabel+'</div><input class="pi" type="number" value="'+Math.round(it.d)+'" onchange="updateSelectedProp(\'d\',+this.value)"></div>';
  }
  if(it.rot !== undefined) {
    html += '<div class="pr"><div class="pl">回転 (°)</div><input class="pi" type="number" value="'+Math.round(it.rot)+'" onchange="updateSelectedProp(\'rot\',+this.value)"></div>';
  }
  if(it.type==='site-rect'){
    html += '<div class="ph" style="margin-top:12px">敷地設定</div>';
    html += '<div class="pr"><div class="pl">基本の地表仕上げ</div><select class="pi" onchange="updateSelectedProp(\'siteSurface\',this.value)">'+siteSurfaceOptionsHtml(it.siteSurface)+'</select></div>';
    if(it.siteBoundary){
      html += '<div class="pr" style="display:block;font-size:12px;line-height:1.7">この矩形は土地全体の境界です。建物の範囲は外壁の輪郭、庭・駐車場は下の外構仕上げで示します。建築可能範囲を示す線ではありません。</div>';
    }
    siteFinishZones(it).forEach(function(z,index){
      html += '<div class="ph">外構仕上げ '+(index+1)+'</div>';
      html += '<div class="pr"><div class="pl">用途</div><input class="pi" value="'+escHtml(z.name)+'" onchange="updateSiteZone('+index+',\'name\',this.value)"></div>';
      html += '<div class="pr"><div class="pl">表面</div><select class="pi" onchange="updateSiteZone('+index+',\'surface\',this.value)">'+siteSurfaceOptionsHtml(z.surface)+'</select></div>';
      [['x','左端から (mm)'],['y','上端から (mm)'],['w','幅 (mm)'],['d','奥行 (mm)']].forEach(function(f){
        html += '<div class="pr"><div class="pl">'+f[1]+'</div><input class="pi" type="number" min="0" value="'+z[f[0]]+'" onchange="updateSiteZone('+index+',\''+f[0]+'\',this.value)"></div>';
      });
    });
    html += siteSetbackPanelHtml(it);
  }
  if(isWindowLikeType(it.type)){
    ensureWindowProps(it);
    html += '<div class="ph" style="margin-top:12px">窓サイズ・高さ</div>';
    html += '<div class="pr"><div class="pl">窓幅 (mm)</div><input class="pi" type="number" min="200" step="10" value="'+Math.round(it.w||0)+'" onchange="updateSelectedProp(\'w\',+this.value)"></div>';
    html += '<div class="pr"><div class="pl">見込み/奥行 (mm)</div><input class="pi" type="number" min="30" step="10" value="'+Math.round(it.d||0)+'" onchange="updateSelectedProp(\'d\',+this.value)"></div>';
    html += '<div class="pr"><div class="pl">下端高さ (床からmm)</div><input class="pi" type="number" min="0" max="'+Math.round(windowMaxTopMm(it))+'" step="10" value="'+Math.round(windowSillMm(it))+'" onchange="updateSelectedProp(\'windowSill\',+this.value)"></div>';
    var stdOpts='<option value="">規格サイズを選択...</option>';
    WINDOW_STD_PRESETS.forEach(function(p){
      stdOpts+='<option value="'+p.id+'"'+(it.windowStd===p.id?' selected':'')+'>'+p.label+'</option>';
    });
    if(it.type==='window'){
      var wk=effectiveWindowKind(it);
      html += '<div class="pr"><div class="pl">窓種別</div><select class="pi" onchange="updateSelectedProp(\'windowKind\',this.value)">';
      html += '<option value="sliding"'+(wk==='sliding'?' selected':'')+'>引違い</option>';
      html += '<option value="casement"'+(wk==='casement'?' selected':'')+'>すべり出し</option>';
      html += '<option value="fix"'+(wk==='fix'?' selected':'')+'>FIX (はめ殺し)</option>';
      html += '</select></div>';
    }
    html += '<div class="pr"><div class="pl">サッシ規格 (LIXIL呼称)</div><select class="pi" onchange="applyWindowStdPreset(this.value)">'+stdOpts+'</select></div>';
    var sashColorOpts='<option value=""'+(!it.sashColor?' selected':'')+'>標準 (ダークグレー)</option>';
    SASH_COLORS.forEach(function(sc){
      sashColorOpts+='<option value="'+sc.hex+'"'+(it.sashColor===sc.hex?' selected':'')+'>'+sc.label+'</option>';
    });
    html += '<div class="pr"><div class="pl">サッシ色</div><select class="pi" onchange="updateSelectedProp(\'sashColor\',this.value)">'+sashColorOpts+'</select></div>';
    html += '<div class="pr"><div class="pl">窓の縦高さ (mm)</div><input class="pi" type="number" min="200" max="'+Math.round(windowMaxTopMm(it))+'" step="10" value="'+Math.round(windowHeightMm(it))+'" onchange="updateSelectedProp(\'windowHeight\',+this.value)"></div>';
    html += '<div style="font-size:9px;color:#7a8fb0;margin-top:5px">上端高さ: '+Math.round(windowTopMm(it))+'mm</div>';
  }
  if(isDoorLikeOpeningType(it.type)){
    html += '<div class="ph" style="margin-top:12px">ドア・開口高さ</div>';
    if(isInteriorSwingDoorType(it.type)){
      var doorWOpts='<option value="">規格幅を選択...</option>';
      DOOR_STD_WIDTHS.forEach(function(p){
        doorWOpts+='<option value="'+p.w+'"'+(it.w===p.w?' selected':'')+'>'+p.label+'</option>';
      });
      html += '<div class="pr"><div class="pl">ドア幅規格 (LIXIL実勢値)</div><select class="pi" onchange="applyDoorWidthPreset(this.value)">'+doorWOpts+'</select></div>';
    }
    html += '<div class="pr"><div class="pl">高さ (mm)</div><input class="pi" type="number" min="300" max="3200" step="10" value="'+Math.round(doorHeightMm(it))+'" onchange="updateSelectedProp(\'doorHeight\',+this.value)"></div>';
    if(isDoorPanelType(it.type)){
      html += '<div class="pr"><div class="pl">開閉状態</div><select class="pi" onchange="updateSelectedProp(\'doorOpenState\',this.value)">';
      [['open','開き'],['closed','閉じ']].forEach(function(opt){
        html += '<option value="'+opt[0]+'" '+(doorOpenState(it)===opt[0]?'selected':'')+'>'+opt[1]+'</option>';
      });
      html += '</select></div>';
      if(isInteriorSwingDoorType(it.type)||it.type==='door-fold'||it.type==='door-fold-w') html+='<div class="pr"><label class="pl">パネル仕上げ</label><select class="pi" onchange="updateSelectedProp(\'doorFinish\',this.value)"><option value="">標準</option><option value="bath-clear" '+(it.doorFinish==='bath-clear'?'selected':'')+'>浴室・透明パネル</option></select></div>';
      // テクスチャにノブや窓が描かれている場合に3Dの造形と干渉しないようOFFにできる
      html += '<div class="pr"><div class="pl">ドアノブ・ハンドル</div><label style="display:flex;align-items:center;gap:6px;font-size:11px"><input type="checkbox" '+(it.showDoorHandle!==false?'checked':'')+' onchange="updateSelectedProp(\'showDoorHandle\',this.checked)">3Dで表示する</label></div>';
      if(it.type==='door-front'){
        html += '<div class="pr"><div class="pl">採光スリット (小窓)</div><label style="display:flex;align-items:center;gap:6px;font-size:11px"><input type="checkbox" '+(it.showDoorSlit!==false?'checked':'')+' onchange="updateSelectedProp(\'showDoorSlit\',this.checked)">3Dで表示する</label></div>';
      }
    }
  }
  if(it.type==='wood-fence'){
    if(!it.fenceHeight) it.fenceHeight=1600;
    if(!it.fencePattern) it.fencePattern='horizontal';
    if(!it.fenceTopStyle) it.fenceTopStyle='even';
    html += '<div class="pr"><div class="pl">高さ H (mm)</div><input class="pi" type="number" min="300" max="3000" step="50" value="'+Math.round(it.fenceHeight)+'" onchange="updateSelectedProp(\'fenceHeight\',+this.value)"></div>';
    html += '<div class="pr"><div class="pl">板方向</div><select class="pi" onchange="updateSelectedProp(\'fencePattern\',this.value)">';
    [['vertical','縦板'],['horizontal','横板']].forEach(function(opt){
      html += '<option value="'+opt[0]+'" '+((it.fencePattern||'vertical')===opt[0]?'selected':'')+'>'+opt[1]+'</option>';
    });
    html += '</select></div>';
  }
  if(it.type==='lattice-screen'){
    if(!it.latticeHeight) it.latticeHeight=1600;
    if(!it.fencePattern) it.fencePattern='vertical';
    if(!it.fenceTopStyle) it.fenceTopStyle='even';
    html += '<div class="pr"><div class="pl">高さ H (mm)</div><input class="pi" type="number" min="300" max="3000" step="50" value="'+Math.round(it.latticeHeight)+'" onchange="updateSelectedProp(\'latticeHeight\',+this.value)"></div>';
    html += '<div class="pr" style="font-size:10px;color:#889;padding:0 2px 6px">高さZ(mm)で浮かせて、バルコニーのルーバーや室内間仕切りに使えます</div>';
  }
  if(isContextExteriorItemType(it.type)){
    if(!isFinite(Number(it.contextHeight))) it.contextHeight=defaultContextExteriorHeight(it.type);
    html += '<div class="ph" style="margin-top:12px">周辺要素設定</div>';
    if(it.type==='neighbor-building' || it.type==='neighbor-house'){
      var ctxFloors=getContextFloors(it);
      var maxFloors=it.type==='neighbor-building'?12:3;
      html += '<div class="pr"><div class="pl">階数</div><input class="pi" type="number" min="1" max="'+maxFloors+'" step="1" value="'+ctxFloors+'" onchange="updateSelectedContextFloors(+this.value)"></div>';
      html += '<div class="pr"><div class="pl">算定高さ</div><input class="pi" type="text" value="'+Math.round(getContextExteriorHeight(it))+'mm（1階 '+contextStoryHeightMm()+'mm）" readonly></div>';
      html += '<div class="pr"><div class="pl">半透明表示</div><label style="display:flex;align-items:center;gap:6px;font-size:11px"><input type="checkbox" '+(it.contextGhost!==false?'checked':'')+' onchange="updateSelectedProp(\'contextGhost\',this.checked)">計画建物を見やすくする</label></div>';
    } else if(it.type!=='road'){
      html += '<div class="pr"><div class="pl">高さ H (mm)</div><input class="pi" type="number" min="100" max="30000" step="100" value="'+Math.round(getContextExteriorHeight(it))+'" onchange="updateSelectedProp(\'contextHeight\',+this.value)"></div>';
    } else {
      html += '<div class="pr"><div class="pl">路面厚 (mm)</div><input class="pi" type="number" min="20" max="200" step="10" value="'+Math.round(getContextExteriorHeight(it))+'" onchange="updateSelectedProp(\'contextHeight\',+this.value)"></div>';
    }
  }
  if(isCustomBlockType(it.type)){
    if(!it.customHeight) it.customHeight=900;
    if(!it.color) it.color=ICOLORS[it.type]||'#c9d7ee';
    html += '<div class="ph" style="margin-top:12px">任意ブロック設定</div>';
    html += '<div class="pr"><div class="pl">名称</div><input class="pi" type="text" value="'+escHtml(it.name||'任意ブロック')+'" onchange="updateSelectedProp(\'name\',this.value)"></div>';
    html += '<div class="pr"><div class="pl">高さ H (mm)</div><input class="pi" type="number" min="10" max="6000" step="10" value="'+Math.round(getCustomBlockHeight(it))+'" onchange="updateSelectedProp(\'customHeight\',+this.value)"></div>';
    html += '<div class="pr"><div class="pl">カラー</div><input class="pi" type="color" value="'+(it.color||ICOLORS[it.type]||'#c9d7ee')+'" onchange="updateSelectedProp(\'color\',this.value)"></div>';
    if(canSetItemTexture(it)){
      html += '<div class="pr"><div class="pl">テクスチャ</div><input class="pi" type="file" accept="image/*" onchange="uploadTex(this)"></div>';
      if(it.texture) html += '<button class="pbtn sec" onclick="updateSelectedProp(\'texture\',null)">テクスチャ解除</button>';
      html += selectedTextureFlipControlsHtml(it);
    }
  }
  if(isLightItemType(it.type)){
    ensureLightDefaults(it);
    var lk=it.lightKind||lightKindFromType(it.type);
    html += '<div class="ph" style="margin-top:12px">ライト設定</div>';
    html += '<div class="pr"><div class="pl">ライト種</div><select class="pi" onchange="updateSelectedLightKind(this.value)">';
    [['ceiling','シーリングライト'],['down','ダウンライト'],['spot','スポットライト']].forEach(function(opt){
      html += '<option value="'+opt[0]+'" '+(lk===opt[0]?'selected':'')+'>'+opt[1]+'</option>';
    });
    html += '</select></div>';
    html += '<div class="pr"><div class="pl">ライト形状</div><select class="pi" onchange="updateSelectedProp(\'lightShape\',this.value)">';
    [['point','点ライト'],['line','線ライト']].forEach(function(opt){
      html += '<option value="'+opt[0]+'" '+((it.lightShape||'point')===opt[0]?'selected':'')+'>'+opt[1]+'</option>';
    });
    html += '</select></div>';
    html += '<div class="pr"><div class="pl">ライトカラー</div><input class="pi" type="color" value="'+(it.lightColor||'#fff6dd')+'" onchange="updateSelectedProp(\'lightColor\',this.value)"></div>';
    html += '<div class="pr"><div class="pl">色温度プリセット</div><div style="display:flex;gap:4px;flex-wrap:wrap">';
    LIGHT_KELVIN_PRESETS.forEach(function(k){
      var active=(it.lightColor||'').toLowerCase()===k.color;
      html += '<button type="button" class="pbtn sec" style="margin-top:0;padding:4px 6px;font-size:10px;background:'+k.color+';color:#333;border:'+(active?'2px solid #e94560':'1px solid #999')+'" onclick="updateSelectedProp(\'lightColor\',\''+k.color+'\')">'+k.label+'</button>';
    });
    html += '</div></div>';
    html += '<div class="pr"><div class="pl">明るさ</div><input class="pi" type="number" min="0" max="3" step="0.05" value="'+Number(it.lightIntensity||0).toFixed(2)+'" onchange="updateSelectedProp(\'lightIntensity\',+this.value)"></div>';
    html += '<div class="pr"><div class="pl">光の届く距離 (mm)</div><input class="pi" type="number" min="500" max="12000" step="100" value="'+Math.round(it.lightRange||4500)+'" onchange="updateSelectedProp(\'lightRange\',+this.value)"></div>';
    if(lk!=='ceiling'){
      html += '<div class="pr"><div class="pl">照射角 (°)</div><input class="pi" type="number" min="10" max="110" step="1" value="'+Math.round(it.lightAngle||45)+'" onchange="updateSelectedProp(\'lightAngle\',+this.value)"></div>';
    }
    html += '<label class="lock-control-label" style="margin-top:8px"><input type="checkbox" '+(it.lightCastShadow!==false?'checked':'')+' onchange="updateSelectedProp(\'lightCastShadow\',this.checked)">影を落とす</label>';
  }
  if(it.type==='foundation'){
    if(it.foundationHeight===undefined || isNaN(Number(it.foundationHeight))) it.foundationHeight=450;
    html += '<div class="ph" style="margin-top:12px">基礎設定</div>';
    html += '<div class="pr"><div class="pl">実寸素材</div><select class="pi" onchange="updateSelectedProp(\'texture\',this.value)"><option value="">色・既存の画像</option>'+Object.keys(SITE_SURFACE_OPTIONS).map(function(key){return '<option value="'+key+'" '+(it.texture===key?'selected':'')+'>'+SITE_SURFACE_OPTIONS[key].label+'</option>';}).join('')+'</select></div>';
    html += '<div class="pr"><div class="pl">基礎厚さ (mm)</div><input class="pi" type="number" min="0" max="2000" step="10" value="'+Math.round(it.foundationHeight)+'" onchange="updateSelectedProp(\'foundationHeight\',+this.value)"></div>';
    html += '<div class="pr"><label class="lock-control-label"><input type="checkbox" '+(it.foundationFlashing!==false?'checked':'')+' onchange="updateSelectedProp(\'foundationFlashing\',this.checked)">水切りを付ける</label></div>';
    html += '<div style="font-size:9px;color:#7a8fb0;margin-top:5px">基礎厚さ分、家全体の床・壁・家具・屋根が上に持ち上がります。水切りは外壁の下端を受ける金物で、基礎の上に壁が立っているときだけ付きます。</div>';
  }
  if(it.type==='exterior-stair' || it.type==='ramp'){
    if(!it.targetHeight) it.targetHeight=foundationHeightMm()||450;
    html += '<div class="ph" style="margin-top:12px">外構高さ</div>';
    html += '<div class="pr"><div class="pl">到達高さ (mm)</div><input class="pi" type="number" min="0" max="2000" step="10" value="'+Math.round(it.targetHeight)+'" onchange="updateSelectedProp(\'targetHeight\',+this.value)"></div>';
    if(it.type==='exterior-stair'){
      if(!it.accessSteps) it.accessSteps=3;
      html += '<div class="pr"><div class="pl">段数</div><input class="pi" type="number" min="1" max="12" step="1" value="'+Math.round(it.accessSteps)+'" onchange="updateSelectedProp(\'accessSteps\',+this.value)"></div>';
    }
  }
  if(canSetItemElevation(it)) {
    if(it.elev === undefined || isNaN(it.elev)) it.elev = 0;
    html += '<div class="pr"><div class="pl">高さ Z (mm)</div><input class="pi" type="number" step="10" value="'+Math.round(it.elev||0)+'" onchange="updateSelectedProp(\'elev\',+this.value)"></div>';
  }
  if(it.flipX === undefined && it.type && it.type!=='room' && it.type!=='site-rect' && it.type!=='foundation') it.flipX=false;
  if(it.flipY === undefined && it.type && it.type!=='room' && it.type!=='site-rect' && it.type!=='foundation') it.flipY=false;
  if(it.flipX !== undefined && !isLightItemType(it.type)) {
    html += '<div class="pr"><div class="pl">反転</div><div style="display:flex;gap:4px">';
    html += '<button class="pbtn sec" style="margin-top:0" onclick="updateSelectedProp(\'flipX\', !ST.selected.flipX)">左右反転</button>';
    html += '<button class="pbtn sec" style="margin-top:0" onclick="updateSelectedProp(\'flipY\', !ST.selected.flipY)">上下反転</button>';
    html += '</div></div>';
  }
  if(it.type==='water-heater' || it.type==='original-tank') html+='<div class="lock-status-note">貯湯タンクのモデルです。庭・外構の「ヒートポンプ（貯湯タンク用）」と組み合わせて配置できます。</div>';
  if(it.type==='car'){html += '<div class="lock-status-note">精密モデル：BMW M4 Competition<br><a href="assets/model-credits.html" target="_blank" rel="noopener">モデル作者・ライセンス</a></div>';}
  if(it.type === 'roof') {
    if(!it.roofType) it.roofType='gable';
    if(!it.pitch) it.pitch=30;
    if(!it.roofThickness) it.roofThickness=180;
    if(it.roofSkirt===undefined || isNaN(Number(it.roofSkirt))) it.roofSkirt=0;
    if(!it.roofEdgeColor) it.roofEdgeColor='#3a2f2a';
    var roofGlobal=ensureRoofAppearance();
    html += '<div class="pr"><div class="pl">屋根形状</div><select class="pi" onchange="updateSelectedProp(\'roofType\',this.value)">';
    roofTypeOptions().forEach(function(opt){
      html += '<option value="'+opt[0]+'" '+(it.roofType===opt[0]?'selected':'')+'>'+opt[1]+'</option>';
    });
    html += '</select></div>';
    html += '<div class="pr"><div class="pl">勾配 (°)</div><input class="pi" type="number" min="5" max="60" value="'+Math.round(it.pitch||30)+'" onchange="updateSelectedProp(\'pitch\',+this.value)"></div>';
    html += roofMergeSectionHtml(it);
    var gm=it.gutterMode||'auto';
    html += '<div class="pr"><div class="pl">雨樋</div><select class="pi" onchange="updateSelectedProp(\'gutterMode\',this.value)">';
    html += '<option value="auto"'+(gm==='auto'?' selected':'')+'>自動 (軒樋+竪樋)</option>';
    html += '<option value="eaves"'+(gm==='eaves'?' selected':'')+'>軒樋のみ (竪樋は手動配置)</option>';
    html += '<option value="off"'+(gm==='off'?' selected':'')+'>なし</option>';
    html += '</select></div>';
    html += '<div class="pr"><div class="pl">屋根厚み (mm)</div><input class="pi" type="number" min="30" max="600" step="10" value="'+Math.round(it.roofThickness||180)+'" onchange="updateSelectedProp(\'roofThickness\',+this.value)"></div>';
    html += '<div class="pr"><div class="pl">隙間補完下がり (mm)</div><input class="pi" type="number" min="0" max="1200" step="10" value="'+Math.round(it.roofSkirt||0)+'" onchange="updateSelectedProp(\'roofSkirt\',+this.value)"></div>';
    html += '<div class="pr"><div class="pl">厚み部分の色</div><input class="pi" type="color" value="'+(it.roofEdgeColor||'#3a2f2a')+'" onchange="updateSelectedProp(\'roofEdgeColor\',this.value)"></div>';
    if(roofGlobal.whole && roofGlobal.whole.linked){
      html += '<div style="font-size:9px;color:#7a8fb0;margin-top:5px">屋根カラー/テクスチャは「屋根カラー設定」が優先中です。</div>';
      html += '<button class="pbtn sec" onclick="toggleRoofColorPanel()" style="margin-top:6px">屋根カラー設定を開く</button>';
    } else {
      html += '<div class="pr"><div class="pl">屋根カラー</div><input class="pi" type="color" value="'+(it.color||'#2a2a30')+'" onchange="updateSelectedProp(\'color\',this.value)"></div>';
      html += '<div class="pr"><div class="pl">屋根テクスチャ</div><input class="pi" type="file" accept="image/*" onchange="uploadTex(this)"></div>';
      if(it.texture) html += '<button class="pbtn sec" onclick="updateSelectedProp(\'texture\',null)">屋根テクスチャ解除</button>';
      html += selectedTextureFlipControlsHtml(it);
    }
  }
  if(isStairPartType(it.type)) {
    var sri = stairRiseInfo(it);
    var orderVal = it.stairOrder !== undefined ? it.stairOrder : (sri.index + 1);
    // 行き先。平面だけからは「上の階へ上がる階段」と「同じ階の段差を上る階段」を
    // 区別できないので宣言させる。省略は従来どおり上の階。
    var target = (it.stairTarget === 'level') ? 'level' : 'upper';
    html += '<div class="pr"><div class="pl">行き先</div><select class="pi" onchange="updateSelectedProp(\'stairTarget\',this.value===\'level\'?\'level\':undefined)">'+
      '<option value="upper"'+(target==='upper'?' selected':'')+'>上の階</option>'+
      '<option value="level"'+(target==='level'?' selected':'')+'>同じ階の段差（スキップフロア）</option>'+
      '</select></div>';
    // 手すり。付ける側は選ばせ、壁付けか柱建てかは置いた場所から決める。
    var rail = ({left:'left',right:'right',both:'both'})[it.stairRail] || 'none';
    html += '<div class="pr"><div class="pl">手すり</div><select class="pi" onchange="updateSelectedProp(\'stairRail\',this.value===\'none\'?undefined:this.value)">'+
      '<option value="none"'+(rail==='none'?' selected':'')+'>なし</option>'+
      '<option value="left"'+(rail==='left'?' selected':'')+'>左側</option>'+
      '<option value="right"'+(rail==='right'?' selected':'')+'>右側</option>'+
      '<option value="both"'+(rail==='both'?' selected':'')+'>両側</option>'+
      '</select></div>';
    if(rail !== 'none'){
      var rmount = (it.stairRailMount==='wall'||it.stairRailMount==='post') ? it.stairRailMount : 'auto';
      html += '<div class="pr"><div class="pl">手すりの付け方</div><select class="pi" onchange="updateSelectedProp(\'stairRailMount\',this.value===\'auto\'?undefined:this.value)">'+
        '<option value="auto"'+(rmount==='auto'?' selected':'')+'>自動（壁が沿っていれば壁付け）</option>'+
        '<option value="wall"'+(rmount==='wall'?' selected':'')+'>壁付け</option>'+
        '<option value="post"'+(rmount==='post'?' selected':'')+'>柱建て</option>'+
        '</select></div>';
      html += railingDesignHtml(it,{label:'手すりの意匠'});
      html += '<div class="lock-status-note">'+
        stairRailSides(it).map(function(sd){
          return (sd==='left'?'左':'右')+'は'+(stairRailMountFor(it,sd)==='wall'?'壁付け':'柱建て');
        }).join('、')+
        '。段鼻から '+STAIR_RAIL_HEIGHT_MM+'mm。色は階段の板とは別です。'+
        (rmount==='auto'?'自動は、階段と平行な壁が沿っていれば壁付けにします。':'')+'</div>';
    }
    // 外観の形状。昇降の形(直・かね折れ・折り返し・回り)は置く部材の
    // 組み合わせで決まるので、ここで選ぶのは1枚ごとの作りだけ。
    var sstyle = stairStyleOf(it);
    html += '<div class="pr"><div class="pl">階段の形状</div><select class="pi" onchange="updateSelectedProp(\'stairStyle\',this.value===\'open\'?undefined:this.value)">'+
      '<option value="open"'+(sstyle==='open'?' selected':'')+'>ひな壇（側面が見える・階段下は素通し）</option>'+
      '<option value="box"'+(sstyle==='box'?' selected':'')+'>箱型（階段下を塞ぐ）</option>'+
      '<option value="skeleton"'+(sstyle==='skeleton'?' selected':'')+'>スケルトン（蹴込み板なし）</option>'+
      '</select></div>';
    html += '<div class="lock-status-note">'+({
        open:'階段下は素通し。造作棚を置けば収納にできます。',
        box:'階段下を塞ぎます。下を収納にしたいなら、ひな壇のまま造作棚を置いてください。',
        skeleton:'蹴込み板なし。光と視線が抜けます。'
      }[sstyle])+'</div>';
    // 足元。段差のある階でだけ出す。
    if(floorMaxSkipLevelMm(it.floor) > 0){
      var sbase = (it.baseLevel==='floor'||it.baseLevel==='skip') ? it.baseLevel : 'auto';
      html += '<div class="pr"><div class="pl">階段の足元</div><select class="pi" onchange="updateSelectedProp(\'baseLevel\',this.value===\'auto\'?undefined:this.value)">'+
        '<option value="auto"'+(sbase==='auto'?' selected':'')+'>自動（下端の先の床から）</option>'+
        '<option value="floor"'+(sbase==='floor'?' selected':'')+'>階の床から</option>'+
        '<option value="skip"'+(sbase==='skip'?' selected':'')+'>段差の上から</option>'+
        '</select></div>';
      html += '<div class="lock-status-note">いまの足元は ＋'+
        Math.round((stairUpperSpanM(it).baseY - floorTopY(it.floor))/U)+'mm です。'+
        '自動は階段の下端の先にある床を見ます（部材の中心ではないので、段差からはみ出す大きさの階段でも段差の上から始まります）。</div>';
    }
    html += '<div class="lock-status-note">上り高さ '+Math.round(stairGroupRiseM(it)/U)+'mm / '+
      (sri.steps||getStairStepCount(it))+'段。'+
      (target==='level'
        ? '同じ階の段差を上ります。上階の床には穴を開けません。'
        : '上の階の床まで上がります。')+'</div>';
    html += '<div class="pr"><div class="pl">階段 高さ順 (1=下)</div><input class="pi" type="number" min="1" max="12" value="'+orderVal+'" onchange="updateSelectedProp(\'stairOrder\',+this.value)"></div>';
    html += '<div class="pr"><div class="pl">接続パーツ: '+sri.count+' / 現在 '+(sri.index+1)+' 番目</div><button class="pbtn sec" onclick="updateSelectedProp(\'stairOrder\',undefined)">自動判定に戻す</button></div>';
  }
  if(it.sScale !== undefined && it.type!=='room' && it.type!=='wall' && it.type!=='site-rect' && it.type!=='roof' && !isFmpItemType(it.type) && !isCustomBlockType(it.type) && !isLightItemType(it.type)) {
    if(it.type==='downspout'){
      html += '<div class="pr"><div class="pl">上端の高さ (mm)</div><input class="pi" type="number" min="500" max="12000" step="50" value="'+Math.round(it.downspoutTop||5450)+'" onchange="updateSelectedProp(\'downspoutTop\',+this.value)"></div>';
    }
    if(it.type==='gas-heater'){
      html += '<div class="pr"><div class="pl">取付高さ (下端mm)</div><input class="pi" type="number" min="0" max="3000" step="50" value="'+Math.round(it.gasHeaterMount||1300)+'" onchange="updateSelectedProp(\'gasHeaterMount\',+this.value)"></div>';
    }
    if(!EXTERIOR_MODEL_IDS[it.type]) html += '<div class="pr"><div class="pl">3Dカラー</div><input class="pi" type="color" value="'+(it.color||ICOLORS[it.type]||'#dddddd')+'" onchange="updateSelectedProp(\'color\',this.value)"></div>';
    if(canSetItemTexture(it)){
      var texLabel=isDoorItemType(it.type)?'ドアテクスチャ':'テクスチャ';
      html += isDoorItemType(it.type)
        ? selectedTextureUploadHtml(it,texLabel)
        : '<div class="pr"><div class="pl">'+texLabel+'</div><input class="pi" type="file" accept="image/*" onchange="uploadTex(this)"></div>';
      if(it.texture) html += '<button class="pbtn sec" onclick="updateSelectedProp(\'texture\',null)">テクスチャ解除</button>';
      html += selectedTextureFlipControlsHtml(it);
    }
    var isDoorTextureCrop=isDoorItemType(it.type);
    if(!isContextExteriorItemType(it.type) && !EXTERIOR_MODEL_IDS[it.type] && (!isDoorTextureCrop || it.texture)){
      html += '<div class="ph" style="margin-top:15px">'+(isDoorTextureCrop?'テクスチャ画像トリミング':'画像トリミング (余白調整)')+'</div>';
      html += '<div class="pr"><div class="pl">拡大率: <span class="texture-crop-value">'+(it.sScale||1).toFixed(2)+'</span></div><input class="pi" type="range" min="0.5" max="2.0" step="0.05" value="'+(it.sScale||1)+'" oninput="updateSelectedTextureCrop(\'sScale\',+this.value,this)" onchange="finishSelectedTextureCrop()"></div>';
      html += '<div class="pr"><div class="pl">位置 X: <span class="texture-crop-value">'+Math.round(it.sX||0)+'</span></div><input class="pi" type="range" min="-300" max="300" step="10" value="'+(it.sX||0)+'" oninput="updateSelectedTextureCrop(\'sX\',+this.value,this)" onchange="finishSelectedTextureCrop()"></div>';
      html += '<div class="pr"><div class="pl">位置 Y: <span class="texture-crop-value">'+Math.round(it.sY||0)+'</span></div><input class="pi" type="range" min="-300" max="300" step="10" value="'+(it.sY||0)+'" oninput="updateSelectedTextureCrop(\'sY\',+this.value,this)" onchange="finishSelectedTextureCrop()"></div>';
    }
  }
  if(it.type === 'lattice-screen') {
    html += '<div class="ph" style="margin-top:12px">格子</div>';
    html += '<div class="pr"><div class="pl">格子の間隔 (mm)</div><input class="pi" type="number" min="30" max="600" step="5" value="'+latticePitchMm(it)+'" onchange="updateSelectedProp(\'latticePitch\',+this.value)"></div>';
    html += '<div class="pr"><div class="pl">格子の見付 (mm)</div><input class="pi" type="number" min="15" max="200" step="5" value="'+latticeSlatMm(it)+'" onchange="updateSelectedProp(\'latticeSlat\',+this.value)"></div>';
    html += '<div class="pr"><div class="pl">上端形状</div><select class="pi" onchange="updateSelectedProp(\'fenceTopStyle\',this.value)">';
    [['even','上端を揃える'],['varied','上端を不揃いにする']].forEach(function(opt){
      html += '<option value="'+opt[0]+'" '+((it.fenceTopStyle||'even')===opt[0]?'selected':'')+'>'+opt[1]+'</option>';
    });
    html += '</select></div>';
    html += railingDesignHtml(it,{label:'格子の意匠',frameDefault:'#b09468',capToggle:true});
    html += '<div class="lock-status-note">格子の内法 '+latticeClearMm(it)+'mm。'+
      (latticeClearMm(it)>110?'手すりには 110mm 以下が目安です。':'手すりとして使える内法です。')+'</div>';
  }
  if(isColumnType(it.type)) {
    html += '<div class="pr"><div class="pl">柱の高さ (mm)</div><input class="pi" type="number" min="100" max="6000" step="50" value="'+columnHeightMm(it)+'" onchange="updateSelectedProp(\'columnHeight\',+this.value)"></div>';
    html += '<div class="lock-status-note">'+(it.baseLevel==='under'
      ? '段差の下に立っています。高さは段差に合わせてあります。'
      : '太さは上の幅・奥行きで変えられます。段差の下に置くと、足元と高さが段差に合います。')+'</div>';
  }
  if(it.type === 'shelf-built-in') {
    html += '<div class="pr"><div class="pl">棚の高さ (mm)</div><input class="pi" type="number" min="150" max="2700" step="50" value="'+shelfHeightMm(it)+'" onchange="updateSelectedProp(\'shelfHeight\',+this.value)"></div>';
    html += '<div class="pr"><div class="pl">棚板の枚数</div><input class="pi" type="number" min="1" max="8" step="1" value="'+shelfBoardCount(it)+'" onchange="updateSelectedProp(\'shelfCount\',+this.value)"></div>';
    var sides = (it.shelfSides==='none'||it.shelfSides==='both') ? it.shelfSides : 'auto';
    html += '<div class="pr"><div class="pl">縦板</div><select class="pi" onchange="updateSelectedProp(\'shelfSides\',this.value===\'auto\'?undefined:this.value)">'+
      '<option value="auto"'+(sides==='auto'?' selected':'')+'>自動（壁に付いていれば無し）</option>'+
      '<option value="none"'+(sides==='none'?' selected':'')+'>なし（壁で支える）</option>'+
      '<option value="both"'+(sides==='both'?' selected':'')+'>あり（両端に立てる）</option>'+
      '</select></div>';
    html += '<div class="lock-status-note">'+(shelfSideBoards(it)==='none'
      ? 'いまは縦板なしです。棚板は壁に支えられている納まりになります。'
      : 'いまは両端に縦板が立っています。壁で支える納まりにするなら「なし」を選んでください。')+
      (sides==='auto'
        ? '（自動は、背面が壁に接していれば縦板なしにします。回転や反転を掛けた棚では当たらないことがあるので、その場合は明示してください。）'
        : '')+'</div>';
  }
  // 段差のある部屋の中に居るものだけ、置く高さの基準を選ばせる。
  // 段差の無い家では欄そのものが出ないので、既存の操作は1つも増えない。
  if(it.type !== 'room' && it.type !== 'wall' && !isOpeningItemType(it.type) &&
     roomSkipCavityMm(roomAtPointOnFloor(it.floor,(it.x||0)+(it.w||0)/2,(it.y||0)+(it.d||0)/2)) > 0) {
    var under = it.baseLevel === 'under';
    html += '<div class="pr"><div class="pl">置く高さ</div><select class="pi" onchange="updateSelectedProp(\'baseLevel\',this.value===\'under\'?\'under\':undefined)">'+
      '<option value="floor"'+(under?'':' selected')+'>段差の上（この部屋の床）</option>'+
      '<option value="under"'+(under?' selected':'')+'>段差の下（床下の空間）</option>'+
      '</select></div>';
  }
  if(it.type === 'room') {
    html += '<div class="pr"><div class="pl">部屋名</div><input class="pi" type="text" value="'+(it.n||'')+'" onchange="updateSelectedProp(\'n\',this.value)"></div>';
    html += '<div class="pr"><div class="pl">床テクスチャ</div><input class="pi" type="file" accept="image/*" onchange="uploadTex(this)"></div>';
    if(it.texture) html += '<button class="pbtn sec" onclick="updateSelectedProp(\'texture\',null)">テクスチャ解除</button>';
    html += selectedTextureFlipControlsHtml(it);
    html += selectedRoomFloorHtml(it);
    html += selectedRoomSkipHtml(it);
    html += selectedRoomCeilingHtml(it);
    html += selectedRoomCeilingFinishHtml(it);
  }
  if(it.thick !== undefined) {
    html += '<div class="pr"><div class="pl">壁厚 (mm)</div><input class="pi" type="number" value="'+it.thick+'" onchange="updateSelectedProp(\'thick\',+this.value)"></div>';
    // 段差のある階でだけ、足元と高さの基準を選ばせる。
    // 自動は「接する部屋の段差」から判断するが、部屋の外を通る壁や、
    // 部屋の縁からわずかに外れた壁では当たらない。そのための明示。
    if(floorMaxSkipLevelMm(it.floor) > 0) {
      var wbase = (it.baseLevel==='floor'||it.baseLevel==='skip') ? it.baseLevel : 'auto';
      html += '<div class="ph" style="margin-top:12px">スキップフロア</div>';
      html += '<div class="pr"><div class="pl">壁の基準</div><select class="pi" onchange="updateSelectedProp(\'baseLevel\',this.value===\'auto\'?undefined:this.value)">'+
        '<option value="auto"'+(wbase==='auto'?' selected':'')+'>自動（接する部屋から判断）</option>'+
        '<option value="floor"'+(wbase==='floor'?' selected':'')+'>階の床から</option>'+
        '<option value="skip"'+(wbase==='skip'?' selected':'')+'>段差の上から</option>'+
        '</select></div>';
      html += '<div class="lock-status-note">いまの足元は ＋'+wallSkipFootMm(it)+'mm、高さの基準は ＋'+wallSkipBaseMm(it)+'mm です。'+
        '両側とも段差の上にある壁だけ足元が上がります（段差の境界の壁は蹴上げ面を兼ねるので下ろしたまま）。</div>';
    }
    html += '<div class="pr"><div class="pl">カラー</div><input class="pi" type="color" value="'+(it.color||'#888')+'" onchange="updateSelectedProp(\'color\',this.value)"></div>';
    html += '<div class="pr"><div class="pl">壁テクスチャ</div><input class="pi" type="file" accept="image/*" onchange="uploadTex(this)"></div>';
    if(it.texture) html += '<button class="pbtn sec" onclick="updateSelectedProp(\'texture\',null)">テクスチャ解除</button>';
    html += selectedTextureFlipControlsHtml(it);
  }
  
  html += selectedModelFinishesHtml(it);
  html += selectedDeleteButtonHtml();
  setPropsBodyHtml(body,html,it);
}
function makeBathroomDoorLeaf(w,h,d){
  var g=new THREE.Group();g.name='Bathroom clear framed panel';
  var frame=new THREE.MeshStandardMaterial({color:0xb6bfc2,metalness:.72,roughness:.28});
  var seal=new THREE.MeshStandardMaterial({color:0x343e42,roughness:.8});
  var glass=new THREE.MeshStandardMaterial({color:0xdceff0,transparent:true,opacity:.19,roughness:.09,metalness:.12,depthWrite:false,side:THREE.DoubleSide});
  function bar(name,x,y,bw,bh,bd,mat){var m=new THREE.Mesh(new THREE.BoxGeometry(bw,bh,bd),mat);m.name=name;m.position.set(x,y,0);m.castShadow=mat!==glass;m.receiveShadow=mat!==glass;g.add(m);}
  bar('Clear glazing',0,0,w-.055,h-.105,.005,glass);
  [-1,1].forEach(function(a){bar('Glazing gasket',a*(w/2-.027),0,.006,h-.05,d*.65,seal);bar('Aluminium stile',a*(w/2-.012),0,.024,h,d,frame);});
  bar('Top rail',0,h/2-.017,w,.034,d,frame);bar('Bottom rail',0,-h/2+.032,w,.064,d,frame);
  bar('Meeting rail',0,-.08,w,.023,d,frame);
  return g;
}
function selectedModelFinishesHtml(it){
  var model=getItemFinishModel(it.type);
  if(!model || !model.finishChannels) return '';
  var html='<div class="ph" style="margin-top:12px">素材・カラー</div><div class="model-finish-note">素材の表情を保って色を変更</div>';
  if(model.mirrorOption) html+='<div class="pr"><label class="pl" for="shoe-mirror">姿見</label><input id="shoe-mirror" type="checkbox" '+(it.showMirror?'checked':'')+' onchange="updateSelectedProp(\'showMirror\',this.checked)"></div>';
  model.finishChannels.forEach(function(channel){
    var value=(it.finishColors&&it.finishColors[channel.key])||channel.default;
    html+='<div class="pr"><label class="pl" for="finish-'+channel.key+'">'+escHtml(channel.label)+'</label><input id="finish-'+channel.key+'" class="pi" type="color" value="'+escHtml(value)+'" oninput="updateSelectedModelFinish(\''+channel.key+'\',this.value)"></div>';
    if(channel.key!=='fabric'&&channel.key!=='accent'){
      var current=it.finishRoughness&&it.finishRoughness[channel.key];
      html+='<div class="pr"><label class="pl" for="finish-roughness-'+channel.key+'">'+escHtml(channel.label)+'の艶</label><select id="finish-roughness-'+channel.key+'" class="pi" onchange="updateSelectedModelRoughness(\''+channel.key+'\',this.value)">';
      [['','既定の仕上げ'],['0.85','マット'],['0.48','サテン'],['0.22','艶あり']].forEach(function(option){html+='<option value="'+option[0]+'" '+((current===undefined?'':String(current))===option[0]?'selected':'')+'>'+option[1]+'</option>';});
      html+='</select></div>';
    }
  });
  html+='<button class="pbtn sec" type="button" onclick="updateSelectedProp(\'finishColors\',null)">素材の色を元に戻す</button>';
  return html;
}
function updateSelectedModelFinish(channel,value){
  if(!ST.selected || !/^#[0-9a-f]{6}$/i.test(value||'')) return;
  var model=getItemFinishModel(ST.selected.type);
  if(!model || !(model.finishChannels||[]).some(function(c){return c.key===channel;})) return;
  var colors=Object.assign({},ST.selected.finishColors||{});colors[channel]=value;
  updateSelectedProp('finishColors',colors);
}
function updateSelectedModelRoughness(channel,value){
  if(!ST.selected)return;
  var model=getItemFinishModel(ST.selected.type);
  if(!model || !(model.finishChannels||[]).some(function(c){return c.key===channel&&c.key!=='fabric'&&c.key!=='accent';}))return;
  if(value!=='' && ['0.85','0.48','0.22'].indexOf(String(value))<0)return;
  var settings=Object.assign({},ST.selected.finishRoughness||{});
  if(value==='')delete settings[channel];else settings[channel]=Number(value);
  updateSelectedProp('finishRoughness',Object.keys(settings).length?settings:null);
}
function updateSelectedProp(p,v,noSave){
  if(!ST.selected)return;
  if(isObjectLocked(ST.selected) && p!=='locked'){ updateProps(); return; }
  var keepColorPickerOpen=isAppearanceColorInputActive() && /color/i.test(p);
  if(keepColorPickerOpen) markAppearanceColorDirty();
  else if(!noSave) saveState();
  if(p==='locked'){
    setObjectLocked(ST.selected,!!v);
    syncLockBatchUi();
    draw2d();
    if(ren) rebuild3D();
    updateProps();
    return;
  }
  // 天井を書き換えると、その部屋の天井付けの器具も一緒に動く。
  // 平天井・勾配・吹き抜けの切り替えはすべてここ(p==='ceiling')を通る。
  var ceilBefore=(p==='ceiling')?roomCeilingElevationMm(ST.selected):null;
  if(p==='color') ST.selected.colorCustom=true;
  if(isLightItemType(ST.selected.type) && p==='lightColor'){
    ST.selected.color=v;
    ST.selected.colorCustom=true;
  }
  if(p==='texture'){
    if(ST.selected._texObj) ST.selected._texObj=null;
    if(!v){
      ST.selected.textureFlipX=false;
      ST.selected.textureFlipY=false;
    }
  }
  if(isWindowLikeType(ST.selected.type) && p==='windowTop'){
    ST.selected.windowHeight=Number(v)-windowSillMm(ST.selected);
    normalizeWindowVerticalProps(ST.selected,'windowTop');
    delete ST.selected.windowTop;
  } else {
    ST.selected[p]=v;
    if(isWindowLikeType(ST.selected.type) && (p==='windowSill'||p==='windowHeight')) normalizeWindowVerticalProps(ST.selected,p);
  }
  // 天井を「指定なし」へ戻したときは受け口ごと消す。undefined を残すと保存 JSON
  // には出ないのにメモリ上のプランは「指定あり」に見え、判定が食い違う。
  // 天井を書いたときは旧フィールド(ceilingHeight)も消す: HeightModel が
  // ceiling.heightMm を優先するので、残しても効かない古い値が居座るだけ。
  if(p==='ceiling'){
    if(!v) delete ST.selected.ceiling;
    delete ST.selected.ceilingHeight;
    if(ceilBefore!==null){
      var ceilAfter=roomCeilingElevationMm(ST.selected);
      if(ceilAfter!==null&&ceilAfter!==ceilBefore)
        shiftRoomCeilingFixtures(ST.selected,ceilAfter-ceilBefore);
    }
  }
  // 斜線制限も同じ扱い: 「未設定」へ戻したら受け口ごと消す。undefined を残すと
  // 保存 JSON には出ないのにメモリ上のプランは「設定あり」に見える。
  if(p==='setback' && !v) delete ST.selected.setback;
  // 階段の行き先・置く高さの基準も同じ扱い。既定へ戻したら受け口ごと消す。
  // undefined を残すと保存 JSON には出ないのにメモリ上は「設定あり」に見える。
  if((p==='stairTarget'||p==='baseLevel') && !v) delete ST.selected[p];
  // 天井の仕上げ (Task 22) も同じ扱い。解除したら受け口ごと消す。null を残すと
  // 保存 JSON に "ceilingColor":null が出て、一度も触っていないプランと別物になる。
  if(p==='ceilingColor' && !v) delete ST.selected.ceilingColor;
  if(p==='ceilingTexture' && !v){
    delete ST.selected.ceilingTexture;
    delete ST.selected.ceilingTextureFlipX;
    delete ST.selected.ceilingTextureFlipY;
  }
  if(isWindowLikeType(ST.selected.type) && (p==='w'||p==='windowHeight'||p==='windowSill'||p==='windowTop')) delete ST.selected.windowStd;
  if((p==='exteriorColor'||p==='exteriorTexture') && ST.selected.x1!==undefined){
    var ws=getExteriorWallSetting(ST.selected);
    if(p==='exteriorColor') ws.color=v||null;
    if(p==='exteriorTexture') ws.texture=v||null;
  }
  draw2d();
  if(keepColorPickerOpen){
    scheduleAppearancePreviewUpdate();
    return;
  }
  if(ren) rebuild3D();
  updateProps();
}
var _selectedTextureCropEditing=false;
function updateSelectedTextureCrop(prop,value,input){
  if(!ST.selected) return;
  if(isObjectLocked(ST.selected)){ updateProps(); return; }
  if(!_selectedTextureCropEditing){
    saveState();
    _selectedTextureCropEditing=true;
  }
  ST.selected[prop]=value;
  var row=input&&input.parentElement;
  var valueEl=row&&row.querySelector('.texture-crop-value');
  if(valueEl) valueEl.textContent=prop==='sScale'?value.toFixed(2):Math.round(value);
  draw2d();
  if(ren) rebuild3D();
}
function finishSelectedTextureCrop(){
  if(!_selectedTextureCropEditing) return;
  _selectedTextureCropEditing=false;
  updateProps();
}
function updateSelectedNoteText(v){
  if(!ST.selected || ST.selected.type!=='memo') return;
  if(isObjectLocked(ST.selected)){ updateProps(); return; }
  if(!ST._noteTextEditing){
    saveState();
    ST._noteTextEditing=true;
  }
  ST.selected.noteText=v;
  draw2d();
}
function finishSelectedNoteText(){
  if(!ST._noteTextEditing) return;
  ST._noteTextEditing=false;
  updateProps();
}
function updateWalkRouteSpeed(v){
  if(!ST.selected || ST.selected.type!=='walk-route') return;
  if(isObjectLocked(ST.selected)){ updateProps(); return; }
  var next=Math.max(0.1,Math.min(3,Number(v)||WALK_DEFAULT_SPEED_MPS));
  saveState();
  ST.selected.walkSpeed=next;
  if(WALKTHROUGH && WALKTHROUGH.routeId===ST.selected.id) beginWalkthrough(ST.selected);
  draw2d();
  updateProps();
}
function updateSelectedContextFloors(v){
  if(!ST.selected || (ST.selected.type!=='neighbor-building' && ST.selected.type!=='neighbor-house')) return;
  if(isObjectLocked(ST.selected)){ updateProps(); return; }
  var floors=clampContextFloors(ST.selected.type,v);
  saveState();
  ST.selected.contextFloors=floors;
  ST.selected.contextHeight=contextHeightFromFloors(ST.selected.type,floors);
  draw2d();
  if(ren) rebuild3D();
  updateProps();
}
function updateSelectedLightKind(kind){
  if(!ST.selected || !isLightItemType(ST.selected.type)) return;
  if(isObjectLocked(ST.selected)){ updateProps(); return; }
  kind=LIGHT_KIND_TO_TYPE[kind]?kind:'ceiling';
  saveState();
  ST.selected.type=lightTypeForKind(kind);
  ST.selected.lightKind=kind;
  ensureLightDefaults(ST.selected);
  ST.selected.lightIntensity=kind==='spot'?0.9:(kind==='down'?0.72:0.56);
  ST.selected.lightRange=kind==='spot'?5200:(kind==='down'?4400:5600);
  ST.selected.lightAngle=kind==='spot'?32:64;
  draw2d();
  if(ren) rebuild3D();
  updateProps();
}
function applyOpeningModelToItem(it,modelId){
  if(!it || !isOpeningItemType(it.type)) return;
  delete it.windowStd; // 開口モデル適用で規格プリセット表示が実寸と乖離しないようクリア
  if(!modelId){
    delete it.openingModel;
  } else {
    it.openingModel=modelId;
    var model=getOpeningModelItem(it);
    if(model){
      var oldCx=(it.x||0)+(it.w||0)/2, oldCy=(it.y||0)+(it.d||0)/2;
      if(isWindowLikeType(it.type)){
        it.w=model.w||it.w||900;
        it.d=Math.max(30,model.d||it.d||150);
        it.windowHeight=Math.max(200,Math.min(windowMaxTopMm(it),model.h||windowHeightMm(it)));
        normalizeWindowVerticalProps(it,'windowHeight');
      } else if(isInteriorSwingDoorType(it.type)){
        it.w=model.w||it.w||780;
        it.d=it.w;
        it.doorHeight=Math.max(300,Math.min(3200,model.h||doorHeightMm(it)));
      }
      it.x=oldCx-it.w/2;
      it.y=oldCy-it.d/2;
    }
  }
}
function uploadTex(inp){
  if(ST.selected && isObjectLocked(ST.selected)){ updateProps(); return; }
  var file=inp.files[0]; if(!file)return;
  var r=new FileReader();
  r.onload=function(e){
    prepareUploadedTexture(e.target.result,function(dataUrl){
      updateSelectedProp('texture', dataUrl);
    });
  };
  r.readAsDataURL(file);
}
// 天井テクスチャの読み込み (Task 22)。床の uploadTex と同じ道を通り、
// 書き込み先のフィールド名だけが違う。
function uploadRoomCeilingTex(inp){
  if(ST.selected && isObjectLocked(ST.selected)){ updateProps(); return; }
  var file=inp.files[0]; if(!file)return;
  var r=new FileReader();
  r.onload=function(e){
    prepareUploadedTexture(e.target.result,function(dataUrl){
      updateSelectedProp('ceilingTexture', dataUrl);
    });
  };
  r.readAsDataURL(file);
}
function prepareUploadedTexture(src,done){
  var img=new Image();
  img.onload=function(){
    var maxSize=1024;
    var scale=Math.min(1,maxSize/img.width,maxSize/img.height);
    var w=Math.max(1,Math.round(img.width*scale));
    var h=Math.max(1,Math.round(img.height*scale));
    var c=document.createElement('canvas');
    c.width=w; c.height=h;
    var g=c.getContext('2d');
    g.fillStyle='#ffffff'; g.fillRect(0,0,w,h);
    g.drawImage(img,0,0,w,h);
    done(c.toDataURL('image/jpeg',0.86));
  };
  img.onerror=function(){done(src);};
  img.src=src;
}

// DRAG state for handle transform
var DRAG = {active:false, saved:false, handle:null, startCX:0, startCY:0, origItem:null,shiftClick:null};

function explicit2DSelection(){
  var out=[];
  (ST.multiSelected||[]).concat(ST.selected?[ST.selected]:[]).forEach(function(obj){
    if(obj && out.indexOf(obj)<0) out.push(obj);
  });
  return out;
}
function clearMultiSelection(){ ST.multiSelected=[]; DRAG.shiftClick=null; DRAG.group=null; DRAG.marquee=null; }
function beginShiftClickCandidate(picked){
  DRAG.shiftClick={picked:picked,previous:explicit2DSelection()};
}
function finishShiftClickCandidate(){
  var c=DRAG.shiftClick;
  DRAG.shiftClick=null;
  if(!c||!c.picked) return false;
  var list=c.previous.slice(), idx=list.indexOf(c.picked);
  if(idx>=0) list.splice(idx,1); else list.push(c.picked);
  ST.selected=list.length?list[list.length-1]:null;
  ST.multiSelected=list.slice(0,-1);
  updateProps(); draw2d();
  return true;
}
var NATURAL_PAN = true;
var CANVAS_TOUCH_FOLLOWS_FINGER = true;
var CANVAS_TRACKPAD_USES_NATIVE_SCROLL = true;

var DATA = {walls:[], items:[], rooms:[], floorMetadata:{}, exteriorWallSettings:null, interiorWallSettings:null, roofAppearance:null};
var nextId = 1;

// ══ 敷地の方位（真北） ═══════════════════════════════════════════════
//
// **真実源は DATA.northDeg**。方位は照明の都合ではなく設計に属する情報なので、
// プランが持ち、保存・共同編集・ファイル取り込みのすべての経路で往復する。
// `LIGHT_SETTINGS.northDeg` は互換のために残した **写し** であって真実源ではない。
// 写しを更新してよいのは syncNorthFromPlan() ただ1つで、そこ以外から
// LIGHT_SETTINGS.northDeg へ代入すると、次にプランが届いた瞬間に黙って捨てられる。
// 方位を変える入口は setPlanNorthDeg() ただ1つ。
//
// **方位を持たないプラン（＝これまでに保存された全プラン）は 0 度**。
// 0 度のときは値が無いときとまったく同じ結果になるので、既存プランの
// レンダ・立面図・呼称・書き出し名は1バイトも変わらない。
// 読み込み時に DATA.northDeg を 0 で埋めることはしない（保存内容を勝手に太らせ、
// 共同編集の差分にも出てしまうため）。
//
// 角度の意味は computeSunPosition から読んだものと同じ:
//   真北の平面ベクトル = (sin θ, -cos θ)。θ=0 で (0,-1) = 平面図の上。
//   θ が増えると、平面図の上から見て北の矢印は時計回りに回る。
function normalizeNorthDeg(v){
  var n=Number(v);
  if(!isFinite(n)) return 0;
  return ((n%360)+360)%360;
}
function planNorthDeg(){
  if(typeof DATA==='undefined' || !DATA) return 0;
  if(DATA.northDeg===undefined || DATA.northDeg===null) return 0;
  return normalizeNorthDeg(DATA.northDeg);
}
// プラン側の値を照明設定の写しへ流す。プランが届くすべての経路から呼ぶ
// （保存プランの復元・共同編集の参加/パッチ・ファイル取り込み・取り消し/やり直し・
//   デフォルトプラン）。呼び忘れると太陽だけが前のプランの方位を向く。
function syncNorthFromPlan(){
  var deg=planNorthDeg();
  if(typeof LIGHT_SETTINGS!=='undefined' && LIGHT_SETTINGS) LIGHT_SETTINGS.northDeg=deg;
  if(typeof syncNorthUi==='function') syncNorthUi();
  return deg;
}
// 方位を変えるただ1つの入口。写しもここで揃える。
function setPlanNorthDeg(v){
  var deg=normalizeNorthDeg(v);
  if(typeof DATA!=='undefined' && DATA) DATA.northDeg=deg;
  return syncNorthFromPlan();
}

// ── 8方位の呼称 ──────────────────────────────────────────────────────
// 真北±22.5度が「北」、その外は「北東」…。境界（22.5度ちょうど）は次の方位へ倒す。
var COMPASS_8_JA=['北','北東','東','南東','南','南西','西','北西'];
var COMPASS_8_CODE=['n','ne','e','se','s','sw','w','nw'];
function compassSector(bearingDeg){
  return Math.round(normalizeNorthDeg(bearingDeg)/45)%8;
}
function compassNameJa(bearingDeg){ return COMPASS_8_JA[compassSector(bearingDeg)]; }
function compassCode(bearingDeg){ return COMPASS_8_CODE[compassSector(bearingDeg)]; }

// 図面の軸が実際に向いている方位（度）。
// 立面図の軸（ELEV_AXES）と外観3Dのスナップは **建物に正対したまま** 動かさない。
// 動かすのは呼称だけである（振れた敷地で真北投影にすると、何も平行でなく
// 寸法の読めない図面になる。実務どおり「図面は建物に正対して描き、方位を添える」）。
//
// 平面図の向き d の画面角 φ（上=0、時計回りに増える）は n:0 / e:90 / s:180 / w:270。
// 真北の画面角は方位 θ そのものなので、d が指す実際の方位 = φ − θ。
// θ=0 では n→0°(北)・e→90°(東)・s→180°(南)・w→270°(西) と、これまでの呼称に一致する。
var ELEV_DIR_SCREEN_DEG={n:0,e:90,s:180,w:270};
function planDirBearingDeg(dir){
  var base=ELEV_DIR_SCREEN_DEG[dir];
  if(base===undefined) return 0;
  return normalizeNorthDeg(base-planNorthDeg());
}
function elevationDirNameJa(dir){ return compassNameJa(planDirBearingDeg(dir)); }
function elevationSheetLabel(dir){ return elevationDirNameJa(dir)+'立面図'; }
// 書き出しファイル名の方角コード。方位0度では 'n'/'e'/'s'/'w' のままである。
function elevationDirCode(dir){ return compassCode(planDirBearingDeg(dir)); }

// 方位が変わったら画面の呼称も追う（方位スライダの数値と、外観3Dの方向スナップボタン）。
// ボタンの並び順・押したときのカメラ位置は変えない。変えるのは文字だけ。
function syncNorthUi(){
  if(typeof document==='undefined' || !document.getElementById) return;
  var deg=planNorthDeg();
  var northInput=document.getElementById('sun-north');
  var northVal=document.getElementById('sun-north-val');
  if(northInput) northInput.value=deg;
  if(northVal) northVal.textContent=deg+'°';
  var fab=document.getElementById('elev-snap-fab');
  if(fab){
    var btns=fab.querySelectorAll('button[data-elev-dir]');
    Array.prototype.forEach.call(btns,function(b){
      var d=b.getAttribute('data-elev-dir');
      b.textContent=elevationDirNameJa(d);
      b.title=elevationSheetLabel(d).replace('立面図','立面')+'から見る';
    });
  }
  // JIS図面ダイアログを開いたまま方位を回したら、シート名と方位記号を作り直す。
  // 開いていなければ何もしない（次に開いたときに新しい呼称で作られる）。
  var ov=document.getElementById('jis-drawing-overlay');
  if(ov && ov.style.display==='flex' && typeof openJisDrawingDialog==='function') openJisDrawingDialog();
}
var HISTORY = [];
var REDO_HISTORY = [];
var HISTORY_LIMIT = 50;
var DIRTY = false;
// Plans embed base64 textures (multiple MB), which overflow localStorage's
// ~5MB quota on mobile Safari (counted as UTF-16). IndexedDB has a far larger
// quota and is built for blob-sized data. All methods are async (Promise-based).
var StorageAdapter = (function(){
  var DB_NAME='webcad', STORE='plans', VERSION=1, KEY='webcad-plan-v1';
  var LEGACY_LS_KEY='webcad-plan-v1';
  function serialize(data){ return JSON.stringify(data, function(k,v){return k==='_texObj'?undefined:v;}); }
  function legacyGet(){ try{ var s=localStorage.getItem(LEGACY_LS_KEY); return s?JSON.parse(s):null; }catch(e){ return null; } }
  function openDB(){
    return new Promise(function(resolve,reject){
      var req=indexedDB.open(DB_NAME,VERSION);
      req.onupgradeneeded=function(){ var db=req.result; if(!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE); };
      req.onsuccess=function(){ resolve(req.result); };
      req.onerror=function(){ reject(req.error); };
    });
  }
  function store(db,mode){ return db.transaction(STORE,mode).objectStore(STORE); }
  return {
    save: function(data){
      var json=serialize(data);
      return openDB().then(function(db){
        return new Promise(function(resolve,reject){
          var r=store(db,'readwrite').put(json,KEY);
          r.onsuccess=function(){ try{ localStorage.removeItem(LEGACY_LS_KEY); }catch(e){} resolve(true); };
          r.onerror=function(){ reject(r.error); };
        });
      });
    },
    load: function(){
      return openDB().then(function(db){
        return new Promise(function(resolve){
          var r=store(db,'readonly').get(KEY);
          r.onsuccess=function(){
            if(r.result){ try{ resolve(JSON.parse(r.result)); }catch(e){ resolve(null); } return; }
            resolve(legacyGet());
          };
          r.onerror=function(){ resolve(legacyGet()); };
        });
      }).catch(function(){ return legacyGet(); });
    },
    hasData: function(){
      return openDB().then(function(db){
        return new Promise(function(resolve){
          var r=store(db,'readonly').getKey(KEY);
          r.onsuccess=function(){
            if(r.result!==undefined && r.result!==null){ resolve(true); return; }
            resolve(!!legacyGet());
          };
          r.onerror=function(){ resolve(!!legacyGet()); };
        });
      }).catch(function(){ return !!legacyGet(); });
    }
  };
})();
function markDirty(){
  DIRTY=true;
  var btn=document.getElementById('save-btn');
  if(btn) btn.classList.add('dirty');
  renderSaveButtonState();
  queueSharedSync(700);
  queueSharedLocalAutoSave();
}
function clearDirty(){
  DIRTY=false;
  var btn=document.getElementById('save-btn');
  if(btn) btn.classList.remove('dirty');
  renderSaveButtonState();
}
var CLIPBOARD = null;
function serializeDataSnapshot(){
  return JSON.stringify(DATA,function(k,v){return k==='_texObj'?undefined:v;});
}
function pushHistorySnapshot(stack,s){
  stack.push(s);
  if(stack.length>HISTORY_LIMIT) stack.shift();
}
function clearEditHistory(){
  HISTORY.length=0;
  REDO_HISTORY.length=0;
}
function saveState(){
  sharedRememberEditTargets();
  pushHistorySnapshot(HISTORY,serializeDataSnapshot());
  REDO_HISTORY.length=0;
  markDirty();
}

function ensureObjectIds(){
  var maxId=0;
  function scanId(v){
    if(v===undefined||v===null) return;
    var m=String(v).match(/(\d+)$/);
    if(m) maxId=Math.max(maxId,+m[1]);
  }
  DATA.walls.forEach(function(w){ scanId(w.id); });
  DATA.items.forEach(function(i){ scanId(i.id); });
  DATA.rooms.forEach(function(r){ scanId(r.id); });
  if(nextId<=maxId) nextId=maxId+1;
  DATA.walls.forEach(function(w){ if(w.id===undefined||w.id===null) w.id=nextId++; });
  DATA.items.forEach(function(i){ if(i.id===undefined||i.id===null) i.id=nextId++; });
  DATA.rooms.forEach(function(r){ if(!r.id) r.id='rm'+(nextId++); });
}

function objectIdLabel(o){
  if(!o || o.id===undefined || o.id===null) return '';
  if(o.x1!==undefined && o.x2!==undefined) return 'W'+o.id;
  if(o.type==='room') return 'R'+String(o.id).replace(/^rm/,'');
  return 'I'+o.id;
}

var SITE_SURFACE_OPTIONS = {
  sand:{label:'砂地（締め固め）',texture:'sand',tileM:1.5,normal:0.35,color:0xffffff,edge:0xaca080,segment:0xd8bb80,env:0.03},
  grass:{label:'芝生（自然草地）',texture:'grass',tileM:2,normal:0.55,color:0xffffff,edge:0x3f6f35,segment:0x43b047,env:0.04},
  gravel:{label:'砂利',texture:'gravel',tileM:2.25,normal:0.65,color:0xffffff,edge:0x8c8372,segment:0x9c8f78,env:0.05},
  concrete:{label:'コンクリート（経年）',texture:'concrete',tileM:2.08,normal:0.25,color:0xffffff,edge:0x8f9396,segment:0xbfc3c7,env:0.06}
};
function siteSurfaceType(it){
  return (it&&SITE_SURFACE_OPTIONS[it.siteSurface]) ? it.siteSurface : 'grass';
}
function siteSurfaceLabel(type){
  var opt=SITE_SURFACE_OPTIONS[type]||SITE_SURFACE_OPTIONS.grass;
  return opt.label;
}
function siteSurfaceSegmentColor(it){
  var opt=SITE_SURFACE_OPTIONS[siteSurfaceType(it)]||SITE_SURFACE_OPTIONS.grass;
  return opt.segment;
}
function siteSurfaceOptionsHtml(value){
  var cur=SITE_SURFACE_OPTIONS[value]?value:'grass';
  return Object.keys(SITE_SURFACE_OPTIONS).map(function(key){
    var opt=SITE_SURFACE_OPTIONS[key];
    return '<option value="'+key+'" '+(cur===key?'selected':'')+'>'+opt.label+'</option>';
  }).join('');
}
