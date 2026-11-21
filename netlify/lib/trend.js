/**
 * trend.js — 「同じ話」をまとめる単位（ストーリー）と、動向（NEW / 上昇中 / 横ばい / 下降中）の判定
 *
 * 動向の判定ルール（全画面・全 API で共通）：
 *   NEW     … これまで一度も観測されていない（比較対象がない）
 *   上昇中  … 比較基準より 25% 以上増え、かつ独立した投稿が 2 件以上（または 2 媒体以上）ある
 *   横ばい  … ±25% 未満、または増えていても投稿が少なすぎて判断を保留したもの
 *   下降中  … 比較基準より 25% 以上減った
 * 比較基準は「指数移動平均」と「24 時間前の同じ時間帯（周期的な話題の補正）」の大きい方。
 * 判定の根拠（基準値・今回値・投稿数・媒体数・比較期間）は basis にそのまま残す。
 */

import { termKey } from './text.js';

const H = 3.6e6;
export const RISE = 0.25;
export const FALL = -0.25;
export const DIRECTIONS = {
  new: { label: 'NEW', icon: '✦' },
  rising: { label: '上昇中', icon: '↑' },
  flat: { label: '横ばい', icon: '→' },
  falling: { label: '下降中', icon: '↓' },
};

/* ------------------------------------------------------------------ *
 * ストーリー：同じ記事（正規化 URL）・ほぼ同じ見出しを 1 つにまとめる
 *   → 同じニュースの再投稿・転載を、別々の投稿として数えないため
 * ------------------------------------------------------------------ */
export function canonicalUrl(raw) {
  try {
    const u = new URL(raw);
    if (!['https:', 'http:'].includes(u.protocol)) return '';
    u.hash = '';
    u.hostname = u.hostname.replace(/^www\.|^m\.|^amp\./, '');
    for (const key of [...u.searchParams.keys()]) if (/^utm_|^(?:fbclid|gclid|ref|ref_src|campaign|cmpid|s|smid|guccounter)$/i.test(key)) u.searchParams.delete(key);
    u.searchParams.sort();
    return u.href.replace(/\/$/, '');
  } catch {
    return '';
  }
}

// 媒体内の検索ページや汎用トップは「記事」ではないので同一視の根拠にしない
const NON_ARTICLE = /(?:\/search\b|[?&]q=|trends\.google\.|\/tags?\/|\/hashtags?\/|^https?:\/\/[^/]+\/?$)/i;

