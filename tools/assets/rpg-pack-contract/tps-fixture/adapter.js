/* Test/handoff adapter only. Not installed in the editor or TPS runtime. */
(function(root){
'use strict';
function resolve(T,record,item,modelMatrix,assetRevision,groundAt){
 if(record.assetId!==item.type||record.assetRevision!==assetRevision)throw Error('Asset revision mismatch');
 if(!modelMatrix.elements.every(Number.isFinite)||Math.abs(modelMatrix.determinant())<1e-12)throw Error('Invalid model matrix');
 const point=p=>new T.Vector3(...p).applyMatrix4(modelMatrix).toArray();
 const normal=p=>new T.Vector3(...p).applyMatrix3(new T.Matrix3().getNormalMatrix(modelMatrix)).normalize().toArray();
 const signature=JSON.stringify([item.id,item.type,record.assetRevision,record.socketRevision||record.surfaceRevision,modelMatrix.elements,item.floor,item.assetPackConversion||null]);
 const base={assetId:item.type,objectId:item.id,assetRevision,signature,status:'geometry-candidate-host-validation-required'};
 if(record.kind==='sit'){
  if(typeof groundAt!=='function')throw Error('Host ground resolver required');
  const candidate=point(record.localApproachFloorPoint),ground=groundAt(candidate[0],candidate[2],item.floor);
  if(!Number.isFinite(ground))throw Error('Approach ground unresolved');
  const front=new T.Vector3(...record.localFrontDirection).transformDirection(modelMatrix);
  return {...base,socketId:record.socketId,worldSeatSurfaceCenter:point(record.localSeatSurfaceCenter),worldSeatSurfaceNormal:normal(record.seatSurfaceNormal),worldSeatPolygon:record.seatPolygonLocalGltfM.map(point),worldSeatFrameReference:point(record.seatFrameReference.localCenter),worldFrontDirection:front.toArray(),actorYawRadians:Math.atan2(-front.x,-front.z),worldApproachFloorPoint:[candidate[0],ground,candidate[2]],approachStatus:'ground-resolved-path-clearance-and-exit-not-validated',pelvisAlignment:'TPS rig solver required; no constant offset or actor root supplied'};
 }
 return {...base,surfaceId:record.surfaceId,worldSurfaceCenter:point(record.localSurfaceCenter),worldSurfaceNormal:normal(record.localSurfaceNormal),worldSurfacePolygon:record.polygonLocalGltfM.map(point),placementStatus:'footprint-containment-and-collision-check-required'};
}
const api={resolve};if(typeof module!=='undefined')module.exports=api;root.RpgTpsFixture=api;
})(typeof window==='undefined'?globalThis:window);
