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
  }, { cache: 'public, max-age=60, s-maxage=120' });
}
