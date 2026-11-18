/**
 * score.js — 候補語を「ニッチな潮流」として採点し、語彙台帳（大全）を更新する
 *
 *   heat      : 今回の観測での熱量（媒体の重み × 媒体内エンゲージメント順位 × 新しさ × 媒体の勢い）
 *   spread    : 何媒体にまたがって出ているか
 *   velocity  : 台帳の指数移動平均(EMA)に対する今回の伸び率
 *   novelty   : 初観測からの経過で減衰する “新しさ”
 *   slang     : 造語っぽさ（text.js の形態ヒューリスティック＋スラング系媒体ボーナス）
 *   mainstream: Google トレンド上位や Wikipedia 上位“だけ”で見えている語は減点（ニッチ優先）
 *
 * 最終スコアは今回の観測内での相対値（最上位 = 100）。
 * 純関数：台帳オブジェクトを受け取り、新しい台帳を返す（引数は破壊しない）。
 */

import { slangness, detectLang } from './text.js';
import { isGenericTerm } from './intelligence.js';

export const RUN_INTERVAL_H = 3; // netlify.toml / collect の cron と揃える
const EMA_ALPHA = 0.35;
const HIST_LEN = 32; // 3h × 32 ≒ 4 日分の推移
const SAMPLE_LEN = 6;
const MIN_SCORE = 4; // フィードに出す下限（台帳には残る）
const LEXICON_MAX = 3500;
const LEXICON_TTL_DAYS = 30;
const SLANG_SOURCES = new Set(['urbandictionary', 'knowyourmeme', 'misskey', 'reddit', 'niconico', 'bluesky']);
const MAINSTREAM_SOURCES = new Set(['googletrends', 'wikipedia']);

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

/** 媒体ごとのエンゲージメントを 0〜1 の順位に直す（媒体間でスケールが違うため） */
export function engagementPercentiles(signals) {
  const bySrc = new Map();
  signals.forEach((s, i) => {
    if (!bySrc.has(s.src)) bySrc.set(s.src, []);
    bySrc.get(s.src).push(i);
  });
  const pct = new Array(signals.length).fill(0.5);
  for (const idxs of bySrc.values()) {
    const scores = idxs.map((i) => signals[i].score || 0);
    if (scores.every((v) => v === scores[0])) continue; // 全部同じなら中央値扱い
    const sorted = [...idxs].sort((a, b) => (signals[a].score || 0) - (signals[b].score || 0));
    sorted.forEach((i, rank) => {
      pct[i] = sorted.length > 1 ? rank / (sorted.length - 1) : 0.5;
    });
  }
  return pct;
}

function recency(ts, now) {
  const ageH = Math.max(0, (now - (ts || now)) / 3.6e6);
  return Math.max(0.15, Math.exp(-ageH / 18));
}

/**
 * @param {object} p
 * @param {Array<object>} p.signals
 * @param {Map<string, object>} p.candidates  mine.js の出力
 * @param {Record<string, {weight:number}>} p.sourceMap
 * @param {Record<string, object>} p.lexicon   既存の台帳（key → entry）
 * @param {number} p.now
 * @param {number} [p.limit]
 */
