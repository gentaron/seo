/**
 * views.js — DOM レンダリング
 *
 * 状態 → HTML の変換のみを担当し、イベント処理は app.js の委譲に任せる。
 * 大量行でも軽快に動くよう、描画は上限件数で打ち切り「さらに表示」で伸ばす。
 */

import { ENGINE_META, ENGINE_META_MAP } from '../../shared/engines-meta.js';
import { MODES } from '../../shared/expand.js';
import { keyOf } from '../../shared/text.js';

export const PAGE_SIZE = 300;

export function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/** 絞り込み語をハイライト */
function highlight(text, needle) {
  const safe = escapeHtml(text);
  if (!needle) return safe;
  const target = escapeHtml(needle);
  const idx = safe.toLowerCase().indexOf(target.toLowerCase());
  if (idx < 0) return safe;
  return (
    safe.slice(0, idx) + '<mark>' + safe.slice(idx, idx + target.length) + '</mark>' + safe.slice(idx + target.length)
  );
}

/* ---------- チップ ---------- */

export function renderEngineChips(el, selected) {
  el.innerHTML = ENGINE_META.map((e) => {
    const on = selected.includes(e.id);
    return `<button type="button" class="chip" data-engine="${e.id}" aria-pressed="${on}" title="${escapeHtml(e.desc)}">
      <span class="chip__dot" style="color:${e.accent}"></span>${escapeHtml(e.label)}${e.beta ? '<span class="chip__beta">BETA</span>' : ''}
    </button>`;
  }).join('');
}

export function renderModeChips(el, selected, keyword) {
  el.innerHTML = MODES.map((m) => {
    const on = selected.includes(m.id);
    const count = keyword ? m.build(keyword).length : m.build('x').length;
    return `<button type="button" class="chip" data-mode="${m.id}" aria-pressed="${on}" title="${escapeHtml(m.hint)}">
      ${escapeHtml(m.label)}<span class="chip__count">${count}</span>
    </button>`;
  }).join('');
}

/* ---------- 進捗・統計 ---------- */

export function renderProgress(els, state) {
  const { progress, status, elapsedMs, items, queriesDone } = state;
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  els.wrap.hidden = status === 'idle';
  els.fill.style.width = `${status === 'done' ? 100 : pct}%`;
  const sec = (elapsedMs / 1000).toFixed(1);
  els.text.innerHTML =
    status === 'running'
      ? `<span>取得中 <b>${pct}%</b></span><span>クエリ ${queriesDone}</span><span>キーワード <b>${items.size}</b></span><span>${sec}s</span>`
      : status === 'done'
        ? `<span>完了</span><span>クエリ ${queriesDone}</span><span>キーワード <b>${items.size}</b></span><span>${sec}s</span>`
        : status === 'error'
          ? '<span>取得に失敗しました</span>'
          : '';
}

export function renderStats(el, state, visible) {
  if (!state.items.size) {
    el.innerHTML = '';
    return;
  }
  const total = state.items.size;
  const avg = Math.round([...state.items.values()].reduce((s, i) => s + i.score, 0) / total);
  const long = [...state.items.values()].filter((i) => i.words >= 3).length;
  const engines = new Set();
  for (const i of state.items.values()) for (const e of i.engines) engines.add(e);
  const failed = state.failures.length;
  el.innerHTML = [
    `<span>表示 <b>${visible.length}</b> / 総数 <b>${total}</b></span>`,
    `<span>平均スコア <b>${avg}</b></span>`,
    `<span>3語以上 <b>${long}</b>（ロングテール）</span>`,
    `<span>提供元 <b>${[...engines].map((e) => ENGINE_META_MAP[e]?.short || e).join(' ')}</b></span>`,
    failed ? `<span style="color:var(--warn)">取得失敗 ${failed}</span>` : '',
  ].join('');
}

/* ---------- 結果 ---------- */

function engineDots(item) {
  return [...item.engines]
    .map((e) => {
      const meta = ENGINE_META_MAP[e];
      return `<span class="kw__engine" style="background:${meta?.accent || '#888'}" title="${escapeHtml(meta?.label || e)}"></span>`;
    })
    .join('');
}

