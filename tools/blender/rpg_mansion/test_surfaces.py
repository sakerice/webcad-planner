"""Validate proposal evidence against delivered GLB bytes independently of the probe."""
import json,hashlib,unittest,os
from pathlib import Path
from test_pack import glb,ROOT
D=ROOT/'assets/models/packs/rpg-mansion-contract/v0.2.0'
seats=json.loads((D/'sit-sockets.proposal.json').read_text())['sockets'];surfaces=json.loads((D/'placement-surfaces.proposal.json').read_text())['surfaces']
class Surfaces(unittest.TestCase):
 def check_evidence(self,e):
  p=ROOT/e['modelPath'];self.assertEqual(e['modelSha256'],hashlib.sha256(p.read_bytes()).hexdigest());self.assertRegex(e['sourceBlendSha256'],r'^[a-f0-9]{64}$');j,read=glb(p);area=0
  source=Path(os.environ.get('RPG_SOURCE_ARCHIVE',ROOT))/e['sourceBlend']
  if os.environ.get('RPG_SOURCE_ARCHIVE') or source.exists():self.assertEqual(e['sourceBlendSha256'],hashlib.sha256(source.read_bytes()).hexdigest())
  for ref,expected in zip(e['triangles'],e['trianglesLocalGltfM'],strict=True):
   p=j['meshes'][ref['mesh']]['primitives'][ref['primitive']];idx=read(p['indices']);xyz=read(p['attributes']['POSITION']);a,b,c=[xyz[idx[ref['triangle']*3+k][0]] for k in range(3)]
   self.assertEqual([list(a),list(b),list(c)],expected);self.assertLess(max(a[1],b[1],c[1])-min(a[1],b[1],c[1]),1e-7)
   signed=((b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2]))/2;self.assertGreater(signed,0);area+=signed
  self.assertAlmostEqual(area,e['surfaceAreaM2'],places=8)
 def test_actual_glb_evidence(self):
  self.assertEqual(len(seats),3);self.assertEqual(len(surfaces),3)
  for s in seats+surfaces:
   self.assertEqual(s['assetRevision'],'sha256:'+s['evidence']['modelSha256']);self.check_evidence(s['evidence']);self.assertEqual(s['status'],'geometry-candidate-host-validation-required')
  for s in seats:self.check_evidence(s['seatFrameReference']['evidence'])
 def test_seat_frame_approach_and_pelvis_are_distinct(self):
  for s in seats:
   self.assertGreater(s['localSeatSurfaceCenter'][1]-s['seatFrameReference']['localCenter'][1],.1);self.assertEqual(s['localApproachFloorPoint'][1],0);self.assertGreater(s['localApproachFloorPoint'][2],s['seatSurfaceBoundsM']['max'][2]+.5)
   self.assertEqual(s['localFrontDirection'],[0,0,1]);self.assertEqual(s['evidence']['rigValidation'],'not-performed');self.assertNotIn('reachable',s);self.assertNotIn('pelvisOffset',s)
 def test_working_surface_not_top_of_furniture(self):
  s=next(s for s in surfaces if 'secretary' in s['assetId']);self.assertAlmostEqual(s['localSurfaceCenter'][1],.983,places=6);self.assertGreater(1.410-s['localSurfaceCenter'][1],.4)
if __name__=='__main__':unittest.main(verbosity=2)
