/**
 * Undercurrent — フロントエンド（依存なし・素の ES Modules）
 *
 * 状態は URL（?tab= / ?term=）と localStorage（ネタ帳・配色）にだけ持つ。
 * フィードは 3 分ごとにポーリングし、新しい観測が来たら SNS の「新着あり」のように知らせる。
 */

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const POLL_MS = 3 * 60 * 1000;
const STATUS = {
  new: { icon: '🌱', label: '誕生' },
  surge: { icon: '🔥', label: '急騰' },
  spread: { icon: '🌊', label: '拡散' },
  revival: { icon: '🧟', label: '再燃' },
  cool: { icon: '🥀', label: '失速' },
  slang: { icon: '🗯', label: 'スラング' },
  scandal: { icon: '🚨', label: '炎上・事件' },
  mainstream: { icon: '📣', label: '主流' },
  steady: { icon: '・', label: '定着' },
};
const STAGE = { newborn: '🌱 生まれたて', alive: '🔥 生存中', fading: '🌫 消えかけ', dead: '💀 死語' };

const state = {
  snap: null,
  status: '',
  lang: '',
  q: '',
  hideMain: true,
  tab: 'board',
  board: { region: '', window: '', cat: '', sort: 'score', active: false },
  lex: { q: '', stage: '', lang: '', sort: 'recent', page: 1 },
  pendingSnap: null,
};

/* ---------------- 保存（ネタ帳・配色） ---------------- */
const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* プライベートモード等では保存しない */
    }
  },
};
let notes = store.get('uc.notes', {});

/* ---------------- 表示ユーティリティ ---------------- */
function ago(ts) {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return 'たった今';
  if (s < 3600) return `${Math.floor(s / 60)}分前`;
  if (s < 86400) return `${Math.floor(s / 3600)}時間前`;
  return `${Math.floor(s / 86400)}日前`;
}
function hms(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}
function clock(ts) {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function srcMeta(id) {
  return state.snap?.sources?.find((s) => s.id === id) || { id, icon: '•', label: id };
}

function sparkline(values, { w = 96, h = 26, cls = 'spark', fill = true } = {}) {
  const vals = values?.length ? values : [0];
  const pts = vals.length === 1 ? [vals[0], vals[0]] : vals;
  const max = Math.max(...pts, 0.001);
  const step = w / (pts.length - 1);
  const xy = pts.map((v, i) => [i * step, h - 3 - (v / max) * (h - 6)]);
  const d = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const last = xy[xy.length - 1];
  const up = pts[pts.length - 1] >= pts[pts.length - 2];
  const color = up ? 'var(--hot)' : 'var(--fog)';
  return `<svg class="${cls}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
    ${fill ? `<path d="${d} L${w} ${h} L0 ${h} Z" fill="${color}" opacity=".12"/>` : ''}
    <path d="${d}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
    <circle cx="${last[0]}" cy="${last[1]}" r="2.4" fill="${color}"/>
  </svg>`;
}

function searchLinks(term) {
  const q = encodeURIComponent(term);
  return [
    ['X', `https://x.com/search?q=${q}&f=live`],
    ['TikTok', `https://www.tiktok.com/search?q=${q}`],
    ['Bluesky', `https://bsky.app/search?q=${q}`],
    ['YouTube', `https://www.youtube.com/results?search_query=${q}&sp=CAI%253D`],
    ['Google', `https://www.google.com/search?q=${q}&tbs=qdr:d`],
    ['Urban Dict', `https://www.urbandictionary.com/define.php?term=${q}`],
  ];
}

function toast(html, { action, onAction, ms = 4500 } = {}) {
  const el = $('#toast');
  el.innerHTML = `<span>${html}</span>${action ? `<button type="button">${esc(action)}</button>` : ''}`;
  el.hidden = false;
  if (action) $('button', el).onclick = () => {
    el.hidden = true;
    onAction?.();
  };
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (el.hidden = true), ms);
}

