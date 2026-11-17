/**
 * GET /api/lexicon — ネットスラング大全（観測した語の台帳）
 *
 *   ?q=検索語  ?lang=ja|en  ?stage=newborn|alive|fading|dead
 *   ?sort=recent|peak|first|alpha|slang  ?page=1  ?per=60
 *   ?format=csv  で CSV（Excel 用 BOM 付き）
 */

import { openStore } from '../lib/store.js';
import { KEYS } from '../lib/pipeline.js';
import { lifeStage } from '../lib/score.js';
import { termKey } from '../lib/text.js';
import { json, preflight } from '../lib/http.js';

const SORTS = {
  recent: (a, b) => b.last - a.last || b.peak - a.peak,
  peak: (a, b) => b.peak - a.peak || b.last - a.last,
  first: (a, b) => b.first - a.first,
  alpha: (a, b) => a.t.localeCompare(b.t, 'ja'),
  slang: (a, b) => b.slang - a.slang || b.peak - a.peak,
  runs: (a, b) => b.runs - a.runs,
};

export default async function handler(request) {
  if (request.method === 'OPTIONS') return preflight();
  const url = new URL(request.url);
  const p = url.searchParams;
  const store = await openStore();
  const lexicon = (await store.get(KEYS.lexicon)) || {};
  const now = Date.now();

  const q = termKey(p.get('q') || '');
  const lang = p.get('lang');
  const stage = p.get('stage');
  const minSlang = Number(p.get('slang') || 0);
  let rows = Object.values(lexicon).map((e) => ({
    k: e.k,
    t: e.t,
    lang: e.lang,
    first: e.first,
    last: e.last,
    peak: e.peak,
    runs: e.runs,
    slang: e.slang,
    main: e.main,
    srcs: Object.keys(e.srcs || {}),
    stage: lifeStage(e, now),
    hint: e.samples?.[0]?.x || '',
  }));
  if (q) rows = rows.filter((r) => r.k.includes(q));
  if (lang === 'ja' || lang === 'en') rows = rows.filter((r) => r.lang === lang);
  if (stage) rows = rows.filter((r) => r.stage === stage);
  if (minSlang) rows = rows.filter((r) => r.slang >= minSlang);
  rows.sort(SORTS[p.get('sort')] || SORTS.recent);

  if (p.get('format') === 'csv') {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const iso = (t) => new Date(t).toISOString();
    const lines = [
      ['語', '言語', '状態', '初観測', '最終観測', '最高スコア', '観測回数', 'スラング度', '媒体', '用例'].map(esc).join(','),
      ...rows.map((r) =>
        [r.t, r.lang, r.stage, iso(r.first), iso(r.last), r.peak, r.runs, r.slang, r.srcs.join(' '), r.hint].map(esc).join(','),
      ),
    ];
    return new Response(`﻿${lines.join('\r\n')}`, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="undercurrent-lexicon-${new Date().toISOString().slice(0, 10)}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  }

  const per = Math.min(200, Math.max(10, Number(p.get('per')) || 60));
  const page = Math.max(1, Number(p.get('page')) || 1);
  const counts = { total: 0, newborn: 0, alive: 0, fading: 0, dead: 0 };
  for (const e of Object.values(lexicon)) {
    counts.total += 1;
    counts[lifeStage(e, now)] += 1;
  }
  return json(
    { ok: true, total: rows.length, page, per, pages: Math.ceil(rows.length / per), counts, rows: rows.slice((page - 1) * per, page * per) },
    { cache: 'public, max-age=60, s-maxage=300' },
  );
}