function rowHtml(item, state) {
  const fav = state.favorites.has(item.phrase);
  const selected = state.selected === item.key;
  return `<div class="kw${selected ? ' is-selected' : ''}" data-key="${escapeHtml(item.key)}" role="row" tabindex="-1">
    <button class="kw__fav" type="button" data-action="fav" aria-pressed="${fav}" aria-label="お気に入り">${fav ? '★' : '☆'}</button>
    <div class="kw__text" title="${escapeHtml(item.phrase)}">${highlight(item.phrase, state.filter)}${item.isSeed ? '<span class="kw__new">SEED</span>' : ''}</div>
    <div class="kw__score"><span class="kw__bar"><i style="width:${item.score}%"></i></span><span class="kw__num">${item.score}</span></div>
    <div class="kw__hits">${item.hits}回</div>
    <div class="kw__engines">${engineDots(item)}</div>
    <div class="kw__tools">
      <button class="kw__tool" type="button" data-action="drill" title="このキーワードで深掘り">⤵</button>
      <button class="kw__tool" type="button" data-action="copy" title="コピー">⧉</button>
      <button class="kw__tool" type="button" data-action="google" title="Google で検索">↗</button>
    </div>
  </div>`;
}

export function renderResults(el, store, limit) {
  const { state } = store;
  if (!state.items.size) return false; // 空状態は呼び出し側が制御

  if (state.view === 'cloud') {
    const cloud = store.cloudItems(90);
    if (!cloud.length) {
      el.innerHTML = '<p class="muted" style="padding:24px">共起語を抽出できませんでした。</p>';
      return true;
    }
    const max = cloud[0].count;
    el.innerHTML = `<div class="cloud">${cloud
      .map((c) => {
        const size = 12 + Math.round((c.count / max) * 12);
        const opacity = 0.55 + (c.count / max) * 0.45;
        return `<button class="cloud__item" type="button" data-word="${escapeHtml(c.word)}" style="font-size:${size}px;opacity:${opacity}">${escapeHtml(c.word)}<b>${c.count}</b></button>`;
      })
      .join('')}</div>`;
    return true;
  }

  if (state.view === 'group') {
    const groups = store.groupedItems();
    el.innerHTML = groups
      .map(
        (g, i) => `<details class="group"${i < 8 ? ' open' : ''}>
        <summary class="group__head"><span class="group__mark">▸</span>${escapeHtml(g.label)}<span class="group__count">${g.items.length}件</span></summary>
        <div>${g.items.slice(0, 120).map((item) => rowHtml(item, state)).join('')}</div>
      </details>`,
      )
      .join('');
    return true;
  }

  const list = store.visibleItems();
  const shown = list.slice(0, limit);
  el.innerHTML =
    shown.map((item) => rowHtml(item, state)).join('') +
    (list.length > shown.length
      ? `<div style="padding:14px;text-align:center"><button class="btn btn--sm" type="button" data-action="more">さらに表示（残り ${list.length - shown.length} 件）</button></div>`
      : '');
  return true;
}

/* ---------- 詳細パネル ---------- */

