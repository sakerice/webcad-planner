// 屋根の部品(洋館セットのスレート切妻など)の屋根面に屋根材を貼ると、柄が面の流れに沿う。
//
// 部品のモデルの展開(UV)は向きがばらばらで(切妻ユニットは屋根面の約9割で横倒し、ドーマー用は斜め)、
// そのまま貼ると瓦の段が流れに沿って縦に走った。屋根材を貼るときだけ、アプリが流れに沿った UV に
// 作り直す(roofSlopeUVsForMesh)。部品の色(スレートの青灰色)も屋根材には掛けない。
import assert from 'node:assert/strict';

const _pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const chromium = _pw.chromium || (_pw.default && _pw.default.chromium);
const APP = process.env.APP_URL || 'http://localhost:8932/';
const IDS = ['rpg-mansion-slate-gable-span-01', 'rpg-mansion-mansard-hipped-end-01', 'rpg-mansion-gable-dormer-host-01'];
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(APP + '?preset=2f');
  await page.waitForFunction(() => window.FMP_ITEMS && getFmpItem('rpg-mansion-slate-gable-span-01') && THREE.GLTFLoader, null, { timeout: 60000 });
  // 屋根材の画像を先に読む(読めるまでは素材を当てない作り。アプリでは読めたら描き直す)
  await page.evaluate(() => { getTexture3D('roof_standing_seam_silver'); getTextureNormal3D('roof_standing_seam_silver'); });
  await page.waitForFunction(() => !!cloneRepeatReadyTexture(getTexture3D('roof_standing_seam_silver')), null, { timeout: 30000 });
  const r = await page.evaluate(async (ids) => {
    const out = {};
    for (const id of ids) {
      const f = getFmpItem(id);
      const gltf = await new Promise((res, rej) => new THREE.GLTFLoader().load(f.model, res, null, rej));
      const scene = gltf.scene;
      ModelQuality.prepare(scene, f.model);
      scene.updateMatrixWorld(true);
      ModelQuality.applyFinishes(scene, null, null, { roof: 'roof_standing_seam_silver' }, FINISH_TEXTURE_DEPS);
      let area = 0, along = 0, white = true, roofMeshes = 0;
      scene.traverse((m) => {
        if (!m.isMesh || Array.isArray(m.material) || !m.material.userData || m.material.userData.finishChannel !== 'roof') return;
        roofMeshes++;
        if (m.material.color.getHexString() !== 'ffffff') white = false;
        const g = m.geometry, pos = g.attributes.position, uv = g.attributes.uv, idx = g.index;
        m.updateWorldMatrix(true, false);
        const cnt = idx ? idx.count : pos.count;
        for (let i = 0; i + 2 < cnt; i += 3) {
          const k = [0, 1, 2].map((j) => (idx ? idx.getX(i + j) : i + j));
          const P = k.map((q) => new THREE.Vector3().fromBufferAttribute(pos, q).applyMatrix4(m.matrixWorld));
          const T = k.map((q) => new THREE.Vector2().fromBufferAttribute(uv, q));
          const e1 = P[1].clone().sub(P[0]), e2 = P[2].clone().sub(P[0]);
          const n = e1.clone().cross(e2); const A = n.length() / 2; if (A < 1e-9) continue;
          n.normalize(); if (n.y < 0) n.negate(); if (n.y > 0.98 || n.y < 0.1) continue;   // 勾配のある面だけ
          const du1 = T[1].x - T[0].x, dv1 = T[1].y - T[0].y, du2 = T[2].x - T[0].x, dv2 = T[2].y - T[0].y, det = du1 * dv2 - du2 * dv1;
          if (Math.abs(det) < 1e-12) continue;
          const dPdv = e1.clone().multiplyScalar(-du2 / det).add(e2.clone().multiplyScalar(du1 / det)).normalize();
          const up = new THREE.Vector3(0, 1, 0).sub(n.clone().multiplyScalar(n.y)).normalize();
          area += A; if (dPdv.dot(up) > 0.9) along += A;
        }
      });
      out[id] = { roofMeshes, along: area ? along / area : 0, white };
    }
    return out;
  }, IDS);
  for (const id of IDS) {
    assert.ok(r[id].roofMeshes > 0, `${id}: 屋根面が無い`);
    assert.ok(r[id].along > 0.98, `${id}: 屋根面の柄が流れに沿っていない (${(r[id].along * 100).toFixed(0)}%)`);
    assert.ok(r[id].white, `${id}: 部品の色が屋根材に掛かっている`);
  }
  assert.deepEqual(errors, [], 'ページで例外: ' + errors.join(' / '));
  console.log('屋根の部品の屋根面: ' + IDS.map((id) => `${id.replace('rpg-mansion-', '')} ${(r[id].along * 100).toFixed(0)}%`).join('、') + ' が流れに沿う');
} finally {
  await browser.close();
}
