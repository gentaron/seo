/**
 * collect — Netlify Scheduled Function（無料プランで利用可）
 * 3 時間ごとに全媒体を巡回してスナップショットと語彙台帳を更新する。
 * Scheduled Function の実行上限は 30 秒なので、予算は 24 秒に設定。
 *
 * ※ スケジュール関数は本番（Published deploy）でのみ定期起動する。
 *   手動で回したいときは POST /api/refresh を使う。
 */

import { openStore } from '../lib/store.js';
import { runPipeline } from '../lib/pipeline.js';

export default async function handler() {
  const store = await openStore();
  const snap = await runPipeline({ store, budgetMs: 24_000, trigger: 'schedule' });
  console.log(
    `[collect] terms=${snap.terms?.length ?? 0} signals=${snap.stats?.signals ?? 0} ` +
      `sources=${snap.stats?.sourcesUp ?? 0}/${snap.stats?.sourcesTotal ?? 0} took=${snap.tookMs ?? 0}ms`,
  );
  return new Response('ok');
}

export const config = {
  schedule: '0 */3 * * *',
};
