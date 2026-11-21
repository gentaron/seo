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
  mainstream: { icon: '📣', label: '主流' },
  steady: { icon: '・', label: '定着' },
};
const STAGE = { newborn: '🌱 生まれたて', alive: '🔥 生存中', fading: '🌫 消えかけ', dead: '💀 死語' };
// 話題の内容による分類（投稿元の分類 CAT とは別）
const TOPIC = { science: '科学・研究', ai: 'AI', economy: '経済・金融', politics: '政治・国際情勢', security: '安全保障', society: '社会', technology: 'テクノロジー', culture: '文化・娯楽', sports: 'スポーツ', other: 'その他' };
// 動向の表示ルール（サーバの trend.js と同じ定義）
const DIR = {
  new: { cls: 'new', label: 'NEW', icon: '✦' },
  rising: { cls: 'up', label: '上昇中', icon: '↑' },
  flat: { cls: 'flat', label: '横ばい', icon: '→' },
  falling: { cls: 'down', label: '下降中', icon: '↓' },
};
const VER = {
  confirmed: { label: '確認済み', desc: '2 つ以上の独立した報道・公式ドメインが言及（内容の最終確認ではありません）' },
  investigating: { label: '調査中', desc: '報道・公式・論文のいずれか 1 系統のみ。独立した裏付け待ち' },
  unverified: { label: '未検証', desc: 'SNS 投稿・リポジトリ・検索トレンドのみ' },
  disputed: { label: '誤情報の可能性', desc: 'デマ・誤情報・撤回などの指摘を含む投稿あり' },
};
const STYPE = { official: '公式', paper: '論文', news: '報道', web: 'Web記事', repo: 'リポジトリ', sns: 'SNS', reference: '辞典', search: '検索' };
const STAGE_R = {
  'research-announced': '研究の発表段階（独立検証なし）',
  'research-reported': '研究の発表・報道（独立検証は未確認）',
  'research-replicated': '独立検証・追試への言及あり',
  'software-released': 'ソフトウェアの公開のみ（動作未確認）',
  'software-reported': 'ソフトウェアの公開・報道（動作未確認）',
};
const METHOD_LABEL = { attention: '注目度', importance: '重要度', direction: '動向', verification: '検証状態', window: '比較期間', times: '時刻', merge: '統合' };