/* ---------------- API ---------------- */
async function api(path, init) {
  const res = await fetch(path, { headers: { Accept: 'application/json' }, ...init });
  const body = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
  if (!res.ok || body.ok === false) {
    const err = new Error(body.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

/* ---------------- トレンド一覧（Google トレンド風） ---------------- */
const CAT = {
  scandal: '🚨 炎上・事件', gossip: '📸 芸能・ゴシップ', oddity: '🦩 珍ニュース', board: '🗯 掲示板まとめ', netnews: '🌐 ネットニュース',
  news: '📰 ニュース', sns: '💬 SNS', community: '👥 コミュニティ', slang: '📕 スラング', video: '📺 動画', tech: '💻 テック',
  mainstream: '📈 主流', other: 'その他',
};
const isOtherLang = (l) => l !== 'ja' && l !== 'en';
const BOARD_SORT = {
  score: (a, b) => b.score - a.score,
  vel: (a, b) => b.vel - a.vel || b.score - a.score,
  first: (a, b) => b.first - a.first || b.score - a.score,
  spread: (a, b) => b.spread - a.spread || b.score - a.score,
};

function boardTerms() {
  const b = state.board;
  const now = Date.now();
  return (state.snap?.terms ?? [])
    .filter((t) => {
      if (b.region === 'other' ? !isOtherLang(t.lang) : b.region && t.lang !== b.region) return false;
      if (b.window && now - t.first > Number(b.window) * 3.6e6) return false;
      if (b.cat && (t.cat || 'other') !== b.cat) return false;
      if (b.active && !(t.vel > 0.05 || t.status === 'new')) return false;
      return true;
    })
    .sort(BOARD_SORT[b.sort] || BOARD_SORT.score);
}

function renderBoard() {
  const list = boardTerms();
  const s = state.snap;
  $('#board-empty').hidden = list.length > 0 || !s;
  if (s) $('#board-sub').textContent = `${list.length} 件のトレンド · ${clock(s.generatedAt)} 更新 · ${s.stats.sourcesUp} 媒体・${s.stats.signals.toLocaleString()} 件の投稿から自動抽出（検索不要）`;
  $('#board').innerHTML = list
    .map((t, i) => {
      const vel = t.status === 'new' && t.runs <= 1 ? '<span class="vel-up">NEW</span>' : t.vel > 0.05 ? `<span class="vel-up">↑${Math.round(t.vel * 100)}%</span>` : t.vel < -0.05 ? `<span class="vel-down">↓${Math.round(-t.vel * 100)}%</span>` : '<span class="mute">→</span>';
      const live = t.vel > 0.05 || t.status === 'new';
      // 語そのものだけの用例（トピック名）は飛ばし、文脈が分かる見出しを優先
      const norm = (x) => String(x).toLowerCase().replace(/[#\s]/g, '');
      const head = t.samples?.find((x) => norm(x.x) !== norm(t.t));
      return `<tr data-open="${esc(t.k)}" tabindex="0">
        <td class="c-rank">${i + 1}</td>
        <td class="c-term">
          <div class="bt"><b>${esc(t.t)}</b>${live ? '<span class="live">● 上昇中</span>' : ''}<span class="bcat">${CAT[t.cat] ?? ''}</span></div>
          ${head ? `<div class="bh">${srcMeta(head.s).icon} ${esc(head.x)}</div>` : ''}
        </td>
        <td class="c-heat"><span class="meter"><span class="meter__bar"><i style="width:${t.score}%"></i></span><b>${t.score}</b></span></td>
        <td class="c-vel">${vel}</td>
        <td class="c-start">${ago(t.first)}</td>
        <td class="c-spark">${sparkline(t.spark, { w: 110, h: 30 })}</td>
        <td class="c-src">${t.srcs.slice(0, 5).map((id) => `<span title="${esc(srcMeta(id).label)}">${srcMeta(id).icon}</span>`).join('')}${t.spread > 5 ? `<small>+${t.spread - 5}</small>` : ''}</td>
      </tr>`;
    })
    .join('');
}

function bindBoard() {
  for (const [id, key] of [['#b-region', 'region'], ['#b-window', 'window']]) {
    $(id).addEventListener('click', (e) => {
      const btn = e.target.closest('[data-v]');
      if (!btn) return;
      state.board[key] = btn.dataset.v;
      $$(`${id} button`).forEach((x) => x.classList.toggle('is-on', x === btn));
      renderBoard();
    });
  }
  $('#b-cat').addEventListener('change', (e) => ((state.board.cat = e.target.value), renderBoard()));
  $('#b-sort').addEventListener('change', (e) => ((state.board.sort = e.target.value), renderBoard()));
  $('#b-active').addEventListener('change', (e) => ((state.board.active = e.target.checked), renderBoard()));
  $('#board').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('tr[data-open]')) openTerm(e.target.dataset.open);
  });
}

/* ---------------- フィード ---------------- */
function filteredTerms() {
  const terms = state.snap?.terms ?? [];
  const q = state.q.trim().toLowerCase();
  return terms.filter((t) => {
    if (state.lang === 'other' ? !isOtherLang(t.lang) : state.lang && t.lang !== state.lang) return false;
    if (state.status && t.status !== state.status && !t.badges.includes(state.status)) return false;
    if (state.hideMain && t.main && t.spread <= 2 && !state.status) return false;
    if (q && !t.t.toLowerCase().includes(q) && !t.k.includes(q)) return false;
    return true;
  });
}

function renderCard(t, i) {
  const isOn = Boolean(notes[t.k]);
  const vel = t.vel > 0.05 ? `<span class="vel-up">▲${Math.round(t.vel * 100)}%</span>` : t.vel < -0.05 ? `<span class="vel-down">▼${Math.round(-t.vel * 100)}%</span>` : '<span>±0%</span>';
  const hl = t.hl == null ? (t.vel > 0 ? '上昇中' : '観測中') : `半減期 ~${t.hl < 1 ? '<1' : Math.round(t.hl)}h`;
  const badges = [
    ...t.badges.map((b) => `<span class="badge badge--${b}">${STATUS[b]?.icon ?? ''} ${STATUS[b]?.label ?? b}</span>`),
    `<span class="badge badge--lang">${t.lang.toUpperCase()}</span>`,
  ].join('');
  const samples = (t.samples ?? [])
    .map((s) => {
      const m = srcMeta(s.s);
      return `<li><span title="${esc(m.label)}">${m.icon}</span><a href="${esc(s.u)}" target="_blank" rel="noopener nofollow">${esc(s.x)}</a><small>${ago(s.ts)}</small></li>`;
    })
    .join('');
  return `<li class="card ${t.status === 'new' ? 'is-new' : ''} ${t.status === 'surge' ? 'is-surge' : ''}" data-k="${esc(t.k)}" style="animation-delay:${Math.min(i, 12) * 25}ms">
    <div class="card__rank"><b>${i + 1}</b></div>
    <div class="card__body">
      <div class="card__head">
        <button class="card__term" data-open="${esc(t.k)}">${esc(t.t)}</button>
        <div class="card__tools">
          <button class="star ${isOn ? 'is-on' : ''}" data-star="${esc(t.k)}" aria-pressed="${isOn}" aria-label="ネタ帳に${isOn ? 'から外す' : '追加'}">${isOn ? '★' : '☆'}</button>
        </div>
      </div>
      <div class="badges">${badges}</div>
      <div class="metrics">
        <span class="meter" title="ニッチ潮流スコア（今回の観測内の相対値）"><span class="meter__bar"><i style="width:${t.score}%"></i></span><b>${t.score}</b></span>
        ${sparkline(t.spark)}
        ${vel}
        <span class="srcs" title="${esc(t.srcs.map((s) => srcMeta(s).label).join(' / '))}">${t.srcs.slice(0, 6).map((s) => `<span>${srcMeta(s).icon}</span>`).join('')}</span>
        <span>初観測 ${ago(t.first)}</span>
        <span>${hl}</span>
      </div>
      ${samples ? `<ul class="samples">${samples}</ul>` : ''}
      <div class="actions">
        <button class="act" data-open="${esc(t.k)}">意味・推移を見る</button>
        ${searchLinks(t.t).slice(0, 4).map(([n, u]) => `<a class="act" href="${esc(u)}" target="_blank" rel="noopener nofollow">${n}で見る</a>`).join('')}
        <button class="act" data-copy="${esc(t.t)}">コピー</button>
      </div>
    </div>
  </li>`;
}

function renderFeed() {
  const list = filteredTerms();
  $('#feed').innerHTML = list.map(renderCard).join('');
  $('#feed-empty').hidden = list.length > 0 || !state.snap;
  const snap = state.snap;
  if (snap) {
    $('#feed-meta').textContent = `${list.length} 語 · ${clock(snap.generatedAt)} 観測（${snap.stats.signals.toLocaleString()} 件の投稿・トピックから）`;
  }
}

function renderTicker() {
  const top = (state.snap?.terms ?? []).filter((t) => !t.main).slice(0, 24);
  const html = top
    .map((t) => `<button class="ticker__item" tabindex="-1" data-open="${esc(t.k)}">${STATUS[t.status]?.icon ?? ''} <b>${esc(t.t)}</b><i>${t.vel > 0 ? '+' : ''}${Math.round(t.vel * 100)}%</i></button>`)
    .join('');
  $('#ticker').innerHTML = html + html; // 2 周分並べて継ぎ目なくループ
}

function renderSide() {
  const s = state.snap;
  if (!s) return;
  const counts = (s.terms ?? []).reduce((a, t) => ((a[t.status] = (a[t.status] || 0) + 1), a), {});
  $('#stats').innerHTML = [
    ['🌱 誕生', counts.new || 0],
    ['🔥 急騰', counts.surge || 0],
    ['🌊 拡散', counts.spread || 0],
    ['🥀 失速', counts.cool || 0],
    ['観測媒体', `${s.stats.sourcesUp}/${s.stats.sourcesTotal}`],
    ['大全の語数', s.stats.lexicon.toLocaleString()],
  ]
    .map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`)
    .join('');
}

async function loadHistory() {
  // 履歴は meta に入っているが、フィード API には載せていないので軽い別経路で
  try {
    const h = await api('/api/history');
    $('#history').innerHTML = (h.history ?? [])
      .map((r) => `<li><time>${clock(r.at)}</time>${r.top.slice(0, 5).map((t) => `<button data-lexq="${esc(t)}">${esc(t)}</button>`).join(' · ')}</li>`)
      .join('');
  } catch {
    $('#history').innerHTML = '<li class="mute">まだ履歴がありません</li>';
  }
}

/* ---------------- 鼓動（最終観測・次回観測のカウントダウン） ---------------- */
function tickPulse() {
  const s = state.snap;
  const el = $('#pulse');
  if (!s) return;
  const age = Date.now() - s.generatedAt;
  let next = s.nextRunAt;
  while (next < Date.now()) next += (s.intervalH || 3) * 3.6e6;
  el.classList.toggle('is-stale', age > (s.intervalH || 3) * 3.6e6 * 1.6);
  $('#pulse-text').textContent = `最終観測 ${ago(s.generatedAt)} · 次の観測まで ${hms(next - Date.now())}`;
}

/* ---------------- 取得・ポーリング ---------------- */
async function loadFeed({ silent = false } = {}) {
  try {
    const snap = await api('/api/feed');
    if (!state.snap || !silent) {
      applySnap(snap);
    } else if (snap.runId !== state.snap.runId) {
      // SNS の「新着」と同じく、勝手に並びを変えず知らせるだけ
      const known = new Set(state.snap.terms.map((t) => t.k));
      const fresh = snap.terms.filter((t) => !known.has(t.k)).length;
      state.pendingSnap = snap;
      toast(`新しい観測が届きました（新顔 ${fresh} 語）`, { action: '表示する', onAction: () => applySnap(state.pendingSnap), ms: 15000 });
    }
    $('#pulse').classList.remove('is-error');
  } catch (err) {
    $('#pulse').classList.add('is-error');
    $('#pulse-text').textContent = err.status === 503 ? '初回観測中… 数秒後に自動で再試行します' : `取得に失敗しました（${err.message}）`;
    if (err.status === 503) setTimeout(() => loadFeed(), 5000);
  }
}

function applySnap(snap) {
  state.snap = snap;
  state.pendingSnap = null;
  renderBoard();
  renderFeed();
  renderTicker();
  renderSide();
  renderSources();
  if (state.tab === 'raw') renderRaw();
  tickPulse();
  loadHistory();
}

async function manualRefresh() {
  const btn = $('#refresh');
  if (btn.classList.contains('is-busy')) return;
  btn.classList.add('is-busy');
  try {
    const r = await api('/api/refresh', { method: 'POST' });
    toast(`観測しました：${r.stats.sourcesUp}/${r.stats.sourcesTotal} 媒体・${r.stats.signals} 件`);
    await loadFeed();
  } catch (err) {
    toast(esc(err.message));
  } finally {
    btn.classList.remove('is-busy');
  }
}

/* ---------------- 詳細ドロワ ---------------- */
function lineChart(hist) {
  const w = 520;
  const h = 120;
  if (!hist?.length) return '';
  const pts = hist.length === 1 ? [hist[0], [hist[0][0] + 1, hist[0][1]]] : hist;
  const t0 = pts[0][0];
  const t1 = pts[pts.length - 1][0];
  const max = Math.max(...pts.map((p) => p[1]), 0.001);
  const x = (t) => 10 + ((t - t0) / Math.max(1, t1 - t0)) * (w - 20);
  const y = (v) => h - 18 - (v / max) * (h - 34);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)} ${y(p[1]).toFixed(1)}`).join(' ');
  const dots = pts.map((p) => `<circle cx="${x(p[0]).toFixed(1)}" cy="${y(p[1]).toFixed(1)}" r="2.6" fill="var(--hot)"><title>${clock(p[0])}  熱量 ${p[1]}</title></circle>`).join('');
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="熱量の推移">
    <path d="${d} L${x(t1)} ${h - 18} L${x(t0)} ${h - 18} Z" fill="var(--hot)" opacity=".1"/>
    <path d="${d}" fill="none" stroke="var(--hot)" stroke-width="2" stroke-linejoin="round"/>
    ${dots}
    <text x="10" y="${h - 4}" font-size="10" fill="var(--tx-3)">${clock(t0)}</text>
    <text x="${w - 10}" y="${h - 4}" font-size="10" fill="var(--tx-3)" text-anchor="end">${clock(t1)}</text>
  </svg>`;
}

async function openTerm(key, { push = true } = {}) {
  const dlg = $('#drawer');
  const t = state.snap?.terms?.find((x) => x.k === key);
  $('#dr-title').textContent = t?.t ?? key;
  $('#dr-kicker').textContent = t ? `${STATUS[t.status]?.icon ?? ''} ${STATUS[t.status]?.label ?? ''} · スコア ${t.score}` : '大全';
  $('#dr-body').innerHTML = '<div class="skeleton"></div><div class="skeleton" style="width:70%"></div><div class="skeleton" style="width:85%"></div>';
  if (!dlg.open) dlg.showModal();
  if (push) setParam('term', key);

  try {
    const { entry, defs } = await api(`/api/term?k=${encodeURIComponent(key)}`);
    $('#dr-title').textContent = entry.t;
    if (!t) $('#dr-kicker').textContent = `${STAGE[entry.stage] ?? ''} · 最高スコア ${entry.peak}`;
    const srcs = Object.entries(entry.srcs || {}).sort((a, b) => b[1] - a[1]);
    $('#dr-body').innerHTML = `
      <section>
        <h3>意味・背景</h3>
        ${defs.length
          ? defs.map((d) => `<div class="def"><p>${esc(d.text)}</p>${d.example ? `<em>例：${esc(d.example)}</em>` : ''}<a href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.source)} ↗</a></div>`).join('')
          : '<div class="def"><p class="mute">辞書にまだ載っていません。それ自体が “新しさ” のサインかも。下の用例から文脈を読み解いてください。</p></div>'}
      </section>
      <section>
        <h3>熱量の推移</h3>
        ${lineChart(entry.hist)}
      </section>
      <section>
        <dl class="kv">
          <div><dt>初観測</dt><dd>${clock(entry.first)}</dd></div>
          <div><dt>最終観測</dt><dd>${ago(entry.last)}</dd></div>
          <div><dt>観測回数</dt><dd>${entry.runs}</dd></div>
          <div><dt>最高スコア</dt><dd>${entry.peak}</dd></div>
          <div><dt>スラング度</dt><dd>${Math.round(entry.slang * 100)}%</dd></div>
          <div><dt>状態</dt><dd>${STAGE[entry.stage] ?? '-'}</dd></div>
        </dl>
      </section>
      <section>
        <h3>出現した媒体</h3>
        <div class="badges">${srcs.map(([id, n]) => `<span class="badge">${srcMeta(id).icon} ${esc(srcMeta(id).label)} ×${n}</span>`).join('')}</div>
      </section>
      <section>
        <h3>用例（実際の投稿・見出し）</h3>
        <ul class="samples">${(entry.samples ?? []).map((s) => `<li><span>${srcMeta(s.s).icon}</span><a href="${esc(s.u)}" target="_blank" rel="noopener nofollow">${esc(s.x)}</a><small>${ago(s.ts)}</small></li>`).join('')}</ul>
      </section>
      <section>
        <h3>いま現場を見る</h3>
        <div class="actions">${searchLinks(entry.t).map(([n, u]) => `<a class="act" href="${esc(u)}" target="_blank" rel="noopener nofollow">${n}</a>`).join('')}
          <button class="act" data-star="${esc(entry.k)}">${notes[entry.k] ? '★ ネタ帳から外す' : '☆ ネタ帳に追加'}</button>
        </div>
      </section>`;
  } catch (err) {
    $('#dr-body').innerHTML = `<p class="mute">詳細を取得できませんでした（${esc(err.message)}）。</p>`;
  }
}

function closeDrawer() {
  $('#drawer').close();
}

/* ---------------- 大全 ---------------- */
async function loadLexicon() {
  const { q, stage, lang, sort, page } = state.lex;
  const params = new URLSearchParams({ q, stage, lang, sort, page: String(page), per: '60' });
  for (const [k, v] of [...params]) if (!v) params.delete(k);
  $('#lex-csv').href = `/api/lexicon?${new URLSearchParams({ ...Object.fromEntries(params), format: 'csv' })}`;
  try {
    const r = await api(`/api/lexicon?${params}`);
    const c = r.counts;
    $('#lex-counts').textContent = `収録 ${c.total.toLocaleString()} 語 — 🌱 ${c.newborn} · 🔥 ${c.alive} · 🌫 ${c.fading} · 💀 ${c.dead}（3 日観測されない語は死語扱い）`;
    $('#lex').innerHTML = r.rows
      .map(
        (e) => `<li class="${e.stage === 'dead' ? 'is-dead' : ''}" data-open="${esc(e.k)}" tabindex="0">
          <span class="t">${esc(e.t)}</span>
          <span class="row"><span class="stage stage--${e.stage}">${STAGE[e.stage]}</span><span>最高 ${e.peak}</span><span>${e.runs} 回</span><span>${ago(e.last)}</span><span>${e.srcs.slice(0, 5).map((s) => srcMeta(s).icon).join('')}</span></span>
          <span class="hint">${esc(e.hint)}</span>
        </li>`,
      )
      .join('') || '<li class="empty">該当なし</li>';
    const pages = Math.min(r.pages, 30);
    $('#lex-pager').innerHTML =
      pages > 1 ? Array.from({ length: pages }, (_, i) => `<button class="${i + 1 === r.page ? 'is-on' : ''}" data-page="${i + 1}">${i + 1}</button>`).join('') : '';
  } catch (err) {
    $('#lex').innerHTML = `<li class="empty">読み込めませんでした（${esc(err.message)}）</li>`;
  }
}

/* ---------------- 生データ ---------------- */
function renderRaw() {
  const s = state.snap;
  if (!s) return;
  $('#raw').innerHTML = s.sources
    .filter((m) => s.streams?.[m.id]?.length)
    .map(
      (m) => `<section><h2><span>${m.icon} ${esc(m.label)}</span><small>${s.streams[m.id].length} 件</small></h2><ol>${s.streams[m.id]
        .map((x) => `<li><a href="${esc(x.u)}" target="_blank" rel="noopener nofollow">${esc(x.x)}</a>${x.c ? `<small>${esc(x.c).slice(0, 40)}</small>` : ''}</li>`)
        .join('')}</ol></section>`,
    )
    .join('');
}

/* ---------------- 観測網 ---------------- */
function renderSources() {
  const s = state.snap;
  if (!s) return;
  const GENRE = {
    sns: 'SNS', community: 'コミュニティ', slang: 'スラング辞典', video: '動画', tech: '技術', mainstream: '主流の物差し',
    news: 'ニュース', gossip: '芸能・ゴシップ', oddity: '珍ニュース', board: '掲示板まとめ', netnews: 'ネット発ニュース',
  };
  $('#srcgrid').innerHTML = s.sources
    .map(
      (m) => `<article class="src"><header><span>${m.icon}</span>${esc(m.label)}<em class="st ${m.ok ? 'ok' : 'ng'}">${m.ok ? `${m.count} 件` : '停止'}</em></header>
        <p>${GENRE[m.genre] ?? m.genre} · 重み ${m.weight} · ${m.ms}ms</p>${m.error ? `<p>理由：${esc(m.error)}</p>` : ''}</article>`,
    )
    .join('');
}

/* ---------------- ネタ帳 ---------------- */
function toggleNote(key) {
  if (notes[key]) delete notes[key];
  else {
    const t = state.snap?.terms?.find((x) => x.k === key);
    notes[key] = { t: t?.t ?? key, at: Date.now(), score: t?.score ?? null, status: t?.status ?? null, sample: t?.samples?.[0] ?? null };
  }
  store.set('uc.notes', notes);
  renderNotes();
  $$(`[data-star="${CSS.escape(key)}"]`).forEach((b) => {
    const on = Boolean(notes[key]);
    if (b.classList.contains('star')) {
      b.classList.toggle('is-on', on);
      b.textContent = on ? '★' : '☆';
      b.setAttribute('aria-pressed', String(on));
    } else b.textContent = on ? '★ ネタ帳から外す' : '☆ ネタ帳に追加';
  });
}

function renderNotes() {
  const list = Object.entries(notes).sort((a, b) => b[1].at - a[1].at);
  $('#notes-count').textContent = String(list.length);
  $('#notes-empty').hidden = list.length > 0;
  $('#notes').innerHTML = list
    .map(([k, n]) => `<li><span class="t" data-open="${esc(k)}">${esc(n.t)}</span>${n.status ? `<span class="badge badge--${n.status}">${STATUS[n.status]?.icon} ${STATUS[n.status]?.label}</span>` : ''}<span class="m">${ago(n.at)}に保存</span><button class="star is-on" data-star="${esc(k)}" aria-label="外す">★</button></li>`)
    .join('');
}

function notesMarkdown() {
  const list = Object.values(notes).sort((a, b) => b.at - a.at);
  const day = new Date().toISOString().slice(0, 10);
  return [
    `# ネタ帳 — ${day}`,
    '',
    ...list.map((n) => {
      const lines = [`## ${n.t}`, `- 状態: ${n.status ? `${STATUS[n.status]?.icon} ${STATUS[n.status]?.label}` : '-'} / スコア ${n.score ?? '-'}`];
      if (n.sample) lines.push(`- 用例: [${n.sample.x}](${n.sample.u})`);
      lines.push(`- 見る: [X](https://x.com/search?q=${encodeURIComponent(n.t)}&f=live) · [TikTok](https://www.tiktok.com/search?q=${encodeURIComponent(n.t)})`, '');
      return lines.join('\n');
    }),
  ].join('\n');
}

