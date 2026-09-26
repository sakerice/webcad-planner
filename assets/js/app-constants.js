// 寸法・色・部材の種類といった、アプリ全体で共有する定数と、その読み書き。
//
// index.html のインライン script から、中身を1文字も変えずに切り出した。
// 読み込み順の都合でここが最初に走る。**このファイルのトップレベルで、
// 後から読まれるファイルの関数を呼んではいけない**(まだ存在しない)。
// 関数の中から呼ぶぶんには、実行時には全部そろっているので問題ない。
// ───── CONSTANTS ─────
var WALL_H = 2400;
// 壁の高さの既定。プランが壁の高さを持っていないときに戻す先で、WALL_H の初期値と
// 同じ値。ずれていないことは tools/tests/height-defaults.test.cjs が見ている。
var DEFAULT_WALL_H_MM = 2400;
var FLOOR_H = 2700;
var FLOOR_SLAB_H = 180;
var U = 0.001;
var WALL_COLORS = { 1:'#5c3820', 2:'#e8e0cc', 3:'#e8e0cc', 4:'#e8e0cc' };
var WALL_COLOR_CUSTOM = {};
// 光の配分。**白いベース光(ambient)を薄く、空からの光(env)と太陽を厚く**。
// 以前は ambient/hemi の白い全方向光が主で、env は 0.42 に抑えられていた。
// 白い光をどの面にも同じだけ足すと、面の向きの差＝陰影が消え、素材の色も
// 白に寄る。実測(既定間取り・内観3D): 平均輝度 138.5 / コントラスト 40.7 /
// 彩度 0.155 という、明るくもないのに色も形も出ていない絵になっていた。
// 太陽と空を主役に組み直して 165.4 / 42.1 / 0.231。
// 露出は「上げても白飛びしない上限の手前」で決めた。実測では 1.06/1.12/1.18/1.25
// のいずれも最大チャンネル252以上の画素は 0.00% で、1.18 までは明るさと
// コントラストが素直に増える(外観 平均 145.2→153.4)。
var LIGHT_SETTINGS = {timeOfDay:'day',hemi:0.40, sun:1.10, ambient:0.10, room:0.22, exposure:1.18, env:0.62,
  sunSim:true, hour:13, season:'equinox', northDeg:0};
// PVキャプチャ(?pvCapture=1)専用の内観採光スイッチ。既定は null。
// null のあいだ内観3Dはこれまでどおり「天井を作らない・太陽は消灯」で、
// 通常の利用者から見た挙動は一切変わらない。値を入れるのはファイル末尾の
// PVフック(__PV_CAPTURE__.setInteriorDaylight)だけ。形は {sunScale:<倍率>}。
var PV_INTERIOR_DAYLIGHT=null;
// 内観3Dで太陽をどれだけ弱めるか。天井を作らない見せ方なので直射がそのまま
// 入る。1.0(屋外と同じ)だと床が飛び、0 だと陰影が消える。実測で 0.55 が、
// 家具の影が出て床が飛ばない範囲の中央あたりだった。
var INTERIOR_SUN_SCALE = 0.55;
// 仕上げ(グレーディング)。**明るさは動かさず、コントラストと発色だけを上げる**。
// ポストの最後で、sRGB に載った画面全体に1回だけ掛ける(index.html の GRADE_SHADER)。
//
// 露出を上げても絵は良くならないことを実測している: 1.18→2.3 で平均は 154.9→183.4 に
// 上がる一方、明るい側はほとんど動かず(上位1%が 196→214)、中央値だけが 172→208 へ
// 詰まっていく。明るくなるのではなく、全部が同じ明るさへ寄って眠くなる。
// 彩度も 0.339→0.289 へ落ちる。だから明るさではなく、階調の傾きと彩度を触る。
//
// **傾けたら、その分だけ明るさを戻すこと(GRADE_LIFT)。** これを忘れると逆効果になる。
// この絵は中央値が中間グレーより上にある(高輝度寄りの)絵なので、中間を支点に
// 傾けると画素の大半が上へ動き、sRGB の詰まった側に集まって、かえって平坦になる。
// 実測(補正なし・傾き1.12): ばらつき 45.5→38.2、彩度 0.339→0.286 と両方悪化した。
//
// 値は「平均輝度を据え置いたまま」実測で選んだ(既定間取り・外観3D)。上限は
// **青空の青チャンネルが振り切れる手前**に置いてある。振り切れると空がべたっとした
// 一色になり、写真として最初に安っぽく見えるのがそこだから。
//   S1.08 C1.06 B0.99 → ばらつき 46.3 / 彩度 0.393 / 青の飽和 0.00%  ← これ
//   S1.08 C1.10 B0.984 → ばらつき 47.7 / 彩度 0.404 / 青の飽和 0.56%
//   S1.08 C1.14 B0.978 → ばらつき 48.9 / 彩度 0.412 / 青の飽和 0.87%
// もう一段強くしたいときは C を 1.10 まで。空が持たなくなるのはその先。
var GRADE_SATURATION = 1.18;
var GRADE_CONTRAST = 1.10;
var GRADE_LIFT = 1.05;
// ホワイトバランス。**上を向いた面は半球光の「空」側と空からの間接光しか
// 受けない**ので、地面・床・天板・屋根がまとめて青くかぶる。実測(既定間取り・
// 外観3D)では、本来暖色グレー(#d7d5ce)の地面が rgb(143,153,205)=青が赤より +62。
// 元のコードでも +47 あり、青かぶりは今回入れたものではなく元からの性質である。
//
// 直し方は「青だけを下げる」。R と G を違う倍率で上げるとマゼンタへ転ぶ
// (実測: R+20% G+9% で地面が rgb(161,155,155) のピンクになった)。
// 逆に青を下げすぎると空まで死ぬ(B-22% で空が rgb(109,152,173) の水色になり、
// 絵全体がセピアに寄った)。地面の青かぶりを 47→33 に収め、空は
// rgb(109,161,223) の青を保つ位置がここ。
var GRADE_BALANCE = [1.00, 1.00, 1.00];
// 空を「間接光として使うとき」だけ落とす彩度。見える空の色はそのまま。
// 1.0 = 空の青をそのまま光として配る(上を向いた面が一様に青くかぶる)。
var ENV_LIGHT_SATURATION = 0.45;
// 暗部の受け。影を強くすると黒が 0 に張り付いて形が読めなくなるので、
// この値より下は 0 へ漸近させて段差を残す(上端の softClip の裏返し)。
var GRADE_TOE = 0.055;
var GRADE_TOE_SLOPE = 2.2;
var LIGHT_PRESETS = {
  morning:{
    label:'朝',hemi:0.27,sun:0.92,ambient:0.11,room:0.14,exposure:1.14,env:0.50,
    sunColor:'#ffd6a3',ambientColor:'#fff2df',hemiSky:'#d7ecff',hemiGround:'#8f7a66',
    sunPos:{x:-120,y:78,z:85},fogColor:0xd6e7f1,fogNear:70,fogFar:470,interiorBg:0x151821,
    sky:{top:'#6f9dcb',mid:'#b7d7ee',horizon:'#ffd7a6',ground:'#f5e7c9',sunX:0.22,sunY:0.34,sunCore:'rgba(255,240,205,0.95)',sunGlow:'rgba(255,176,91,0.44)',haze:'rgba(255,220,168,0.42)',cloudAlpha:0.62}
  },
  day:{
    label:'昼',hemi:0.40,sun:1.10,ambient:0.10,room:0.22,exposure:1.18,env:0.62,
    // 昼だけ半球光が純白＋灰色＝**色を持たない塗りつぶし**だった(朝・夕は元から色付き)。
    // 上から空色・下から土の反射に変えると、面の向きで寒色と暖色が分かれ、
    // 明るさを上げずに彩度と立体感が出る。
    // ただし空側を濃い青(#bcd9f5)にすると、上を向いた面が全部青くかぶる
    // (地面の青かぶりが +47→+58 に悪化した)。空側はごく薄い青に留め、
    // 色は下側(地面の照り返し)で持たせる。
    // 色を付けると白より暗くなるぶん、hemi を 0.34→0.40 へ戻している。
    sunColor:'#ffffff',ambientColor:'#ffffff',hemiSky:'#eef3f8',hemiGround:'#9c8a6f',
    sunPos:{x:100,y:200,z:100},fogColor:0xb8d4f0,fogNear:80,fogFar:500,interiorBg:0x12121a,
    sky:{top:'#2874da',mid:'#549de5',horizon:'#bedcf3',ground:'#f4f7ec',sunX:0.78,sunY:0.2,sunCore:'rgba(255,255,235,0.95)',sunGlow:'rgba(255,249,205,0.45)',haze:'rgba(255,245,215,0.55)',cloudAlpha:1}
  },
  evening:{
    label:'夕方',hemi:0.20,sun:0.88,ambient:0.10,room:0.19,exposure:1.07,env:0.42,
    sunColor:'#ffad62',ambientColor:'#ffe4cc',hemiSky:'#b8a5d8',hemiGround:'#6c5142',
    sunPos:{x:150,y:46,z:-90},fogColor:0xd8a878,fogNear:65,fogFar:430,interiorBg:0x18131a,
    sky:{top:'#4d5f91',mid:'#a06f9e',horizon:'#f0a85e',ground:'#5c4a54',sunX:0.82,sunY:0.55,sunCore:'rgba(255,230,186,0.9)',sunGlow:'rgba(255,128,50,0.5)',haze:'rgba(255,145,72,0.38)',cloudAlpha:0.46}
  },
  night:{
    label:'夜',hemi:0.10,sun:0.10,ambient:0.06,room:0.30,exposure:0.76,env:0.12,
    sunColor:'#c9dcff',ambientColor:'#c9d7ff',hemiSky:'#1d2b5d',hemiGround:'#11131d',
    sunPos:{x:-70,y:110,z:-120},fogColor:0x1b2544,fogNear:50,fogFar:330,interiorBg:0x070913,
    sky:{top:'#071028',mid:'#14224c',horizon:'#26365f',ground:'#0b1020',sunX:0.2,sunY:0.23,sunCore:'rgba(222,235,255,0.78)',sunGlow:'rgba(105,145,255,0.24)',haze:'rgba(35,50,95,0.42)',cloudAlpha:0.14}
  }
};
// ─── 太陽軌道シミュレーション(東京近郊 緯度35.7度の簡易モデル) ───
function computeSunPosition(hour,season,northDeg){
  var lat=35.7*Math.PI/180;
  var decl=(season==='summer'?23.4:season==='winter'?-23.4:0)*Math.PI/180;
  var H=(hour-12)*15*Math.PI/180; // 時角
  var alt=Math.asin(Math.sin(lat)*Math.sin(decl)+Math.cos(lat)*Math.cos(decl)*Math.cos(H));
  // 方位角: 0=南、+が西回り
  var az=Math.atan2(Math.sin(H), Math.cos(H)*Math.sin(lat)-Math.tan(decl)*Math.cos(lat));
  // ワールド方位へ: 画面奥(-Z)を北とし、northDeg で敷地の向きを回転
  var azWorld=az+Math.PI+(northDeg||0)*Math.PI/180;
  var R=220;
  var y=Math.sin(alt)*R; // Below-horizon sun must remain below the horizon.
  var horiz=Math.cos(alt)*R;
  return {
    x:Math.sin(azWorld)*horiz,
    y:y,
    z:-Math.cos(azWorld)*horiz,
    altitude:alt, azimuth:azWorld
  };
}
// 高度に応じた太陽光の色(低高度=暖色)
function sunColorForAltitude(alt){
  var t=Math.max(0,Math.min(1,alt/(Math.PI/3)));
  var r=Math.round(255);
  var g=Math.round(158+(250-158)*t);
  var b=Math.round(88+(244-88)*t);
  return 'rgb('+r+','+g+','+b+')';
}
function solarNightBlend(alt){
  var t=Math.max(0,Math.min(1,(3-alt*180/Math.PI)/11));
  return t*t*(3-2*t);
}
function sunSimDimFactor(alt){
  return Math.max(0,Math.min(1,Math.sin(alt)*1.6));
}

var INTERIOR_WALL_DEFAULT = '#f4f0e8';

