// Reduced geometry oracle derived from the independently inspected madori-3f.pdf
// printed dimensions and conditional west/south alignment. Not a model reading,
// complete room trace, stair engineering model, or proof of extraction accuracy.
const part=(x0,y0,x1,y1)=>({x0,y0,x1,y1});
function fixture(){
 const floors=[
  {floor:1,width:7280,depth:4095,rooms:[{name:'1F envelope',parts:[part(0,0,7280,4095)]}]},
  {floor:2,width:7280,depth:4095,rooms:[{name:'2F enclosed envelope',parts:[part(0,0,5460,4095),part(5460,0,7280,2275)]},{name:'balcony',use:'balcony',parts:[part(5460,2275,7280,4095)]}]},
  {floor:3,width:5915,depth:3640,rooms:[{name:'3F stepped envelope',parts:[part(0,455,2275,3640),part(2275,0,5915,3640)]}]}
 ].map(f=>({...f,sourcePageId:'page-'+f.floor,sourceIdentity:{status:'confirmed',sourcePageId:'page-'+f.floor,pageNumber:f.floor,sourceHeader:{status:'observed',floorIds:[f.floor],evidence:f.floor+'階平面図・俯瞰図'}},dims:{top:{total:f.width},left:{total:f.depth}}}));
 const source={floors,items:[{type:'stair',floor:1,x:1000,y:3200,w:3000,d:800,rot:0},{type:'stair',floor:2,x:1000,y:3200,w:3000,d:800,rot:0}],marks:[]};
 const proposals={version:1,floors:floors.map(f=>({floor:f.floor,sourcePageId:f.sourcePageId,anchors:[
  {local:{x:0,y:f.depth},building:{x:0,y:4095},evidence:'Conditional west/south reference supported by repeated wall geometry; test review only',precisionMm:15},
  {local:{x:f.width,y:f.depth},building:{x:f.width,y:4095},evidence:'Printed width measured along southern reference; test review only',precisionMm:15}
 ]}))};
 return {source,proposals};
}
function approved(source,proposals){return {sourceSnapshot:JSON.stringify(source),proposalSnapshot:JSON.stringify(proposals),proposals,floors:proposals.floors.map(f=>({...f,reviewed:true})),partialAcknowledged:true};}
module.exports={fixture,approved};
