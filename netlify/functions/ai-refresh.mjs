/**
 * POST /api/ai-refresh — AI Pulse を手動で 1 回観測（クールダウン 10 分・全員共通）
 */

import { openStore } from '../lib/store.js';
import { runAiPipeline, AI_KEYS } from '../lib/ai/pipeline.js';
import { json, error, preflight } from '../lib/http.js';

const COOLDOWN_MS = 10 * 60 * 1000;

export default async function handler(request) {
  if (request.method === 'OPTIONS') return preflight();
  if (request.method !== 'POST') return error('POST で呼び出してください', 405);
  const store = await openStore();
  const latest = await store.get(AI_KEYS.latest);
  const since = Date.now() - (latest?.generatedAt || 0);
  if (since < COOLDOWN_MS) {
    const wait = Math.ceil((COOLDOWN_MS - since) / 1000);
    return error(`${Math.round(since / 60000)} 分前に観測済みです。あと ${Math.ceil(wait / 60)} 分お待ちください。`, 429, { retryAfter: wait });
  }
  const snap = await runAiPipeline({ store, budgetMs: 9000, trigger: 'manual' });
  if (snap?.skipped) return error('別の観測が進行中です', 409);
  return json({ ok: true, generatedAt: snap.generatedAt, stats: snap.stats, tookMs: snap.tookMs }, { cache: 'no-store' });
}