export function scoreRun({ signals, candidates, sourceMap, lexicon = {}, now = Date.now(), limit = 160 }) {
  const pct = engagementPercentiles(signals);
  const scored = [];

  for (const c of candidates.values()) {
    // Generic words in one GitHub repository are not independent trends.
    if (c.hits.every((h) => signals[h.i]?.src === 'github') && isGenericTerm(c.display)) continue;
    const perSrc = new Map();
    let mainstreamHit = false;
    let slangSrc = false;
    let velHint = 0;
    for (const h of c.hits) {
      const sig = signals[h.i];
      const weight = sourceMap[sig.src]?.weight ?? 0.5;
      const contrib = weight * h.w * (0.35 + 0.65 * pct[h.i]) * recency(sig.ts, now) * (1 + 0.6 * (sig.vel || 0));
      perSrc.set(sig.src, (perSrc.get(sig.src) || 0) + contrib);
      if (sig.mainstream) mainstreamHit = true;
      if (sig.slang || SLANG_SOURCES.has(sig.src)) slangSrc = true;
      velHint = Math.max(velHint, sig.vel || 0);
    }
    const spread = perSrc.size;
    // 1 媒体の中で何度も出ても頭打ち（大量投稿 1 媒体に引っ張られないように）
    let heat = 0;
    for (const v of perSrc.values()) heat += Math.min(v, 2.5);
    heat *= 1 + 0.35 * (spread - 1);

    // 採用条件：媒体が明示した語／複数シグナルに出る語／スラング系媒体での造語っぽい語
    const lang = c.lang === 'xx' ? detectLang(c.display) : c.lang;
    const shape = slangness(c.display, lang);
    const slang = clamp(shape + (slangSrc ? 0.2 : 0), 0, 1);
    const enough = c.explicit || c.hits.length >= 2 || (slangSrc && shape >= 0.45);
    if (!enough || heat <= 0) continue;

    const prev = lexicon[c.key];
    const ema = prev?.ema ?? 0;
    const velocity = prev ? clamp((heat - ema) / (ema + 0.6), -1, 5) : clamp(heat / 0.6, 0, 5);
    const firstSeen = prev?.first ?? now;
    const ageH = (now - firstSeen) / 3.6e6;
    const novelty = Math.exp(-ageH / 36);
    const onlyMainstream = [...perSrc.keys()].every((s) => MAINSTREAM_SOURCES.has(s));
    const mainstreamPenalty = onlyMainstream ? 0.45 : mainstreamHit ? 0.75 : 1;
    // 本文から掘っただけ・1 媒体だけ・造語っぽくもない語は一般語の可能性が高いので半減
    const plainPenalty = !c.explicit && spread === 1 && slang < 0.35 ? 0.5 : 1;

    const raw =
      Math.pow(heat, 0.6) *
      (0.6 + 0.8 * novelty) *
      (1 + 0.6 * (clamp(velocity, 0, 3) / 3) + 0.25 * velHint) *
      (0.8 + 0.6 * slang) *
      mainstreamPenalty *
      plainPenalty;

    scored.push({
      c,
      lang,
      heat,
      spread,
      srcs: [...perSrc.entries()].sort((a, b) => b[1] - a[1]).map(([s]) => s),
      velocity,
      novelty,
      slang,
      mainstream: onlyMainstream || mainstreamHit,
      raw,
      prev,
      firstSeen,
    });
  }

  scored.sort((a, b) => b.raw - a.raw);
  const max = scored[0]?.raw || 1;

  /* ---------- 台帳（大全）の更新 ---------- */
  const next = {};
  for (const [k, e] of Object.entries(lexicon)) {
    // 今回出なかった語の EMA は減衰させる（＝次に出たとき “再燃” を検知できる）
    next[k] = { ...e, ema: round(e.ema * (1 - EMA_ALPHA), 4) };
  }

  const terms = [];
  // 台帳には上位だけ記録（ノイズで台帳が肥大しないように）
  const keepForLexicon = scored.slice(0, Math.max(limit * 2, 300));
  keepForLexicon.forEach((s, rank) => {
    const { c } = s;
    const prev = s.prev;
    const samples = mergeSamples(
      prev?.samples ?? [],
      c.hits
        .map((h) => signals[h.i])
        .sort((a, b) => (b.score || 0) - (a.score || 0))
        .slice(0, 4)
        .map((sig) => ({ x: String(sig.text).slice(0, 200), u: sig.url, s: sig.src, ts: sig.ts || now, c: sig.ctx || '' })),
    );
    const hist = [...(prev?.hist ?? []), [now, round(s.heat, 3)]].slice(-HIST_LEN);
    const srcCount = { ...(prev?.srcs ?? {}) };
    for (const id of s.srcs) srcCount[id] = (srcCount[id] || 0) + 1;
    const score = Math.round((100 * s.raw) / max);
    const peak = Math.max(prev?.peak ?? 0, score);

    const entry = {
      k: c.key,
      t: c.display,
      lang: s.lang,
      first: s.firstSeen,
      last: now,
      runs: (prev?.runs ?? 0) + 1,
      ema: round(prev ? prev.ema * (1 - EMA_ALPHA) + s.heat * EMA_ALPHA : s.heat, 4),
      peak,
      peakAt: peak > (prev?.peak ?? -1) ? now : prev.peakAt,
      slang: round(s.slang),
      main: s.mainstream,
      srcs: srcCount,
      hist,
      samples,
    };
    next[c.key] = entry;

    if (rank < limit && score >= MIN_SCORE) {
      const status = classify(s, prev, now);
      terms.push({
        k: c.key,
        t: c.display,
        lang: s.lang,
        score,
        heat: round(s.heat),
        vel: round(s.velocity),
        spread: s.spread,
        srcs: s.srcs,
        cat: categoryOf(s.srcs, sourceMap),
        status: status.main,
        badges: status.badges,
        first: s.firstSeen,
        runs: entry.runs,
        slang: round(s.slang),
        main: s.mainstream,
        hl: halfLife(hist),
        spark: hist.slice(-16).map((h) => h[1]),
        samples: samples.slice(0, 3),
      });
    }
  });

  return { terms, lexicon: pruneLexicon(next, now), considered: scored.length };
}

