// 間取りデータの下ごしらえ、はじめに出すプリセット、2D用スプライトの先読み。
//
// index.html のインライン script から、中身を1文字も変えずに切り出した。
// 末尾でスプライト画像の読み込みを始める。onload は必ず非同期に呼ばれるので、
// そこから draw2d() を呼んでも、残りのファイルは読み終わっている。
// ───── DATA HELPERS ─────
var FLOOR_USE_DEFINITIONS={
  residential:{label:'居住階',occupiable:true},
  loft:{label:'ロフト・中間階',occupiable:true},
  roof:{label:'屋根階',occupiable:false},
  mechanical:{label:'設備階',occupiable:false},
  outdoor:{label:'屋上・外部床',occupiable:false}
};
function ensureFloorMetadata(plan){
  plan=plan||DATA;
  if(!plan.floorMetadata || typeof plan.floorMetadata!=='object' || Array.isArray(plan.floorMetadata)) plan.floorMetadata={};
  return plan.floorMetadata;
}
function explicitFloorMetadata(plan,floor){
  var metadata=plan&&plan.floorMetadata;
  if(!metadata || typeof metadata!=='object') return null;
  var value=metadata[String(floor)];
  return value&&typeof value==='object'&&!Array.isArray(value)?value:null;
}
// 階の用途 (floorMetadata) は保存された JSON が持つ設定として読むだけにした。
// 以前は画像AIレンダーのダイアログに選択欄を出していたが、この設定が効くのは
// AIへ渡す説明文の "Building occupiable floors" の1行だけで、建物にも図面にも
// 斜線制限にも影響しない。レンダー設定に混ざっていると、間取りの設定を
// そこで変えているように読めてしまう。
// wallHeight は新規の壁に入れる既定値(階ごと設定があればその階の値)。部屋の天井高ではないので置き換えない。
function mkWall(x1,y1,x2,y2,floor,thick,color){
  return {id:nextId++,x1:x1,y1:y1,x2:x2,y2:y2,floor:floor||1,
    thick:thick||120,color:color||'#888888',texture:null,textureFlipX:false,textureFlipY:false,texScale:1,_texObj:null,
    wallBand:'full',wallStyle:'solid',wallHeight:defaultWallHeightMmForFloor(floor||1),wallTopShape:'flat',wallTopSide:'both'};
}
function mkItem(type,x,y,rot,floor,w,d){
  type=bestFmpType(type);
  var sz=getItemDefaultSize(type);
  var item = {id:nextId++,type:type,x:x,y:y,rot:rot||0,floor:floor||1,modelFacingVersion:1,
    w:w||sz.w,d:d||sz.d,color:ICOLORS[type]||'#ddd',
    flipX:false, flipY:false, textureFlipX:false, textureFlipY:false, sScale:1, sX:0, sY:0};
  if(type==='neighbor-house') item.neighborFacingVersion=1;
  if(type==='wood-fence'){
    item.fenceHeight=1600;
    item.fencePattern='horizontal';
    item.fenceTopStyle='even';
  }
  if(type==='lattice-screen'){
    item.latticeHeight=1600;
    item.fencePattern='vertical';
    item.fenceTopStyle='even';
  }
  if(type==='foundation'){
    item.foundationHeight=450;
  }
  if(type==='shelf-built-in'){
    item.shelfCount=3;
    item.shelfHeight=900;
  }
  if(type==='exterior-stair'){
    item.targetHeight=foundationHeightMm()||450;
    item.accessSteps=3;
  }
  if(type==='ramp'){
    item.targetHeight=foundationHeightMm()||450;
  }
  if(type==='site-rect'){
    item.siteSurface='grass';
  }
  if(type==='custom-block'){
    item.customHeight=900;
    item.name='任意ブロック';
    item.colorCustom=true;
  }
  if(isLightItemType(type)){
    ensureLightDefaults(item);
    item.colorCustom=true;
  }
  if(type==='memo'){
    item.noteText='メモ';
    item.color='#fff3a6';
    item.colorCustom=true;
  }
  if(type==='ruler'){
    item.d=RULER_THICKNESS_MM;
    item.color='#2f80ed';
    item.colorCustom=true;
  }
  if(type==='walk-route'){
    item.d=WALK_ROUTE_THICKNESS_MM;
    item.walkSpeed=WALK_DEFAULT_SPEED_MPS;
    item.color='#10b981';
    item.colorCustom=true;
  }
  if(isContextExteriorItemType(type)){
    item.contextHeight=defaultContextExteriorHeight(type);
    if(type==='neighbor-building' || type==='neighbor-house') item.contextFloors=defaultContextFloors(type);
  }
  if(isWindowLikeType(type)){
    item.windowSill=type==='window-door'?0:900;
    item.windowHeight=type==='window-door'?2100:1200;
  }
  if(isDoorLikeOpeningType(type)){
    item.doorHeight=type==='door-front'?2330:2000;
    if(isDoorPanelType(type)) item.doorOpenState='open';
  }
  if(canSetItemElevation(item)) item.elev=(type==='meter-box')?1600:(type==='fmp-AirConditionerWall01'?2000:0);
  if(isFmpItemType(type)){
    item.fmpId=type;
    if(getFmpItem(type).defaultElevation) item.elev=getFmpItem(type).defaultElevation;
    item.color=null;
    item.colorCustom=false;
  }
  if(type==='roof'){
    item.roofType='gable';
    item.pitch=30;
    item.color='#2a2a30';
    item.roofThickness=180;
    item.roofSkirt=0;
    item.roofEdgeColor='#3a2f2a';
  }
  return item;
}

