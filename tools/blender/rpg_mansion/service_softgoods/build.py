"""Rebuild original native period service and soft goods. Self-contained; no remote writes."""
from pathlib import Path
import sys,hashlib,struct,json,shutil
sys.path.insert(0,str(Path(__file__).resolve().parent))
from common import *
import common,forms
from png_metadata import strip_metadata

def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def stamp(path):
    raw=path.read_bytes();n=struct.unpack_from('<I',raw,12)[0];d=json.loads(raw[20:20+n]);assert len(d['meshes'])==len(d['scenes'])==1
    d['asset']['extras']=dict(front='+Z',up='+Y',units='metres',origin='bottom-centre',provenance='Original native Blender geometry; no external assets',staticProp=True)
    b=json.dumps(d,separators=(',',':')).encode();b+=b' '*(-len(b)%4);r=raw[20+n:];path.write_bytes(struct.pack('<III',0x46546c67,2,20+len(b)+len(r))+struct.pack('<II',len(b),0x4e4f534a)+b+r)

def render(objects,path,view='thumb',resolution=512):
    if not isinstance(objects,list):objects=[objects]
    scene0=bpy.context.scene;bpy.ops.scene.new(type='NEW');sc=bpy.context.scene;sc.name='Temporary studio evidence'
    copies=[]
    for ob in objects:
        cp=ob.copy();cp.data=ob.data.copy();sc.collection.objects.link(cp);copies.append(cp)
    sc.render.engine='CYCLES';sc.cycles.samples=64;sc.cycles.use_denoising=False;sc.render.resolution_x=sc.render.resolution_y=resolution;sc.render.resolution_percentage=100;sc.render.film_transparent=True;sc.render.image_settings.file_format='PNG';sc.render.image_settings.color_mode='RGBA';sc.view_settings.view_transform='AgX'
    world=bpy.data.worlds.new('Neutral studio');world.use_nodes=True;world.node_tree.nodes['Background'].inputs[0].default_value=(.75,.78,.82,1);world.node_tree.nodes['Background'].inputs[1].default_value=.4;sc.world=world
    pts=[ob.matrix_world@v.co for ob in copies for v in ob.data.vertices];lo=Vector([min(p[i]for p in pts)for i in range(3)]);hi=Vector([max(p[i]for p in pts)for i in range(3)]);span=max(hi-lo);target=(lo+hi)/2
    for label,power,delta,size in [('Key',300,(2,-3,3),3),('Fill',150,(-2,-1,1.5),2),('Rim',130,(1,2,2.4),2)]:
        bpy.ops.object.light_add(type='AREA',location=target+Vector(delta)*span);lamp=bpy.context.object;lamp.name=label;lamp.data.energy=power*span*span;lamp.data.shape='DISK';lamp.data.size=size*span;lamp.rotation_euler=(target-lamp.location).to_track_quat('-Z','Y').to_euler()
    delta={'thumb':(2,-4,1.25),'top':(0,0,4),'front':(0,-4,0),'rear':(0,4,0),'left':(-4,0,0),'right':(4,0,0),'under':(1,-3,-2),'scene':(3,-5,4),'scene-top':(0,0,4),'interior':(-2.1,4,1.1),'interior-front':(0,4,0),'interior-side':(3,4,.6)}[view]
    bpy.ops.object.camera_add(location=target+Vector(delta)*span);cam=bpy.context.object;cam.data.type='ORTHO';cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler();sc.camera=cam
    basis=cam.rotation_euler.to_matrix();right=basis@Vector((1,0,0));up=basis@Vector((0,1,0));pr=[(p.dot(right),p.dot(up))for p in pts];a=[min(p[i]for p in pr)for i in range(2)];b=[max(p[i]for p in pr)for i in range(2)];center=[(a[i]+b[i])/2 for i in range(2)];cam.location+=right*(center[0]-target.dot(right))+up*(center[1]-target.dot(up));cam.data.ortho_scale=max(b[i]-a[i]for i in range(2))/.88
    path.parent.mkdir(parents=True,exist_ok=True);sc.render.filepath=str(path);bpy.ops.render.render(write_still=True);strip_metadata(path);bpy.data.scenes.remove(sc);bpy.context.window.scene=scene0

COLORS={'metal':'#35403e','hardware':'#b29455','wood':'#896443','washsurface':'#b0bbba','fabric':'#632f3a','border':'#cab78b','pattern':'#617464'}

def bounds(obs):
    pts=[o.matrix_world@v.co for o in obs for v in o.data.vertices]
    return [Vector([min(p[i]for p in pts)for i in range(3)]),Vector([max(p[i]for p in pts)for i in range(3)])]

