#!/usr/bin/env python3
"""Inspect modern-student front assets; never edits PNG pixels.
Joint centers/hip/knee guides are manual 2D estimates under clothing, not 3D bones.
"""
import hashlib,json,math
from pathlib import Path
from statistics import median
from PIL import Image,ImageChops
ROOT=Path(__file__).resolve().parent
DATA=[
 {"id":"walker-male-02a","top":15,"chin":196,"sole":1210,"height_cm":172,
  "shoulders":[[498,270],[746,270]],"elbows":[[405,430],[839,430]],
  "wrists":[[311,586],[933,586]],"fingertips":[[269,704],[975,705]],
  "hip_zone_y":[610,670],"crotch_y":657,"crotch_basis":"visible center leg-gap boundary","knee_y":890},
 {"id":"walker-female-02c","top":20,"chin":197,"sole":1211,"height_cm":160,
  "shoulders":[[516,265],[730,265]],"elbows":[[428,414],[818,414]],
  "wrists":[[341,561],[905,561]],"fingertips":[[299,675],[944,675]],
  "hip_zone_y":[575,655],"crotch_y":645,"crotch_basis":"estimated pelvis under skirt; not directly visible","knee_y":850},
]
SAMPLES={
 "walker-male-02a":[
  ("肌","#F8D2B1",649,165),("髪","#443E39",620,57),("目（虹彩・瞳の単純形）","#493F39",595,132),
  ("目の白部","#FFFFFF",583,125),("シャツ本体","#A8D0F5",540,391),("襟","#A8D0F5",577,231),
  ("胸ポケット","#A8D0F5",695,350),("Tシャツ","#FFFFFF",620,415),
  ("普通のパンツ","#454545",548,895),("靴本体","#FFFFFF",467,1180),("靴底","#DEDEDE",468,1205)],
 "walker-female-02c":[
  ("肌","#F8D2B1",649,165),("髪","#645247",620,57),("目（虹彩・瞳の単純形）","#493F39",598,132),
  ("目の白部","#FFFFFF",587,126),("カーディガン本体","#F3A58F",548,386),
  ("カーディガン袖口","#F3A58F",350,543),("白トップス","#FFFFFF",620,345),
  ("スカート本体","#456582",557,597),("普通のウエスト部","#456582",650,478),
  ("ローファー本体","#FFF6E4",519,1176),("靴底","#D6D6D6",511,1206)],
}
def mask_for(im):
 r,g,b=im.split();lo=ImageChops.darker(ImageChops.darker(r,g),b);hi=ImageChops.lighter(ImageChops.lighter(r,g),b)
 return ImageChops.lighter(ImageChops.subtract(hi,lo).point(lambda v:255 if v>20 else 0),hi.point(lambda v:255 if v<140 else 0))
def color_sample(im,x,y):
 px=[im.getpixel((xx,yy)) for xx in range(x-1,x+2) for yy in range(y-1,y+2)]
 return "#"+"".join(f"{int(median([p[c] for p in px])):02X}" for c in range(3))
