/**
 * /api/trends — 日本の急上昇ワード（Google トレンド）
 *
 * デイリートレンドを優先し、失敗時はリアルタイムトレンドにフォールバックする。
 * どちらも取得できない場合は ok:false を返し、UI 側でパネルを畳む。
 */

import { fetchWithTimeout, parseGuardedJson, TTLCache, json, error, preflight } from '../lib/http.js';

const cache = new TTLCache(8, 15 * 60 * 1000);

const DAILY =
  'https://trends.google.co.jp/trends/api/dailytrends?hl=ja&tz=-540&geo=JP&ns=15';
const REALTIME =
  'https://trends.google.co.jp/trends/api/realtimetrends?hl=ja&tz=-540&geo=JP&cat=all&fi=0&fs=0&ri=300&rs=20&sort=0';

async function fetchDaily() {
  const res = await fetchWithTimeout(DAILY, { timeout: 7000, retries: 1 });
  const data = parseGuardedJson(await res.text());
  const days = data?.default?.trendingSearchesDays ?? [];
  const items = [];
  for (const day of days) {
    for (const t of day.trendingSearches ?? []) {
      items.push({
        query: t?.title?.query ?? '',
        traffic: t?.formattedTraffic ?? '',
        date: day.formattedDate ?? day.date ?? '',
        related: (t?.relatedQueries ?? []).map((r) => r.query).filter(Boolean).slice(0, 5),
        article: t?.articles?.[0]
          ? { title: t.articles[0].title, url: t.articles[0].url, source: t.articles[0].source }
          : null,
      });
    }
  }
  return items.filter((i) => i.query);
}

async function fetchRealtime() {
  const res = await fetchWithTimeout(REALTIME, { timeout: 7000, retries: 1 });
  const data = parseGuardedJson(await res.text());
  const stories = data?.storySummaries?.trendingStories ?? [];
  return stories
    .map((s) => ({
      query: (s.entityNames ?? []).join('・') || s.title || '',
      traffic: '',
      date: '',
      related: (s.entityNames ?? []).slice(0, 5),
      article: s.articles?.[0]
        ? { title: s.articles[0].articleTitle, url: s.articles[0].url, source: s.articles[0].source }
        : null,
    }))
    .filter((i) => i.query);
}

export default async function handler(request) {
  if (request.method === 'OPTIONS') return preflight();

  const cached = cache.get('jp');
  if (cached) {
    return json({ ok: true, cached: true, ...cached }, { cache: 'public, max-age=900' });
  }

  const attempts = [
    ['daily', fetchDaily],
    ['realtime', fetchRealtime],
  ];

  for (const [source, fn] of attempts) {
    try {
      const items = await fn();
      if (items.length) {
        const payload = { source, geo: 'JP', updatedAt: new Date().toISOString(), items: items.slice(0, 30) };
        cache.set('jp', payload);
        return json({ ok: true, cached: false, ...payload }, { cache: 'public, max-age=900' });
      }
    } catch {
      /* 次のソースへフォールバック */
    }
  }

  return error('急上昇ワードを取得できませんでした（提供元の仕様変更または一時的な制限）', 503);
}
