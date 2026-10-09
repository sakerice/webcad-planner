from pathlib import Path
import json
H=Path(__file__).resolve().parent
rows=[
('ladder-side','梯子背サイドチェア',450,520,980,'3 curved ladder cross rails; four legs'),
('caned-bergere','籐背ベルジェール・アームチェア',646,615,912,'caned enclosing back; swept arms; upholstered seat'),
('curved-rocker','曲木ロッキングチェア',616,865,1050,'continuous curved rocking rails; spindle back; fixed arms'),
('lyre-side','竪琴背サイドチェア',451,524,940,'open lyre splat; tapered legs'),
('balloon-side','バルーン背チェア',487,548,980,'continuous oval back frame; upholstered back insert'),
('windsor-bow','ボウバック・ウィンザーチェア',494,518,1000,'bent bow; radial spindles; broad wood seat'),
('slipper','スリッパーチェア',581,718,820,'armless low upholstered back; wide cushion; short turned legs'),
('corner','コーナーチェア',617,587,902,'two orthogonal back rails; open front and left sides'),
('smoking','スモーキングチェア',563,504,890,'broad upper elbow pad for backward use; narrow splat'),
('campaign-fold','キャンペーン・フォールディングチェア',579,601,818,'fixed crossed folding-style side frames; brass pins; leather sling'),
('x-back','交差背チェア',437,532,920,'open X back; shaped crest'),
('shield-back','シールド背チェア',442,510,940,'pierced shield splat; tapered legs'),
('gothic-hall','尖頭アーチ・ホールチェア',434,489,1120,'pointed arch pierced back; tall turned posts'),
('barrel-arm','バレルバック・アームチェア',683,663,788,'half-round bent back rail; radiating staves'),
('scoop-desk','スクープ背デスクチェア',597,548,835,'low curved desk back; four-legged spider-like fixed base'),
('prayer','祈祷室ハイバック・チェア',520,580,1080,'high padded prayer-room crest; lower footrest; upright open frame'),
('music','演奏用ミュージックチェア',430,442,775,'slender low back; flat seat; cross-braced frame'),
('cane-stool','籐座四脚スツール',438,438,460,'woven seat; four turned legs; H stretcher'),
('x-stool','X脚レザースツール',537,432,460,'crossed side frames; fixed pins; leather top'),
('saddle-stool','サドル座三脚スツール',451,429,460,'concave saddle seat; tripod legs; triangular stretchers'),
('piano-stool','ピアノ用ペデスタルスツール',520,520,460,'round cushion; fixed spindle column; four splayed feet'),
('boot-bench','ブーツ収納ホールベンチ',1355,495,460,'two-seat cushion; lower slatted shoe rack; six legs'),
('hall-settle','パネル背ホールセトル',1355,541,1080,'two-seat settle; paneled high back; enclosed side arms'),
('telephone-bench','電話台一体ホールベンチ',809,567,813,'one seat beside raised telephone shelf; asymmetric load frame')]
coverage=H.parents[5]/'coverage/inventory-by-kind.json'
chairs=next(a for a in json.loads(coverage.read_text()) if a['kind']=='chair')['dimensions']
items=[]
for n,(key,name,w,d,h,form) in enumerate(rows):
 refs=sorted(chairs,key=lambda a:abs(a['w']-w)+abs(a['d']-d))[:3]
 exact=[sid for a in chairs if (a['w'],a['d'])==(w,d) for sid in a['standard_ids']]
 items.append(dict(key=key,id='rpg-mansion-'+key+'-01',name=name,w=w,d=d,h=h,seatTopMm=460,geometrySignature=form,status='prototype' if n<3 else 'planned-after-review',capacity=2 if key in ['boot-bench','hall-settle'] else 1,targetContract='period-adapted-manual-alternative',exactFootprintMetadataMatches=exact,nearestChairDeclaredReferences=refs,legacyGeometryAvailable=False,geometrySemanticEquivalenceVerified=False,mechanism='static geometry only'))
(H/'production-plan.json').write_text(json.dumps(dict(plannedForms=24,initialPrototypeForms=3,incrementsAfterVisualReview=12,coveragePolicy='Declared footprint references are metadata-only and do not certify replacement compatibility or historic style. No external legacy geometry was inspected. Intended dimensions are realistic period-adapted manual alternatives. Recolors never increment counts. Static props only.',items=items),ensure_ascii=False,indent=2)+'\n')
(H/'production-checkpoint.json').write_text(json.dumps(dict(status='authoring-first-three-prototypes',plannedForms=24,builtForms=0,visualReview='pending',publication='isolated local production only'),indent=2)+'\n')
