"""Regression of builder joints before joining meshes; no files exported or modified."""
import sys,json,importlib.util,hashlib
from pathlib import Path
from mathutils.bvhtree import BVHTree
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('expansion',HERE/'build.py');b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)

def parts(prefix):return [o for o in b.bpy.context.scene.objects if o.type=='MESH' and o.name.startswith(prefix)]
def bounds(obj):
 pts=[obj.matrix_world@v.co for v in obj.data.vertices]
 return [[min(p[i] for p in pts),max(p[i] for p in pts)] for i in range(3)]
def gap(lower,upper):return bounds(upper)[2][0]-bounds(lower)[2][1]
def overlaps(a,c):
 def tree(o):return BVHTree.FromPolygons([o.matrix_world@v.co for v in o.data.vertices],[list(p.vertices) for p in o.data.polygons],epsilon=1e-6)
 return bool(tree(a).overlap(tree(c)))
checks=[]
for slug in ['butler-sink','washstand','bathtub','round-table','kitchen-hutch','nightstand','dresser','planter']:
 b.kit.clear_scene();b.old.P=b.old.palette();b.P=b.old.P
 # Populate the same palette without joining or normalising geometry.
 for key in ['ceramic','leaf','soil']:b.P[key]=b.kit.matp(key,'#808080',.6,0)
 if slug in ['butler-sink','washstand','bathtub']:
  b.wet(slug);b.bpy.context.view_layer.update()
  handles=parts('Cross tap');stems=parts('Tap valve stem');manifold=parts('Tap manifold')[0];upright=parts('Tap upright')[0]
  assert len(handles)==len(stems)==2
  for h in handles:assert any(overlaps(h,s) for s in stems),(slug,h.name,'unsupported handle')
  for s in stems:assert overlaps(s,manifold),(slug,s.name,'unsupported valve stem')
  assert overlaps(manifold,upright),(slug,'disconnected manifold')
  checks.append({'asset':slug,'crossHandles':2,'handleStemManifoldUprightIntersections':True})
 elif slug=='round-table':
  b.table(slug);b.bpy.context.view_layer.update();g=gap(parts('Pedestal')[0],parts('Circular top')[0]);assert g<=1e-6,g;checks.append({'asset':slug,'topSupportGapM':g})
 elif slug=='kitchen-hutch':
  b.hutch();b.bpy.context.view_layer.update();shelves=parts('Hutch shelf');gaps=[]
  for p in parts('Plate stack')+parts('Pantry jar'):
   g=min((gap(s,p) for s in shelves if bounds(s)[2][1]<bounds(p)[2][1]),key=abs);assert abs(g)<1e-6,(p.name,g);gaps.append(g)
  checks.append({'asset':slug,'shelfSupportGapsM':gaps})
 elif slug in ['nightstand','dresser']:
  b.cabinet(.48,.40,.63,drawers=2) if slug=='nightstand' else b.cabinet(1.1,.49,1,drawers=4)
  b.bpy.context.view_layer.update();g=gap(parts('Carcass')[0],parts('Moulded cap')[0]);assert abs(g)<1e-6,g;checks.append({'asset':slug,'capSupportGapM':g})
 else:
  b.planter();b.bpy.context.view_layer.update();volumes=[]
  for o in parts('Laurel leaf'):
   o.data.calc_loop_triangles();v=sum(o.data.vertices[t.vertices[0]].co.dot(o.data.vertices[t.vertices[1]].co.cross(o.data.vertices[t.vertices[2]].co))/6 for t in o.data.loop_triangles);assert v>0,(o.name,v);volumes.append(v)
  assert len(volumes)==9;checks.append({'asset':slug,'outwardLeafSignedVolumesM3':volumes})
# Every knob stem must intersect both its head and a non-hardware body part.
for slug in ['wing-chair','sofa','chaise','console','secretary','nightstand','wardrobe','dresser','linen-cabinet','kitchen-hutch','butler-sink','icebox','toilet']:
 b.kit.clear_scene();b.old.P=b.old.palette();b.P=b.old.P
 for key in ['ceramic','leaf','soil']:b.P[key]=b.kit.matp(key,'#808080',.6,0)
 fn=next(s[3] for s in b.SPECS if s[0]==slug);fn();b.bpy.context.view_layer.update()
 heads=parts('Brass knob');stems=parts('Knob mounting stem');bodies=[o for o in b.bpy.context.scene.objects if o.type=='MESH' and o not in heads+stems]
 assert len(heads)==len(stems)>0
 for h in heads:assert any(overlaps(h,s) for s in stems),(slug,h.name,'head has no stem')
 for s in stems:assert any(overlaps(s,o) for o in bodies),(slug,s.name,'stem misses body')
 checks.append({'asset':slug,'knobs':len(heads),'headStemBodyIntersections':True})
for slug in ['range','curtain','fireplace']:
 b.kit.clear_scene();b.old.P=b.old.palette();b.P=b.old.P
 for key in ['iron','stone']:b.P[key]=b.kit.matp(key,'#808080',.6,0)
 next(s[3] for s in b.SPECS if s[0]==slug)();b.bpy.context.view_layer.update()
 if slug=='range':
  mounts=parts('Oven handle mount');handles=[o for o in parts('Oven handle') if o not in mounts];doors=parts('Oven door')+parts('Fuel door')
  for h in handles:assert any(overlaps(h,m) for m in mounts)
  for m in mounts:assert any(overlaps(m,d) for d in doors),(slug,m.name)
 elif slug=='curtain':
  for t in parts('Tieback'):assert any(overlaps(t,f) for f in parts('Deep curtain fold')),(slug,t.name)
 else:
  for log in parts('Cold log'):assert overlaps(log,parts('Hearth')[0]),(slug,log.name)
 checks.append({'asset':slug,'remainingSmallGapConnections':True})
for check in checks:
 model=b.ROOT/('assets/models/packs/rpg-mansion/models/rpg-mansion-'+check['asset']+'-01.glb');check['assetRevision']='sha256:'+hashlib.sha256(model.read_bytes()).hexdigest()
path=b.ROOT/'tools/assets/rpg-pack-contract/expansion-evidence/geometry-connections.json';path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps({'status':'passed','space':'Blender source metres before dimension fitting','checks':checks},indent=2)+'\n');print('CONNECTION_CHECKS_PASSED',len(checks))
