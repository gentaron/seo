/**
 * GET /api/ai — AI Pulse の最新スナップショット
 *
 *   ?cat=model|agent|product|company|research|infra|opensource|policy|concept|emerging
 *   ?limit=60
 *
 * スナップショットが無い（デプロイ直後）ときだけ同期で 1 回観測する（10 秒上限なので予算 8.5 秒）。
 */

import { openStore } from '../lib/store.js';
import { runAiPipeline, AI_KEYS } from '../lib/ai/pipeline.js';
import { json, error, preflight } from '../lib/http.js';

export default async function handler(request) {
  if (request.method === 'OPTIONS') return preflight();
  if (request.method !== 'GET') return error('GET only', 405);
  const url = new URL(request.url);
  const store = await openStore();

  let snap = await store.get(AI_KEYS.latest);
  if (!snap) {
    snap = await runAiPipeline({ store, budgetMs: 8500, trigger: 'bootstrap' });
    if (snap?.skipped) return error('初回観測中です。数秒後に再読み込みしてください。', 503, { retryAfter: 5 });
  }
  if (!Array.isArray(snap?.top)) return error('スナップショットがありません', 503);

  const cat = url.searchParams.get('cat');
  const limit = Math.min(60, Math.max(1, Number(url.searchParams.get('limit')) || 60));
  let top = snap.top;
  if (cat) top = top.filter((t) => t.cat === cat);
  return json(
    { ...snap, top: top.slice(0, limit), ageSec: Math.max(0, Math.round((Date.now() - snap.generatedAt) / 1000)), servedAt: Date.now() },
    { cache: 'public, max-age=60, s-maxage=120, stale-while-revalidate=600' },
  );
}
