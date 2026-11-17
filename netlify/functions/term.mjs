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
import { termKey, stripHtml } from '../lib/text.js';
import { fetchWithTimeout, TTLCache, json, error, preflight } from '../lib/http.js';

const cache = new TTLCache(400, 6 * 60 * 60 * 1000);

async function urban(term) {
  const res = await fetchWithTimeout(`https://api.urbandictionary.com/v0/define?term=${encodeURIComponent(term)}`, { timeout: 3500, retries: 0 });
  const list = (await res.json())?.list ?? [];
  const best = list.sort((a, b) => (b.thumbs_up - b.thumbs_down) - (a.thumbs_up - a.thumbs_down))[0];
  if (!best) return null;
  return {
    source: 'Urban Dictionary',
    text: stripHtml(best.definition.replace(/[[\]]/g, '')).slice(0, 600),
    example: stripHtml(String(best.example || '').replace(/[[\]]/g, '')).slice(0, 300),
    url: best.permalink,
    votes: best.thumbs_up,
  };
}

async function wiki(term, lang) {
  const res = await fetchWithTimeout(
    `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(term.replace(/ /g, '_'))}?redirect=true`,
    { timeout: 3500, retries: 0 },
  );
  const d = await res.json();
  if (!d?.extract || d.type === 'disambiguation') return null;
  return { source: `Wikipedia (${lang})`, text: d.extract.slice(0, 600), url: d.content_urls?.desktop?.page };
}

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
    const jobs = entry.lang === 'ja' ? [wiki(entry.t, 'ja')] : [urban(entry.t), wiki(entry.t, 'en')];
    const settled = await Promise.allSettled(jobs);
    defs = settled.filter((s) => s.status === 'fulfilled' && s.value).map((s) => s.value);
    cache.set(key, defs);
  }

  return json(
    { ok: true, entry: { ...entry, stage: lifeStage(entry) }, defs },
    { cache: 'public, max-age=300, s-maxage=900' },
  );
}
