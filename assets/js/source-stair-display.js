/* Explicit, source-bound display decisions. No physical floor connections or holes. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.SourceStairDisplay=factory();}(typeof self!=='undefined'?self:this,function(){
  'use strict';
  function candidates(source){
    return (source&&source.items||[]).map(function(item,index){return {item:item,index:index};}).filter(function(c){var i=c.item;return ['stair','stair-corner','stair-landing'].indexOf(i.type)>=0&&[1,2].indexOf(i.floor)>=0&&['x','y','w','d'].every(function(k){return Number.isFinite(i[k]);})&&i.w>0&&i.d>0;}).map(function(c){return {sourceItemIndex:c.index,sourceSnapshot:JSON.stringify(c.item),floor:c.item.floor,type:c.item.type};});
  }
  function reviewedDirection(item,decision){
    if(!decision)return {flipX:!!item.flipX,flipY:!!item.flipY};
    if(decision.reviewed!==true||decision.sourceSnapshot!==JSON.stringify(item)||typeof decision.flipX!=='boolean'||typeof decision.flipY!=='boolean'||typeof decision.evidence!=='string'||!decision.evidence.trim())throw new Error('階段の向きの導出判断を元図面と照合して再確認してください。');
    return {flipX:decision.flipX,flipY:decision.flipY};
  }
  // Same centre/rotation/flip conventions as stairPartPortsMm, not a connection solver.
  function sourcePorts(item,decision){
    if(!item||['stair','stair-corner'].indexOf(item.type)<0)return null;
    var flip=reviewedDirection(item,decision),angle=(Number(item.rot)||0)*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);
    function world(x,y){if(flip.flipX)x=-x;if(flip.flipY)y=-y;return {x:item.x+x*c-y*s,y:item.y+x*s+y*c};}
    return item.type==='stair-corner'?{down:world(0,item.d/2),up:world(item.w/2,0)}:{down:world(0,-item.d/2),up:world(0,item.d/2)};
  }
  function directionDiagnostics(source,directions){
    var cs=candidates(source),out=[],entries=cs.map(function(candidate){var item=source.items[candidate.sourceItemIndex],decision=(directions||[]).filter(function(d){return d.sourceItemIndex===candidate.sourceItemIndex;});if(decision.length>1)throw new Error('同じ階段の向き判断が重複しています。');return {index:candidate.sourceItemIndex,item:item,ports:sourcePorts(item,decision[0])};});
    (directions||[]).forEach(function(d){if(!cs.some(function(c){return c.sourceItemIndex===d.sourceItemIndex;}))throw new Error('階段の向き判断の元対象がありません。');});
    for(var i=0;i<entries.length;i++)for(var j=i+1;j<entries.length;j++){
      var a=entries[i],b=entries[j];if(!a.ports||!b.ports||a.item.floor!==b.item.floor)continue;
      ['up','down'].forEach(function(role){var p=a.ports[role],q=b.ports[role],gap=Math.hypot(p.x-q.x,p.y-q.y);if(gap<=1)out.push({code:'source_stair_direction_conflict',floor:a.item.floor,sourceItemIndices:[a.index,b.index],portRole:role,gapMm:gap,message:'同じ上端または下端が一致しています。図面の上り方向を別の導出判断として確認してください。',physicalConnectionVerified:false});});
    }
    return out;
  }
  function materialize(source,decisions){
    var cs=candidates(source),seen=new Set();
    return (decisions||[]).map(function(d){
      var c=cs.find(function(x){return x.sourceItemIndex===d.sourceItemIndex;});
      if(!c||seen.has(c.sourceItemIndex)||d.reviewed!==true||d.sourceSnapshot!==c.sourceSnapshot)throw new Error('階段表示の元対象が変わっています。再確認してください。');
      if(!Number.isFinite(d.displayRiseMm)||d.displayRiseMm<0||d.displayRiseMm>6000||!Number.isFinite(d.displayBaseOffsetMm)||d.displayBaseOffsetMm<0||d.displayBaseOffsetMm>6000||!Number.isInteger(d.targetFloor)||d.targetFloor!==c.floor+1||!Number.isInteger(d.partOrder)||d.partOrder<1)throw new Error('階段の表示高さ・行先階・部材順を明示してください。');
      var original=source.items[c.sourceItemIndex],item=JSON.parse(JSON.stringify(original));
      if(item.type==='stair-landing'&&d.displayRiseMm!==0)throw new Error('踊り場は表示上り高さ0で確認してください。');
      if(d.directionDecision&&d.directionDecision.sourceItemIndex!==c.sourceItemIndex)throw new Error('階段の向き判断の元対象が変わっています。');
      var direction=reviewedDirection(original,d.directionDecision);
      if(d.directionDecision){item.flipX=direction.flipX;item.flipY=direction.flipY;}
      seen.add(c.sourceItemIndex);
      // v1 extraction uses centre coordinates; existing editor uses top-left.
      item.x-=item.w/2;item.y-=item.d/2;
      item.stairDisplayOnly=true;item.displayRiseMm=d.displayRiseMm;item.displayBaseOffsetMm=d.displayBaseOffsetMm;
      item.sourceStairDisplay={sourceItemIndex:c.sourceItemIndex,sourceSnapshot:c.sourceSnapshot,targetFloor:d.targetFloor,partOrder:d.partOrder,heightProvenance:'user-reviewed-display-assumption',measured:false,floorOpeningsReviewed:false,physicalConnection:false,cornerStepLimit:item.type==='stair-corner'?3:null};
      if(d.directionDecision)item.sourceStairDisplay.directionDecision=JSON.parse(JSON.stringify(d.directionDecision));
      return item;
    });
  }
  return {candidates:candidates,materialize:materialize,sourcePorts:sourcePorts,directionDiagnostics:directionDiagnostics};
}));
