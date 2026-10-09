"""Seven actual exported-GLB manual static installation proofs, no synthetic fixtures.
Rigid placement respects construction datums; cutaways omit whole instances only.
"""
import sys,json,math,hashlib
from pathlib import Path
import bpy
from mathutils import Vector,Matrix
H=Path(__file__).resolve().parent;ROOT=H.parents[3];sys.path[:0]=[str(H),str(H.parent),str(H.parent.parent)]
from render import render
from sanitize_sources import sanitize_loaded
D={i['id'].removeprefix('rpg-mansion-').removesuffix('-01'):i for p in [H/'descriptors.json',H/'proof_inputs/reference-descriptors.json'] for i in json.loads(p.read_text())['items']}
OUT=H/'assemblies';OUT.mkdir(exist_ok=True);ROWS=[];OBJS=[]

def place(key,location=(0,0,0),angle=0,label=None,category='wall'):
 item=D[key];path=ROOT/item['model'];before=set(bpy.data.objects);bpy.ops.import_scene.gltf(filepath=str(path));objects=[o for o in bpy.data.objects if o not in before and o.type=='MESH'];assert len(objects)==1
 ob=objects[0];off=Vector(item['moduleContract']['constructionToAssetTranslationM']);rotation=Matrix.Rotation(math.radians(angle),4,'Z');placement=Matrix.Translation(Vector(location))@rotation@Matrix.Translation(-off);ob.matrix_world=placement@ob.matrix_world;ob.name=label or key;ob['sourceModelSha256']=item['hashes']['model'];ob['assemblyRole']=item['moduleContract']['role'];ob['moduleCategory']=category;OBJS.append(ob)
 worldcons=[]
 for c in item['moduleContract']['connections']:
  pt=placement@Vector(c['assetPointM']);normal=rotation.to_3x3()@Vector(c['normal']);worldcons.append(dict(label=c['label'],pointBlenderWorldM=list(pt),normalBlenderWorld=list(normal),pointGltfWorldM=[pt.x,pt.z,-pt.y],normalGltfWorld=[normal.x,normal.z,-normal.y]))
 ROWS.append(dict(label=ob.name,id=item['id'],model=item['model'],modelSha256=item['hashes']['model'],constructionDatumWorldM=list(location),zRotationDegrees=angle,sourceToConstructionTranslationM=list(-off),assetToWorldBlenderMatrix=[list(r) for r in placement],worldConnections=worldcons,category=category));return ob

def floors(xs,ys):
 for x in xs:
  for y in ys:place('octagon-cabochon-floor-tile',(x,y,-.075),category='floor')

def facade():
 for x,key in [(-1.2,'ashlar-wall-bay'),(0,'half-timbered-infill-bay'),(1.2,'tall-fixed-french-window-bay')]:
  place(key,(x,0,0));place('rusticated-plinth-segment',(x,0,-.6),category='foundation');place('stone-cornice-straight',(x,0,3),category='cornice')
 for x in [-.6,.6]:place('stone-wall-pilaster',(x,-.12,0),category='pilaster')
 floors([-1.2,0,1.2],[.72,1.92])

def railing():
 floors([0,1.2],[0,1.2])
 for x,y in [(0,0),(1.2,0),(1.2,1.2)]:place('stone-newel-post',(x,y,0),category='newel')
 place('turned-stone-balustrade',(.6,0,0),category='railing');place('wrought-iron-railing',(1.2,.6,0),90,category='railing')

def room(yend,ys):
 for label,x,y,angle in [('NE',1.8,yend,0),('NW',-1.8,yend,90),('SW',-1.8,-yend,180),('SE',1.8,-yend,-90)]:place('exterior-return-corner',(x,y,0),angle,label+' exterior corner')
 for x in [-.6,.6]:place('plain-plaster-bay',(x,yend,0),180)
 place('arched-doorway-bay',(-.3,-yend,0));place('plain-plaster-filler-600',(.9,-yend,0))
 for side,angle in [(-1,-90),(1,90)]:
  for i,y in enumerate(ys):place('raised-sill-fixed-window-bay' if i==1 else 'plain-plaster-bay',(side*1.8,y,0),angle)

def gable_room():
 room(3.,[-1.8,-.6,.6,1.8]);floors([-1.2,0,1.2],[-2.4,-1.2,0,1.2,2.4])
 place('gable-dormer-host',(0,-.6,2.9),category='roof');place('slate-gable-span',(0,.6,2.9),category='roof');place('slate-gable-hipped-end',(0,-1.2,2.9),category='roof');place('slate-gable-hipped-end',(0,1.2,2.9),180,category='roof');place('fixed-shed-dormer',(1,-.6,2.9),90,category='dormer')

def flat_room():
 room(1.8,[-.6,.6]);floors([-1.2,0,1.2],[-1.2,0,1.2]);place('flat-parapet-chimney-host',(0,0,3),category='roof');place('hollow-brick-chimney',(.9,.9,3.23792),category='chimney')

def turret():
 floors([-1.2,0,1.2],[-1.2,0,1.2])
 for x in [-1.2,1.2]:
  for y in [-1.2,1.2]:place('tuscan-support-column',(x,y,0),category='column')
 place('standing-seam-conical-turret-roof',(0,0,2.9),category='roof')

