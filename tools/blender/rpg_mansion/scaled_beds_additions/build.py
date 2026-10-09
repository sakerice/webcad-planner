"""Two independent original bed constructions beyond the immutable core18.
Static campaign-cot trestles and a stylized RPG barrel-vault bed enclosure. No ordinary standard-bed equivalence is claimed.
"""
from pathlib import Path
import sys,math,importlib.util,json,struct
HERE=Path(__file__).resolve().parent;CORE=HERE.parent/'scaled_beds';ROOT=HERE.parents[3]
spec=importlib.util.spec_from_file_location('bed_core_builder',CORE/'build.py');B=importlib.util.module_from_spec(spec);sys.modules[spec.name]=B;spec.loader.exec_module(B)
B.HERE=HERE;B.WORK=HERE/'sources';B.EVIDENCE=HERE/'evidence';B.kit.WORK_DIR=B.WORK

def campaign():
 w,d,h=.880,2.180,.680;support=.408
 for y in [-.878,.878]:
  for x in [-.354,.354]:B.box('Campaign cot broad grounded foot pad',(x,y,.018),(.092,.086,.036),'wood',.005,'ground-support')
  for sign in [-1,1]:
   yy=y+sign*.019
   B.rod('Campaign cot crossed diagonal trestle beam',(sign*.354,yy,.030),(-sign*.399,yy,.389),.026,'wood',8)
  B.rod('Campaign cot brass through-pivot axle',(0,y-.065,.2095),(0,y+.065,.2095),.022,'brass',10)
 for x in [-w/2+.028,w/2-.028]:B.box('Campaign cot longitudinal canvas tension rail',(x,0,.389),(.056,d,.064),'trim',.006)
 # Inset tenoned crosspieces overlap the inner rails without shared exposed top/end faces.
 for y in [-d/2+.032,d/2-.032]:B.box('Campaign cot inset tenoned end stretcher',(0,y,.385),(w-.104,.050,.058),'wood',.004)
 B.rod('Campaign cot central longitudinal stabilizing stretcher',(0,-.902,.2095),(0,.902,.2095),.020,'wood',8)
 B.box('Campaign cot taut woven canvas support deck',(0,0,.400),(w-.063,d-.058,.016),'linen',.002,'mattress-support')
 for x in [-.405,.405]:
  for y in [-.910,0,.910]:B.rod('Canvas rail brass tension fastener',(x,y,.376),(x,y,.428),.010,'brass',8)
 top=B.bedding(w,d,support,1)
 return dict(mattressTopM=top,mattressSupportM=support,sleepingCapacity=1,mattressDimensionsM=[w-.132,d-.254,.165],topology='static-crossed-X-trestle-campaign-cot/taut-canvas-load-deck/longitudinal-tension-rails/brass-pivots/central-stabilizer/four-ground-pads',mechanism='Static deployed prop; folding motion is not promised')

def arch_band(name,outer,inner,base,y0,y1,material):
 outline=[(outer*math.cos(math.pi*i/16),base+outer*math.sin(math.pi*i/16))for i in range(17)]+[(inner*math.cos(math.pi*i/16),base+inner*math.sin(math.pi*i/16))for i in range(16,-1,-1)]
 return B.forms.panel_y(name,outline,y0,y1,material)

def barrel_vault():
 w,d,h=1.400,2.240,1.980;spring=1.280;support=.415
 for x in [-.554,.554]:
  for y in [-.934,.934]:B.radial('Vault bed stout turned ground pedestal',[(.048,0),(.058,.025),(.044,.091),(.061,.188)],x,y,'wood',10,'ground-support')
 for y in [-.934,.934]:B.box('Vault bed transverse lower load beam',(0,y,.212),(w-.074,.099,.088),'wood',.005)
 for x in [-w/2+.036,w/2-.036]:B.box('Vault bed long moulded plinth sill',(x,0,.230),(.072,d,.092),'trim',.007)
 # Inset end sills are seated between long sills: no same-facing coplanar corner surfaces.
 for y in [-d/2+.043,d/2-.043]:B.box('Vault bed inset tenoned end plinth sill',(0,y,.226),(w-.136,.066,.080),'trim',.006)
 for x in [-.570,.570]:B.box('Vault bed high internal longitudinal load bearer',(x,0,.318),(.060,d-.176,.174),'wood',.004)
 for n in range(12):B.box('Vault bed transverse actual mattress slat',(0,-.955+n*1.91/11,.405),(1.188,.090,.020),'wood',.002,'mattress-support')
 for x in [-.658,.658]:B.box('Vault bed recessed lower enclosure wall',(x,0,(.252+spring+.020)/2),(.054,d-.066,spring+.020-.252),'wood',.005)
 for y in [-d/2+.0375,0,d/2-.0375]:
  arch_band('Barrel vault laminated semicircular load rib',.700,.636,spring,y-.0375,y+.0375,'trim')
  for x in [-.668,.668]:B.box('Vault rib integral supporting upright',(x,y,(.253+spring+.015)/2),(.052,.061,spring+.015-.253),'trim',.004)
 # The continuous curved roof sits within and contacts all three arch ribs.
 arch_band('Barrel bed continuous curved timber roof',.688,.657,spring,-d/2+.061,d/2-.061,'wood')
 B.forms.panel_y('Vault bed closed arched head panel',B.forms.arch_outline(1.335,.255,1.947,.667,16),d/2-.049,d/2-.008,'wood')
 for y in [-d/2+.025,d/2-.025]:
  for x in [-.661,.661]:B.rod('Vault rib brass secured sill joint',(x,y-.021,.324),(x,y+.021,.324),.012,'brass',8)
 top=B.bedding(1.252,2.246,support,1)
 return dict(mattressTopM=top,mattressSupportM=support,sleepingCapacity=1,mattressDimensionsM=[1.120,1.992,.165],topology='three-load-bearing-laminated-semicircular-ribs/continuous-curved-barrel-roof/closed-arched-head/open-arch-foot-entry/raised-four-pedestal-plinth/internal-slat-berth')

B.SPECS=[('campaign-x-trestle-cot','交差脚と帆布支持の野営寝台',(880,2180,680),campaign,'A static deployed campaign cot with crossed wooden trestles, a taut canvas load deck, brass pivot axles and a longitudinal stabilizer'),('barrel-vault-enclosed-bed','積層アーチ梁と樽形屋根の囲い寝台',(1400,2240,1980),barrel_vault,'A stylized RPG enclosed sleeping berth with three actual laminated semicircular ribs, a continuous curved timber roof, a closed arched head and an open arched foot entrance')]
_original_annotate=B.annotate
def annotate(path):
 _original_annotate(path);raw=path.read_bytes();n=struct.unpack_from('<I',raw,12)[0];doc=json.loads(raw[20:20+n]);doc['asset']['extras']['source']='tools/blender/rpg_mansion/scaled_beds_additions/build.py';payload=json.dumps(doc,separators=(',',':')).encode();payload+=b' '*(-len(payload)%4);rest=raw[20+n:];path.write_bytes(struct.pack('<III',0x46546c67,2,20+len(payload)+len(rest))+struct.pack('<II',len(payload),0x4e4f534a)+payload+rest)
B.annotate=annotate
if __name__=='__main__':B.main()
