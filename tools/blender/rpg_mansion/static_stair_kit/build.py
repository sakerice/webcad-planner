"""Original static mansion stair kit producer. Run in Blender 4.3 or later."""
from pathlib import Path
import sys,hashlib,struct,json,math
sys.path.insert(0,str(Path(__file__).resolve().parent))
from common import *
import forms
from png_metadata import strip_metadata
SPECS=[
('flight-nine-riser',lambda:forms.flight(9),'Nine-riser housed timber stair flight','new-core','flight',12000),
('flight-eighteen-riser',lambda:forms.flight(18),'Eighteen-riser full-storey timber stair flight','dimensional-variant','flight',22000),
('square-supported-landing',lambda:forms.landing(1.16),'1160 mm grounded square stair landing','new-core','landing',14000),
('return-supported-landing',lambda:forms.landing(2.4),'2400 mm grounded return stair landing','dimensional-variant','landing',16000),
('guard-nine-riser',lambda:forms.rake(9),'Nine-riser turned walnut raked guard','new-core','raked-guard',30000),
('guard-eighteen-riser',lambda:forms.rake(18),'Eighteen-riser turned walnut raked guard','dimensional-variant','raked-guard',58000),
('landing-guard-straight',lambda:forms.guard('straight'),'Straight landing guard with central support','new-core','landing-guard',14000),
('landing-guard-corner',lambda:forms.guard('corner'),'Quarter-turn landing corner guard','host-fitting-variant','landing-guard',22000),
('landing-guard-return',lambda:forms.guard('return'),'Return landing U-shaped guard','host-fitting-variant','landing-guard',40000),
('terminal-receiver-newel',forms.newel,'Terminal handrail receiver newel','zero-core-accessory','newel',3000)]

def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def stamp(p):
    raw=p.read_bytes();n=struct.unpack_from('<I',raw,12)[0];d=json.loads(raw[20:20+n]);d['asset']['extras']=dict(front='+Z',up='+Y',units='metres',origin='bottom-centre',packId='rpg-mansion',provenance='Original procedural Blender geometry, no third-party models or textures.',staticProp=True)
    js=json.dumps(d,separators=(',',':')).encode();js+=b' '*(-len(js)%4);rest=raw[20+n:];p.write_bytes(struct.pack('<III',0x46546c67,2,20+len(js)+len(rest))+struct.pack('<II',len(js),0x4e4f534a)+js+rest)

def render(objects,path,view,res=512):
    bpy.ops.scene.new(type='NEW');sc=bpy.context.scene
    obs=[]
    for ob in objects:
        cp=ob.copy();cp.data=ob.data.copy();sc.collection.objects.link(cp);obs.append(cp)
    sc.render.engine='CYCLES';sc.cycles.samples=24;sc.cycles.use_denoising=False;sc.render.resolution_x=sc.render.resolution_y=res;sc.render.resolution_percentage=100;sc.render.film_transparent=True;sc.render.image_settings.file_format='PNG';sc.render.image_settings.color_mode='RGBA'
    world=bpy.data.worlds.new('Neutral product studio');world.use_nodes=True;world.node_tree.nodes['Background'].inputs[0].default_value=(.78,.81,.85,1);world.node_tree.nodes['Background'].inputs[1].default_value=.4;sc.world=world;sc.view_settings.view_transform='AgX'
    pts=[ob.matrix_world@v.co for ob in obs for v in ob.data.vertices];lo=Vector([min(p[i]for p in pts)for i in range(3)]);hi=Vector([max(p[i]for p in pts)for i in range(3)]);span=max(hi-lo);target=(lo+hi)/2
    for nm,en,offset,size in [('Key',300,(2,-3,4),3),('Fill',130,(-2,-1,2),3),('Rim',180,(1,3,3),2)]:
        bpy.ops.object.light_add(type='AREA',location=target+Vector(offset)*span);lamp=bpy.context.object;lamp.name=nm;lamp.data.energy=en*span*span;lamp.data.size=size*span;lamp.rotation_euler=(target-lamp.location).to_track_quat('-Z','Y').to_euler()
    direction={'thumb':(3,-4,2.6),'top':(0,0,5),'front':(0,-5,.0),'rear':(-3,4,2),'side':(5,0,0),'assembly':(4,-6,4.5)}[view]
    bpy.ops.object.camera_add(location=target+Vector(direction)*span);cam=bpy.context.object;cam.data.type='ORTHO';cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler();sc.camera=cam
    basis=cam.rotation_euler.to_matrix();right=basis@Vector((1,0,0));up=basis@Vector((0,1,0));q=[(p.dot(right),p.dot(up))for p in pts];low=[min(p[i]for p in q)for i in (0,1)];high=[max(p[i]for p in q)for i in (0,1)];cam.location+=right*((low[0]+high[0])/2-target.dot(right))+up*((low[1]+high[1])/2-target.dot(up));cam.data.ortho_scale=max(high[i]-low[i]for i in (0,1))/0.89
    path.parent.mkdir(parents=True,exist_ok=True);sc.render.filepath=str(path);bpy.ops.render.render(write_still=True);strip_metadata(path);bpy.data.scenes.remove(sc)

