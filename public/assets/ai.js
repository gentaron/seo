/**
 * AI Pulse — フロントエンド（依存なし・素の ES Modules）
 * 状態は URL（?cat= / ?e=）と localStorage（配色）にだけ持つ。4 分ごとに新しい観測を確認する。
 */

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const POLL_MS = 4 * 60 * 1000;
const PAGE = 25;

const FAM = {
  community: 'コミュニティ',
  code: 'コード',
  models: 'モデル',
  research: '研究',
  news: '報道',
  japan: '日本',
  products: 'プロダクト',
  search: '検索・関心',
};
const FAM_IDS = Object.keys(FAM);
const STATUS = {
  breakout: '急浮上',
  surging: '急騰',
  rising: '上昇',
  steady: '定着',
  cooling: '失速',
};
const SRC_LABEL = {
  hackernews: 'Hacker News', reddit: 'Reddit', lobsters: 'Lobsters', devto: 'DEV', mastodon: 'Mastodon', bluesky: 'Bluesky',
  github: 'GitHub', hfmodels: 'Hugging Face', hfspaces: 'HF Spaces', hfpapers: 'HF Papers', newsen: 'Google News',
  press: 'テック媒体', newsja: 'Google News 日本', hatena: 'はてブ', zenn: 'Zenn', qiita: 'Qiita',
  producthunt: 'Product Hunt', wikipedia: 'Wikipedia', googletrends: 'Google トレンド',
};

const state = {
  snap: null,
  cat: new URLSearchParams(location.search).get('cat') || '',
  onlyUp: false,
  shown: PAGE,
  pending: null,
};

