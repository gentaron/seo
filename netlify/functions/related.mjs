/**
 * /api/related — 選択キーワードの背景情報（日本語版 Wikipedia）
 *
 * サジェストだけでは分からない「そのキーワードが何なのか」「隣接概念は何か」を
 * 補うための軽量エンドポイント。MediaWiki の公開 API のみを使用する。
 *
 * GET /api/related?q=転職エージェント
 */

import { fetchWithTimeout, TTLCache, json, error, preflight } from '../lib/http.js';

const cache = new TTLCache(500, 30 * 60 * 1000);
const API = 'https://ja.wikipedia.org/w/api.php';
const REST = 'https://ja.wikipedia.org/api/rest_v1/page/summary/';

async function openSearch(q) {
  const url = `${API}?action=opensearch&format=json&origin=*&limit=8&namespace=0&search=${encodeURIComponent(q)}`;
  const res = await fetchWithTimeout(url, { timeout: 5000 });
  const data = await res.json();
  const titles = Array.isArray(data?.[1]) ? data[1] : [];
  const links = Array.isArray(data?.[3]) ? data[3] : [];
  return titles.map((title, i) => ({ title, url: links[i] || '' }));
}

async function summaryOf(title) {
  const res = await fetchWithTimeout(REST + encodeURIComponent(title), { timeout: 5000 });
  const data = await res.json();
  return {
    title: data.title ?? title,
    extract: data.extract ?? '',
    url: data?.content_urls?.desktop?.page ?? '',
    thumbnail: data?.thumbnail?.source ?? null,
  };
}

/** 記事内リンク（＝概念的に隣接する語）を取得 */
async function outLinks(title) {
  const url = `${API}?action=query&format=json&origin=*&prop=links&pllimit=40&plnamespace=0&titles=${encodeURIComponent(title)}`;
  const res = await fetchWithTimeout(url, { timeout: 5000 });
  const data = await res.json();
  const pages = data?.query?.pages ?? {};
  const first = Object.values(pages)[0];
  return (first?.links ?? []).map((l) => l.title).filter(Boolean).slice(0, 30);
}

export default async function handler(request) {
  if (request.method === 'OPTIONS') return preflight();

  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim();
  if (!q) return error('パラメータ q（キーワード）が必要です', 400);

  const cached = cache.get(q);
  if (cached) return json({ ok: true, cached: true, ...cached }, { cache: 'public, max-age=1800' });

  try {
    const candidates = await openSearch(q);
    if (!candidates.length) {
      const payload = { query: q, found: false, candidates: [], summary: null, links: [] };
      cache.set(q, payload);
      return json({ ok: true, cached: false, ...payload }, { cache: 'public, max-age=1800' });
    }

    const head = candidates[0].title;
    const [summary, links] = await Promise.all([
      summaryOf(head).catch(() => null),
      outLinks(head).catch(() => []),
    ]);

    const payload = { query: q, found: true, candidates, summary, links };
    cache.set(q, payload);
    return json({ ok: true, cached: false, ...payload }, { cache: 'public, max-age=1800' });
  } catch (err) {
    return error(`関連情報を取得できませんでした: ${err.message}`, 502);
  }
}
