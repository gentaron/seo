/**
 * app.js — エントリポイント
 *
 * 状態(store) → 描画(views) → 通信(api) を束ね、イベント委譲で操作を受ける。
 * フレームワークは使わない。初期表示を最速にすることを優先している。
 */

import { createStore } from './lib/store.js';
import { runSuggest, fetchTrends, fetchRelated } from './lib/api.js';
import * as V from './lib/views.js';
import { MODE_IDS, DEFAULT_MODES, buildQueries } from '../shared/expand.js';
import { ENGINE_META } from '../shared/engines-meta.js';
import { toDelimited, keyOf } from '../shared/text.js';

const $ = (sel) => document.querySelector(sel);

const el = {
  form: $('#search-form'),
  keyword: $('#keyword'),
  clearKeyword: $('#clear-keyword'),
  run: $('#run'),
  cancel: $('#cancel'),
  engineChips: $('#engine-chips'),
  modeChips: $('#mode-chips'),
  estimate: $('#estimate'),
  presetFull: $('#preset-full'),
  presetQuick: $('#preset-quick'),
  progress: $('#progress'),
  progressFill: $('#progress-fill'),
  progressText: $('#progress-text'),
  resultsBody: $('#results-body'),
  emptyState: $('#empty-state'),
  stats: $('#stats'),
  filter: $('#filter-text'),
  sort: $('#sort'),
  segmented: $('.segmented'),
  copyAll: $('#copy-all'),
  exportCsv: $('#export-csv'),
  exportJson: $('#export-json'),
  detailBody: $('#detail-body'),
  trendsBody: $('#trends-body'),
  trendsReload: $('#trends-reload'),
  favBody: $('#fav-body'),
  favCount: $('#fav-count'),
  favClear: $('#fav-clear'),
  historyBody: $('#history-body'),
  historyClear: $('#history-clear'),
  historyList: $('#history-list'),
  samples: $('#samples'),
  themeToggle: $('#theme-toggle'),
  helpToggle: $('#help-toggle'),
  helpModal: $('#help-modal'),
  toast: $('#toast'),
  buildInfo: $('#build-info'),
};

const store = createStore();
const { state } = store;

let abortController = null;
let renderQueued = false;
let listLimit = V.PAGE_SIZE;
/** 描画済み内容の署名。変化していない領域は再描画しない（フォーカス保持と負荷軽減） */
const sig = { chips: '', fav: '', history: '' };
const relatedCache = new Map();
let relatedToken = 0;

const SAMPLES = ['転職エージェント', 'ふるさと納税', '生成AI 活用', '副業 確定申告', '一人暮らし 家電', '英会話 アプリ'];

/* ------------------------------------------------------------------ *
 * 描画
 * ------------------------------------------------------------------ */

function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    render();
  });
}

function render() {
  V.renderProgress(
    { wrap: el.progress, fill: el.progressFill, text: el.progressText },
    state,
  );

  const hasItems = state.items.size > 0;
  el.emptyState.hidden = hasItems;
  if (hasItems) {
    V.renderResults(el.resultsBody, store, listLimit);
    V.renderStats(el.stats, state, store.visibleItems());
  } else if (state.status !== 'running') {
    el.resultsBody.innerHTML = '';
    el.resultsBody.appendChild(el.emptyState);
    el.emptyState.hidden = false;
    el.stats.innerHTML = '';
  }

  const favSig = [...state.favorites].join('\u0001');
  if (favSig !== sig.fav) {
    V.renderFavorites(el.favBody, el.favCount, state.favorites);
    sig.fav = favSig;
  }

  const historySig = state.history.map((h) => `${h.keyword}:${h.count}`).join('\u0001');
  if (historySig !== sig.history) {
    V.renderHistory(el.historyBody, state.history, el.historyList);
    sig.history = historySig;
  }

  const chipSig = `${state.engines.join(',')}|${state.modes.join(',')}|${el.keyword.value.trim()}`;
  if (chipSig !== sig.chips) {
    V.renderEngineChips(el.engineChips, state.engines);
    V.renderModeChips(el.modeChips, state.modes, state.keyword || el.keyword.value.trim());
    sig.chips = chipSig;
  }
  updateEstimate();

  const item = state.selected ? state.items.get(state.selected) : null;
  V.renderDetail(el.detailBody, state, item, item ? relatedCache.get(item.phrase) ?? null : null);

  el.run.disabled = state.status === 'running';
  el.cancel.hidden = state.status !== 'running';
  el.clearKeyword.hidden = !el.keyword.value;
  document.documentElement.dataset.theme = state.theme;
}