/** 一番効いている媒体（主流の物差しは除く）のジャンルをカテゴリにする */
export function categoryOf(srcs, sourceMap) {
  const main = srcs.find((id) => !MAINSTREAM_SOURCES.has(id)) ?? srcs[0];
  return sourceMap[main]?.genre ?? 'other';
}

/** 状態判定：誕生 > 急騰 > 拡散 > 失速 > 定着 */
export function classify(s, prev, now) {
  const badges = [];
  const ageH = (now - s.firstSeen) / 3.6e6;
  if (!prev || ageH < 12) badges.push('new');
  if (prev && s.velocity >= 0.8) badges.push('surge');
  if (s.spread >= 3) badges.push('spread');
  if (prev && s.velocity <= -0.35) badges.push('cool');
  if (prev && prev.last && now - prev.last > 24 * 3.6e6) badges.push('revival'); // 1 日以上消えてから再出現
  if (s.slang >= 0.55) badges.push('slang');
  if (s.mainstream) badges.push('mainstream');
  const order = ['new', 'revival', 'surge', 'spread', 'cool'];
  const main = order.find((b) => badges.includes(b)) || 'steady';
  return { main, badges };
}

/**
 * 半減期（時間）。直近 2 点の比から指数減衰を仮定して推定。
 * 伸びている／履歴不足なら null（UI では「上昇中」「観測中」と出す）
 */
export function halfLife(hist) {
  if (!hist || hist.length < 2) return null;
  const [t1, h1] = hist[hist.length - 2];
  const [t2, h2] = hist[hist.length - 1];
  const dtH = Math.max(0.5, (t2 - t1) / 3.6e6);
  if (!(h1 > 0) || !(h2 > 0) || h2 >= h1) return null;
  const r = h2 / h1;
  return round((dtH * Math.log(0.5)) / Math.log(r), 1);
}

function mergeSamples(old, fresh) {
  const seen = new Set();
  const out = [];
  for (const s of [...fresh, ...old]) {
    const id = s.u || s.x;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(s);
    if (out.length >= SAMPLE_LEN) break;
  }
  return out;
}

/** 古く・弱い語から捨てて台帳サイズを保つ */
export function pruneLexicon(lex, now = Date.now()) {
  const ttl = LEXICON_TTL_DAYS * 864e5;
  const entries = Object.values(lex).filter((e) => now - e.last < ttl || e.peak >= 60);
  if (entries.length > LEXICON_MAX) {
    entries.sort((a, b) => lexiconKeepScore(b, now) - lexiconKeepScore(a, now));
    entries.length = LEXICON_MAX;
  }
  return Object.fromEntries(entries.map((e) => [e.k, e]));
}

function lexiconKeepScore(e, now) {
  const daysAgo = (now - e.last) / 864e5;
  return e.peak * 0.6 + e.runs * 2 + e.slang * 30 - daysAgo * 6;
}

/** 大全ビュー用の生死判定 */
export function lifeStage(e, now = Date.now()) {
  const sinceH = (now - e.last) / 3.6e6;
  if (sinceH > 72) return 'dead'; // 3 日観測されない → 死語化
  if (sinceH > 24) return 'fading';
  if ((now - e.first) / 3.6e6 < 24) return 'newborn';
  return 'alive';
}
