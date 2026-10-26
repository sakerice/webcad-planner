"""Record actual3x3 median patches in current native front figures."""
from pathlib import Path
from PIL import Image
import json
P=Path(__file__).resolve().parent
IDS=[f'walker-{s}-02{v}' for s in ['male','female'] for v in ['a','b','c']]
PARTS=[
 [('黄色スウェット',(615,420)),('白T裾',(620,615)),('深緑パンツ',(560,850)),('靴下',(530,1140)),('キャラメル室内履き',(500,1180))],
 [('ミント半袖ハーフジップ',(620,430)),('白T裾',(620,620)),('トープパンツ',(550,850)),('靴下',(530,1140)),('ネイビー室内履き',(500,1180))],
 [('コーラルカーディガン',(520,420)),('アイボリーT',(620,420)),('白T裾',(620,640)),('スレートブルーパンツ',(550,850)),('靴下',(530,1140)),('灰トープ室内履き',(500,1180))],
 [('深緑スウェット',(620,410)),('白T裾',(620,535)),('クリーム長スカート',(620,800)),('靴下',(530,1116)),('ラベンダー室内履き',(500,1180))],
 [('ライトブルーボートネック',(620,400)),('チャコールパンツ',(540,850)),('靴下',(530,1140)),('トープ室内履き',(500,1185))],
 [('オートミールポロ',(620,420)),('白T裾',(620,573)),('ダスティローズパンツ',(550,850)),('靴下',(530,1140)),('アイボリー室内履き',(500,1180))]
]
def median(im,pt):
    x,y=pt;pix=[im.getpixel((x+dx,y+dy)) for dy in [-1,0,1] for dx in [-1,0,1]]
    return [sorted(p[c] for p in pix)[4] for c in range(3)]
def pick(im,box,predicate,target):
    pts=[]
    for y in range(box[1],box[3]):
        for x in range(box[0],box[2]):
            c=median(im,(x,y))
            if predicate(c):pts.append((x,y))
    assert pts,box
    return min(pts,key=lambda p:(p[0]-target[0])**2+(p[1]-target[1])**2)
def main():
    records=[]
    for i,id in enumerate(IDS):
        im=Image.open(P/f'{id}-front.png').convert('RGB')
        iris=pick(im,(563,120,605,185),lambda c:c[1]>c[0]+20 and c[2]>35 and 35<c[0]<155 and c[1]>75,(585,155))
        parts=[('肌',(640,190)),('髪',(600,55)),('虹彩',iris)]+PARTS[i]
        if i==0:parts.append(('時計帯',pick(im,(860,570,990,690),lambda c:c[0]<100 and c[1]>70 and c[2]>70,(920,625))))
        if i==1:parts.append(('腕輪',pick(im,(180,520,295,625),lambda c:c[0]>150 and 70<c[1]<200 and c[2]<110 and c[0]>c[1]+30,(240,575))))
        if i==3:parts.append(('白髪留め',pick(im,(670,90,715,145),lambda c:c[0]>210 and c[1]>200 and 150<c[2]<220,(686,109))))
        if i==4:parts.append(('金円盤',pick(im,(605,280,639,340),lambda c:c[0]>200 and 120<c[1]<205 and c[2]<100,(620,317))))
        samples=[]
        for part,pt in parts:
            rgb=median(im,pt)
            if part=='靴下':assert min(rgb)>200 and max(rgb)-min(rgb)<35,(id,pt,rgb)
            samples.append({'part':part,'point':list(pt),'rgb':rgb,'hex':'#'+''.join(f'{v:02X}' for v in rgb)})
        records.append({'id':id,'method':'actual3x3 median from selected native front; semantic palette retained, sampled HEX/raster shades can vary across projections','samples':samples})
        text=f'# {id} — 色値（#167改稿）\n\n現在の原生1254角正面から3×3中央値を採取。部位と配色を保持し、RGBの完全同一/全画素2色は主張しない。\n\n| 部位 | HEX | RGB | 採取点(x,y) |\n|---|---|---|---|\n'
        for s in samples:text+=f"| {s['part']} | {s['hex']} | {tuple(s['rgb'])} | {tuple(s['point'])} |\n"
        (P/f'{id}-colors.md').write_text(text)
        print(id,[(s['part'],s['hex'],s['point']) for s in samples])
    (P/'colour-inspection.json').write_text(json.dumps(records,ensure_ascii=False,indent=2)+'\n')
if __name__=='__main__':main()
