// Synthetic contract fixture. Never uses a frozen candidate source or run ledger.
const observed=value=>({value,status:'observed',source:'synthetic contract regression fixture'});
const unknown=()=>({value:null,status:'unknown',unknownReason:'not-shown'});
const PERIOD_IDS=[
 'im0261-Carpet-MEGA_PACK_Carpet-carpet--in-65uf.001',
 'im0261-Mirror-MEGA_PACK_Mirror-mirror-337570_600_frame_red.001',
 'im0261-Sofa-MEGA_PACK_Sofa-Alto_3.5_seater_Louvoir_Fabric_Sofa_blue',
 'im0261-Window-MEGA_PACK_Window-2W-Long-Spear_CharcoalGray.001',
 'im0261-Window-MEGA_PACK_Window-window-3bf7.004'
];
const INVALID_IDS=['','..','../model','model/../other','model\\other','/etc/passwd','https://example.test/model','file:///etc/passwd','model%2E001','model\n001',' model','_model','-model','__proto__','constructor','prototype','a'.repeat(121),null,7,{},[]];
function source(){return {sceneVersion:3,units:'mm',coordinateSystem:'x-east-y-south-clockwise',annotations:[],walls:[],rooms:[{id:'contract-room',floor:observed(1),shape:observed({kind:'rectUnion',rectangles:[{x:0,y:0,w:10000,d:10000}]}),boundaryBasis:observed('clear-face')}],openings:[],objects:[{id:'contract-object',objectType:observed('chair'),semanticExtent:observed('asset'),placement:observed({domain:'room',roomId:'contract-room'}),sourceFootprint:observed({center:{x:2000,y:2000},sizeMm:{w:500,d:500},axisX:{x:1,y:0}}),frontDirection:unknown(),heightMm:unknown()}],siteRegions:[],buildingFootprints:[],bindings:[],connections:[]};}
function envelope(){return {source:source(),snapshot:{walls:[],rooms:[],items:[],heightDefaults:{wallHeight:2400}},options:{materialization:'bounded-v3',pageScope:['synthetic-contract-fixture']},camera:{view:'2d',floor:1,twoD:{zoom:1,panX:0,panY:0},camera:null},state:{history:[],redo:[],dirty:false},diagnostics:[]};}
function patch(scene,catalogId){return {planId:scene.planId,baseRevision:scene.revision,selectedObjectIds:['contract-object'],displayBindings:[{sourceEntityId:'contract-object',catalogId,sizingPolicy:'fit-source',appearanceMode:'unspecified'}],incompleteConfirmed:true};}
module.exports={PERIOD_IDS,INVALID_IDS,source,envelope,patch};