function updateEstimate() {
  const kw = el.keyword.value.trim() || 'キーワード';
  const count = buildQueries(kw, state.modes).length;
  const engines = Math.max(1, state.engines.length);
  const requests = Math.ceil(count / Math.max(6, Math.round(24 / engines)));
  const upstream = count * engines;
  el.estimate.textContent = `推定 ${count} クエリ × ${engines} 媒体 ／ ${requests} リクエスト`;
  // 取得量が多いと提供元側で絞られやすくなるため、事前に警告する
  const heavy = upstream > 900;
  el.estimate.style.color = heavy ? 'var(--warn)' : '';
  el.estimate.title = heavy
    ? `提供元へのアクセスが ${upstream} 回に達します。掛け合わせか媒体を減らすと安定します。`
    : `提供元へのアクセス ${upstream} 回`;
}

/** チップは再描画で作り直されるため、操作後にフォーカスを戻す */
function refocusChip(selector) {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => document.querySelector(selector)?.focus());
  });
}

function toast(message, ms = 2200) {
  el.toast.textContent = message;
  el.toast.hidden = false;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    el.toast.hidden = true;
  }, ms);
}

/* ------------------------------------------------------------------ *
 * 探索の実行
 * ------------------------------------------------------------------ */

async function run(keyword) {
  const kw = (keyword ?? el.keyword.value).trim();
  if (!kw) {
    el.keyword.focus();
    toast('キーワードを入力してください');
    return;
  }
  if (!state.engines.length) {
    toast('提供元を1つ以上選んでください');
    return;
  }
  if (!state.modes.length) {
    store.set({ modes: [...DEFAULT_MODES] }, { persist: true });
  }

  abortController?.abort();
  abortController = new AbortController();

  el.keyword.value = kw;
  listLimit = V.PAGE_SIZE;
  store.beginRun(kw);
  syncUrl();

  try {
    const result = await runSuggest({
      keyword: kw,
      modes: state.modes,
      engines: state.engines,
      signal: abortController.signal,
      onBatch: (payload) => store.ingest(payload),
      onProgress: (p) => store.setProgress(p),
    });
    store.finishRun(result);
    if (!state.items.size) {
      toast('結果が0件でした。/api/health で提供元の状態を確認できます');
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      store.set({ status: 'done' });
      return;
    }
    store.failRun(err.message);
    toast(`取得に失敗しました: ${err.message}`);
  }
}

function cancelRun() {
  abortController?.abort();
  store.set({ status: 'done' });
  toast('探索を中止しました');
}

/* ------------------------------------------------------------------ *
 * 選択と詳細
 * ------------------------------------------------------------------ */

async function select(key) {
  const item = state.items.get(key);
  if (!item) return;
  store.set({ selected: key });

  if (relatedCache.has(item.phrase)) return;
  const token = ++relatedToken;
  try {
    const data = await fetchRelated(item.phrase);
    relatedCache.set(item.phrase, data);
    if (token === relatedToken && state.selected === key) scheduleRender();
  } catch {
    relatedCache.set(item.phrase, { ok: false, found: false });
  }
}

function moveSelection(delta) {
  const list = store.visibleItems();
  if (!list.length) return;
  const idx = list.findIndex((i) => i.key === state.selected);
  const next = list[Math.min(list.length - 1, Math.max(0, idx + delta))] || list[0];
  select(next.key);
  const node = el.resultsBody.querySelector(`[data-key="${CSS.escape(next.key)}"]`);
  node?.scrollIntoView({ block: 'nearest' });
}

/* ------------------------------------------------------------------ *
 * 書き出し
 * ------------------------------------------------------------------ */

function exportRows() {
  return store.visibleItems().map((i) => ({
    keyword: i.phrase,
    score: i.score,
    hits: i.hits,
    bestRank: i.bestRank + 1,
    engines: [...i.engines].join('|'),
    group: i.group,
    length: i.length,
    words: i.words,
    favorite: state.favorites.has(i.phrase) ? 1 : 0,
  }));
}