/* ---------------- 保存（配色） ---------------- */
const ls = {
  get(k, d) {
    try {
      const v = localStorage.getItem(k);
      return v == null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {
      /* 保存できない環境では何もしない */
    }
  },
};

/* ---------------- 表示ユーティリティ ---------------- */
function ago(ts) {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return 'たった今';
  if (s < 3600) return `${Math.floor(s / 60)}分前`;
  if (s < 86400) return `${Math.floor(s / 3600)}時間前`;
  return `${Math.floor(s / 86400)}日前`;
}
function fmt(n) {
  return Number(n || 0).toLocaleString('ja-JP');
}
const famColor = (f) => `var(--f-${f})`;

let uid = 0;
/** 折れ線（面グラフ付き） */
function chart(values, { w = 300, h = 80, stroke = 'var(--hot-1)', fill = true, dot = true, pad = 4 } = {}) {
  const vals = (values?.length ? values : [0]).map((v) => Math.max(0, Number(v) || 0));
  const pts = vals.length === 1 ? [vals[0], vals[0]] : vals;
  const max = Math.max(...pts, 0.0001);
  const step = w / (pts.length - 1);
  const xy = pts.map((v, i) => [i * step, h - pad - (v / max) * (h - pad * 2)]);
  // なめらかな曲線（Catmull-Rom → Bezier）
  let d = `M${xy[0][0].toFixed(1)} ${xy[0][1].toFixed(1)}`;
  for (let i = 0; i < xy.length - 1; i += 1) {
    const p0 = xy[i - 1] || xy[i];
    const p1 = xy[i];
    const p2 = xy[i + 1];
    const p3 = xy[i + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(1)} ${Math.min(h, c1[1]).toFixed(1)} ${c2[0].toFixed(1)} ${Math.min(h, c2[1]).toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  const id = `g${(uid += 1)}`;
  const last = xy[xy.length - 1];
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
    <defs><linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${stroke}" stop-opacity=".28"/><stop offset="1" stop-color="${stroke}" stop-opacity="0"/></linearGradient></defs>
    ${fill ? `<path d="${d} L${w} ${h} L0 ${h} Z" fill="url(#${id})"/>` : ''}
    <path d="${d}" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
    ${dot ? `<circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="3" fill="${stroke}" vector-effect="non-scaling-stroke"/>` : ''}
  </svg>`;
}

function ring(v, { small = false } = {}) {
  const r = 46;
  const c = 2 * Math.PI * r;
  const id = `r${(uid += 1)}`;
  const off = c * (1 - Math.min(100, v) / 100);
  return `<div class="ring${small ? ' ring--s' : ''}" role="img" aria-label="Hype ${v}">
    <svg viewBox="0 0 100 100"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--hot-2)"/><stop offset="1" stop-color="var(--hot-1)"/></linearGradient></defs>
      <circle class="ring__track" cx="50" cy="50" r="${r}" fill="none" stroke-width="8"/>
      <circle class="ring__bar" cx="50" cy="50" r="${r}" fill="none" stroke="url(#${id})" stroke-width="8" stroke-linecap="round" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${c.toFixed(1)}" data-off="${off.toFixed(1)}"/></svg>
    <div class="ring__v"><div><b>${v}</b><small>HYPE</small></div></div>
  </div>`;
}
function animateRings(root = document) {
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      for (const el of $$('.ring__bar[data-off]', root)) el.style.strokeDashoffset = el.dataset.off;
    }),
  );
}

function statusChip(st) {
  return `<span class="chip st st--${esc(st)}">${esc(STATUS[st] || st)}</span>`;
}
function dots(t) {
  return `<span class="dots" aria-label="${esc(layersText(t))}">${FAM_IDS.map((f) => {
    const v = t.fams?.[f] || 0;
    return `<i class="${v >= 0.05 ? 'on' : ''}${v >= 0.45 ? ' hi' : ''}" style="--c:${famColor(f)}" title="${esc(FAM[f])}"></i>`;
  }).join('')}</span>`;
}
function layersText(t) {
  const on = FAM_IDS.filter((f) => (t.fams?.[f] || 0) >= 0.05).map((f) => FAM[f]);
  return on.length ? `${on.length}層で話題：${on.join('・')}` : '';
}
function move(t) {
  if (t.prevRank == null) return '<span class="row__mv nw">NEW</span>';
  const d = t.prevRank - t.rank;
  if (d > 0) return `<span class="row__mv up">▲${d}</span>`;
  if (d < 0) return `<span class="row__mv dn">▼${-d}</span>`;
  return '<span class="row__mv dn">—</span>';
}
function subline(t) {
  const bits = [];
  if (t.org) bits.push(t.org);
  bits.push(t.catLabel);
  if (t.facts?.[0]) bits.push(t.facts[0].label);
  return bits.join(' · ');
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

function toast(html, { action, onAction, ms = 5000 } = {}) {
  const el = $('#toast');
  el.innerHTML = `<span>${html}</span>${action ? `<button type="button">${esc(action)}</button>` : ''}`;
  el.hidden = false;
  if (action)
    $('button', el).onclick = () => {
      el.hidden = true;
      onAction?.();
    };
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (el.hidden = true), ms);
}

/* ---------------- 描画 ---------------- */
function countUp(el, to) {
  if (!el) return;
  const from = Number(el.dataset.v || 0);
  el.dataset.v = to;
  if (reduceMotion || from === to) {
    el.textContent = fmt(to);
    return;
  }
  const t0 = performance.now();
  const dur = 900;
  const tick = (now) => {
    const p = Math.min(1, (now - t0) / dur);
    const e = 1 - (1 - p) ** 3;
    el.textContent = fmt(Math.round(from + (to - from) * e));
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function renderKpis(s) {
  countUp($('#k-signals'), s.stats?.signals || 0);
  countUp($('#k-sources'), s.stats?.sourcesUp || 0);
  $('#k-sources-total').textContent = ` / ${s.stats?.sourcesTotal || 0}`;
  countUp($('#k-pubs'), s.stats?.publishers || 0);
}

function renderSpot(s) {
  const t = s.top?.[0];
  const el = $('#spot');
  if (!t) {
    el.innerHTML = '<p>観測データがまだありません。</p>';
    return;
  }
  el.dataset.id = t.id;
  el.setAttribute('role', 'button');
  el.tabIndex = 0;
  el.setAttribute('aria-label', `1位 ${t.name} の詳細を開く`);
  const facts = (t.facts || []).slice(0, 4);
  el.innerHTML = `
    <div>
      <div class="spot__k"><span class="spot__no">NO.1</span>${statusChip(t.status)}<span class="chip">${esc(t.catLabel)}</span></div>
      <h3 class="spot__name">${esc(t.name.length <= 24 ? t.name.replace(/-/g, '\u2011') : t.name)}</h3>
      <p class="spot__org">${esc([t.org, layersText(t)].filter(Boolean).join(' — '))}</p>
      <ul class="spot__facts">${facts.map((f) => `<li><i style="background:${famColor(f.fam)}"></i>${esc(f.label)}</li>`).join('')}</ul>
      <span class="spot__cta">根拠をすべて見る<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
    </div>
    <div class="spot__side">
      <div class="spot__score">${ring(t.hype)}
        <div class="spot__chart" style="flex:1;min-width:0">${chart(t.spark, { h: 70, stroke: '#ff375f' })}<small>熱量の推移（観測ごと）</small></div>
      </div>
      <div class="const">${FAM_IDS.map((f) => `<span class="${(t.fams?.[f] || 0) >= 0.05 ? 'on' : ''}" style="--c:${famColor(f)}"><i></i>${esc(FAM[f])}</span>`).join('')}</div>
    </div>`;
  animateRings(el);
}

function renderRise(s) {
  const list = (s.top || []).filter((t) => t.status === 'breakout' || t.status === 'surging').slice(0, 10);
  $('#rise-sec').hidden = !list.length;
  $('#rise').innerHTML = list
    .map(
      (t) => `<button class="rcard" role="listitem" data-id="${esc(t.id)}">
        <span style="display:flex;gap:6px;flex-wrap:wrap">${statusChip(t.status)}<span class="chip">${esc(t.catLabel)}</span></span>
        <span class="rcard__name">${esc(t.name)}</span>
        <span class="rcard__fact">${esc((t.facts || []).slice(0, 2).map((f) => f.label).join(' / '))}</span>
        <span class="rcard__foot"><span class="rcard__hype">${t.hype}<small>HYPE</small></span>${dots(t)}</span>
      </button>`,
    )
    .join('');
}

function filtered() {
  let list = state.snap?.top || [];
  if (state.cat) list = list.filter((t) => t.cat === state.cat);
  if (state.onlyUp) list = list.filter((t) => ['breakout', 'surging', 'rising'].includes(t.status));
  return list;
}

function renderRank({ animate = false } = {}) {
  const list = filtered();
  const shown = list.slice(0, state.shown);
  $('#rank').innerHTML = shown
    .map(
      (t, i) => `<li class="row${animate ? ' is-enter' : ''}" style="${animate ? `animation-delay:${Math.min(i, 14) * 22}ms` : ''}">
      <button class="row__btn" data-id="${esc(t.id)}" aria-label="${t.rank}位 ${esc(t.name)}、Hype ${t.hype}、${esc(STATUS[t.status] || '')}">
        <span class="row__no"><b>${t.rank}</b>${move(t)}</span>
        <span class="row__main">
          <span class="row__name"><b>${esc(t.name)}</b>${t.status !== 'steady' ? statusChip(t.status) : ''}</span>
          <span class="row__sub">${esc(subline(t))}</span>
        </span>
        <span class="row__meta">${dots(t)}<span class="row__spark">${chart(t.spark, { w: 96, h: 30, stroke: t.z >= 0.5 ? 'var(--hot-1)' : 'var(--tx-3)', dot: false })}</span></span>
        <span class="row__hype"><b>${t.hype}</b><span class="bar"><i style="transform:scaleX(${(t.hype / 100).toFixed(3)})"></i></span></span>
      </button>
    </li>`,
    )
    .join('');
  $('#rank-empty').hidden = list.length > 0;
  $('#rank').hidden = list.length === 0;
  const more = $('#more');
  more.hidden = list.length <= state.shown;
  more.textContent = `もっと見る（残り ${Math.max(0, list.length - state.shown)}）`;
}

function renderLegend() {
  $('#legend').innerHTML = FAM_IDS.map((f) => `<span><i style="--c:${famColor(f)}"></i>${esc(FAM[f])}</span>`).join('');
}

function renderThemes(s) {
  const list = (s.themes || []).filter((t) => t.heat > 0).slice(0, 7);
  $('#themes').innerHTML = list
    .map((th, i) => {
      const trend = th.z >= 0.5 ? `<span class="tile__trend up">↑ 伸びている</span>` : th.z <= -0.5 ? `<span class="tile__trend dn">↓ 落ち着いてきた</span>` : '<span class="tile__trend dn">→ 横ばい</span>';
      return `<article class="tile${i === 0 ? ' tile--xl' : ''}" data-reveal>
        <div class="tile__top"><span class="tile__ic" aria-hidden="true">${esc(th.icon)}</span>${trend}</div>
        <h3 class="tile__name">${esc(th.label)}</h3>
        <div class="tile__heat">${th.heat}<small>/ 100</small></div>
        <div class="tile__spark">${chart(th.spark, { h: 44, stroke: i === 0 ? 'var(--hot-1)' : 'var(--accent)', dot: false })}</div>
        <div class="tile__ents">${th.top.map((e) => `<button class="chip" data-id="${esc(e.id)}">${esc(e.name)}</button>`).join('')}</div>
      </article>`;
    })
    .join('');
  observeReveal($('#themes'));
}

function renderNet(s) {
  const byFam = {};
  for (const src of s.sources || []) (byFam[src.fam] = byFam[src.fam] || []).push(src);
  $('#net').innerHTML = FAM_IDS.filter((f) => byFam[f])
    .map((f) => {
      const list = byFam[f];
      const up = list.filter((x) => x.ok).length;
      return `<section class="fam" style="--c:${famColor(f)}">
        <h3><i></i>${esc(FAM[f])}<small>${up}/${list.length} 稼働</small></h3>
        <ul>${list
          .map((x) => `<li title="${esc(x.error || '')}"><span class="ok${x.ok ? '' : ' ng'}" aria-label="${x.ok ? '正常' : '停止'}"></span><span>${esc(x.label)}</span><small>${x.ok ? `${fmt(x.count)}件` : '停止中'}</small></li>`)
          .join('')}</ul>
      </section>`;
    })
    .join('');
}

let nextTimer;
function renderLive(s) {
  const el = $('#live');
  const stale = Date.now() - s.generatedAt > 3 * 3.6e6;
  el.classList.toggle('is-stale', stale);
  $('#live-text').textContent = `${ago(s.generatedAt)}に更新`;
  clearInterval(nextTimer);
  const tick = () => {
    const ms = (s.nextRunAt || 0) - Date.now();
    if (ms <= 0) {
      $('#k-next').textContent = 'まもなく';
      return;
    }
    const m = Math.floor(ms / 60000);
    const sec = Math.floor((ms % 60000) / 1000);
    $('#k-next').textContent = `${m}:${String(sec).padStart(2, '0')}`;
    $('#live-text').textContent = `${ago(s.generatedAt)}に更新`;
  };
  tick();
  nextTimer = setInterval(tick, 1000);
}

function renderAll({ animate = false } = {}) {
  const s = state.snap;
  if (!s) return;
  renderKpis(s);
  renderSpot(s);
  renderRise(s);
  renderRank({ animate });
  renderThemes(s);
  renderNet(s);
  renderLive(s);
}

/* ---------------- 詳細シート ---------------- */
function searchLinks(name) {
  const q = encodeURIComponent(name);
  return [
    ['X', `https://x.com/search?q=${q}&f=live`],
    ['Google News', `https://news.google.com/search?q=${q}`],
    ['Hacker News', `https://hn.algolia.com/?q=${q}&dateRange=pastWeek&sort=byPopularity`],
    ['Reddit', `https://www.reddit.com/search/?q=${q}&t=week`],
    ['GitHub', `https://github.com/search?q=${q}&type=repositories&s=stars`],
    ['Hugging Face', `https://huggingface.co/search/full-text?q=${q}`],
    ['YouTube', `https://www.youtube.com/results?search_query=${q}&sp=CAI%253D`],
  ];
}

function openSheet(id, { push = true } = {}) {
  const t = state.snap?.top?.find((x) => x.id === id);
  if (!t) return;
  const dlg = $('#sheet');
  const famRows = FAM_IDS.map((f) => [f, t.fams?.[f] || 0]).sort((a, b) => b[1] - a[1]);
  const first = t.first ? ago(t.first) : '—';
  $('#sh-body').innerHTML = `
    <div class="d-k">${statusChip(t.status)}<span class="chip">${esc(t.catLabel)}</span><span class="chip">#${t.rank}${t.prevRank ? `（前回 ${t.prevRank}位）` : '（初登場）'}</span></div>
    <h2 class="d-title" id="sh-title">${esc(t.name)}</h2>
    <p class="d-org">${esc([t.org, layersText(t)].filter(Boolean).join(' — '))}</p>
    <div class="d-hero">${ring(t.hype, { small: true })}<div class="d-chart">${chart(t.spark, { h: 86 })}<small>熱量の推移（観測ごと・直近 ${t.spark?.length || 1} 回）</small></div></div>
    <dl class="d-metrics">
      <div><dt>熱量（層の合計）</dt><dd>${t.attention.toFixed(2)}</dd></div>
      <div><dt>勢い（z 値）</dt><dd>${t.z > 0 ? '+' : ''}${t.z.toFixed(1)}</dd></div>
      <div><dt>話題の層</dt><dd>${t.breadth}<small style="font-size:12px;color:var(--tx-3)"> / 8</small></dd></div>
      <div><dt>初めて観測</dt><dd style="font-size:16px">${esc(first)}</dd></div>
    </dl>
    <h3 class="d-h">なぜ流行っているのか</h3>
    <ul class="d-facts">${(t.facts || []).map((f) => `<li><i style="--c:${famColor(f.fam)}"></i>${esc(f.label)}</li>`).join('')}</ul>
    <h3 class="d-h">層ごとの熱量</h3>
    <div class="d-fams">${famRows
      .map(([f, v]) => `<div class="d-fam" style="--c:${famColor(f)}"><span><i></i>${esc(FAM[f])}</span><span class="bar"><i style="transform:scaleX(${Math.min(1, v).toFixed(3)})"></i></span><b>${Math.round(v * 100)}</b></div>`)
      .join('')}</div>
    <h3 class="d-h">根拠（${t.n}件のシグナルから上位）</h3>
    <ol class="d-ev">${(t.ev || [])
      .map(
        (e) => `<li><a href="${esc(e.u)}" target="_blank" rel="noopener noreferrer">
          <b>${esc(e.t)}</b>
          <small><i style="--c:${famColor(e.fam)}"></i>${esc(SRC_LABEL[e.src] || e.src)}${e.pub && e.pub !== e.c ? ` · ${esc(e.pub)}` : ''}${e.c ? ` · ${esc(e.c)}` : ''} · ${esc(ago(e.ts))}</small>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3h7v7M13 3L4 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </a></li>`,
      )
      .join('')}</ol>
    <h3 class="d-h">自分で確かめる</h3>
    <div class="d-links">${searchLinks(t.name).map(([l, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(l)} ↗</a>`).join('')}</div>
    <p class="d-note">Hype はこの回の首位を 100 とした相対値です。話題の量と広がりを測るもので、品質や真偽、将来の成長を保証するものではありません。</p>`;
  if (!dlg.open) {
    openSheet.returnFocus = document.activeElement;
    dlg.showModal();
  }
  $('#sh-body').scrollTop = 0;
  animateRings(dlg);
  if (push) {
    const u = new URL(location.href);
    u.searchParams.set('e', id);
    history.pushState({ e: id }, '', u);
  }
}

function closeSheet({ push = true } = {}) {
  const dlg = $('#sheet');
  if (!dlg.open) return;
  const done = () => {
    dlg.classList.remove('is-closing');
    dlg.close();
    openSheet.returnFocus?.focus?.();
  };
  if (reduceMotion) done();
  else {
    dlg.classList.add('is-closing');
    setTimeout(done, 260);
  }
  if (push) {
    const u = new URL(location.href);
    u.searchParams.delete('e');
    history.pushState({}, '', u);
  }
}

/* ---------------- 出現アニメーション ---------------- */
let io;
function observeReveal(root = document) {
  const els = $$('[data-reveal]:not(.in)', root);
  if (reduceMotion || !('IntersectionObserver' in window)) {
    els.forEach((e) => e.classList.add('in'));
    return;
  }
  io = io || new IntersectionObserver(
    (entries) => {
      for (const en of entries) {
        if (en.isIntersecting) {
          en.target.classList.add('in');
          io.unobserve(en.target);
        }
      }
    },
    { rootMargin: '0px 0px -6% 0px', threshold: 0.06 },
  );
  els.forEach((e) => io.observe(e));
}

/* ---------------- 読み込み・更新 ---------------- */
async function load({ first = false } = {}) {
  try {
    const s = await api('/api/ai');
    if (first || !state.snap) {
      state.snap = s;
      renderAll({ animate: true });
      const e = new URLSearchParams(location.search).get('e');
      if (e) openSheet(e, { push: false });
    } else if (s.generatedAt > state.snap.generatedAt) {
      state.pending = s;
      toast('新しい観測が届きました', {
        action: '表示する',
        ms: 30000,
        onAction: () => {
          state.snap = state.pending;
          state.pending = null;
          renderAll({ animate: true });
        },
      });
    } else {
      renderLive(state.snap);
    }
  } catch (err) {
    if (err.status === 503 && first) {
      $('#live-text').textContent = '初回観測中…';
      setTimeout(() => load({ first: true }), (err.body?.retryAfter || 5) * 1000);
      return;
    }
    if (first) {
      $('#spot').innerHTML = `<p>読み込めませんでした（${esc(err.message)}）。時間をおいて再読み込みしてください。</p>`;
    }
  }
}

async function refresh() {
  const btn = $('#refresh');
  if (btn.classList.contains('is-busy')) return;
  btn.classList.add('is-busy');
  try {
    await api('/api/ai-refresh', { method: 'POST' });
    state.snap = await api('/api/ai');
    renderAll({ animate: true });
    toast('最新の観測に更新しました');
  } catch (err) {
    toast(esc(err.message || '更新できませんでした'));
  } finally {
    btn.classList.remove('is-busy');
  }
}

/* ---------------- 配色 ---------------- */
function effectiveTheme() {
  const t = document.documentElement.dataset.theme;
  if (t === 'light' || t === 'dark') return t;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/* ---------------- 起動 ---------------- */
function bind() {
  document.addEventListener('click', (ev) => {
    const target = ev.target.closest('[data-id]');
    if (target && !ev.target.closest('a')) {
      ev.preventDefault();
      openSheet(target.dataset.id);
    }
  });
  $('#spot').addEventListener('keydown', (ev) => {
    if ((ev.key === 'Enter' || ev.key === ' ') && ev.currentTarget.dataset.id) {
      ev.preventDefault();
      openSheet(ev.currentTarget.dataset.id);
    }
  });
  $('#cats').addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-cat]');
    if (!b) return;
    state.cat = b.dataset.cat;
    state.shown = PAGE;
    for (const x of $$('button', $('#cats'))) x.setAttribute('aria-selected', String(x === b));
    const u = new URL(location.href);
    if (state.cat) u.searchParams.set('cat', state.cat);
    else u.searchParams.delete('cat');
    history.replaceState(history.state, '', u);
    renderRank({ animate: true });
  });
  $('#only-up').addEventListener('change', (ev) => {
    state.onlyUp = ev.target.checked;
    state.shown = PAGE;
    renderRank({ animate: true });
  });
  $('#more').addEventListener('click', () => {
    state.shown += PAGE;
    renderRank();
  });
  $('#sh-close').addEventListener('click', () => closeSheet());
  const dlg = $('#sheet');
  dlg.addEventListener('cancel', (ev) => {
    ev.preventDefault();
    closeSheet();
  });
  dlg.addEventListener('click', (ev) => {
    if (ev.target === dlg) closeSheet();
  });
  window.addEventListener('popstate', () => {
    const e = new URLSearchParams(location.search).get('e');
    if (e) openSheet(e, { push: false });
    else closeSheet({ push: false });
  });
  $('#refresh').addEventListener('click', refresh);
  $('#theme').addEventListener('click', () => {
    const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    ls.set('uc.theme', next);
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) load();
  });
  // カテゴリの初期値（URL）
  if (state.cat) for (const x of $$('button', $('#cats'))) x.setAttribute('aria-selected', String(x.dataset.cat === state.cat));
}

bind();
renderLegend();
observeReveal();
load({ first: true });
setInterval(() => !document.hidden && load(), POLL_MS);
