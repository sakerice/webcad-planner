"""Build the original garden reconstruction and expansion. No external assets."""
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parent))
from common import *
import common,terrace_gate_forms as forms
import hashlib,struct
from png_metadata import strip_metadata

SPECS=[
('supported-oak-terrace',forms.terrace,'Supported oak terrace','deck','new-core',8000),
('braced-oak-gate-leaf',forms.gate,'Braced oak gate leaf','fence','new-core',6000),
('gate-strike-receiver',forms.receiver,'Gate strike receiver','fence','zero-core-accessory',2000)]

def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()

def stamp(path):
    raw=path.read_bytes();n=struct.unpack_from('<I',raw,12)[0];d=json.loads(raw[20:20+n]);assert len(d.get('meshes',[]))==len(d.get('scenes',[]))==1
    d['asset']['extras']=dict(front='+Z',up='+Y',units='metres',origin='bottom-centre',packId='rpg-mansion',provenance='Original native Blender construction; no imported geometry or images.',generator='build.py',staticProp=True)
    payload=json.dumps(d,separators=(',',':')).encode();payload+=b' '*(-len(payload)%4);rest=raw[20+n:];path.write_bytes(struct.pack('<III',0x46546c67,2,20+len(payload)+len(rest))+struct.pack('<II',len(payload),0x4e4f534a)+payload+rest)

def render(ob,path,view,span_power=True,resolution=512,samples=32):
    bpy.ops.scene.new(type='NEW');scene=bpy.context.scene;scene.name='Temporary product evidence';copy=ob.copy();copy.data=ob.data.copy();scene.collection.objects.link(copy);ob=copy
    scene.render.engine='CYCLES';scene.cycles.samples=samples;scene.cycles.use_denoising=False;scene.render.resolution_x=scene.render.resolution_y=resolution;scene.render.resolution_percentage=100;scene.render.film_transparent=True;scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA'
    world=bpy.data.worlds.new('Neutral studio');world.use_nodes=True;world.node_tree.nodes['Background'].inputs[0].default_value=(.75,.78,.82,1);world.node_tree.nodes['Background'].inputs[1].default_value=.35;scene.world=world;scene.view_settings.view_transform='AgX'
    pts=[ob.matrix_world@v.co for v in ob.data.vertices];lo=Vector([min(p[i]for p in pts)for i in range(3)]);hi=Vector([max(p[i]for p in pts)for i in range(3)]);span=max(hi-lo);target=(lo+hi)/2
    for name,power,loc,size in [('Key',350,(span*2,-span*3,span*3),span*3),('Fill',150,(-span*2,-span,span*1.5),span*2),('Rim',90,(span,span*2,span*2.4),span*2)]:
        bpy.ops.object.light_add(type='AREA',location=loc);lamp=bpy.context.object;lamp.name=name;lamp.data.energy=power*(span*span if span_power else min(1,span*span));lamp.data.shape='DISK';lamp.data.size=size;lamp.rotation_euler=(target-lamp.location).to_track_quat('-Z','Y').to_euler()
    if view=='top':loc=target+Vector((0,0,span*4))
    elif view=='front':loc=Vector((target.x,target.y-span*4,target.z))
    elif view=='rear':loc=target+Vector((-span*2.5,span*4,span*1.8))
    elif 'basin' in ob.name:loc=target+Vector((span*1.6,-span*2.5,span*3.8))
    else:loc=target+Vector((span*2.5,-span*4,span*1.8))
    bpy.ops.object.camera_add(location=loc);cam=bpy.context.object;cam.data.type='ORTHO';cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler();scene.camera=cam
    basis=cam.rotation_euler.to_matrix();right=basis@Vector((1,0,0));up=basis@Vector((0,1,0));projected=[(p.dot(right),p.dot(up))for p in pts];lows=[min(p[i]for p in projected)for i in range(2)];highs=[max(p[i]for p in projected)for i in range(2)];centre=[(lows[i]+highs[i])/2 for i in range(2)];cam.location+=right*(centre[0]-target.dot(right))+up*(centre[1]-target.dot(up));cam.data.ortho_scale=max(highs[i]-lows[i]for i in range(2))/(1-48/512)
    path.parent.mkdir(parents=True,exist_ok=True);scene.render.filepath=str(path);bpy.ops.render.render(write_still=True);strip_metadata(path);bpy.data.scenes.remove(scene)