def build(spec):
    slug,fn,label,kind=spec;stem='rpg-mansion-'+slug+'-01';bpy.ops.wm.read_factory_settings(use_empty=True);fn()
    lo,hi=bounds(PARTS);shift=Vector((-(lo.x+hi.x)/2,-(lo.y+hi.y)/2,-lo.z));size=[round(v*1000,3)for v in hi-lo];channels=set()
    DATUM['bottomCenterTranslationBlenderM']=list(shift);DATUM['originalInstalledBoundsBlenderM']=[list(lo),list(hi)];DATUM['defaultElevationMm']=round(lo.z*1000,3)if kind=='range-hood'else 0
    for ob in PARTS:
        for v in ob.data.vertices:v.co+=shift
        channels.update(m['finishChannel']for m in ob.data.materials);positive_winding(ob);author_uv(ob)
    parts=[dict(name=o.name,role=o.get('functionalRole',''),boundsM=[list(v)for v in bounds([o])],materialChannels=sorted(set(m['finishChannel']for m in o.data.materials)))for o in PARTS]
    sc=bpy.context.scene;sc.name='Editable native authoring';sc['front']='-Y';sc['up']='+Z';sc['units']='metres';sc['installationDatumsJson']=json.dumps(DATUM);sc['assetId']=stem;sc['staticProp']=True
    bpy.context.preferences.filepaths.save_version=0;sanitize(stem);author=HERE/'authoring_sources'/(stem+'.blend');bpy.ops.wm.save_as_mainfile(filepath=str(author),compress=True)
    bpy.ops.scene.new(type='FULL_COPY');bpy.context.scene.name='Canonical export';ob=kit.combine([o for o in bpy.context.scene.objects if o.type=='MESH']);ob['assetId']=stem;ob['staticProp']=True
    kit.WORK_DIR=HERE/'sources';kit.unwrap=metric_uv;old=kit.clear_scene;kit.clear_scene=lambda:None;budget=6000
    ob=kit.run([(stem,size,lambda:ob,channels,budget)],do_export=False,do_icons=False)[0];kit.clear_scene=old
    canonical=HERE/'sources'/(stem+'.blend');sanitize(stem);bpy.ops.wm.save_as_mainfile(filepath=str(canonical),compress=True)
    glb=HERE/'models'/(stem+'.glb');export_active(ob,glb);stamp(glb)
    vp=HERE/'sources'/(stem+'-validation.json');r=json.loads(vp.read_text());r.update(datums=DATUM,closedComponentSignedVolumesM3=positive_winding(ob,False),triangle_budget=budget,glb_bytes=glb.stat().st_size,authoringParts=parts);vp.write_text(json.dumps(r,indent=2)+'\n')
    finishes=[dict(key=k,label=k,default=('#9aa7a6'if slug=='manual-wash-tub-board'and k=='metal'else COLORS[k]))for k in sorted(channels)]
    variant=kind=='rug'
    it=dict(id=stem,name=label,kind=kind,group='家具'if kind=='rug'else'住設',category='敷物'if kind=='rug'else('レンジフード'if kind=='range-hood'else'洗濯'),assetSet='rpg-mansion',model='models/'+stem+'.glb',sourceBlend='sources/'+stem+'.blend',authoringBlend='authoring_sources/'+stem+'.blend',validation='sources/'+stem+'-validation.json',builder='build.py',w=size[0],d=size[1],h=size[2],defaultElevation=DATUM['defaultElevationMm'],provenance='original',finishChannels=finishes,triangleBudget=budget,triangles=r['triangles'],staticProp=True,countingClass='functional-footprint-variant'if variant else'new-construction',coreConstructionCount=0 if variant else 1,independentConstructionCount=0 if variant else 1,variantOf='rpg-mansion-rug-01'if variant else None,installationDatums=json.loads(json.dumps(DATUM)),placementNotes=DATUM['staticLimit'],status='candidate-awaiting-root-and-independent-acceptance')
    for view in ['thumb','top','front','rear','left','right','under']:it[view]=('previews/'if view in ['thumb','top']else'evidence/')+stem+'-'+view+'.png'
    it['hashes']={key:sha(HERE/it[key])for key in ['model','sourceBlend','authoringBlend','validation']}
    dp=HERE/'descriptors.json';items=json.loads(dp.read_text())['items']if dp.exists()else[];items=[i for i in items if i['id']!=stem]+[it];dp.write_text(json.dumps(dict(set='rpg-mansion',newConstructionCount=3,functionalFootprintVariantCount=1,poseVariantCount=0,accessoryOnlyCount=0,items=items),indent=2)+'\n')
    print('STABLE_NATIVE_PAIR',stem,r['triangles'],flush=True);return it

def freeze(label):
    cp=HERE/'checkpoints'/label;assert not cp.exists(),cp;cp.mkdir()
    for name in ['build.py','forms.py','common.py','audit_existing.py','helpers','descriptors.json','authoring_sources','sources','models']:
        p=HERE/name
        if p.is_dir():shutil.copytree(p,cp/name,ignore=shutil.ignore_patterns('__pycache__'))
        else:shutil.copy2(p,cp/name)
    (cp/'reports').mkdir();shutil.copy2(HERE/'reports/existing-oven-bedding-audit.json',cp/'reports/existing-oven-bedding-audit.json')
    inventory={str(p.relative_to(cp)):dict(sha256=sha(p),bytes=p.stat().st_size)for p in cp.rglob('*')if p.is_file()};(cp/'checkpoint.json').write_text(json.dumps(dict(stage=label,candidateOnly=True,newConstructionCount=3,functionalFootprintVariantCount=1,files=inventory),indent=2)+'\n')
    for p in cp.rglob('*'):
        if p.is_file():p.chmod(0o444)
    cp.chmod(0o555);print('IMMUTABLE_CHECKPOINT',cp,flush=True)

def main():
    only=sys.argv[sys.argv.index('--only')+1].split(',')if '--only'in sys.argv else None
    if '--render-only'in sys.argv:
        for it in json.loads((HERE/'descriptors.json').read_text())['items']:
            if only and it['id'].removeprefix('rpg-mansion-').removesuffix('-01')not in only:continue
            bpy.ops.wm.open_mainfile(filepath=str(HERE/it['sourceBlend']));ob=next(o for o in bpy.context.scene.objects if o.type=='MESH')
            views=sys.argv[sys.argv.index('--views')+1].split(',')if '--views'in sys.argv else['thumb','top','front','rear','left','right','under']
            for view in views:render(ob,HERE/it[view],view)
    else:
        for spec in forms.SPECS:
            if only is None or spec[0]in only:build(spec)
        if '--checkpoint'in sys.argv:freeze(sys.argv[sys.argv.index('--checkpoint')+1])
if __name__=='__main__':main()
