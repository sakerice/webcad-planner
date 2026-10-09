"""Create a concise human-readable audit from measured JSON; no production writes."""
import json
from pathlib import Path
H=Path(__file__).resolve().parent
j=json.loads((H/'geometry-audit.json').read_text())
f=j['findings'];summary=j['summary']
lines=['# Modular architecture geometry evidence','','Production evidence only. Final independent acceptance and expansion approval remain separate.','',f"Scope: {len(j['assets'])} prototypes and {len(j['assemblies'])} actual saved assembly scenes. Inputs were {'unchanged' if summary['allInputFilesUnchanged'] else 'changed during inspection'}; exact file hashes and repository-relative paths are in geometry-audit.json.",'',f"Result: {summary['hardFailureCount']} current hard findings; {summary['exposedDuplicateAssetCount']} assets with exposed cross-part duplicate surfaces.",'','## Actual source and GLB checks','',
'- Reads native authoring meshes and the active canonical source scene. Decodes GLB binary POSITION, NORMAL, and index buffers with node transforms, rather than trusting descriptors or prior validation JSON.',
'- Every actual GLB/source triangle must match a native-part triangle including orientation within 0.002 mm. Coincident opposing contact faces are kept in separate solid partitions.',
'- Each closed component is independently checked for two oppositely directed edge uses, positive signed volume, finite positions, nondegenerate triangles, and nonadjacent triangle self-intersections.',
'- Tests actual stored corner normals for finite unit length, correct outward hemisphere, and alignment on flat faces. Smooth turned-column normals are intentionally allowed to differ from face normals.',
'- Native-part contact graph and all coplanar cross-part overlaps are independently measured. Opposing butt contacts and buried overlaps are distinguished from exposed same-facing duplicate surfaces. Exposure uses outward samples against the union of constituent closed solids.','']
for a in j['assets']:
 p=a['glb']['parts'];norm=min(x['minimumCornerNormalDot'] for x in p);volume=min(c['signedVolumeM3'] for x in p for c in x['connectedClosedComponents']);dims=', '.join(f'{v:.3f}' for v in a['dimensionsMm'])
 lines.append(f"- {a['id']}: {len(p)} native solids, {sum(x['triangles'] for x in p)} triangles; dimensions {dims} mm; smallest closed volume {volume:.9g} m³; lowest actual corner-normal dot {norm:.7f}; contact groups {len(a['nativeContacts']['connectedGroups'])}; exposed duplicate pairs {len(a['nativeContacts']['exposedDuplicatePairs'])}.")
 if 'opening'in a:
  x=a['opening'];lines.append(f"  - Portal: {x['minimumMeasuredWidthMm']:.6f} × {x['minimumMeasuredHeightMm']:.6f} mm, measured over {x['widthSampleCount']} width and {x['heightSampleCount']} height rays. All {x['throughOpeningRayCount']} through-rays clear; {len(x['continuousClearancePrismTriangleIntrusions'])} triangles intersect the continuous inset opening prism.")
 if 'roofMeasurements'in a:
  x=a['roofMeasurements'];lines.append(f"  - Actual roof deck vertical thickness {x['deckMinimumThicknessVerticalMm']:.6f} mm; eave X positions {x['measuredEaveXmm']} mm. Each bearing is measured independently: {x['bearingSeats']}.")
 if 'roofSlateMeasurements'in a:
  x=a['roofSlateMeasurements'];lines.append(f"  - Slates: {x['slateCount']} individually closed tiles; courses alternate {[c['tileCount'] for c in x['courses'][:7]]} tiles with measured half-tile stagger. {len(x['measuredAdjacentCourseLaps'])} actual adjacent-course lap contacts; X overlap {x['minimumMeasuredLapMm']} to {x['maximumMeasuredLapMm']} mm; every measured lap has positive opposing contact area: {x['allMeasuredLapsHavePositiveArea']}.")
lines+=['','## Saved assembly joins and local supports','']
for a in j['assemblies']:
 lines += [f"### {a['name']}",'',f"- Rigid transforms: {all(x['rigidScalePass'] and x['allowedRotationPass'] for x in a['transforms'])}. Contact groups: {len(a['contacts']['connectedGroups'])}. Exposed cross-module duplicate pairs: {len(a['contacts']['exposedDuplicatePairs'])}."]
 for c in a['contacts']['contacts']:
  area=c['coplanarAreaM2']['opposedInternalContact']
  lines.append(f"- {c['a']} ↔ {c['b']}: {area*1e6:.3f} mm² opposing contact faces.")
 if 'opening'in a:
  x=a['opening'];lines.append(f"- Assembled portal: {x['minimumMeasuredWidthMm']:.6f} × {x['minimumMeasuredHeightMm']:.6f} mm; continuous clearance pass {x['clearancePass']}.")
 if 'roofSupportSamples'in a:
  gaps=[x['gapMm'] for x in a['roofSupportSamples'] if x['gapMm'] is not None];lines.append(f"- Roof bearing/wall interfaces: {len(gaps)} measured support samples; maximum absolute vertical gap {max(map(abs,gaps)) if gaps else None} mm. Roof and wall interface elevations are recorded individually in JSON.")
  x=a['hollowCavitySampling'];lines.append(f"- Hollow attic: {x['samples']} cavity samples below the actual roof underside, {x['occupiedSamples']} occupied. Eaves: {a['measuredEavesMm']}.")
 if 'columnSupportSamples'in a:
  for x in a['columnSupportSamples']:lines.append(f"- {x['column']}: ground {x['groundMm']:.6f} mm, capital top {x['capitalTopMm']:.6f} mm, cornice underside {x['corniceUndersideMm']:.6f} mm, gap {x['verticalGapMm']:.6f} mm.")
 lines+=['']
lines+=['## Findings and limits','']
if f:
 for x in f:lines.append('- '+x.get('asset',x.get('assembly',''))+': '+x['test']+'; full geometric examples in JSON.')
else:lines.append('- No unresolved geometry findings in this run.')
lines+=['- Earlier exposed portal/trim/roof–gable overlaps are documented in exposed-surface-repair-targets.md as superseded repair evidence. That file is not the current status.','- Clear-opening tests use a 0.008 mm inset to avoid claiming boundary surfaces are an obstruction. Same-facing seam slivers below the 0.002 mm positional tolerance are excluded.','- Exposure classification samples clipped overlap polygons; it is not an exact constructive-solid-geometry union theorem. No collision, physics, load-bearing engineering certification, or visual acceptance is implied.','- Reproduction: run Blender in background with audit/audit_geometry.py, then run summarize_geometry_audit.py with Python. Run audit_selftest.py in Blender for the independent synthetic regression cases. No production blend is saved or mesh edited by these scripts.','']
(H/'geometry-audit-report.md').write_text('\n'.join(lines)+'\n')