function download(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function fileStem() {
  const date = new Date().toISOString().slice(0, 10);
  const kw = (state.keyword || 'keywords').replace(/[\\/:*?"<>|\s]+/g, '_');
  return `suggest-radar_${kw}_${date}`;
}

async function copyText(text, label) {
  try {
    await navigator.clipboard.writeText(text);
    toast(label);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    toast(label);
  }
}

/* ------------------------------------------------------------------ *
 * URL 同期
 * ------------------------------------------------------------------ */

function syncUrl() {
  const params = new URLSearchParams();
  if (state.keyword) params.set('q', state.keyword);
  params.set('e', state.engines.join(','));
  params.set('m', state.modes.join(','));
  history.replaceState(null, '', `?${params.toString()}`);
}

function readUrl() {
  const params = new URLSearchParams(location.search);
  const engines = (params.get('e') || '').split(',').filter((e) => ENGINE_META.some((m) => m.id === e));
  const modes = (params.get('m') || '').split(',').filter((m) => MODE_IDS.includes(m));
  if (engines.length) state.engines = engines;
  if (modes.length) state.modes = modes;
  return params.get('q') || '';
}

/* ------------------------------------------------------------------ *
 * イベント
 * ------------------------------------------------------------------ */

el.form.addEventListener('submit', (e) => {
  e.preventDefault();
  run();
});

el.cancel.addEventListener('click', cancelRun);

el.keyword.addEventListener('input', () => {
  el.clearKeyword.hidden = !el.keyword.value;
  updateEstimate();
});

el.clearKeyword.addEventListener('click', () => {
  el.keyword.value = '';
  el.keyword.focus();
  el.clearKeyword.hidden = true;
  updateEstimate();
});

el.engineChips.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-engine]');
  if (!btn) return;
  const id = btn.dataset.engine;
  const next = state.engines.includes(id)
    ? state.engines.filter((x) => x !== id)
    : [...state.engines, id];
  if (!next.length) {
    toast('提供元は最低1つ必要です');
    return;
  }
  store.set({ engines: next }, { persist: true });
  syncUrl();
  refocusChip(`[data-engine="${id}"]`);
});

el.modeChips.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-mode]');
  if (!btn) return;
  const id = btn.dataset.mode;
  const next = state.modes.includes(id) ? state.modes.filter((x) => x !== id) : [...state.modes, id];
  store.set({ modes: next.length ? next : ['base'] }, { persist: true });
  syncUrl();
  refocusChip(`[data-mode="${id}"]`);
});

el.presetFull.addEventListener('click', () => {
  store.set({ modes: [...MODE_IDS] }, { persist: true });
  syncUrl();
});

el.presetQuick.addEventListener('click', () => {
  store.set({ modes: ['base', 'gojuon', 'question'] }, { persist: true });
  syncUrl();
});

let filterTimer = 0;
el.filter.addEventListener('input', () => {
  clearTimeout(filterTimer);
  filterTimer = setTimeout(() => {
    listLimit = V.PAGE_SIZE;
    store.set({ filter: el.filter.value });
  }, 140);
});

el.sort.addEventListener('change', () => store.set({ sort: el.sort.value }, { persist: true }));

el.segmented.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-view]');
  if (!btn) return;
  [...el.segmented.children].forEach((c) => c.classList.toggle('is-active', c === btn));
  store.set({ view: btn.dataset.view }, { persist: true });
});

/** 結果一覧（行・ツール・共起語・さらに表示） */
el.resultsBody.addEventListener('click', (e) => {
  const more = e.target.closest('[data-action="more"]');
  if (more) {
    listLimit += V.PAGE_SIZE;
    scheduleRender();
    return;
  }

  const word = e.target.closest('[data-word]');
  if (word) {
    el.filter.value = word.dataset.word;
    store.set({ filter: word.dataset.word, view: 'list' }, { persist: true });
    [...el.segmented.children].forEach((c) => c.classList.toggle('is-active', c.dataset.view === 'list'));
    return;
  }

  const row = e.target.closest('[data-key]');
  if (!row) return;
  const item = state.items.get(row.dataset.key);
  if (!item) return;

  const action = e.target.closest('[data-action]')?.dataset.action;
  if (action === 'fav') {
    store.toggleFavorite(item.phrase);
    return;
  }
  if (action === 'copy') {
    copyText(item.phrase, 'コピーしました');
    return;
  }
  if (action === 'google') {
    window.open(`https://www.google.com/search?q=${encodeURIComponent(item.phrase)}&hl=ja`, '_blank', 'noopener');
    return;
  }
  if (action === 'drill') {
    run(item.phrase);
    return;
  }
  select(item.key);
});

