/**
 * defs.js — 語の “意味” を外部の無料辞書から取る（Urban Dictionary／Wikipedia 要約）
 *
 * term.mjs（1 語の詳細）と allcopy（全件の書き出し）で共有する。
 * 取得結果は Blobs（defs-cache）に 24 時間保存し、全件書き出しでも外部へ何度も問い合わせない。
 */

import { stripHtml } from './text.js';
import { fetchWithTimeout, pool } from './http.js';

export const DEFS_KEY = 'defs-cache';
const TTL = 24 * 3.6e6;
const MAX_ENTRIES = 1500;

async function urban(term, timeout) {
  const res = await fetchWithTimeout(`https://api.urbandictionary.com/v0/define?term=${encodeURIComponent(term)}`, { timeout, retries: 0 });
  const list = (await res.json())?.list ?? [];
  const best = list.sort((a, b) => (b.thumbs_up - b.thumbs_down) - (a.thumbs_up - a.thumbs_down))[0];
  if (!best) return null;
  return {
    source: 'Urban Dictionary',
    text: stripHtml(String(best.definition || '').replace(/[[\]]/g, '')).slice(0, 600),
    example: stripHtml(String(best.example || '').replace(/[[\]]/g, '')).slice(0, 300),
    url: best.permalink,
    votes: best.thumbs_up,
  };
}

async function wiki(term, lang, timeout) {
  const res = await fetchWithTimeout(
    `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(term.replace(/ /g, '_'))}?redirect=true`,
    { timeout, retries: 0 },
  );
  const d = await res.json();
  if (!d?.extract || d.type === 'disambiguation') return null;
  return { source: `Wikipedia (${lang})`, text: d.extract.slice(0, 600), url: d.content_urls?.desktop?.page };
}

/** 1 語の意味（失敗した辞書は黙って飛ばす） */
export async function fetchDefs(entry, { timeout = 3500 } = {}) {
  const jobs = entry.lang === 'ja' ? [wiki(entry.t, 'ja', timeout)] : [urban(entry.t, timeout), wiki(entry.t, 'en', timeout)];
  const settled = await Promise.allSettled(jobs);
  return settled.filter((s) => s.status === 'fulfilled' && s.value).map((s) => s.value);
}

/**
 * 複数語の意味をまとめて用意する（キャッシュ優先・締切つき）
 * @param {Array<{k:string,t:string,lang:string}>} entries
 * @returns {Promise<Record<string, Array<object>>>}  k → defs（締切に間に合わなかった語は含まれない）
 */
export async function defsFor(entries, { store, deadline = Date.now() + 6000, concurrency = 8 } = {}) {
  const now = Date.now();
  const cache = (store && (await store.get(DEFS_KEY).catch(() => null))) || {};
  const out = {};
  const missing = [];
  for (const e of entries) {
    const hit = cache[e.k];
    if (hit && now - hit.at < TTL) out[e.k] = hit.defs;
    else missing.push(e);
  }
  let changed = false;
  await pool(missing, concurrency, async (e) => {
    const left = deadline - Date.now();
    if (left < 800) return;
    const defs = await fetchDefs(e, { timeout: Math.min(3500, left - 300) });
    out[e.k] = defs;
    cache[e.k] = { at: Date.now(), defs };
    changed = true;
  });
  if (changed && store) {
    const keys = Object.keys(cache);
    if (keys.length > MAX_ENTRIES) {
      keys.sort((a, b) => cache[a].at - cache[b].at);
      for (const k of keys.slice(0, keys.length - MAX_ENTRIES)) delete cache[k];
    }
    await store.set(DEFS_KEY, cache).catch(() => {});
  }
  return out;
}
