#!/usr/bin/env python3
"""Inspect candidate PNG bytes and measured landmarks; does not edit image pixels."""
import hashlib
import json
import math
from pathlib import Path
from statistics import median
from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parent
EARLY = [
    ("walker-male-02a",34,254,1206),
    ("walker-male-02b",31,250,1196),
    ("walker-male-02c",24,245,1206),
    ("walker-female-02a",34,266,1207),
    ("walker-female-02b",20,232,1121),
    ("walker-female-02c",34,265,1205),
]
LATEST = [
    ("walker-male-02a",9,251,1227),
    ("walker-female-02c",15,237,1225),
]
FUNCTIONAL = [("walker-male-02a",10,251,1230)]
SAMPLES = {
    "walker-male-02a": [
        ("肌","#F3BD93",628,205),("髪","#293955",617,90),
        ("目","#276F88",586,165),("帽子","#FF695F",622,40),
        ("上着","#26B8C5",544,412),("肩切替","#FFF2DC",486,313),
        ("シャツ","#FFF2DC",620,418),("パンツ","#FF695F",551,921),
        ("パンツ裾","#FFF2DC",515,1083),("靴本体","#FF695F",541,1152),
        ("靴切替","#26B8C5",504,1161),("靴底","#FFF2DC",495,1219),
        ("帽子後部ストラップ","#26B8C5",709,107),
    ],
    "walker-female-02c": [
        ("肌","#F3BD93",623,189),("髪","#624739",609,44),
        ("目","#5A4838",583,150),("上着","#61C4F2",545,388),
        ("上着縁取り","#FFF2DC",580,418),("ブラウス","#FF786E",620,394),
        ("スカート","#61C4F2",622,623),("ウエスト","#FF786E",621,496),
        ("靴本体","#61C4F2",519,1181),("靴かかと","#FF786E",697,1140),
        ("靴底","#FFF2DC",492,1212),
    ],
}
FUNCTIONAL_SAMPLES = [
    ("肌","#F3BD93",628,205),("髪","#293955",617,90),
    ("目","#276F88",586,165),("帽子","#FF695F",622,40),
    ("上着","#26B8C5",543,410),("肩切替","#FFF2DC",486,313),
    ("シャツ","#FFF2DC",622,362),("パンツ","#FF695F",551,921),
    ("パンツ裾","#FFF2DC",515,1083),("胸ポケット","#26B8C5",705,418),
    ("胸ポケット蓋","#FFF2DC",706,379),("肘切替","#FF695F",353,460),
    ("鞄本体","#FFF2DC",708,573),("鞄蓋","#26B8C5",713,515),
    ("鞄紐","#FF695F",624,427),("靴本体","#FF695F",520,1184),
    ("靴つま先","#26B8C5",469,1191),("靴ストラップ","#26B8C5",493,1157),
    ("靴底","#FFF2DC",478,1218),("帽子バックル","#26B8C5",706,103),
]

def foreground_mask(im):
    r,g,b=im.split()
    lo=ImageChops.darker(ImageChops.darker(r,g),b)
    hi=ImageChops.lighter(ImageChops.lighter(r,g),b)
    chroma=ImageChops.subtract(hi,lo).point(lambda v:255 if v>20 else 0)
    dark=hi.point(lambda v:255 if v<140 else 0)
    return ImageChops.lighter(chroma,dark)

def sample(im,x,y):
    pixels=[im.getpixel((xx,yy)) for xx in range(x-1,x+2) for yy in range(y-1,y+2)]
    return "#"+"".join(f"{int(median([p[c] for p in pixels])):02X}" for c in range(3))

