/**
 * GET /api/allcopy — オールコピー：重要情報レーダー・AI Pulse・Undercurrent の全項目を詳細まで書き出す
 *
 *   （既定）JSON：{ groups:[{id,label,note,items:[{id,title,meta,md}],md,chars}], all, chars }
 *   ?format=md  ：Markdown 1 本
 *
 * SNS トレンドの「意味・背景」は Urban Dictionary／Wikipedia から取る（24 時間キャッシュ、締切 6 秒）。
 * 締切に間に合わなかった語は意味なしで返し、次回以降キャッシュから補われる。
 */

import { openStore } from '../lib/store.js';
import { KEYS } from '../lib/pipeline.js';
import { AI_KEYS } from '../lib/ai/pipeline.js';
import { buildAllCopy } from '../lib/allcopy.js';
import { defsFor, DEFS_KEY } from '../lib/defs.js';
import { json, error, preflight, CORS_HEADERS } from '../lib/http.js';

export default async function handler(request) {
  if (request.method === 'OPTIONS') return preflight();
  if (request.method !== 'GET') return error('GET only', 405);
  const store = await openStore();
  const [ai, snap, lexicon, meta] = await Promise.all([
    store.get(AI_KEYS.latest),
    store.get(KEYS.latest),
    store.get(KEYS.lexicon),
    store.get(KEYS.meta),
  ]);
  const terms = (snap?.terms || []).map((t) => ({ k: t.k, t: t.t, lang: t.lang }));
  const fresh = await defsFor(terms, { store, deadline: Date.now() + 6000 });
  const cached = (await store.get(DEFS_KEY).catch(() => null)) || {};
  const defs = { ...Object.fromEntries(Object.entries(cached).map(([k, v]) => [k, v.defs])), ...fresh };

  const out = buildAllCopy({ ai, snap, lexicon, meta, defs });
  if (new URL(request.url).searchParams.get('format') === 'md') {
    return new Response(out.all, {
      headers: { 'Content-Type': 'text/markdown; charset=utf-8', 'Cache-Control': 'public, max-age=60', ...CORS_HEADERS },
    });
  }
  return json({ ok: true, ...out, chars: out.all.length }, { cache: 'public, max-age=60, s-maxage=120' });
}
