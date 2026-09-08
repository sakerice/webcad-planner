(function(root){
  // World-space plan coordinates in metres; each pole searches along its wire axis.
  function links(poles){
    var result=[],seen=new Set();
    poles.forEach(function(p,i){
      [-1,1].forEach(function(sign){
        var dx=Math.cos(p.angle)*sign,dz=Math.sin(p.angle)*sign,best=-1,dist=Infinity;
        poles.forEach(function(q,j){
          if(i===j)return;
          var x=q.x-p.x,z=q.z-p.z,d=Math.hypot(x,z);
          if(d<1||d>65||(x*dx+z*dz)/d<0.85)return;
          if(d<dist){dist=d;best=j;}
        });
        if(best>=0){
          var key=Math.min(i,best)+':'+Math.max(i,best);
          if(!seen.has(key)){seen.add(key);result.push({from:i,to:best});}
        }else{
          result.push({from:i,end:{x:p.x+dx*250,z:p.z+dz*250,y:p.y,h:p.h,angle:p.angle},extension:true});
        }
      });
    });
    return result;
  }
  var api={links:links};
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.UtilityWires=api;
})(typeof globalThis!=='undefined'?globalThis:this);
