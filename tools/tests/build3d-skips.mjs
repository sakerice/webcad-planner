// 画面テストの共通部品: 3D の作り直しで「1つの物だけ飛ばした」ことを見落とさない。
//
// index.html の build3DOneSafely は、壁や物を1つ作るときに例外が出ると、その物だけ
// 飛ばして残りを描く(他人のプランで 3D が全部消えないための最後の守り)。ふつうの
// プランで起きたら不具合なので、console.error を出し、window.__build3dSkipped に数える。
// 飛ばしても pageerror にはならないので、テストはここで明示的に見る。
//
//   watch3dSkips(page, errors)       … 飛ばしたときの console.error を errors に積む(読み直しをまたいでも拾う)
//   await read3dSkips(page)          … いまのページで飛ばした数と id(読めなければ null)
//   await assertNo3dSkips(page, 名前) … 飛ばした数が 0 でなければ例外

const SKIP_TEXT = /3Dに描けない/;

export function watch3dSkips(page, errors, label = '') {
  page.on('console', (m) => {
    if (SKIP_TEXT.test(m.text())) errors.push((label ? `[${label}] ` : '') + '3D で飛ばした: ' + m.text().slice(0, 300));
  });
}

export async function read3dSkips(page) {
  try {
    return await page.evaluate(() => ({
      count: Number(window.__build3dSkipped) || 0,
      ids: (window.__build3dSkippedIds || []).slice(0, 10),
    }));
  } catch (_) {
    return null;
  }
}

export async function assertNo3dSkips(page, label = '') {
  const s = await read3dSkips(page);
  if (s && s.count) {
    throw new Error(`${label ? label + ': ' : ''}3D の作り直しで ${s.count} 個の物を飛ばした: ${s.ids.join(', ')}`);
  }
  return s;
}
