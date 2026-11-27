/**
 * GET /api/term?k=<key> — 語の詳細（台帳の履歴・用例＋外部の意味情報）
 *
 * 意味情報は無料・キー不要の 2 つから取る：
 *   - Urban Dictionary（英語スラング）
 *   - Wikipedia 要約（ja / en、語の言語に合わせて）
 */

import { openStore } from '../lib/store.js';
import { KEYS } from '../lib/pipeline.js';
import { lifeStage } from '../lib/score.js';
import { termKey } from '../lib/text.js';
import { TTLCache, json, error, preflight } from '../lib/http.js';
import { defsFor } from '../lib/defs.js';

const cache = new TTLCache(400, 6 * 60 * 60 * 1000);

export default async function handler(request) {
  if (request.method === 'OPTIONS') return preflight();
  const url = new URL(request.url);
  const key = termKey(url.searchParams.get('k') || '');
  if (!key) return error('k パラメータが必要です');

  const store = await openStore();
  const lexicon = (await store.get(KEYS.lexicon)) || {};
  const entry = lexicon[key];
  if (!entry) return error('台帳にない語です', 404);

  let defs = cache.get(key);
  if (!defs) {
    defs = (await defsFor([{ ...entry, k: key }], { store, deadline: Date.now() + 4000 }))[key] || [];
    cache.set(key, defs);
  }

  return json(
    { ok: true, entry: { ...entry, stage: lifeStage(entry) }, defs },
    { cache: 'public, max-age=300, s-maxage=900' },
  );
}