def build(spec):
    slug,fn,label,kind,counting,budget=spec;stem='rpg-mansion-garden-'+slug+'-01';bpy.ops.wm.read_factory_settings(use_empty=True);reset();fn()
    pts=[ob.matrix_world@v.co for ob in PARTS for v in ob.data.vertices];lo=Vector([min(p[i]for p in pts)for i in range(3)]);hi=Vector([max(p[i]for p in pts)for i in range(3)]);shift=Vector((-(lo.x+hi.x)/2,-(lo.y+hi.y)/2,-lo.z));size=[round(v*1000,3)for v in hi-lo]; DATUM['nativeEditableParts']=len(PARTS)
    channels=set()
    for ob in PARTS:
        for v in ob.data.vertices:v.co+=shift
        channels.update(m['finishChannel']for m in ob.data.materials);positive_winding(ob);author_uv(ob)
    for c in CONTACTS:c['pointM']=[c['pointM'][i]+shift[i]for i in range(3)]
    DATUM['bottomCenterTranslationBlenderM']=list(shift);DATUM['originalBoundsM']=[list(lo),list(hi)]
    if 'wallContactPlaneBlenderY'in DATUM.get('installation',{}):DATUM['installation']['wallContactPlaneGltfZ']=-(DATUM['installation']['wallContactPlaneBlenderY']+shift.y)
    sc=bpy.context.scene;sc.name='Editable native authoring';sc['front']='-Y';sc['up']='+Z';sc['units']='metres';sc['installationDatumsJson']=json.dumps(DATUM);sc['attachmentCount']=len(CONTACTS)
    (HERE/'reports'/(stem+'-contacts.json')).write_text(json.dumps(CONTACTS,indent=2)+'\n')
    sanitize(stem);author=HERE/'authoring_sources'/(stem+'.blend');bpy.context.preferences.filepaths.save_version=0;bpy.ops.wm.save_as_mainfile(filepath=str(author),compress=True)
    bpy.ops.scene.new(type='FULL_COPY');bpy.context.scene.name='Canonical export';ob=kit.combine([o for o in bpy.context.scene.objects if o.type=='MESH']);ob['staticProp']=True;ob['assetId']=stem
    kit.WORK_DIR=HERE/'sources';kit.unwrap=metric_uv;old=kit.clear_scene;kit.clear_scene=lambda:None
    ob=kit.run([(stem,size,lambda:ob,channels,budget)],do_export=False,do_icons=False)[0];kit.clear_scene=old
    canonical=HERE/'sources'/(stem+'.blend');sanitize(stem);bpy.ops.wm.save_as_mainfile(filepath=str(canonical),compress=True)
    glb=HERE/'models'/(stem+'.glb');export_active(ob,glb);stamp(glb)
    validation=HERE/'sources'/(stem+'-validation.json');report=json.loads(validation.read_text());report.update(triangle_budget=budget,glb_bytes=glb.stat().st_size,datums=DATUM,closedComponentSignedVolumesM3=positive_winding(ob,False),source_sha256=sha(canonical),glb_sha256=sha(glb),authoring_sha256=sha(author));validation.write_text(json.dumps(report,indent=2)+'\n')
    it=dict(id=stem,name=label,kind=kind,packId='rpg-mansion',model=str(glb.relative_to(HERE)),sourceBlend=str(canonical.relative_to(HERE)),authoringBlend=str(author.relative_to(HERE)),validation=str(validation.relative_to(HERE)),attachments='reports/'+stem+'-contacts.json',builder='build.py',w=size[0],d=size[1],h=size[2],actualMeasuredDimensionsMm=size,triangleBudget=budget,triangles=report['triangles'],glbBytes=glb.stat().st_size,sha256=sha(glb),sourceSha256=sha(canonical),authoringSha256=sha(author),countingClass=counting,coreConstructionCount=0 if counting=='zero-core-accessory'else 1,novelCoreCount=1 if counting=='new-core'else 0,staticProp=True,nativeEditableParts=DATUM['nativeEditableParts'],provenance='original',reconstruction=counting=='historical-reconstruction',freshQARequired=True,installationDatums=DATUM.copy(),finishChannels=sorted(channels))
    for v in ['thumb','top','front','rear']:it[v]=('previews/'if v in ['thumb','top']else'evidence/')+stem+'-'+v+'.png'
    p=HERE/'descriptors.json';items=json.loads(p.read_text())['items']if p.exists()else[];items=[i for i in items if i['id']!=stem]+[it]
    p.write_text(json.dumps(dict(set='rpg-mansion-terrace-gate',stage='candidate-requires-independent-acceptance',historicalReconstructionCount=0,newCoreCount=2,zeroCoreAccessoryCount=1,items=items),indent=2)+'\n')
    print('STABLE_PAIR',stem,report['triangles'],glb.stat().st_size,flush=True)
    if '--no-icons'not in sys.argv:
        views=sys.argv[sys.argv.index('--views')+1].split(',')if '--views'in sys.argv else['thumb','top','front','rear']
        for v in views:render(ob,HERE/it[v],v,counting!='historical-reconstruction')
    return it

def main():
    only=sys.argv[sys.argv.index('--only')+1].split(',')if '--only'in sys.argv else None
    if '--render-only'in sys.argv:
        items=json.loads((HERE/'descriptors.json').read_text())['items']
        for it in items:
            if only and it['id'].removeprefix('rpg-mansion-garden-').removesuffix('-01')not in only:continue
            bpy.ops.wm.open_mainfile(filepath=str(HERE/it['sourceBlend']));ob=next(o for o in bpy.context.scene.objects if o.type=='MESH')
            views=sys.argv[sys.argv.index('--views')+1].split(',')if '--views'in sys.argv else['thumb','top','front','rear']
            for v in views:render(ob,HERE/it[v],v,it['countingClass']!='historical-reconstruction')
    else:
        for spec in SPECS:
            if only is None or spec[0]in only:build(spec)
    (HERE/'rights-and-provenance.json').write_text(json.dumps(dict(authoring='Original project-authored native Blender geometry',thirdPartyGeometry=False,thirdPartyTextures=False,paidGeneration=False,license='Original project-authored assets for this project; no separate public reuse license granted',reconstructionNotice='Two new core constructions and one zero-core strike receiver accessory. All require independent acceptance; accepted input products are immutable and excluded from new counts.',sources={p.name:sha(p)for p in HERE.glob('*.py')}),indent=2)+'\n')
if __name__=='__main__':main()
