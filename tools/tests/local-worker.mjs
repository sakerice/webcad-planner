// 本物の Worker(部屋の Durable Object・R2・WebSocket・/api/mcp)を手元で立てる。ブラウザの検査から使う。
//
// なぜ要るか: 共同編集の画面の検査の多くは、部屋の GET・/update・WebSocket を偽物に差し替えている。偽物は
// 「サーバーが返すはずの物」を検査を書いた人が想像して作るので、サーバーの検査(worker/room-guard.mjs)や
// 配信の形が変わっても気づけない。ここでは `wrangler dev --local`(Cloudflare へはつながない)で本物を動かす。
//
// - 設定は wrangler.toml を読み、[build] を外し、main と assets の場所を絶対の道にした写しを
//   .wrangler/test-config/ に書いて使う(wrangler.toml は変えない)。写しの隣に .dev.vars は無いので、秘密は読まない。
// - 配る画面は、先に `SKIP_DEPLOY=1 bash build.sh` で作った dist/。
// - 部屋の保存先は毎回新しい空の一時フォルダ(前の検査の部屋が残らない)。止めるときに消す。
// - oldUi にコミットを渡すと、その時点の画面(index.html と、そこから変わった assets のファイル)を
//   /__old/index.html に置く。同じ Worker・同じ部屋に、古い画面と新しい画面を同時につなげる。
//
// wrangler の場所: WRANGLER_BIN、無ければ npx のキャッシュ(~/.npm/_npx)の新しい版。見つからなければ例外。
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function versionOf(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version.split('.').map(Number); } catch { return null; }
}
function newer(a, b) {
  for (let i = 0; i < 3; i++) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  return false;
}
export function findWrangler() {
  if (process.env.WRANGLER_BIN) return process.env.WRANGLER_BIN;
  const candidates = [path.join(ROOT, 'node_modules', 'wrangler')];
  const npx = path.join(os.homedir(), '.npm', '_npx');
  if (fs.existsSync(npx)) for (const d of fs.readdirSync(npx)) candidates.push(path.join(npx, d, 'node_modules', 'wrangler'));
  let best = null;
  for (const dir of candidates) {
    const v = versionOf(dir);
    const bin = path.join(dir, 'bin', 'wrangler.js');
    if (!v || !fs.existsSync(bin)) continue;
    if (!best || newer(v, best.v)) best = { v, bin };
  }
  if (!best) throw new Error('wrangler が見つかりません。WRANGLER_BIN に wrangler.js の場所を入れてください(インストールはこの検査ではしません)。');
  return best.bin;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

// wrangler.toml の写し。[build] を外し(ビルドはここで1回だけ先にする)、道を絶対にする。
function writeTestConfig() {
  const src = fs.readFileSync(path.join(ROOT, 'wrangler.toml'), 'utf8').split('\n');
  const out = [];
  let skipping = false;
  for (const line of src) {
    const section = line.match(/^\s*\[{1,2}([^\]]+)\]{1,2}\s*$/);
    if (section) skipping = section[1].trim() === 'build';
    if (skipping) continue;
    if (/^\s*main\s*=/.test(line)) { out.push(`main = ${JSON.stringify(path.join(ROOT, 'worker.mjs'))}`); continue; }
    if (/^\s*directory\s*=/.test(line)) { out.push(`directory = ${JSON.stringify(path.join(ROOT, 'dist'))}`); continue; }
    out.push(line);
  }
  const dir = path.join(ROOT, '.wrangler', 'test-config');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'wrangler.toml');
  fs.writeFileSync(file, out.join('\n'));
  return file;
}

