/**
 * allcopy.js — オールコピー：取ってきた情報を “1 件ずつ・詳細まで全部” 文字にする（純関数）
 *
 * 画面で項目をタップした時に見える中身（AI Pulse の「これは何／なぜいま／根拠の見出し」、
 * Undercurrent の「意味・推移・媒体・用例」、重要情報レーダーの「根拠・注意書き」）を、
 * 省略せずに全項目ぶん書き出す。グループ → 項目 の 2 段で返すので、全部・グループ単位・1 件単位でコピーできる。
 */

import { lifeStage } from './score.js';

const JST = { timeZone: 'Asia/Tokyo' };
export const fmtTime = (t) =>
  Number.isFinite(t) && t > 0
    ? new Date(t).toLocaleString('ja-JP', { ...JST, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    : '—';
const ago = (t, now) => {
  if (!Number.isFinite(t) || t <= 0) return '—';
  const h = (now - t) / 3.6e6;
  return h < 1 ? `${Math.max(1, Math.round(h * 60))}分前` : h < 48 ? `${Math.round(h)}時間前` : `${Math.round(h / 24)}日前`;
};
const one = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const md = (s) => one(s).replace(/([\\`*_[\]|<>])/g, '\\$1');
const safeUrl = (u) => (/^https?:\/\//.test(String(u || '')) ? String(u).replace(/[()\s]/g, (c) => ({ '(': '%28', ')': '%29' })[c] || '%20') : '');
const link = (text, url) => (safeUrl(url) ? `[${md(text)}](${safeUrl(url)})` : md(text));
const pct = (v) => `${Math.round((v || 0) * 100)}%`;

const AI_STATUS = { breakout: '急浮上', surging: '急騰', rising: '上昇', steady: '定着', cooling: '失速' };
const UC_STATUS = { new: '🌱誕生', surge: '🔥急騰', spread: '🌊拡散', revival: '🧟再燃', cool: '🥀失速', steady: '定着', slang: '🗯スラング', mainstream: '📣主流' };
const STAGE = { newborn: '🌱生まれたて', alive: '🔥生存中', fading: '🌫消えかけ', dead: '💀死語' };
const FAM = { community: 'コミュニティ', code: 'コード', models: 'モデル', research: '研究', news: '報道', japan: '日本', products: 'プロダクト', search: '検索・関心' };
const AI_SRC = {
  hackernews: 'Hacker News', reddit: 'Reddit', lobsters: 'Lobsters', devto: 'DEV', mastodon: 'Mastodon', bluesky: 'Bluesky',
  github: 'GitHub', hfmodels: 'Hugging Face', hfspaces: 'HF Spaces', hfpapers: 'HF Papers', newsen: 'Google News', press: 'テック媒体',
  newsja: 'Google News 日本', hatena: 'はてブ', zenn: 'Zenn', qiita: 'Qiita', producthunt: 'Product Hunt', wikipedia: 'Wikipedia', googletrends: 'Google トレンド',
};
const EVENT_JA = {
  launch: '新登場・発表', bench: '性能・比較', open: 'オープン公開', try: '使ってみた・解説', money: '資金・買収', policy: '規制・訴訟',
  risk: '不具合・安全性', price: '料金・提供条件', debate: '賛否・炎上', deal: '提携・組み込み', people: '人事', research: '研究成果',
};
const BAND = { hidden: '低注目・高影響', 'unknown-attention': '注目度未計測・高影響', major: '高影響', low: '参考' };

const item = (id, title, lines, meta = '') => {
  const body = lines.filter((l) => l != null && l !== '').join('\n');
  return { id, title: one(title), meta, md: body };
};

/* ---------------- 重要情報レーダー ---------------- */
function radarGroup(snap, now) {
  const labels = Object.fromEntries((snap?.sources || []).map((s) => [s.id, s.label]));
  const events = snap?.analysis?.events || [];
  const items = events.map((e, i) =>
    item(`radar-${i + 1}`, `${i + 1}. ${e.title}`, [
      `#### ${i + 1}. ${md(e.title)}`,
      `- 分野: ${md(e.categoryLabel)}`,
      `- 推定影響度: ${e.impact}/100${e.discoveryPriority != null ? ` / 発見優先度 ${e.discoveryPriority}` : ''}`,
      e.priorityBand ? `- 区分: ${BAND[e.priorityBand] || e.priorityBand} / 注目度 ${e.attention == null ? '未計測' : `${e.attention}/100`}` : '',
      `- 状態: ${md(e.status)} / ${e.sourceCount} 媒体${e.publisherCount != null ? `・${e.publisherCount} ドメイン` : ''}で観測 / ${fmtTime(e.at)}（${ago(e.at, now)}）`,
      e.caution ? `- 注意: ${md(e.caution)}` : '',
      e.evidence?.length ? '- 根拠:' : '',
      ...(e.evidence || []).map((s) => `  - ${link(s.title || s.url, s.url)}（${md(labels[s.source] || s.source)}${s.ts ? ` · ${ago(s.ts, now)}` : ''}）`),
    ], `影響度 ${e.impact} · ${e.categoryLabel}`),
  );
  const st = snap?.analysis?.stats || {};
  return {
    id: 'radar',
    label: '重要情報レーダー',
    note: events.length
      ? `${events.length} 件。${st.reviewed ?? '—'} 件の観測を分析。推定影響度はルールベースの暫定値で、すべて真偽未検証。`
      : '重要情報として推定できる見出しはありません。',
    items,
  };
}

/* ---------------- AI Pulse ---------------- */
function aiGroup(ai, now) {
  const top = ai?.top || [];
  const items = top.map((t) => {
    const layers = Object.entries(t.fams || {}).sort((a, b) => b[1] - a[1]);
    const mv = t.prevRank == null ? '初登場' : t.prevRank === t.rank ? '前回と同じ順位' : `前回 ${t.prevRank} 位`;
    return item(`ai-${t.rank}`, `${t.rank}. ${t.name}`, [
      `#### ${t.rank}. ${md(t.name)}`,
      `- Hype: ${t.hype}/100｜状態: ${AI_STATUS[t.status] || t.status}｜切り口: ${md(t.angle || '—')}｜${mv}`,
      `- 分類: ${md(t.catLabel)}${t.org ? ` / ${md(t.org)}` : ''}`,
      `- これは何: ${md(t.about || '—')}`,
      `- なぜいま話題: ${md(t.why || '—')}`,
      t.events?.length ? `- 出来事の型: ${t.events.map((x) => EVENT_JA[x] || x).join('・')}` : '',
      t.quote ? `- 代表的な見出し: 「${md(t.quote.t)}」（${md(AI_SRC[t.quote.src] || t.quote.src)}${t.quote.pub ? ` · ${md(t.quote.pub)}` : ''}）` : '',
      t.facts?.length ? `- 根拠の数字: ${t.facts.map((f) => md(f.label)).join(' / ')}` : '',
      `- 指標: 熱量 ${t.attention} / 勢い z ${t.z > 0 ? '+' : ''}${t.z} / 話題の層 ${t.breadth}/8 / シグナル ${t.n} 件 / 初観測 ${fmtTime(t.first)}（${ago(t.first, now)}）`,
      `- 層ごとの熱量: ${layers.map(([f, v]) => `${FAM[f] || f} ${Math.round(v * 100)}`).join(' / ') || '—'}`,
      t.themes?.length ? `- テーマ: ${t.themes.join('・')}` : '',
      t.spark?.length > 1 ? `- 熱量の推移（古→新）: ${t.spark.join(' → ')}` : '',
      t.arts?.length ? `- 成果物: ${t.arts.map((a) => link(`${a.type}: ${a.id}`, a.url)).join(' / ')}` : '',
      t.ev?.length ? '- 実際に話題になっている見出し:' : '',
      ...(t.ev || []).map((e) => `  - ${link(e.t, e.u)}（${md(AI_SRC[e.src] || e.src)}${e.pub ? ` · ${md(e.pub)}` : ''}${e.c && e.c !== e.pub ? ` · ${md(e.c)}` : ''}${e.tag ? ` · ${md(e.tag)}` : ''} · ${ago(e.ts, now)}）`),
    ], `Hype ${t.hype} · ${t.catLabel}`);
  });
  const themes = (ai?.themes || []).map((th, i) =>
    item(`ai-theme-${i + 1}`, `テーマ：${th.label}`, [
      `#### テーマ：${md(th.label)}`,
      `- 熱量: ${th.heat}/100 / 勢い z ${th.z}`,
      th.top?.length ? `- 主な話題: ${th.top.map((x) => `${md(x.name)}（Hype ${x.hype}）`).join('・')}` : '',
      th.spark?.length > 1 ? `- 推移（古→新）: ${th.spark.join(' → ')}` : '',
    ], `熱量 ${th.heat}`),
  );
  const sources = ai?.sources?.length
    ? [item('ai-sources', 'AI Pulse の観測網', ['#### AI Pulse の観測網', ...ai.sources.map((s) => `- ${md(s.label)}（${md(s.famLabel || s.fam)}）: ${s.ok ? `${s.count} 件 / ${s.ms}ms` : `停止中${s.error ? `（${md(s.error)}）` : ''}`}`)])]
    : [];
  return {
    id: 'ai',
    label: 'AI Pulse',
    note: ai?.top
      ? `ランキング ${top.length} 件＋テーマ ${(ai.themes || []).length} 件＋観測網。観測 ${fmtTime(ai.generatedAt)}・シグナル ${ai.stats?.signals ?? '—'} 件・情報源 ${ai.stats?.sourcesUp ?? '—'}/${ai.stats?.sourcesTotal ?? '—'}。Hype は首位を 100 とした相対値。`
      : 'AI Pulse の観測データはまだありません。',
    items: [...items, ...themes, ...sources],
  };
}

/* ---------------- Undercurrent：SNS トレンド ---------------- */
function trendLines(t, i, entry, defs, srcLabel, now) {
  const e = entry || {};
  const stage = entry ? lifeStage(entry, now) : null;
  const srcCounts = Object.entries(e.srcs || {}).sort((a, b) => b[1] - a[1]);
  const samples = (e.samples?.length ? e.samples : t.samples) || [];
  return [
    `#### ${i + 1}. ${md(t.t)}`,
    `- スコア: ${t.score}/100｜状態: ${UC_STATUS[t.status] || t.status}${(t.badges || []).length ? `｜${t.badges.map((b) => UC_STATUS[b] || b).join(' ')}` : ''}`,
    `- 言語: ${t.lang} / 伸び率 ${pct(t.vel)} / ${t.spread} 媒体で観測 / 初観測 ${fmtTime(t.first)}（${ago(t.first, now)}）${t.hl != null ? ` / 半減期 約${Math.round(t.hl)}時間` : ''}`,
    defs?.length ? '- 意味・背景:' : '- 意味・背景: 辞書にまだ載っていません（用例から文脈を読んでください）',
    ...(defs || []).flatMap((d) => [`  - ${md(d.text)}（${link(d.source, d.url)}）`, d.example ? `    - 例: ${md(d.example)}` : '']),
    entry ? `- 台帳: 状態 ${STAGE[stage]} / 観測回数 ${e.runs} / 最高スコア ${e.peak} / スラング度 ${pct(e.slang)} / 最終観測 ${fmtTime(e.last)}` : '',
    e.hist?.length > 1 ? `- 熱量の推移: ${e.hist.map(([ts, v]) => `${fmtTime(ts).slice(5)} ${Math.round(v * 10) / 10}`).join(' → ')}` : '',
    srcCounts.length ? `- 出現した媒体: ${srcCounts.map(([id, n]) => `${srcLabel(id)} ×${n}`).join(' / ')}` : `- 出現した媒体: ${(t.srcs || []).map(srcLabel).join(' / ')}`,
    samples.length ? '- 用例（実際の投稿・見出し）:' : '',
    ...samples.map((s) => `  - ${link(s.x, s.u)}（${srcLabel(s.s)}${s.ts ? ` · ${ago(s.ts, now)}` : ''}）`),
  ];
}

function trendsGroup(snap, lexicon, defsMap, now) {
  const labels = Object.fromEntries((snap?.sources || []).map((s) => [s.id, s.label]));
  const srcLabel = (id) => md(labels[id] || id);
  const terms = snap?.terms || [];
  return {
    id: 'trends',
    label: 'SNSトレンド（Undercurrent）',
    note: terms.length
      ? `${terms.length} 件。観測 ${fmtTime(snap.generatedAt)}・${snap.stats?.signals ?? '—'} 件の投稿から。スコアは首位を 100 とした相対値。`
      : '観測データはまだありません。',
    items: terms.map((t, i) => item(`trend-${i + 1}`, `${i + 1}. ${t.t}`, trendLines(t, i, lexicon?.[t.k], defsMap?.[t.k], srcLabel, now), `スコア ${t.score} · ${UC_STATUS[t.status] || t.status}`)),
  };
}

/* ---------------- スラング大全（全語） ---------------- */
function lexiconGroup(lexicon, snap, defsMap, now) {
  const labels = Object.fromEntries((snap?.sources || []).map((s) => [s.id, s.label]));
  const srcLabel = (id) => md(labels[id] || id);
  const rows = Object.values(lexicon || {}).sort((a, b) => b.last - a.last || b.peak - a.peak);
  const counts = { newborn: 0, alive: 0, fading: 0, dead: 0 };
  for (const e of rows) counts[lifeStage(e, now)] += 1;
  return {
    id: 'lexicon',
    label: 'スラング大全',
    note: rows.length
      ? `収録 ${rows.length} 語（🌱${counts.newborn} / 🔥${counts.alive} / 🌫${counts.fading} / 💀${counts.dead}）。最近観測した順。`
      : '大全はまだ空です。',
    items: rows.map((e, i) => {
      const defs = defsMap?.[e.k];
      return item(`lex-${i + 1}`, e.t, [
        `#### ${md(e.t)}`,
        `- 状態: ${STAGE[lifeStage(e, now)]} / 言語 ${e.lang} / 最高スコア ${e.peak} / 観測回数 ${e.runs} / スラング度 ${pct(e.slang)}`,
        `- 初観測 ${fmtTime(e.first)} / 最終観測 ${fmtTime(e.last)}（${ago(e.last, now)}）`,
        ...(defs || []).map((d) => `- 意味（${md(d.source)}）: ${md(d.text)}`),
        Object.keys(e.srcs || {}).length ? `- 媒体: ${Object.entries(e.srcs).map(([id, n]) => `${srcLabel(id)} ×${n}`).join(' / ')}` : '',
        ...(e.samples || []).slice(0, 4).map((s) => `  - ${link(s.x, s.u)}（${srcLabel(s.s)}）`),
      ], `${STAGE[lifeStage(e, now)]} · 最高 ${e.peak}`);
    }),
  };
}

/* ---------------- 生データ・履歴・観測網 ---------------- */
function rawGroup(snap) {
  const streams = snap?.streams || {};
  const items = (snap?.sources || [])
    .filter((s) => streams[s.id]?.length)
    .map((s) => item(`raw-${s.id}`, `${s.label}（${streams[s.id].length} 件）`, [
      `#### ${md(s.label)}（${streams[s.id].length} 件）`,
      ...streams[s.id].map((x) => `- ${link(x.x, x.u)}${x.c ? `（${md(x.c).slice(0, 80)}）` : ''}`),
    ], `${streams[s.id].length} 件`));
  return { id: 'raw', label: '生データ', note: '各媒体から拾った投稿・トピックの上位。', items };
}

function historyGroup(meta) {
  const h = meta?.history || [];
  return {
    id: 'history',
    label: '過去の潮流',
    note: '観測ごとの上位語。',
    items: h.length ? [item('history', '観測ごとの上位', ['#### 観測ごとの上位', ...h.map((r) => `- ${fmtTime(r.at)}: ${r.top.map(md).join('、')}`)])] : [],
  };
}

function sourcesGroup(snap) {
  const s = snap?.sources || [];
  return {
    id: 'sources',
    label: '観測網',
    note: `${s.filter((x) => x.ok).length}/${s.length} 媒体が稼働。`,
    items: s.length ? [item('uc-sources', 'Undercurrent の観測網', ['#### Undercurrent の観測網', ...s.map((x) => `- ${x.icon || ''} ${md(x.label)}: ${x.ok ? `${x.count} 件 / ${x.ms}ms` : `停止中${x.error ? `（${md(x.error)}）` : ''}`}`)])] : [],
  };
}

/**
 * @returns {{generatedAt:number, head:string, groups:Array<{id,label,note,items:Array<{id,title,meta,md}>,md:string,chars:number}>, all:string}}
 */
export function buildAllCopy({ ai, snap, lexicon, meta, defs = {}, now = Date.now() }) {
  const groups = [
    radarGroup(snap, now),
    aiGroup(ai, now),
    trendsGroup(snap, lexicon, defs, now),
    lexiconGroup(lexicon, snap, defs, now),
    rawGroup(snap),
    historyGroup(meta),
    sourcesGroup(snap),
  ].map((g) => {
    const text = `## ${g.label}\n\n${g.note}\n\n${g.items.map((it) => it.md).join('\n\n')}\n`;
    return { ...g, md: text, chars: text.length };
  });
  const head = [
    '# Undercurrent × AI Pulse オールコピー',
    '',
    `書き出し: ${fmtTime(now)}（日本時間）`,
    `重要情報レーダー・SNSトレンド観測: ${fmtTime(snap?.generatedAt)} / AI Pulse 観測: ${fmtTime(ai?.generatedAt)}`,
    `収録: ${groups.map((g) => `${g.label} ${g.items.length}件`).join(' / ')}`,
    '各媒体の公開情報から自動で推定したもの。真偽・品質は一次情報で確認すること。',
    '',
  ].join('\n');
  return { generatedAt: now, head, groups, all: `${head}\n${groups.map((g) => g.md).join('\n')}` };
}
