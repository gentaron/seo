/**
 * Read-only, versioned event export for cross-system observation.
 * Does not import market data, calculate predictions, or change trend ranking.
 * Every event remains explicitly unverified until corroborated externally.
 */
import { openStore } from '../lib/store.js';
import { KEYS } from '../lib/pipeline.js';
import { json, error, preflight } from '../lib/http.js';

export const INTELLIGENCE_SCHEMA = 'gentaron.world-events/1';

export default async function handler(request) {
  if (request.method === 'OPTIONS') return preflight();
  if (request.method !== 'GET') return error('GET only', 405);
  const store = await openStore();
  const snapshot = await store.get(KEYS.latest);
  if (!snapshot?.analysis || !Array.isArray(snapshot.analysis.events)) {
    return error('観測データがありません', 503);
  }
  const url = new URL(request.url);
  const rawLimit = Number(url.searchParams.get('limit') || 30);
  const limit = Number.isFinite(rawLimit) ? Math.min(30, Math.max(1, Math.floor(rawLimit))) : 30;
  const generatedAt = new Date(snapshot.generatedAt).toISOString();
  // Export a bounded set of trend terms. Scores are relative within the
  // UNDERCURRENT run (the highest trend = 100), not cross-system magnitudes.
  const trends = (Array.isArray(snapshot.terms) ? snapshot.terms : []).slice(0, 50).map((term) => ({
    id: String(term.k ?? '').slice(0, 100),
    term: String(term.t ?? '').slice(0, 120),
    language: term.lang === 'ja' ? 'ja' : 'en',
    category: String(term.cat ?? 'other').slice(0, 60),
    trendScore: Number.isFinite(term.score) ? term.score : null,
    velocity: Number.isFinite(term.vel) ? term.vel : null,
    sourceCount: Number.isFinite(term.spread) ? term.spread : 0,
    sources: Array.isArray(term.srcs) ? term.srcs.filter((x) => typeof x === 'string').slice(0, 6) : [],
    status: String(term.status ?? 'steady').slice(0, 24),
    direction: typeof term.dir === 'string' ? term.dir : null,
    clusterId: typeof term.cl === 'string' ? term.cl : null,
    firstSeenAt: Number.isFinite(term.first) ? new Date(term.first).toISOString() : null,
    availableAt: generatedAt,
  })).filter((x) => x.id && x.term);
  // Merged trend clusters (v3 snapshots). Attention and importance are separate
  // within-run heuristics; verification is corroboration status, not truth.
  const clusters = (Array.isArray(snapshot.trends) ? snapshot.trends : []).slice(0, 50).map((c) => ({
    id: String(c.id ?? '').slice(0, 40),
    term: String(c.t ?? '').slice(0, 120),
    mergedTerms: Array.isArray(c.members) ? c.members.map((m) => String(m.t).slice(0, 120)).slice(0, 12) : [],
    topic: String(c.topic ?? 'other').slice(0, 30),
    attention: Number.isFinite(c.attention) ? c.attention : null,
    importance: Number.isFinite(c.importance) ? c.importance : null,
    direction: String(c.dir ?? 'flat').slice(0, 10),
    verification: String(c.verification?.status ?? 'unverified').slice(0, 20),
    posts: Number.isFinite(c.posts) ? c.posts : null,
    sourceCount: Number.isFinite(c.spread) ? c.spread : 0,
    firstSeenAt: Number.isFinite(c.first) ? new Date(c.first).toISOString() : null,
    lastPublishedAt: Number.isFinite(c.lastPub) ? new Date(c.lastPub).toISOString() : null,
    evidence: (Array.isArray(c.evidence) ? c.evidence : []).slice(0, 5).map((e) => ({ source: e.s, type: e.type, title: String(e.x ?? '').slice(0, 220), url: e.l || e.u })),
    availableAt: generatedAt,
  })).filter((x) => x.id && x.term);
  const items = snapshot.analysis.events.slice(0, limit).map((event) => ({
    ...event,
    verificationStatus: 'unverified',
    availableAt: generatedAt,
    sourceSystem: 'UNDERCURRENT',
    metricType: 'editorial-impact-heuristic',
  }));
  return json({
    schema: INTELLIGENCE_SCHEMA,
    system: 'UNDERCURRENT',
    generatedAt,
    servedAt: new Date().toISOString(),
    disclaimer: 'Events are unverified observations. Impact scores are editorial priorities, not truth, probabilities, or financial forecasts.',
    sourceCoverage: {
      up: snapshot.stats?.sourcesUp ?? null,
      total: snapshot.stats?.sourcesTotal ?? null,
      signals: snapshot.stats?.usableSignals ?? null,
      excluded: snapshot.stats?.excludedSignals ?? null,
    },
    count: items.length,
    events: items,
    trendMetric: "within-run-relative-score-0-to-100-not-probability",
    trends,
    importanceMetric: 'rule-based-societal-importance-0-to-100-null-when-insufficient-data',
    clusters,
  }, { cache: 'public, max-age=60, s-maxage=120' });
}