/* ---------------- タブ・URL ---------------- */
function setParam(key, value) {
  const url = new URL(location.href);
  if (value) url.searchParams.set(key, value);
  else url.searchParams.delete(key);
  history.replaceState(null, '', url);
}

function showTab(tab) {
  state.tab = tab;
  $$('.tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  $$('.panel').forEach((p) => (p.hidden = p.dataset.panel !== tab));
  setParam('tab', tab === 'board' ? '' : tab);
  if (tab === 'lexicon') loadLexicon();
  if (tab === 'raw') renderRaw();
  if (tab === 'notes') renderNotes();
}

/* ---------------- 配色 ---------------- */
function initTheme() {
  const saved = store.get('uc.theme', null);
  const theme = saved || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  document.documentElement.dataset.theme = theme;
}

/* ---------------- イベント ---------------- */
function bind() {
  bindBoard();
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-open],[data-star],[data-copy],[data-lexq],[data-page]');
    if (!t) return;
    if (t.dataset.star) return toggleNote(t.dataset.star);
    if (t.dataset.open) return openTerm(t.dataset.open);
    if (t.dataset.copy) {
      navigator.clipboard?.writeText(t.dataset.copy).then(() => toast('コピーしました'), () => toast('コピーできませんでした'));
      return;
    }
    if (t.dataset.lexq) {
      state.lex = { ...state.lex, q: t.dataset.lexq, page: 1 };
      $('#lex-q').value = t.dataset.lexq;
      return showTab('lexicon');
    }
    if (t.dataset.page) {
      state.lex.page = Number(t.dataset.page);
      loadLexicon();
      $('#lex').scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('.lex li[data-open]')) openTerm(e.target.dataset.open);
    if (e.key === '/' && !e.target.matches('input,select,textarea') && state.tab !== 'board') {
      e.preventDefault();
      (state.tab === 'lexicon' ? $('#lex-q') : $('#feed-q')).focus();
    }
  });

  $$('.tab').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  $('#status-chips').addEventListener('click', (e) => {
    const b = e.target.closest('[data-status]');
    if (!b) return;
    state.status = b.dataset.status;
    $$('#status-chips .chip').forEach((c) => c.classList.toggle('is-on', c === b));
    renderFeed();
  });
  $('#lang-seg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-lang]');
    if (!b) return;
    state.lang = b.dataset.lang;
    $$('#lang-seg button').forEach((c) => c.classList.toggle('is-on', c === b));
    renderFeed();
  });
  $('#feed-q').addEventListener('input', (e) => {
    state.q = e.target.value;
    renderFeed();
  });
  $('#hide-main').addEventListener('change', (e) => {
    state.hideMain = e.target.checked;
    renderFeed();
  });

  let lexTimer;
  $('#lex-q').addEventListener('input', (e) => {
    clearTimeout(lexTimer);
    lexTimer = setTimeout(() => {
      state.lex = { ...state.lex, q: e.target.value, page: 1 };
      loadLexicon();
    }, 220);
  });
  for (const id of ['stage', 'lang', 'sort']) {
    $(`#lex-${id}`).addEventListener('change', (e) => {
      state.lex = { ...state.lex, [id]: e.target.value, page: 1 };
      loadLexicon();
    });
  }

  $('#refresh').addEventListener('click', manualRefresh);
  $('#theme').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    store.set('uc.theme', next);
  });
  $('#dr-close').addEventListener('click', closeDrawer);
  $('#drawer').addEventListener('close', () => setParam('term', ''));
  $('#drawer').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeDrawer(); // 背景クリックで閉じる
  });

  $('#notes-md').addEventListener('click', () => {
    navigator.clipboard?.writeText(notesMarkdown()).then(() => toast('Markdown をコピーしました'), () => toast('コピーできませんでした'));
  });
  $('#notes-clear').addEventListener('click', () => {
    if (!Object.keys(notes).length || !confirm('ネタ帳を空にしますか？')) return;
    notes = {};
    store.set('uc.notes', notes);
    renderNotes();
    renderFeed();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') loadFeed({ silent: true });
  });
}

/* ---------------- 起動 ---------------- */
async function boot() {
  initTheme();
  bind();
  renderNotes();
  const params = new URL(location.href).searchParams;
  const tab = params.get('tab');
  if (tab && $(`.tab[data-tab="${CSS.escape(tab)}"]`)) showTab(tab);
  await loadFeed();
  const term = params.get('term');
  if (term) openTerm(term, { push: false });
  setInterval(tickPulse, 1000);
  setInterval(() => document.visibilityState === 'visible' && loadFeed({ silent: true }), POLL_MS);
  fetch('/build-info.json')
    .then((r) => (r.ok ? r.json() : null))
    .then((b) => b && ($('#build').textContent = `build ${b.commit} · ${new Date(b.builtAt).toLocaleString('ja-JP')}`))
    .catch(() => {});
  // オフライン時の案内ページだけを返す最小 Service Worker（ホーム画面追加用）
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/install-worker.js').catch(() => {});
}

boot();
