/**
 * export.js — Undercurrent と AI Pulse の “すべての情報” を 1 つの Markdown にまとめる（純関数）
 *
 * セクションごとに分けて返すので、ページ側で「全部」「AI Pulse だけ」「スラング大全だけ」…と
 * 好きな単位でコピーできる。AI に貼り付けて分析させる用途を想定し、見出し・箇条書き・URL を省略しない。
 */

import { lifeStage } from './score.js';

const JST = { timeZone: 'Asia/Tokyo' };
const fmtTime = (t) =>
  Number.isFinite(t) && t > 0 ? new Date(t).toLocaleString('ja-JP', { ...JST, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
const agoH = (t, now) => (Number.isFinite(t) && t > 0 ? `${Math.max(0, Math.round((now - t) / 3.6e6))}時間前` : '—');
const one = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const md = (s) => one(s).replace(/([\\`*_[\]|<>])/g, '\\$1');
const link = (text, url) => (url && /^https?:\/\//.test(url) ? `[${md(text)}](${String(url).replace(/[()\s]/g, (c) => ({ '(': '%28', ')': '%29' })[c] || '%20')})` : md(text));

const AI_STATUS = { breakout: '急浮上', surging: '急騰', rising: '上昇', steady: '定着', cooling: '失速' };
const UC_STATUS = { new: '🌱誕生', surge: '🔥急騰', spread: '🌊拡散', revival: '🧟再燃', cool: '🥀失速', steady: '定着', slang: '🗯スラング', mainstream: '📣主流' };
const STAGE = { newborn: '🌱生まれたて', alive: '🔥生存中', fading: '🌫消えかけ', dead: '💀死語' };
const SRC = {
  hackernews: 'Hacker News', reddit: 'Reddit', lobsters: 'Lobsters', devto: 'DEV', mastodon: 'Mastodon', bluesky: 'Bluesky',
  github: 'GitHub', hfmodels: 'Hugging Face', hfspaces: 'HF Spaces', hfpapers: 'HF Papers', newsen: 'Google News', press: 'テック媒体',
  newsja: 'Google News 日本', hatena: 'はてブ', zenn: 'Zenn', qiita: 'Qiita', producthunt: 'Product Hunt', wikipedia: 'Wikipedia', googletrends: 'Google トレンド',
};
const FAM = { community: 'コミュニティ', code: 'コード', models: 'モデル', research: '研究', news: '報道', japan: '日本', products: 'プロダクト', search: '検索・関心' };

/* ---------------- AI Pulse ---------------- */
function aiSection(ai, now) {
  if (!ai?.top) return { title: 'AI Pulse', body: '_AI Pulse の観測データはまだありません。_\n' };
  const L = [];
  L.push(`観測時刻: ${fmtTime(ai.generatedAt)}（${agoH(ai.generatedAt, now)}） / シグナル ${ai.stats?.signals ?? '—'} 件（AI 関連 ${ai.stats?.aiSignals ?? '—'}） / 情報源 ${ai.stats?.sourcesUp ?? '—'}/${ai.stats?.sourcesTotal ?? '—'} 稼働 / 報道媒体 ${ai.stats?.publishers ?? '—'}`);
  L.push('Hype はその回の首位を 100 とした相対値（話題の量と広がり。品質・真偽の保証ではない）。');
  L.push('');
  L.push('### ランキング（全件）');
  L.push('');
  for (const t of ai.top) {
    const layers = Object.entries(t.fams || {}).filter(([, v]) => v >= 0.05).sort((a, b) => b[1] - a[1]).map(([f]) => FAM[f] || f);
    const mv = t.prevRank == null ? '初登場' : t.prevRank === t.rank ? '順位変わらず' : `前回 ${t.prevRank} 位`;
    L.push(`#### ${t.rank}. ${md(t.name)} — Hype ${t.hype}｜${AI_STATUS[t.status] || t.status}｜${md(t.angle || '')}`);
    L.push(`- 分類: ${md(t.catLabel)}${t.org ? ` / ${md(t.org)}` : ''} / ${mv}`);
    if (t.about) L.push(`- これは何: ${md(t.about)}`);
    if (t.why) L.push(`- なぜ話題: ${md(t.why)}`);
    L.push(`- 指標: 熱量 ${t.attention} / 勢い z ${t.z} / 話題の層 ${t.breadth}/8（${layers.join('・') || '—'}） / シグナル ${t.n} 件 / 初観測 ${fmtTime(t.first)}`);
    if (t.facts?.length) L.push(`- 根拠の数字: ${t.facts.map((f) => md(f.label)).join(' / ')}`);
    if (t.spark?.length > 1) L.push(`- 熱量の推移（古→新）: ${t.spark.join(' → ')}`);
    if (t.ev?.length) {
      L.push('- 話題になっている見出し:');
      for (const e of t.ev) L.push(`  - ${link(e.t, e.u)}（${md(SRC[e.src] || e.src)}${e.pub ? ` · ${md(e.pub)}` : ''}${e.tag ? ` · ${md(e.tag)}` : ''}）`);
    }
    L.push('');
  }
  if (ai.themes?.length) {
    L.push('### テーマ');
    L.push('');
    for (const th of ai.themes) L.push(`- ${md(th.label)}: 熱量 ${th.heat}/100、勢い z ${th.z}${th.top?.length ? `、主な話題 ${th.top.map((x) => md(x.name)).join('・')}` : ''}`);
    L.push('');
  }
  if (ai.sources?.length) {
    L.push('### 観測網の状態');
    L.push('');
    for (const s of ai.sources) L.push(`- ${md(s.label)}（${md(s.famLabel || s.fam)}）: ${s.ok ? `${s.count} 件 / ${s.ms}ms` : `停止中${s.error ? `（${md(s.error)}）` : ''}`}`);
    L.push('');
  }
  return { title: 'AI Pulse — いま流行っている AI', body: L.join('\n') };
}

/* ---------------- Undercurrent ---------------- */
function trendsSection(snap, now) {
  if (!snap?.terms) return { title: 'Undercurrent トレンド', body: '_観測データはまだありません。_\n' };
  const L = [];
  L.push(`観測時刻: ${fmtTime(snap.generatedAt)}（${agoH(snap.generatedAt, now)}） / 投稿・トピック ${snap.stats?.signals ?? '—'} 件 / 媒体 ${snap.stats?.sourcesUp ?? '—'}/${snap.stats?.sourcesTotal ?? '—'} 稼働`);
  L.push('スコアはその回の首位を 100 とした相対値（ニッチ潮流としての注目度）。');
  L.push('');
  snap.terms.forEach((t, i) => {
    const badges = (t.badges || []).map((b) => UC_STATUS[b] || b).join(' ');
    L.push(`#### ${i + 1}. ${md(t.t)} — スコア ${t.score}｜${UC_STATUS[t.status] || t.status}${badges ? `｜${badges}` : ''}`);
    L.push(`- 言語: ${t.lang} / 伸び率 ${Math.round((t.vel || 0) * 100)}% / ${t.spread} 媒体（${(t.srcs || []).join(', ')}） / 初観測 ${fmtTime(t.first)}${t.hl != null ? ` / 半減期 約${Math.round(t.hl)}時間` : ''}`);
    if (t.samples?.length) {
      L.push('- 用例:');
      for (const s of t.samples) L.push(`  - ${link(s.x, s.u)}（${md(s.s)}）`);
    }
    L.push('');
  });
  return { title: 'Undercurrent — ニッチ潮流トレンド', body: L.join('\n') };
}

function worldSection(snap) {
  const events = snap?.analysis?.events;
  if (!events?.length) return { title: '世界の情勢', body: '_情勢として推定できる見出しはありません。_\n' };
  const L = ['推定影響度はルールベースの暫定値。すべて真偽未検証。', ''];
  events.forEach((e, i) => {
    L.push(`#### ${i + 1}. ${md(e.title)}`);
    L.push(`- 分野: ${md(e.categoryLabel)} / 推定影響度 ${e.impact}/100 / ${md(e.status)} / ${e.sourceCount} 媒体 / ${fmtTime(e.at)}`);
    if (e.caution) L.push(`- 注意: ${md(e.caution)}`);
    for (const s of e.evidence || []) L.push(`  - ${link(s.title || s.url, s.url)}（${md(s.source)}）`);
    L.push('');
  });
  return { title: '世界の情勢（重要度推定）', body: L.join('\n') };
}

function lexiconSection(lexicon, now) {
  const rows = Object.values(lexicon || {});
  if (!rows.length) return { title: 'ネットスラング大全', body: '_大全はまだ空です。_\n' };
  rows.sort((a, b) => b.last - a.last || b.peak - a.peak);
  const counts = { newborn: 0, alive: 0, fading: 0, dead: 0 };
  for (const e of rows) counts[lifeStage(e, now)] += 1;
  const L = [
    `収録 ${rows.length} 語（🌱${counts.newborn} / 🔥${counts.alive} / 🌫${counts.fading} / 💀${counts.dead}）。最近観測した順。`,
    '',
    '| 語 | 言語 | 状態 | 最高スコア | 観測回数 | 初観測 | 最終観測 | 媒体 | 用例 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const e of rows) {
    L.push(`| ${md(e.t)} | ${e.lang} | ${STAGE[lifeStage(e, now)]} | ${e.peak} | ${e.runs} | ${fmtTime(e.first)} | ${fmtTime(e.last)} | ${Object.keys(e.srcs || {}).join(' ')} | ${md(e.samples?.[0]?.x || '').slice(0, 80)} |`);
  }
  L.push('');
  return { title: 'ネットスラング大全（全件）', body: L.join('\n') };
}

function rawSection(snap) {
  const streams = snap?.streams;
  if (!streams) return { title: '生データ', body: '_生データはありません。_\n' };
  const L = [];
  for (const src of snap.sources || []) {
    const list = streams[src.id];
    if (!list?.length) continue;
    L.push(`### ${md(src.label)}（${list.length} 件）`);
    for (const x of list) L.push(`- ${link(x.x, x.u)}${x.c ? `（${md(x.c).slice(0, 60)}）` : ''}`);
    L.push('');
  }
  return { title: '生データ（各媒体の上位投稿）', body: L.join('\n') };
}

function historySection(meta) {
  const h = meta?.history;
  if (!h?.length) return { title: '過去の潮流', body: '_履歴はまだありません。_\n' };
  return { title: '過去の潮流（観測ごとの上位）', body: `${h.map((r) => `- ${fmtTime(r.at)}: ${r.top.map(md).join('、')}`).join('\n')}\n` };
}

function sourcesSection(snap) {
  if (!snap?.sources) return { title: '観測網', body: '' };
  return {
    title: 'Undercurrent 観測網の状態',
    body: `${snap.sources.map((s) => `- ${s.icon || ''} ${md(s.label)}: ${s.ok ? `${s.count} 件 / ${s.ms}ms` : `停止中${s.error ? `（${md(s.error)}）` : ''}`}`).join('\n')}\n`,
  };
}

/**
 * @returns {{generatedAt:number, sections:Array<{id:string,group:string,title:string,body:string,chars:number}>, all:string}}
 */
export function buildExport({ ai, snap, lexicon, meta, now = Date.now() }) {
  const sections = [
    { id: 'ai', group: 'AI Pulse', ...aiSection(ai, now) },
    { id: 'trends', group: 'Undercurrent', ...trendsSection(snap, now) },
    { id: 'world', group: 'Undercurrent', ...worldSection(snap) },
    { id: 'lexicon', group: 'Undercurrent', ...lexiconSection(lexicon, now) },
    { id: 'history', group: 'Undercurrent', ...historySection(meta) },
    { id: 'raw', group: 'Undercurrent', ...rawSection(snap) },
    { id: 'sources', group: 'Undercurrent', ...sourcesSection(snap) },
  ].map((s) => {
    const text = `## ${s.title}\n\n${s.body.trim()}\n`;
    return { id: s.id, group: s.group, title: s.title, body: text, chars: text.length };
  });
  const head = [
    `# Undercurrent × AI Pulse 全データ`,
    '',
    `書き出し: ${fmtTime(now)}（日本時間）`,
    `AI Pulse 観測: ${fmtTime(ai?.generatedAt)} / Undercurrent 観測: ${fmtTime(snap?.generatedAt)}`,
    '各媒体の公開情報から自動で推定したもの。真偽・品質は一次情報で確認すること。',
    '',
  ].join('\n');
  const all = `${head}\n${sections.map((s) => s.body).join('\n')}`;
  return { generatedAt: now, head, sections, all };
}
