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
  const SUFFIXES = ['おすすめ', '比較', '料金', '評判', 'とは', 'やり方', '初心者', '無料', 'デメリット', '2026'];
  globalThis.fetch = async (url) => {
    const u = String(url);
    const q = decodeURIComponent((u.match(/[?&](?:q|query|prefix|p|search)=([^&]*)/) || [])[1] || 'キーワード');
    if (u.includes('trends.google')) {
      const items = ['大谷翔平', '確定申告', '新NISA', '台風情報', '生成AI'].map((query, i) => ({
        title: { query },
        formattedTraffic: `${(5 - i) * 10}万+`,
        relatedQueries: [{ query: `${query} 速報` }],
        articles: [{ title: `${query}の最新`, url: 'https://example.com', source: 'モック通信' }],
      }));
      const body = `)]}',\n${JSON.stringify({
        default: { trendingSearchesDays: [{ formattedDate: '9月8日', trendingSearches: items }] },
      })}`;
      return new Response(body, { status: 200 });
    }
    if (u.includes('wikipedia.org')) {
      if (u.includes('opensearch')) {
        return new Response(JSON.stringify([q, [q], [''], [`https://ja.wikipedia.org/wiki/${q}`]]), { status: 200 });
      }
      if (u.includes('rest_v1')) {
        return new Response(
          JSON.stringify({ title: q, extract: `${q} は、モックデータとして生成された説明文です。`, content_urls: { desktop: { page: 'https://ja.wikipedia.org/' } } }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ query: { pages: { 1: { links: [{ title: `${q} 関連` }, { title: '検索エンジン最適化' }] } } } }), { status: 200 });
    }
    // サジェスト系はすべて OpenSearch 形式で返す
    const list = SUFFIXES.map((s) => `${q} ${s}`).slice(0, 8 + (q.length % 3));
    return new Response(JSON.stringify([q, list]), { status: 200 });
  };
  console.log('[devserver] モックモード: 外部APIには接続しません');
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