const state = {
  snap: null,
  status: '',
  lang: '',
  q: '',
  hideMain: true,
  tab: 'board',
  board: { region: '', window: '', topic: '', cat: '', ver: '', sort: 'attention', alt: '', active: false },
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

/* ---------------- トレンド一覧（同じ話題を統合したトレンド単位） ---------------- */
const CAT = { sns: 'SNS', community: 'コミュニティ', slang: 'スラング・ミーム', video: '動画', tech: 'テック', mainstream: 'ニュース・一般', other: 'その他' };
const BOARD_SORT = {
  attention: (a, b) => b.attention - a.attention,
  importance: (a, b) => (b.importance ?? -1) - (a.importance ?? -1) || b.attention - a.attention,
  rise: (a, b) => (b.rise ?? 0) - (a.rise ?? 0) || b.attention - a.attention,
  first: (a, b) => b.first - a.first || b.attention - a.attention,
  duration: (a, b) => (b.durationH ?? 0) - (a.durationH ?? 0) || b.attention - a.attention,
  spread: (a, b) => b.spread - a.spread || b.attention - a.attention,
  posts: (a, b) => (b.posts ?? 0) - (a.posts ?? 0) || b.attention - a.attention,
};

/** v2 以前のスナップショット（語単位のみ）を、トレンド表示用の形に読み替える */
function legacyTrend(t) {
  const dir = t.dir || (t.status === 'new' && t.runs <= 1 ? 'new' : t.vel >= 0.25 ? 'rising' : t.vel <= -0.25 ? 'falling' : 'flat');
  return {
    id: `k:${t.k}`, k: t.k, t: t.t, members: [{ k: t.k, t: t.t, score: t.score }], merged: 0, lang: t.lang,
    attention: t.score, importance: null, impReason: '旧形式のデータのため判定なし', dir, basisText: '', rise: t.vel,
    verification: { status: 'unverified', label: VER.unverified.label, notes: [] }, topic: 'other', topics: ['other'],
    srcCat: t.cat, srcs: t.srcs, srcCount: {}, spread: t.spread, posts: t.samples?.length || 1, first: t.first,
    durationH: (Date.now() - t.first) / 3.6e6, spark: t.spark, persistence: { label: '' },
    evidence: (t.samples || []).map((x) => ({ s: x.s, x: x.x, u: x.u, type: 'sns', pt: x.ts })),
  };
}
function allTrends() {
  const s = state.snap;
  if (!s) return [];
  return Array.isArray(s.trends) ? s.trends : (s.terms ?? []).map(legacyTrend);
}
function findTrend(id) {
  return allTrends().find((c) => c.id === id);
}

function boardTrends() {
  const b = state.board;
  const now = Date.now();
  return allTrends()
    .filter((c) => {
      // 地域：日英両方に出ているトレンド（mix）はどちらの地域にも出す
      if (b.region && c.lang !== b.region && c.lang !== 'mix') return false;
      if (b.window && now - c.first > Number(b.window) * 3.6e6) return false;
      if (b.topic && !(c.topics || [c.topic]).includes(b.topic)) return false;
      if (b.cat && (c.srcCat || 'other') !== b.cat) return false;
      if (b.ver && c.verification?.status !== b.ver) return false;
      if (b.active && !(c.dir === 'rising' || c.dir === 'new')) return false;
      return true;
    })
    .sort(BOARD_SORT[b.alt || b.sort] || BOARD_SORT.attention);
}

function pct(v) {
  return `${v >= 0 ? '+' : '−'}${Math.round(Math.abs(v) * 100)}%`;
}
/** 動向セル：NEW／上昇中／横ばい／下降中 を共通ルールで表示し、根拠をツールチップに出す */
function dirBadge(c, { withPct = true } = {}) {
  const d = DIR[c.dir] || DIR.flat;
  const raw = c.basis?.raw;
  // 横ばいの行に「+42%」などを並べると矛盾して見えるので、％は上昇中・下降中のときだけ（根拠はツールチップ）
  const extra = withPct && (c.dir === 'rising' || c.dir === 'falling') && raw != null ? `<small>${pct(raw)}</small>` : '';
  return `<span class="dir dir--${d.cls}" title="${esc(c.basisText || '判定の根拠なし')}">${d.icon} ${d.label}${extra}</span>`;
}
function verBadge(v) {
  const st = v?.status || 'unverified';
  const tip = [VER[st]?.desc, ...(v?.notes || [])].filter(Boolean).join('\n');
  return `<span class="ver ver--${st}" title="${esc(tip)}">${esc(v?.label || VER[st].label)}</span>`;
}
function topicChip(id) {
  return `<span class="tchip tchip--${esc(id || 'other')}">${esc(TOPIC[id] || TOPIC.other)}</span>`;
}
function impCell(c) {
  if (c.importance == null) return `<span class="mute" title="${esc(c.impReason || 'データ不足')}">保留</span>`;
  return `<span class="meter meter--imp" title="${esc(c.impReason || '')}"><span class="meter__bar"><i style="width:${c.importance}%"></i></span><b>${c.importance}</b></span>`;
}
function headOf(c) {
  // 語そのものだけのトピック名は飛ばし、文脈が分かる見出しを優先
  const norm = (x) => String(x).toLowerCase().replace(/[#\s]/g, '');
  return c.evidence?.find((x) => norm(x.x) !== norm(c.t) && x.type !== 'search');
}

function renderBoard() {
  const list = boardTrends();
  const s = state.snap;
  $('#board-empty').hidden = list.length > 0 || !s;
  if (s) {
    const st = s.stats || {};
    const merged = st.mergedTerms ? ` · ${st.terms} 語を ${st.trends} 件に統合` : '';
    $('#board-sub').textContent = `${list.length} 件のトレンド${merged} · 収集 ${clock(s.generatedAt)} · ${st.sourcesUp}/${st.sourcesTotal} 媒体・${(st.usableSignals ?? st.signals).toLocaleString()} 件の投稿${st.stories ? `（独立した記事・投稿 ${st.stories} 件）` : ''}`;
    $('#board-legend').textContent = `注目度＝SNS・コミュニティでの盛り上がり（今回の観測内で最上位＝100）／重要度＝社会的な重要度の推定（別の尺度・データ不足なら「保留」）。動向の根拠は「動向」にマウスを乗せると表示されます。比較期間：前回観測（${s.intervalH || 3}時間前）・24時間前・48時間前。${st.droppedGeneric ? `文脈のない一般語 ${st.droppedGeneric} 件を除外。` : ''}`;
  }
  $('#board').innerHTML = list
    .map((c, i) => {
      const head = headOf(c);
      const mergedTip = c.members?.slice(1).map((m) => m.t).join('、');
      return `<tr data-trend="${esc(c.id)}" tabindex="0">
        <td class="c-rank">${i + 1}</td>
        <td class="c-term">
          <div class="bt"><b>${esc(c.t)}</b>${c.merged ? `<span class="merged" title="統合した語：${esc(mergedTip)}">＋${c.merged}語</span>` : ''}${topicChip(c.topic)}${verBadge(c.verification)}</div>
          ${head ? `<div class="bh">${srcMeta(head.s).icon} ${esc(head.x)}</div>` : ''}
        </td>
        <td class="c-heat"><span class="meter"><span class="meter__bar"><i style="width:${c.attention}%"></i></span><b>${c.attention}</b></span></td>
        <td class="c-imp">${impCell(c)}</td>
        <td class="c-vel">${dirBadge(c)}</td>
        <td class="c-start">${ago(c.first)}${c.persistence?.label ? `<small>${esc(c.persistence.label)}</small>` : ''}</td>
        <td class="c-spark">${sparkline(c.spark, { w: 110, h: 30 })}</td>
        <td class="c-src">${(c.srcs || []).slice(0, 5).map((id) => `<span title="${esc(srcMeta(id).label)}">${srcMeta(id).icon}</span>`).join('')}${c.spread > 5 ? `<small>+${c.spread - 5}</small>` : ''}<small class="posts">投稿 ${c.posts ?? '-'}</small></td>
      </tr>`;
    })
    .join('');
}

function bindBoard() {
  for (const [id, key] of [['#b-region', 'region'], ['#b-window', 'window'], ['#b-sortseg', 'sort']]) {
    $(id).addEventListener('click', (e) => {
      const btn = e.target.closest('[data-v]');
      if (!btn) return;
      state.board[key] = btn.dataset.v;
      if (key === 'sort') {
        state.board.alt = '';
        $('#b-sort').value = '';
      }
      $$(`${id} button`).forEach((x) => x.classList.toggle('is-on', x === btn));
      renderBoard();
    });
  }
  for (const [id, key] of [['#b-topic', 'topic'], ['#b-cat', 'cat'], ['#b-ver', 'ver']]) {
    $(id).addEventListener('change', (e) => ((state.board[key] = e.target.value), renderBoard()));
  }
  $('#b-sort').addEventListener('change', (e) => {
    state.board.alt = e.target.value;
    $$('#b-sortseg button').forEach((x) => x.classList.toggle('is-on', !e.target.value && x.dataset.v === state.board.sort));
    renderBoard();
  });
  $('#b-active').addEventListener('change', (e) => ((state.board.active = e.target.checked), renderBoard()));
  $('#board').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('tr[data-trend]')) openTrend(e.target.dataset.trend);
  });
}

