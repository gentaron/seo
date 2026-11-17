/**
 * GET /api/rss — 最新の潮流を RSS 2.0 で配信（RSS リーダー・自動化ツール用）
 *   ?lang=ja|en  ?min=40（スコア下限）
 */

import { openStore } from '../lib/store.js';
import { KEYS } from '../lib/pipeline.js';

const LABEL = { new: '🌱誕生', surge: '🔥急騰', spread: '🌊拡散', cool: '🥀失速', revival: '🧟再燃', steady: '・定着' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export default async function handler(request) {
  const url = new URL(request.url);
  const site = process.env.URL || `${url.protocol}//${url.host}`;
  const store = await openStore();
  const snap = await store.get(KEYS.latest);
  const lang = url.searchParams.get('lang');
  const min = Number(url.searchParams.get('min') || 0);
  let terms = snap?.terms ?? [];
  if (lang === 'ja' || lang === 'en') terms = terms.filter((t) => t.lang === lang);
  terms = terms.filter((t) => t.score >= min).slice(0, 50);

  const items = terms
    .map((t) => {
      const link = `${site}/?term=${encodeURIComponent(t.k)}`;
      const desc = [
        `${LABEL[t.status] || ''} スコア ${t.score} / ${t.spread} 媒体（${t.srcs.join(', ')}）`,
        ...t.samples.map((s) => `・${s.x}`),
      ].join('\n');
      return `<item><title>${esc(`${t.t}  ${LABEL[t.status] || ''}`)}</title><link>${esc(link)}</link><guid isPermaLink="false">${esc(`${t.k}@${snap.runId}`)}</guid><pubDate>${new Date(snap.generatedAt).toUTCString()}</pubDate><description>${esc(desc)}</description></item>`;
    })
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>Undercurrent — ニッチ潮流＆ネットスラング</title>
<link>${esc(site)}</link>
<description>世界中の SNS・コミュニティから、半日で入れ替わるレベルのニッチな話題と新語を観測</description>
<language>ja</language>
<lastBuildDate>${new Date(snap?.generatedAt || Date.now()).toUTCString()}</lastBuildDate>
<ttl>180</ttl>
${items}
</channel></rss>`;
  return new Response(xml, {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8', 'Cache-Control': 'public, max-age=600, s-maxage=1800' },
  });
}
