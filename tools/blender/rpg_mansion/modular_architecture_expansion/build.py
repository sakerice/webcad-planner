"""Isolated original expansion pipeline; never writes first-eight or app files."""
import sys,json,hashlib,math
from pathlib import Path
H=Path(__file__).resolve().parent;sys.path[:0]=[str(H),str(H.parent),str(H.parent.parent)]
import expansion_common as g
import walls_floors as wf
import roofs

def conn(label,point,normal):return dict(label=label,point=point,normal=normal)
def wallcons(w=1.2):return [conn('left',[-w/2,0,0],[-1,0,0]),conn('right',[w/2,0,0],[1,0,0]),conn('wall-top',[0,0,3],[0,0,1])]
def tilecons(top):return [conn('west',[-.6,0,0],[-1,0,0]),conn('east',[.6,0,0],[1,0,0]),conn('front',[0,-.6,0],[0,-1,0]),conn('rear',[0,.6,0],[0,1,0]),conn('bottom',[0,0,0],[0,0,-1]),conn('top',[0,0,top],[0,0,1])]
PLAN=[
 dict(key='plain-plaster-bay',name='1200mm plain plaster wall bay',builder=lambda:wf.plain(g),role='Full-height unpanelled plaster wall with exterior stone bands and interior timber skirting',nominalWidthMm=1200,wallHeightMm=3000,wallThicknessMm=240,connections=wallcons()),
 dict(key='plain-plaster-filler-600',name='600mm plain plaster closure width variant',builder=lambda:wf.plain(g,.6),role='Proportion-only 600mm closure variant used beside the1800mm arch in the2400mm between-corner front run',variantOf='rpg-mansion-plain-plaster-bay-01',distinctConstructionFamily=False,nominalWidthMm=600,wallHeightMm=3000,wallThicknessMm=240,connections=wallcons(.6)),
 dict(key='exterior-return-corner',name='600mm-grid exterior plaster return corner',builder=lambda:wf.exterior_corner(g),role='Continuous outer stone-band corner with inward timber skirting; joins two straight exterior-wall finishes',wallHeightMm=3000,wallThicknessMm=240,connections=[conn('west',[-.6,0,0],[-1,0,0]),conn('south',[0,-.6,0],[0,-1,0]),conn('wall-top',[0,0,3],[0,0,1])]),
 dict(key='arched-doorway-bay',name='1800mm open stone arched doorway bay',builder=lambda:wf.arch(g),role='Genuine arched through-opening with separate stone voussoirs, jambs and projecting keystone',nominalWidthMm=1800,wallHeightMm=3000,wallThicknessMm=240,clearOpeningMm=[1200,2400],clearSpringlineMm=1800,archRadiusMm=600,archSegments=24,clearShape='Vertical jambs to1800mm; piecewise-linear semicircular chord arch rises to2400mm crown. Width1200mm is at springline, not a1200x2400 rectangular opening.',connections=wallcons(1.8)),
 dict(key='raised-sill-fixed-window-bay',name='1200mm raised-sill fixed-glazing wall bay',builder=lambda:wf.window(g),role='Real wall aperture occupied by fixed four-pane glazing, timber mullion/transom and projecting stone sill',nominalWidthMm=1200,wallHeightMm=3000,wallThicknessMm=240,wallApertureMm=dict(width=920,bottom=800,top=2600),frameClearOpeningMm=dict(width=760,bottom=880,top=2520),fixedGlazing=True,nativeWallCutting=False,glassThicknessMm=8,connections=wallcons()),
 dict(key='herringbone-parquet-tile',name='1200mm herringbone parquet floor tile',builder=lambda:wf.parquet(g),role='True clipped herringbone boards on a continuous support substrate; repeating solid floor with0.8mm half-joints',nominalFootprintMm=[1200,1200],substrateThicknessMm=60,wearLayerMm=15,installationElevationMm=-75,finishedFloorDatumMm=0,connections=tilecons(.075)),
 dict(key='coffered-ceiling-panel',name='1200mm recessed coffered ceiling panel',builder=lambda:wf.ceiling(g),role='Continuous perimeter timber beam ring, sloped recess moulding and physically recessed plaster field',nominalFootprintMm=[1200,1200],installationElevationMm=2860,structuralTopMm=3000,finishedLowestCeilingMm=2860,recessFieldUndersideMm=2960,connections=tilecons(.14)),
 dict(key='mansard-roof-span',name='3600mm-bearing hollow slate mansard span',builder=lambda:roofs.span(g),role='1200mm-repeat hollow two-pitch mansard deck, staggered lapped slates, knee flashings and continuous level wall bearings',nominalRunMm=1200,bearingCentreSpanMm=3600,wallExteriorSpanMm=3840,eaveBeyondWallMm=180,bearingSeatHeightMm=100,bearingSeatWidthMm=240,lowerPitchSlope=1.5,upperPitchSlope=5/12,kneeConstructionM=[1.2,0,1.35],roofInstallationElevationMm=2900,deckThicknessVerticalMm=55,slateThicknessVerticalMm=15,slateLapMm=10,slateCourseStaggerMm=150,connections=[conn('front-repeat',[0,-.6,0],[0,-1,0]),conn('rear-repeat',[0,.6,0],[0,1,0]),conn('west-bearing',[-1.8,0,.1],[0,0,-1]),conn('east-bearing',[1.8,0,.1],[0,0,-1])]),
 dict(key='mansard-hipped-end',name='Three-sided hollow mansard hipped end',builder=lambda:roofs.end(g),role='Actual three-plane hipped roof closure with matching full span section and U-shaped bearing seats; no solid attic wedge',bearingCentreSpanMm=3600,wallExteriorSpanMm=3840,eaveBeyondWallMm=180,joinToEndBearingMm=1800,joinToEndEaveMm=2100,bearingSeatHeightMm=100,bearingSeatWidthMm=240,lowerPitchSlope=1.5,upperPitchSlope=5/12,roofInstallationElevationMm=2900,deckThicknessVerticalMm=55,slateThicknessVerticalMm=15,slateLapMm=10,slateCourseStaggerMm=150,connections=[conn('span-join',[0,0,0],[0,1,0]),conn('west-bearing',[-1.8,-.84,.1],[0,0,-1]),conn('east-bearing',[1.8,-.84,.1],[0,0,-1]),conn('end-bearing',[0,-1.8,.1],[0,0,-1])]),
]