// その時点の画面を dist/__old/ に置く。index.html に <base href="/"> を入れ、変わった assets のファイルだけ
// /__old/assets/… の古い中身を読ませる(変わっていない絵・形・JS は今の /assets/… を読む。中身は同じ)。
function placeOldUi(commit) {
  const git = (...args) => execFileSync('git', args, { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
  const changed = git('diff', '--name-only', commit, '--', 'assets').toString().split('\n').filter(Boolean);
  const outDir = path.join(ROOT, 'dist', '__old');
  fs.rmSync(outDir, { recursive: true, force: true });
  let html = git('show', `${commit}:index.html`).toString();
  const used = [];
  for (const file of changed) {
    let body;
    try { body = git('show', `${commit}:${file}`); } catch { continue; } // その時点に無かったファイル
    const dest = path.join(outDir, file);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, body);
    const ref = `"${file}"`;
    if (html.includes(ref)) { html = html.split(ref).join(`"__old/${file}"`); used.push(file); }
  }
  if (!/<head[^>]*>/i.test(html)) throw new Error('古い index.html に <head> がありません');
  html = html.replace(/<head([^>]*)>/i, '<head$1><base href="/">');
  fs.writeFileSync(path.join(outDir, 'index.html'), html);
  return { changed, used };
}

export async function startLocalWorker({ oldUi = null, quiet = true } = {}) {
  const env = { ...process.env, SKIP_DEPLOY: '1', WRANGLER_SEND_METRICS: 'false' };
  delete env.WORKERS_CI; // 念のため: build.sh は WORKERS_CI があると配信しようとする(SKIP_DEPLOY=1 でも止まるが、二重に外す)
  execFileSync('bash', ['build.sh'], { cwd: ROOT, env, stdio: quiet ? 'ignore' : 'inherit' });
  const old = oldUi ? placeOldUi(oldUi) : null;
  const config = writeTestConfig();
  const port = await freePort();
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'webcad-rooms-'));
  const log = [];
  const child = spawn(process.execPath, [findWrangler(), 'dev', '-c', config, '--local', '--ip', '127.0.0.1', '--port', String(port),
    '--persist-to', state, '--show-interactive-dev-session=false', '--live-reload=false'], { cwd: ROOT, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const keep = (b) => { log.push(String(b)); if (log.length > 400) log.shift(); };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  let exited = false;
  child.on('exit', () => { exited = true; });
  const kill = () => { if (!exited) { try { process.kill(-child.pid, 'SIGTERM'); } catch { /* 既に終わった */ } } };
  process.on('exit', kill);
  const origin = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 120000;
  for (;;) {
    if (exited) throw new Error('wrangler dev が終わってしまいました:\n' + log.join('').slice(-3000));
    try {
      const r = await fetch(origin + '/index.html', { signal: AbortSignal.timeout(3000) });
      if (r.ok) break;
    } catch { /* まだ */ }
    if (Date.now() > deadline) { kill(); throw new Error('wrangler dev が 120 秒で立ち上がりませんでした:\n' + log.join('').slice(-3000)); }
    await new Promise((r) => setTimeout(r, 500));
  }
  return {
    origin,
    app: origin + '/',
    oldApp: old ? origin + '/__old/index.html' : null,
    old,
    log: () => log.join(''),
    async stop() {
      kill();
      for (let i = 0; i < 50 && !exited; i++) await new Promise((r) => setTimeout(r, 100));
      if (!exited) { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* 既に終わった */ } }
      process.off('exit', kill);
      fs.rmSync(state, { recursive: true, force: true });
      if (old) fs.rmSync(path.join(ROOT, 'dist', '__old'), { recursive: true, force: true });
    },
  };
}

// 外の AI と同じ呼び方で /api/mcp の道具を呼ぶ(古い版の話し方。Origin は付けない)。返事の文と失敗の印を返す。
let rpcId = 0;
export async function callMcp(origin, name, args) {
  const r = await fetch(origin + '/api/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await r.json();
  const text = body.result && Array.isArray(body.result.content) ? body.result.content.map((c) => c.text || '').join('\n') : JSON.stringify(body);
  return { status: r.status, isError: !!(body.error || (body.result && body.result.isError)), text, body };
}

// 部屋の今のプラン(サーバーが持っている物)
export async function roomPlan(origin, roomId) {
  const r = await fetch(origin + '/api/rooms/' + roomId, { cache: 'no-store' });
  if (!r.ok) throw new Error('部屋を読めません: ' + r.status);
  return { plan: await r.json(), version: Number(r.headers.get('x-room-version')) };
}

// 部屋を作る(画面の「共同編集を開始」と同じ /api/rooms)。知人が作った部屋の代わり。
export async function createRoom(origin, plan) {
  const r = await fetch(origin + '/api/rooms', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(plan) });
  if (!r.ok) throw new Error('部屋を作れません: ' + r.status + ' ' + await r.text());
  return r.json();
}
