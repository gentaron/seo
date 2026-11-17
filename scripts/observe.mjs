/**
 * observe.mjs — ターミナルから 1 回観測して上位を表示する（保存先はローカルファイル）
 *
 *   npm run observe            # 実データ
 *   npm run observe -- --mock  # 疑似データ
 *   npm run observe -- --json  # スナップショットを JSON で出力
 */

import { openStore } from '../netlify/lib/store.js';
import { runPipeline } from '../netlify/lib/pipeline.js';

if (process.argv.includes('--mock')) {
  const { makeMockFetch } = await import('./mock-web.mjs');
  globalThis.fetch = makeMockFetch();
}

const store = await openStore();
const snap = await runPipeline({ store, budgetMs: 25_000, trigger: 'manual' });

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(snap, null, 2));
} else {
  console.log(`\n観測 ${snap.runId}  (${snap.tookMs}ms)  媒体 ${snap.stats.sourcesUp}/${snap.stats.sourcesTotal}  投稿 ${snap.stats.signals}  台帳 ${snap.stats.lexicon} 語\n`);
  for (const s of snap.sources) console.log(`  ${s.ok ? '✓' : '✗'} ${s.icon} ${s.label.padEnd(18)} ${String(s.count).padStart(4)} 件  ${s.ms}ms ${s.error ?? ''}`);
  console.log('');
  const icon = { new: '🌱', surge: '🔥', spread: '🌊', cool: '🥀', revival: '🧟', steady: '・' };
  for (const t of snap.terms.slice(0, 40)) {
    console.log(`  ${String(t.score).padStart(3)} ${icon[t.status] ?? ' '} ${t.t}  [${t.srcs.join(',')}]`);
  }
}
