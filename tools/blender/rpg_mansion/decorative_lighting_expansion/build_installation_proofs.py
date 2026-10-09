"""Actual delivered GLB installation and real exported glass contrast proofs."""
import sys,json,hashlib
from pathlib import Path
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[3];sys.path[:0]=[str(HERE),str(HERE.parents[1])]
import bpy,bmesh
import model_kit as kit
from native_utils import sanitize
from build import render
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def load(item):
    bpy.ops.wm.read_factory_settings(use_empty=True);bpy.ops.import_scene.gltf(filepath=str(ROOT/item['model']))
    meshes=[o for o in bpy.context.scene.objects if o.type=='MESH']
    for n,ob in enumerate(meshes):ob['actualExportedGlbSha256']=sha(ROOT/item['model']);ob['proofOrder']=n
    return meshes
def box(name,lo,hi,mat,order=1000):
    ob=kit.box('QA ONLY '+name,lo,hi,mat,0,1);ob['qaFixture']=True;ob['countAsAdditionalModel']=False;ob['proofOrder']=order;return ob
def combined():return kit.combine(sorted([o for o in bpy.context.scene.objects if o.type=='MESH'],key=lambda o:o.get('proofOrder',0)))
def save(item,path):
    sc=bpy.context.scene;sc['deliveredModelSha256']=sha(ROOT/item['model']);sc['qaFixtureExcludedFromModelCount']=True
    sanitize(item['id']);bpy.context.preferences.filepaths.save_version=0;bpy.ops.wm.save_as_mainfile(filepath=str(path),compress=True)
def installed(item):
    meshes=load(item);e=item['defaultElevation']/1000;w=item['w']/1000;d=item['d']/1000;h=item['h']/1000
    for ob in meshes:ob.location.z+=e
    bpy.context.view_layer.update();gray=kit.matp('QA support fixture','#a8aba4',.78,0);mount=item['installationDatums']['installation']['mount']
    if mount=='wall-bracket':
        plane=-item['installationDatums']['installation']['wallContactPlaneGltfZ'];lo=(-w/2-.05,plane,e-.05);hi=(w/2+.05,plane+.04,e+h+.06)
    elif mount=='ceiling-rods':
        plane=2.7;lo=(-w/2-.06,-d/2-.06,plane);hi=(w/2+.06,d/2+.06,plane+.04)
    else:
        plane=e;lo=(-w/2-.07,-d/2-.07,e-.04);hi=(w/2+.07,d/2+.07,e)
    box(mount+' support fixture',lo,hi,gray)
    sc=bpy.context.scene;sc.name='Installed actual GLB with QA support';sc['fixtureBottomElevationMm']=item['defaultElevation'];sc['actualSupportContactPlaneM']=plane
    p=HERE/'proofs'/('qa-installed-'+item['id']+'.blend');save(item,p);ob=combined();images={}
    for view in ['thumb','side','underside']:
        target=HERE/'evidence'/('qa-installed-'+item['id']+'-'+view+'.png');render(ob,target,view);images[view]=dict(path=str(target.relative_to(ROOT)),sha256=sha(target))
    return dict(id=item['id'],modelSha256=sha(ROOT/item['model']),proofSource=str(p.relative_to(ROOT)),proofSourceSha256=sha(p),elevationMm=item['defaultElevation'],contactPlaneM=plane,images=images,qaFixtureExcludedFromModelCount=True)
def remove_glass(ob):
    control=ob.copy();control.data=ob.data.copy();bpy.context.collection.objects.link(control);bm=bmesh.new();bm.from_mesh(control.data)
    faces=[f for f in bm.faces if control.data.materials[f.material_index].name.startswith('Clear lightly tinted glass')];assert faces
    bmesh.ops.delete(bm,geom=faces,context='FACES');bm.to_mesh(control.data);bm.free();return control
def glass(item):
    load(item);post='hexagonal'in item['id'];zcenter=1.28 if post else .175;dz=.057 if post else .045
    for n,(sx,sz)in enumerate([(x,z)for x in [-1,1]for z in [-1,1]]):
        col=('#cf2424'if sx==sz else'#234ed1')if sz>0 else('#f2efc2'if sx==sz else'#131d24')
        mat=kit.matp('QA glass marker '+str(sx)+' '+str(sz),col,.75,0)
        box('glass marker '+str(sx)+' '+str(sz),(sx*.047-.02,0,zcenter+sz*dz-(dz-.002)),(sx*.047+.02,.009,zcenter+sz*dz+(dz-.002)),mat,1000+n)
    path=HERE/'proofs'/('qa-exported-glass-'+item['id']+'.blend');bpy.context.scene.name='Actual exported glass contrast markers';save(item,path);ob=combined()
    points=[ob.matrix_world@v.co for v in ob.data.vertices];lo=[min(p[i]for p in points)for i in range(3)];hi=[max(p[i]for p in points)for i in range(3)];scale=max(hi[0]-lo[0],hi[2]-lo[2])/(1-48/512);cx=(hi[0]+lo[0])/2;cz=(hi[2]+lo[2])/2
    regions={}
    for name,sx,sz in [('blue',-1,1),('red',1,1),('light',-1,-1),('dark',1,-1)]:
        xx=sorted([sx*.045,sx*.064]);zz=[zcenter+sz*dz-.024,zcenter+sz*dz+.024]
        x0=round(256+(xx[0]-cx)/scale*512);x1=round(256+(xx[1]-cx)/scale*512);y0=round(256-(zz[1]-cz)/scale*512);y1=round(256-(zz[0]-cz)/scale*512);regions[name]=[x0,y0,x1,y1]
    images={}
    for mode,target_ob in [('actual-export',ob),('no-glass-control',remove_glass(ob))]:
        target=HERE/'evidence'/('qa-glass-'+item['id']+'-'+mode+'.png');render(target_ob,target,'front');images[mode]=dict(path=str(target.relative_to(ROOT)),sha256=sha(target))
    return dict(id=item['id'],modelSha256=sha(ROOT/item['model']),proofSource=str(path.relative_to(ROOT)),proofSourceSha256=sha(path),regions=regions,images=images,removedOnlyMaterialPrefix='Clear lightly tinted glass',qaFixturesExcludedFromModelCount=True)
def main():
    items=json.loads((HERE/'descriptors.json').read_text())['items'];only=sys.argv[sys.argv.index('--only')+1].split(',')if '--only'in sys.argv else None
    outfile=HERE/'qa/installation-proofs.json';rows=json.loads(outfile.read_text())['items']if outfile.exists()else[]
    gfile=HERE/'qa/glass-marker.json';glass_rows=json.loads(gfile.read_text())['items']if gfile.exists()else[]
    for item in items:
        if only and item['id']not in only:continue
        rows=[r for r in rows if r['id']!=item['id']]+[installed(item)];outfile.write_text(json.dumps(dict(items=rows,errors=[]),indent=2)+'\n');print('INSTALLED_PROOF_READY',item['id'],flush=True)
        if item['installationDatums'].get('glassThicknessProbes'):
            glass_rows=[r for r in glass_rows if r['id']!=item['id']]+[glass(item)];gfile.write_text(json.dumps(dict(items=glass_rows,errors=[]),indent=2)+'\n');print('GLASS_MARKER_READY',item['id'],flush=True)
if __name__=='__main__':main()
