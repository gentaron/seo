/**
 * GET /api/history — 観測ごとのトップ語の履歴（サイドバー「過去の潮流」用）
 */

import { openStore } from '../lib/store.js';
import { KEYS } from '../lib/pipeline.js';
import { json, preflight } from '../lib/http.js';

export default async function handler(request) {
  if (request.method === 'OPTIONS') return preflight();
  const store = await openStore();
  const meta = (await store.get(KEYS.meta)) || {};
  return json(
    { ok: true, runs: meta.runs ?? 0, lastRunAt: meta.lastRunAt ?? null, history: meta.history ?? [] },
    { cache: 'public, max-age=60, s-maxage=300' },
  );
}
