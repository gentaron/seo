/**
 * engines.js — サジェスト提供元の定義とレスポンス正規化
 *
 * 各エンジンは複数の候補エンドポイントを持てる（先頭から順に試し、
 * 最初にパースできたものを採用する）。1つのエンジンが落ちても
 * 他のエンジンには影響しない設計。
 */

import { fetchWithTimeout, parseGuardedJson } from './http.js';
import { ENGINE_META_MAP } from '../../public/shared/engines-meta.js';

const enc = encodeURIComponent;

/** OpenSearch 形式: ["query", ["s1","s2", ...], ...] */
function parseOpenSearch(text) {
  const data = parseGuardedJson(text);
  if (Array.isArray(data) && Array.isArray(data[1])) {
    return data[1]
      .map((v) => (Array.isArray(v) ? v[0] : v))
      .filter((v) => typeof v === 'string');
  }
  return parseLoose(data);
}

/** DuckDuckGo 形式: [{phrase:"..."}] / 汎用オブジェクト配列 */
function parseLoose(input) {
  const data = typeof input === 'string' ? parseGuardedJson(input) : input;
  const pick = (o) =>
    typeof o === 'string'
      ? o
      : (o && (o.phrase || o.value || o.suggestion || o.text || o.query || o.name || o.title)) ||
        null;

  if (Array.isArray(data)) {
    const flat = data.map(pick).filter((v) => typeof v === 'string');
    if (flat.length) return flat;
    // ネストした配列（["q", [...]] 形式など）を掘る
    for (const el of data) {
      if (Array.isArray(el)) {
        const inner = el.map(pick).filter((v) => typeof v === 'string');
        if (inner.length) return inner;
      }
    }
    return [];
  }
  if (data && typeof data === 'object') {
    for (const key of ['suggestions', 'results', 'items', 'data', 'Result', 'hits']) {
      if (Array.isArray(data[key])) {
        const v = data[key].map(pick).filter((s) => typeof s === 'string');
        if (v.length) return v;
      }
    }
  }
  return [];
}

/**
 * エンジン定義
 *  id      : APIパラメータ名
 *  label   : UI表示名
 *  group   : UIのグルーピング
 *  beta    : 提供元の仕様変更で不安定になり得るもの
 *  urls    : (q) => string[]  候補エンドポイント
 *  parse   : (text) => string[]
 */
export const ENGINES = {
  google: {
    id: 'google',
    urls: (q) => [
      `https://suggestqueries.google.com/complete/search?client=firefox&hl=ja&gl=jp&q=${enc(q)}`,
      `https://www.google.com/complete/search?client=firefox&hl=ja&gl=jp&q=${enc(q)}`,
    ],
    parse: parseOpenSearch,
  },
  youtube: {
    id: 'youtube',
    urls: (q) => [
      `https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&hl=ja&gl=jp&q=${enc(q)}`,
      `https://clients1.google.com/complete/search?client=youtube&ds=yt&hl=ja&q=${enc(q)}`,
    ],
    parse: parseOpenSearch,
  },
  google_news: {
    id: 'google_news',
    urls: (q) => [
      `https://suggestqueries.google.com/complete/search?client=firefox&ds=n&hl=ja&gl=jp&q=${enc(q)}`,
    ],
    parse: parseOpenSearch,
  },
  google_images: {
    id: 'google_images',
    urls: (q) => [
      `https://suggestqueries.google.com/complete/search?client=firefox&ds=i&hl=ja&gl=jp&q=${enc(q)}`,
    ],
    parse: parseOpenSearch,
  },
  bing: {
    id: 'bing',
    urls: (q) => [
      `https://api.bing.com/osjson.aspx?query=${enc(q)}&market=ja-JP`,
      `https://www.bing.com/AS/Suggestions?pt=page.home&mkt=ja-jp&qry=${enc(q)}&cp=1&css=0&cvid=0`,
    ],
    parse: parseOpenSearch,
  },
  duckduckgo: {
    id: 'duckduckgo',
    urls: (q) => [`https://duckduckgo.com/ac/?q=${enc(q)}&kl=jp-jp`],
    parse: (text) => parseLoose(text),
  },
  amazon: {
    id: 'amazon',
    urls: (q) => [
      `https://completion.amazon.co.jp/api/2017/suggestions?limit=11&prefix=${enc(q)}&suggestion-type=KEYWORD&page-type=Gateway&alias=aps&site-variant=desktop&client-info=amazon-search-ui&mid=A1VC38T7YXB528&lop=ja_JP&region=JP`,
      `https://completion.amazon.co.jp/search/complete?method=completion&search-alias=aps&mkt=6&q=${enc(q)}`,
    ],
    parse: (text) => {
      const data = parseGuardedJson(text);
      if (data && Array.isArray(data.suggestions)) {
        return data.suggestions.map((s) => s.value || s.suggestion).filter(Boolean);
      }
      return parseLoose(data);
    },
  },
  yahoo: {
    id: 'yahoo',
    urls: (q) => [
      `https://ff.search.yahoo.co.jp/assist?p=${enc(q)}&output=json&ei=UTF-8`,
      `https://search.yahoo.co.jp/assist?p=${enc(q)}&output=json&ei=UTF-8`,
    ],
    parse: (text) => {
      const data = parseGuardedJson(text);
      if (data && data.Result && Array.isArray(data.Result)) {
        return data.Result.map((r) => r.Query || r.query || r).filter((v) => typeof v === 'string');
      }
      return parseLoose(data);
    },
  },
};

export const ENGINE_IDS = Object.keys(ENGINES);
export const DEFAULT_ENGINE = 'google';

/** UI に渡す公開メタ情報（public/shared/engines-meta.js が単一の情報源） */
export function engineCatalog() {
  return ENGINE_IDS.map((id) => ENGINE_META_MAP[id]).filter(Boolean);
}

export function resolveEngine(id) {
  return ENGINES[id] || null;
}

/**
 * 1クエリ分のサジェストを取得。候補エンドポイントを順に試す。
 * @param {string} engineId
 * @param {string} query
 * @param {{timeout?:number}} [opts]
 * @returns {Promise<string[]>}
 */
export async function fetchSuggest(engineId, query, opts = {}) {
  const engine = resolveEngine(engineId);
  if (!engine) throw new Error(`unknown engine: ${engineId}`);
  const urls = engine.urls(query);
  let lastError;
  for (const url of urls) {
    try {
      const res = await fetchWithTimeout(url, { timeout: opts.timeout ?? 6000, retries: 0 });
      const text = await res.text();
      const list = engine.parse(text);
      if (Array.isArray(list)) {
        return list
          .map((s) => String(s).replace(/[　\s]+/g, ' ').trim())
          .filter((s) => s.length > 0)
          .slice(0, 30);
      }
    } catch (err) {
      lastError = err;
    }
  }
  if (lastError) throw lastError;
  return [];
}
