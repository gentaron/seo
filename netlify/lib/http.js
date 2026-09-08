/**
 * http.js — Functions 共通のネットワーク/レスポンスユーティリティ
 * 依存パッケージなし（Node 20+ のグローバル fetch / AbortSignal を利用）
 */

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

export const DEFAULT_HEADERS = {
  'User-Agent': UA,
  'Accept-Language': 'ja,en-US;q=0.8,en;q=0.6',
  Accept: 'application/json,text/javascript,*/*;q=0.1',
};

/**
 * タイムアウトと1回のリトライを備えた fetch。
 * @param {string} url
 * @param {{timeout?:number, retries?:number, headers?:Record<string,string>}} [opts]
 */
export async function fetchWithTimeout(url, opts = {}) {
  const { timeout = 6000, retries = 1, headers = {} } = opts;
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { ...DEFAULT_HEADERS, ...headers },
        redirect: 'follow',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (err) {
      lastError = err;
      if (attempt < retries) await sleep(120 * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError ?? new Error('fetch failed');
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 同時実行数を制限しながら非同期処理を流す。
 * 失敗しても全体は止めず、{status} 付きの結果を返す（Promise.allSettled 相当）。
 * @template T,R
 * @param {T[]} items
 * @param {number} limit
 * @param {(item:T, index:number)=>Promise<R>} worker
 * @returns {Promise<Array<{status:'fulfilled', value:R}|{status:'rejected', reason:any}>>}
 */
export async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const size = Math.max(1, Math.min(limit, items.length || 1));
  const runners = Array.from({ length: size }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      try {
        results[index] = { status: 'fulfilled', value: await worker(items[index], index) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  });
  await Promise.all(runners);
  return results;
}

/** ごく軽量な TTL 付き LRU。Lambda インスタンスが生きている間だけ有効 */
export class TTLCache {
  constructor(max = 800, ttl = 10 * 60 * 1000) {
    this.max = max;
    this.ttl = ttl;
    this.map = new Map();
  }

  get(key) {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expires) {
      this.map.delete(key);
      return undefined;
    }
    // LRU: 参照されたものを末尾へ
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key, value, ttl = this.ttl) {
    if (this.map.size >= this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, { value, expires: Date.now() + ttl });
    return value;
  }
}

/** IP 単位のトークンバケット（インスタンスローカルのベストエフォート） */
export class RateLimiter {
  constructor(capacity = 240, refillPerSec = 8) {
    this.capacity = capacity;
    this.refillPerSec = refillPerSec;
    this.buckets = new Map();
  }

  take(key, cost = 1) {
    const now = Date.now();
    const bucket = this.buckets.get(key) || { tokens: this.capacity, ts: now };
    const elapsed = (now - bucket.ts) / 1000;
    bucket.tokens = Math.min(this.capacity, bucket.tokens + elapsed * this.refillPerSec);
    bucket.ts = now;
    if (bucket.tokens < cost) {
      this.buckets.set(key, bucket);
      return false;
    }
    bucket.tokens -= cost;
    this.buckets.set(key, bucket);
    if (this.buckets.size > 5000) this.buckets.clear();
    return true;
  }
}

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

/** JSON レスポンス生成 */
export function json(body, { status = 200, cache = 'public, max-age=300', headers = {} } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': cache,
      ...CORS_HEADERS,
      ...headers,
    },
  });
}

export function error(message, status = 400, extra = {}) {
  return json({ ok: false, error: message, ...extra }, { status, cache: 'no-store' });
}

/** プリフライト応答 */
export function preflight() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/** クライアント IP の推定 */
export function clientIp(request) {
  const h = request.headers;
  return (
    h.get('x-nf-client-connection-ip') ||
    (h.get('x-forwarded-for') || '').split(',')[0].trim() ||
    'unknown'
  );
}

/** ")]}'" などの JSONP/XSSI プレフィックスを剥がして JSON.parse */
export function parseGuardedJson(text) {
  const cleaned = String(text).replace(/^[)\]}'",\s]+/, '');
  const start = cleaned.search(/[[{]/);
  return JSON.parse(start > 0 ? cleaned.slice(start) : cleaned);
}
