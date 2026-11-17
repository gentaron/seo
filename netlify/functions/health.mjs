/**
 * GET /api/health — 各媒体の疎通診断（保存はしない）
 *   ?src=reddit,misskey で対象を絞れる
 */

import { collectSignals } from '../lib/pipeline.js';
import { json, preflight } from '../lib/http.js';

export default async function handler(request) {
  if (request.method === 'OPTIONS') return preflight();
  const url = new URL(request.url);
  const only = url.searchParams.get('src')?.split(',').filter(Boolean);
  const reports = await collectSignals({ deadline: Date.now() + 8500, only });
  const sources = reports.map(({ signals, ...r }) => ({ ...r, sample: signals.slice(0, 3).map((s) => s.text) }));
  const healthy = sources.filter((s) => s.ok).length;
  return json(
    { ok: healthy > 0, healthy, total: sources.length, runtime: `node ${process.version}`, checkedAt: new Date().toISOString(), sources },
    { cache: 'no-store' },
  );
}
