/**
 * Cross-system read-only observation endpoint.
 * QAIZ is optional, fetched only from an operator-supplied public HTTPS base URL.
 * No pooled risk score, sentiment fusion or predictive feature is calculated.
 */
import { openStore } from '../lib/store.js';
import { KEYS } from '../lib/pipeline.js';
import { json, error, preflight } from '../lib/http.js';

export const UNIFIED_SCHEMA = 'gentaron.observation/1';

export function qaizFeedUrl(raw) {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    const h = u.hostname.toLowerCase();
    // Do not accept an arbitrary request-supplied target, HTTP, credentials or local hosts.
    if (u.protocol !== 'https:' || u.username || u.password || u.port ||
        !h.includes('.') || h === 'localhost' || h.endsWith('.localhost') ||
        h.endsWith('.local') || h.endsWith('.internal') ||
        /^\d+(?:\.\d+){3}$/.test(h) || h.includes(':')) return null;
    return new URL('/api/feed', u.origin).toString();
  } catch { return null; }
}

async function loadQaiz(url) {
  if (!url) return { status: 'not-configured', feed: null };
  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(), 3000);
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: ac.signal,
      redirect: 'error',
    });
    if (!res.ok) return { status: 'http-' + res.status, feed: null };
    const length = Number(res.headers.get('content-length'));
    if (length > 200_000) return { status: 'oversized', feed: null };
    const raw = await res.text();
    if (raw.length > 200_000) return { status: 'oversized', feed: null };
    const data = JSON.parse(raw);
    if (data?.schema !== 'gentaron.feed/1' || !Array.isArray(data.items)) {
      return { status: 'invalid-schema', feed: null };
    }
    return { status: 'ok', feed: {
      schema: data.schema,
      generatedAt: data.generatedAt ?? null,
      items: data.items.filter((x) => x && x.evidence === 'observed' && /^https:\/\//.test(x.url)).slice(0, 30),
    } };
  } catch {
    return { status: 'unavailable', feed: null };
  } finally {
    clearTimeout(timeout);
  }
}

export default async function handler(request) {
  if (request.method === 'OPTIONS') return preflight();
  if (request.method !== 'GET') return error('GET only', 405);
  const store = await openStore();
  const snapshot = await store.get(KEYS.latest);
  if (!snapshot?.analysis?.events) return error('UNDERCURRENT観測がありません', 503);

  // Production QAIZ URL is public, not a secret. The Netlify account may not
  // grant environment-variable editing; an operator may still override it.
  // Explicit "disabled" opts out for development and incident response.
  const configuredQaiz = process.env.QAIZ_PUBLIC_URL === 'disabled'
    ? null : (process.env.QAIZ_PUBLIC_URL || 'https://qaiz.gen5wx.workers.dev');
  const qaiz = await loadQaiz(qaizFeedUrl(configuredQaiz));
  return json({
    schema: UNIFIED_SCHEMA,
    generatedAt: new Date(snapshot.generatedAt).toISOString(),
    note: 'UNDERCURRENTの未検証ニュース候補とQAIZの市場観測を並べて返すだけ。相関・因果関係や市場予測は主張しない。',
    undercurrent: {
      source: 'UNDERCURRENT', verificationStatus: 'unverified',
      events: snapshot.analysis.events.slice(0, 30),
      sourceCoverage: { up: snapshot.stats?.sourcesUp ?? null, total: snapshot.stats?.sourcesTotal ?? null },
    },
    qaiz,
    jointSignals: [],
    inferenceStatus: 'not-evaluated',
  }, { cache: 'public, max-age=60, s-maxage=120' });
}
