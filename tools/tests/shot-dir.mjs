// 画面テストが撮影画像を書き出す場所。git 管理外の output/test-shots に出す。
// 環境変数 SHOT_DIR があればそれを根にする。呼ぶとディレクトリを作り、絶対パスを返す。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function shotDir(...parts) {
  const base = process.env.SHOT_DIR ? path.resolve(process.env.SHOT_DIR) : path.join(ROOT, 'output', 'test-shots');
  const dir = path.join(base, ...parts);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
