"""Evidence from shipped GLBs, imported into Blender (not a browser runtime)."""
from pathlib import Path
import sys,json,hashlib
import bpy
from mathutils import Vector
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
from build import SPECS,PACK

def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def bounds(obs):
    ps=[o.matrix_world@v.co for o in obs for v in o.data.vertices]
    return Vector([min(p[i]for p in ps)for i in range(3)]),Vector([max(p[i]for p in ps)for i in range(3)])

def render(stem,view,delta,scale=(1,1),res=768):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    source=PACK/'models'/(stem+'.glb')
    bpy.ops.import_scene.gltf(filepath=str(source))
    obs=[o for o in bpy.context.scene.objects if o.type=='MESH']
    for ob in obs:
        # Apply in world coordinates; no depth scaling, matching the intended opening fit.
        for v in ob.data.vertices:
            p=ob.matrix_world@v.co;p.x*=scale[0];p.z*=scale[1]
            v.co=ob.matrix_world.inverted()@p
    bpy.context.view_layer.update()
    lo,hi=bounds(obs);target=(lo+hi)/2;span=max(hi-lo)
    sc=bpy.context.scene;sc.render.engine='CYCLES';sc.cycles.device='CPU'
    sc.cycles.samples=64;sc.cycles.use_denoising=True
    sc.render.resolution_x=sc.render.resolution_y=res;sc.render.resolution_percentage=100
    sc.render.film_transparent=True;sc.render.image_settings.file_format='PNG';sc.render.image_settings.color_mode='RGBA'
    sc.view_settings.view_transform='AgX'
    world=bpy.data.worlds.new('Neutral daylight studio');world.use_nodes=True
    world.node_tree.nodes['Background'].inputs[0].default_value=(.65,.72,.82,1)
    world.node_tree.nodes['Background'].inputs[1].default_value=.35;sc.world=world
    for power,offset,size in [(350,(2,-3,3),3),(160,(-2,-1,1.5),2),(250,(1,3,2),3)]:
        bpy.ops.object.light_add(type='AREA',location=target+Vector(offset)*span)
        lamp=bpy.context.object;lamp.data.energy=power*span*span;lamp.data.shape='DISK';lamp.data.size=size*span
        lamp.rotation_euler=(target-lamp.location).to_track_quat('-Z','Y').to_euler()
    bpy.ops.object.camera_add(location=target+Vector(delta)*span)
    cam=bpy.context.object;cam.data.type='ORTHO'
    cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler();sc.camera=cam
    basis=cam.rotation_euler.to_matrix();right=basis@Vector((1,0,0));up=basis@Vector((0,1,0))
    pts=[o.matrix_world@v.co for o in obs for v in o.data.vertices]
    pr=[(p.dot(right),p.dot(up))for p in pts]
    a=[min(p[i]for p in pr)for i in range(2)];b=[max(p[i]for p in pr)for i in range(2)]
    cam.location+=right*((a[0]+b[0])/2-target.dot(right))+up*((a[1]+b[1])/2-target.dot(up))
    cam.data.ortho_scale=max(b[i]-a[i]for i in range(2))/.87
    path=(PACK/'previews'if view in ['thumb','top']else HERE/'evidence')/(stem+'-'+view+'.png')
    path.parent.mkdir(parents=True,exist_ok=True);sc.render.filepath=str(path)
    bpy.ops.render.render(write_still=True)
    return dict(id=stem,view=view,source=str(source.relative_to(PACK)),sourceSha256=sha(source),image=str(path.relative_to(PACK)if view in ['thumb','top']else path.relative_to(HERE)),imageSha256=sha(path),scaleWidthHeight=list(scale),boundsBlenderM=[list(lo),list(hi)],cameraDelta=list(delta),resolution=[res,res],engine='Cycles CPU',samples=64,transparentBackground=True,runtime='Blender GLB import; browser not tested')

if __name__=='__main__':
    recipes=[('thumb',(1.7,-4,1.5),(1,1),512),('top',(0,0,4),(1,1),512),
             ('front',(0,-4,0),(1,1),768),('rear',(0,4,0),(1,1),768),
             ('stretch-w120-h80',(1.0,-4,.7),(1.2,.8),768),
             ('stretch-w80-h120',(1.0,-4,.7),(.8,1.2),768),
             ('stretch-w130-h70',(1.0,-4,.7),(1.3,.7),768),
             ('stretch-w70-h130',(1.0,-4,.7),(.7,1.3),768)]
    rows=[]
    for stem,*_ in SPECS:
        for view,delta,scale,res in recipes:rows.append(render(stem,view,delta,scale,res))
    (HERE/'reports/render-bindings.json').write_text(json.dumps(rows,indent=2)+'\n')