// ───── PRESET DATA ─────
var _defaultPlanPending=true; // 保存プラン復元やインポートが先に走ったらデフォルト適用を中止
// 既定間取りの台帳。既定間取りは商品なので今後も増える。
// テストはここを読まない(tools/tests/fixtures/ の凍結間取りを読む)。
var PRESET_PLANS={
  '2f': {file:'assets/default_plan.json',thumbnail:'assets/presets/2f-exterior.jpg',
         name:'2階建て 3LDK・吹き抜けとテラス',
         desc:'13.2㎡の吹き抜けと、目隠しで囲まれたテラス。内と外でくつろげる家'},
  '3f': {file:'assets/default_plan_3f.json',thumbnail:'assets/presets/3f-exterior.jpg',
         name:'3階建て 3LDK・大吹き抜け',
         desc:'全幅5.46m、14.9㎡の吹き抜け。二方向の高窓と、家具を絞った開放的なLDK'}
};
var PRESET_CURRENT='2f';
var _presetLoadRevision=0;
// 起動時の間取り選択。既定間取りが使われる起動(=保存の復元も共同編集も
// 無かった)にだけ出す。編集が始まったあとに読み替えると作業を消すので、
// _defaultPlanPending が立っている間しか出さない。
function maybeOfferPresetChoice(){
  if(!_defaultPlanPending) return;
  // URL に ?preset=2f / ?preset=3f があれば、ダイアログを出さずにその間取りで
  // 開く。共有リンクと、画面を自動で操作する検査(ダイアログが覆っていると
  // 下のカタログをクリックできない)のため
  var want=null;
  try{ want=new URLSearchParams(window.location.search).get('preset'); }catch(e){}
  if(want==='blank'){chooseBlankPlan();return;}
  if(want && PRESET_PLANS[want]){ choosePresetPlan(want); return; }
  var grid=document.getElementById('preset-choice-grid');
  var modal=document.getElementById('preset-choice-modal');
  if(!grid||!modal) return;
  var html='';
  Object.keys(PRESET_PLANS).forEach(function(key){
    var p=PRESET_PLANS[key];
    html+='<button type="button" class="preset-choice-btn" onclick="choosePresetPlan(\''+key+'\')">'
        +'<img class="preset-choice-image" src="'+p.thumbnail+'" alt="'+(key==='2f'?'2階建て：広いテラスと目隠しのある外観':'3階建て：縦に伸びるコンパクトな外観')+'" width="960" height="640">'
        +'<div class="preset-choice-copy"><div class="preset-choice-name">'+p.name+'</div>'
        +'<div class="preset-choice-desc">'+p.desc+'</div></div></button>';
  });
  grid.innerHTML=html;
  modal.classList.add('show');
}
function closePresetChoice(){
  var modal=document.getElementById('preset-choice-modal');
  if(modal) modal.classList.remove('show');
}
function choosePresetPlan(key){
  closePresetChoice();
  if(!_defaultPlanPending) return;          // 選択待ちの間に別のプランが開かれた
  if(!PRESET_PLANS[key])return;
  loadPreset(0,key);
}
function chooseBlankPlan(){
  if(!_defaultPlanPending)return;
  closePresetChoice();
  _defaultPlanPending=false;_presetLoadRevision++;
  DATA={walls:[],items:[],rooms:[],floors:{},heightDefaults:{},floorMetadata:{},exteriorWallSettings:null,interiorWallSettings:null,roofAppearance:null,startMode:'blank'};
  PRESET_CURRENT='blank';nextId=1;ST.selected=null;ST.floor=1;
  document.getElementById('floor-sel').value='1';
  document.getElementById('props').classList.remove('show');
  syncNorthFromPlan();ensureFloorMetadata();ensureHeightDefaults();syncHeightDefaultsUI();clearEditHistory();
  setTool('select');setView('2d');resetView();markDirty();
  if(ren)rebuild3D();
}
function loadPreset(attempt,variant){
  var revision=++_presetLoadRevision;
  attempt=attempt||0;
  variant=variant||'2f';
  var preset=PRESET_PLANS[variant]||PRESET_PLANS['2f'];
  fetch(preset.file).then(function(r){
    if(!r.ok) throw new Error('HTTP '+r.status);
    return r.json();
  }).then(function(plan){
    if(!_defaultPlanPending || revision!==_presetLoadRevision) return; // Ignore restored plans and stale requests.
    DATA.walls=plan.walls||[];
    DATA.rooms=plan.rooms||[];
    DATA.items=plan.items||[];
    DATA.floorMetadata=plan.floorMetadata||{};
    DATA.exteriorWallSettings=plan.exteriorWallSettings||null;
    DATA.interiorWallSettings=plan.interiorWallSettings||null;
    DATA.roofAppearance=plan.roofAppearance||null;
    DATA.floors=plan.floors||{};
    DATA.heightDefaults=plan.heightDefaults||{};
    // 方位を持たないプランは 0 度。持っていないものを 0 で埋めない（保存内容が太る）。
    DATA.northDeg=plan.northDeg;
    syncNorthFromPlan();
    ensureFloorMetadata();
    ensureHeightDefaults();
    syncHeightDefaultsUI();
    if(plan.exteriorDetail) DATA.exteriorDetail=plan.exteriorDetail;
    var maxId=0;
    DATA.items.concat(DATA.walls).forEach(function(o){var n=Number(o.id);if(isFinite(n)&&n>maxId)maxId=n;});
    nextId=Math.max(nextId||1,Math.floor(maxId)+1);
    PRESET_CURRENT=variant;
    clearEditHistory();
    normalizeLegacyFurnitureItems();
    // 既定間取りが視点(viewState)を持っていればそれを復元する(見せたい構図で
    // 開くため)。持っていなければ main と同じく間取り全体に合わせて開く
    if(typeof restoreViewState==='function'&&DATA.viewState){ restoreViewState(); draw2d(); }
    else resetView();
    if(ren) rebuild3D();
  }).catch(function(e){
    if(!_defaultPlanPending || revision!==_presetLoadRevision) return;
    console.warn('[WebCAD] default plan load failed:', e);
    // 低速回線等での取得失敗時は数回リトライし、それでも空なら画面に通知する
    if(attempt<3){ setTimeout(function(){ if(_defaultPlanPending && revision===_presetLoadRevision) loadPreset(attempt+1,variant); }, 2000*(attempt+1)); return; }
    if(!DATA.walls.length && !DATA.items.length){
      alert('デフォルトプランの読み込みに失敗しました。\n通信環境を確認してページを再読み込みしてください。');
    }
  });
}

