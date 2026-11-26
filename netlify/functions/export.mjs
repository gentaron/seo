/**
 * GET /api/export — Undercurrent と AI Pulse の全情報をまとめて書き出す
 *
 *   （既定）JSON：{ sections:[{id, group, title, body, chars}], all }
 *   ?format=md  ：Markdown 1 本（そのまま貼り付けられる）
 */

import { openStore } from '../lib/store.js';
import { KEYS } from '../lib/pipeline.js';
import { AI_KEYS } from '../lib/ai/pipeline.js';
import { buildExport } from '../lib/export.js';
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
  const out = buildExport({ ai, snap, lexicon, meta });
  if (new URL(request.url).searchParams.get('format') === 'md') {
    return new Response(out.all, {
      headers: { 'Content-Type': 'text/markdown; charset=utf-8', 'Cache-Control': 'public, max-age=60', ...CORS_HEADERS },
    });
  }
  return json({ ok: true, ...out, chars: out.all.length }, { cache: 'public, max-age=60, s-maxage=120' });
}