function foundationHeightMm(){
  if(typeof DATA==='undefined' || !DATA || !DATA.items) return 0;
  var maxH=0;
  DATA.items.forEach(function(it){
    if(it && it.type==='foundation'){
      var h=Number(it.foundationHeight);
      if(!isFinite(h)) h=450;
      maxH=Math.max(maxH,Math.max(0,h));
    }
  });
  return Math.max(0,Math.min(2000,maxH));
}
function foundationHeightM(){
  return foundationHeightMm()*U;
}
// ─── 壁・床の既定値(グローバル / 階ごと) ──────────────────────────────
// ここで持つのは「壁ごと・部屋ごとに個別指定していないときに採る値」= 既定値。
// 個別指定 (wall.wallHeight / room.floorRaiseMm) は従来どおり常に優先される。
//
// 日本の住宅は階ごとに階高が違うことが珍しくないので、DATA.heightDefaults.perFloor
// が真のあいだは DATA.floors[階].wallHeight / .floorRaise を階ごとに読む。
// これらのフィールドを持たない保存済みプランでは WALL_H / 0 に落ち、
// 寸法は1mmも動かない。
var WALL_H_MIN=1800, WALL_H_MAX=4000;
var DEFAULT_FLOOR_RAISE_MM=0;
var HEIGHT_SETTING_FLOORS=[1,2,3,4];
function clampWallHeightMm(v){
  var n=Number(v);
  if(!isFinite(n)) return WALL_H;
  return Math.max(WALL_H_MIN,Math.min(WALL_H_MAX,Math.round(n)));
}
function clampFloorRaiseMm(v){
  var n=Number(v);
  if(!isFinite(n)) return 0;
  return Math.max(0,Math.min(600,Math.round(n)));
}
function ensureHeightDefaults(plan){
  plan=plan||(typeof DATA!=='undefined'?DATA:null);
  if(!plan) return null;
  if(!plan.heightDefaults||typeof plan.heightDefaults!=='object'||Array.isArray(plan.heightDefaults)) plan.heightDefaults={};
  if(!plan.floors||typeof plan.floors!=='object'||Array.isArray(plan.floors)) plan.floors={};
  var hd=plan.heightDefaults;
  hd.perFloor=!!hd.perFloor;
  // 保存済みプランの既定値をグローバル変数へ写す。写さないと、保存して読み直した
  // だけで壁の高さが 2400 に戻る(この設定は今まで保存されていなかった)。
  if(isFinite(Number(hd.wallHeight))&&Number(hd.wallHeight)>0) WALL_H=clampWallHeightMm(hd.wallHeight);
  else hd.wallHeight=WALL_H;
  if(!isFinite(Number(hd.floorRaise))||Number(hd.floorRaise)<0) hd.floorRaise=DEFAULT_FLOOR_RAISE_MM;
  return hd;
}
// 別のプランを読み込むときに呼ぶ。
//
// WALL_H は「いま編集しているプランの壁の高さ」を持つ変数で、
// ensureHeightDefaults がプランから写す。ところが**プランが壁の高さを
// 持っていないとき**は逆にグローバルの値をプランへ書くので、読み込んだ
// プランが前のプランの高さを引き継いでしまう。既定プランが壁の高さを
// 持つようになって、これが見えるようになった(読み込んだ間取りが288mm
// 高く建つ)。プランを差し替える側で、先に既定へ戻す。
function resetHeightGlobalsForPlanLoad(){
  WALL_H=DEFAULT_WALL_H_MM;
}
function perFloorHeightsEnabled(){
  var plan=(typeof DATA!=='undefined')?DATA:null;
  var hd=plan?plan.heightDefaults:null;
  return !!(hd&&hd.perFloor);
}
function planFloorHeightEntry(floor){
  var plan=(typeof DATA!=='undefined')?DATA:null;
  var floors=plan?plan.floors:null;
  if(!floors||typeof floors!=='object') return null;
  var e=floors[String(floor)]!==undefined?floors[String(floor)]:floors[floor];
  return (e&&typeof e==='object'&&!Array.isArray(e))?e:null;
}
// その階の既定の壁高さ(mm)。階ごと設定が OFF か未入力ならグローバル WALL_H。
function defaultWallHeightMmForFloor(floor){
  if(perFloorHeightsEnabled()){
    var e=planFloorHeightEntry(floor);
    var v=Number(e&&e.wallHeight);
    // 範囲は wallHeightMm と同じ。UI 用の clampWallHeightMm を呼ばないのは、
    // 高さモデルだけを切り出して走らせる経路(tools/tests)への依存を増やさないため。
    if(isFinite(v)&&v>0) return Math.max(300,Math.min(6000,Math.round(v)));
  }
  var g=Number(WALL_H);
  return (isFinite(g)&&g>0)?g:2400;
}
// その階の既定の床の高さ(床上げ mm)。部屋に floorRaiseMm があればそちらが優先。
function defaultFloorRaiseMmForFloor(floor){
  if(perFloorHeightsEnabled()){
    var e=planFloorHeightEntry(floor);
    var v=Number(e&&e.floorRaise);
    if(isFinite(v)&&v>=0) return Math.max(0,Math.min(600,Math.round(v)));
  }
  var plan=(typeof DATA!=='undefined')?DATA:null;
  var hd=plan?plan.heightDefaults:null;
  var g=Number(hd&&hd.floorRaise);
  return (isFinite(g)&&g>=0)?Math.max(0,Math.min(600,Math.round(g))):0;
}
// 新しく作る部屋に入れる床の高さ(床上げ mm)。既定値をまだ触っていないプランは
// 従来どおり 1階=150 / 上階=0。触った時点からはその既定値に従う。
function newRoomFloorRaiseMm(floor){
  var f=floor||1;
  if(perFloorHeightsEnabled()){
    var e=planFloorHeightEntry(f);
    if(e&&isFinite(Number(e.floorRaise))) return clampFloorRaiseMm(e.floorRaise);
  }else{
    var plan=(typeof DATA!=='undefined')?DATA:null;
    var hd=plan?plan.heightDefaults:null;
    if(hd&&hd.floorRaiseSet) return clampFloorRaiseMm(hd.floorRaise);
  }
  return f===1?150:0;
}
// 既定値を変えたとき、「既定値のまま」だった壁を新しい既定値へ付け替える。
// 壁は作られた時点の既定値を wallHeight に焼き付けるので、これをしないと
// サイドメニューで壁を高くしても既存の壁だけが取り残される。
// 既定と違う値を入れてある壁(手すり壁の1100など)は触らない。
function retagWallsToDefaultHeight(floor,oldDefault,newDefault){
  var walls=(typeof DATA!=='undefined'&&DATA&&DATA.walls)?DATA.walls:null;
  if(!walls||oldDefault===newDefault) return;
  walls.forEach(function(w){
    if(floor!==null&&floor!==undefined&&(w.floor||1)!==floor) return;
    if(w.wallHeight===undefined||Number(w.wallHeight)===oldDefault) w.wallHeight=newDefault;
  });
}
function heightDefaultsChanged(){
  markDirty();
  syncHeightDefaultsUI();
  if(typeof updateProps==='function') updateProps();
  if(typeof draw2d==='function') draw2d();
  if(typeof ren!=='undefined'&&ren&&typeof rebuild3D==='function') rebuild3D();
}
function setPerFloorHeights(on){
  var hd=ensureHeightDefaults();
  if(!hd) return;
  if(typeof saveState==='function') saveState();
  var before=HEIGHT_SETTING_FLOORS.map(function(f){return defaultWallHeightMmForFloor(f);});
  hd.perFloor=!!on;
  if(hd.perFloor){
    // ONにした瞬間に家の形が変わらないよう、今の実効値を各階へ書き写す。
    HEIGHT_SETTING_FLOORS.forEach(function(f,i){
      var e=DATA.floors[String(f)];
      if(!e||typeof e!=='object'){ e={}; DATA.floors[String(f)]=e; }
      if(!isFinite(Number(e.wallHeight))||Number(e.wallHeight)<=0) e.wallHeight=before[i];
      if(e.floorThickness===undefined)e.floorThickness=hd.floorThickness===undefined?180:hd.floorThickness;
    });
  }
  heightDefaultsChanged();
}
// floor が null ならグローバル(全階共通)の既定値。
function setDefaultWallHeight(floor,value){
  var hd=ensureHeightDefaults();
  if(!hd) return;
  var v=clampWallHeightMm(value);
  if(typeof saveState==='function') saveState();
  hd.modelVersion=2;
  if(floor===null||floor===undefined){
    var olds=HEIGHT_SETTING_FLOORS.map(function(f){return defaultWallHeightMmForFloor(f);});
    WALL_H=v; hd.wallHeight=v;
    HEIGHT_SETTING_FLOORS.forEach(function(f,i){ retagWallsToDefaultHeight(f,olds[i],defaultWallHeightMmForFloor(f)); });
  }else{
    var old=defaultWallHeightMmForFloor(floor);
    var e=DATA.floors[String(floor)];
    if(!e||typeof e!=='object'){ e={}; DATA.floors[String(floor)]=e; }
    e.wallHeight=v;
    retagWallsToDefaultHeight(floor,old,v);
  }
  heightDefaultsChanged();
}
function setDefaultFloorRaise(floor,value){
  var hd=ensureHeightDefaults();
  if(!hd) return;
  var v=clampFloorRaiseMm(value);
  if(typeof saveState==='function') saveState();
  if(floor===null||floor===undefined){
    var olds=HEIGHT_SETTING_FLOORS.map(function(f){return defaultFloorRaiseMmForFloor(f);});
    hd.floorRaise=v; hd.floorRaiseSet=true;
    HEIGHT_SETTING_FLOORS.forEach(function(f,i){ retagRoomsToDefaultRaise(f,olds[i],defaultFloorRaiseMmForFloor(f)); });
  }else{
    var old=defaultFloorRaiseMmForFloor(floor);
    var e=DATA.floors[String(floor)];
    if(!e||typeof e!=='object'){ e={}; DATA.floors[String(floor)]=e; }
    e.floorRaise=v;
    retagRoomsToDefaultRaise(floor,old,v);
  }
  heightDefaultsChanged();
}
// 壁と同じ理由で、部屋も作られた時点の既定値を floorRaiseMm に焼き付けている。
function retagRoomsToDefaultRaise(floor,oldDefault,newDefault){
  var rooms=(typeof DATA!=='undefined'&&DATA&&DATA.rooms)?DATA.rooms:null;
  if(!rooms||oldDefault===newDefault) return;
  rooms.forEach(function(r){
    if((r.floor||1)!==floor) return;
    if(r.floorRaiseMm===undefined||Number(r.floorRaiseMm)===oldDefault) r.floorRaiseMm=newDefault;
  });
}
function heightDefaultsRowHtml(floor){
  var tag=(floor===null||floor===undefined)?'':(floor+'F');
  var arg=(floor===null||floor===undefined)?'null':String(floor);
  var wallV=defaultWallHeightMmForFloor(floor===null?1:floor);
  var raiseV=defaultFloorThicknessMm(floor===null?1:floor);
  return '<div class="hd-row">'+
    (tag?'<span class="hd-tag">'+tag+'</span>':'')+
    '<input class="pi" type="number" min="'+WALL_H_MIN+'" max="'+WALL_H_MAX+'" step="50" value="'+wallV+'" title="壁の高さ(mm)" onchange="setDefaultWallHeight('+arg+',+this.value)">'+
    '<input class="pi" type="number" min="20" max="1000" step="10" value="'+raiseV+'" title="床厚(mm)" onchange="setDefaultFloorThickness('+arg+',+this.value)">'+
    '</div>';
}
function syncHeightDefaultsUI(){
  if(typeof document==='undefined') return;
  var body=document.getElementById('height-defaults-body');
  var chk=document.getElementById('height-per-floor');
  if(!body) return;
  ensureHeightDefaults();
  var per=perFloorHeightsEnabled();
  if(chk) chk.checked=per;
  var head='<div class="hd-head">'+(per?'<span class="hd-tag"></span>':'')+
    '<span class="hd-col">壁の高さ</span><span class="hd-col">床厚</span></div>';
  if(per){
    // 上の行が上の階。キャンバスの3Dビューと上下がそろっていないと読み違える。
    body.innerHTML=head+HEIGHT_SETTING_FLOORS.slice().reverse()
      .map(function(f){return heightDefaultsRowHtml(f);}).join('');
  }else{
    body.innerHTML=head+heightDefaultsRowHtml(null);
  }
}
// 階高(mm)。plan.floors[階].storyHeight が無ければ既定 2700(=FLOOR_H)へ落ちる。
// 高さフィールドを持たない保存済みプランでは FLOOR_H 定数と完全に同値。
//
// **床スラブ+その階の既定の壁高さ を下限にする。** これが無いと、壁を高くしても
// 上階の始まる高さが据え置かれ、下階の壁が上階へめり込む。壁は階の床スラブの
// 下端から立つので、階高がそれを下回った時点で必ず突き抜ける。
// Version 2 uses finished standard floor → standard ceiling as the wall height.
// Unversioned saved plans keep their original datum until a height setting is edited.
function usesFinishedHeightModel(){
  return typeof DATA!=='undefined'&&DATA&&DATA.heightDefaults&&DATA.heightDefaults.modelVersion===2;
}
function defaultFloorThicknessMm(floor){
  var hd=DATA.heightDefaults||{},e=perFloorHeightsEnabled()?planFloorHeightEntry(floor):null;
  var n=Number(e&&e.floorThickness!==undefined?e.floorThickness:hd.floorThickness);
  return Number.isFinite(n)?Math.max(20,Math.min(1000,n)):180;
}
function setDefaultFloorThickness(floor,value){
  var n=Number(value);if(!Number.isFinite(n))return;
  saveState();var hd=ensureHeightDefaults();hd.modelVersion=2;
  n=Math.max(20,Math.min(1000,Math.round(n)));
  if(floor===null||floor===undefined)hd.floorThickness=n;
  else{var e=DATA.floors[String(floor)]||(DATA.floors[String(floor)]={});e.floorThickness=n;}
  heightDefaultsChanged();
}
function storyHeightMmForFloor(floor){
  if(typeof usesFinishedHeightModel==='function'&&usesFinishedHeightModel())return defaultWallHeightMmForFloor(floor)+defaultFloorThicknessMm(floor);
  var base=FLOOR_H;
  if(typeof HeightModel!=='undefined'&&HeightModel&&typeof DATA!=='undefined'&&DATA)
    base=HeightModel.storyHeightMm(DATA,floor);
  var need=floorSlabMmForFloor(floor)+defaultWallHeightMmForFloor(floor);
  return Math.max(base,need);
}
function storyHeightM(floor){
  return storyHeightMmForFloor(floor)*U;
}
function floorBaseY(floor){
  // 階は「その階より下の階の階高の合計」だけ持ち上がる。階高がすべて既定(2700)の
  // ときは従来式 ((floor-1)*FLOOR_H*U) と1ビットも変わらない。
  var f=(floor||1), y=foundationHeightM(), i;
  if(f>=1){
    for(i=1;i+1<=f;i++) y+=storyHeightM(i);
    if(i<f) y+=storyHeightM(i)*(f-i);        // 端数階(通常は無い)も従来式と同じ比例
  }else{
    for(i=1;i-1>=f;i--) y-=storyHeightM(i-1);
    if(i>f) y-=storyHeightM(i-1)*(i-f);
  }
  return y;
}
function floorSlabHeightM(){
  // FLOOR_SLAB_H は床スラブの厚みで、部屋の天井高とは無関係なので置き換えない。
  return Math.max(0,FLOOR_SLAB_H||0)*U;
}
// その階の床スラブ厚(mm)。1階は基礎の上に直接載るので 0。
function floorSlabMmForFloor(floor){
  if(typeof usesFinishedHeightModel==='function'&&usesFinishedHeightModel())return defaultFloorThicknessMm(floor);
  return (floor||1)<=1 ? 0 : Math.max(0,FLOOR_SLAB_H||0);
}
function floorSlabHeightMForFloor(floor){
  return floorSlabMmForFloor(floor)*U;
}
function floorTopY(floor){
  return floorBaseY(floor)+floorSlabHeightMForFloor(floor);
}
// Room finished-floor buildup, measured from the existing floor datum (mm).
// Missing values retain existing plans exactly; structural storeys stay unchanged.
function roomFloorOffsetMm(room){
  var n=Number(room&&room.floorRaiseMm);
  if(Number.isFinite(n)) return Math.max(typeof usesFinishedHeightModel==='function'&&usesFinishedHeightModel()?-Math.max(0,floorSlabMmForFloor(room.floor)-20):0,Math.min(600,n));
  // 個別指定が無い部屋はサイドメニューの既定値(階ごと設定を含む)を採る。
  // 既定値は 0 なので、設定していないプランは従来どおり。
  return defaultFloorRaiseMmForFloor(room&&room.floor);
}
// ── スキップフロア (同じ階の中の段差) ─────────────────────────────────────
// room.floorRaiseMm が「仕上げの段差」(天井は動かない) なのに対し、
// room.skipLevelMm は「その区画ごと床も天井も持ち上がる」段差である。
// 2つは足し算で効く -- +400 の小上がりの上にさらに +150 の畳寄せ、が書ける。
//
// **省略時は 0。** 既存プランはこのフィールドを持たないので、床も天井も壁も
// 階段も1mmも動かない。これがこの機能の後方互換のすべてである。
var SKIP_LEVEL_MAX_MM=2400;
// 段差の下を「空間」として扱う下限。これを下回る小上がりの下には何も入らないので
// 従来どおり中身の詰まった塊として描く。
var SKIP_CAVITY_MIN_MM=400;
function roomSkipLevelMm(room){
  if(!room) return 0;
  if(typeof HeightModel!=='undefined'&&HeightModel&&HeightModel.skipLevelMm)
    return HeightModel.skipLevelMm((typeof DATA!=='undefined')?DATA:null,room);
  var n=Number(room.skipLevelMm);
  return (isFinite(n)&&n>0)?Math.min(Math.round(n),SKIP_LEVEL_MAX_MM):0;
}
// 段差の下に、物を入れられる空間ができるか。
// 厚みは段差(構造)と床上げ(仕上げ)の合計で見る。
//
// **この空間をアプリが塞ぐことはしない。** 段差の下を壁で囲うのか、柱で持たせるのか、
// 奥の壁を支えにして手前を開けるのかは設計そのものなので、置くのは利用者である。
// 自動で板を立てると、引いた覚えのない壁が「奥の壁」として現れる。
function roomSkipCavityMm(room){
  if(!room) return 0;
  var t=roomSkipLevelMm(room)+roomFloorOffsetMm(room);
  return t>=SKIP_CAVITY_MIN_MM ? t : 0;
}
// その階に段差を持つ部屋が1つでもあるか。
// 段差を使っていないプラン(=保存済みのほぼ全部)で、壁1本ごとに部屋を
// なめ直すのを避けるための早い出口である。ここが false なら、段差まわりの
// 計算は1つも走らない。
function floorHasSkipLevel(floor){
  var rooms=(typeof DATA!=='undefined'&&DATA&&DATA.rooms)?DATA.rooms:null;
  if(!rooms) return false;
  var f=floor||1;
  for(var i=0;i<rooms.length;i++){
    var r=rooms[i];
    if(r&&!r.hidden3D&&(r.floor||1)===f&&roomSkipLevelMm(r)>0) return true;
  }
  return false;
}
// 段差の各辺の向こうに何があるか。'lower' 低いレベルの部屋 / 'same' 同じレベルの部屋 /
// 'none' 部屋が無い(外・廊下など)。n/s/w/e は平面座標の -y / +y / -x / +x 側。
// 一部でも低いレベルに面していれば 'lower' を採る -- そこが実際に見える蹴上げ面だから。
function roomSkipEdgeNeighbors(room){
  var out={n:'none',s:'none',w:'none',e:'none'};
  if(!room||typeof DATA==='undefined'||!DATA||!DATA.rooms) return out;
  var mine=roomSkipLevelMm(room)+roomFloorOffsetMm(room);
  if(mine<=0) return out;
  var off=300, fr=[0.2,0.5,0.8];
  var edges=[
    ['n',function(t){return {x:room.x+room.w*t, y:room.y-off};}],
    ['s',function(t){return {x:room.x+room.w*t, y:room.y+room.d+off};}],
    ['w',function(t){return {x:room.x-off, y:room.y+room.d*t};}],
    ['e',function(t){return {x:room.x+room.w+off, y:room.y+room.d*t};}]
  ];
  edges.forEach(function(e){
    for(var i=0;i<fr.length;i++){
      var p=e[1](fr[i]);
      var r2=roomAtPointOnFloor(room.floor,p.x,p.y);
      if(!r2||r2===room) continue;
      var lvl=roomSkipLevelMm(r2)+roomFloorOffsetMm(r2);
      if(mine-lvl>=100){ out[e[0]]='lower'; return; }
      if(out[e[0]]==='none') out[e[0]]='same';
    }
  });
  return out;
}
// 低いレベルに面している辺。平面図の段差線が引かれるのはここ。
function roomSkipOpenSides(room){
  var e=roomSkipEdgeNeighbors(room);
  return {n:e.n==='lower', s:e.s==='lower', w:e.w==='lower', e:e.e==='lower'};
}
// ── 手すり・柵の意匠 ──────────────────────────────────────────────────────
// 階段の手すりと格子柵は、実物では同じ語彙で選ぶ部材である(笠木・支柱・
// 横桟か縦格子か)。設定の言葉を分けると、同じ家の中で意匠がそろわない。
// **どちらも同じフィールドで決める**。
//
//   railInfill  'bars'(既定) 横桟 / 'wires' 横ワイヤー /
//               'baluster' 縦格子 / 'none' 笠木と支柱だけ
//   railCapColor    笠木(木)の色
//   railFrameColor  骨(支柱・桟・ワイヤー)の色
//   railBars        横桟の本数
//
// 省略時は、それぞれの部材がこれまで持っていた見た目へ落ちる:
//   階段の手すり … 横桟(参考にした納まりの標準)
//   格子柵        … fencePattern から縦格子/横桟へ写す(従来の見た目のまま)
var RAIL_INFILL_VALUES=['bars','wires','baluster','none'];
function railInfillOf(it){
  var v=it&&it.railInfill;
  if(RAIL_INFILL_VALUES.indexOf(v)>=0) return v;
  // 旧フィールドからの読み替え。格子柵は fencePattern を持っている。
  if(it&&it.type==='lattice-screen')
    return (it.fencePattern==='horizontal')?'bars':'baluster';
  return 'bars';
}
function railBarCount(it){
  var n=Number(it&&it.railBars);
  return (isFinite(n)&&n>=0)?Math.max(0,Math.min(12,Math.round(n))):3;
}
function railCapColorOf(it){
  var c=(it&&it.railCapColor)||(it&&it.stairRailColor);
  return (typeof c==='string'&&/^#/.test(c))?c:'#9c7749';
}
// 骨の色。**明示されたときだけ**返す。省略時は null を返し、呼び出し側は
// これまでの色(アイテム色や部材ごとの既定)をそのまま使う -- 保存済みプランの
// 見た目を変えないため。
function railFrameColorOf(it){
  var c=it&&it.railFrameColor;
  return (typeof c==='string'&&/^#/.test(c))?c:null;
}
// 階段の手すりは骨の色に既定を持つ(参考にした納まりは黒い金物)。
function stairRailFrameColorOf(it){
  return railFrameColorOf(it)||'#2b2f33';
}
function stairRailColorOf(it){
  return railCapColorOf(it);
}
// 意匠と色を選ぶ欄。**階段の手すりと格子柵で同じものを出す**。
// 語彙をそろえておかないと、同じ家の中で手すりだけ浮く。
// opts.label        見出し
// opts.autoLabel    これを渡すと「指定しない」を先頭に置く
// opts.frameDefault 骨の色が未指定のときに色見本へ出す色
function railingDesignHtml(it,opts){
  opts=opts||{};
  var q=String.fromCharCode(39);
  var hasCap=opts.capToggle?latticeHasCap(it):true;
  // 部材のあり／なしは、その部材を細かく決める欄より **先**。後ろに置くと、
  // 先に目に入った「笠木の色」を選んだ人が、付けたつもりで付いていない
  // 状態になる(「格子柵に笠木が出ない」の正体はこれだった)。
  var html='';
  if(opts.capToggle){
    html+='<div class="pr"><div class="pl">笠木（手すり）</div>'+
      '<select class="pi" onchange="updateSelectedProp('+q+'latticeCap'+q+',this.value==='+q+'on'+q+'?true:undefined)">'+
      '<option value="off"'+(hasCap?'':' selected')+'>なし（目隠し）</option>'+
      '<option value="on"'+(hasCap?' selected':'')+'>あり（手すり）</option>'+
      '</select></div>';
  }
  var cur=(RAIL_INFILL_VALUES.indexOf(it&&it.railInfill)>=0)?it.railInfill:(opts.autoLabel?'':railInfillOf(it));
  function opt(v,label){
    return '<option value="'+v+'"'+(cur===v?' selected':'')+'>'+label+'</option>';
  }
  html+='<div class="pr"><div class="pl">'+(opts.label||'意匠')+'</div>'+
    '<select class="pi" onchange="updateSelectedProp('+q+'railInfill'+q+',this.value||undefined)">'+
    (opts.autoLabel?opt('',opts.autoLabel):'')+
    opt('bars','横桟')+
    opt('wires','横ワイヤー')+
    opt('baluster','縦格子')+
    opt('none','桟なし')+
    '</select></div>';
  if(railInfillOf(it)==='bars')
    html+='<div class="pr"><div class="pl">横桟の本数</div><input class="pi" type="number" min="0" max="12" step="1" value="'+
      railBarCount(it)+'" onchange="updateSelectedProp('+q+'railBars'+q+',+this.value)"></div>';
  // 笠木の色は、笠木があるときだけ。無い部材の色を選ばせない。
  if(hasCap)
    html+='<div class="pr"><div class="pl">笠木の色（木）</div><input class="pi" type="color" value="'+
      railCapColorOf(it)+'" onchange="updateSelectedProp('+q+'railCapColor'+q+',this.value)"></div>';
  html+='<div class="pr"><div class="pl">骨の色（支柱・桟）</div><input class="pi" type="color" value="'+
    (railFrameColorOf(it)||opts.frameDefault||'#2b2f33')+'" onchange="updateSelectedProp('+q+'railFrameColor'+q+',this.value)"></div>';
  html+='<div class="lock-status-note">階段の手すりと共通の設定です。'+(opts.note||'')+'</div>';
  return html;
}
// ── 格子柵 ────────────────────────────────────────────────────────────────
// もとは外構の目隠しだが、スキップフロアや吹き抜けの手すりにも使える。
// 手すりとして使うには、格子の間隔(子どもがすり抜けない内法)と、掴める笠木が
// 選べる必要がある。既定値は従来の見た目(間隔95/見付55/笠木なし)のまま。
function latticePitchMm(it){
  var n=Number(it&&it.latticePitch);
  return (isFinite(n)&&n>0)?Math.max(30,Math.min(600,Math.round(n))):95;
}
function latticeSlatMm(it){
  var n=Number(it&&it.latticeSlat);
  return (isFinite(n)&&n>0)?Math.max(15,Math.min(200,Math.round(n))):55;
}
// 格子の内法(mm)。手すりとして使うときは 110mm 以下が目安。
function latticeClearMm(it){
  return Math.max(0,latticePitchMm(it)-latticeSlatMm(it));
}
function latticeHasCap(it){
  return !!(it&&it.latticeCap);
}
// ── 階段の手すり ──────────────────────────────────────────────────────────
// どちら側に付けるかは利用者が選ぶ(平面からは決まらない)。
// 壁付けか柱建てかは、その側に壁が沿っているかで決まる -- 実物と同じく、
// 壁があれば壁に付け、無ければ支柱を立てる。造作棚と同じ考え方である。
// 自動が当たらない置き方(壁から少し離した階段など)のために明示も受ける。
// 省略時は手すり無し = 保存済みプランの階段は1本も増えない。
var STAIR_RAIL_HEIGHT_MM=800;      // 段鼻からの手すり高さ。住宅の実務値
var STAIR_RAIL_DIA_MM=35;          // 手すり径。住宅用の標準(握りやすさの実務値)
function stairRailSides(it){
  var v=it&&it.stairRail;
  if(v==='left') return ['left'];
  if(v==='right') return ['right'];
  if(v==='both') return ['left','right'];
  return [];
}
// この側に壁が沿っているか。階段の走行軸と平行(15度以内)で、側面の線から
// 250mm 以内を通り、走行の半分以上に重なっている壁を「沿っている」とみなす。
function stairSideHasWall(it,side){
  if(!it||typeof DATA==='undefined'||!DATA||!DATA.walls) return false;
  var rad=(Number(it.rot)||0)*Math.PI/180;
  var cos=Math.cos(rad), sin=Math.sin(rad);
  var runSgn=it.flipY?-1:1, sideSgn=(side==='right'?1:-1)*(it.flipX?-1:1);
  var ux=-sin*runSgn, uy=cos*runSgn;              // 走行の向き
  var vx=cos*sideSgn, vy=sin*sideSgn;             // 側面の向き
  var cx=(Number(it.x)||0)+(Number(it.w)||0)/2, cy=(Number(it.y)||0)+(Number(it.d)||0)/2;
  var half=(Number(it.w)||0)/2;
  var sx=cx+vx*half, sy=cy+vy*half;               // 側面の線の中点
  var runLen=Number(it.d)||0;
  for(var i=0;i<DATA.walls.length;i++){
    var w=DATA.walls[i];
    if(!w||(w.floor||1)!==(it.floor||1)) continue;
    var dx=w.x2-w.x1, dy=w.y2-w.y1, len=Math.sqrt(dx*dx+dy*dy);
    if(len<1) continue;
    var wx=dx/len, wy=dy/len;
    if(Math.abs(wx*ux+wy*uy)<0.966) continue;     // 走行軸と平行でない
    // 側面の線からの距離(走行軸に直交する向きの成分)
    var offA=(w.x1-sx)*vx+(w.y1-sy)*vy;
    var offB=(w.x2-sx)*vx+(w.y2-sy)*vy;
    var near=Math.min(Math.abs(offA),Math.abs(offB));
    if(near>(Number(w.thick)||120)/2+250) continue;
    // 走行方向の重なり
    var tA=(w.x1-sx)*ux+(w.y1-sy)*uy, tB=(w.x2-sx)*ux+(w.y2-sy)*uy;
    var lo=Math.max(Math.min(tA,tB),-runLen/2), hi=Math.min(Math.max(tA,tB),runLen/2);
    if(hi-lo>=runLen*0.5) return true;
  }
  return false;
}
// 'wall' 壁付け | 'post' 柱建て。明示があれば自動判定より優先する。
function stairRailMountFor(it,side){
  var m=it&&it.stairRailMount;
  if(m==='wall'||m==='post') return m;
  return stairSideHasWall(it,side)?'wall':'post';
}
// ── 階段の外観の形状 ──────────────────────────────────────────────────────
// 昇降の形(直・かね折れ・折り返し・回り)は置く部材の組み合わせで決まるが、
// 外観の形状は1枚ごとの作りである。実務で言い分けられている3つを持つ:
//
//   'open'     ひな壇  踏板+蹴込み板、側面は露出、階段下は素通し（既定）
//   'box'      箱型    階段下を塞ぐ。下は収納やトイレに使える
//   'skeleton' スケルトン 蹴込み板が無い。光と視線が抜ける（オープン階段）
//
// **省略時は 'open' = 従来どおり**なので、保存済みプランは1枚も変わらない。
// 旧フィールド stairUnder==='filled' は箱型として読む(先に入れた指定の互換)。
function stairStyleOf(it){
  var v=it&&it.stairStyle;
  if(v==='box'||v==='skeleton'||v==='open') return v;
  return (it&&it.stairUnder==='filled')?'box':'open';
}
function stairUnderFilled(it){
  return stairStyleOf(it)==='box';
}
// 蹴込み板を張るか。スケルトン階段は張らない。
function stairHasRisers(it){
  return stairStyleOf(it)!=='skeleton';
}
// ── 矩形の差 ──────────────────────────────────────────────────────────────
// 段差の天板に階段の開口を開けるために使う。
//
// THREE.ExtrudeGeometry は外形と穴の壁を**別々に**作るので、穴が外形の辺に
// 接していても外周の壁は切れない。段差の天板は小口が室内から見えるので、
// そこに板が1枚残って階段をまたぐ。穴として開けるのではなく、矩形の差に
// 割って作れば、面は本当に途切れる。
// 矩形は {x0,y0,x1,y1}(mm、平面座標)。
function rectMinusRect(a,h){
  var out=[];
  var ox0=Math.max(a.x0,h.x0), ox1=Math.min(a.x1,h.x1);
  var oy0=Math.max(a.y0,h.y0), oy1=Math.min(a.y1,h.y1);
  if(ox1-ox0<=0.001||oy1-oy0<=0.001) return [a];      // 重なっていない
  if(oy0-a.y0>0.001) out.push({x0:a.x0,y0:a.y0,x1:a.x1,y1:oy0});
  if(a.y1-oy1>0.001) out.push({x0:a.x0,y0:oy1,x1:a.x1,y1:a.y1});
  if(ox0-a.x0>0.001) out.push({x0:a.x0,y0:oy0,x1:ox0,y1:oy1});
  if(a.x1-ox1>0.001) out.push({x0:ox1,y0:oy0,x1:a.x1,y1:oy1});
  return out;
}
function subtractRectsFromRect(rect,holes){
  var rects=[rect];
  (holes||[]).forEach(function(h){
    var next=[];
    rects.forEach(function(r){ next=next.concat(rectMinusRect(r,h)); });
    rects=next;
  });
  return rects;
}
// 穴の多角形(ワールドm)が軸に沿った矩形なら {x0,y0,x1,y1}(mm) を返す。
// 回した階段は矩形にならないので null を返し、呼び出し側は従来の穴の経路へ落ちる。
function polyAsAxisRectMm(poly){
  if(!poly||poly.length!==4) return null;
  var xs=poly.map(function(p){return p.x;}), zs=poly.map(function(p){return p.z;});
  var x0=Math.min.apply(null,xs), x1=Math.max.apply(null,xs);
  var z0=Math.min.apply(null,zs), z1=Math.max.apply(null,zs);
  var eps=0.001;
  for(var i=0;i<4;i++){
    var p=poly[i];
    if(Math.abs(p.x-x0)>eps&&Math.abs(p.x-x1)>eps) return null;
    if(Math.abs(p.z-z0)>eps&&Math.abs(p.z-z1)>eps) return null;
  }
  if(x1-x0<eps||z1-z0<eps) return null;
  return {x0:Math.round(x0/U),y0:Math.round(z0/U),x1:Math.round(x1/U),y1:Math.round(z1/U)};
}
// ── 柱 ────────────────────────────────────────────────────────────────────
// 角柱(column)と円柱(column-round)。スキップフロアの段差の下を開けたまま
// 持たせるためのものだが、使い道はそれに限らない(下屋・ポーチ・大開口の中間柱)。
// 高さは既定 2400。段差の下へ置いたときは、置いた場所の段差の高さへ合わせる
// (placeItem が書き込む) -- 毎回入力させるようなものではない。
function columnHeightMm(it){
  var n=Number(it&&it.columnHeight);
  return (isFinite(n)&&n>0)?Math.max(100,Math.min(6000,Math.round(n))):2400;
}
function isColumnType(t){ return t==='column'||t==='column-round'; }
// ── 造作棚 ────────────────────────────────────────────────────────────────
// 「その場で作り付けた棚」である。実物と同じく、壁に付けば壁が棚板を支えるので
// 縦板は要らず、何も無いところに置けば両端に縦板を立てないと棚板が落ちる。
//
// **どちらにするかは利用者が決める。** 置いた場所から自動で判定もするが、
// 「背面が壁の面から 140mm 以内で、幅方向が壁と15度以内で平行」という条件は
// 回転や反転を掛けた棚では当てるのが難しく、自動だけにすると
// 「縦板の無い棚が作れない」状態になる。既定は自動、明示があればそちらが勝つ。
var SHELF_BOARD_T_MM=25;
// 'auto'(既定) | 'none' 縦板なし(壁が支える) | 'both' 両端に縦板
function shelfSideBoards(it){
  var v=it&&it.shelfSides;
  if(v==='none'||v==='both') return v;
  return shelfIsWallSupported(it)?'none':'both';
}
function shelfBoardCount(it){
  var n=Number(it&&it.shelfCount);
  return (isFinite(n)&&n>=1)?Math.min(8,Math.round(n)):3;
}
function shelfHeightMm(it){
  var n=Number(it&&it.shelfHeight);
  return (isFinite(n)&&n>0)?Math.max(150,Math.min(2700,Math.round(n))):900;
}
// 背面が同じ階の壁に接しているか。接していれば壁が棚板を支える(縦板なし)。
// 「接している」は、背面の中央が壁の面から 140mm 以内で、かつ棚の幅方向が
// 壁とほぼ平行(15度以内)であること。斜めに突き刺さった棚を壁付け扱いすると、
// 支えの無い板が宙に浮く。
function shelfIsWallSupported(it){
  if(!it||typeof DATA==='undefined'||!DATA||!DATA.walls) return false;
  var rad=(Number(it.rot)||0)*Math.PI/180;
  var cos=Math.cos(rad), sin=Math.sin(rad);
  var cx=(Number(it.x)||0)+(Number(it.w)||0)/2, cy=(Number(it.y)||0)+(Number(it.d)||0)/2;
  var backSign=it.flipY?1:-1;
  var half=(Number(it.d)||0)/2*backSign;
  var bx=cx-half*sin, by=cy+half*cos;
  for(var i=0;i<DATA.walls.length;i++){
    var w=DATA.walls[i];
    if(!w||(w.floor||1)!==(it.floor||1)) continue;
    var dx=w.x2-w.x1, dy=w.y2-w.y1, len=Math.sqrt(dx*dx+dy*dy);
    if(len<1) continue;
    var ux=dx/len, uy=dy/len;
    if(Math.abs(ux*cos+uy*sin)<0.966) continue;        // 15度以内で平行
    var t=((bx-w.x1)*ux+(by-w.y1)*uy)/len;
    if(t<-0.05||t>1.05) continue;                      // 壁の区間の外
    var px=w.x1+dx*Math.max(0,Math.min(1,t)), py=w.y1+dy*Math.max(0,Math.min(1,t));
    if(Math.hypot(bx-px,by-py)<=(Number(w.thick)||120)/2+140) return true;
  }
  return false;
}
// その階にある段差の最大値(mm)。壁の基準を「段差の上」と明示したときに使う
// -- 判定に当たらない置き方(部屋の外を通る壁など)でも段差から測れるように。
function floorMaxSkipLevelMm(floor){
  var rooms=(typeof DATA!=='undefined'&&DATA&&DATA.rooms)?DATA.rooms:null;
  if(!rooms) return 0;
  var f=floor||1, best=0;
  for(var i=0;i<rooms.length;i++){
    var r=rooms[i];
    if(!r||r.hidden3D||(r.floor||1)!==f) continue;
    var v=roomSkipLevelMm(r);
    if(v>best) best=v;
  }
  return best;
}
// この壁が接している部屋の段差の、最小値と最大値(mm)。
// サンプリングの仕方は wallAdjacentRoomsCeiling と同じにしてある。
// どちらの部屋にも面していない側は「段差なし(0)」として数える -- 外に面した
// 側があるなら、その壁は下まで下ろさないと足元に穴が開くからである。
function wallSkipLevelsMm(w){
  var out={min:0,max:0};
  if(!w||!floorHasSkipLevel(w.floor)) return out;
  var dx=w.x2-w.x1, dy=w.y2-w.y1;
  var len=Math.sqrt(dx*dx+dy*dy);
  if(len<1) return out;
  var nx=-dy/len, ny=dx/len;
  var off=Math.max((w.thick||120)/2+40,100);
  var lo=Infinity, hi=0, i, s, t, px, py, r, v;
  for(i=0;i<5;i++){
    t=(i+0.5)/5;
    px=w.x1+dx*t; py=w.y1+dy*t;
    for(s=-1;s<=1;s+=2){
      r=roomAtPointOnFloor(w.floor,px+nx*off*s,py+ny*off*s);
      v=r?roomSkipLevelMm(r):0;
      if(v<lo) lo=v;
      if(v>hi) hi=v;
    }
  }
  out.min=isFinite(lo)?lo:0;
  out.max=hi;
  return out;
}
// 壁の高さを測る基準(mm)。壁は2つの部屋の境界にあるので、
// 「どちらのレベルから測るか」を決める必要がある。
//
// 自動は**低い側**、つまり足元(wallSkipFootMm)と同じ。段差の上から測るのは、
// 壁の両側とも段差の上にあるときだけ。
//
// 以前は高い側を採っていた(段差の縁の手すり壁を段差の上から測るため)。
// しかし保存済みの壁はほぼ全部が高さを個別に持っていて、スキップフロアに
// 面した**ふつうの間仕切り壁**まで段差ぶん伸び、その上の2階の床を最大 1.8m
// 持ち上げていた(利用者のプランで実際に起きた)。自動が外れたときの壊れ方は、
// 低い側なら「手すりが低い」、高い側なら「上の階が浮く」。軽い方を既定にし、
// 手すり壁は 'skip' を選んで段差の上から測る。
//
// wall.baseLevel で明示できる: 'floor' は段差を無視して階の床から、
// 'skip' はその階の段差から。省略時は上の自動判定。
function wallSkipBaseMm(w){
  if(!w) return 0;
  var br=baseRoomOf(w);
  if(br) return roomSkipLevelMm(br);
  if(w.baseLevel==='floor') return 0;
  var lv=wallSkipLevelsMm(w);
  if(w.baseLevel==='skip') return Math.max(lv.max,floorMaxSkipLevelMm(w.floor));
  return lv.min;
}
// 壁の足元を持ち上げる量(mm)。
//
// **両側とも段差の上にあるときだけ持ち上げる。** 段差の下は中空なので、
// 持ち上げないと間仕切り壁が床下へ垂れ下がる。片側でも低いレベルに面して
// いれば下ろしたまま -- その壁は段差の蹴上げ面を兼ねており、持ち上げると
// 低い側の足元に穴が開く。
function wallSkipFootMm(w){
  if(!w) return 0;
  // 部屋を指したときは、足元もその床。段差の縁の手すり壁は段差の上に載る。
  var br=baseRoomOf(w);
  if(br) return roomSkipLevelMm(br);
  if(w.baseLevel==='floor') return 0;
  var lv=wallSkipLevelsMm(w);
  if(w.baseLevel==='skip') return Math.max(lv.max,floorMaxSkipLevelMm(w.floor));
  return lv.min;
}
// 壁の足元の上下(mm)。マイナスで床より下へ伸ばし(基礎の立ち上がり・下げた土間の
// 縁まで届かせる)、プラスで持ち上げる。**天端は動かない。** 利用者の指示:
// 「足元だけを上下する」。省略は 0 = 従来どおり。
function wallFootOffsetMm(w){
  var n=Number(w&&w.footOffsetMm);
  return isFinite(n)?Math.max(-3000,Math.min(2000,Math.round(n))):0;
}
// 上階の床が載る天端(m)。下階に「その階の既定より高い壁」が立っていると、
// その上に載る床はその壁の天端まで持ち上がる。
// 既定の高さのままの壁しか無い階では floorBaseY(floor) と完全に同値。
// 矩形は平面mm (x1,y1)-(x2,y2)。
function localSupportTopY(floor,x1,y1,x2,y2){
  var f=floor||1;
  var base=floorBaseY(f);
  if(f<=1) return base;
  var walls=(typeof DATA!=='undefined'&&DATA&&DATA.walls)?DATA.walls:null;
  if(!walls||!walls.length) return base;
  var below=f-1;
  var belowTop=floorBaseY(below)+floorSlabHeightMForFloor(below);
  var top=base;
  // 段差を使っていない階では、壁1本ごとに wallSkipBaseMm を呼ぶ必要がない。
  // 判定は階に1回で足りる。
  var skipBelow=floorHasSkipLevel(below);
  var lox=Math.min(x1,x2), hix=Math.max(x1,x2);
  var loy=Math.min(y1,y2), hiy=Math.max(y1,y2);
  for(var i=0;i<walls.length;i++){
    var w=walls[i];
    if((w.floor||1)!==below) continue;
    var v=Number(w.wallHeight);
    if(!isFinite(v)||v<=0) continue;
    // 段差の上に立つ壁は、その段差ぶん高いところで天端を迎える。これを足さないと
    // 「スキップフロアの上に立てた壁」が下階の床から測られ、その上に載るはずの
    // 2階の床が段差ぶん低いままになる (= 段差の天井を突き抜ける)。
    var t=belowTop+((skipBelow?wallSkipBaseMm(w):0)+Math.max(300,Math.min(6000,v)))*U;
    if(t<=top+1e-9) continue;
    // 壁の芯線が対象矩形(壁厚の半分だけ広げたもの)の中を通る長さ。
    // 角で1点触れているだけの壁は床を支えないので、広げたぶんより長く
    // 重なっているものだけを支持とみなす。
    var half=Math.max(0,(Number(w.thick)||120)/2);
    var span=segmentInsideRectLengthMm(w.x1,w.y1,w.x2,w.y2,lox-half,loy-half,hix+half,hiy+half);
    if(span<=half+1) continue;   // +1mm は丸め誤差のぶん
    top=t;
  }
  return top;
}
// 壁の足元(m)。壁は原則としてその階の床スラブ下端 floorBaseY から立てる
// (段差の蹴上げ面を兼ねるので、下ろさないと低い側に穴が開く)。
// 例外は「芯線の**全体**が、より高い支持の上に載っている壁」で、この壁は
// その持ち上がった床から立てる。一部しか載っていない壁を持ち上げると、
// 載っていない側に穴が開く -- wallStackedAboveCapM が「全部覆われているときだけ
// 切る」のと同じ理由である。
// 下階に高い壁が無い家では localSupportTopY が floorBaseY をそのまま返すので、
// この関数は floorBaseY と完全に同値になる。
function wallBaseSupportY(w){
  var fl=(w&&w.floor)||1;
  var base=floorBaseY(fl);
  if(!w) return base;
  if(fl<=1) return base+wallSkipFootMm(w)*U;
  var dx=w.x2-w.x1, dy=w.y2-w.y1, len=Math.sqrt(dx*dx+dy*dy);
  if(len<1) return base;
  var nx=-dy/len, ny=dx/len;
  var off=Math.max((w.thick||120)/2+40,100);
  // まず「この階のどこかに持ち上がった支持があるか」を1回だけ測る。
  // 座標の全域を渡すと localSupportTopY は下階の全ての壁を見るので、その結果は
  // どの部屋・どの点の値よりも必ず大きいか等しい。ここで持ち上がりが無ければ、
  // 点ごとに測り直す必要は無い(下階に高い壁が無い家 = 保存済みのほぼ全部は、
  // ここで帰る)。範囲は PlanSchema.LIMITS.COORD_MM と同じ「座標の限界」。
  var ANY=1000000;
  if(localSupportTopY(fl,-ANY,-ANY,ANY,ANY)<=base+1e-9) return base+wallSkipFootMm(w)*U;
  // 壁が実際に載るのは**床スラブ**なので、支持はその点を含む部屋の矩形で測る
  // (点だけで測ると、下階の壁の真上にしか支持が無いことになり、同じ部屋の中で
  // 壁の足元が床から外れる)。壁は2部屋の境界にあるので両側を見て、
  // **低い方**を採る。高い方に合わせると低い側に穴が開く。
  function supportAt(px,py){
    var r=roomAtPointOnFloor(fl,px,py);
    return r ? localSupportTopY(fl,r.x,r.y,r.x+r.w,r.y+r.d)
             : localSupportTopY(fl,px,py,px,py);
  }
  var minTop=Infinity, i, s, t, px, py, v;
  for(i=0;i<=8;i++){
    t=i/8;
    px=w.x1+dx*t; py=w.y1+dy*t;
    for(s=-1;s<=1;s+=2){
      v=supportAt(px+nx*off*s,py+ny*off*s);
      if(v<minTop) minTop=v;
    }
  }
  var top=(isFinite(minTop)&&minTop>base+1e-9)?minTop:base;
  // 同じ階の段差の上に立つ壁は、そのぶんも足元が上がる。
  return top+wallSkipFootMm(w)*U;
}
// 壁が floorBaseY からどれだけ持ち上がって立つか(mm)。
// 同じ階の段差の上に立つ (wallSkipBaseMm) か、下階の高い壁に載っている
// (wallBaseSupportY) かのどちらか高い方。どちらも無ければ 0。
function wallLiftMm(w){
  if(!w) return 0;
  var byFloorBelow=Math.round((wallBaseSupportY(w)-floorBaseY(w.floor||1))/U);
  var bySkip=wallSkipBaseMm(w);
  var v=Math.max(0,byFloorBelow,bySkip);
  return isFinite(v)?v:0;
}
// 線分が軸平行矩形の内側を通る長さ(mm)。Liang-Barsky。
function segmentInsideRectLengthMm(x1,y1,x2,y2,rx0,ry0,rx1,ry1){
  var dx=x2-x1, dy=y2-y1;
  var t0=0, t1=1, i, p, q, r;
  for(i=0;i<4;i++){
    p=(i===0)?-dx:(i===1)?dx:(i===2)?-dy:dy;
    q=(i===0)?(x1-rx0):(i===1)?(rx1-x1):(i===2)?(y1-ry0):(ry1-y1);
    if(p===0){ if(q<0) return 0; continue; }
    r=q/p;
    if(p<0){ if(r>t1) return 0; if(r>t0) t0=r; }
    else { if(r<t0) return 0; if(r<t1) t1=r; }
  }
  if(t1<=t0) return 0;
  return Math.sqrt(dx*dx+dy*dy)*(t1-t0);
}
function roomFloorTopY(room){
  if(!room) return 0;
  return localSupportTopY(room.floor,room.x,room.y,room.x+room.w,room.y+room.d)
    +floorSlabHeightMForFloor(room.floor)+(roomSkipLevelMm(room)+roomFloorOffsetMm(room))*U;
}
// 段差の**下**(= その階の構造床の天端)。段差の下の空間に物を置くときの基準で、
// 段差を持たない部屋では roomFloorTopY と同値 (床上げは仕上げなので含めない)。
function roomStoreyFloorTopY(room){
  if(!room) return 0;
  return localSupportTopY(room.floor,room.x,room.y,room.x+room.w,room.y+room.d)
    +floorSlabHeightMForFloor(room.floor);
}
function roomFloorAt(floor,x,y){
  // 重なった部屋の選び方は roomsAtPointOnFloor の1か所で決める。
  var room=roomAtPointOnFloor(floor,x,y);
  if(room) return roomFloorTopY(room);
  return localSupportTopY(floor,x,y,x,y)+floorSlabHeightMForFloor(floor);
}
// 段差の**下**の床(m)。roomFloorAt と同じ部屋の選び方で、段差と床上げだけを足さない。
// 段差を持たない場所では roomFloorAt と (床上げを除いて) 同じ値になる。
function roomStoreyFloorAt(floor,x,y){
  var room=roomAtPointOnFloor(floor,x,y);
  if(room) return roomStoreyFloorTopY(room);
  return localSupportTopY(floor,x,y,x,y)+floorSlabHeightMForFloor(floor);
}
// このアイテムが「段差の下」に置かれているか。
function itemIsUnderPlatform(it){
  return !!(it&&it.baseLevel==='under');
}
// ── 載せる床 (家具・壁・階段で共通) ─────────────────────────────────────
// 段差のある階で、物がどの床に載るかを明示する受け口。
//   obj.baseRoom = 部屋のid  … その部屋の床に載る。**部屋で覚える**ので、
//                              あとで段差の高さを変えても物がついてくる。
//   obj.baseLevel = 'floor'  … 段差を無視して階の床に載る。
//   obj.baseLevel = 'under'  … 段差の下(床下の空間)。家具だけ。
//   obj.baseLevel = 'skip'   … 以前の指定(その階でいちばん高い段差)。読むだけ。
//   どれも無ければ自動。
// 指した部屋が消えた・別の階に移った・隠したときは、自動に戻る。
function baseRoomOf(obj){
  if(!obj||obj.baseRoom===undefined||obj.baseRoom===null) return null;
  if(typeof DATA==='undefined'||!DATA||!DATA.rooms) return null;
  var fl=obj.floor||1;
  for(var i=0;i<DATA.rooms.length;i++){
    var r=DATA.rooms[i];
    if(r&&String(r.id)===String(obj.baseRoom)&&(r.floor||1)===fl&&!r.hidden3D) return r;
  }
  return null;
}
// その点の、段差を持たない部屋(= 階の床)。段差の部屋しか無ければ null。
function floorRoomIgnoringSkip(floor,x,y){
  var list=roomsAtPointOnFloor(floor,x,y);
  for(var i=0;i<list.length;i++) if(roomSkipLevelMm(list[i])<=0) return list[i];
  return null;
}
// 「載せる床」の選択肢になる、その階の段差の部屋(低い順)。
function skipRoomsOnFloor(floor){
  if(typeof DATA==='undefined'||!DATA||!DATA.rooms) return [];
  var f=floor||1;
  return DATA.rooms.filter(function(r){
    return r&&!r.hidden3D&&(r.floor||1)===f&&roomSkipLevelMm(r)>0;
  }).sort(function(a,b){return roomSkipLevelMm(a)-roomSkipLevelMm(b);});
}
// 選択肢と読み上げに使う部屋の呼び名。同じ名前の段差が並ぶことがある
// (利用者のプランでは「スキップ」が3つ)ので、段差と大きさを添える。
function baseRoomLabel(r){
  if(!r) return '';
  var name=(r.n&&String(r.n).trim())||'部屋';
  return name+' ＋'+roomSkipLevelMm(r)+'（'+Math.round(r.w)+'×'+Math.round(r.d)+'）';
}
function updateSelectedRoomFloor(value){
  var r=ST.selected;if(!r||r.type!=='room')return;
  if(isObjectLocked(r)){updateProps();return;}
  var n=Number(value);if(!Number.isFinite(n))return;
  saveState();
  // 床上げでは天井は動かないので、天井からの下がりを保つ = 世界での高さを保つ。
  // 意図して下げたペンダントもそのまま。追従の規則は followRoomCeiling の1か所。
  followRoomCeiling(r,function(){
    // 高さモデルv2では床を**下げ**られる(床厚の中、仕上げの残り20mmまで)。
    // 下の階の折り上げ天井とぶつかる場合は、その分だけ下げ幅を戻す。
    var minimum=typeof usesFinishedHeightModel==='function'&&usesFinishedHeightModel()
      ? -Math.max(0,floorSlabMmForFloor(r.floor)-20) : 0;
    var candidate=Math.max(minimum,Math.min(600,n));
    if(typeof CeilingDesigner!=='undefined'&&CeilingDesigner.floorLoweringLimit)
      candidate=Math.max(candidate,CeilingDesigner.floorLoweringLimit(r));
    r.floorRaiseMm=candidate;
  });
  markDirty();updateProps();draw2d();if(ren)rebuild3D();
}
// スキップフロアの段差を変える。床上げ(updateSelectedRoomFloor)と違うのは、
// **明示された天井高を持つ部屋では天井も一緒に上がる**ことである。だから
// 天井付きの器具(照明・物干し)の補正量は「床の上がり」ではなく
// 「天井の上がりとの差」で決める。天井が同じだけ上がれば補正は 0 になる。
function updateSelectedRoomSkipLevel(value){
  var r=ST.selected;
  if(!r||r.type!=='room') return;
  if(isObjectLocked(r)){updateProps();return;}
  var n=Number(value);
  if(!Number.isFinite(n)) return;
  if(typeof saveState==='function') saveState();
  // 段差では床も天井も動く。天井付けの器具は天井からの下がりを保つ
  // (天井が同じだけ上がれば動かない)。規則は followRoomCeiling の1か所。
  followRoomCeiling(r,function(){
    var v=Math.max(0,Math.min(SKIP_LEVEL_MAX_MM,Math.round(n/50)*50));
    if(v>0) r.skipLevelMm=v; else delete r.skipLevelMm;
  });
  markDirty();updateProps();draw2d();if(ren)rebuild3D();
}
// スキップフロアの欄。段差を持たない部屋にも出す -- 「ここから作れる」ことが
// 分からないと、床上げの 600mm 上限で詰まったまま終わる。
function selectedRoomSkipHtml(r){
  var v=roomSkipLevelMm(r);
  var cavity=roomSkipCavityMm(r);
  var html='<div class="ph" style="margin-top:12px">スキップフロア</div>'+
    '<div class="pr"><div class="pl">段差プリセット</div><select class="pi" onchange="updateSelectedRoomSkipLevel(this.value)">'+
    '<option value="0"'+(v===0?' selected':'')+'>なし（同じ床）</option>'+
    '<option value="400"'+(v===400?' selected':'')+'>小上がり ＋400mm</option>'+
    '<option value="800"'+(v===800?' selected':'')+'>＋800mm</option>'+
    '<option value="1200"'+(v===1200?' selected':'')+'>中2階 ＋1200mm</option>'+
    '<option value="1600"'+(v===1600?' selected':'')+'>＋1600mm</option>'+
    '</select></div>'+
    '<div class="pr"><label class="pl" for="room-skip-level">段差 (mm)</label><input id="room-skip-level" class="pi" type="number" min="0" max="'+SKIP_LEVEL_MAX_MM+'" step="50" value="'+v+'" onchange="updateSelectedRoomSkipLevel(this.value)"></div>';
  if(v===0){
    html+='<div class="lock-status-note">床上げ（上の欄）は天井の位置を変えない仕上げの段差です。こちらは床も天井も一緒に持ち上がります。'+
      '天井高を指定していない部屋では天井は動かないので、段差を付けたら天井高も入れてください。</div>';
  }else{
    html+='<div class="lock-status-note">この部屋の床は ＋'+v+'mm。天井高・家具・建具・歩行高さがこの床を基準にします。現在の天井高は '+roomRenderedCeilingMm(r)+'mm です。'+
      (cavity>0
        ? '床下 '+cavity+'mm ぶんは空間として開きます（低いレベルに面した側だけ開口）。造作棚を置いて収納にしてください。'
        : '床下は '+SKIP_CAVITY_MIN_MM+'mm 未満なので中身の詰まった段差として描きます。')+
      '段差の上り下りには、階段の「行き先」を「同じ階の段差」にした階段を置いてください。</div>';
  }
  return html;
}
// ── 「載せる床」の欄 (家具・建具・壁・階段で共通) ─────────────────────────
// 段差のある階でだけ出す。選択肢も説明も種類をまたいで同じにする:
// 自動(いま何を選んでいるかを添える) / 階の床 / その階の段差の部屋 / 段差の下。
function baseFloorKindOf(it){
  if(!it) return null;
  if(it.x1!==undefined&&it.x2!==undefined) return 'wall';
  if(typeof isStairPartType==='function'&&isStairPartType(it.type)) return 'stair';
  if(it.type==='room') return null;
  return 'item';
}
function baseFloorChoiceOf(it){
  if(baseRoomOf(it)) return 'room:'+baseRoomOf(it).id;
  if(it.baseLevel==='floor'||it.baseLevel==='under'||it.baseLevel==='skip') return it.baseLevel;
  return 'auto';
}
// 自動がいま選んでいる床の呼び名。
function baseFloorAutoLabel(it,kind){
  var fl=it.floor||1;
  function named(r){
    if(!r) return '階の床';
    return roomSkipLevelMm(r)>0 ? baseRoomLabel(r)+' の床' : '階の床（'+((r.n&&String(r.n).trim())||'部屋')+'）';
  }
  if(kind==='wall'){
    var lv=wallSkipLevelsMm(it);
    return lv.min>0 ? '段差の上（＋'+lv.min+'）' : '階の床';
  }
  if(kind==='stair'){
    var ends=stairRunEndsMm(it);
    if(stairGroupIsLevel(it)){
      var sp=stairLevelSpanM(it);
      var lowAt=sp.reversed?ends.up:ends.down;
      return named(roomAtPointOnFloor(fl,lowAt.x,lowAt.y));
    }
    return named(roomAtPointOnFloor(fl,ends.down.x,ends.down.y));
  }
  var cx=(it.x||0)+(it.w||0)/2, cy=(it.y||0)+(it.d||0)/2;
  return named(roomAtPointOnFloor(fl,cx,cy));
}
function baseFloorSelectHtml(it){
  var kind=baseFloorKindOf(it);
  if(!kind||!floorHasSkipLevel(it.floor||1)) return '';
  var cur=baseFloorChoiceOf(it);
  var rooms=skipRoomsOnFloor(it.floor||1);
  var cx=(it.x||0)+(it.w||0)/2, cy=(it.y||0)+(it.d||0)/2;
  var canUnder=(kind==='item') && (it.baseLevel==='under' || roomSkipCavityMm(roomAtPointOnFloor(it.floor,cx,cy))>0);
  function opt(v,label){ return '<option value="'+v+'"'+(cur===v?' selected':'')+'>'+label+'</option>'; }
  var html='<div class="ph" style="margin-top:12px">スキップフロア</div>'+
    '<div class="pr"><div class="pl">載せる床</div><select class="pi" onchange="updateSelectedBaseFloor(this.value)">'+
    opt('auto','自動')+
    opt('floor','階の床');
  rooms.forEach(function(r){ html+=opt('room:'+r.id,baseRoomLabel(r)); });
  if(canUnder) html+=opt('under','段差の下（床下の空間）');
  if(cur==='skip') html+=opt('skip','いちばん高い段差（以前の指定）');
  html+='</select></div>';
  var note;
  if(cur==='auto'){
    note=({
      item:'自動は、物の中心がある部屋の床に載せます。部屋が重なっているところでは、小さい部屋を優先します。',
      wall:'自動では、両側とも段差の上にある壁だけが段差の上から立ちます。段差の境の壁は階の床から測ります（上の階が持ち上がらないように）。段差の縁の手すり壁・腰壁は、段差の部屋を選んでください。',
      stair:stairGroupIsLevel(it)
        ? '自動は、階段の両端の先にある床を見て、低い方から高い方へ上ります。'
        : '自動は、階段の下端の先にある床から始めます。'
    })[kind];
  }else if(cur.indexOf('room:')===0){
    note='この部屋の床に載せています。段差の高さを変えると一緒に動きます。部屋を消すと自動に戻ります。';
    if(kind==='stair') note+='1本の階段（つながった部材）全体に効きます。';
  }else if(cur==='under'){
    note='段差の下の空間（その階の構造床）に置いています。';
  }else if(cur==='floor'){
    note='段差を無視して、階の床に載せています。';
  }else{
    note='以前の指定です。段差が複数ある階では、いちばん高い段差になります。部屋を選び直すことを勧めます。';
  }
  // いま載っている床を、選んだ方法によらず必ず先頭に書く。
  var now;
  if(cur==='auto') now='いまは '+baseFloorAutoLabel(it,kind)+' に載っています（自動）。';
  else if(cur.indexOf('room:')===0) now='いまは '+baseRoomLabel(baseRoomOf(it))+' の床に載っています（指定）。';
  else if(cur==='under') now='いまは 段差の下 に置いています（指定）。';
  else if(cur==='floor') now='いまは 階の床 に載っています（指定）。';
  else now='いまは いちばん高い段差 に載っています（以前の指定）。';
  return html+'<div class="lock-status-note"><b>'+now+'</b>'+note+'</div>';
}
// 「載せる床」を変える。階段は1本の階段全体で1つの指定なので、
// つながった部材の指定をまとめて置き換える。
function updateSelectedBaseFloor(value){
  var it=ST.selected;
  if(!it) return;
  if(isObjectLocked(it)){ updateProps(); return; }
  var kind=baseFloorKindOf(it);
  if(!kind) return;
  if(typeof saveState==='function') saveState();
  // 変える前に、何かの天板に載っていたか(高さ Z がその天板の高さと一致するか)。
  var canElev=kind==='item'&&typeof canSetItemElevation==='function'&&canSetItemElevation(it)&&!isLightItemType(it.type);
  var wasOn=canElev?findDefaultPlacementSurface(it):null;
  var sat=!!(wasOn&&Math.abs((Number(it.elev)||0)-wasOn.top)<=1);
  var targets=[it];
  if(kind==='stair') targets=getConnectedStairParts(it);
  targets.forEach(function(o){ delete o.baseRoom; delete o.baseLevel; });
  var v=String(value||'auto');
  if(v.indexOf('room:')===0) it.baseRoom=v.slice(5);
  else if(v==='floor'||v==='skip'||(v==='under'&&kind==='item')) it.baseLevel=v;
  // 棚や机の天板に載っていた物は、床を選び直したら新しい床で載せ直す(天板が
  // 無くなれば床に置く)。天板の高さのまま残すと、床を変えた瞬間に宙に浮く。
  // 天板に載っていなかった物の高さ Z は、利用者が決めた値なので触らない
  // (マイナスで床より下げて置くこともできる)。
  if(canElev&&sat){
    var surface=findDefaultPlacementSurface(it);
    it.elev=surface?Math.max(-5000,Math.min(10000,Math.round(surface.top))):0;
  }
  markDirty(); updateProps(); draw2d(); if(ren) rebuild3D();
}
function selectedRoomFloorHtml(r){
  var v=roomFloorOffsetMm(r);
  return '<div class="ph" style="margin-top:12px">床の高さ</div>'+
    '<div class="pr"><div class="pl">仕上げ床</div><select class="pi" onchange="if(this.value)updateSelectedRoomFloor(this.value)">'+
    '<option value="">プリセットを選択</option><option value="0">玄関土間・既存基準 ＋0mm</option><option value="150">室内床 ＋150mm</option><option value="150">浴室（室内と段差なし）＋150mm</option></select></div>'+
    '<div class="pr"><label class="pl" for="room-floor-raise">床の上下 (mm)</label><input id="room-floor-raise" class="pi" type="number" min="'+(typeof usesFinishedHeightModel==='function'&&usesFinishedHeightModel()?-(floorSlabMmForFloor(r.floor)-20):0)+'" max="600" step="5" value="'+v+'" onchange="updateSelectedRoomFloor(this.value)"></div>'+
    '<div class="lock-status-note">この階の標準床面を0mmとして指定。正は床上げ、負は床下げ（床厚内・残り20mmまで）。家具・建具・歩行高さが追従します。浴室の段差は製品仕様に合わせて調整してください。天井の位置は固定です。</div>';
}
var CONTEXT_EXTERIOR_TYPES = {'neighbor-building':1,'neighbor-house':1,road:1,'utility-pole':1};
function isContextExteriorItemType(type){
  return !!CONTEXT_EXTERIOR_TYPES[type];
}
function shouldRenderItemInCurrent3DView(it){
  if(!it) return false;
  if(isInt&&typeof CeilingDesigner!=='undefined'&&CeilingDesigner.active()&&!CeilingDesigner.fixture(it)&&!CeilingDesigner.zone(it))return false;
  if(isInt && isContextExteriorItemType(it.type)) return false;
  return true;
}
// 外構系オブジェクト: 1階配置時も床・基礎の厚み分を足さず地面(GL)に接地させる
function isGroundLevelItemType(t){
  var model=getFmpItem(t);if(model&&model.groundLevel) return true;
  return t==='site-rect' || t==='foundation' || t==='exterior-stair' || t==='ramp' ||
    t==='ac-outdoor' || t==='water-heater' || t==='meter-box' || t==='sewer-pit' ||
    t==='downspout' || t==='gas-heater' ||
    t==='car' || t==='bicycle' || t==='bicycle-fold' || t==='tree' ||
    t==='fence' || t==='wood-fence' || t==='lattice-screen';
}
// 塀・フェンス・車などはバルコニーの手すり代わり等で2階以上にも置かれるため、
// 接地(GL=0)は1階配置のときだけ。上階ではその階の床天端に置く
function isFloorAwareGroundItemType(t){
  return t==='car' || t==='bicycle' || t==='bicycle-fold' || t==='tree' ||
    t==='fence' || t==='wood-fence' || t==='lattice-screen';
}
// 敷地サーフェス(site-rect)の描画面は GL より 35mm 下(build3DSiteRect)。
// その上に立つ接地アイテムを GL=0 に置くと 35mm 浮いて見えるので、
// 中心が敷地サーフェス上にあるものは面の高さへ接地させる。
// 敷地サーフェスの描画面。素地グラウンド(-0.06)とZファイティングしない範囲で
// GL に寄せる。ここを下げすぎると基礎やポーチの脚元に隙間が見える
var SITE_SURFACE_Y = -0.012;
// アイテムの中心が基礎(=建物が載る土台)の上にあるか。屋内/屋外の判定に使う
function itemOnFoundation(it){
  if(!it || !DATA || !DATA.items) return false;
  var cx=it.x+(it.w||0)/2, cy=it.y+(it.d||0)/2;
  var any=false, on=false;
  DATA.items.forEach(function(f){
    if(f.type!=='foundation' || (f.floor||1)!==1) return;
    any=true;
    if(cx>=f.x && cx<=f.x+f.w && cy>=f.y && cy<=f.y+f.d) on=true;
  });
  return any ? on : true;   // 基礎を置いていないプランは従来どおり床レベル
}
function groundYForItem(it){
  if(it.type==='site-rect' || it.type==='foundation') return 0;
  var cx=it.x+(it.w||0)/2, cy=it.y+(it.d||0)/2;
  var on=DATA.items.some(function(s){
    return s.type==='site-rect' && (s.floor||1)===1 &&
      cx>=s.x && cx<=s.x+s.w && cy>=s.y && cy<=s.y+s.d;
  });
  return on?SITE_SURFACE_Y:0;
}
// 壁に開く建具・窓か。開口は壁の中に中心があるので、床の決め方が家具と違う。
function isWallOpeningItem(it){
  if(!it) return false;
  if(it.type==='window'||it.type==='window-door') return true;
  return typeof isDoorLikeOpeningType==='function' && isDoorLikeOpeningType(it.type);
}
// 開口が面している部屋の床(m)。両側を見て高いほうを採る。
// **高いほうを採るのは、敷居は室内側の床に合わせるから。** 片側が屋外なら
// 室内側だけが見つかる。どちらにも部屋が無ければ null。
function openingAdjacentFloorTopY(it){
  var cx=(it.x||0)+(it.w||0)/2, cy=(it.y||0)+(it.d||0)/2;
  var along=Math.round(Number(it.rot)||0)%180;   // 0=X方向に開く / 90=Y方向
  var step=Math.max(((it.d||0)/2)+200,260);      // 壁の外まで確実に出る距離
  var pts=(along===0)?[[cx,cy-step],[cx,cy+step]]:[[cx-step,cy],[cx+step,cy]];
  var best=null,i,room,y;
  for(i=0;i<pts.length;i++){
    room=roomAtPointOnFloor(it.floor,pts[i][0],pts[i][1]);
    if(!room) continue;
    y=roomFloorTopY(room);
    if(best===null||y>best) best=y;
  }
  return best;
}
function item3DBaseY(it){
  if(!it) return 0;
  if(isGroundLevelItemType(it.type) || isContextExteriorItemType(it.type)){
    if(isFloorAwareGroundItemType(it.type)){
      // 部屋の中に置かれたものは、その部屋の床に立つ(段差の上を含む)。
      // 格子柵をスキップフロアの手すりに使うには、地面ではなく床が基準になる。
      var fr=roomAtPointOnFloor(it.floor,(it.x||0)+(it.w||0)/2,(it.y||0)+(it.d||0)/2);
      if(fr) return roomFloorTopY(fr);
      if((it.floor||1)>1) return floorTopY(it.floor);
    }
    return groundYForItem(it);
  }
  if(it.type==='roof') return localSupportTopY(it.floor,it.x,it.y,it.x+(it.w||0),it.y+(it.d||0));
  // 載せる床を明示したもの(部屋 / 階の床)。建具もここを通る -- 段差の境の
  // ドアの敷居をどちらの床に合わせるかは、自動では決めきれない。
  // 階段は階段グループとして決めるので、下の階段の経路に任せる。
  var isStair=(typeof isStairPartType==='function'&&isStairPartType(it.type));
  if(!isStair){
    var br=baseRoomOf(it);
    if(br) return roomFloorTopY(br);
    if(it.baseLevel==='floor'){
      var fcx=(it.x||0)+(it.w||0)/2, fcy=(it.y||0)+(it.d||0)/2;
      var fr0=floorRoomIgnoringSkip(it.floor,fcx,fcy);
      return fr0 ? roomFloorTopY(fr0) : roomStoreyFloorAt(it.floor,fcx,fcy);
    }
  }
  // **壁の開口は、地面に置く物ではない。** 中心が壁の中に来るので、基礎の
  // 外周をわずかに越えることがあり、下の「基礎の外なら地面」に捕まると
  // 基礎の高さぶん落ちる。部屋の矩形も壁の芯で終わるので、越えた瞬間に
  // 床上げもスラブも失う。
  //
  // **3階建ての既定プランの掃き出し窓が、これで792mm沈んで基礎の中にいた。**
  // ずれは10mm(部屋の南端8190に対し、窓の中心が8200)。10mmで780mm落ちる。
  // 目で見ないと分からない壊れ方で、寸法の検査には出ない。
  // **面している部屋が見つかったときだけ介入する。** 全ての開口を横取りすると、
  // 建物の外に置いた物置のドアのような「部屋に面していない開口」まで
  // 床の高さへ持ち上げてしまい、地面から630mm浮く(実測で確認した)。
  if(isWallOpeningItem(it)
     && !roomAtPointOnFloor(it.floor,(it.x||0)+(it.w||0)/2,(it.y||0)+(it.d||0)/2)){
    var sideY=openingAdjacentFloorTopY(it);
    if(sideY!==null) return sideY;
  }
  // ここから下は従来どおり。中心が部屋の中にある開口も、どこにも面していない
  // 開口も、これまでと同じ経路を通る。
  // 1階に置いた一般アイテムでも、基礎の外(=屋外)にあるものは地面に置く。
  // 床レベルに置くと基礎高さぶん宙に浮き、ポーチ・デッキ・アプローチ・門柱が
  // 「地面から浮いた謎の矩形」になる
  if((it.floor||1)===1 && !itemOnFoundation(it)) return groundYForItem(it);
  // 階段の足元は、階段グループとして1か所で決める(stairLevelSpanM /
  // stairUpperSpanM)。パーツの中心から採ると、段差の上から始まる階段が
  // footprint の中心のはみ出しだけで低い側から始まってしまう。
  if(typeof isStairPartType==='function'&&isStairPartType(it.type)){
    if(stairGroupIsLevel(it)) return stairLevelSpanM(it).baseY;
    return stairUpperSpanM(it).baseY;
  }
  // 段差の下に置くと宣言されたものは、持ち上がった床ではなくその階の構造床へ。
  // 造作棚を段差の下の空間に入れるための経路である。
  if(itemIsUnderPlatform(it))
    return roomStoreyFloorAt(it.floor,(it.x||0)+(it.w||0)/2,(it.y||0)+(it.d||0)/2);
  return roomFloorAt(it.floor,(it.x||0)+(it.w||0)/2,(it.y||0)+(it.d||0)/2);

}
// 外皮としての壁の高さ(m)。部屋ではなく「その階の壁」の高さ = 階高まで。
// ここを下げると外壁と上階の床のあいだが外から素通しになるので、下限として使う。
function wallFullHeightM(floor){
  return Math.max(defaultWallHeightMmForFloor(floor)*U+floorSlabHeightMForFloor(floor),storyHeightM(floor));
}
function isPositiveNumber(v){
  return typeof v==='number'&&isFinite(v)&&v>0;
}
// 部屋に「明示された」天井高(mm)。指定が無ければ null を返す。
// 保存済みプランは高さフィールドを持たないので必ず null になり、天井は従来どおり
// 階高いっぱいに置かれる = 既存ユーザーの家の寸法が1mmも動かない。
// 正の数値だけを指定ありとみなす(HeightModel の num() と同じ門。null や 0 や
// 文字列は既定へ落ちるので、ここで拾うと逆に家が変わってしまう)。
// ── 吹き抜け (ceiling.type==='void') ───────────────────────────────────
// 吹き抜けとは「上階の床を張らず、天井を上の階の天井まで通す」ことである。
// 高さを数値で書かせてはならない。階高・床スラブ・階数から決まる値なので、
// 手で計算すると階高を変えた瞬間に上階の天井と食い違い、スラブの小口が
// 室内に見える(実際、最初の実装は 5280 と手で書いて 120mm 低かった)。
function roomVoidTargetFloor(room){
  var from=(room&&room.floor)||1;
  var raw=Number(room&&room.ceiling&&room.ceiling.toFloor);
  var to=isFinite(raw)?Math.round(raw):from+1;
  return Math.max(from+1,to);
}
function roomIsVoidCeiling(room){
  return !!(room&&room.ceiling&&room.ceiling.type==='void');
}
// 吹き抜けの天井高(mm)。床スラブ下端から目標階の天井までを直接算出する。
// 明示した通常天井の床仕上げ面基準とは異なり、呼び出し側でスラブを足さない。
function roomVoidCeilingMm(room){
  var from=(room&&room.floor)||1, to=roomVoidTargetFloor(room);
  // **床スラブ下端(floorBaseY)からの高さ**を返す。roomCeilingHeightM の
  // 他の枝(平天井・勾配)と基準を揃えるため。ここで床スラブを引いてしまうと
  // 「床仕上げ面からの高さ」になり、呼び出し側 ceilingFinishElevationMm が
  // もう一度スラブを引くので二重に引かれる。1階の吹き抜けはスラブ0mmなので
  // 症状が出ず、2階以上に吹き抜けを作った瞬間に天井が180mm下がる。
  return Math.round((floorBaseY(to)+storyHeightM(to)-floorBaseY(from))/U);
}
// 吹き抜けが成立するか。自分と目標階の間の **全ての階** で、この部屋の足元の
// 上に部屋が無いこと。直上階だけを見ると2層以上の吹き抜けが作れない。
function roomVoidFloorsAreOpen(room){
  if(!room||typeof DATA==='undefined'||!DATA||!DATA.rooms) return false;
  var from=(room.floor||1), to=roomVoidTargetFloor(room), i, r;
  for(i=0;i<DATA.rooms.length;i++){
    r=DATA.rooms[i];
    if(!r||r===room||r.hidden3D) continue;
    var f=(r.floor||1);
    if(f<=from||f>to) continue;
    if(roomsOverlapInPlan(room,r)) return false;
  }
  return true;
}
// 吹き抜けが作れない理由。作れるなら空文字を返す(黙って平らにしない)。
function roomVoidBlockReason(room){
  if(!room) return '';
  var from=(room.floor||1), to=roomVoidTargetFloor(room), i, r;
  for(i=0;i<((DATA&&DATA.rooms)||[]).length;i++){
    r=DATA.rooms[i];
    if(!r||r===room||r.hidden3D) continue;
    var f=(r.floor||1);
    if(f<=from||f>to) continue;
    if(roomsOverlapInPlan(room,r)){
      return 'この部屋の上には'+roomDisplayLabel(r)+
        'が載っています。吹き抜けは上階の床を張らない形なので、抜きたい範囲の'+
        '上階から部屋を消してください(部屋がある限り床は張られます)。';
    }
  }
  return '';
}
function roomExplicitCeilingMm(room){
  if(!room||typeof HeightModel==='undefined'||!HeightModel) return null;
  var c=room.ceiling;
  if(c&&c.type==='void') return roomVoidCeilingMm(room);
  var sloped=!!(c&&c.type==='sloped');
  if(!sloped&&!isPositiveNumber(c&&c.heightMm)&&!isPositiveNumber(room.ceilingHeight)) return null;
  if(sloped){
    // 勾配天井そのものは Task 2c。ここでは高い側の高さで平らに置く。
    var shape=HeightModel.ceilingShape(DATA,room);
    if(shape&&isPositiveNumber(shape.highMm)) return shape.highMm;
  }
  return HeightModel.ceilingHeightMm(DATA,room);
}
// ── 屋根が天井を決める (Task 12-1) ──────────────────────────────────────
// 在来工法の勾配天井は「天井を吊るのをやめ、垂木の下端を仕上げ面にする」ことである。
// だから天井の勾配は屋根の勾配そのもので、独立に決めるものではない。天井面と屋根
// 下面の間隔は 垂木せい(45〜105mm) + 断熱材 + 通気層(30mm以上) で、実務では合計
// 200〜300mm。その中央値を既定とする。
var CEILING_UNDER_ROOF_OFFSET_MM=250;
// 天井面を屋根から導くのは **ceiling.type==='sloped' を宣言した部屋だけ**。
// 既存の部屋は屋根の下でも平天井(階高)として描かれてきたので、宣言していない
// 部屋まで屋根から導くと保存済みの家の天井が全戸で動く。
function roomDeclaresSlopedCeiling(room){
  return !!(room&&room.ceiling&&room.ceiling.type==='sloped');
}
// ── 勾配天井が成立する階 (Task 14) ──────────────────────────────────────
// 勾配天井は「天井を吊るのをやめ、屋根裏側へ抜ける」形である。だから上に床が
// 載っている階では作れない。3階建ての1階に勾配天井は無い -- そこにあるのは屋根
// ではなく2階の床だから。
//
// 「最上階」を **階番号の最大** で決めてはいけない。2階建てに平屋の下屋が付いた
// 家では、下屋(1階)の部屋の上には何も無いので勾配天井が成立する。判定は必ず
// **その部屋の真上に部屋があるか** で行う。部屋は床スラブそのもの
// (buildRoomFloorMeshes が部屋ごとにスラブを建てる)なので、部屋を見れば床を見た
// ことになる。部屋は回転を持たない(すべて軸平行の矩形)ので重なりは矩形交差でよい。
//
// 少しでも重なっていれば「上に部屋がある」とみなす。一部だけ覆われた部屋に勾配を
// 許すと、覆われた側で天井が上階の床を突き抜ける。
//
// ただし**壁の中に隠れる細い重なりは数えない。** 部屋の矩形は壁の芯で描くが、
// 手で描くと芯から数十mmずれる。重なりが細い帯(幅 60mm まで)で、その帯に沿って
// 壁が立っていれば、帯は壁の中に隠れ、上の床が天井を突き抜けて見えることはない。
// 1mm で数えていたときは、上階の部屋が 45〜49mm かかっているだけで階段室を
// 吹き抜けにできず、設定しても黙って平天井のままだった(利用者のプランで発生)。
// 壁の無いところの細い重なりは、従来どおり重なりとして数える(隠すものが無い)。
var ROOM_OVERLAP_EPS_MM=1;
var ROOM_OVERLAP_WALL_TOL_MM=60;
function roomsOverlapInPlan(a,b){
  var x0=Math.max(a.x,b.x), x1=Math.min(a.x+a.w,b.x+b.w);
  var y0=Math.max(a.y,b.y), y1=Math.min(a.y+a.d,b.y+b.d);
  if(x1-x0<=ROOM_OVERLAP_EPS_MM||y1-y0<=ROOM_OVERLAP_EPS_MM) return false;
  if(Math.min(x1-x0,y1-y0)<=ROOM_OVERLAP_WALL_TOL_MM&&overlapStripHiddenByWall(a,b,x0,y0,x1,y1)) return false;
  return true;
}
// 重なりの帯(x0..x1, y0..y1)に沿って、どちらかの部屋の階の壁が帯の長さの8割以上
// 立っているか。壁の厚みの半分だけ帯を太らせて、壁の芯が通る長さで測る。
function overlapStripHiddenByWall(a,b,x0,y0,x1,y1){
  if(typeof DATA==='undefined'||!DATA||!DATA.walls) return false;
  var vertical=(x1-x0)<(y1-y0);
  var stripLen=vertical?(y1-y0):(x1-x0);
  var floors=[a.floor||1,b.floor||1];
  return DATA.walls.some(function(w){
    if(!w||floors.indexOf(w.floor||1)<0) return false;
    var half=(Number(w.thick)||120)/2;
    var len=vertical
      ? segmentInsideRectLengthMm(w.x1,w.y1,w.x2,w.y2,x0-half,y0,x1+half,y1)
      : segmentInsideRectLengthMm(w.x1,w.y1,w.x2,w.y2,x0,y0-half,x1,y1+half);
    return len>=stripLen*0.8;
  });
}
// この部屋を覆っている上階の部屋。無ければ null(=その部屋の上は屋根裏)。
// 複数該当するときは一番下の階のものを返す -- 画面で理由を言うときに、
// すぐ上に何があるかを名指しできるように。
function roomAboveRoom(room){
  if(!room||typeof DATA==='undefined'||!DATA||!DATA.rooms) return null;
  var f=(room.floor||1), best=null, i, r;
  for(i=0;i<DATA.rooms.length;i++){
    r=DATA.rooms[i];
    if(!r||r===room||r.hidden3D) continue;
    if((r.floor||1)<=f) continue;
    if(!roomsOverlapInPlan(room,r)) continue;
    if(!best||(r.floor||1)<(best.floor||1)) best=r;
  }
  return best;
}
function roomHasRoomAbove(room){
  return !!roomAboveRoom(room);
}
// 屋根アイテムの footprint が平面上のこの点を覆っているか。回転・フリップは
// roofLocalPoint が既に持っているので、ローカル座標で矩形に入るかだけを見る
// (isInsideItem は建具の当たり判定の余白を持っており、屋根の輪郭とは別物)。
// 谷(2つの制限が交わる線)の向こう側か。setbackClips は「この面のほうが低い
// (＝この面が効く)側」を表す平面座標の一次式で、値が0以上の側だけがこの屋根の
// 領分である。制限が1枚だけのプランでは setbackClips が付かないので、
// 既存の屋根も1枚制限の斜線屋根も、ここは1回も通らない。
function setbackClipsCoverPlan(cls,xMm,yMm){
  var i, c;
  for(i=0;i<cls.length;i++){
    c=cls[i];
    if(c.c+c.cx*xMm+c.cy*yMm<0) return false;
  }
  return true;
}
function roofCoversPlanPoint(it,xMm,yMm){
  var lp=roofLocalPoint(it,xMm,yMm);
  // 斜線由来の屋根は、**自分の面がいちばん低い範囲にしか架からない**(Task 25-3)。
  // 角で2つの制限が交わるところでは、谷の向こうはもう一方の面の屋根の領分である。
  // 3D に建つ板もそこで切られている(build3DSetbackRoofSlab の setbackOtherPlaneClips)
  // ので、同じ谷をここでも使う -- 谷の定義は setbackBindingClipPlan 1本しかない。
  if(it.setbackClips && !setbackClipsCoverPlan(it.setbackClips,xMm,yMm)) return false;
  // 斜線由来の屋根が凹みのある輪郭を持つとき(Task 18-3)は、その輪郭で見る。
  // setbackOutline を持たない屋根 -- つまり既存の屋根すべて -- は従来の矩形のまま。
  if(it.setbackOutline) return setbackOutlineCoversLocal(it.setbackOutline,lp.x,lp.z);
  // 結合した屋根(L字・コの字)は外接矩形ではなく、結合した矩形の集合で見る。
  // 外接矩形で見ると、L字の欠けた側にある部屋まで屋根の下になってしまう。
  var rp=(typeof roofParts==='function')?roofParts(it):null;
  if(rp){
    for(var i=0;i<rp.length;i++){
      var p=rp[i];
      if(Math.abs(lp.x/U-p.cx)<=p.w/2+1e-3 && Math.abs(lp.z/U-p.cz)<=p.d/2+1e-3) return true;
    }
    return false;
  }
  return Math.abs(lp.x)<=it.w*U/2+1e-6 && Math.abs(lp.z)<=it.d*U/2+1e-6;
}
// 屋根ローカル(m)の点が輪郭の中か。輪郭は重ならない矩形の集まりである。
function setbackOutlineCoversLocal(ol,x,z){
  var rs=(ol&&ol.rects)||[], i, r;
  for(i=0;i<rs.length;i++){
    r=rs[i];
    if(x>=r.x0-1e-6&&x<=r.x1+1e-6&&z>=r.z0-1e-6&&z<=r.z1+1e-6) return true;
  }
  return false;
}
// この部屋の上に載っている roof アイテム。無ければ null。
// 「載っている」= 部屋の中心が屋根の footprint に入り、かつその屋根の下面(天井面)の
// 最高点が部屋の床より上にあること(下の階の庇に天井を引きずり下ろさせない)。
// 複数該当するときは棟が低い方を採る -- 先に頭を押さえるのはそちらだから。
function roofItemOverRoom(room){
  if(!room||typeof DATA==='undefined'||!DATA||!DATA.items) return null;
  // 上に部屋がある階では、屋根は「上にある」ものではない -- あいだに床がある。
  // これが無いと、屋根の階だけを見ていないせいで、既定プラン(部屋1〜3階・屋根3階と
  // 4階)の1階の部屋が2階分上の屋根から天井をもらう。
  if(roomHasRoomAbove(room)) return null;
  var cx=room.x+room.w/2, cy=room.y+room.d/2;
  var floorY=floorTopY(room.floor);
  var best=null, bestApex=Infinity;
  DATA.items.forEach(function(it){
    if(!it||it.type!=='roof'||it.hidden3D) return;
    if(!roofCoversPlanPoint(it,cx,cy)) return;
    var apex=roofCeilingWorldYAt(it,cx,cy);
    // 中心だけでは軒先を掴んでしまうので、部屋の四隅も見て一番高いところで判定する。
    [[room.x,room.y],[room.x+room.w,room.y],[room.x,room.y+room.d],[room.x+room.w,room.y+room.d]]
      .forEach(function(p){
        var v=roofCeilingWorldYAt(it,p[0],p[1]);
        if(v>apex) apex=v;
      });
    if(apex<=floorY) return;
    if(apex<bestApex){ bestApex=apex; best=it; }
  });
  return best;
}
// この部屋に**一部でも**かかっている屋根をすべて(roofItemOverRoom の屋根を先頭に)。
// 部屋の上が2枚の屋根に分かれている家がある -- 1階の LDK の西半分に陸屋根、
// 東半分に片流れ、のように。中心の屋根1枚だけを見ると、部屋全体がその屋根に
// 沿ってしまい、もう片方の勾配が天井に出ない(利用者のプランで確認)。
// 天井の高さは点ごとに「その点を覆う屋根のうち低い方」で決まる
// (roomCeilingWorldYAtMm)ので、ここで全部を渡せば、西は平ら・東は勾配になる。
// 屋根が1枚しか掛かっていない部屋では [roofItemOverRoom] と同じ = 従来どおり。
function roofsOverRoom(room){
  var primary=roofItemOverRoom(room);
  if(!primary) return [];
  var floorY=floorTopY(room.floor);
  var pts=[], i, j;
  for(i=0;i<5;i++) for(j=0;j<5;j++)
    pts.push([room.x+room.w*(i+0.5)/5, room.y+room.d*(j+0.5)/5]);
  // 部屋に一部でもかかる屋根を集め、**いちばん低い段(floor)**の屋根だけを使う。
  // 上の段の屋根(2階の屋根の軒の出など)は、同じ部屋に下の段の屋根(下屋)が
  // かかっていればその部屋の屋根ではない -- 数えると、軒の出のかかる細い帯だけ
  // 天井が上の段の屋根まで上がり、下屋の上へ天井の切れ端が突き出した。
  // 以前は「主の屋根(中心の屋根)と同じ段」で絞っていたが、中心に上の段の屋根が
  // かかる部屋では、端にかかる下屋を落としてしまっていた。
  var found=[];
  DATA.items.forEach(function(it){
    if(!it||it.type!=='roof'||it.hidden3D) return;
    var hit=(it===primary)||pts.some(function(p){
      return roofCoversPlanPoint(it,p[0],p[1])&&roofCeilingWorldYAt(it,p[0],p[1])>floorY;
    });
    if(hit) found.push(it);
  });
  var level=Infinity;
  found.forEach(function(it){ level=Math.min(level,it.floor||1); });
  var out=found.filter(function(it){ return (it.floor||1)===level; });
  // 主の屋根を先頭に。どの屋根も覆っていない点は、部屋の内側で屋根のある点の
  // 高さを使う(roomCeilingWorldYAtMm)。
  out.sort(function(a,b){ return (a===primary?-1:0)-(b===primary?-1:0); });
  return out.length?out:[primary];
}
// 屋根の下面(=垂木の載る基準面)の、ワールド Y(m)。
// **屋根の形の計算はここに書かない**。3D 側が既に使っている roofSurfaceHeightAt
// (屋根ローカル座標での屋根面高さ) と roofLocalPoint をそのまま呼ぶ。屋根アイテムの
// 世界での据え付け方 (floorBaseY(floor)+elev) も既存の竪樋判定と同じ式である。
// この面が「家の中のものが超えられない天井(=屋根裏の底)」であり、天井面も壁の
// 上端もここで頭を押さえられる。
// 屋根が据わる高さ(ワールドm、高さ Z を足す前)。**3D で屋根を置く位置
// (item3DBaseY の roof の枝)と同じ式にする。** 下の階の壁を既定より高くすると、
// 屋根はその壁の天端まで持ち上がって描かれる(localSupportTopY)。高さの計算が
// 階の基準面(floorBaseY)のままだと、壁は元の高さで切られ、持ち上がった屋根との
// あいだが空いた(利用者のプランで 812mm)。下の階に高い壁が無ければ floorBaseY と同じ。
var _roofBaseCache=null;   // 3D の組み立て1回・平面図の描画1回のあいだだけ有効(build3D / draw2d が作って捨てる)
function roofBaseWorldY(roofItem){
  var it=roofItem||{};
  var cache=(typeof _roofBaseCache!=='undefined')?_roofBaseCache:null;
  var key=cache&&[it.id,it.floor,it.x,it.y,it.w,it.d].join(',');
  if(key&&cache[key]!==undefined) return cache[key];
  var v=localSupportTopY(it.floor,it.x||0,it.y||0,(it.x||0)+(it.w||0),(it.y||0)+(it.d||0));
  if(key) cache[key]=v;
  return v;
}
function roofUndersideWorldYAt(roofItem,xMm,yMm){
  var lp=roofLocalPoint(roofItem,xMm,yMm);
  return roofBaseWorldY(roofItem)+((roofItem.elev||0)*U)
    +roofSurfaceHeightAt(roofItem,lp.x,lp.z);
}
// 屋根の面から天井までの下がり(mm)。既定は CEILING_UNDER_ROOF_OFFSET_MM(250)だが、
// **屋根の板の厚みより小さくしてはいけない。** 屋根の面(roofUndersideWorldYAt)は
// 板の上面で、板は面から屋根厚ぶん下へ伸びている。厚み 260mm の屋根で 250mm しか
// 下げないと、天井が屋根の板の中に入り、室内から屋根の裏(濃い色)が見えた
// (利用者のプランの片流れで確認)。厚みの既定 180mm では従来どおり 250mm。
function roofCeilingOffsetMm(rf){
  var thick=Math.max(30,Math.min(600,Number(rf&&rf.roofThickness)||180));
  return Math.max(CEILING_UNDER_ROOF_OFFSET_MM,thick+20);
}
// 屋根下面から CEILING_UNDER_ROOF_OFFSET_MM だけ下げた面の、ワールド Y(m)。
function roofCeilingWorldYAt(roofItem,xMm,yMm){
  return roofUndersideWorldYAt(roofItem,xMm,yMm)-roofCeilingOffsetMm(roofItem)*U;
}
// 部屋の天井の形。**宣言しておらず斜線にも当たっていない部屋では必ず null**を返し、
// 呼び出し側は従来の平天井の枝を通る。宣言した部屋は屋根があれば屋根から、無ければ
// 手書きの low/high/direction から形を得る(屋根が載っていない部屋のための上書き)。
//
// Task 17: 斜線制限で削られた部屋は、宣言が無くても勾配天井になる。勾配天井は
// 設計者が宣言するものではなく **切り取りの結果として現れる** ものだからである。
// ただし別経路は作らない -- 斜線の切り口に架かる片流れ屋根を roof アイテムとして
// 作り(setbackRoofItems)、ここでは従来どおり「屋根から天井が決まる」枝を通す。
// reason で「宣言が効いたのか、斜線が効いたのか」を必ず判別できるようにする。
// 斜線由来の片流れ屋根は斜線制限の節(setbackRoofItems)で作られる。高さモデルだけを
// 切り出して走らせる経路のために、無ければ「斜線は無い」として通す。
function setbackRoofsForRoom(room){
  if(typeof setbackRoofsOverRoom!=='function') return [];
  return setbackRoofsOverRoom(room);
}
function roomCeilingProfile(room){
  var sbRoofs=setbackRoofsForRoom(room);
  if(!roomDeclaresSlopedCeiling(room)){
    if(!sbRoofs.length) return null;
    // 斜線由来。低い側は持ち上げない(lowY=0)。制限に当たっていない場所の天井は
    // 元の平天井のまま動かさない(maxY) -- 当たっていない所まで天井を下げない、
    // というのがこの仕組みの要点である。
    return {source:'roof',reason:'setback',roof:sbRoofs[0],roofs:sbRoofs,
      lowY:0,baseY:floorBaseY(room.floor),
      maxY:floorBaseY(room.floor)+roomCeilingHeightM(room)};
  }
  if(typeof HeightModel==='undefined'||!HeightModel) return null;
  var shape=HeightModel.ceilingShape(DATA,room);
  if(!shape||shape.type!=='sloped') return null;
  var baseY=floorBaseY(room.floor);
  var lowY=shape.lowMm*U+floorSlabHeightMForFloor(room.floor);
  var roof=roofItemOverRoom(room);
  if(roof){
    var over=roofsOverRoom(room);
    return {source:'roof',reason:'declared',roof:roof,
      roofs:sbRoofs.length?over.concat(sbRoofs):over,lowY:lowY,baseY:baseY};
  }
  if(sbRoofs.length) return {source:'roof',reason:'setback',roof:sbRoofs[0],
    roofs:sbRoofs,lowY:lowY,baseY:baseY};
  var highY=roomCeilingHeightM(room);
  if(lowY>highY) lowY=highY;
  return {source:'manual',reason:'declared',lowY:lowY,highY:highY,direction:shape.direction,baseY:baseY};
}
// 天井面のワールド Y(m)。引数は平面座標(mm)。profile が null の部屋は
// 従来どおり平らな roomCeilingHeightM。
function roomCeilingWorldYAtMm(room,profile,xMm,yMm){
  var baseY=floorBaseY(room&&room.floor);
  if(!profile) return baseY+roomCeilingHeightM(room);
  if(profile.source==='roof'){
    // 頭を押さえるのは「この点を覆っている屋根のうち一番低い下面」。屋根が1枚
    // (＝斜線を使っていない従来のプラン)なら roofTopLimitAtPlanPoint はその屋根の
    // 値をそのまま返すので、式は 1 ビットも変わらない。斜線の片流れ屋根が重なる
    // ときだけ、点ごとに低い方が勝つ。
    var roofs=profile.roofs||[profile.roof];
    var roofLim=roofTopLimitAtPlanPoint(roofs,xMm,yMm);
    // 天井は、この点を覆う屋根それぞれの「面−下がり」のうち低い方。下がりは屋根ごとに
    // 厚みで変わる(roofCeilingOffsetM)。屋根1枚・厚み既定なら従来の式と同じ値になる。
    var y=null;
    roofs.forEach(function(rf){
      if(!rf||!roofCoversPlanPoint(rf,xMm,yMm)) return;
      var v=roofUndersideWorldYAt(rf,xMm,yMm)-roofCeilingOffsetMm(rf)*U;
      if(y===null||v<y) y=v;
    });
    if(roofLim===null){
      // どの屋根も覆っていない位置。斜線由来の勾配は「削られていない位置」なので
      // 元の平天井のまま。
      if(profile.reason==='setback'&&profile.maxY!==undefined) return profile.maxY;
      // 屋根が2枚以上かかる部屋では、**部屋の内側へ少し寄った、屋根のある点**の
      // 値を使う。部屋の縁が屋根の端より外に出ている(壁の芯と屋根の端が数十mm
      // ずれる)と、その細い帯だけ主の屋根の面を延長した高さになり、吹き抜け側では
      // 天井が棚のように落ちて、壁の上に謎の板が出た(報告された)。
      var near=null;
      if((roofs.length>1||roofs.indexOf(profile.roof)<0)&&room){
        // 寄せる向きは**いちばん近い辺から真っすぐ内側**。部屋の中心へ斜めに寄せると、
        // 2枚の屋根の境の近くでは寄せた先が隣の屋根に入り、縁の帯だけ段差の位置が
        // ずれて天井の段がねじれた(利用者のプラン: 陸屋根と片流れの境)。
        var eL=xMm-room.x, eR=room.x+room.w-xMm, eT=yMm-room.y, eB=room.y+room.d-yMm;
        var em=Math.min(eL,eR,eT,eB), vx=0, vy=0;
        if(eL===em) vx+=1; if(eR===em) vx-=1;
        if(eT===em) vy+=1; if(eB===em) vy-=1;
        if(!vx&&!vy){ vx=room.x+room.w/2-xMm; vy=room.y+room.d/2-yMm; }
        var vl=Math.hypot(vx,vy)||1;
        [40,80,160,320,640].some(function(dMm){
          var qx=xMm+vx/vl*dMm, qy=yMm+vy/vl*dMm;
          roofs.forEach(function(rf){
            if(!rf||!roofCoversPlanPoint(rf,qx,qy)) return;
            var v=roofUndersideWorldYAt(rf,qx,qy)-roofCeilingOffsetMm(rf)*U;
            if(near===null||v<near.y) near={y:v,lim:roofTopLimitAtPlanPoint(roofs,qx,qy)};
          });
          return near!==null;
        });
      }
      if(near){ y=near.y; roofLim=near.lim; }
      else {
        // 宣言由来は従来どおりその屋根の面を延長する。
        roofLim=roofUndersideWorldYAt(profile.roof,xMm,yMm);
        y=roofLim-roofCeilingOffsetMm(profile.roof)*U;
      }
    }
    if(y===null) y=roofLim-CEILING_UNDER_ROOF_OFFSET_MM*U;
    var lowWorld=baseY+profile.lowY;
    // 軒先側では屋根下面が低い側の天井高より下へ来る。そこは天井を吊ったまま
    // (平らな部分)にする -- だから勾配は壁の途中から始まり、上辺は折れ線になる。
    if(y<lowWorld) y=lowWorld;
    // ただし吊った天井が屋根下面より上へ出ることは無い(低い値を入れると軒先で
    // 起きる)。壁は屋根下面で切られるので、天井だけ上へ抜けさせると壁と天井の
    // あいだに隙間が開く。同じ面で両方の頭を押さえる。
    if(y>roofLim) y=roofLim;
    // 斜線由来のときだけ、元の平天井より上へは行かせない。
    if(profile.maxY!==undefined&&y>profile.maxY) y=profile.maxY;
    return y;
  }
  // 手書きの勾配: 高さは (x,z) の一次関数。既存 buildSlopedCeilingGeometry と同式。
  var u=ceilingSlopeUnit(profile.direction);
  var span=ceilingSlopeSpan(room,u);
  var range=span.max-span.min;
  var s=xMm*U*u.x+yMm*U*u.z;
  var t=range>1e-9?(s-span.min)/range:1;
  if(t<0) t=0; else if(t>1) t=1;
  return baseY+profile.lowY+(profile.highY-profile.lowY)*t;
}
// 部屋の天井面をグリッドで実測し、最低/最高と「高い側が指す方位」を返す。
// 屋根由来の天井は棟で折り返すので、式から最高点を解くのではなく面を測る。
var _roofCeilingExtentCache={};
function roomRoofCeilingExtent(room){
  var roof=roomDeclaresSlopedCeiling(room)?roofItemOverRoom(room):null;
  if(!roof) return null;
  if(typeof HeightModel==='undefined'||!HeightModel) return null;
  var shape=HeightModel.ceilingShape(DATA,room);
  if(!shape||shape.type!=='sloped') return null;
  var sbRoofs=setbackRoofsForRoom(room);
  // 部屋にかかる屋根すべて(roofsOverRoom)。天井の描画(roomCeilingProfile)と同じ組。
  var over=roofsOverRoom(room);
  // 鍵は結果を決めるものを全部含める。含め忘れると古い天井高が残る。
  var key=[room.id,room.floor,room.x,room.y,room.w,room.d,shape.lowMm,
    over.map(function(rf){
      return [rf.id,rf.x,rf.y,rf.w,rf.d,rf.floor,rf.rot,rf.elev,rf.roofType,rf.pitch,
        rf.flipX?1:0,rf.flipY?1:0,roofBaseWorldY(rf)].join(',');
    }).join('|'),
    floorBaseY(room.floor),
    sbRoofs.map(function(r){return r.key;}).join('|')].join(':');
  if(_roofCeilingExtentCache[key]) return _roofCeilingExtentCache[key];
  var profile={source:'roof',reason:'declared',roof:roof,
    roofs:sbRoofs.length?over.concat(sbRoofs):over,
    lowY:shape.lowMm*U+floorSlabHeightMForFloor(room.floor),
    baseY:floorBaseY(room.floor)};
  var baseY=floorBaseY(room.floor);
  var N=12, i, j, px, py, y;
  var lowY=Infinity, highY=-Infinity, loPt=null, hiPt=null;
  for(i=0;i<=N;i++) for(j=0;j<=N;j++){
    px=room.x+room.w*i/N; py=room.y+room.d*j/N;
    y=roomCeilingWorldYAtMm(room,profile,px,py)-baseY;
    if(y<lowY){ lowY=y; loPt=[px,py]; }
    if(y>highY){ highY=y; hiPt=[px,py]; }
  }
  // 矢印は高い側を指す。0=北。平面の +Y は南なので北は -y。
  var dir=0;
  if(loPt&&hiPt&&(hiPt[0]!==loPt[0]||hiPt[1]!==loPt[1])){
    dir=Math.atan2(hiPt[0]-loPt[0],-(hiPt[1]-loPt[1]))*180/Math.PI;
    if(dir<0) dir+=360;
  }
  var res={lowY:lowY,highY:highY,direction:dir,profile:profile};
  _roofCeilingExtentCache[key]=res;
  return res;
}
var _ceilingClampWarned={};
// 天井が届いてよい上限(m, floorBaseY 基準)。
//
// 既定は階高。**階高を超えてよいのは、自分が段差を持っている部屋だけ**である。
// そこでは段差ぶん床が上がっているので、階高で丸めると頭上が潰れる。上限は
// その部屋の真上にある物の下端(localSupportTopY)まで。
//
// 段差を持たない部屋にまでこれを広げてはいけない。localSupportTopY は
// 「矩形を跨ぐ下階の壁の最大」なので、**境界の壁が1本高いだけで隣の部屋の
// 天井まで上がり**、その部屋に既に付いている照明が天井から取り残される。
// 丸めるのは天井の側、というのは Task 2b から変えていない方針でもある。
function roomCeilingCapM(room){
  var floor=(room&&room.floor)||1;
  var storyM=storyHeightM(floor);
  if(!room||!isFinite(room.x)||!isFinite(room.y)) return storyM;
  if(roomSkipLevelMm(room)<=0) return storyM;
  var localM=localSupportTopY(floor+1,room.x,room.y,room.x+room.w,room.y+room.d)-floorBaseY(floor);
  return localM>storyM?localM:storyM;
}
// 部屋の天井面の高さ(floorBaseY からの高さ、m)。部屋ごとの天井高の唯一の入口。
// 階高でクランプしない: それが「2520mm 以下の天井高がまったく効かない」原因だった。
// 天井高が階高を超えるときだけ階高へ丸める。階高の側を上げると上階の床が持ち上がり
// 家全体が変わるため、丸めるのは天井の側。丸めたことは黙らせず警告に残す。
function roomCeilingHeightM(room){
  // 屋根から導いた勾配天井は、定義からして階高より上へ伸びる(小屋裏を使うのが
  // 勾配天井の目的)。ここで階高へ丸めると屋根と天井がまた食い違うので丸めない。
  // roomCeilingProfile を経由すると手書きの枝から再帰するため、屋根の枝だけを見る。
  var roofExt=roomRoofCeilingExtent(room);
  if(roofExt) return roofExt.highY;
  var floor=room&&room.floor;
  var storyM=roomCeilingCapM(room);
  var mm=roomExplicitCeilingMm(room);
  if(mm===null) return storyM;
  // 吹抜は既にスラブ下端から算出済み。2階以上でスラブ厚を二重加算しない。
  // スキップフロアの段差は足す: 明示した天井高は**その区画の床から**測る値なので、
  // 段差ぶん持ち上げないと、床だけ上がって天井が据え置かれ頭上が潰れる。
  var h=mm*U+(roomIsVoidCeiling(room)?0:floorSlabHeightMForFloor(floor)+roomSkipLevelMm(room)*U);
  if(h>storyM){
    // 手書きの勾配天井は、上に何も載っていない部屋に限り階高を超えてよい (Task 14-2)。
    // 超えても持ち上がる床が無い -- 小屋裏へ抜けるのが勾配天井の実体だからである。
    // これが無いと既定の 低2200/高3600 が階高2700で 2700 に丸められ、勾配を選んで
    // 何も入力しない人には必ず平天井が出る。
    // 緩めるのは **勾配を宣言した部屋だけ**。平天井を階高より上へ置くと、壁は階高
    // までしか建たないので天井が宙に浮く。上に部屋がある階では従来どおり丸める
    // (階高の側を上げると上階の床ごと家全体が動くので、丸めるのは天井の側)。
    // 吹き抜けは「上階の床を張らず、天井を上階の天井まで上げる」ことである。
    // 上に階そのものはあるのに、その位置だけ部屋が無い場合に限り、平天井でも
    // 階高を超えてよい。壁は wallCeilingHeightM が隣室の天井高まで建てるので
    // 天井は宙に浮かない。最上階の平天井を階高で丸めるのは従来どおり
    // (そこにあるのは吹き抜けではなく小屋裏で、勾配天井の領分である)。
    if(roomDeclaresSlopedCeiling(room)&&!roomHasRoomAbove(room)) return h;
    // 宣言された吹き抜け。間の階が全て開いていれば階高を超えてよい。
    if(roomIsVoidCeiling(room)&&roomVoidFloorsAreOpen(room)) return h;
    // 数値で階高超えを書いた場合の後方互換。上に階はあるのにこの位置だけ
    // 部屋が無い(=事実上の吹き抜け)ときに限って通す。
    var upperExists=false;
    if(typeof DATA!=='undefined'&&DATA&&DATA.rooms){
      for(var ri=0;ri<DATA.rooms.length;ri++){
        var rr=DATA.rooms[ri];
        if(rr&&!rr.hidden3D&&(rr.floor||1)===(floor||1)+1){ upperExists=true; break; }
      }
    }
    if(!roomHasRoomAbove(room)&&upperExists) return h;
    var key=((room&&room.id)||'?')+'@'+mm;
    if(!_ceilingClampWarned[key]){
      _ceilingClampWarned[key]=1;
      console.warn('[height] room "'+((room&&(room.n||room.id))||'?')+'" asks for a '+mm+
        'mm ceiling but the storey is only '+storyHeightMmForFloor(floor)+
        'mm; the ceiling was clamped to the storey height.');
    }
    return storyM;
  }
  return h;
}
// レンダが実際に置いた天井面の、その階の床面からの高さ(mm)。
// roomCeilingHeightM は floorBaseY を基準に返す（buildRooms3D の ceilY がそれ）
// ので、床スラブを持つ階では厚みを引かないと「室内で測れる高さ」にならない。
// 実測(既定プラン・全部屋が天井高を明示していない): 1階 2700 / 2階・3階 2520。
function roomRenderedCeilingMm(room){
  var floor=room&&room.floor;
  return Math.round((roomCeilingHeightM(room)-floorSlabHeightMForFloor(floor))/U)
    -Math.max(0,Math.min(600,Number(room&&room.floorRaiseMm)||0))
    -roomSkipLevelMm(room);
}
// 部屋が勾配天井なら、レンダが実際に置く低い側・高い側の高さ(m, floorBaseY 基準)を返す。
// 高い側は roomCeilingHeightM をそのまま使う（階高でのクランプを2か所に書かない）。
// 低い側も高い側で抑え、クランプで高い側が下がったときに低い側が上を越えないようにする。
// 勾配を宣言していない部屋では null を返す。既存プランはこの関数の外側を通らない。
function roomCeilingSlopeM(room){
  var p=roomCeilingProfile(room);
  if(!p) return null;
  if(p.source==='manual') return {lowY:p.lowY,highY:p.highY,direction:p.direction,source:'manual'};
  var ext=roomRoofCeilingExtent(room);
  if(!ext) return null;
  return {lowY:ext.lowY,highY:ext.highY,direction:ext.direction,source:'roof'};
}
// 平面図のラベルと package.json の記録は、**レンダと同じ経路**で高さを解決する。
// HeightModel.ceilingShape / ceilingLabel をそのまま呼ぶと、天井高を明示していない
// 部屋には既定の 2400 が返る。レンダはそういう部屋に階高をそのまま与える
// (roomCeilingHeightM の意図的な仕様。既定へ落とすと保存済みの家が 300mm 下がる)
// ので、既定プランでは 2700 / 2520 で描かれた部屋に「CH 2400」と書くことになる。
// 設計 §12.2 はこのラベルを「生成AIが空間の高さを知る唯一の手がかり」と定義して
// いるので、このずれはそのまま嘘になる。形(平ら/勾配)と文字の組み立ては
// HeightModel の1か所に任せ、**数値だけ**をレンダ側から取る。
function roomRenderedCeilingShape(room){
  var mm=roomRenderedCeilingMm(room);
  // 勾配天井は 3D で実際に傾く (roomCeilingSlopeM / buildSlopedCeilingGeometry)
  // ようになったので、ラベルは範囲と向きを言ってよい。数値はどちらも
  // **レンダが置いた面**から取る: 高い側は roomRenderedCeilingMm、低い側も
  // 同じ経路 (roomCeilingSlopeM) が階高でクランプした後の値。
  // 11-3(B) の抑制はここにあった。存在しない傾きを書かないためのもので、
  // 傾きが実在するようになったので外した。
  var slope=roomCeilingSlopeM(room);
  if(!slope) return {type:'flat',heightMm:mm};
  // どちらが効いたか(屋根か、屋根が載っていない部屋のための手書きの上書きか)を
  // package.json へそのまま残す。判定器と生成AIが天井の出どころを追えるように。
  return {type:'sloped',
    lowMm:Math.round((slope.lowY-floorSlabHeightMForFloor(room&&room.floor))/U),
    highMm:mm,
    direction:slope.direction,
    source:slope.source||'manual',
    roofOffsetMm:slope.source==='roof'?CEILING_UNDER_ROOF_OFFSET_MM:undefined};
}
function roomRenderedCeilingLabel(room){
  var shape=roomRenderedCeilingShape(room);
  // 書式(矢印の表を含む)は HeightModel にしかない。写し取らずに呼び直す。
  return HeightModel.ceilingLabel(DATA,
    shape.type==='sloped'
      ? {ceiling:{type:'sloped',lowMm:shape.lowMm,highMm:shape.highMm,direction:shape.direction}}
      : {ceiling:{heightMm:shape.heightMm}});
}
// 段差の表記。段差の無い部屋では空文字。JIS の平面図でも「FL+1200」と書くので、
// 画面の注記と図面で同じ文字列を使う。
function roomLevelLabel(room){
  var v=roomSkipLevelMm(room);
  return v>0 ? ('FL+'+v) : '';
}
// 平面図に出す1行。段差があれば段差を先に、天井高を後ろに置く
// (床の高さが分からないと天井高の基準が読めないため)。
function roomHeightLabel(room){
  var lvl=roomLevelLabel(room);
  var ch=roomRenderedCeilingLabel(room);
  return lvl ? (lvl+' / '+ch) : ch;
}
// その点にある部屋を、優先する順に並べて返す。
//
// **部屋が重なっているとき、どれの床に載るかを決める規則はここ1か所。**
// 小さい部屋が先(大きな部屋の中に切り出した区画 = スキップフロアや小上がりを
// 描くための書き方)。同じ大きさなら重ね順(stack)の手前、それも同じなら
// 後から描いた方(平面図で上に見えている方)。
//
// 以前は roomAtPointOnFloor が「配列の先頭」、roomFloorAt が「小さい方」で
// 別々に決めていた。階段室の中にスキップフロアを重ねると、家具は段差の上に
// 載るのに、壁・階段・建具は段差が無いものとして扱われていた。
function roomsAtPointOnFloor(floor,x,y){
  if(typeof DATA==='undefined'||!DATA||!DATA.rooms) return [];
  var out=[];
  DATA.rooms.forEach(function(r,i){
    if(!r||r.floor!==floor||r.hidden3D) return;
    if(x>=r.x&&x<=r.x+r.w&&y>=r.y&&y<=r.y+r.d) out.push({r:r,i:i});
  });
  function stackOf(r){ var v=Number(r.stack); return isFinite(v)?v:0; }
  out.sort(function(a,b){
    return (a.r.w*a.r.d-b.r.w*b.r.d) || (stackOf(b.r)-stackOf(a.r)) || (b.i-a.i);
  });
  return out.map(function(o){return o.r;});
}
function roomAtPointOnFloor(floor,x,y){
  return roomsAtPointOnFloor(floor,x,y)[0]||null;
}
// 壁の両側を数点サンプリングし、接する部屋の天井高の最大値と、
// 「両側とも部屋に囲まれているか(=内部間仕切りか)」を返す。
function wallAdjacentRoomsCeiling(w){
  var res={maxM:0,found:false,enclosed:true};
  var dx=w.x2-w.x1, dy=w.y2-w.y1;
  var len=Math.sqrt(dx*dx+dy*dy);
  if(len<1){ res.enclosed=false; return res; }
  var nx=-dy/len, ny=dx/len;
  var off=Math.max((w.thick||120)/2+40,100);
  var i,s,t,px,py,r,h;
  for(i=0;i<5;i++){
    t=(i+0.5)/5;
    px=w.x1+dx*t; py=w.y1+dy*t;
    for(s=-1;s<=1;s+=2){
      r=roomAtPointOnFloor(w.floor,px+nx*off*s,py+ny*off*s);
      if(!r){ res.enclosed=false; continue; }
      res.found=true;
      h=roomCeilingHeightM(r);
      if(h>res.maxM) res.maxM=h;
    }
  }
  return res;
}
// ── 壁の上辺を勾配に沿わせる (Task 12-2) ────────────────────────────────
// 上辺は**折れ線**である。勾配は壁の途中から始まることがあり(軒側の平天井が
// 終わるところ)、切妻なら棟で折り返して山形になる。だから台形では足りず、
// 長さ方向にサンプリングして各点で天井面の高さを引く。
//
// この壁が勾配天井の部屋に接しているか。接していなければ null を返し、
// 呼び出し側は従来の「まっすぐな上辺」の枝をそのまま通る。
function wallTouchesSlopedCeiling(w){
  if(!w) return false;
  var dx=w.x2-w.x1, dy=w.y2-w.y1;
  var len=Math.sqrt(dx*dx+dy*dy);
  if(len<1) return false;
  var nx=-dy/len, ny=dx/len;
  var off=Math.max((w.thick||120)/2+40,100);
  var i,s,t,px,py,r;
  for(i=0;i<5;i++){
    t=(i+0.5)/5;
    px=w.x1+dx*t; py=w.y1+dy*t;
    for(s=-1;s<=1;s+=2){
      r=roomAtPointOnFloor(w.floor,px+nx*off*s,py+ny*off*s);
      if(r&&roomCeilingProfile(r)) return true;
    }
  }
  return false;
}
// ── 壁の上端を屋根の下面で切る (Task 15) ──────────────────────────────
// 在来工法では外壁は桁(軒の高さ)まで立ち、その上の妻壁は屋根なりの三角形になる。
// **壁が屋根を突き抜けることはない。** だから壁の頭を押さえるのは天井ではなく
// 屋根の下面である。天井はそこから CEILING_UNDER_ROOF_OFFSET_MM だけ下がった面
// なので、壁はその 250mm ぶん上、屋根の裏側まで立ってよい。
//
// Task 2b の「外皮に面する壁は階高を下限にする」はそのまま残す。あれは
// **屋根が無い**(平らな屋根の下で天井だけ下げた)場合の規則で、外壁と上階の床の
// あいだに家の外まで抜けるスリットが開くのを塞いでいる。屋根がある位置では
// 屋根下面が上限になり、下限より先に上限が効く。そこにスリットは開かない --
// 空いた分は屋根そのものが塞ぐからである(実測で確かめること)。
// 屋根が無い位置では上限が無く、従来どおり下限だけが効く。
//
// その点を覆っている屋根が複数あれば **低い方** が勝つ。先に頭を押さえるのは
// そちらだから(roofItemOverRoom が棟の低い屋根を採るのと同じ理由)。
function roofTopLimitAtPlanPoint(roofs,xMm,yMm){
  if(!roofs||!roofs.length) return null;
  var best=null, i, it, y;
  for(i=0;i<roofs.length;i++){
    it=roofs[i];
    // 屋根が覆っていない位置では切らない(= 従来どおり)。
    if(!it||!roofCoversPlanPoint(it,xMm,yMm)) continue;
    y=roofUndersideWorldYAt(it,xMm,yMm);
    if(best===null||y<best) best=y;
  }
  return best;
}
// 壁は厚みを持つ。上端を芯の位置だけで切ると、勾配を横切る向きの壁では外面/内面の
// 上端が屋根面より上に出る(120mm厚・30度勾配で 36.6mm 実測した)。芯と両面の3点で
// 見て、いちばん低い屋根面に合わせる。屋根が覆っていない点は数に入れない。
function wallRoofTopLimitWorldY(w,roofs,xMm,yMm){
  if(!roofs||!roofs.length) return null;
  var best=roofTopLimitAtPlanPoint(roofs,xMm,yMm);
  var dx=w.x2-w.x1, dy=w.y2-w.y1;
  var len=Math.sqrt(dx*dx+dy*dy);
  if(len<1) return best;
  var nx=-dy/len, ny=dx/len;
  var halfMm=Math.max(wallExteriorFaceOffsetM(w),wallInteriorFaceOffsetM(w))/U;
  var s,v;
  for(s=-1;s<=1;s+=2){
    v=roofTopLimitAtPlanPoint(roofs,xMm+nx*halfMm*s,yMm+ny*halfMm*s);
    if(v!==null&&(best===null||v<best)) best=v;
  }
  return best;
}
// この壁の頭を押さえる屋根。壁の両側をサンプリングし、天井を屋根から導いている
// 部屋(roomCeilingProfile の source==='roof')の屋根だけを集める。
// 勾配を宣言していないプランでは常に空になるので、切る処理そのものが起きない
// = 保存済みの家のジオメトリは1頂点も動かない。
function wallLimitingRoofs(w){
  var out=[];
  if(!w) return out;
  var dx=w.x2-w.x1, dy=w.y2-w.y1;
  var len=Math.sqrt(dx*dx+dy*dy);
  if(len<1) return out;
  var nx=-dy/len, ny=dx/len;
  var off=Math.max((w.thick||120)/2+40,100);
  var i,s,t,px,py,r,p;
  for(i=0;i<5;i++){
    t=(i+0.5)/5;
    px=w.x1+dx*t; py=w.y1+dy*t;
    for(s=-1;s<=1;s+=2){
      r=roomAtPointOnFloor(w.floor,px+nx*off*s,py+ny*off*s);
      if(!r) continue;
      p=roomCeilingProfile(r);
      if(!p||p.source!=='roof'||!p.roof) continue;
      // 斜線の片流れ屋根も同じ「壁の頭を押さえる屋根」として渡す。屋根が1枚の
      // 従来のプランでは p.roofs===[p.roof] なので集まる中身は変わらない。
      (p.roofs||[p.roof]).forEach(function(rf){
        if(rf&&out.indexOf(rf)<0) out.push(rf);
      });
    }
  }
  return out;
}
// 壁の長さ方向の位置 t(0..1) における上辺の高さ(m、その階の floorBaseY 基準)。
// 両側の部屋のうち**高い方**を採る(既存規則。低い方に合わせると高い側の部屋に
// 穴が開く)。minH は「これ以上は下げない」下限で、外壁には外皮の高さを渡す
// -- 屋根が無いところで外壁を天井まで切ると、下げた部屋の上でファサードに
// 水平のスリットが貫通する(Task 2b の実測)。
// roofs はその壁の頭を押さえる屋根(wallLimitingRoofs)。渡さなければ切らない。
// raiseT は立ち上げの屋根を見る位置(t と同じ尺度)。省略すれば t。3D の壁は
// 隅を閉じるために端の先(t<0 / t>1)まで伸ばすので、その位置の屋根で決めないと、
// 屋根の縁の外へ出た部分まで立ち上がって屋根の上に突き出す。立面図は 0..1 だけを
// 描くので省略でよい。**3D も立面図もこの1つの関数で上端を決める。**
function wallTopHeightAtM(w,t,fallbackH,minH,roofs,raiseRoofs,underRoofs,raiseT){
  var dx=w.x2-w.x1, dy=w.y2-w.y1;
  var lenMm=Math.sqrt(dx*dx+dy*dy);
  if(lenMm<1) return fallbackH;
  var nx=-dy/lenMm, ny=dx/lenMm;
  var off=Math.max((w.thick||120)/2+40,100);
  var fy=floorBaseY(w.floor);
  function sampleAt(tt){
    var px=w.x1+dx*tt, py=w.y1+dy*tt, best=null, s, r, qx, qy, h;
    for(s=-1;s<=1;s+=2){
      qx=px+nx*off*s; qy=py+ny*off*s;
      r=roomAtPointOnFloor(w.floor,qx,qy);
      if(!r) continue;
      h=roomCeilingWorldYAtMm(r,roomCeilingProfile(r),qx,qy)-fy;
      if(best===null||h>best) best=h;
    }
    return best;
  }
  var best=sampleAt(t);
  // 壁は交点(センターライン)まで伸びているので、両端の数十mmはどの部屋にも
  // 入らない。そこで壁の高さいっぱいへ戻すと、間仕切りの両端に天井を突き抜ける
  // 出っ張りが残る。内側へ歩いて最初に見つかった部屋の値を延長する。
  if(best===null){
    var step=1/32, k, tt;
    for(k=1;k<=16&&best===null;k++){
      tt=t+(t<0.5?step*k:-step*k);
      if(tt<0||tt>1) break;
      best=sampleAt(tt);
    }
  }
  if(best===null) best=fallbackH;
  if(minH!==undefined&&best<minH) best=minH;
  // 外壁は、屋根の板の下面まで立ち上げる(wallRaiseRoofs)。上げるだけで、下げない。
  // **切る前に**上げる。後で上げると、斜線の制限面などで切った分を元へ戻してしまう
  // (陸屋根も立ち上げの対象にしたとき、斜線で削った壁が陸屋根まで戻った)。
  var rt=(raiseT===undefined)?t:raiseT;
  var up=wallRaiseTopNearWorldY(w,raiseRoofs,w.x1+dx*rt,w.y1+dy*rt);
  if(up!==null&&best<up-fy) best=up-fy;
  // 下限を効かせた**あと**に屋根で切る。屋根がある位置では上限が下限に勝つ。
  var lim=wallRoofTopLimitWorldY(w,roofs,w.x1+dx*t,w.y1+dy*t);
  if(lim!==null&&best>lim-fy) best=lim-fy;
  // 同じ階の勾配屋根(下屋)の下では、屋根の板の下面で切る(下げるだけ)。
  var down=wallUnderRoofTopWorldY(w,underRoofs,w.x1+dx*t,w.y1+dy*t);
  if(down!==null&&best>down-fy) best=Math.max(0.001,down-fy);
  return best;
}
// ── 壁の上端の折れ線を1か所で決める (Task 24-1) ────────────────────────
// 壁の頭を削る条件は「勾配天井に接しているか」「外皮に面しているか(下限)」
// 「頭を押さえる屋根はどれか」の3つである。**3D と図面はこの1つを通す。**
// 判定を2か所に置くと、どちらかを直した日に立面図と3Dが黙って食い違う。
// 削りの対象でない壁では null を返し、呼び出し側は従来の「まっすぐな上辺」の
// 枝をそのまま通る(= 勾配も斜線も使っていないプランは1頂点も動かない)。
// isOuter は既に求めてあれば渡す(buildWall3D は extSpans から持っている)。
function wallTopCutEnv(w,isOuter){
  var touches=wallTouchesSlopedCeiling(w);
  var sameFloor=wallSameFloorRoofs(w);
  if(isOuter===undefined)
    isOuter=(typeof getWallExteriorSpans==='function')&&getWallExteriorSpans(w).length>0;
  // 外皮かどうかは外観の塗り分けと同じ判定(getWallExteriorSpans)1つで決める。
  // 以前はここだけ「片側でも部屋に面していない」で上書きしていたが、原因は外の
  // 判定が壁の厚みを無視して家の中へ流れ込んでいたことだった(getWallOutsideGrid で
  // 直した)。判定を1つにしておけば、外装の色・壁紙の欄・壁の高さが食い違わない。
  // 立ち上げるのは「片側でも部屋に面していない壁」(外皮)。外観の塗り分け
  // (getWallExteriorSpans)は屋根の軒下などを外と数えないことがあり、それで
  // 判定すると軒の出の下の外壁が立ち上がらなかった(利用者のプランで確認)。
  // 壁の高さの規則(wallCeilingHeightM)が使うのと同じ判定にそろえる。
  var raise=isOuter?wallRaiseRoofs(w):[];
  // 実際にどこかで壁を持ち上げる屋根だけを残す。壁に直に載る陸屋根(ほとんどの家)
  // まで数えると、何も変わらない壁まで折れ線の作り方に回ってしまう。
  if(raise.length){
    var topY=floorBaseY(w.floor||1)+wallDisplayHeightM(w);
    var dxr=w.x2-w.x1, dyr=w.y2-w.y1;
    raise=raise.filter(function(rf){
      for(var i=0;i<=16;i++){
        var y=wallRaiseTopWorldY(w,[rf],w.x1+dxr*i/16,w.y1+dyr*i/16);
        if(y!==null&&y>topY+0.001) return true;
      }
      return false;
    });
  }
  if(!touches&&!raise.length&&!sameFloor.length) return null;
  // 外壁の下限は階高。ただし**高さを個別に指定した外壁は、その高さを下限にする。**
  // 勾配天井の部屋に面した壁は天井の高さから上端を組むので、階高より高く指定した
  // 外壁(3500mm など)でも天井(3400mm)で止まり、持ち上がった陸屋根とのあいだが
  // 空いた(利用者のプラン)。屋根が覆う位置では、このあと屋根で切られる。
  var minH;
  if(isOuter){
    minH=wallFullHeightM(w&&w.floor);
    var explicitH=w&&w.wallHeight!==undefined&&isFinite(Number(w.wallHeight))&&
      Number(w.wallHeight)!==defaultWallHeightMmForFloor(w.floor);
    if(explicitH) minH=Math.max(minH,wallDisplayHeightM(w));
  }
  return {
    minH:minH,
    roofs:touches?wallLimitingRoofs(w):[],
    raise:raise,
    // 同じ階の勾配屋根の下を通る壁は、屋根の板の**下面**で止める(上面で止めると、
    // 屋根の縁に立つ妻壁の天端が屋根の面と重なり、縁に沿って白くちらついた)。
    under:sameFloor
  };
}
// この壁と**同じ階に載っている**屋根のうち、壁の芯線にかかっているもの。
// 下屋(1階の上に載る片流れ)は2階の床の高さに据わるので、2階に立てた壁は
// その屋根の下を通る。壁は屋根を突き抜けないので、ここで屋根の下面で切る。
// 下屋と別の屋根のあいだにできる三角形の隙間は、この壁(妻壁)で塞ぐ
// (利用者の選択。屋根の板を下へ伸ばして塞ぐのはやめた)。
function wallSameFloorRoofs(w){
  var out=[];
  if(!w||typeof DATA==='undefined'||!DATA||!DATA.items) return out;
  var dx=w.x2-w.x1, dy=w.y2-w.y1;
  if(Math.hypot(dx,dy)<1) return out;
  var fl=w.floor||1;
  DATA.items.forEach(function(it){
    if(!it||it.type!=='roof'||it.hidden3D||(it.floor||1)!==fl) return;
    // 同じ階の**陸屋根**は壁の足元の高さにある(下屋の平らな屋根)。壁はその上に
    // 立つのであって、下をくぐるのではない。数えると、陸屋根の縁に立てた妻壁が
    // 高さ0まで切られた(利用者のプランで確認)。
    if((it.roofType||'gable')==='flat') return;
    for(var i=0;i<=8;i++){
      var t=i/8;
      if(roofCoversPlanPoint(it,w.x1+dx*t,w.y1+dy*t)){ out.push(it); return; }
    }
  });
  return out;
}
// ── 外壁を屋根の下面まで立ち上げる ──────────────────────────────────────
// 勾配のある屋根(片流れ・切妻・寄棟…)の下では、外壁の天端と屋根のあいだに
// 屋根なりの隙間ができる。以前は**屋根の板を下へ伸ばして**(片流れの側面の台形、
// 切妻の三角形)塞いでいたが、そういう形の屋根の家はまず無い(利用者の指摘)。
// 実物どおり、外壁の方を屋根の下面まで立ち上げる(妻壁)。
//
// 対象は外皮に面した壁だけ。間仕切りは天井までで止まり、天井裏は見えない。
// 屋根は、壁の階の真上の階に載る屋根で、壁の芯線のどこかを覆っているもの
// (陸屋根も、高さ Z で持ち上げていれば隙間を作るので含める)。
function wallRaiseRoofs(w){
  var out=[];
  if(!w||typeof DATA==='undefined'||!DATA||!DATA.items) return out;
  var dx=w.x2-w.x1, dy=w.y2-w.y1;
  if(Math.hypot(dx,dy)<1) return out;
  var fl=(w.floor||1)+1;
  DATA.items.forEach(function(it){
    if(!it||it.type!=='roof'||it.hidden3D||(it.floor||1)!==fl) return;
    // 陸屋根も数える。高さ Z で持ち上げた陸屋根(片流れから切り替えると Z が残る)は、
    // 壁の天端とのあいだに隙間を作る(報告された: 陸屋根の下に謎の空間)。
    // 立ち上げは上げるだけなので、壁に直に載っている陸屋根では何も起きない。
    for(var i=0;i<=8;i++){
      var t=i/8;
      if(roofCoversPlanPoint(it,w.x1+dx*t,w.y1+dy*t)){ out.push(it); return; }
    }
  });
  return out;
}
// 同じ階の勾配屋根の下をくぐる壁の天端(ワールドm)。屋根ごとには板の下面の
// いちばん低い点(壁の厚みぶんで突き抜けない)を採り、**屋根どうしでは高い方**を採る。
// 2枚の片流れの境に立つ妻壁は、高い方の屋根まで立ち上がって隙間を塞ぎ、低い方の
// 屋根はその壁の横腹に突き当たる(実際の納まり)。低い方で切ると、高い方の屋根の
// 下に細いすき間が開き、室内から屋根の裏が見えた(報告された)。
function wallUnderRoofTopWorldY(w,roofs,xMm,yMm){
  if(!roofs||!roofs.length) return null;
  var best=null;
  roofs.forEach(function(rf){
    var y=wallRaiseTopWorldY(w,[rf],xMm,yMm);
    if(y!==null&&(best===null||y>best)) best=y;
  });
  return best;
}
// 立ち上げる先の高さ(ワールドm)。屋根の板の**下面**(上面から屋根厚を引く)まで。
// 上面まで上げると、壁の天端が屋根の面と重なってちらつく。壁の芯と両面の3点で
// いちばん低いところに合わせる(屋根を突き抜けない)。覆っていない点は null。
function wallRaiseTopWorldY(w,roofs,xMm,yMm){
  if(!roofs||!roofs.length) return null;
  var dx=w.x2-w.x1, dy=w.y2-w.y1, len=Math.hypot(dx,dy);
  var nx=len>0?-dy/len:0, ny=len>0?dx/len:0;
  var halfMm=(w.thick||120)/2;
  var best=null;
  [[0,0],[nx*halfMm,ny*halfMm],[-nx*halfMm,-ny*halfMm]].forEach(function(o){
    roofs.forEach(function(rf){
      if(!roofCoversPlanPoint(rf,xMm+o[0],yMm+o[1])) return;
      // 勾配屋根の板は面から下へ屋根厚ぶん伸びる。陸屋根の板は面(据え付け高さ)の
      // **上に**載る(build3DRoofItem の flat)ので、板の下面は面そのもの。
      var thick=((rf.roofType||'gable')==='flat')?0:Math.max(30,Math.min(600,Number(rf.roofThickness)||180))*U;
      var y=roofUndersideWorldYAt(rf,xMm+o[0],yMm+o[1])-thick;
      if(best===null||y<best) best=y;
    });
  });
  return best;
}
// 立ち上げの高さ(wallRaiseTopWorldY)を、屋根の縁の**少し外**でも返す版。
// 屋根の縁に上階の壁が立ち、その端が下階の壁の上に載る隅(利用者のプラン:
// 片流れの縁に立つ2階の壁と、屋根の下を立ち上がる1階の外壁)では、屋根が
// 上階の壁の内面から始まるので、下階の壁は上階の壁の下の区間で立ち上がらない。
// 上階の壁は下階の壁の内面で止まるため、隅の上半分が欠け、しかも立ち上がりの
// 境が上辺の刻み(60mm)で斜めの辺になって隙間とめり込みに見えた。
// 上階の壁の足元にあたる区間だけ、壁に沿っていちばん近い屋根の位置の高さを使う。
function wallRaiseTopNearWorldY(w,roofs,xMm,yMm){
  var y=wallRaiseTopWorldY(w,roofs,xMm,yMm);
  if(y!==null||!roofs||!roofs.length) return y;
  var reach=wallRaiseBridgeReachMm(w,xMm,yMm);
  if(!(reach>0)) return null;
  var dx=w.x2-w.x1, dy=w.y2-w.y1, len=Math.hypot(dx,dy);
  if(len<1) return null;
  var ux=dx/len, uy=dy/len, d, s;
  for(d=5;d<=reach;d+=5){
    for(s=-1;s<=1;s+=2){
      y=wallRaiseTopWorldY(w,roofs,xMm+ux*d*s,yMm+uy*d*s);
      if(y!==null) return y;
    }
  }
  return null;
}
// その点が、この壁と直交して**そこで終わる**上階の壁の足元(端の先は下階の壁の
// 厚みぶんまで)にあれば、屋根を探しに行ってよい距離(mm)。無ければ 0 -- 屋根の
// 縁の外で壁が勝手に立ち上がり、屋根の上へ突き出すことはしない。
// 下階の壁の真上を同じ向きに走る普通の上階の壁は対象外(そこで立ち上げると、
// 上階の壁の中に下階の壁が重なる)。
function wallRaiseBridgeReachMm(w,xMm,yMm){
  if(typeof DATA==='undefined'||!DATA||!DATA.walls) return 0;
  var wdx=w.x2-w.x1, wdy=w.y2-w.y1, wlen=Math.hypot(wdx,wdy);
  if(wlen<1) return 0;
  var up=(w.floor||1)+1, ext=(w.thick||120)/2+20, i, u, udx, udy, ulen, t, p;
  for(i=0;i<DATA.walls.length;i++){
    u=DATA.walls[i];
    if(!u||u===w||(u.floor||1)!==up||u.vis3D==='hide') continue;
    udx=u.x2-u.x1; udy=u.y2-u.y1; ulen=Math.hypot(udx,udy);
    if(ulen<1) continue;
    if(Math.abs(wdx*udx+wdy*udy)/(wlen*ulen)>0.2) continue;       // 直交していない
    t=((xMm-u.x1)*udx+(yMm-u.y1)*udy)/ulen;
    if(!(Math.abs(t)<=ext||Math.abs(t-ulen)<=ext)) continue;       // 端がここで終わっていない
    p=Math.abs((xMm-u.x1)*udy-(yMm-u.y1)*udx)/ulen;
    if(p<=(u.thick||120)/2+20) return (u.thick||120)+40;
  }
  return 0;
}
// 上辺のサンプリング間隔(m)。棟や隅棟の折れをこの刻みで折れ線に落とす。
// 天井面(CEILING_SAMPLE_STEP_M)より細かく採る。折れをまたぐ区間では弦が真の面より
// 下に落ちるので、粗い側(天井)より細かい側(壁)を高く保たないと隙間が開く。
var WALL_TOP_SAMPLE_STEP_M=0.06;
// 同じ直線に乗っている点を落とす(高さの差が 0.5mm 未満)。図面の点列を短くする
// ためだけのもので、0.5mm は立面図が既に採っている段差の判定と同じ値である。
function wallTopProfileSimplify(pts){
  var out=[pts[0]], i, a, b, c, span, mid;
  for(i=1;i<pts.length-1;i++){
    a=out[out.length-1]; b=pts[i]; c=pts[i+1];
    span=c[0]-a[0];
    mid=span>1e-9 ? a[1]+(c[1]-a[1])*((b[0]-a[0])/span) : b[1];
    if(Math.abs(b[1]-mid)>=0.0005) out.push(b);
  }
  out.push(pts[pts.length-1]);
  return out;
}
// 壁の上端の折れ線。[[t(0..1), 高さm], ...] を t 昇順で返す。高さはその階の
// floorBaseY 基準で、壁自身の高さ(wallDisplayHeightM)は超えない -- 3D の
// slopedTopAt と同じ頭打ちである。
// **実際には削られていない壁では null**。立面図はこれを受け取って上端を引く。
function wallTopProfileM(w){
  var env=wallTopCutEnv(w);
  if(!env) return null;
  var dx=w.x2-w.x1, dy=w.y2-w.y1;
  var lenMm=Math.sqrt(dx*dx+dy*dy);
  if(lenMm<1) return null;
  var fullH=wallDisplayHeightM(w);
  var n=Math.max(2,Math.min(400,Math.ceil((lenMm*U)/WALL_TOP_SAMPLE_STEP_M)));
  var pts=[], flat=true, i, t, h;
  for(i=0;i<=n;i++){
    t=i/n;
    h=wallTopHeightAtM(w,t,fullH,env.minH,env.roofs,env.raise,env.under);
    // 壁自身の高さは超えない。ただし屋根の下面まで立ち上げる外壁は、そこまで上がる。
    if(h>fullH&&!(env.raise&&env.raise.length)) h=fullH;
    if(h<0.001) h=0.001;
    pts.push([t,h]);
    if(Math.abs(h-fullH)>=0.0005) flat=false;
  }
  if(flat) return null;   // 頭を押さえる物が無かった = 従来のまっすぐな上辺
  return wallTopProfileSimplify(pts);
}
// 壁の上端の、平面上の1点(壁の芯線へ下ろした位置)での高さ(ワールドm)。
// wallTopProfileM と同じ規則を1点だけで評価する。全長の折れ線を作るより軽いので、
// 壁の隅の取り合い(wallJoinsAtCorner)のように何度も呼ぶ所ではこちらを使う。
function wallTopWorldYAtPointM(w,px,py){
  var fb=floorBaseY(w.floor||1), fullH=wallDisplayHeightM(w);
  // 上端の決め方(外壁か・どの屋根か)は壁ごとに決まる。描画1回ぶんの覚え
  // (_roofBaseCache)があれば、そこに壁ごとに1度だけ求めて置く。
  var cache=(typeof _roofBaseCache!=='undefined'&&_roofBaseCache)?_roofBaseCache:null;
  var envs=cache?(cache.__wallTopEnv=cache.__wallTopEnv||new Map()):null;
  var env;
  if(envs&&envs.has(w)) env=envs.get(w);
  else { env=wallTopCutEnv(w); if(envs) envs.set(w,env); }
  if(!env) return fb+fullH;
  var dx=w.x2-w.x1, dy=w.y2-w.y1, len2=dx*dx+dy*dy;
  if(len2<1) return fb+fullH;
  var t=Math.max(0,Math.min(1,((px-w.x1)*dx+(py-w.y1)*dy)/len2));
  var h=wallTopHeightAtM(w,t,fullH,env.minH,env.roofs,env.raise,env.under);
  if(h>fullH&&!(env.raise&&env.raise.length)) h=fullH;
  return fb+h;
}
// 壁1枚が届くべき高さ(m)。壁は2つの部屋の境界にあるので、接する部屋の天井高の
// 最大値を採る。低い方に合わせて切ると高い側の部屋に穴が開くので、最大値以外は
// 選べない。ただし片側でも部屋に面していない壁(=外皮に面する壁)は階高まで伸ばす:
// そこを天井高まで下げると、外壁と上階の床のあいだに家の外まで抜ける穴が開く。
function wallCeilingHeightM(w){
  var envelopeM=wallFullHeightM(w&&w.floor);
  if(!w) return envelopeM;
  var adj=wallAdjacentRoomsCeiling(w);
  if(!adj.found) return envelopeM;
  var h=adj.enclosed ? adj.maxM : Math.max(adj.maxM,envelopeM);
  var cap=wallStackedAboveCapM(w);
  return (cap!==null && cap<h) ? cap : h;
}
// この壁とほぼ同じ線・同じ区間に **上階の壁** が在るか。在るなら、そこから
// 上は上階の壁が受け持つので、吹き抜けの天井まで伸ばしてはいけない。
// 伸ばすと同じ場所に壁が2枚立ち、
//   - 外から見て重なった面がちらつく
//   - 上階の壁に開けた窓の背後が下階の壁で塞がれる
// という2つが同時に起きる(3階の吹き抜けの高窓がこれで見えなくなっていた)。
// 一部しか覆われていない場合は切らない。切ると覆われていない側に穴が開く。
function wallStackedAboveCapM(w){
  if(!w || !DATA || !DATA.walls) return null;
  var dx=w.x2-w.x1, dy=w.y2-w.y1;
  var len=Math.sqrt(dx*dx+dy*dy);
  if(len<1) return null;
  var ux=dx/len, uy=dy/len;
  var half=((w.thick||120)/2)+40;
  var up=(w.floor|0)+1, spans=[], i, o, odx, ody, olen, p1, p2, t1, t2;
  for(i=0;i<DATA.walls.length;i++){
    o=DATA.walls[i];
    if(o===w || (o.floor|0)!==up) continue;
    odx=o.x2-o.x1; ody=o.y2-o.y1;
    olen=Math.sqrt(odx*odx+ody*ody);
    if(olen<1) continue;
    if(Math.abs((odx/olen)*ux+(ody/olen)*uy)<0.999) continue;   // 平行でない
    p1=-(o.x1-w.x1)*uy+(o.y1-w.y1)*ux;
    p2=-(o.x2-w.x1)*uy+(o.y2-w.y1)*ux;
    if(Math.abs(p1)>half || Math.abs(p2)>half) continue;        // 同じ線に乗っていない
    t1=(o.x1-w.x1)*ux+(o.y1-w.y1)*uy;
    t2=(o.x2-w.x1)*ux+(o.y2-w.y1)*uy;
    spans.push([Math.max(0,Math.min(t1,t2)),Math.min(len,Math.max(t1,t2))]);
  }
  if(!spans.length) return null;
  spans.sort(function(a,b){return a[0]-b[0];});
  var covered=0, curA=spans[0][0], curB=spans[0][1];
  for(i=1;i<spans.length;i++){
    if(spans[i][0]>curB){ covered+=Math.max(0,curB-curA); curA=spans[i][0]; curB=spans[i][1]; }
    else if(spans[i][1]>curB) curB=spans[i][1];
  }
  covered+=Math.max(0,curB-curA);
  if(covered<len*0.95) return null;
  return Math.max(0.3,floorBaseY(up)-floorBaseY(w.floor|0));
}

var ISIZES = {
  bath:{w:1600,d:1600}, toilet:{w:380,d:680}, sink:{w:750,d:560},
  kitchen:{w:2550,d:650}, fridge:{w:650,d:700}, washer:{w:640,d:640},
  sofa:{w:2100,d:850}, loveseat_2p:{w:1500,d:850}, low_table:{w:900,d:500},
  'dining-table':{w:1200,d:800}, dining_6:{w:1600,d:900}, round_table_4:{w:1000,d:1000},
  'bed-d':{w:1400,d:1950}, 'bed-s':{w:970,d:1950}, semi_double_bed:{w:1200,d:1950},
  futon_set:{w:1000,d:2100}, desk:{w:1200,d:600}, tv:{w:1200,d:400},
  'custom-block':{w:900,d:450}, column:{w:180,d:180}, 'column-round':{w:180,d:180},
  'light-ceiling':{w:450,d:450}, 'light-down':{w:180,d:180}, 'light-spot':{w:260,d:180},
  memo:{w:760,d:460}, 'walk-route':{w:3000,d:140},
  closet:{w:1800,d:600}, shoe_cabinet:{w:1200,d:400}, 'shelf-built-in':{w:1800,d:350}, stair:{w:910,d:2730}, 'stair-corner':{w:910,d:910}, 'stair-landing':{w:1820,d:910},
  balcony:{w:1820,d:910}, tree:{w:1500,d:1500}, car:{w:2083,d:4790}, bicycle:{w:580,d:1850}, 'bicycle-fold':{w:550,d:1450}, fence:{w:1820,d:120}, 'wood-fence':{w:1820,d:120}, 'lattice-screen':{w:1800,d:60},

  // 隣家の既定は 8P×7P(7280×6370) = 1階46.4m² / 2階建て延べ約28坪。
  // 日本の建売住宅の最も標準的な規模で、910モジュールにも正確に載る。
  'neighbor-building':{w:5200,d:3600}, 'neighbor-house':{w:7280,d:6370}, road:{w:9000,d:4000}, 'utility-pole':{w:350,d:350},
  'ac-outdoor':{w:800,d:300}, 'water-heater':{w:630,d:760}, 'gas-heater':{w:470,d:240}, 'meter-box':{w:180,d:120}, 'sewer-pit':{w:300,d:300},
  'downspout':{w:150,d:150},
  foundation:{w:7280,d:4095}, 'exterior-stair':{w:910,d:1200}, ramp:{w:1200,d:2400},
  'door-swing':{w:780,d:780}, 'door-swing-s':{w:650,d:650}, 'door-slide':{w:1650,d:150}, 'door-fold':{w:780,d:420}, 'door-fold-w':{w:1650,d:420}, 'door-slide-s':{w:780,d:150}, 'door-pocket':{w:780,d:150},
  window:{w:1650,d:150}, 'window-door':{w:1650,d:180}, 'door-front':{w:940,d:200},
  'door-opening':{w:780,d:160}, 'door-opening-arch':{w:900,d:160},
  'site-rect':{w:10000,d:8000},
  'roof':{w:7280,d:4095}
};
// LIXIL系サッシ呼称寸法プリセット(W×H mm)。sill はまぐさ高2000基準。
var WINDOW_STD_PRESETS=[
  {id:'02607', label:'02607 縦すべり出し W260×H770',   w:260,  h:770,  kind:'window', win:'casement'},
  {id:'03613', label:'03613 縦すべり出し W405×H1370',  w:405,  h:1370, kind:'window', win:'casement'},
  {id:'06905', label:'06905 引違い W690×H570',        w:690,  h:570,  kind:'window'},
  {id:'07409', label:'07409 引違い W780×H970',        w:780,  h:970,  kind:'window'},
  {id:'11909', label:'11909 引違い W1235×H970',       w:1235, h:970,  kind:'window'},
  {id:'16509', label:'16509 引違い W1690×H970',       w:1690, h:970,  kind:'window'},
  {id:'16511', label:'16511 引違い W1690×H1170',      w:1690, h:1170, kind:'window'},
  {id:'16513', label:'16513 引違い W1690×H1370',      w:1690, h:1370, kind:'window'},
  {id:'16520', label:'16520 掃き出し W1690×H2030',    w:1690, h:2030, kind:'window-door'},
  {id:'25620', label:'25620 掃き出し W2600×H2030',    w:2600, h:2030, kind:'window-door'},
  {id:'F03613', label:'FIX 03613 W405×H1370',        w:405,  h:1370, kind:'window', win:'fix'},
  {id:'F06013', label:'FIX 06013 W600×H1370',        w:600,  h:1370, kind:'window', win:'fix'},
  {id:'F11913', label:'FIX 11913 W1235×H1370',       w:1235, h:1370, kind:'window', win:'fix'},
  {id:'F16503', label:'FIX 16503 W1690×H370 (高窓)',  w:1690, h:370,  kind:'window', win:'fix', sill:1800}
];
function windowStdSill(p){ if(p.sill!==undefined) return p.sill; return p.kind==='window-door' ? 0 : Math.max(0, 2000 - p.h); }
function windowStdPresetById(id){
  for(var i=0;i<WINDOW_STD_PRESETS.length;i++){ if(WINDOW_STD_PRESETS[i].id===id) return WINDOW_STD_PRESETS[i]; }
  return null;
}
// 窓種別の実効値。すべり出し規格を選んだ既存プランは windowKind='sliding' で保存されているため、
// 規格側の win:'casement' を優先して框なしとして扱う(過去プラン互換)
function effectiveWindowKind(it){
  if(it.windowKind==='fix'||it.windowKind==='casement') return it.windowKind;
  var p=it.windowStd?windowStdPresetById(it.windowStd):null;
  if(p&&p.win==='casement') return 'casement';
  return it.windowKind||'sliding';
}
// LIXILアルミ樹脂複合サッシ風カラー(シャイングレーがカタログ標準色)。未設定(undefined)時は既存プラン互換のため現行色を維持する。
// 室内照明の色温度プリセット(JIS光色区分の近似色)
var LIGHT_KELVIN_PRESETS=[
  {label:'電球色', color:'#ffd9a6'},
  {label:'温白色', color:'#ffe9cc'},
  {label:'昼白色', color:'#fff8f0'},
  {label:'昼光色', color:'#eef3ff'}
];
var SASH_COLORS=[
  {hex:'#9a9da1', label:'シャイングレー'},
  {hex:'#22252a', label:'ブラック'},
  {hex:'#f2f2f0', label:'ホワイト'}
];
// 室内開きドアの規格幅プリセット(LIXIL実勢値ベース)
var DOOR_STD_WIDTHS=[
  {w:650, label:'W650 (トイレ・洗面)'},
  {w:750, label:'W750 (標準)'},
  {w:780, label:'W780 (標準・広め)'}
];
function applyDoorWidthPreset(w){
  var it=ST.selected;
  if(!it || !isInteriorSwingDoorType(it.type)) return;
  if(isObjectLocked(it)){ updateProps(); return; }
  w=Number(w);
  if(!isFinite(w) || w<=0) return;
  saveState();
  var oldCx=(it.x||0)+(it.w||0)/2, oldCy=(it.y||0)+(it.d||0)/2;
  it.w=w; it.d=w;
  it.x=oldCx-it.w/2; it.y=oldCy-it.d/2;
  draw2d();
  if(ren) rebuild3D();
  updateProps();
}
function applyWindowStdPreset(id){
  var it=ST.selected;
  if(!it || !isWindowLikeType(it.type)) return;
  if(isObjectLocked(it)){ updateProps(); return; }
  var p=null;
  for(var i=0;i<WINDOW_STD_PRESETS.length;i++){ if(WINDOW_STD_PRESETS[i].id===id){p=WINDOW_STD_PRESETS[i];break;} }
  if(!p) return;
  saveState();
  var oldCx=(it.x||0)+(it.w||0)/2, oldCy=(it.y||0)+(it.d||0)/2;
  it.w=p.w;
  it.x=oldCx-it.w/2; it.y=oldCy-(it.d||150)/2;
  it.windowSill=windowStdSill(p);
  it.windowHeight=p.h;
  it.windowStd=p.id;
  if(it.type==='window'){
    if(p.win) it.windowKind=p.win;
    else if(p.kind==='window') it.windowKind='sliding';
  }
  normalizeWindowVerticalProps(it,'windowHeight');
  draw2d();
  if(ren) rebuild3D();
  updateProps();
}
var ICOLORS = {
  bath:'#b8d4f0', toilet:'#d4e8f0', sink:'#c8e0f8', kitchen:'#f0d8a8',
  fridge:'#d0e8d0', sofa:'#e0c8a8', 'dining-table':'#f0e0b0',
  'bed-d':'#d8d0e8','bed-s':'#d8d0e8', desk:'#c8d8e0',
  tv:'#1a1a1a', 'custom-block':'#c9d7ee', column:'#cfc6b6', 'column-round':'#cfc6b6', 'light-ceiling':'#fff6dd', 'light-down':'#fff6dd', 'light-spot':'#fff6dd', memo:'#fff3a6', ruler:'#2f80ed', 'walk-route':'#10b981', closet:'#e8d8c8', 'shelf-built-in':'#e6dcc8', 'stair-landing':'#e8e0c8', stair:'#e8e0c8', 'stair-corner':'#e8e0c8', balcony:'#c8e8c8', car:'#c8c8d8', bicycle:'#a8b4c4', 'bicycle-fold':'#d8a878', fence:'#909080', 'wood-fence':'#9a7a3a', 'lattice-screen':'#b09468',
  'neighbor-building':'#8f98a3','neighbor-house':'#b9bcc2',road:'#55585c','utility-pole':'#8c9297',
  'ac-outdoor':'#d8dadc', 'water-heater':'#e8e9eb', 'gas-heater':'#e8e9eb', 'meter-box':'#c8cacc', 'sewer-pit':'#6f7275', 'downspout':'#9aa0a5',
  foundation:'#b8b2a8','exterior-stair':'#b8b2a8',ramp:'#b8b2a8',
  'door-swing':'#f8e8c0','door-swing-s':'#f8e8c0','door-slide':'#f8e8c0','door-fold':'#f8e8c0','door-fold-w':'#f8e8c0','door-slide-s':'#f8e8c0','door-pocket':'#f8e8c0',
  window:'#c0e4f8','window-door':'#b8dcff','door-front':'#f8d0a0',
  'door-opening':'#f6efe2','door-opening-arch':'#f6efe2','site-rect':'rgba(100,160,100,0.1)',
  'roof':'rgba(50,50,80,0.12)'
};
// GLTF_MAP: PBR furniture GLBs. Some assets are exported from Unity Furniture Mega Pack via glTFast.
var GLTF_MAP = {
  'sofa':'assets/models/unity_exported/Sofa01.glb', 'loveseat_2p':'assets/models/unity_exported/Sofa02.glb',
  'bed-d':'assets/models/unity_exported/Bed01.glb', 'bed-s':'assets/models/unity_exported/Bed01.glb',
  'semi_double_bed':'assets/models/unity_exported/Bed01.glb',
  'dining-table':'assets/models/dining_table.glb', 'dining_6':'assets/models/dining_table.glb',
  'tv':'assets/models/unity_exported/MediaConsole.glb',
  'bath':'assets/models/unity_exported/BathTub01.glb',
  'toilet':'assets/models/unity_exported/Toilet01.glb',
  'sink':'assets/models/unity_exported/WashBasin01.glb',
  'desk':'assets/models/desk.glb',
  'closet':'assets/models/unity_exported/Closet01.glb', 'shoe_cabinet':'assets/models/unity_exported/Drawer01.glb',
  'fridge':'assets/models/unity_exported/Refrigerator01.glb', 'washer':'assets/models/unity_exported/Washing_Machine.glb'
};
var _modelCache = {};
var _modelLoading = {};
var _modelFailed = {};
var UNITY_FURNITURE_MODELS = {
  table:'assets/models/unity_exported/Table01.glb',
  chair:'assets/models/unity_exported/Chair01.glb',
  kitchenCabinet:'assets/models/unity_exported/CabinetA01.glb',
  kitchenSink:'assets/models/unity_exported/CabinetA_Sink.glb',
  kitchenStove:'assets/models/unity_exported/GasStove01.glb'
};
var GLTF_MODEL_CONFIG = {
  loveseat_2p:{rotY:Math.PI},
  toilet:{rotY:Math.PI},
  'bed-d':{rotY:Math.PI},
  'bed-s':{rotY:Math.PI},
  semi_double_bed:{rotY:Math.PI},
  tv:{uniformFit:true, fitScale:1.12, rotY:-Math.PI/2, removeTallSkinny:true, groundMesh:'mediaConsole_body'},
  washer:{rotY:Math.PI},
  fridge:{metalness:0.04},
  'fmp-Refrigerator01':{metalness:0.04},
  'fmp-Refrigerator02':{metalness:0.04},
  'fmp-Refrigerator03':{metalness:0.04},
  'fmp-Refrigerator04':{metalness:0.04},
  'fmp-Refrigerator05':{metalness:0.04},
  'fmp-Refrigerator06':{metalness:0.04},
  'fmp-Refrigerator07':{metalness:0.04}
};
var EXTERIOR_MODEL_IDS={'ac-outdoor':'original-ac-unit','water-heater':'original-tank','gas-heater':'original-gas-unit','meter-box':'original-meter','sewer-pit':'original-drain-cover'};
var EXTERIOR_MODEL_URLS={};Object.keys(EXTERIOR_MODEL_IDS).forEach(function(type){EXTERIOR_MODEL_URLS[type]='assets/models/original/'+EXTERIOR_MODEL_IDS[type]+'.glb';});
function getItemFinishModel(type){return getFmpItem(type)||getFmpItem(EXTERIOR_MODEL_IDS[type]);}
function buildDetailedExterior(grp,it,w,d,h){
  var url=EXTERIOR_MODEL_URLS[it.type];
  if(!url || !ensureGltfModel(url)) return false;
  var clone=makeGltfBoxFitClone(url,w,h,d,it.colorCustom?it.color:null);
  ModelQuality.applyFinishes(clone,it.finishColors,it.finishRoughness,it.finishTextures,typeof FINISH_TEXTURE_DEPS==='object'?FINISH_TEXTURE_DEPS:null);grp.add(clone);return true;
}
var FMP_MANIFEST_URL = 'assets/models/furniture_mega/manifest.json';
var INTERIOR_MODEL_MANIFEST_URL = 'assets/models/interior_model_0_26_1/manifest.json';
var CUSTOM_MODEL_MANIFEST_URL = 'assets/models/custom/manifest.json';
var FMP_MANIFEST_SOURCES = [
  {url:FMP_MANIFEST_URL, globalName:'FMP_MANIFEST'},
  {url:INTERIOR_MODEL_MANIFEST_URL, globalName:'INTERIOR_MODEL_MANIFEST'},
  {url:CUSTOM_MODEL_MANIFEST_URL, globalName:'CUSTOM_MODEL_MANIFEST'}
];
// カタログ753点の分類。tools/tag_catalogue.mjs が作る。
//
// なぜ別のファイルなのか
// ----------------------
// manifest の category は、取り込み元3つのフォルダ構造をそのまま引きずって
// いる。同じものが別の名前に散り(キッチンが4か所、収納が4か所)、中身の
// 取り違えもある(「窓」にシェルフ、「絵画」にシェルフ、「家電」に冷蔵庫)。
//
// **category は消さない。** 保存済みのプランはモデルを名前で持っているので、
// 分類を差し替えるのではなく、その上に新しい軸(kind)を足す。
//
// 読めなければ、これまでどおり category で並べる。
var CATALOGUE_TAGS_URL = 'assets/models/tags.json';
var CATALOGUE_TAGS = null;
// 外部アセットの「色を変えられる部位」。tools/assign_finish_channels.mjs が作る。
//
// **仕組みは前からあり、手書きの2点にしか繋がっていなかった。** 685点中684点が
// テクスチャ付きで、applySelectableColor はテクスチャ付きを避けるため、外部
// アセットはほぼ色を変えられなかった。ここを全点に配線する。
// 読めなければ、これまでどおり色を変えられないだけ(見た目は変わらない)。
var CATALOGUE_FINISHES_URL = 'assets/models/finishes.json';
var CATALOGUE_FINISHES = null;
var FMP_ITEMS = {};
var FMP_TOP_IMAGES = {};
var FMP_TOP_CROPS = {};
var LEGACY_FMP_TYPE_MAP = {
  bath:'fmp-BathTub01',
  toilet:'fmp-Toilet01',
  sink:'fmp-WashBasin01',
  kitchen:'fmp-CabinetA01',
  fridge:'fmp-Refrigerator01',
  sofa:'fmp-Sofa01',
  loveseat_2p:'fmp-Sofa02',
  'dining-table':'fmp-Table01',
  dining_6:'fmp-Table01',
  low_table:'fmp-Table01',
  'bed-d':'fmp-Bed01',
  'bed-s':'fmp-Bed01',
  semi_double_bed:'fmp-Bed01',
  desk:'fmp-Table01',
  closet:'fmp-Closet01',
  shoe_cabinet:'fmp-Drawer01'
};
function isFmpItemType(type){ return !!(type && FMP_ITEMS[type]); }
function getFmpItem(type){ return FMP_ITEMS[type]||null; }
function bestFmpType(type){ return LEGACY_FMP_TYPE_MAP[type]||type; }
function getItemDefaultSize(type){
  type=bestFmpType(type);
  var fmp=getFmpItem(type);
  if(fmp) return {w:fmp.w||900,d:fmp.d||900,h:fmp.h||600};
  return ISIZES[type]||{w:900,d:900};
}
function hasCustomPlanSize(it){
  if(!it || it.w===undefined || it.d===undefined) return false;
  var sz=getItemDefaultSize(it.type);
  return Math.abs((it.w||0)-(sz.w||0))>1 || Math.abs((it.d||0)-(sz.d||0))>1;
}
function escHtml(s){
  return String(s||'').replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});
}
function isAppearanceColorInput(inp){
  // Every native color input must keep the same DOM node for as long as the
  // browser's picker is open. Replacing the node from an onchange handler
  // dismisses the picker on iOS (and some Android browsers) after one tap.
  return !!(inp && inp.matches && inp.matches('input[type="color"]') && !inp.disabled);
}
var _activeAppearanceColorInput = null;
function beginAppearanceColorInput(inp){
  if(isAppearanceColorInput(inp)) _activeAppearanceColorInput=inp;
}
function isAppearanceColorInputActive(){
  return !!_activeAppearanceColorInput;
}
function releaseAppearanceColorInput(commit){
  if(!_activeAppearanceColorInput) return;
  _activeAppearanceColorInput=null;
  if(commit) setTimeout(commitAppearanceColorEdits,0);
}
function initNativeColorInputs(){
  if(initNativeColorInputs._done) return;
  initNativeColorInputs._done=true;
  document.addEventListener('pointerdown',function(e){
    var inp=e.target&&e.target.closest?e.target.closest('input[type="color"]'):null;
    if(isAppearanceColorInput(inp)){
      beginAppearanceColorInput(inp);
    } else {
      releaseAppearanceColorInput(true);
    }
  },true);
  document.addEventListener('focusin',function(e){
    if(isAppearanceColorInput(e.target)) beginAppearanceColorInput(e.target);
    else releaseAppearanceColorInput(true);
  },true);
  document.addEventListener('input',function(e){
    if(isAppearanceColorInput(e.target)) beginAppearanceColorInput(e.target);
  },true);
  document.addEventListener('change',function(e){
    if(isAppearanceColorInput(e.target)){
      beginAppearanceColorInput(e.target);
      // Do not commit/render here. Mobile browsers can emit `change` for each
      // sampled color while their picker is still open; rendering would remove
      // the input node and force-close that picker. The edit is committed when
      // the user returns to the page and interacts with a non-color control.
    }
  },true);
}
function mergeFurnitureMegaManifest(manifest){
  (manifest.items||[]).forEach(function(item){
    FMP_ITEMS[item.id]=item;
    applyCatalogueTag(item);
    applyFinishChannels(item);
  });
}
// 分類を1点に貼る。タグが無ければ何もしない(これまでどおり category で並ぶ)。
//
// **検索語は tags.json が持っている。** Jev は文章を書けないので、「浴槽」を
// 「バスタブ」「風呂」でも引けるようにする語は人が書いたものである。
// ここでモデル名に混ぜておけば、検索の仕組み(assets/js/asset-catalogue.js)は
// 何も変えずにその語で引けるようになる。
function applyCatalogueTag(item){
  if(!item || !CATALOGUE_TAGS || !CATALOGUE_TAGS.items) return;
  var tag=CATALOGUE_TAGS.items[item.id]; if(!tag) return;
  var kind=(CATALOGUE_TAGS.kinds||{})[tag.kind];
  item.kind=tag.kind;
  item.mount=tag.mount||null;
  item.room=tag.room||null;
  if(kind){
    item.kindJa=kind.ja;
    item.kindGroup=kind.group;
    item.searchWords=[kind.ja].concat(kind.search||[]).join(' ');
  }
}
// 色を変えられる部位を、モデル1点ぶん組み立てる。
//
// 画面(assets/js/app-state.js の selectedModelFinishesHtml)は
// `finishChannels` を回すだけなので、ここに入れれば全点で操作が出る。
// **マニフェストが自前で持っているものは触らない**(自作モデルは登録時に
// GLB から既定色を拾っていて、そちらのほうが正確)。
function applyFinishChannels(item){
  if(!item || (item.finishChannels&&item.finishChannels.length)) return;
  if(!CATALOGUE_FINISHES || !CATALOGUE_FINISHES.models) return;
  var map=CATALOGUE_FINISHES.models[item.model]; if(!map) return;
  var fixed=CATALOGUE_FINISHES.fixed||[];
  var meta=CATALOGUE_FINISHES.channels||{};
  var seen={},out=[];
  Object.keys(map).forEach(function(material){
    var key=map[material];
    // ガラスは色を変えない。操作を出すと、押しても何も起きない欄になる。
    if(!key||seen[key]||fixed.indexOf(key)>=0) return;
    seen[key]=1;
    var m=meta[key]||{};
    out.push({key:key,label:m.ja||key,default:m.color||'#cccccc'});
  });
  if(out.length) item.finishChannels=out;
}

