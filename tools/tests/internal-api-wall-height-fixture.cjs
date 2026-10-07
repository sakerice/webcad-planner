// Synthetic display numbers only. No raw Astra source, AI request, or candidate ledger.
const f=value=>({value,status:'observed',source:'synthetic geometry fixture'}),clone=v=>JSON.parse(JSON.stringify(v));
function source(){return {sceneVersion:3,units:'mm',coordinateSystem:'x-east-y-south-clockwise',annotations:[],
 walls:[{id:'wall-free',floor:f(1),start:f({x:0,y:3000}),end:f({x:4000,y:3000}),thicknessMm:f(120)},
 {id:'wall-host',floor:f(1),start:f({x:0,y:0}),end:f({x:4000,y:0}),thicknessMm:f(120)},
 {id:'wall-west',floor:f(1),start:f({x:0,y:0}),end:f({x:0,y:3000}),thicknessMm:f(120)}],
 rooms:[{id:'room-fixture',floor:f(1),shape:f({kind:'rectUnion',rectangles:[{x:0,y:0,w:4000,d:3000}]}),boundaryBasis:f('wall-centerline')}],
 openings:[{id:'opening-fixture',floor:f(1),hostWallId:f('wall-host'),adjacentRoomIds:f(['room-fixture',null]),start:f({x:1000,y:0}),end:f({x:2000,y:0}),mechanism:f('window'),heightMm:f(1200),sillMm:f(900),windowKind:f('fix')}],
 objects:[],siteRegions:[],buildingFootprints:[],bindings:[],connections:[]};}
function envelope(){return {source:source(),snapshot:{walls:[],rooms:[],items:[],heightDefaults:{modelVersion:2,wallHeight:2400,floorThickness:180,floorRaise:100,floorRaiseSet:true,perFloor:false},floors:{}},options:{materialization:'bounded-v3',pageScope:['synthetic-wall-height']},camera:{view:'2d',floor:1,twoD:{zoom:.2,panX:80,panY:80},camera:null},state:{history:['keep-history'],redo:['keep-redo'],dirty:true},diagnostics:[]};}
function override(scene,valueMm=1100){return {sourceEntityId:'wall-free',field:'wallHeight',valueMm,source:'synthetic fixture: explicit test number',reason:'Exercise display-only wall height; no source measurement',origin:'explicit-display-assumption',sourceHash:scene.sourceHash,baseRevision:scene.revision,heightContractVersion:1};}
function patch(scene,valueMm=1100){return {planId:scene.planId,baseRevision:scene.revision,displayBindings:[],selectedObjectIds:[],selectedEntityIds:['wall-free','room-fixture'],incompleteConfirmed:true,displayOverrides:[override(scene,valueMm)]};}
const INVALID_VALUES=[299.99,6000.01,-1,0,'1100',null,true,NaN,Infinity,-Infinity,{},[]];
module.exports={source,envelope,override,patch,clone,INVALID_VALUES};