/* ---------------- 世界の情勢（注目度とは別の採点） ---------------- */
function safeWorldUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : '#';
  } catch { return '#'; }
}

function trendLink(id, text) {
  return findTrend(id) ? `<button class="linkbtn" data-trend="${esc(id)}">${esc(text)}</button>` : `<span>${esc(text)}</span>`;
}

function renderBrief() {
  const sm = state.snap?.summary;
  $('#world-headline').textContent = sm ? sm.headline : '';
  if (!sm) {
    for (const id of ['#brief-changes', '#brief-emerging', '#brief-watch', '#brief-overview', '#themes']) $(id).innerHTML = '';
    return;
  }
  $('#brief-changes').innerHTML = sm.changes.length
    ? sm.changes
        .map((x) => `<li class="brief__item">
          <div class="brief__top">${topicChip(x.topic)}${verBadge(x.verification)}${x.dir ? dirBadge({ dir: x.dir }, { withPct: false }) : ''}<span class="imp">重要度 <b>${x.importance}</b></span></div>
          <h3>${x.kind === 'trend' ? trendLink(x.id, x.title) : esc(x.title)}</h3>
          <dl class="wwu"><div><dt>何が起きたか</dt><dd>${esc(x.what)}</dd></div><div><dt>なぜ重要か</dt><dd>${esc(x.why)}</dd></div><div><dt>何が未確認か</dt><dd>${esc(x.unknown)}</dd></div></dl>
          ${x.url ? `<a class="src-link" href="${esc(safeWorldUrl(x.url))}" target="_blank" rel="noopener noreferrer nofollow">情報源を開く ↗</a>` : ''}
        </li>`)
        .join('')
    : '<li class="mute">今回の観測では、重要度を判定できる大きな変化は見つかりませんでした。</li>';
  $('#brief-emerging').innerHTML = sm.emerging.length
    ? sm.emerging.map((x) => `<li>${trendLink(x.id, x.t)}<small>${esc(x.topicLabel)} · ${DIR[x.dir]?.label ?? ''} · ${esc(VER[x.verification]?.label ?? '')} · 投稿 ${x.posts}</small></li>`).join('')
    : '<li class="mute">該当なし</li>';
  $('#brief-watch').innerHTML = sm.watch.length
    ? sm.watch
        .map((w) => `<li>${w.onBoard ? trendLink(w.id, w.t) : `<span>${esc(w.t)}</span>`}${sparkline(w.spark, { w: 64, h: 18, fill: false })}<small>${esc(w.persistence.label)} · 最高重要度 ${w.peakImp} · ${w.runs} 回観測 · ${w.onBoard ? `${DIR[w.dir]?.label ?? ''}` : `ランキング外（最終観測 ${ago(w.last)}）`}</small></li>`)
        .join('')
    : '<li class="mute">まだ継続して追跡している重要な話題はありません（数回の観測が必要です）。</li>';
  $('#brief-overview').innerHTML = sm.overview.length
    ? sm.overview.map((o) => `<li><b>${esc(o.label)}</b><small>${o.n} 件 · 平均重要度 ${o.avg}${o.rising ? ` · 新規/上昇 ${o.rising}` : ''}${o.falling ? ` · 下降 ${o.falling}` : ''}</small></li>`).join('')
    : '<li class="mute">該当なし</li>';
  const themes = state.snap.themes || [];
  $('#themes').innerHTML = themes.length
    ? themes
        .map((t) => `<article class="theme">
          <h3>${esc(t.label)} <small class="mute">${t.size} 件の話題</small></h3>
          <p><b>背景</b>${esc(t.background)}</p>
          <p><b>共通点</b>${esc(t.common)}</p>
          <p><b>相違点</b>${t.differences.map(esc).join(' ／ ')}</p>
          <p><b>今後の影響</b>${esc(t.outlook)}</p>
          <p class="theme__caution">${esc(t.caution)}</p>
          <div class="theme__list">${t.clusters.map((c) => `<span>${topicChip(c.topic)}${trendLink(c.id, c.t)}</span>`).join('')}</div>
        </article>`)
        .join('')
    : '<p class="mute">複数の話題に共通する大きな動きは、今回の観測では見つかりませんでした。</p>';
}