def distance(a,b):return math.hypot(b[0]-a[0],b[1]-a[1])
images=[]
for d in DATA:
 path=ROOT/"candidates"/"modern-student"/(d["id"]+"-front-modern.png")
 with Image.open(path) as source:source.verify()
 with Image.open(path) as source:im=source.convert("RGB")
 assert im.width>=1024 and im.height>=1024
 mask=mask_for(im);b=mask.getbbox();bbox=[b[0],b[1],b[2]-1,b[3]-1]
 assert (bbox[1],bbox[3])==(d["top"],d["sole"])
 assert max(im.getpixel((623,d["chin"])))<140
 full=d["sole"]-d["top"];head=d["chin"]-d["top"]
 edges=[]
 for y in [400,520]:
  b=mask.crop((0,y,im.width,y+1)).getbbox();edges.append([b[0],b[2]-1])
 angles=[math.degrees(math.atan(abs(edges[1][i]-edges[0][i])/120)) for i in [0,1]]
 assert all(30<=a<=45 for a in angles)
 arms=[]
 for i in [0,1]:
  s,e,w,t=[d[k][i] for k in ["shoulders","elbows","wrists","fingertips"]]
  upper=distance(s,e);fore=distance(e,w);hand=distance(w,t)
  lowered_wrist=s[1]+upper+fore;lowered_tip=lowered_wrist+hand
  assert d["hip_zone_y"][0]<=lowered_wrist<=d["hip_zone_y"][1]
  assert d["crotch_y"]<=lowered_tip<=d["crotch_y"]+0.6*(d["knee_y"]-d["crotch_y"])
  arms.append({"side":"image-left" if i==0 else "image-right",
    "shoulder_xy":s,"elbow_xy":e,"wrist_xy":w,"longest_fingertip_xy":t,
    "upper_arm_px":round(upper,3),"forearm_px":round(fore,3),"hand_px":round(hand,3),
    "arm_shoulder_to_wrist_over_full_height":round((upper+fore)/full,6),
    "hand_over_full_height":round(hand/full,6),
    "hand_nominal_cm_from_design_height":round(hand/full*d["height_cm"],2),
    "lowered_wrist_estimated_y":round(lowered_wrist,3),
    "lowered_fingertip_estimated_y":round(lowered_tip,3),
    "thigh_fraction_from_crotch":round((lowered_tip-d["crotch_y"])/(d["knee_y"]-d["crotch_y"]),6)})
 colors=[];lines=[f'# {d["id"]} 現代大学生案 色表',"","意図色と原寸3×3画素中央値を区別する。全画素HEX一致・横背面との一致は未検査。",
  "","| 部位 | 意図HEX | PNG中央値 | 中心(x,y) |","|---|---|---|---|"]
 for label,target,x,y in SAMPLES[d["id"]]:
  actual=color_sample(im,x,y);colors.append({"part":label,"intended_hex":target,"sample_hex":actual,"sample_xy":[x,y]})
  lines.append(f"| {label} | {target} | {actual} | ({x},{y}) |")
 (path.parent/(d["id"]+"-colors-modern.md")).write_text("\n".join(lines)+"\n")
 images.append({"id":d["id"],"file":str(path.relative_to(ROOT)),"status":"parent_direction_review_pending",
  "sha256":hashlib.sha256(path.read_bytes()).hexdigest(),"size":list(im.size),
  "crown_y":d["top"],"chin_xy":[623,d["chin"]],"sole_y":d["sole"],"foreground_bbox_inclusive":bbox,
  "head_height_px":head,"full_height_px":full,"visible_hair_crown_head_units":round(full/head,6),
  "head_units_are_recorded_not_fixed_acceptance_gate":True,"design_height_cm":d["height_cm"],
  "a_pose_sleeve_outer_edge":{"rows_y":[400,520],"edges_x":edges,"degrees_from_vertical":[round(a,4) for a in angles]},
  "anatomical_guides":{"hip_zone_y":d["hip_zone_y"],"crotch_y":d["crotch_y"],"crotch_basis":d["crotch_basis"],"knee_y_estimated":d["knee_y"]},
  "arms":arms,"colors":colors,"visually_displayed":True})
report={"active_specification":"Latest human review 2026-10-14 04:02 JST; former5–5.5-head criterion WITHDRAWN.",
 "measurement_basis":"Visible hair crown-to-chin/full-height pixel distances. Skull under hair is not directly measured.",
 "arm_method":"Manual 2D approximate joint centers (about±10px uncertainty) under clothing. Preserve segment lengths and arrange them downward: shoulder_y+upper_arm+forearm, plus hand length for fingertip. These are estimated lowered positions, not a generated lowered-pose image, anatomical guarantee, 3D/rig verification or motion test.",
 "images":images,
 "checks_passed":["2 PNGs decode >=1024x1024","visible-crown proportions recorded without5-head gate","A-pose sleeve slope30–45degrees","estimated lowered wrists in pelvic guide zones","estimated lowered fingertips on upper-to-middle thighs and above knee guides","SHA-256 and color samples"],
 "unperformed":["parent latest-front quality approval","all6 final fronts","side/back/turnaround consistency","direct lowered-pose image","3D/rig/motion (prohibited)","final digit-separation QA","strict flat-region HEX equality","lineup and lineup Library save"],
 "library":{"route":"official current prepared-upload helper","status":"failed: Library prepare_uploads is not available","saved_ids":[],"direct_fallback_taken":False}}
(ROOT/"adult-fronts-inspection.json").write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n")
print(json.dumps({"images":[{"id":im["id"],"head_units":im["visible_hair_crown_head_units"],"arm_angles":im["a_pose_sleeve_outer_edge"]["degrees_from_vertical"],"lowered_wrists":[a["lowered_wrist_estimated_y"] for a in im["arms"]],"lowered_fingertips":[a["lowered_fingertip_estimated_y"] for a in im["arms"]]} for im in images]},ensure_ascii=False))