// 並べる見出し。タグがあれば kind、無ければこれまでの category。
function catalogueHeading(item){
  return (item&&item.kindJa)||(item&&item.category)||'その他';
}
// どの大分類の引き出しに入れるか。
//
// **メニューの並びだけを直す。** item.group はこのあとも元のままにしておく。
// あれは assets/js/lock-tiers.js の段位（住設=LOCKED / 家具=SOFT）を決めて
// いて、分類を貼り直したせいで凍結されていたものが黙って自由になる、という
// 倒れ方をさせたくない。見た目の置き場所と、守りの強さは別の話である。
function catalogueGroup(item){
  return (item&&item.kindGroup)||(item&&item.group)||'家具';
}
function applyFurnitureMegaManifest(manifests){
  FMP_ITEMS={};
  (Array.isArray(manifests)?manifests:[manifests]).forEach(function(manifest){
    if(manifest) mergeFurnitureMegaManifest(manifest);
  });
  normalizeLegacyFurnitureItems();
  renderFurnitureMegaLibrary();
  renderOpeningModelToolMenus();
  draw2d();
  if(ren) rebuild3D();
}
function loadFurnitureManifestSource(src){
  return fetch(src.url,{cache:'no-store'}).then(function(r){
    if(!r.ok) throw new Error('manifest '+r.status);
    return r.json();
  }).catch(function(err){
    if(window[src.globalName]) return window[src.globalName];
    console.warn('Furniture manifest not loaded:',src.url,err);
    return null;
  });
}
function loadFurnitureMegaLibrary(){
  // 分類は**マニフェストと一緒に取りに行く**。あとから足すと、一度
  // 古い並びで描いてから描き直すことになり、開いた小見出しが畳まれる。
  var side=function(url){return fetch(url,{cache:'no-store'}).then(function(r){
    return r.ok?r.json():null;
  }).catch(function(){ return null; });};
  Promise.all([side(CATALOGUE_TAGS_URL),side(CATALOGUE_FINISHES_URL)]
    .concat(FMP_MANIFEST_SOURCES.map(loadFurnitureManifestSource))).then(function(all){
    CATALOGUE_TAGS=all[0]||null;
    CATALOGUE_FINISHES=all[1]||null;
    if(CATALOGUE_FINISHES && typeof ModelQuality==='object') ModelQuality.setFinishes(CATALOGUE_FINISHES);
    var manifests=all.slice(2).filter(Boolean);
    if(manifests.length) applyFurnitureMegaManifest(manifests);
  });
}
function isBuildingComponentFmpItem(item){
  return !!(item && (item.category==='ドア' || item.category==='窓'));
}
function isInteriorSwingDoorType(type){
  return type==='door-swing' || type==='door-swing-s';
}
// 開口(開き戸)へ割り当てられる扉のモデル。
//
// **もとは教室のドア5点しか出せなかった。** `Classroom-door-*` という名前で
// 絞っていたためで、住宅用の建具を足しても、カタログに在るのにメニューへ
// 出てこない状態だった。ID で自作のものを拾い足す。
//
// `家具>ドア` の残り5点(丸窓付き・600幅の物置戸など)は住宅の室内建具では
// ないので、これまでどおり出さない。
function isOpeningDoorModel(item){
  if(!item || item.category!=='ドア') return false;
  return /^Classroom-door-/i.test(item.name||'') || /^original-door-/.test(item.id||'');
}
// 旧名。呼んでいるところが残っていても動くように。
function isClassroomDoorModel(item){ return isOpeningDoorModel(item); }
function getOpeningModelItem(it){
  var model=getFmpItem(it&&it.openingModel);
  if(!model) return null;
  if(isWindowLikeType(it.type) && model.category==='窓') return model;
  if(isInteriorSwingDoorType(it.type) && model.category==='ドア') return model;
  return null;
}
var OPENING_DOOR_MODEL_TOOL_PREFIX='opening-door-model:';
var OPENING_WINDOW_MODEL_TOOL_PREFIX='opening-window-model:';
function openingDoorModelToolId(modelId){
  return OPENING_DOOR_MODEL_TOOL_PREFIX+(modelId||'default');
}
function openingWindowModelToolId(modelId){
  return OPENING_WINDOW_MODEL_TOOL_PREFIX+(modelId||'default');
}
function getOpeningModelToolPreset(tool){
  if(typeof tool!=='string') return null;
  if(tool.indexOf(OPENING_DOOR_MODEL_TOOL_PREFIX)===0){
    var doorModelId=tool.slice(OPENING_DOOR_MODEL_TOOL_PREFIX.length);
    if(doorModelId==='default') return {
      kind:'door', baseType:'door-swing', openingModel:'', model:null, label:'開き戸: デフォルト'
    };
    if(doorModelId==='small') return {
      kind:'door', baseType:'door-swing-s', openingModel:'', model:null, label:'開き戸: 小'
    };
    if(doorModelId==='bath-clear-swing'||doorModelId==='bath-clear-fold') return {kind:'door',baseType:doorModelId==='bath-clear-fold'?'door-fold':'door-swing',openingModel:'',model:null,doorFinish:'bath-clear',label:doorModelId==='bath-clear-fold'?'浴室・透明折り戸':'浴室・透明開き戸'};
    var doorModel=getFmpItem(doorModelId);
    if(!doorModel || !isOpeningDoorModel(doorModel)) return null;
    return {
      kind:'door', baseType:'door-swing', openingModel:doorModelId, model:doorModel, label:'開き戸: '+doorModel.name
    };
  }
  if(tool.indexOf(OPENING_WINDOW_MODEL_TOOL_PREFIX)===0){
    var windowModelId=tool.slice(OPENING_WINDOW_MODEL_TOOL_PREFIX.length);
    if(windowModelId==='default') return {
      kind:'window', baseType:'window', openingModel:'', model:null, label:'窓: 引違い'
    };
    if(windowModelId==='fix') return {
      kind:'window', baseType:'window', openingModel:'', model:null, windowKind:'fix', label:'窓: FIX(はめ殺し)'
    };
    if(windowModelId==='window-door') return {
      kind:'window', baseType:'window-door', openingModel:'', model:null, label:'窓: 掃き出し'
    };
    var windowModel=getFmpItem(windowModelId);
    if(!windowModel || windowModel.category!=='窓') return null;
    return {
      kind:'window', baseType:'window', openingModel:windowModelId, model:windowModel, label:'窓: '+windowModel.name
    };
  }
  return null;
}
function openingToolTileHtml(tool,label,icon,item,extraClass){
  var title=item&&item.name?item.name:label;
  var cls='asset-tile opening-model-tile '+(extraClass||'');
  var html='<button class="'+escHtml(cls)+'" type="button" data-tool="'+escHtml(tool)+'" onclick="chooseOpeningModelTool(\''+escHtml(tool)+'\')" title="'+escHtml(title)+'"';
  if(item&&item.thumb){
    html+=' onmouseenter="showAssetPreview(this,event)" onmousemove="moveAssetPreview(event)" onmouseleave="hideAssetPreview()" data-preview="'+escHtml(item.thumb+'?v=3')+'" data-preview-name="'+escHtml(item.name)+'"';
  }
  html+='>';
  if(item&&item.thumb) html+='<img src="'+escHtml(item.thumb+'?v=3')+'" loading="lazy" alt="">';
  else html+='<span class="opening-model-thumb">'+icon+'</span>';
  html+='<div class="asset-name">'+escHtml(label)+'</div></button>';
  return html;
}
function renderOpeningModelToolMenus(){
  renderOpeningDoorModelToolMenu();
  renderOpeningWindowModelToolMenu();
  AssetCatalogue.installGlobal(document.getElementById('sidebar'));
}
function renderOpeningDoorModelToolMenu(){
  var mount=document.getElementById('opening-door-model-tools');
  if(!mount) return;
  var doors=Object.keys(FMP_ITEMS).map(function(k){return FMP_ITEMS[k];}).filter(isOpeningDoorModel).sort(function(a,b){return a.name.localeCompare(b.name);});
  var html='<div class="asset-subcat opening-tool-subcat"><div class="asset-subhdr" onclick="toggleAssetCat(this)" title="開き戸"><span class="sicon"><svg class="menu-category-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 21V3h14v18M8 21V6l8-2v17ZM13 13h.01"/></svg></span><span>開き戸・浴室ドア</span><span class="asset-arrow">+</span></div><div class="asset-grid">';
  html+=openingToolTileHtml(openingDoorModelToolId(''),'デフォルト','',{thumb:'assets/models/previews-v2/standard-door-default-thumb.png'},'opening-model-default-tile');
  html+=openingToolTileHtml(openingDoorModelToolId('small'),'小','',{thumb:'assets/models/previews-v2/standard-door-small-thumb.png'},'opening-model-default-tile');
  ['swing','fold'].forEach(function(kind){html+=openingToolTileHtml(openingDoorModelToolId('bath-clear-'+kind),'浴室・透明'+(kind==='fold'?'折り戸':'開き戸'),'',{thumb:'assets/icons/bath-'+kind+'.svg'},'');});
  doors.forEach(function(item){
    html+=openingToolTileHtml(openingDoorModelToolId(item.id),item.name,'🚪',item,'');
  });
  html+='</div></div>';
  mount.innerHTML=html;
}
function renderOpeningWindowModelToolMenu(){
  var mount=document.getElementById('opening-window-model-tools');
  if(!mount) return;
  var windows=Object.keys(FMP_ITEMS).map(function(k){return FMP_ITEMS[k];}).filter(function(item){return item&&item.category==='窓';}).sort(function(a,b){return a.name.localeCompare(b.name);});
  var html='<div class="asset-subcat opening-tool-subcat"><div class="asset-subhdr" onclick="toggleAssetCat(this)" title="窓"><span class="sicon"><svg class="menu-category-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4h18v16H3ZM12 4v16M3 12h18"/></svg></span><span>窓</span><span class="asset-arrow">+</span></div><div class="asset-grid">';
  html+=openingToolTileHtml(openingWindowModelToolId(''),'引違い','',{thumb:'assets/models/previews-v2/standard-window-slide-thumb.png'},'opening-model-default-tile opening-window-tile');
  html+=openingToolTileHtml(openingWindowModelToolId('fix'),'FIX窓','',{thumb:'assets/models/previews-v2/standard-window-fix-thumb.png'},'opening-model-default-tile opening-window-tile');
  html+=openingToolTileHtml(openingWindowModelToolId('window-door'),'掃き出し','',{thumb:'assets/models/previews-v2/standard-window-door-thumb.png'},'opening-model-default-tile opening-window-tile');
  windows.forEach(function(item){
    html+=openingToolTileHtml(openingWindowModelToolId(item.id),item.name,'🪟',item,'opening-window-tile');
  });
  html+='</div></div>';
  mount.innerHTML=html;
}
function renderFurnitureMegaLibrary(){
  var mounts={ '住設':document.getElementById('fmp-fixtures'), '家具':document.getElementById('fmp-furniture'), '外構':document.getElementById('fmp-exterior') };
  Object.keys(mounts).forEach(function(group){
    var mount=mounts[group]; if(!mount) return;
    var cats={};
    Object.keys(FMP_ITEMS).map(function(k){return FMP_ITEMS[k];}).filter(function(item){return catalogueGroup(item)===group && !isBuildingComponentFmpItem(item);}).forEach(function(item){
      var head=catalogueHeading(item);
      (cats[head]||(cats[head]=[])).push(item);
    });
    var html='';
    Object.keys(cats).sort().forEach(function(cat){
      cats[cat].sort(function(a,b){return a.name.localeCompare(b.name);});
      // 欄がどの分類かを残す。取り込み後のおすすめ(assets/js/plan-finish.js)が、
      // 呼び名の文字ではなくこの印で欄を探して開く。
      var kind=(cats[cat][0]&&cats[cat][0].kind)||'';
      html+='<div class="asset-subcat"'+(kind?' data-kind="'+escHtml(kind)+'"':'')+'><div class="asset-subhdr" onclick="toggleAssetCat(this)" title="'+escHtml(cat)+'"><span class="sicon">'+MenuIcons.html(cat)+'</span><span>'+escHtml(cat)+'</span><span class="asset-arrow">+</span></div><div class="asset-grid">';
      cats[cat].forEach(function(item){
        html+='<button class="asset-tile" type="button" data-tool="'+escHtml(item.id)+'" onclick="setTool(\''+escHtml(item.id)+'\')" onmouseenter="showAssetPreview(this,event)" onmousemove="moveAssetPreview(event)" onmouseleave="hideAssetPreview()" title="'+escHtml(item.name+' · '+AssetCatalogue.dimensions(item))+'" data-search="'+escHtml(item.name+' '+item.category+' '+(item.searchWords||'')+' '+item.id+(item.provenance==='original'?' オリジナル':''))+'" data-preview="'+escHtml(item.thumb+'?v=3')+'" data-preview-name="'+escHtml(item.name)+'">';
        html+='<img src="'+escHtml(item.thumb+'?v=3')+'" loading="lazy" alt="">';
        html+=(item.provenance==='original'?'<span class="original-model-badge">Original</span>':'');
        html+='<div class="asset-name">'+escHtml(item.name)+'</div><div class="asset-dimensions">'+escHtml(AssetCatalogue.dimensions(item))+'</div></button>';
      });
      html+='</div></div>';
    });
    mount.innerHTML=html;

  });
}
function toggleAssetCat(el){
  var wrap=el.parentElement, mark=el.querySelector('span:last-child');
  if(!wrap) return;
  wrap.classList.toggle('open');
  if(mark) mark.textContent=wrap.classList.contains('open')?'-':'+';
}
// 上面画像がまだ読めていない家具の代替表示（drawItem2d）。数値をここに置くのは、
// 動画パッケージ側の事後検証 findPlanPlaceholderInstances が同じ値から
// 「この画素はプレースホルダでありうるか」を逆算するため。表を2つ持たない。
var PLAN_PLACEHOLDER_RGB=[210,215,225];
var PLAN_PLACEHOLDER_ALPHA=0.72;
var PLAN_PLACEHOLDER_FILL='rgba('+PLAN_PLACEHOLDER_RGB.join(',')+','+PLAN_PLACEHOLDER_ALPHA+')';
function getFmpTopImage(item){
  if(!item||!item.top) return null;
  if(!FMP_TOP_IMAGES[item.id]){
    var img=new Image();
    img.onload=function(){draw2d();};
    img.src=item.top;
    FMP_TOP_IMAGES[item.id]=img;
  }
  return FMP_TOP_IMAGES[item.id];
}
function getTopImageCrop(img,key){
  if(!img || !img.complete || !img.naturalWidth || !img.naturalHeight) return null;
  key=key||img.src||'';
  if(FMP_TOP_CROPS[key]) return FMP_TOP_CROPS[key];
  var full={sx:0,sy:0,sw:img.naturalWidth,sh:img.naturalHeight};
  try{
    var c=document.createElement('canvas');
    c.width=img.naturalWidth; c.height=img.naturalHeight;
    var cx=c.getContext('2d',{willReadFrequently:true});
    cx.drawImage(img,0,0);
    var data=cx.getImageData(0,0,c.width,c.height).data;
    var minX=c.width,minY=c.height,maxX=-1,maxY=-1;
    for(var y=0;y<c.height;y++){
      for(var x=0;x<c.width;x++){
        if(data[(y*c.width+x)*4+3]<=4) continue;
        if(x<minX) minX=x;
        if(y<minY) minY=y;
        if(x>maxX) maxX=x;
        if(y>maxY) maxY=y;
      }
    }
    if(maxX>=minX && maxY>=minY){
      var pad=Math.max(2,Math.round(Math.min(c.width,c.height)*0.01));
      minX=Math.max(0,minX-pad);
      minY=Math.max(0,minY-pad);
      maxX=Math.min(c.width-1,maxX+pad);
      maxY=Math.min(c.height-1,maxY+pad);
      full={sx:minX,sy:minY,sw:maxX-minX+1,sh:maxY-minY+1};
    }
  }catch(err){
    // If a future image is cross-origin/tainted, fall back to the full image.
  }
  FMP_TOP_CROPS[key]=full;
  return full;
}
function drawFmpTopImage(img,item,dx,dy,dw,dh){
  var crop=getTopImageCrop(img,item&&item.id);
  if(crop){
    ctx.drawImage(img,crop.sx,crop.sy,crop.sw,crop.sh,dx,dy,dw,dh);
  } else {
    ctx.drawImage(img,dx,dy,dw,dh);
  }
}
function getFmpTopBaseRotationRad(item){
  if(item && (item.previewVersion===2 || /^im0261-/.test(item.id||'') || /^fmp-/.test(item.id||''))) return 0;
  return Math.PI;
}
function getFmpTopRotationRad(item){
  var rot=getFmpTopBaseRotationRad(item);
  if(item && item.topRot!==undefined && isFinite(+item.topRot)){
    rot+=Number(item.topRot)*Math.PI/180;
  }
  var cfg=item ? GLTF_MODEL_CONFIG[item.id] : null;
  if(cfg){
    if(cfg.planRot!==undefined) rot+=cfg.planRot;
    else if(cfg.rotY!==undefined) rot-=cfg.rotY;
  }
  return rot;
}
function drawFmpTopImageOriented(img,item,w,h){
  var rot=getFmpTopRotationRad(item);
  var quarter=Math.round(rot/(Math.PI/2));
  var oddQuarter=Math.abs(quarter)%2===1;
  ctx.save();
  if(rot) ctx.rotate(rot);
  drawFmpTopImage(img,item,-(oddQuarter?h:w)/2,-(oddQuarter?w:h)/2,oddQuarter?h:w,oddQuarter?w:h);
  ctx.restore();
}
function showAssetPreview(el,e){
  if(window.matchMedia('(hover: none), (pointer: coarse)').matches){hideAssetPreview();return;}
  var pv=document.getElementById('asset-preview'); if(!pv) return;
  var img=pv.querySelector('img'), label=pv.querySelector('div');
  img.src=el.getAttribute('data-preview')||'';
  label.textContent=el.getAttribute('data-preview-name')||'';
  pv.classList.add('show');
  moveAssetPreview(e);
}
function moveAssetPreview(e){
  var pv=document.getElementById('asset-preview'); if(!pv||!pv.classList.contains('show')) return;
  var pad=14, w=pv.offsetWidth||212, h=pv.offsetHeight||236;
  var x=e.clientX+pad, y=e.clientY+pad;
  if(x+w>window.innerWidth-8) x=e.clientX-w-pad;
  if(y+h>window.innerHeight-8) y=window.innerHeight-h-8;
  pv.style.left=Math.max(8,x)+'px';
  pv.style.top=Math.max(8,y)+'px';
}
function hideAssetPreview(){
  var pv=document.getElementById('asset-preview'); if(pv) pv.classList.remove('show');
}
// PBR Textures (lazy-loaded)
var _pbrTex = {};
var _textureRefreshPending = false;
var _repeatSafeTexCache = {};
function scheduleTextureSceneRefresh(){
  if(_textureRefreshPending) return;
  _textureRefreshPending = true;
  setTimeout(function(){
    _textureRefreshPending = false;
    if(ren) rebuild3D();
    if(typeof invalidate3D==='function') invalidate3D();
  }, 50);
}
function pbrTex(name) {
  if (_pbrTex[name]) return _pbrTex[name];
  var loader = new THREE.TextureLoader();
  var t = loader.load('assets/textures/' + name, function(){
    if(ren) t.anisotropy = ren.capabilities.getMaxAnisotropy();
    scheduleTextureSceneRefresh();
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  _pbrTex[name] = t;
  return t;
}
function pbrTexLinear(name) {
  if (!name) return null;
  if (_pbrTex['_lin_'+name]) return _pbrTex['_lin_'+name];
  var loader = new THREE.TextureLoader();
  var t = loader.load('assets/textures/' + name, function(){
    if(ren) t.anisotropy = ren.capabilities.getMaxAnisotropy();
    scheduleTextureSceneRefresh();
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  _pbrTex['_lin_'+name] = t;
  return t;
}

// 部材の型を人が読む名前にする。ユーザーに見せる文面（エラーの名指しなど）は
// id ではなく名前で語る。FMP のモデル名が最優先で、無ければ日本語ラベル。
function itemTypeLabel(type){
  var fmp=getFmpItem(type);
  return (fmp&&fmp.name)||ILABELS[type]||type||'要素';
}
var ILABELS = {
  kitchen:'キッチン',bath:'バス',toilet:'トイレ',sink:'洗面',fridge:'冷蔵庫',washer:'洗濯機',
  sofa:'3Pソファ',loveseat_2p:'2Pソファ',low_table:'ローテーブル',
  'dining-table':'食卓(4)','dining_6':'食卓(6)','round_table_4':'円卓',
  'bed-d':'ベッド(D)','bed-s':'ベッド(S)','semi_double_bed':'ベッド(SD)',futon_set:'布団',
  desk:'デスク',tv:'TV','custom-block':'任意ブロック',column:'角柱','column-round':'円柱','light-ceiling':'シーリングライト','light-down':'ダウンライト','light-spot':'スポットライト',memo:'メモ',ruler:'定規','walk-route':'ウォークルート',closet:'収納',shoe_cabinet:'下駄箱','shelf-built-in':'造作棚',stair:'階段','stair-corner':'階段コーナー','stair-landing':'踊り場',balcony:'バルコニー',car:'自動車',bicycle:'自転車','bicycle-fold':'折りたたみ自転車',fence:'塀','wood-fence':'フェンス','lattice-screen':'格子柵',
  'neighbor-building':'周辺ビル','neighbor-house':'隣家',road:'道路','utility-pole':'電柱',
  'ac-outdoor':'エアコン室外機', 'water-heater':'貯湯タンク（エコキュート）', 'gas-heater':'ガス給湯器(壁掛け)', 'meter-box':'電気メーター', 'sewer-pit':'汚水枡', 'downspout':'竪樋',
  foundation:'基礎','exterior-stair':'外構階段',ramp:'スロープ',
  'door-swing':'開戸','door-swing-s':'開戸(小)','door-slide':'引戸','door-fold':'折戸(片開き)','door-fold-w':'折戸(両開き)','door-slide-s':'片引き戸','door-pocket':'引込み戸',window:'窓','window-door':'引き違い窓','door-front':'玄関',
  'door-opening':'開口','door-opening-arch':'アーチ開口','site-rect':'敷地',
  'roof':'屋根'
};