function renderWorld() {
  const analysis = state.snap?.analysis;
  const summary = $('#world-summary');
  const root = $('#world-events');
  if (!root || !summary) return;
  renderBrief();
  if (!analysis) {
    summary.textContent = '旧形式の観測データです。次回の収集後に分析が表示されます。';
    root.innerHTML = '';
    $('#world-empty').hidden = true;
    return;
  }
  const category = $('#world-cat').value;
  const events = (analysis.events || []).filter((e) => !category || e.category === category);
  const st = analysis.stats || {};
  summary.textContent = events.length + ' 件 · ' + (st.reviewed || 0) + ' 件の観測を分析 · 不審な配布宣伝 ' + (st.flagged || 0) + ' 件を除外 · 重複 ' + (st.duplicates || 0) + ' 件を整理';
  root.innerHTML = events.map((e) => {
    const imp = e.importance ?? e.impact;
    return `<article class="world-event">
      <div class="world-event__top"><span class="world-event__cat">${esc(e.categoryLabel)}</span>${e.verification ? verBadge(e.verification) : ''}<span class="world-event__impact" title="${esc(e.impReason || '')}">重要度 ${imp == null ? '保留' : esc(imp) + '/100'}</span></div>
      <h2>${esc(e.title)}</h2>
      <p class="world-event__meta">${e.at ? ago(e.at) : ''} · ${esc(e.sourceCount)}媒体で観測 · 発信元ドメイン ${esc(e.publisherCount ?? '-')}</p>
      <p class="world-event__caution">${esc(e.verification?.notes?.[0] || e.caution)}</p>
      <div class="world-event__sources">${(e.evidence || []).map((s) => `<a href="${esc(safeWorldUrl(s.link || s.url))}" target="_blank" rel="noopener noreferrer nofollow" title="${esc(s.title)}">${esc(srcMeta(s.source).label)}：情報源 ↗</a>`).join('')}</div>
    </article>`;
  }).join('');
  $('#world-empty').hidden = events.length > 0;
}

