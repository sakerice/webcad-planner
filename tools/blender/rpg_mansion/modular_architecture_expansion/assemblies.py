"""Actual exported-GLB installed room proof, rigid transforms and no fixtures.
Cutaway views explicitly omit whole delivered instances. Saved source keeps all.
"""
import sys,json,math,hashlib
from pathlib import Path
import bpy
from mathutils import Vector,Matrix
H=Path(__file__).resolve().parent;ROOT=H.parents[3];sys.path[:0]=[str(H),str(H.parent),str(H.parent.parent)]
from render import render
from sanitize_sources import sanitize_loaded
D={i['id'].removeprefix('rpg-mansion-').removesuffix('-01'):i for i in json.loads((H/'descriptors.json').read_text())['items']}
OUT=H/'assemblies';OUT.mkdir(exist_ok=True);ROWS=[];OBJS=[]

def place(key,location=(0,0,0),angle=0,label=None,category=None):
 item=D[key];path=ROOT/item['model'];before=set(bpy.data.objects);bpy.ops.import_scene.gltf(filepath=str(path));objects=[o for o in bpy.data.objects if o not in before and o.type=='MESH'];assert len(objects)==1
 ob=objects[0];off=Vector(item['moduleContract']['constructionToAssetTranslationM']);rotation=Matrix.Rotation(math.radians(angle),4,'Z');placement=Matrix.Translation(Vector(location))@rotation@Matrix.Translation(-off);ob.matrix_world=placement@ob.matrix_world;ob.name=label or key;ob['sourceModelSha256']=item['hashes']['model'];ob['assemblyRole']=item['moduleContract']['role'];ob['moduleCategory']=category or 'wall';OBJS.append(ob)
 worldcons=[]
 for c in item['moduleContract']['connections']:
  pt=placement@Vector(c['assetPointM']);normal=rotation.to_3x3()@Vector(c['normal']);worldcons.append(dict(label=c['label'],pointBlenderWorldM=list(pt),normalBlenderWorld=list(normal),pointGltfWorldM=[pt.x,pt.z,-pt.y],normalGltfWorld=[normal.x,normal.z,-normal.y]))
 ROWS.append(dict(label=ob.name,id=item['id'],model=item['model'],modelSha256=item['hashes']['model'],constructionDatumWorldM=list(location),zRotationDegrees=angle,sourceToConstructionTranslationM=list(-off),assetToWorldBlenderMatrix=[list(r) for r in placement],worldConnections=worldcons,category=category or 'wall'));return ob

def build_room():
 bpy.ops.wm.read_factory_settings(use_empty=True);bpy.context.scene.name='Actual complete mansard room with fixed glazing';bpy.context.scene.unit_settings.system='METRIC'
 for label,x,y,angle in [('NE',1.8,2.4,0),('NW',-1.8,2.4,90),('SW',-1.8,-2.4,180),('SE',1.8,-2.4,-90)]:place('exterior-return-corner',(x,y,0),angle,label+' exterior corner')
 for i,x in enumerate([-.6,.6]):place('plain-plaster-bay',(x,2.4,0),180,'North plain wall '+str(i+1))
 place('arched-doorway-bay',(-.3,-2.4,0),0,'South real arched doorway');place('plain-plaster-filler-600',(.9,-2.4,0),0,'South600mm width-only closure variant')
 for side,angle in [(-1,-90),(1,90)]:
  for i,y in enumerate([-1.2,0,1.2]):place('raised-sill-fixed-window-bay' if i==1 else 'plain-plaster-bay',(side*1.8,y,0),angle,('West' if side<0 else 'East')+(' fixed window' if i==1 else ' plain wall '+str(i+1)))
 for ix,x in enumerate([-1.2,0,1.2]):
  for iy,y in enumerate([-1.8,-.6,.6,1.8]):
   place('herringbone-parquet-tile',(x,y,-.075),0,'Floor tile %s-%s'%(ix+1,iy+1),'floor')
   place('coffered-ceiling-panel',(x,y,2.86),0,'Ceiling panel %s-%s'%(ix+1,iy+1),'ceiling')
 place('mansard-roof-span',(0,0,2.9),0,'Actual centre mansard span','roof');place('mansard-hipped-end',(0,-.6,2.9),0,'Actual front mansard hip','roof');place('mansard-hipped-end',(0,.6,2.9),180,'Actual rear mansard hip','roof')


def save():
 scene=bpy.context.scene;scene['assemblyOnly']=True;scene['assetCountMeaning']='41 actual delivered module instances; repeated instances and dimension variant do not add construction-family count. No QA fixtures.';scene['assemblyManifest']=json.dumps(ROWS);sanitize_loaded('joined-mansard-room');path=OUT/'joined-mansard-room.blend';bpy.context.preferences.filepaths.save_version=0;bpy.ops.wm.save_as_mainfile(filepath=str(path),compress=True);sourcehash=hashlib.sha256(path.read_bytes()).hexdigest();views={}
 recipes=[('exterior',(6,-8,5),{'wall','floor','ceiling','roof'}),('top',(0,0,1),{'wall','floor','ceiling','roof'}),('room-cutaway',(6,-8,7),{'wall','floor'}),('ceiling-underside',(5,-7,-6),{'wall','ceiling','roof'}),('roof-underside',(5,-7,-5),{'roof'}),('ceiling-array',(5,-7,-6),{'ceiling'})]
 for view,direction,cats in recipes:
  visible=[o for o in OBJS if o.get('moduleCategory') in cats]
  for o in OBJS:o.hide_render=o not in visible
  image=OUT/('joined-mansard-room-'+view+'.png');camera=render(visible,image,direction,resolution=1024,samples=48);views[view]=dict(path=str(image.relative_to(ROOT)),sha256=hashlib.sha256(image.read_bytes()).hexdigest(),camera=camera,visibleCategories=sorted(cats),omittedInstances=[o.name for o in OBJS if o not in visible],note='Whole-module visibility cutaway only; all geometry and placement unchanged.')
 assert sourcehash==hashlib.sha256(path.read_bytes()).hexdigest()
 report=dict(name='joined-mansard-room',source=str(path.relative_to(ROOT)),sourceSha256=sourcehash,instances=ROWS,fixtures=[],views=views,installationDatumsMm=dict(wallCentrelines=[3600,4800],wallClearCoreInterior=[3360,4560],floorBottom=-75,finishedFloor=0,ceilingBottom=2860,recessFieldUnderside=2960,ceilingTop=3000,wallTop=3000,roofBottom=2900,roofBearing=3000,roofRidgeTop=4830),installationNotes=['Perimeter ceiling beam rings embed120mm into the solid wall heads, capped by the actual roof bearing seats. They are static meshes; no native wall cutting is implied.','Roof flashing lower faces meet slate tops exactly; flashings and55mm hollow weather decks join on matching repeat planes.','Parquet repeat is1200mm in both axes, including board position and color phase.'])
 (OUT/'joined-mansard-room.json').write_text(json.dumps(report,indent=2)+'\n');print('ASSEMBLY_READY',len(ROWS),'actual module instances',flush=True)

if __name__=='__main__':build_room();save()
