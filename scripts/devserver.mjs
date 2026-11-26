/**
 * devserver.mjs — netlify-cli なしで動かす軽量ローカルサーバ
 *
 *   node scripts/devserver.mjs              # 実データ（外部APIへ接続）
 *   node scripts/devserver.mjs --mock       # 疑似データ（オフライン検証用）
 *   PORT=8888 node scripts/devserver.mjs
 *
 * public/ を静的配信し、/api/<name> を netlify/functions/<name>.mjs に橋渡しする。
 * 本番の Netlify では netlify.toml のリダイレクトが同じ経路を作る。
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, dirname, normalize as normalizePath } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(root, 'public');
const PORT = Number(process.env.PORT || 8888);
const MOCK = process.argv.includes('--mock') || process.env.SR_MOCK === '1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

/* ---------- モック（外部APIに触れずに UI を検証するため） ---------- */

if (MOCK) {
  const { makeMockFetch, seedHistory } = await import('./mock-web.mjs');
  const { memoryStore } = await import('../netlify/lib/store.js');
  const { runPipeline } = await import('../netlify/lib/pipeline.js');
  const { wrapAiMockFetch, seedAiHistory } = await import('./mock-ai.mjs');
  const { runAiPipeline } = await import('../netlify/lib/ai/pipeline.js');
  const base = Date.now();
  globalThis.fetch = wrapAiMockFetch(makeMockFetch({ base }), { base });
  globalThis.__UNDERCURRENT_STORE__ = memoryStore();
  // 過去 24 時間ぶん（3 時間おき × 8 回）観測した状態を作っておく
  await seedHistory({ runPipeline, store: globalThis.__UNDERCURRENT_STORE__, base, runs: 8 });
  // AI Pulse は毎時 × 18 回
  await seedAiHistory({ runAiPipeline, store: globalThis.__UNDERCURRENT_STORE__, base, runs: 18 });
  console.log('[devserver] モックモード: 外部APIには接続しません（疑似観測 8 回分＋AI Pulse 18 回分を投入済み）');
}

/* ---------- Functions 橋渡し ---------- */

const handlers = new Map();

async function loadHandler(name) {
  if (handlers.has(name)) return handlers.get(name);
  if (!/^[a-z0-9_-]+$/i.test(name)) return null;
  try {
    const mod = await import(`file://${join(root, 'netlify/functions', `${name}.mjs`)}`);
    handlers.set(name, mod.default);
    return mod.default;
  } catch {
    return null;
  }
}

async function toRequest(req) {
  const url = `http://${req.headers.host || 'localhost'}${req.url}`;
  const init = { method: req.method, headers: req.headers };
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    init.body = Buffer.concat(chunks);
  }
  return new Request(url, init);
}

async function sendResponse(res, response) {
  const body = Buffer.from(await response.arrayBuffer());
  const headers = {};
  response.headers.forEach((v, k) => {
    headers[k] = v;
  });
  res.writeHead(response.status, headers);
  res.end(body);
}

/* ---------- 静的配信 ---------- */

async function serveStatic(res, pathname) {
  let filePath = join(PUBLIC, normalizePath(pathname).replace(/^(\.\.[/\\])+/, ''));
  try {
    const info = await stat(filePath);
    if (info.isDirectory()) filePath = join(filePath, 'index.html');
  } catch {
    filePath = join(PUBLIC, 'index.html'); // SPA 的フォールバック
  }
  try {
    const data = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
  }
}

createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  const apiMatch = pathname.match(/^\/(?:api|\.netlify\/functions)\/([^/]+)/);
  if (apiMatch) {
    const handler = await loadHandler(apiMatch[1]);
    if (!handler) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: `function not found: ${apiMatch[1]}` }));
      return;
    }
    try {
      const response = await handler(await toRequest(req), {});
      await sendResponse(res, response);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
    return;
  }
  await serveStatic(res, pathname);
}).listen(PORT, () => {
  console.log(`[devserver] http://localhost:${PORT}  (mock=${MOCK})`);
});