def veranda():
 floors([-1.2,0,1.2],[-.6,.6])
 for x,a in [(-1.2,-90),(1.2,90)]:
  for y in [-.6,.6]:place('plain-plaster-bay',(x,y,0),a)
 for y in [-.6,.6]:place('standing-seam-lean-to-span',(0,y,2.9),category='roof')

def portico():
 floors([-1.8,-.6,.6,1.8],[0])
 for x in [-1.8,1.8]:place('tuscan-support-column',(x,0,0),category='column')
 place('portico-pediment',(0,0,3),category='pediment')

PLAN=[
 ('facade-floor',facade,17,[('exterior',(6,-8,5),None),('interior',(-6,8,5),None),('top',(0,0,1),None)]),
 ('railing-corner',railing,9,[('exterior',(6,-8,5),None),('interior',(-6,8,4),None),('top',(0,0,1),None)]),
 ('gable-dormer-room',gable_room,36,[('exterior',(7,-8,5),None),('roof-dormer',(7,-5,4),{'roof','dormer'}),('undercroft',(5,-7,-5),{'wall','roof','dormer'}),('top',(0,0,1),None)]),
 ('flat-chimney-room',flat_room,23,[('exterior',(7,-8,6),None),('roof-chimney',(6,-8,7),{'roof','chimney'}),('underside',(5,-7,-5),{'roof','chimney'}),('top',(0,0,1),None)]),
 ('turret-canopy',turret,14,[('exterior',(6,-8,5),None),('supported-underside',(5,-7,-6),{'roof','column'}),('roof-interior',(5,-7,-8),{'roof'}),('top',(0,0,1),None)]),
 ('lean-to-veranda',veranda,12,[('exterior',(6,-8,4),None),('underside',(-5,-7,-4),{'roof','wall'}),('top',(0,0,1),None)]),
 ('supported-portico',portico,7,[('exterior',(6,-8,4),None),('rear',(-6,8,4),None),('underside',(4,-7,-4),{'column','pediment'})])]

def build_one(name,builder,count,recipes):
 global ROWS,OBJS
 ROWS=[];OBJS=[];bpy.ops.wm.read_factory_settings(use_empty=True);bpy.context.scene.name='Actual '+name+' static installation';bpy.context.scene.unit_settings.system='METRIC';builder();assert len(ROWS)==count,(name,len(ROWS),count)
 scene=bpy.context.scene;scene['assemblyOnly']=True;scene['assetCountMeaning']='Actual delivered module instances. Repeats and host variants do not increase distinct construction count.';scene['assemblyManifest']=json.dumps(ROWS);sanitize_loaded(name);source=OUT/(name+'.blend');bpy.context.preferences.filepaths.save_version=0;bpy.ops.wm.save_as_mainfile(filepath=str(source),compress=True)
 report=dict(name=name,source=str(source.relative_to(ROOT)),sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest(),instances=ROWS,instanceCount=count,fixtures=[],views={},viewRecipes=[dict(name=v,direction=list(d),categories=sorted(c) if c else sorted({o['category'] for o in ROWS})) for v,d,c in recipes],installationNotes=['Static manual rigid installation only; no native wall cutting, automatic roofs, stair behavior, collision, or engineering certification.','Cutaway views omit whole delivered instances; no geometry is added or changed.'])
 (OUT/(name+'.json')).write_text(json.dumps(report,indent=2)+'\n');print('ASSEMBLY_SOURCE_READY',name,count,flush=True)

def render_one(name):
 p=OUT/(name+'.json');report=json.loads(p.read_text());source=ROOT/report['source'];before=hashlib.sha256(source.read_bytes()).hexdigest();assert before==report['sourceSha256'];bpy.ops.wm.open_mainfile(filepath=str(source),load_ui=False);objects=[o for o in bpy.context.scene.objects if o.type=='MESH']
 for recipe in report['viewRecipes']:
  cats=recipe['categories'];visible=[o for o in objects if o.get('moduleCategory') in cats]
  for o in objects:o.hide_render=o not in visible
  image=OUT/(name+'-'+recipe['name']+'.png');camera=render(visible,image,recipe['direction'],resolution=1024,samples=48);report['views'][recipe['name']]=dict(path=str(image.relative_to(ROOT)),sha256=hashlib.sha256(image.read_bytes()).hexdigest(),camera=camera,visibleCategories=cats,omittedInstances=[o.name for o in objects if o not in visible],note='Whole-module visibility cutaway; transforms and meshes unchanged.')
  p.write_text(json.dumps(report,indent=2)+'\n')
 assert before==hashlib.sha256(source.read_bytes()).hexdigest();print('ASSEMBLY_RENDER_READY',name,flush=True)

if __name__=='__main__':
 only=sys.argv[sys.argv.index('--only')+1].split(',') if '--only' in sys.argv else None
 for name,builder,count,recipes in PLAN:
  if only and name not in only:continue
  if '--render-only' not in sys.argv:build_one(name,builder,count,recipes)
  if '--build-only' not in sys.argv:render_one(name)