/* ---------------- フィード ---------------- */
function filteredTerms() {
  const terms = state.snap?.terms ?? [];
  const q = state.q.trim().toLowerCase();
  return terms.filter((t) => {
    if (state.lang && t.lang !== state.lang) return false;
    if (state.status && t.status !== state.status && !t.badges.includes(state.status)) return false;
    if (state.hideMain && t.main && t.spread <= 2 && !state.status) return false;
    if (q && !t.t.toLowerCase().includes(q) && !t.k.includes(q)) return false;
    return true;
  });
}

function renderCard(t, i) {
  const isOn = Boolean(notes[t.k]);
  const vel = t.dir ? dirBadge({ dir: t.dir, basis: t.basis, basisText: '' }) : t.vel > 0.05 ? `<span class="vel-up">▲${Math.round(t.vel * 100)}%</span>` : t.vel < -0.05 ? `<span class="vel-down">▼${Math.round(-t.vel * 100)}%</span>` : '<span>±0%</span>';
  // 「上昇中」は動向ルール（dir）で上昇と判定されたときだけ。0% やマイナスで上昇中とは出さない
  const hl = t.hl == null ? (t.dir === 'rising' ? '上昇中' : '観測中') : `半減期 ~${t.hl < 1 ? '<1' : Math.round(t.hl)}h`;
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
        ${t.cl && findTrend(t.cl) ? `<button class="act" data-trend="${esc(t.cl)}">トレンド全体を見る</button>` : ''}
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
  const top = allTrends().filter((t) => !t.main).slice(0, 24);
  const html = top
    .map((t) => `<button class="ticker__item" tabindex="-1" data-trend="${esc(t.id)}">${DIR[t.dir]?.icon ?? ''} <b>${esc(t.t)}</b><i>${DIR[t.dir]?.label ?? ''}</i></button>`)
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
  renderWorld();
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
  if (push) {
    setParam('trend', '');
    setParam('term', key);
  }

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

/* ---------------- トレンド（統合単位）の詳細 ---------------- */
function safeUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : '#';
  } catch {
    return '#';
  }
}

