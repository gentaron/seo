/**
 * GET /api/feed — 最新スナップショット
 *
 *   ?lang=ja|en       言語で絞り込み
 *   ?status=new|surge|spread|cool|revival
 *   ?limit=80
 *
 * スナップショットが 1 つも無い（デプロイ直後）ときだけ、同期で 1 回観測する。
 * 同期 Function は 10 秒上限なので予算 8.5 秒。間に合わなかった媒体は次回に回る。
 */

import { openStore } from '../lib/store.js';
import { runPipeline, KEYS } from '../lib/pipeline.js';
import { json, error, preflight } from '../lib/http.js';

export default async function handler(request) {
  if (request.method === 'OPTIONS') return preflight();
  const url = new URL(request.url);
  const store = await openStore();

  let snap = await store.get(KEYS.latest);
  if (!snap) {
    snap = await runPipeline({ store, budgetMs: 8500, trigger: 'bootstrap' });
    if (snap?.skipped) return error('初回観測中です。数秒後に再読み込みしてください。', 503, { retryAfter: 5 });
  }
  if (!snap?.terms) return error('スナップショットがありません', 503);

  const lang = url.searchParams.get('lang');
  const status = url.searchParams.get('status');
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 160));
  let terms = snap.terms;
  if (lang === 'ja' || lang === 'en') terms = terms.filter((t) => t.lang === lang);
  if (status) terms = terms.filter((t) => t.status === status || t.badges?.includes(status));

  const age = Math.max(0, Math.round((Date.now() - snap.generatedAt) / 1000));
  return json(
    { ...snap, terms: terms.slice(0, limit), ageSec: age, servedAt: Date.now() },
    // CDN では 2 分だけ共有キャッシュ。古くなっても再検証中は旧版を返す
    { cache: 'public, max-age=60, s-maxage=120, stale-while-revalidate=600' },
  );
}