/** サイドパネル・詳細パネルからの再探索 */
document.addEventListener('click', (e) => {
  const seed = e.target.closest('[data-seed]');
  if (!seed) return;
  const kw = seed.dataset.seed;
  el.keyword.value = kw;
  run(kw);
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

el.copyAll.addEventListener('click', () => {
  const list = store.visibleItems();
  if (!list.length) return toast('コピーする結果がありません');
  copyText(list.map((i) => i.phrase).join('\n'), `${list.length} 件をコピーしました`);
});

el.exportCsv.addEventListener('click', () => {
  const rows = exportRows();
  if (!rows.length) return toast('書き出す結果がありません');
  const headers = [
    { key: 'keyword', label: 'キーワード' },
    { key: 'score', label: 'スコア' },
    { key: 'hits', label: '出現クエリ数' },
    { key: 'bestRank', label: '最高順位' },
    { key: 'engines', label: '提供元' },
    { key: 'group', label: 'グループ' },
    { key: 'length', label: '文字数' },
    { key: 'words', label: '語数' },
    { key: 'favorite', label: 'お気に入り' },
  ];
  download(`${fileStem()}.csv`, toDelimited(rows, headers, ','), 'text/csv;charset=utf-8');
  toast(`${rows.length} 件を CSV に書き出しました`);
});

el.exportJson.addEventListener('click', () => {
  const rows = exportRows();
  if (!rows.length) return toast('書き出す結果がありません');
  const payload = {
    keyword: state.keyword,
    engines: state.engines,
    modes: state.modes,
    exportedAt: new Date().toISOString(),
    total: rows.length,
    items: rows,
  };
  download(`${fileStem()}.json`, JSON.stringify(payload, null, 2), 'application/json');
  toast(`${rows.length} 件を JSON に書き出しました`);
});

el.favClear.addEventListener('click', () => {
  if (state.favorites.size && confirm('お気に入りをすべて削除しますか？')) store.clearFavorites();
});

el.historyClear.addEventListener('click', () => {
  if (state.history.length && confirm('履歴をすべて削除しますか？')) store.clearHistory();
});

el.trendsReload.addEventListener('click', () => loadTrends(true));

el.themeToggle.addEventListener('click', () => {
  store.set({ theme: state.theme === 'dark' ? 'light' : 'dark' }, { persist: true });
});

el.helpToggle.addEventListener('click', () => el.helpModal.showModal());

/** キーボードショートカット */
document.addEventListener('keydown', (e) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
  if (e.key === '/' && !typing) {
    e.preventDefault();
    el.keyword.focus();
    el.keyword.select();
    return;
  }
  if (e.key === 'Escape') {
    if (el.filter.value) {
      el.filter.value = '';
      store.set({ filter: '' });
    }
    return;
  }
  if (typing) return;

  const key = e.key.toLowerCase();
  if (key === 'j') { e.preventDefault(); moveSelection(1); }
  else if (key === 'k') { e.preventDefault(); moveSelection(-1); }
  else if (key === 'f' && state.selected) { store.toggleFavorite(state.items.get(state.selected).phrase); }
  else if (key === 'd' && state.selected) { run(state.items.get(state.selected).phrase); }
  else if (key === 'c') { el.copyAll.click(); }
  else if (key === 't') { el.themeToggle.click(); }
  else if (key === '?') { el.helpModal.showModal(); }
});

/* ------------------------------------------------------------------ *
 * 初期化
 * ------------------------------------------------------------------ */

async function loadTrends(force = false) {
  if (state.trends && !force) return;
  el.trendsBody.innerHTML = '<p class="muted">読み込み中…</p>';
  try {
    const data = await fetchTrends();
    store.set({ trends: data });
    V.renderTrends(el.trendsBody, data);
  } catch (err) {
    V.renderTrends(el.trendsBody, { ok: false, error: err.message });
  }
}

async function loadBuildInfo() {
  try {
    const res = await fetch('/build-info.json', { cache: 'no-cache' });
    if (!res.ok) return;
    const info = await res.json();
    el.buildInfo.textContent = `build ${info.commit} / ${new Date(info.builtAt).toLocaleDateString('ja-JP')}`;
  } catch {
    /* 表示できなくても支障はない */
  }
}

function boot() {
  const q = readUrl();
  document.documentElement.dataset.theme = state.theme;
  el.sort.value = state.sort;
  [...el.segmented.children].forEach((c) => c.classList.toggle('is-active', c.dataset.view === state.view));
  V.renderSamples(el.samples, SAMPLES);
  store.subscribe(scheduleRender);
  render();
  loadTrends();
  loadBuildInfo();

  if (q) {
    el.keyword.value = q;
    run(q);
  } else {
    el.keyword.focus();
  }
}

boot();

// デバッグ・自動テスト用に最小限のハンドルを公開する
window.__suggestRadar = { store, run, keyOf };
