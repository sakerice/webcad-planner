"""Actual exported-GLB assembly proofs. Only local prototypes and labelled QA fixtures.
Three saved assembly scenes use rigid transforms and preserve original asset sizes.
"""
import sys,json,math,hashlib
from pathlib import Path
import bpy
from mathutils import Vector,Matrix
H=Path(__file__).resolve().parent;ROOT=H.parents[3];sys.path[:0]=[str(H),str(H.parent),str(H.parent.parent)]
from render import render
from sanitize_sources import sanitize_loaded
import build
D={i['id'].removeprefix('rpg-mansion-').removesuffix('-01'):i for i in json.loads((H/'descriptors.json').read_text())['items']}
OUT=H/'assemblies';OUT.mkdir(exist_ok=True);ROWS=[];OBJS=[]

def reset(name):
 global ROWS,OBJS
 bpy.ops.wm.read_factory_settings(use_empty=True);bpy.context.scene.name=name;bpy.context.scene.unit_settings.system='METRIC';ROWS=[];OBJS=[]

def place(key,location=(0,0,0),angle=0,label=None):
 item=D[key];path=ROOT/item['model'];before=set(bpy.data.objects);bpy.ops.import_scene.gltf(filepath=str(path));objects=[o for o in bpy.data.objects if o not in before and o.type=='MESH'];assert len(objects)==1
 ob=objects[0];off=Vector(item['moduleContract']['constructionToAssetTranslationM']);rotation=Matrix.Rotation(math.radians(angle),4,'Z');placement=Matrix.Translation(Vector(location))@rotation@Matrix.Translation(-off);ob.matrix_world=placement@ob.matrix_world;ob.name=label or key;ob['sourceModelSha256']=item['hashes']['model'];ob['assemblyRole']=item['moduleContract']['role'];OBJS.append(ob);ROWS.append(dict(label=ob.name,id=item['id'],model=item['model'],modelSha256=item['hashes']['model'],constructionDatumWorldM=list(location),zRotationDegrees=angle,sourceToConstructionTranslationM=list(-off)));return ob

def fixture():
 build.P=build.palette();build.PARTS=[]
 build.prism('QA fixture front wall with real open door',[(-1.68,0),(-.6,0),(-.6,2.4),(.6,2.4),(.6,0),(1.68,0),(1.68,3),(-1.68,3)],'Y',-.12,.12,'plaster')
 for ob in build.PARTS:
  # QA filler is scribed to the actual paneled finishes, not overlapped over them.
  # Exact subtraction changes only this labelled non-catalogue fixture.
  for wall in [o for o in OBJS if 'actual paneled bearing wall 1' in o.name]:
   bpy.context.view_layer.objects.active=ob;mod=ob.modifiers.new('Fitted pocket for '+wall.name,'BOOLEAN');mod.operation='DIFFERENCE';mod.solver='EXACT';mod.use_self=True;mod.object=wall;bpy.ops.object.modifier_apply(modifier=mod.name)
  # Exact Boolean contacts can leave sub-micrometre split edges. Weld only
  # within the geometry audit tolerance, then remove collinear face residue.
  bm=build.bmesh.new();bm.from_mesh(ob.data)
  build.bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=2e-6)
  build.bmesh.ops.dissolve_degenerate(bm,edges=list(bm.edges),dist=2e-6)
  build.bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
  build.bmesh.ops.dissolve_limit(bm,angle_limit=1e-5,use_dissolve_boundaries=False,verts=list(bm.verts),edges=list(bm.edges))
  build.bmesh.ops.triangulate(bm,faces=list(bm.faces),quad_method='BEAUTY',ngon_method='BEAUTY')
  build.bmesh.ops.dissolve_degenerate(bm,edges=list(bm.edges),dist=2e-6)
  build.bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(ob.data);bm.free();ob.data.update()
  for face in ob.data.polygons:face.material_index=0
  build.repair_mesh_winding(ob);build.metric_atlas(ob)
  ob['qaFixtureOnly']=True;ob['fixtureFit']='Exact Boolean side pockets from the actual adjacent paneled-wall GLBs';OBJS.append(ob)

def save(name,directions):
 scene=bpy.context.scene;scene['assemblyOnly']=True;scene['assetCountMeaning']='Repeated prototype instances plus any explicitly named QA bearing fixtures; fixtures are not catalogue assets';scene['assemblyManifest']=json.dumps(ROWS);sanitize_loaded(name);path=OUT/(name+'.blend');bpy.context.preferences.filepaths.save_version=0;bpy.ops.wm.save_as_mainfile(filepath=str(path),compress=True);sourcehash=hashlib.sha256(path.read_bytes()).hexdigest();views={}
 for view,direction in directions:
  image=OUT/(name+'-'+view+'.png');camera=render(OBJS,image,direction,resolution=1024,samples=48);views[view]=dict(path=str(image.relative_to(ROOT)),sha256=hashlib.sha256(image.read_bytes()).hexdigest(),camera=camera)
 assert sourcehash==hashlib.sha256(path.read_bytes()).hexdigest();report=dict(name=name,source=str(path.relative_to(ROOT)),sourceSha256=sourcehash,instances=ROWS,fixtures=[ob.name for ob in OBJS if ob.get('qaFixtureOnly')],views=views);(OUT/(name+'.json')).write_text(json.dumps(report,indent=2)+'\n');print('ASSEMBLY_READY',name,flush=True)

def wall_door_corner():
 reset('Wall doorway and return assembly')
 place('paneled-wall-bay',(.6,0,0));place('rectangular-doorway-bay',(2.1,0,0));place('paneled-return-corner',(3.6,0,0));place('paneled-wall-bay',(3.6,-1.2,0),-90,'Return straight paneled bay')
 save('wall-door-corner',[('exterior',(-6,8,5)),('interior',(4,-8,4)),('top',(0,0,1))])

def hollow_roof_gable():
 reset('Hollow roof repeat and gable assembly')
 place('slate-gable-span',(0,.48,2.9));place('slate-gable-span',(0,1.68,2.9),0,'Second roof repeat');place('gable-end-closure',(0,0,3));
 for side,angle in [(-1,90),(1,-90)]:
  for index,y in enumerate([.48,1.68]):place('paneled-wall-bay',(side*1.8,y,0),angle,('West'if side<0 else'East')+' actual paneled bearing wall '+str(index+1))
 fixture()
 save('hollow-roof-gable',[('exterior',(6,-8,4)),('interior',(2,8,-.6)),('top',(0,0,1))])

def cornice_column():
 reset('Supported mitred cornice portico assembly')
 place('stone-cornice-corner',(0,0,3));place('stone-cornice-straight',(-1.2,0,3));place('stone-cornice-straight',(0,-1.2,3),-90,'Cornice return straight')
 place('tuscan-support-column',(0,0,0),0,'Corner bearing column');place('tuscan-support-column',(-1.8,0,0),0,'West grounded bearing column');place('tuscan-support-column',(0,-1.8,0),0,'South grounded bearing column')
 save('cornice-column',[('exterior',(6,8,5)),('interior',(-7,-8,4)),('top',(0,0,1))])

def main():
 only=sys.argv[sys.argv.index('--only')+1].split(',')if '--only'in sys.argv else None
 for name,builder in [('wall-door-corner',wall_door_corner),('hollow-roof-gable',hollow_roof_gable),('cornice-column',cornice_column)]:
  if only and name not in only:continue
  builder()
if __name__=='__main__':main()
