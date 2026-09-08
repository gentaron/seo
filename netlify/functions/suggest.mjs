/**
 * /api/suggest — 複数エンジンのサジェストをまとめて取得する
 *
 * GET  /api/suggest?q=転職&engines=google,youtube&modes=base,gojuon
 *      … サーバ側で掛け合わせクエリを生成（お試し・API利用向け）
 * POST /api/suggest  { queries: string[], engines: string[] }
 *      … クライアントがバッチ分割して並列に叩く本番経路
 *
 * 設計方針
 *  - 1エンジン・1クエリの失敗が全体を壊さない（部分成功を返す）
 *  - インスタンス内 TTL キャッシュで同一クエリの再取得を抑制
 *  - IP 単位のトークンバケットで簡易的な濫用防止
 */

import { fetchSuggest, ENGINE_IDS, DEFAULT_ENGINE } from '../lib/engines.js';
import { pool, TTLCache, RateLimiter, json, error, preflight, clientIp } from '../lib/http.js';
import { buildQueries, normalizeKeyword, MODE_IDS } from '../../public/shared/expand.js';

const MAX_QUERIES = 60;
const CONCURRENCY = 12;
const cache = new TTLCache(3000, 10 * 60 * 1000);
const limiter = new RateLimiter(600, 20);

function cacheKey(engine, query) {
  return `${engine} ${query}`;
}

async function collect(queries, engines) {
  const jobs = [];
  for (const engine of engines) {
    for (const query of queries) jobs.push({ engine, query });
  }

  const stats = Object.fromEntries(engines.map((e) => [e, { ok: 0, failed: 0, cached: 0 }]));
  const results = [];

  const settled = await pool(jobs, CONCURRENCY, async ({ engine, query }) => {
    const key = cacheKey(engine, query);
    const hit = cache.get(key);
    if (hit) {
      stats[engine].cached += 1;
      return { engine, query, suggestions: hit, cached: true };
    }
    const suggestions = await fetchSuggest(engine, query, { timeout: 6000 });
    cache.set(key, suggestions);
    return { engine, query, suggestions, cached: false };
  });

  const failures = [];
  settled.forEach((r, i) => {
    const job = jobs[i];
    if (r && r.status === 'fulfilled') {
      stats[job.engine].ok += 1;
      results.push(r.value);
    } else {
      stats[job.engine].failed += 1;
      if (failures.length < 5) {
        const reason = String((r && r.reason && r.reason.message) || (r && r.reason) || 'unknown');
        failures.push({ engine: job.engine, query: job.query, reason });
      }
    }
  });

  return { results, stats, failures };
}

export default async function handler(request) {
  if (request.method === 'OPTIONS') return preflight();

  const ip = clientIp(request);
  const url = new URL(request.url);

  let queries = [];
  let engines = [];

  try {
    if (request.method === 'POST') {
      const body = await request.json();
      queries = Array.isArray(body.queries) ? body.queries : [];
      engines = Array.isArray(body.engines) ? body.engines : body.engine ? [body.engine] : [];
    } else if (request.method === 'GET') {
      const q = normalizeKeyword(url.searchParams.get('q') || '');
      if (!q) return error('パラメータ q（キーワード）が必要です', 400);
      const modes = (url.searchParams.get('modes') || 'base')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => MODE_IDS.includes(s));
      queries = buildQueries(q, modes.length ? modes : ['base']);
      engines = (url.searchParams.get('engines') || url.searchParams.get('engine') || DEFAULT_ENGINE)
        .split(',')
        .map((s) => s.trim());
    } else {
      return error('許可されていないメソッドです', 405);
    }
  } catch {
    return error('リクエストの解析に失敗しました（JSON 形式を確認してください）', 400);
  }

  queries = [...new Set(queries.map((q) => normalizeKeyword(q)).filter(Boolean))].slice(0, MAX_QUERIES);
  engines = [...new Set(engines.filter((e) => ENGINE_IDS.includes(e)))];
  if (!engines.length) engines = [DEFAULT_ENGINE];

  if (!queries.length) return error('取得対象のクエリがありません', 400);

  const cost = Math.ceil((queries.length * engines.length) / 4);
  if (!limiter.take(ip, cost)) {
    return error('リクエストが集中しています。数秒おいて再試行してください', 429, { retryAfter: 5 });
  }

  const started = Date.now();
  const { results, stats, failures } = await collect(queries, engines);

  return json(
    {
      ok: true,
      engines,
      queryCount: queries.length,
      elapsedMs: Date.now() - started,
      stats,
      failures,
      results,
    },
    { cache: 'public, max-age=600, stale-while-revalidate=3600' },
  );
}
