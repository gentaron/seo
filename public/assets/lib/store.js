/**
 * store.js — アプリケーション状態と集計ロジック
 *
 * DOM に依存しない純粋なデータ層。ここでサジェストを集計し、
 * 絞り込み・並び替え済みの配列を View に渡す。
 */

import { keyOf, normalize, scoreOf, groupLabel, cooccurrence } from '../../shared/text.js';
import { DEFAULT_MODES } from '../../shared/expand.js';
import { DEFAULT_ENGINES } from '../../shared/engines-meta.js';

const LS_KEYS = {
  favorites: 'sr.favorites.v1',
  history: 'sr.history.v1',
  settings: 'sr.settings.v1',
};

function readLS(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeLS(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* プライベートモード等では黙って諦める */
  }
}

export function createStore() {
  const settings = readLS(LS_KEYS.settings, {});

  const state = {
    keyword: '',
    engines: Array.isArray(settings.engines) && settings.engines.length ? settings.engines : [...DEFAULT_ENGINES],
    modes: Array.isArray(settings.modes) && settings.modes.length ? settings.modes : [...DEFAULT_MODES],
    theme: settings.theme || 'dark',
    view: settings.view || 'list',
    sort: settings.sort || 'score',
    filter: '',
    status: 'idle', // idle | running | done | error
    progress: { done: 0, total: 0 },
    startedAt: 0,
    elapsedMs: 0,
    selected: null,
    /** @type {Map<string, object>} 正規化キー → 集計結果 */
    items: new Map(),
    /** 取得済みクエリ数（掛け合わせ側） */
    queriesDone: 0,
    failures: [],
    favorites: new Set(readLS(LS_KEYS.favorites, [])),
    history: readLS(LS_KEYS.history, []),
    trends: null,
  };

  const listeners = new Set();
  const emit = () => listeners.forEach((fn) => fn(state));

  function persistSettings() {
    writeLS(LS_KEYS.settings, {
      engines: state.engines,
      modes: state.modes,
      theme: state.theme,
      view: state.view,
      sort: state.sort,
    });
  }

  /** 探索開始時のリセット */
  function beginRun(keyword) {
    state.keyword = normalize(keyword);
    state.items = new Map();
    state.failures = [];
    state.queriesDone = 0;
    state.selected = null;
    state.status = 'running';
    state.progress = { done: 0, total: 0 };
    state.startedAt = Date.now();
    state.elapsedMs = 0;
    emit();
  }

  /**
   * 1バッチ分のレスポンスを取り込む。
   * @param {{results:Array<{engine:string, query:string, suggestions:string[]}>}} payload
   */
  function ingest(payload) {
    const seedKey = keyOf(state.keyword);
    for (const row of payload.results || []) {
      state.queriesDone += 1;
      row.suggestions.forEach((phrase, rank) => {
        const text = normalize(phrase);
        const key = keyOf(text);
        if (!key) return;
        let item = state.items.get(key);
        if (!item) {
          item = {
            key,
            phrase: text,
            hits: 0,
            queries: new Set(),
            engines: new Set(),
            ranks: {},
            bestRank: 99,
            isSeed: key === seedKey,
            score: 0,
            group: groupLabel(text, state.keyword),
            length: [...text].length,
            words: text.split(' ').filter(Boolean).length,
            addedAt: Date.now(),
          };
          state.items.set(key, item);
        }
        if (!item.queries.has(row.query)) {
          item.queries.add(row.query);
          item.hits += 1;
        }
        item.engines.add(row.engine);
        const prev = item.ranks[row.engine];
        if (prev === undefined || rank < prev) item.ranks[row.engine] = rank;
        if (rank < item.bestRank) item.bestRank = rank;
      });
    }
    rescore();
    emit();
  }

  /** 全アイテムのスコアを再計算 */
  function rescore() {
    let maxHits = 1;
    for (const item of state.items.values()) maxHits = Math.max(maxHits, item.hits);
    const engineCount = state.engines.length;
    for (const item of state.items.values()) {
      item.score = scoreOf(
        { hits: item.hits, engines: item.engines.size, bestRank: item.bestRank },
        { maxHits, engineCount },
      );
    }
  }

  function setProgress(p) {
    state.progress = p;
    state.elapsedMs = Date.now() - state.startedAt;
    emit();
  }

  function finishRun(result) {
    state.status = 'done';
    state.elapsedMs = Date.now() - state.startedAt;
    if (result?.failures) state.failures = result.failures;
    if (state.keyword) pushHistory(state.keyword);
    emit();
  }

  function failRun(message) {
    state.status = 'error';
    state.failures = [{ reason: message }];
    emit();
  }

  function pushHistory(keyword) {
    const entry = { keyword, at: Date.now(), count: state.items.size };
    state.history = [entry, ...state.history.filter((h) => h.keyword !== keyword)].slice(0, 24);
    writeLS(LS_KEYS.history, state.history);
  }

  function clearHistory() {
    state.history = [];
    writeLS(LS_KEYS.history, state.history);
    emit();
  }

  function toggleFavorite(phrase) {
    if (state.favorites.has(phrase)) state.favorites.delete(phrase);
    else state.favorites.add(phrase);
    writeLS(LS_KEYS.favorites, [...state.favorites]);
    emit();
  }

  function clearFavorites() {
    state.favorites.clear();
    writeLS(LS_KEYS.favorites, []);
    emit();
  }

  function set(patch, { persist = false } = {}) {
    Object.assign(state, patch);
    if (persist) persistSettings();
    emit();
  }

  /** 絞り込み・並び替え済みの配列を返す */
  function visibleItems() {
    const needle = keyOf(state.filter);
    let list = [...state.items.values()];
    if (needle) list = list.filter((i) => i.key.includes(needle));

    const collator = new Intl.Collator('ja');
    const sorters = {
      score: (a, b) => b.score - a.score || b.hits - a.hits || collator.compare(a.phrase, b.phrase),
      hits: (a, b) => b.hits - a.hits || b.score - a.score,
      rank: (a, b) => a.bestRank - b.bestRank || b.score - a.score,
      alpha: (a, b) => collator.compare(a.phrase, b.phrase),
      length: (a, b) => a.length - b.length || collator.compare(a.phrase, b.phrase),
    };
    list.sort(sorters[state.sort] || sorters.score);
    return list;
  }

  /** グループ表示用のまとまり */
  function groupedItems() {
    const groups = new Map();
    for (const item of visibleItems()) {
      const g = item.group || 'その他';
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(item);
    }
    return [...groups.entries()]
      .map(([label, items]) => ({
        label,
        items,
        score: items.reduce((sum, i) => sum + i.score, 0),
      }))
      .sort((a, b) => b.items.length - a.items.length || b.score - a.score);
  }

  /** 共起語 */
  function cloudItems(limit = 60) {
    return cooccurrence(
      visibleItems().map((i) => i.phrase),
      state.keyword,
      limit,
    );
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  return {
    state,
    subscribe,
    beginRun,
    ingest,
    setProgress,
    finishRun,
    failRun,
    toggleFavorite,
    clearFavorites,
    clearHistory,
    set,
    visibleItems,
    groupedItems,
    cloudItems,
    emit,
  };
}