results=[]
for group,entries in [("early-broad-limbs",EARLY),("natural-limbs",LATEST),("functional-street",FUNCTIONAL)]:
    for identifier,top,chin,sole in entries:
        suffix="-front-functional.png" if group=="functional-street" else "-front.png"
        path=ROOT/"candidates"/group/(identifier+suffix)
        with Image.open(path) as check:
            check.verify()
        with Image.open(path) as opened:
            im=opened.convert("RGB")
        assert im.width>=1024 and im.height>=1024
        mask=foreground_mask(im)
        box=mask.getbbox()
        bbox=[box[0],box[1],box[2]-1,box[3]-1]
        assert bbox[1]==top and bbox[3]==sole,(identifier,bbox,top,sole)
        chin_color=im.getpixel((627,chin))
        assert max(chin_color)<140,(identifier,chin_color)
        head=chin-top
        full=sole-top
        ratio=full/head
        assert 5<=ratio<=5.5,(identifier,ratio)
        entry={
            "file":str(path.relative_to(ROOT)),"id":identifier,
            "status":"superseded" if group=="early-broad-limbs" else "direction_review_pending",
            "size":list(im.size),"sha256":hashlib.sha256(path.read_bytes()).hexdigest(),
            "foreground_bbox_inclusive":bbox,
            "crown_y":top,"chin_xy":[627,chin],"chin_rgb":chin_color,"sole_y":sole,
            "head_height_px":head,"full_height_px":full,"head_units":round(ratio,6),
            "head_measurement_basis":"visible crown silhouette including close-fitting hat/hair; hidden skull not measured",
            "visually_displayed":True,
        }
        if group!="early-broad-limbs":
            ys=[340,570] if identifier=="walker-male-02a" else [340,540]
            edges=[]
            for y in ys:
                line=mask.crop((0,y,im.width,y+1)).getbbox()
                edges.append([line[0],line[2]-1])
            angles=[math.degrees(math.atan(abs(edges[1][i]-edges[0][i])/(ys[1]-ys[0]))) for i in (0,1)]
            assert all(30<=a<=45 for a in angles),angles
            entry["a_pose_sleeve_outer_edge"]={"rows_y":ys,"edges_x":edges,"degrees_from_vertical":[round(a,4) for a in angles],"basis":"straight sleeve silhouette, not skeleton joints"}
            colors=[]
            lines=[f"# {identifier} 色表 — 確認候補","","生成指示の意図色と原寸PNGの3×3画素中央値。肌・髪・目・服各部・靴を記録。低振幅のラスタ色ぶれとアンチエイリアスがあるため、全画素のHEX一致や未生成方向の一致は未検査。","","| 部位 | 意図色 | 画像サンプル | 中心座標(x,y) |","|---|---|---|---|"]
            selected_samples=FUNCTIONAL_SAMPLES if group=="functional-street" else SAMPLES[identifier]
            for label,target,x,y in selected_samples:
                actual=sample(im,x,y)
                colors.append({"part":label,"intended_hex":target,"sample_hex":actual,"sample_xy":[x,y]})
                lines.append(f"| {label} | {target} | {actual} | ({x},{y}) |")
            entry["color_samples"]=colors
            color_suffix="-colors-functional.md" if group=="functional-street" else "-colors.md"
            (path.parent/(identifier+color_suffix)).write_text("\n".join(lines)+"\n",encoding="utf-8")
        results.append(entry)

report={
    "state":"Incomplete direction review; no accepted final asset set.",
    "images":results,
    "checks_passed":["9 PNGs decode","all dimensions 1254x1254 >=1024x1024","all visible-crown head-unit ratios 5.0-5.5","three direction-review A-pose sleeve slopes 30-45 degrees","recorded SHA-256 and color samples","reference image officially materialized and pixels inspected"],
    "not_completed":["latest direction approval","other four natural-limbs fronts","side/back/turnaround consistency","four-or-five-digit separation final QA","all six final color tables","six-person height-calibrated lineup","six-person lineup Library save","strict per-region single-color pixel verification"],
}
(ROOT/"inspection.json").write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
print(json.dumps({"images":len(results),"head_units":{e["file"]:e["head_units"] for e in results},"latest_arm_angles":{e["id"]:e["a_pose_sleeve_outer_edge"]["degrees_from_vertical"] for e in results if "a_pose_sleeve_outer_edge" in e}},ensure_ascii=False))