async function openTrend(id, { push = true } = {}) {
  const c = findTrend(id);
  if (!c) return;
  const dlg = $('#drawer');
  const s = state.snap;
  $('#dr-title').textContent = c.t;
  $('#dr-kicker').textContent = `${TOPIC[c.topic] ?? ''} · 注目度 ${c.attention} · 重要度 ${c.importance ?? '保留'} · ${DIR[c.dir]?.label ?? ''}`;
  const v = c.verification || {};
  const ch = (x) => (x ? esc(x.label) : '—');
  const factors = (c.impFactors || []).map((f) => `<li><span>${esc(f.k)}</span><b>${f.v > 0 ? '+' : ''}${f.v}</b></li>`).join('');
  const evidence = (c.evidence || [])
    .map((e) => {
      const m = srcMeta(e.s);
      const main = e.l || e.u;
      return `<li><span title="${esc(m.label)}">${m.icon}</span><span class="stype stype--${esc(e.type)}">${esc(STYPE[e.type] ?? e.type)}</span><a href="${esc(safeUrl(main))}" target="_blank" rel="noopener noreferrer nofollow">${esc(e.x)}</a>
        <small>${esc(e.host || '')} · ${e.pt ? `公開 ${clock(e.pt)}` : '公開時刻不明'}${e.dup ? ` · 同じ記事の再投稿 ${e.dup} 件` : ''}${e.l && e.u && e.u !== e.l ? ` · <a href="${esc(safeUrl(e.u))}" target="_blank" rel="noopener noreferrer nofollow">${esc(m.label)}の投稿</a>` : ''}</small></li>`;
    })
    .join('');
  const srcs = Object.entries(c.srcCount || {}).sort((a, b) => b[1] - a[1]);
  $('#dr-body').innerHTML = `
    <section>
      <dl class="kv kv--wide">
        <div><dt>注目度</dt><dd>${c.attention}<small>今回の観測内の相対値</small></dd></div>
        <div><dt>重要度</dt><dd>${c.importance ?? '保留'}<small>${esc(c.importance == null ? c.impReason || 'データ不足' : `確度 ${{ high: '高', medium: '中', low: '低' }[c.impConf] ?? '-'}`)}</small></dd></div>
        <div><dt>動向</dt><dd>${dirBadge(c)}</dd></div>
        <div><dt>検証状態</dt><dd>${verBadge(v)}</dd></div>
        <div><dt>分野</dt><dd>${(c.topics || [c.topic]).map(topicChip).join(' ')}</dd></div>
        <div><dt>段階</dt><dd>${esc(STAGE_R[v.stage] ?? '—')}</dd></div>
      </dl>
      <p class="basis"><b>動向の根拠：</b>${esc(c.basisText || '—')}</p>
    </section>
    <section>
      <h3>検証メモ</h3>
      <ul class="notes-v">${[VER[v.status]?.desc, ...(v.notes || [])].filter(Boolean).map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
      <p class="mute small">情報源の内訳：${Object.entries(v.byType || {}).map(([k, n]) => `${esc(STYPE[k] ?? k)} ${n}`).join('・') || '—'} · 独立した報道・公式 ${v.independent ?? 0} 件 · 発信元ドメイン ${v.domains ?? 0} 件</p>
    </section>
    <section>
      <h3>重要度の内訳</h3>
      ${factors ? `<ul class="factors">${factors}</ul>` : `<p class="mute">${esc(c.impReason || '判定なし')}</p>`}
    </section>
    ${c.members?.length > 1 ? `<section><h3>統合した語（${c.members.length}）</h3><div class="badges">${c.members.map((m) => `<button class="badge" data-open="${esc(m.k)}">${esc(m.t)} <small>${m.score}</small></button>`).join('')}</div></section>` : ''}
    <section>
      <h3>根拠となる原文（独立した記事・投稿 ${c.posts ?? '-'} 件${c.reposts ? `、再投稿 ${c.reposts} 件` : ''}）</h3>
      <ul class="samples evidence">${evidence || '<li class="mute">なし</li>'}</ul>
    </section>
    <section>
      <h3>継続性</h3>
      <dl class="kv">
        <div><dt>初回検出</dt><dd>${clock(c.first)}</dd></div>
        <div><dt>元情報の最新公開</dt><dd>${c.lastPub ? clock(c.lastPub) : '不明'}</dd></div>
        <div><dt>収集時刻</dt><dd>${s ? clock(s.generatedAt) : '-'}</dd></div>
        <div><dt>継続時間</dt><dd>${c.durationH != null ? `${Math.round(c.durationH)} 時間` : '-'}</dd></div>
        <div><dt>観測回数</dt><dd>${c.runs ?? '-'}</dd></div>
        <div><dt>推移の型</dt><dd>${esc(c.persistence?.label || '-')}</dd></div>
        <div><dt>24時間前比</dt><dd>${ch(c.change24)}</dd></div>
        <div><dt>48時間前比</dt><dd>${ch(c.change48)}</dd></div>
        <div><dt>新しい投稿</dt><dd>${c.newPosts == null ? '—' : `${c.newPosts} 件`}</dd></div>
      </dl>
      ${sparkline(c.spark, { w: 520, h: 90, cls: 'chart' })}
    </section>
    <section>
      <h3>出現した媒体（${c.spread}）・発信元 ${c.voices ?? '-'}</h3>
      <div class="badges">${srcs.map(([sid, n]) => `<span class="badge">${srcMeta(sid).icon} ${esc(srcMeta(sid).label)} ×${n}</span>`).join('')}</div>
    </section>
    <section id="dr-defs"><h3>意味・背景</h3><div class="skeleton"></div></section>
    <section>
      <h3>いま現場を見る</h3>
      <div class="actions">${searchLinks(c.t).map(([n, u]) => `<a class="act" href="${esc(u)}" target="_blank" rel="noopener nofollow">${n}</a>`).join('')}
        <button class="act" data-star="${esc(c.k)}">${notes[c.k] ? '★ ネタ帳から外す' : '☆ ネタ帳に追加'}</button>
      </div>
    </section>`;
  if (!dlg.open) dlg.showModal();
  if (push) {
    setParam('term', '');
    setParam('trend', id);
  }
  try {
    const { defs } = await api(`/api/term?k=${encodeURIComponent(c.k)}`);
    const el = $('#dr-defs');
    if (el)
      el.innerHTML = `<h3>意味・背景</h3>${defs.length
        ? defs.map((d) => `<div class="def"><p>${esc(d.text)}</p>${d.example ? `<em>例：${esc(d.example)}</em>` : ''}<a href="${esc(safeUrl(d.url))}" target="_blank" rel="noopener">${esc(d.source)} ↗</a></div>`).join('')
        : '<div class="def"><p class="mute">辞書にはまだ載っていません。上の原文から文脈を確認してください。</p></div>'}`;
  } catch {
    const el = $('#dr-defs');
    if (el) el.innerHTML = '<h3>意味・背景</h3><p class="mute">辞書情報を取得できませんでした。</p>';
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
  const GENRE = { sns: 'SNS', community: 'コミュニティ', slang: 'スラング辞典', video: '動画', tech: '技術', mainstream: '主流の物差し' };
  const cov = s.coverage;
  $('#coverage').innerHTML = cov
    ? `<h2>観測の偏り・データの状態</h2>
      <p class="mute">収集 ${clock(s.generatedAt)} · 投稿 ${cov.total.toLocaleString()} 件（日本語 ${cov.byLang.ja} · 英語 ${cov.byLang.en}）</p>
      <ul>${cov.warnings.length ? cov.warnings.map((w) => `<li>⚠ ${esc(w)}</li>`).join('') : '<li>大きな偏りは検出されていません。</li>'}</ul>
      <div class="covbars">${cov.bySource.map((b) => `<div><span>${srcMeta(b.id).icon} ${esc(b.label)}</span><span class="meter"><span class="meter__bar"><i style="width:${Math.min(100, b.share * 2)}%"></i></span><b>${b.share}%</b></span></div>`).join('')}</div>`
    : '';
  $('#method').innerHTML = s.method
    ? `<h2>スコアの算出基準・比較期間</h2><ul>${Object.entries(s.method).map(([k, t]) => `<li><b>${esc(METHOD_LABEL[k] ?? k)}</b> … ${esc(String(t).replace(/^[^：]+：/, ''))}</li>`).join('')}</ul>`
    : '';
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
  if (tab === 'world') renderWorld();
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
  $('#world-cat').addEventListener('change', renderWorld);
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-trend],[data-open],[data-star],[data-copy],[data-lexq],[data-page]');
    if (!t) return;
    if (t.dataset.trend) return openTrend(t.dataset.trend);
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
  $('#drawer').addEventListener('close', () => {
    setParam('term', '');
    setParam('trend', '');
  });
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
  const trend = params.get('trend');
  if (trend && findTrend(trend)) openTrend(trend, { push: false });
  else if (term) openTerm(term, { push: false });
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
