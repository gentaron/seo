/**
 * api.js — Netlify Functions との通信層
 *
 * 掛け合わせクエリをバッチに割り、複数リクエストを並列に流して
 * 到着したそばから呼び出し元へ渡す（＝リアルタイム表示のための基盤）。
 */

import { buildQueries, chunk } from '../../shared/expand.js';

const API = {
  suggest: '/api/suggest',
  trends: '/api/trends',
  related: '/api/related',
  health: '/api/health',
};

/** 同時リクエスト数（ブラウザの接続数上限を考慮） */
const REQUEST_CONCURRENCY = 4;

/** レスポンスをまとめて捨てないための小さなリトライ */
async function postJson(url, body, signal, attempt = 0) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    if (res.status === 429 && attempt < 2) {
      await new Promise((r) => setTimeout(r, 900 * (attempt + 1)));
      return postJson(url, body, signal, attempt + 1);
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    if (attempt < 1) {
      await new Promise((r) => setTimeout(r, 500));
      return postJson(url, body, signal, attempt + 1);
    }
    throw err;
  }
}

/**
 * サジェスト探索を実行する。
 * @param {object} opts
 * @param {string} opts.keyword
 * @param {string[]} opts.modes
 * @param {string[]} opts.engines
 * @param {AbortSignal} [opts.signal]
 * @param {(payload:object)=>void} [opts.onBatch] バッチ到着ごとに呼ばれる
 * @param {(p:{done:number,total:number})=>void} [opts.onProgress]
 * @returns {Promise<{queries:number, batches:number, failures:object[], stats:object}>}
 */
export async function runSuggest(opts) {
  const { keyword, modes, engines, signal, onBatch, onProgress } = opts;
  const queries = buildQueries(keyword, modes);
  if (!queries.length) return { queries: 0, batches: 0, failures: [], stats: {} };

  // エンジンを増やすほど1リクエストの仕事量が増えるため、バッチ幅を絞る
  const batchSize = Math.max(6, Math.round(24 / Math.max(1, engines.length)));
  const batches = chunk(queries, batchSize);

  let done = 0;
  const failures = [];
  const stats = {};
  let cursor = 0;

  const runners = Array.from({ length: Math.min(REQUEST_CONCURRENCY, batches.length) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= batches.length) return;
      const batch = batches[index];
      try {
        const payload = await postJson(API.suggest, { queries: batch, engines }, signal);
        for (const [engine, s] of Object.entries(payload.stats || {})) {
          const acc = (stats[engine] = stats[engine] || { ok: 0, failed: 0, cached: 0 });
          acc.ok += s.ok || 0;
          acc.failed += s.failed || 0;
          acc.cached += s.cached || 0;
        }
        if (payload.failures?.length) failures.push(...payload.failures);
        onBatch?.(payload);
      } catch (err) {
        if (err.name === 'AbortError') return;
        failures.push({ engine: engines.join(','), query: batch[0], reason: err.message });
      } finally {
        done += 1;
        onProgress?.({ done, total: batches.length });
      }
    }
  });

  await Promise.all(runners);
  return { queries: queries.length, batches: batches.length, failures, stats };
}

/** 急上昇ワード（日本） */
export async function fetchTrends(signal) {
  const res = await fetch(API.trends, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** キーワードの関連情報（Wikipedia） */
export async function fetchRelated(keyword, signal) {
  const res = await fetch(`${API.related}?q=${encodeURIComponent(keyword)}`, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** 提供元の疎通診断 */
export async function fetchHealth(signal) {
  const res = await fetch(API.health, { signal });
  return res.json();
}
