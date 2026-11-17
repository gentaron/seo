/**
 * POST /api/refresh — 手動で 1 回観測する（クールダウン 15 分・全員共通）
 *
 * 同期 Function の 10 秒上限に収めるため予算は 9 秒。
 * 遅い媒体はこの回では落ちることがあるが、定時の観測（30 秒予算）で拾われる。
 */

import { openStore } from '../lib/store.js';
import { runPipeline, KEYS } from '../lib/pipeline.js';
import { json, error, preflight } from '../lib/http.js';

const COOLDOWN_MS = 15 * 60 * 1000;

export default async function handler(request) {
  if (request.method === 'OPTIONS') return preflight();
  if (request.method !== 'POST') return error('POST で呼び出してください', 405);

  const store = await openStore();
  const meta = (await store.get(KEYS.meta)) || {};
  const since = Date.now() - (meta.lastRunAt || 0);
  if (since < COOLDOWN_MS) {
    const wait = Math.ceil((COOLDOWN_MS - since) / 1000);
    return error(`直近 ${Math.round(since / 60000)} 分前に観測済みです。あと ${Math.ceil(wait / 60)} 分お待ちください。`, 429, {
      retryAfter: wait,
    });
  }
  const snap = await runPipeline({ store, budgetMs: 9000, trigger: 'manual' });
  if (snap?.skipped) return error('別の観測が進行中です', 409);
  return json({ ok: true, runId: snap.runId, stats: snap.stats, tookMs: snap.tookMs }, { cache: 'no-store' });
}