def clarify(item):
 c=item['moduleContract'];exact=[item[k] for k in ['w','d','h']];nominal=[round(x) for x in exact];assert max(abs(a-b) for a,b in zip(exact,nominal))<.1,(item['id'],exact)
 item['measuredEnvelopeMm']=dict(zip(['w','d','h'],exact));item['nominalEnvelopeMm']=dict(zip(['w','d','h'],nominal));item['dimensionToleranceMm']=.1
 for k,v in zip(['w','d','h'],nominal):item[k]=v
 e=c.get('installationElevationMm',c.get('roofInstallationElevationMm',0));item['defaultElevation']=e;c['defaultAssetBottomElevationMm']=e;c['wallTopDatumMm']=3000
 to=lambda p:[float(p[0]),float(p[2]),float(-p[1])]
 c['constructionToAssetTranslationGltfM']=to(c['constructionToAssetTranslationM']);c['exportConnectionFrame']='glTF XYZ / +Y up / +Z front; asset points use exported bottom-centre origin';c['axisConversion']='glTF(x,y,z)=(Blender.x,Blender.z,-Blender.y)';c['allowedAssemblyTransforms']='Rigid translation and native Blender Z-axis / glTF Y-axis rotations in90-degree steps; no mirror or scale'
 for row in c['connections']:row['constructionPointGltfM']=to(row['point']);row['assetPointGltfM']=to(row['assetPointM']);row['normalGltf']=to(row['normal'])
 if 'roofInstallationElevationMm' in c:c['placementExample']=dict(assetBottomMm=2900,bearingSeatMm=3000,on240mmCorniceAssetBottomMm=3140,on240mmCorniceBearingMm=3240,stackAdjustmentMm=240)
 elif e==-75:c['placementExample']=dict(assetBottomMm=-75,finishedFloorMm=0,explanation='Floor substrate extends75mm below wall ground datum.')
 elif e==2860:c['placementExample']=dict(assetBottomMm=2860,assetTopMm=3000,explanation='Perimeter beam bottom2860mm, recessed plaster underside2960mm, top flush with3000mm wall-top datum.')
 else:c['placementExample']=dict(assetBottomMm=0,wallTopMm=3000)
 if c.get('fixedGlazing'):c['glazingMaterial']=dict(appearance='Lightly tinted fixed glazing with tested visible transmission',alpha=.10,roughness=.08,glassThicknessMm=8)
 item['independentConstructionCount']=0 if c.get('variantOf') else 1
 if c.get('variantOf'):item['variantOf']=c['variantOf']
 item['builder']=str((H/'build.py').relative_to(g.ROOT))
 return item

g.PLAN=PLAN;g.clarify=clarify
exec(compile((H/'expansion_pipeline.py').read_text(),str(H/'expansion_pipeline.py'),'exec'),g.__dict__)
if __name__=='__main__':g.main()
