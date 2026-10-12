#!/usr/bin/env python3
"""Local technical diagrams and synthetic test inputs. No image/model service."""
import json, math, hashlib, subprocess
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'docs/accuracy/2026-10-01'
FONT='/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'
def font(n): return ImageFont.truetype(FONT,n,index=0)
def room(name,*parts): return {'name':name,'parts':[dict(zip(('x0','y0','x1','y1'),p)) for p in parts]}
def item(t,x,y,w,d=150,rot=0): return dict(type=t,x=x,y=y,w=w,d=d,rot=rot)
def edge(parts): return {'total':sum(parts),'parts':parts}
A={'floor':1,'width':6200,'depth':6900,'dims':{'top':edge([3750,2450]),'bottom':edge([1650,1650,1050,1850]),'left':edge([4200,900,1800]),'right':edge([4200,900,1800])},'rooms':[
room('LDK',(0,0,3750,4200)),room('洋室',(3750,0,6200,4200)),room('廊下',(0,4200,6200,5100)),room('洗面所',(0,5100,1650,6900)),room('浴室',(1650,5100,3300,6900)),room('トイレ',(3300,5100,4350,6900)),room('玄関',(4350,5100,6200,6900))],
'items':[item('door-swing',1800,4200,780,780),item('door-swing',5000,4200,780,780),item('door-swing',825,5100,700,700),item('door-fold',2475,5100,650,420),item('door-swing',3825,5100,650,650),item('door-opening',5275,5100,1000,160),item('door-front',5275,6900,900,200),item('window',0,2000,1650,150,90),item('window',6200,2000,1200,150,90),item('window',2475,6900,600),item('window',1800,0,1800),item('bath',2475,6000,1600,1600),item('sink',825,5450,750,560),item('toilet',3825,6100,380,680),item('kitchen',1800,450,2550,650)]}
B={'floor':1,'width':6500,'depth':6200,'dims':{'top':edge([4050,2450]),'bottom':edge([1700,900,1450,2450]),'left':edge([3300,1200,1700]),'right':edge([2200,1100,2900])},'rooms':[
room('LDK',(0,0,4050,3300),(0,3300,2600,4500)),room('書斎',(4050,0,6500,2200)),room('トイレ',(4050,2200,5300,3300)),room('収納',(5300,2200,6500,3300)),room('廊下',(2600,3300,4050,5100)),room('玄関',(2600,5100,4050,6200)),room('浴室',(0,4500,1700,6200)),room('洗面所',(1700,4500,2600,6200))],
'items':[item('door-swing',4050,1500,780,780,90),item('door-swing',4050,2750,650,650,90),item('door-fold',5900,2200,850,420),item('door-swing',2600,3900,780,780,90),item('door-swing',2600,4800,600,600,90),item('door-fold',1700,5400,650,420,90),item('door-opening',3300,5100,900,160),item('door-front',3350,6200,900,200),item('window',6500,1100,1200,150,90),item('window',850,6200,600),item('window',1800,0,1800),item('bath',850,5350,1600,1600),item('sink',2150,5800,750,560),item('toilet',4700,2750,380,680),item('kitchen',1800,450,2550,650)]}
def walls(f):
    ps=[(i,p) for i,r in enumerate(f['rooms']) for p in r['parts']]
    xs=sorted({p[k] for _,p in ps for k in ['x0','x1']});ys=sorted({p[k] for _,p in ps for k in ['y0','y1']})
    def owner(x,y): return next((i for i,p in ps if p['x0']<x<p['x1'] and p['y0']<y<p['y1']),None)
    result=[]
    for x in xs:
        for y0,y1 in zip(ys,ys[1:]):
            if owner(x-.01,(y0+y1)/2)!=owner(x+.01,(y0+y1)/2): result.append((x,y0,x,y1))
    for y in ys:
        for x0,x1 in zip(xs,xs[1:]):
            if owner((x0+x1)/2,y-.01)!=owner((x0+x1)/2,y+.01): result.append((x0,y,x1,y))
    return result

