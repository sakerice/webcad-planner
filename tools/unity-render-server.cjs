#!/usr/bin/env node
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const crypto = require('crypto');

const PORT = Number(process.env.WEBCAD_UNITY_RENDER_PORT || 8788);
const HOST = process.env.WEBCAD_UNITY_RENDER_HOST || '127.0.0.1';
const UNITY_PATH = process.env.WEBCAD_UNITY_PATH ||
  '/Applications/Unity/Hub/Editor/2022.3.51f1/Unity.app/Contents/MacOS/Unity';
const UNITY_PROJECT = process.env.WEBCAD_UNITY_PROJECT ||
  '/Users/nariiwa/Documents/GitHub/webcad-unity';
const OUT_DIR = process.env.WEBCAD_UNITY_RENDER_DIR ||
  path.join(process.cwd(), 'scratch', 'unity-renders');
const MAX_BODY_BYTES = Number(process.env.WEBCAD_UNITY_RENDER_MAX_BYTES || 160 * 1024 * 1024);

let activeJob = null;

fs.mkdirSync(OUT_DIR, { recursive: true });

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function sendCors(res, status = 204) {
  res.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
  });
  res.end();
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error(`Request too large (${size} bytes)`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function tail(file, max = 5000) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    return text.slice(Math.max(0, text.length - max));
  } catch {
    return '';
  }
}

function runUnityRender(requestPath, outputPath, logPath) {
  return new Promise((resolve, reject) => {
    const args = [
      '-batchmode',
      '-projectPath', UNITY_PROJECT,
      '-executeMethod', 'WebCADRenderTool.RenderRequestBatch',
      '-webcadRequest', requestPath,
      '-outputPath', outputPath,
      '-quit',
      '-logFile', logPath
    ];
    const startedAt = Date.now();
    const child = spawn(UNITY_PATH, args, { stdio: 'ignore' });
    child.on('error', reject);
    child.on('close', code => {
      const durationMs = Date.now() - startedAt;
      if (code !== 0) {
        const err = new Error(`Unity exited with code ${code}`);
        err.code = code;
        err.durationMs = durationMs;
        reject(err);
        return;
      }
      resolve({ durationMs });
    });
  });
}

async function handleRender(req, res) {
  if (activeJob) {
    sendJson(res, 409, {
      ok: false,
      error: `別のUnityレンダーが実行中です: ${activeJob}`
    });
    return;
  }

  const id = `${new Date().toISOString().replace(/[-:.TZ]/g, '')}-${crypto.randomBytes(4).toString('hex')}`;
  activeJob = id;
  const requestPath = path.join(OUT_DIR, `request-${id}.json`);
  const outputPath = path.join(OUT_DIR, `render-${id}.png`);
  const logPath = path.join(OUT_DIR, `render-${id}.log`);

  try {
    const body = await readBody(req);
    const parsed = JSON.parse(body);
    if (!parsed || !parsed.plan || !parsed.settings) {
      throw new Error('Invalid WebCAD render request');
    }
    fs.writeFileSync(requestPath, JSON.stringify(parsed));
    const result = await runUnityRender(requestPath, outputPath, logPath);
    if (!fs.existsSync(outputPath)) {
      throw new Error('Unity finished, but no PNG was produced');
    }
    sendJson(res, 200, {
      ok: true,
      id,
      url: `/renders/${path.basename(outputPath)}`,
      outputPath,
      logPath,
      durationMs: result.durationMs
    });
  } catch (err) {
    sendJson(res, 500, {
      ok: false,
      id,
      error: err && err.message ? err.message : String(err),
      requestPath,
      outputPath,
      logPath,
      logTail: tail(logPath)
    });
  } finally {
    activeJob = null;
  }
}

function serveRender(req, res) {
  const name = decodeURIComponent(req.url.replace(/^\/renders\//, ''));
  if (!/^render-[a-zA-Z0-9-]+\.png$/.test(name)) {
    sendJson(res, 400, { ok: false, error: 'Invalid render name' });
    return;
  }
  const file = path.join(OUT_DIR, name);
  if (!fs.existsSync(file)) {
    sendJson(res, 404, { ok: false, error: 'Render not found' });
    return;
  }
  const stat = fs.statSync(file);
  res.writeHead(200, {
    'Content-Type': 'image/png',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
    'Content-Length': stat.size
  });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') return sendCors(res);
  if (req.method === 'GET' && req.url === '/health') {
    return sendJson(res, 200, {
      ok: true,
      activeJob,
      unityPath: UNITY_PATH,
      unityProject: UNITY_PROJECT,
      outputDir: OUT_DIR
    });
  }
  if (req.method === 'POST' && req.url === '/render') return handleRender(req, res);
  if (req.method === 'GET' && req.url.startsWith('/renders/')) return serveRender(req, res);
  sendJson(res, 404, { ok: false, error: 'Not found' });
});

server.listen(PORT, HOST, () => {
  console.log(`[WebCAD] Unity render server: http://${HOST}:${PORT}`);
  console.log(`[WebCAD] Unity project: ${UNITY_PROJECT}`);
  console.log(`[WebCAD] Output dir: ${OUT_DIR}`);
});
