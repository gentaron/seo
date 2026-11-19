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
    firstSeenAt: Number.isFinite(term.first) ? new Date(term.first).toISOString() : null,
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
  }, { cache: 'public, max-age=60, s-maxage=120' });
}