def source(f,name):
    im=Image.new('RGB',(1400,1500),'white');g=ImageDraw.Draw(im);s=1000/max(f['width'],f['depth']);ox=190;oy=240
    def pt(x,y):return (ox+x*s,oy+y*s)
    def line(coords,fill='#222',width=2):g.line([pt(*p) for p in coords],fill=fill,width=width)
    def text(x,y,t,n=24,fill='#222'):g.text((x,y),t,font=font(n),fill=fill,anchor='mm')
    text(700,55,f'1階 平面図 — 合成サンプル {name}',34)
    text(700,102,'単位：mm ／ 壁芯寸法 ／ 実在の住宅・個人情報を含まない検査用図面',21)
    # Fixtures use conventional outlines; their catalog dimensions are not dimension annotations.
    for it in f['items']:
        if it['type'] not in ['bath','sink','toilet','kitchen']:continue
        x,y,w,d=it['x'],it['y'],it['w'],it['d'];p0=pt(x-w/2,y-d/2);p1=pt(x+w/2,y+d/2)
        g.rectangle([p0,p1],fill='#f3f3f3',outline='#777',width=2)
        if it['type']=='bath':g.rounded_rectangle([pt(x-w*.4,y-d*.4),pt(x+w*.4,y+d*.4)],radius=22,outline='#888',width=2)
        if it['type']=='toilet':g.ellipse([pt(x-w*.4,y-d*.1),pt(x+w*.4,y+d*.4)],outline='#777',width=2)
        if it['type'] in ['kitchen','sink']:g.ellipse([pt(x-w*.2,y-d*.3),pt(x+w*.2,y+d*.3)],outline='#777',width=2)
    for x0,y0,x1,y1 in walls(f):line([(x0,y0),(x1,y1)],width=7)
    for it in f['items']:
        t=it['type']
        if t in ['bath','sink','toilet','kitchen']:continue
        x,y,w=it['x'],it['y'],it['w'];v=it['rot']==90
        def p(a,b):return (x+b,y+a) if v else (x+a,y+b)
        line([p(-w/2,0),p(w/2,0)],fill='white',width=10)
        if t=='window':
            for off in [-22,0,22]:line([p(-w/2,off),p(w/2,off)],width=2)
            label=f'窓 {w}'
        elif t in ['door-fold','door-opening']:
            if t=='door-fold':line([p(-w/2,0),p(-w/4,-w/4),p(0,0),p(w/4,-w/4),p(w/2,0)],width=2)
            label=('折戸 ' if t=='door-fold' else '開口 ')+str(w)
        else:
            line([p(-w/2,0),p(-w/2,-w)],width=2)
            curve=[p(-w/2+w*math.cos(a),-w*math.sin(a)) for a in [i*math.pi/60 for i in range(31)]]
            line(curve,fill='#777',width=1);label=('玄関戸 ' if t=='door-front' else '扉 ')+str(w)
        px,py=pt(*p(0,(-260 if t!='window' else 270) if v else 130));text(px,py,label,17)
    for r in f['rooms']:
        p=max(r['parts'],key=lambda q:(q['x1']-q['x0'])*(q['y1']-q['y0']))
        x=(p['x0']+p['x1'])/2;y=(p['y0']+p['y1'])/2
        px,py=pt(x,y)
        box=g.textbbox((px,py),r['name'],font=font(28),anchor='mm')
        g.rectangle((box[0]-3,box[1]-3,box[2]+3,box[3]+3),fill='white')
        text(px,py,r['name'],28)
    def dim(axis,positions,offset):
        for a,b in zip(positions,positions[1:]):
            if axis=='x':
                x1,y=pt(a,0);x2,_=pt(b,0);y=offset;g.line([(x1,y),(x2,y)],fill='#666',width=1)
                for x in [x1,x2]:g.line([(x,y-7),(x,y+7)],fill='#666',width=1)
                text((x1+x2)/2,y-19,str(b-a),22)
            else:
                _,y1=pt(0,a);_,y2=pt(0,b);x=offset;g.line([(x,y1),(x,y2)],fill='#666',width=1)
                for y in [y1,y2]:g.line([(x-7,y),(x+7,y)],fill='#666',width=1)
                text(x-38,(y1+y2)/2,str(b-a),21)
    def cumulative(parts):
        p=[0]
        for v in parts:p.append(p[-1]+v)
        return p
    dim('x',[0,f['width']],155);dim('x',cumulative(f['dims']['top']['parts']),207)
    dim('x',cumulative(f['dims']['bottom']['parts']),oy+f['depth']*s+90)
    dim('y',[0,f['depth']],70);dim('y',cumulative(f['dims']['left']['parts']),150)
    dim('y',cumulative(f['dims']['right']['parts']),ox+f['width']*s+150)
    text(700,1390,'壁＝太線　窓＝平行線　開き戸＝円弧　折戸＝折線　開口＝壁の切れ目',21)
    text(700,1430,'画像読取り評価用の入力。自動認識の出力や実測結果ではありません。',21)
    target=OUT/'native-sources'/f'source-{name.lower()}.png';target.parent.mkdir(parents=True,exist_ok=True);im.save(target,optimize=True)
    ref=ROOT/'tools/tests/fixtures/native-reading'/f'source-{name.lower()}.expected.json'
    ref.parent.mkdir(parents=True,exist_ok=True);ref.write_text(json.dumps({'floors':[f],'notes':[]},ensure_ascii=False,indent=2)+'\n')
    return {'file':target.name,'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'width':1400,'height':1500}

def comparison():
    fixture=json.loads((ROOT/'tools/tests/fixtures/extraction/synthetic.json').read_text())[0]
    old=subprocess.check_output(['git','show','d41e98db4f08a74e617752aa4168e05284896b43:assets/js/plan-grid.js'],cwd=ROOT,text=True)
    code="const vm=require('node:vm'),fs=require('node:fs');const q=JSON.parse(fs.readFileSync(0,'utf8'));const c={module:{exports:{}}};vm.runInNewContext(q.code,c);console.log(JSON.stringify(c.module.exports.build(q.fixture)));"
    before=json.loads(subprocess.check_output(['node','-e',code],input=json.dumps({'code':old,'fixture':fixture}),text=True,cwd=ROOT))
    after=json.loads(subprocess.check_output(['node','-e',"console.log(JSON.stringify(require('./assets/js/plan-grid.js').build(JSON.parse(process.argv[1]))))",json.dumps(fixture)],text=True,cwd=ROOT))
    im=Image.new('RGB',(1660,800),'white');g=ImageDraw.Draw(im)
    g.text((45,25),'Preserve measured dimensions after extraction',font=font(34),fill='#182838')
    g.text((45,80),'Synthetic coordinates only. No model or image-recognition evaluation.',font=font(22),fill='#526475')
    for i,(label,built) in enumerate([('SOURCE / specified geometry',None),('BEFORE / fixed 227.5 mm grid',before),('AFTER / exact boundaries',after)]):
        x=55+i*550;y=175;s=.22
        g.text((x,y-38),label,font=font(22),fill='#182838')
        rooms=built['rooms'] if built else [{'x':0,'y':0,'w':1000,'d':2000},{'x':1000,'y':0,'w':1000,'d':2000}]
        for j,r in enumerate(rooms):
            g.rectangle([x+r['x']*s,y+r['y']*s,x+(r['x']+r['w'])*s,y+(r['y']+r['d'])*s],fill=['#e3edf7','#e2f0e7'][j%2],outline='#223748',width=3)
            g.text((x+(r['x']+r['w']/2)*s,y+190),('A' if j==0 else 'B'),font=font(32),fill='#223748',anchor='mm')
            g.text((x+(r['x']+r['w']/2)*s,y+235),f"{r['w']:g} mm",font=font(23),fill='#223748',anchor='mm')
        g.text((x+220,y+474),'Overall width: 2000 mm',font=font(22),fill='#223748',anchor='mm')
        if i==1:
            at=x+1000*s
            for a in range(y,y+440,15):g.line((at,a,at,a+8),fill='#cf493b',width=2)
            g.text((x+220,y+530),'Partition moved by 90 mm',font=font(24),fill='#cf493b',anchor='mm')
        elif i==2:g.text((x+220,y+530),'Partition error: 0 mm',font=font(24),fill='#287447',anchor='mm')
        else:g.text((x+220,y+530),'Two specified 1000 mm rooms',font=font(23),fill='#526475',anchor='mm')
    g.text((45,755),'Dashed red = intended partition. This isolates reconstruction loss, not door/window detection.',font=font(21),fill='#526475')
    im.save(OUT/'source-before-after.png',optimize=True)

if __name__=='__main__':
    manifest={'evaluation':'synthetic source inputs for blinded approximate assistant-model evaluation; not Astra API results','sources':[source(A,'A'),source(B,'B')]}
    request=OUT/'native-sources'/'extraction-request.json'
    if request.exists(): manifest['request_sha256']=hashlib.sha256(request.read_bytes()).hexdigest()
    (OUT/'native-sources'/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    comparison()
