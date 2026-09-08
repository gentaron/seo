/**
 * /api/health — 各サジェスト提供元の疎通診断
 *
 * デプロイ直後や「特定エンジンだけ結果が出ない」ときに、
 * どこで失敗しているかを一目で確認するための診断エンドポイント。
 *
 * GET /api/health?q=ラーメン
 */

import { ENGINE_IDS, fetchSuggest } from '../lib/engines.js';
import { pool, json, preflight } from '../lib/http.js';

export default async function handler(request) {
  if (request.method === 'OPTIONS') return preflight();

  const url = new URL(request.url);
  const probe = (url.searchParams.get('q') || 'ラーメン').trim();

  const checks = await pool(ENGINE_IDS, 8, async (id) => {
    const started = Date.now();
    try {
      const suggestions = await fetchSuggest(id, probe, { timeout: 5000 });
      return {
        engine: id,
        ok: suggestions.length > 0,
        count: suggestions.length,
        sample: suggestions.slice(0, 3),
        ms: Date.now() - started,
      };
    } catch (err) {
      return { engine: id, ok: false, count: 0, sample: [], ms: Date.now() - started, error: err.message };
    }
  });

  const engines = checks.map((c) => (c.status === 'fulfilled' ? c.value : { engine: 'unknown', ok: false }));
  const healthy = engines.filter((e) => e.ok).length;

  return json(
    {
      ok: healthy > 0,
      probe,
      healthy,
      total: engines.length,
      runtime: `node ${process.version}`,
      checkedAt: new Date().toISOString(),
      engines,
    },
    { cache: 'no-store' },
  );
}
