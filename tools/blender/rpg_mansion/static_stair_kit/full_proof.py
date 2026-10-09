"""Full18-riser flight with an actual guarded upper-floor opening from delivered kit GLBs."""
from pathlib import Path
import sys,json,math
sys.path.insert(0,str(Path(__file__).resolve().parent))
import assemble as A
from assemble import *

def build():
    bpy.ops.wm.read_factory_settings(use_empty=True);reset();PLACED.clear();CONTEXT.clear();PROBES.clear();L=17*forms.G
    stair=place('flight-eighteen-riser','Full-storey eighteen-riser flight')
    right=place('guard-eighteen-riser','Full-storey right raked guard');left=place('guard-eighteen-riser','Full-storey left raked guard',(-1.08,0,0))
    void=(-.64,.64,.56,L+.06);floor_ring(-1.70,1.70,-.50,L+1.5,void);ledges=receiving_ledge((0,L,0),0)
    edge_guards=[]
    # Three standard panels per side, with shared receiver posts and a front cross-panel.
    for x in (-.70,.70):
        for j in range(4):edge_guards.append(place('terminal-receiver-newel','Opening edge receiver newel',(x,.50+j*1.44,3.)))
        for j in range(3):edge_guards.append(place('landing-guard-straight','Opening edge standard guard',(x,.67+j*1.44,3.)))
    edge_guards.append(place('landing-guard-straight','Opening front cross guard',(-.55,.50,3.),-math.pi/2))
    paths=path_samples(stair,(0,0,0),0,18);contacts=[]
    for j,x in enumerate((-.54,.54)):
        contacts.append(contact_z('Full flight head shoe %.2f'%x,stair,ledges[j],(x,L+.035,2.81)))
        guard=left if x<0 else right
        for i in range(17):contacts.append(contact_z('Full guard shoe %.2f tread%d'%(x,i+1),guard,stair,(x,i*forms.G+.10,(i+1)*forms.R)))
    ceilings=[ob for ob in CONTEXT if ob.name.startswith('Upper floor')];head=[]
    for p in paths:
        candidates=[]
        for ob in ceilings:
            hit,normal,index,dist=bvh(ob).ray_cast(p+Vector((0,0,.002)),Vector((0,0,1)),10)
            if hit is not None:candidates.append((dist+.002,ob.name))
        m=min(candidates)if candidates else None;head.append(dict(walkingPointM=list(p),overhead=m,**{'pass':m is None or m[0]>=2.1}))
    supports=[]
    for j,x in enumerate((-.54,.54)):
        suffix=''if j==0 else'.001';side='Left'if j==0 else'Right'
        for label,part,host,point,minimum in [
            ('Full flight foot to ground','Foot bearing plate'+suffix,'Visible ground bearing slab',(x,.21,0),.035),
            ('Full flight stringer to foot',side+' continuous housed stringer','Foot bearing plate'+suffix,(x,.24,.008),.025),
            ('Full flight shoe to upper ledge','Head bearing plate'+suffix,ledges[j].name,(x,L+.035,2.81),.003),
            ('Full flight notch to head shoe',side+' continuous housed stringer','Head bearing plate'+suffix,(x,L+.035,2.82),.0028)]:
            supports.append(dict(label=label,part=stair.name+' / '+part,host=host,pointWorldBlenderM=list(point),normalWorldBlender=[0,0,1],minimumPositiveAreaM2=minimum,planeToleranceM=.0001))
    d=dict(exactGuardedEdges=[{'edge':'west','openingEdge':[-.64,.56,-.64,L+.06],'railCenterline':[-.70,.50,-.70,4.82],'instances':[p['name']for p in PLACED if p['name'].startswith('Opening')and p['constructionPositionBlenderM'][0]==-.70]},{'edge':'east','openingEdge':[.64,.56,.64,L+.06],'railCenterline':[.70,.50,.70,4.82],'instances':[p['name']for p in PLACED if p['name'].startswith('Opening')and p['constructionPositionBlenderM'][0]==.70]},{'edge':'front','openingEdge':[-.64,.56,.64,.56],'railCenterline':[-.70,.50,.70,.50],'instances':[p['name']for p in PLACED if p['name'].startswith('Opening')and p['constructionPositionBlenderM'][1]==.50]}],intendedAccessGap={'planeY':L+.06,'centerX':0,'clearWidthBetweenReceiverArmsM':1.18,'minimumBetweenRakedNewelCapsM':.96},guardContactContract={'floorMountPlaneM':3.,'horizontalHandrailCenterM':3.95,'horizontalLowerRailCenterM':3.11,'receiverExtensionsM':.11,'sideNewelPitchM':1.44,'sideRailEndpointsRelativeToLowerNewelM':[.11,1.33],'frontPanelRailXEndsM':[-.61,.61],'frontCornerReceiverXInsideEndsM':[-.59,.59],'frontRailTenonEngagementM':.02,'headJoin':'At each side the receiver X arm overlaps the full-flight terminal cap by10 mm in X and28 mm in Y. Both are at the3000 mm upper finished-floor datum.'},layout='full-straight-guarded-opening',stage='producer-candidate-not-independent-acceptance',units='metres',coordinateSystem='Blender Z up; glTF conversion x,z,-y',storeyRiseM=3.,riserCount=18,riserM=forms.R,goingM=forms.G,nominalClearWidthM=1.,minimumNewelCapClearWidthM=.96,headClearanceEnvelopeM=2.1,actualOverheadRaycastMinimumM=min([x['overhead'][0]for x in head if x['overhead']]or[None]),visibleFloorOpeningBlenderXYM=list(void),upperFloorTopM=3.,upperFloorUndersideM=2.76,openingEdgeGuardCoverage={'west':'Three unchanged standard landing guard GLBs with four shared receiver newels','east':'Three unchanged standard landing guard GLBs with four shared receiver newels','front':'One standard landing guard rotated−90 degrees; both ends engage the corner receiver newels','head':'Deliberate stair egress between the raked newels; receiver arms connect the side termination to the raked caps','manualPlacement':'Opening edge guards are separate catalogue modules. The floor context never creates or places them automatically.'},placements=PLACED.copy(),supportInterfaces=supports,contacts=contacts,triangleProbes=PROBES.copy(),headClearanceSamples=head,contextExclusion='Actual floor ring, support columns, ground slab and stair head ledges are delivered proof context only; guard modules and newels are actual unchanged catalogue GLBs.',limits='Project sample measurements, not code/load certification. Under-stair passage is not claimed. No native cut or route semantics.')
    folder=HERE/'assemblies'/'full-straight-guarded-opening';folder.mkdir(exist_ok=True);(folder/'assembly-contract.json').write_text(json.dumps(d,indent=2)+'\n');sanitize('stairs-full-guarded-opening');bpy.context.preferences.filepaths.save_version=0;bpy.ops.wm.save_as_mainfile(filepath=str(folder/'assembled-from-delivered-glbs.blend'),compress=True)
    if '--no-renders'not in sys.argv:
        objects=[x for x in bpy.context.scene.objects if x.type=='MESH']
        for view in ('assembly','top','side'):render(objects,folder/(view+'.png'),view,1024)
    print('FULL_GUARDED_OPENING_READY',all(x['pass']for x in contacts),all(x.get('pass',True)for x in PROBES),all(x['pass']for x in head),flush=True)

if __name__=='__main__':build()