export function renderDetail(el, state, item, related) {
  if (!item) {
    el.innerHTML = '<p class="muted">一覧からキーワードを選ぶと、出現状況・関連情報・検索リンクを表示します。</p>';
    return;
  }
  const q = encodeURIComponent(item.phrase);
  const engineLines = [...item.engines]
    .map((e) => {
      const meta = ENGINE_META_MAP[e];
      return `<div class="engine-line">
        <span class="engine-line__dot" style="background:${meta?.accent || '#888'}"></span>
        ${escapeHtml(meta?.label || e)}
        <span class="engine-line__rank">${item.ranks[e] + 1} 位</span>
      </div>`;
    })
    .join('');

  const relatedHtml = related
    ? related.found
      ? `<p class="detail__extract">${escapeHtml((related.summary?.extract || '').slice(0, 260))}${
          (related.summary?.extract || '').length > 260 ? '…' : ''
        }</p>
        ${related.summary?.url ? `<p style="margin:6px 0 0"><a href="${escapeHtml(related.summary.url)}" target="_blank" rel="noopener">Wikipedia で読む ↗</a></p>` : ''}
        ${
          related.links?.length
            ? `<div class="tag-list" style="margin-top:8px">${related.links
                .slice(0, 14)
                .map((l) => `<button class="tag" type="button" data-seed="${escapeHtml(l)}">${escapeHtml(l)}</button>`)
                .join('')}</div>`
            : ''
        }`
      : '<p class="muted">Wikipedia に該当項目は見つかりませんでした。</p>'
    : '<p class="muted">読み込み中…</p>';

  el.innerHTML = `
    <p class="detail__kw">${escapeHtml(item.phrase)}</p>
    <div class="detail__grid">
      <div class="metric"><b>${item.score}</b><span>スコア</span></div>
      <div class="metric"><b>${item.hits}</b><span>出現クエリ</span></div>
      <div class="metric"><b>${item.bestRank + 1}</b><span>最高順位</span></div>
    </div>
    <div class="detail__section">
      <h3>アクション</h3>
      <div class="detail__links">
        <button class="tag" type="button" data-seed="${escapeHtml(item.phrase)}" style="grid-column:1/-1;text-align:center">このキーワードで深掘り ⤵</button>
        <a href="https://www.google.com/search?q=${q}&hl=ja" target="_blank" rel="noopener">Google 検索</a>
        <a href="https://www.google.com/search?q=${q}&tbm=nws&hl=ja" target="_blank" rel="noopener">ニュース</a>
        <a href="https://www.youtube.com/results?search_query=${q}" target="_blank" rel="noopener">YouTube</a>
        <a href="https://www.amazon.co.jp/s?k=${q}" target="_blank" rel="noopener">Amazon</a>
        <a href="https://trends.google.co.jp/trends/explore?geo=JP&q=${q}&hl=ja" target="_blank" rel="noopener">トレンド</a>
        <a href="https://x.com/search?q=${q}&f=live" target="_blank" rel="noopener">X（投稿）</a>
      </div>
    </div>
    <div class="detail__section">
      <h3>提供元での表示順位</h3>
      ${engineLines || '<p class="muted">—</p>'}
    </div>
    <div class="detail__section">
      <h3>語の背景（Wikipedia）</h3>
      ${relatedHtml}
    </div>
    <div class="detail__section">
      <h3>指標の内訳</h3>
      <p class="muted" style="font-size:11.5px;line-height:1.8;margin:0">
        文字数 ${item.length} ／ 語数 ${item.words} ／ 提供元 ${item.engines.size} 媒体<br>
        スコアはサジェスト上の露出の強さを示す独自指標です（検索ボリュームではありません）。
      </p>
    </div>`;
}

/* ---------- サイドパネル ---------- */

export function renderTrends(el, trends) {
  if (!trends) {
    el.innerHTML = '<p class="muted">読み込み中…</p>';
    return;
  }
  if (!trends.ok || !trends.items?.length) {
    el.innerHTML = `<p class="muted">現在取得できません。${escapeHtml(trends.error || '')}</p>`;
    return;
  }
  el.innerHTML = `<div class="tag-list">${trends.items
    .slice(0, 18)
    .map(
      (t, i) => `<button class="tag tag--rank" type="button" data-seed="${escapeHtml(t.query)}" title="${escapeHtml(t.article?.title || '')}">
        <span class="tag__no">${String(i + 1).padStart(2, '0')}</span>${escapeHtml(t.query)}
        ${t.traffic ? `<span class="tag__sub">${escapeHtml(t.traffic)}</span>` : ''}
      </button>`,
    )
    .join('')}</div>`;
}

export function renderFavorites(el, countEl, favorites) {
  countEl.textContent = String(favorites.size);
  if (!favorites.size) {
    el.innerHTML = '<p class="muted">★ を押して保存したキーワードが並びます。</p>';
    return;
  }
  el.innerHTML = [...favorites]
    .reverse()
    .map(
      (k) => `<button class="list-row" type="button" data-seed="${escapeHtml(k)}">
        <span style="color:var(--warn)">★</span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(k)}</span>
      </button>`,
    )
    .join('');
}

export function renderHistory(el, history, datalist) {
  if (datalist) {
    datalist.innerHTML = history.map((h) => `<option value="${escapeHtml(h.keyword)}"></option>`).join('');
  }
  if (!history.length) {
    el.innerHTML = '<p class="muted">まだありません。</p>';
    return;
  }
  el.innerHTML = history
    .map(
      (h) => `<button class="list-row" type="button" data-seed="${escapeHtml(h.keyword)}">
        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(h.keyword)}</span>
        <span class="list-row__meta">${h.count || 0}</span>
      </button>`,
    )
    .join('');
}

export function renderSamples(el, samples) {
  el.innerHTML = samples
    .map((s) => `<button class="btn btn--sm" type="button" data-seed="${escapeHtml(s)}">${escapeHtml(s)}</button>`)
    .join('');
}

/** 選択キーワードの検索キー一致を確認するユーティリティ */
export function findItem(state, key) {
  return state.items.get(key) || state.items.get(keyOf(key)) || null;
}
