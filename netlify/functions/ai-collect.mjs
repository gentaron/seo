/**
 * ai-collect — Netlify Scheduled Function（毎時 20 分）
 * AI Pulse の観測網（19 媒体・約 45 エンドポイント）を巡回してスナップショットと台帳を更新する。
 * 実行上限 30 秒に対して予算 24 秒。本番デプロイでのみ定期起動する。
 */

import { openStore } from '../lib/store.js';
import { runAiPipeline } from '../lib/ai/pipeline.js';

export default async function handler() {
  const store = await openStore();
  const snap = await runAiPipeline({ store, budgetMs: 24_000, trigger: 'schedule' });
  console.log(
    `[ai-collect] top=${snap.top?.length ?? 0} ai=${snap.stats?.aiSignals ?? 0}/${snap.stats?.signals ?? 0} ` +
      `sources=${snap.stats?.sourcesUp ?? 0}/${snap.stats?.sourcesTotal ?? 0} took=${snap.tookMs ?? 0}ms`,
  );
  return new Response('ok');
}

export const config = {
  schedule: '20 * * * *',
};