def build(spec):
    slug,fn,label,counting,role,budget=spec;stem='rpg-mansion-stair-'+slug+'-01';bpy.ops.wm.read_factory_settings(use_empty=True);reset();fn()
    pts=[ob.matrix_world@v.co for ob in PARTS for v in ob.data.vertices];lo=Vector([min(p[i]for p in pts)for i in range(3)]);hi=Vector([max(p[i]for p in pts)for i in range(3)]);shift=Vector((-(lo.x+hi.x)/2,-(lo.y+hi.y)/2,-lo.z));size=[round(v*1000,4)for v in hi-lo]
    DATUM['bottomCenterTranslationBlenderM']=list(shift);DATUM['constructionBoundsM']=[list(lo),list(hi)]
    DATUM['coordinateRule']='Asset Blender coordinate = construction coordinate + bottomCenterTranslationBlenderM. glTF coordinate = (Blender x, Blender z, -Blender y).'
    named=[]
    for ob in PARTS:
        for v in ob.data.vertices:v.co+=shift
        positive_winding(ob);named.append(dict(name=ob.name,vertexCount=len(ob.data.vertices),role=ob.get('functionalRole','construction')))
    sc=bpy.context.scene;sc.name='Editable original stair construction';sc['installationDatumsJson']=json.dumps(DATUM);sc['front']='-Y';sc['up']='+Z';sc['units']='metres'
    # Canonical metric UV will be transferred back to editable sources by part order.
    channels={m['finishChannel']for ob in PARTS for m in ob.data.materials}
    author=HERE/'authoring_sources'/(stem+'.blend');sanitize(stem);bpy.context.preferences.filepaths.save_version=0;bpy.ops.wm.save_as_mainfile(filepath=str(author),compress=True)
    bpy.ops.scene.new(type='FULL_COPY');sc=bpy.context.scene;sc.name='Canonical single mesh export';ob=kit.combine([o for o in sc.objects if o.type=='MESH']);ob.name=stem;positive_winding(ob);metric_uv(ob);uv=kit.uv_report(ob);ob.data.calc_loop_triangles();tri=len(ob.data.loop_triangles);assert tri<=budget,(stem,tri,budget)
    
    if uv['degenerate_uv']:
        for ix in uv['degenerate_uv_indices']:
            tr=ob.data.loop_triangles[ix];print('UV_DEBUG',ix,tr.polygon_index,[list(ob.data.vertices[v].co)for v in tr.vertices],[list(ob.data.uv_layers.active.data[l].uv)for l in tr.loops],flush=True)
    assert uv['degenerate_world']==uv['degenerate_uv']==0
    ob['assetId']=stem;ob['staticProp']=True;ob['installationDatumsJson']=json.dumps(DATUM)
    canonical=HERE/'sources'/(stem+'.blend');sanitize(stem);bpy.ops.wm.save_as_mainfile(filepath=str(canonical),compress=True);glb=HERE/'models'/(stem+'.glb');export_active(ob,glb);stamp(glb)
    validation=HERE/'reports'/(stem+'-validation.json');validation.write_text(json.dumps(dict(id=stem,triangles=tri,triangleBudget=budget,dimensionsMm=size,uv=uv,positiveComponentVolumesM3=positive_winding(ob,False),nativePartCount=len(named),nativeParts=named,installationDatums=DATUM,contacts=CONTACTS,sourceSha256=sha(canonical),authoringSha256=sha(author),glbSha256=sha(glb)),indent=2)+'\n')
    it=dict(id=stem,name=label,group='住設',category='階段・手摺',assetSet='rpg-mansion',model='models/'+glb.name,sourceBlend='sources/'+canonical.name,authoringBlend='authoring_sources/'+author.name,validation='reports/'+validation.name,builder='build.py',w=size[0],d=size[1],h=size[2],defaultElevation=0,triangles=tri,triangleBudget=budget,glbBytes=glb.stat().st_size,sha256=sha(glb),sourceSha256=sha(canonical),authoringSha256=sha(author),countingClass=counting,coreConstructionCount=int(counting=='new-core'),role=role,staticProp=True,provenance='original',freshQARequired=True,installationDatums=DATUM.copy(),finishChannels=[dict(key=k,label=k,default={'wood':'#92633c','paint':'#d8ceb5','metal':'#a48245'}[k])for k in sorted(channels)],placementNotes='Static manually placed module. Use documented rigid installation datums. No native stair routing, floor cutting, traversal, building-code or structural/load certification. Parts may include intentional joinery seating; see assembly contacts.')
    for v in ('thumb','top','front','rear'):it[v]=('previews/'if v in ('thumb','top')else'evidence/')+stem+'-'+v+'.png'
    dp=HERE/'descriptors.json';items=json.loads(dp.read_text())['items']if dp.exists()else[];items=[x for x in items if x['id']!=stem]+[it];dp.write_text(json.dumps(dict(set='rpg-mansion',name='Original mansion static stair kit',stage='candidate-requires-independent-acceptance',counting=dict(newCore=4,dimensionalVariants=3,hostFittingVariants=2,connectorAccessories=1,total=10),items=items),ensure_ascii=False,indent=2)+'\n')
    print('STABLE_PAIR',stem,tri,flush=True)
    if '--no-icons'not in sys.argv:
        for v in ('thumb','top','front','rear'):render([ob],HERE/it[v],v)
    return it

def main():
    only=sys.argv[sys.argv.index('--only')+1].split(',')if '--only'in sys.argv else None
    if '--render-only'in sys.argv:
        for it in json.loads((HERE/'descriptors.json').read_text())['items']:
            if only and it['id'].removeprefix('rpg-mansion-stair-').removesuffix('-01')not in only:continue
            bpy.ops.wm.open_mainfile(filepath=str(HERE/it['sourceBlend']));ob=next(o for o in bpy.context.scene.objects if o.type=='MESH')
            for v in ('thumb','top','front','rear'):render([ob],HERE/it[v],v)
    else:
        for spec in SPECS:
            if not only or spec[0]in only:build(spec)
    (HERE/'rights-and-provenance.json').write_text(json.dumps(dict(authoring='Original project-authored procedural Blender geometry',thirdPartyGeometry=False,thirdPartyTextures=False,paidGeneration=False,license='Project-authored assets for this project; no separate public reuse license granted.',helperProvenance='Copied project-authored mesh and export helpers from the accepted garden production. No accepted bytes modified.',sources={str(p.relative_to(HERE)):sha(p)for p in list(HERE.glob('*.py'))+list((HERE/'helpers').glob('*.py'))}),indent=2)+'\n')
if __name__=='__main__':main()