const WORD_STOP = new Set('the a an and or of to in on for with from by at is are was were be has have had its it this that as after before over into about new says say said will can just how why what who'.split(' '));
function headlineWords(text) {
  const t = String(text || '').normalize('NFKC').toLowerCase();
  const en = (t.match(/[a-z][a-z0-9'-]{2,}/g) || []).filter((w) => !WORD_STOP.has(w));
  const ja = t.match(/[\p{Script=Han}\p{Script=Katakana}ー]{2,}/gu) || [];
  return new Set([...en, ...ja]);
}

/**
 * シグナルごとのストーリー ID を返す（同じ ID = 同じ話の再掲・転載）
 * @param {Array<object>} signals
 * @returns {number[]}
 */
export function groupStories(signals) {
  const parent = signals.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };
  const byUrl = new Map();
  const words = [];
  signals.forEach((s, i) => {
    for (const raw of [s.link, s.url]) {
      const u = canonicalUrl(raw);
      if (!u || NON_ARTICLE.test(u)) continue;
      if (byUrl.has(u)) union(i, byUrl.get(u));
      else byUrl.set(u, i);
    }
    // 見出しの一致判定は投稿・記事タイトルだけ（トピック名同士は語そのものなので対象外）
    words[i] = s.kind === 'post' && String(s.text || '').length >= 20 ? headlineWords(s.text) : null;
  });
  for (let i = 0; i < signals.length; i += 1) {
    const a = words[i];
    if (!a || a.size < 4) continue;
    for (let j = i + 1; j < signals.length; j += 1) {
      const b = words[j];
      if (!b || b.size < 4) continue;
      let shared = 0;
      for (const w of a) if (b.has(w)) shared += 1;
      // 定型文（"What does X even mean?" など）を同一視しないよう、ほぼ全語の一致（Jaccard 0.8）を要求
      if (shared >= 4 && shared / (a.size + b.size - shared) >= 0.8) union(i, j);
    }
  }
  return signals.map((_, i) => find(i));
}

/** 独立した発信元の概算：媒体 × コミュニティ（サブレ・インスタンス）またはリンク先ドメイン */
export function voiceOf(sig) {
  let host = '';
  try {
    host = new URL(sig.link || sig.url).hostname.replace(/^www\./, '');
  } catch {
    /* noop */
  }
  const community = sig.ctx && sig.ctx.length < 40 ? sig.ctx : '';
  return `${sig.src}|${sig.link ? host : community || host}`;
}

/* ------------------------------------------------------------------ *
 * 周期性：曜日タグ（#MondayMotivation 等）と日周期（毎日同じ時間帯に出る）
 * ------------------------------------------------------------------ */
const WEEKDAY = /(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekend|月曜|火曜|水曜|木曜|金曜|土曜|日曜|週末|花金)/i;

export function periodicityOf(display, hist = [], now = Date.now(), cur = 0) {
  if (WEEKDAY.test(termKey(display)) || WEEKDAY.test(String(display))) return { kind: 'weekly', base: cur * 0.8 };
  // 21〜27 時間前に同程度の熱量があり、その間（6〜18 時間前）はほぼ消えていた → 日周期
  const at = (lo, hi) => hist.filter(([t]) => now - t >= lo * H && now - t <= hi * H);
  const dayAgo = at(21, 27);
  if (!dayAgo.length) return { kind: null, base: 0 };
  const prevDay = Math.max(...dayAgo.map((p) => p[1]));
  const between = at(6, 18);
  const gap = between.length ? Math.max(...between.map((p) => p[1])) : 0;
  if (prevDay >= 0.5 * cur && gap < 0.5 * prevDay) return { kind: 'daily', base: prevDay };
  return { kind: null, base: 0 };
}

/** hist（[ts, heat, ...][]）の中で、指定時間前に最も近い点（±tolH 以内）。なければ null */
export function valueAgo(hist = [], now, hoursAgo, tolH = 2) {
  let best = null;
  for (const p of hist) {
    const d = Math.abs(now - p[0] - hoursAgo * H);
    if (d <= tolH * H && (!best || d < best.d)) best = { d, p };
  }
  return best ? best.p : null;
}

/** 24h / 48h 前との比較（観測されていなければ null。0 から出現した場合は 'appeared'） */
export function changeOver(hist, now, cur, hoursAgo) {
  const p = valueAgo(hist, now, hoursAgo);
  if (!p) {
    const older = (hist || []).some(([t]) => now - t >= (hoursAgo - 2) * H);
    // 観測網は動いていた（もっと古い点がある）のにその時点で出ていない → 「その時点では未観測」
    return { ratio: null, prev: older ? 0 : null, label: older ? `${hoursAgo}時間前は未観測` : `${hoursAgo}時間前のデータなし` };
  }
  const prev = p[1];
  const ratio = prev > 0 ? (cur - prev) / prev : null;
  return { ratio: ratio == null ? null : Math.round(ratio * 100) / 100, prev, label: ratio == null ? '—' : `${ratio >= 0 ? '+' : ''}${Math.round(ratio * 100)}%` };
}

/**
 * 動向の判定（全体で共通のルール）
 * @param {object} o
 * @param {number} o.cur         今回の熱量
 * @param {number|null} o.ema    過去の指数移動平均（初観測なら null）
 * @param {number|null} o.prevHeat 前回観測時の熱量
 * @param {number} [o.prevAt]    前回観測時刻
 * @param {number} o.posts       今回の独立した投稿（ストーリー）数
 * @param {number} [o.prevPosts] 前回の投稿数
 * @param {number} o.spread      媒体数
 * @param {number} o.voices      独立した発信元の概算
 * @param {{kind:string|null, base:number}} [o.periodic]
 * @param {number|null} [o.newPosts]  前回までに見ていない投稿の数（再掲だけなら 0）
 * @param {number} o.now
 * @param {number} o.intervalH
 */
export function trendDirection({ cur, ema, prevHeat = null, prevAt = null, posts = 1, prevPosts = null, spread = 1, voices = 1, periodic = { kind: null, base: 0 }, newPosts = null, now = Date.now(), intervalH = 3 }) {
  const basis = { cur: r2(cur), posts, prevPosts, spread, voices, periodic: periodic.kind, windowH: intervalH, cmp: null, base: null, raw: null, note: '' };
  if (ema == null) {
    basis.note = '初めての観測のため比較対象がありません';
    return { dir: 'new', velocity: 0, basis };
  }
  const gapH = prevAt ? (now - prevAt) / H : intervalH;
  basis.windowH = Math.max(intervalH, Math.round(gapH));
  let base = ema;
  basis.cmp = 'ema';
  if (periodic.base > base) {
    base = periodic.base;
    basis.cmp = periodic.kind === 'weekly' ? 'weekly' : 'seasonal24';
  }
  basis.base = r2(base);
  const raw = (cur - base) / (base + 0.6);
  basis.raw = r2(raw);
  // 少数投稿からの急増を過大評価しない：支持の強さで伸び率を縮める
  const support = posts + 2 * Math.max(0, spread - 1) + Math.max(0, voices - spread);
  const ref = raw >= 0 ? support : Math.max(support, (prevPosts ?? posts) + 2 * Math.max(0, spread - 1));
  const shrink = ref / (ref + 3);
  const velocity = r2(Math.max(-1, Math.min(5, raw * shrink)));

  let dir = 'flat';
  if (velocity >= RISE) {
    if (posts < 2 && spread < 2) {
      basis.note = '投稿が 1 件のみのため上昇判定を保留';
    } else if (newPosts === 0) {
      basis.note = '新しい投稿はなく、既出の投稿の再掲のみ';
    } else dir = 'rising';
  } else if (velocity <= FALL) dir = 'falling';
  if (gapH > 24 && dir !== 'falling') basis.note ||= `${Math.round(gapH)}時間ぶりの再出現`;
  if (periodic.kind === 'weekly') basis.note ||= '曜日ごとに繰り返すタグのため割り引いて判定';
  if (periodic.kind === 'daily' && basis.cmp === 'seasonal24') basis.note ||= '毎日同じ時間帯に出る話題のため 24 時間前と比較';
  return { dir, velocity, basis };
}

/** 判定根拠を一文で（UI・API 共通） */
export function describeBasis(dir, b) {
  if (!b) return '';
  if (dir === 'new') return b.note || '初観測';
  const cmp = { ema: '過去の平均', seasonal24: '24時間前の同時間帯', weekly: '曜日タグ補正後の平均' }[b.cmp] || '過去の平均';
  const pct = b.raw == null ? '' : `${b.raw >= 0 ? '+' : ''}${Math.round(b.raw * 100)}%`;
  const parts = [`${cmp}（${b.base}）→ 今回 ${b.cur}（${pct}、比較期間 ${b.windowH}時間）`, `投稿 ${b.posts}${b.prevPosts != null ? `（前回 ${b.prevPosts}）` : ''}`, `${b.spread}媒体`, `発信元 ${b.voices}`];
  if (b.note) parts.push(b.note);
  return parts.join(' · ');
}

function r2(v) {
  return Math.round(v * 100) / 100;
}