// ───── SPRITE PRELOADER ─────
var SPRITE_IMG1 = new Image(), SPRITE_IMG2 = new Image();
var SPRITE_JSON = {
  cell: 512,
  sprites: {
    // Sheet 1 (with tight crop: cx,cy = offset within tile, cw,ch = content size)
    toilet:    {x:0,    y:0,    img:1, cx:148, cy:54,  cw:207, ch:397},
    bed:       {x:512,  y:0,    img:1, cx:153, cy:49,  cw:200, ch:407},
    sink:      {x:1024, y:0,    img:1, cx:48,  cy:107, cw:414, ch:289},
    tv:        {x:1536, y:0,    img:1, cx:51,  cy:162, cw:404, ch:177},
    bathtub:   {x:2048, y:0,    img:1, cx:86,  cy:54,  cw:339, ch:396},
    car:       {x:0,    y:512,  img:1, cx:152, cy:47,  cw:202, ch:412},
    sofa:      {x:512,  y:512,  img:1, cx:31,  cy:136, cw:446, ch:232},
    kitchen:   {x:1024, y:512,  img:1, cx:41,  cy:152, cw:429, ch:201},
    fridge:    {x:1536, y:512,  img:1, cx:38,  cy:111, cw:436, ch:289},
    dining:    {x:2048, y:512,  img:1, cx:67,  cy:55,  cw:369, ch:392},
    wood_floor:{x:0,    y:1024, img:1, cx:67,  cy:55,  cw:387, ch:394},
    stone:     {x:512,  y:1024, img:1, cx:62,  cy:55,  cw:386, ch:394},
    tree:      {x:1024, y:1024, img:1, cx:65,  cy:55,  cw:382, ch:403},
    tile_floor:{x:1536, y:1024, img:1, cx:64,  cy:55,  cw:381, ch:394},
    grass:     {x:2048, y:1024, img:1, cx:61,  cy:55,  cw:386, ch:394},
    // Sheet 2
    loveseat_2p:   {x:0,    y:0,    img:2, cx:53,  cy:184, cw:410, ch:253},
    low_table:     {x:512,  y:0,    img:2, cx:59,  cy:130, cw:384, ch:258},
    armchair_1p:   {x:1024, y:0,    img:2, cx:80,  cy:69,  cw:367, ch:378},
    dining_6:      {x:1536, y:0,    img:2, cx:53,  cy:140, cw:394, ch:314},
    round_table_4: {x:2048, y:0,    img:2, cx:59,  cy:59,  cw:392, ch:390},
    desk:          {x:0,    y:512,  img:2, cx:92,  cy:145, cw:337, ch:219},
    closet_pole:   {x:512,  y:512,  img:2, cx:50,  cy:136, cw:413, ch:241},
    double_bed_alt:{x:1024, y:512,  img:2, cx:85,  cy:64,  cw:312, ch:397},
    semi_double_bed:{x:1536,y:512,  img:2, cx:117, cy:69,  cw:195, ch:378},
    shoe_cabinet:  {x:2048, y:512,  img:2, cx:68,  cy:162, cw:377, ch:189},
    washer:        {x:0,    y:1024, img:2, cx:104, cy:86,  cw:305, ch:341},
    desk_chair:    {x:512,  y:1024, img:2, cx:155, cy:56,  cw:268, ch:313},
    chest_drawers: {x:1024, y:1024, img:2, cx:70,  cy:146, cw:373, ch:221},
    futon_set:     {x:1536, y:1024, img:2, cx:101, cy:57,  cw:257, ch:406},
    storage_boxes: {x:2048, y:1024, img:2, cx:80,  cy:120, cw:353, ch:277}
  }
};
var SPRITE_MAP = {
  toilet:'toilet', 'bed-d':'bed', 'bed-s':'bed', sink:'sink', tv:'tv', bath:'bathtub',
  sofa:'sofa', kitchen:'kitchen', fridge:'fridge', 'dining-table':'dining', tree:'tree', car:'car',
  loveseat_2p:'loveseat_2p', low_table:'low_table', dining_6:'dining_6', round_table_4:'round_table_4',
  desk:'desk', semi_double_bed:'semi_double_bed', futon_set:'futon_set', shoe_cabinet:'shoe_cabinet', washer:'washer'
};
var PATTERNS = {};
var loadedCount = 0;
function onSheetLoad() {
  loadedCount++;
  if(loadedCount < 2) return;
  function extPat(key) {
    var s = SPRITE_JSON.sprites[key]; if(!s) return;
    var img = s.img === 1 ? SPRITE_IMG1 : SPRITE_IMG2;
    var c = document.createElement('canvas'); c.width=512; c.height=512;
    c.getContext('2d').drawImage(img, s.x, s.y, 512, 512, 0, 0, 512, 512);
    PATTERNS[key] = c;
  }
  extPat('wood_floor'); extPat('grass'); extPat('stone'); extPat('tile_floor');
  PATTERNS['wood_oak']=PATTERNS['wood_floor'];   // 2Dのハッチは木目の総称
  draw2d();
}
if(window.location.protocol!=='file:'){
  SPRITE_IMG1.crossOrigin = "anonymous";
  SPRITE_IMG2.crossOrigin = "anonymous";
}
SPRITE_IMG1.onload = onSheetLoad;
SPRITE_IMG2.onload = onSheetLoad;
// 読み込みの開始は、残りの <script> が出そろってから (DOMContentLoaded)。
//
// onSheetLoad は draw2d() を呼び、draw2d は本体側の関数(drawDim など)を使う。
// インライン script 1枚だった頃は、そこに到達する時点で全部の関数が
// そろっていた。外部ファイルに分けると script と script の合間にも
// イベントが走れるので、画像がブラウザのキャッシュに載っている再読み込みの
// ときだけ、本体より先に draw2d() が動いて
// 「drawDim is not defined」で落ちていた。
function startSpriteSheetLoad(){
  SPRITE_IMG1.src = 'assets/japanese_floorplan_parts_sprite_gpt.png';
  SPRITE_IMG2.src = 'assets/japanese_floorplan_parts_sprite_gpt_2.png';
}
if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startSpriteSheetLoad);
else startSpriteSheetLoad();
