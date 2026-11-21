/**
 * brief.js — トレンド間の関連分析（テーマ）と「世界の潮流」要約、データの偏りの明示
 *
 * ・テーマ：複数のクラスタに共通して現れる固有の語（例：AI）で話題を束ね、
 *   背景・共通点・相違点・今後の見通しをテンプレートで短く説明する。
 *   同時に観測されたことは因果関係を意味しないので、文章でも断定しない。
 * ・要約：重要度の高いものから 5〜10 件。「何が起きたか／なぜ重要か／何が未確認か」を付ける。
 * LLM は使わない（追加コストなし・再現可能）。文章はすべてデータから組み立てたテンプレート。
 */

import { STOP_EN, STOP_JA } from './text.js';
import { isGenericTerm } from './intelligence.js';
import { TOPIC_MAP, VERIFICATION, assessVerification, classifyTopic, scoreImportance } from './topics.js';
import { DIRECTIONS, canonicalUrl } from './trend.js';

const H = 3.6e6;
const ALIAS = { 人工知能: 'ai', 生成ai: 'ai', llm: 'ai', llms: 'ai', 'a.i.': 'ai' };
const KEEP = new Set(['ai']);
const DISPLAY = new Map(); // 正規化キー → 表示形（テーマ名に使う） // 一般語扱いだがテーマの軸としては有効な語
const THEME_STOP = new Set('report reports says said amid after over new first could would may might will just more most than into from with about this that these those their there here what when where which while week year today'.split(' '));

/** クラスタを特徴づける語（固有名詞・略語・カタカナ語・漢語） */
export function salientTokens(c) {
  const texts = [...c.members.map((m) => m.t), ...c.evidence.map((e) => e.x)];
  const out = new Set();
  const add = (raw, display) => {
    let k = String(raw).normalize('NFKC').toLowerCase().trim();
    k = ALIAS[k] || k;
    if (k.length < 2) return;
    if (!KEEP.has(k) && (STOP_EN.has(k) || STOP_JA.has(k) || THEME_STOP.has(k) || isGenericTerm(k))) return;
    out.add(k);
    if (display && !DISPLAY.has(k)) {
      if (DISPLAY.size > 5000) DISPLAY.clear();
      DISPLAY.set(k, display);
    }
  };
  for (const t of texts) {
    const s = String(t).normalize('NFKC');
    for (const m of s.matchAll(/\b(?:[A-Z][A-Za-z0-9+&.-]*[A-Za-z0-9]|[A-Z]{2,})\b/g)) add(m[0], m[0]);
    for (const m of s.matchAll(/AI|LLM/g)) add(m[0], m[0]);
    for (const m of s.matchAll(/[ァ-ヶー]{3,}/g)) add(m[0], m[0]);
    for (const m of s.matchAll(/[\p{Script=Han}]{2,6}/gu)) add(m[0], m[0]);
  }
  return out;
}

const topicLabel = (id) => TOPIC_MAP[id]?.label ?? id;
const tally = (arr) => arr.reduce((a, x) => ((a[x] = (a[x] || 0) + 1), a), {});
const fmtTally = (obj, labels) =>
  Object.entries(obj)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${labels[k] ?? k} ${n}`)
    .join('・');

/**
 * 関連する話題のテーマを抽出する
 * @param {Array<object>} clusters  trackThreads 後のクラスタ（id・dir・importance 付き）
 */
export function buildThemes(clusters, { limit = 6, minImportance = 35 } = {}) {
  const pool = clusters.filter((c) => c.importance != null && c.importance >= minImportance);
  const tokens = pool.map(salientTokens);
  const byToken = new Map();
  tokens.forEach((set, i) => {
    for (const tk of set) {
      if (!byToken.has(tk)) byToken.set(tk, new Set());
      byToken.get(tk).add(i);
    }
  });
  const candidates = [...byToken.entries()]
    .filter(([, idx]) => idx.size >= 2)
    .map(([tk, idx]) => {
      const cs = [...idx].map((i) => pool[i]);
      const topics = new Set(cs.map((c) => c.topic));
      return { tk, idx, cs, score: cs.reduce((a, c) => a + c.importance, 0) + 12 * (topics.size - 1) };
    })
    .sort((a, b) => b.score - a.score);

  const chosen = [];
  for (const cand of candidates) {
    // ほぼ同じ話題群を別の語で二重に出さない
    const dup = chosen.some((ch) => {
      const inter = [...cand.idx].filter((i) => ch.idx.has(i)).length;
      return inter / Math.min(cand.idx.size, ch.idx.size) >= 0.8;
    });
    if (dup) continue;
    chosen.push(cand);
    if (chosen.length >= limit) break;
  }

  return chosen.map(({ tk, idx, cs }) => {
    const label = DISPLAY.get(tk) || tk;
    const sorted = cs.slice().sort((a, b) => b.importance - a.importance);
    const topicsT = tally(cs.map((c) => c.topic));
    const dirsT = tally(cs.map((c) => c.dir));
    const verT = tally(cs.map((c) => c.verification.status));
    // テーマ内で 2 件以上に共通する、テーマ語以外の語
    const common = [...byToken.entries()]
      .filter(([k, s]) => k !== tk && [...s].filter((i) => idx.has(i)).length >= 2)
      .sort((a, b) => b[1].size - a[1].size)
      .slice(0, 4)
      .map(([k]) => DISPLAY.get(k) || k);
    const rising = sorted.filter((c) => c.dir === 'rising' || c.dir === 'new');
    const falling = sorted.filter((c) => c.dir === 'falling');
    let outlook;
    if (rising.length && rising[0].importance >= 60) outlook = `重要度の高い「${rising[0].t}」が${DIRECTIONS[rising[0].dir].label}です。続報・公式発表・独立した検証が出るかを監視してください。`;
    else if (falling.length > cs.length / 2) outlook = '関心は下がりつつあります。新しい展開があれば再燃する可能性があります。';
    else if (rising.length) outlook = `「${rising[0].t}」など新しい動きがあります。他の話題への波及は、続報で個別に確認してください。`;
    else outlook = '大きな変化はありません。各話題の続報を個別に確認してください。';
    return {
      id: `th-${tk.replace(/[^\p{L}\p{N}]+/gu, '-')}`,
      label,
      size: cs.length,
      clusters: sorted.map((c) => ({ id: c.id, t: c.t, topic: c.topic, dir: c.dir, importance: c.importance, verification: c.verification.status })),
      topics: Object.keys(topicsT),
      background: `「${label}」に関わる話題が ${cs.length} 件、同じ観測期間に出ています（${fmtTally(topicsT, Object.fromEntries(Object.keys(topicsT).map((k) => [k, topicLabel(k)])))}）。`,
      common: common.length ? `共通して現れる語：${common.join('、')}` : `いずれも「${label}」に言及しています`,
      differences: [
        Object.keys(topicsT).length > 1 ? `分野が異なる（${Object.keys(topicsT).map(topicLabel).join(' / ')}）` : `同じ分野（${topicLabel(Object.keys(topicsT)[0])}）内の別の話題`,
        `動向：${fmtTally(dirsT, Object.fromEntries(Object.entries(DIRECTIONS).map(([k, v]) => [k, v.label])))}`,
        `検証状態：${fmtTally(verT, Object.fromEntries(Object.entries(VERIFICATION).map(([k, v]) => [k, v.label])))}`,
      ],
      outlook,
      caution: '同じ時期に観測されたことは、因果関係や相互の影響を示すものではありません。',
    };
  });
}

/** 見出しとして読める根拠を選ぶ（語そのものだけのトピック名は避ける） */
export function headlineOf(c) {
  const long = (e) => e.x.length > c.t.length + 8;
  // 疑問形の見出し（"…is the bubble popping?"）より、断定的な報道見出しを代表にする
  const ev = c.evidence.slice().sort((a, b) => /[?？]\s*$/.test(a.x) - /[?？]\s*$/.test(b.x));
  const good = ev.find((e) => ['official', 'paper', 'news', 'web'].includes(e.type) && long(e));
  const post = ev.find((e) => e.type === 'sns' && long(e));
  const any = ev.find((e) => e.type !== 'search' && long(e));
  return (good || post || any)?.x || c.t;
}

/**
 * 世界の潮流の要約
 * @param {object} o
 * @param {Array<object>} o.clusters
 * @param {Array<object>} o.events   intelligence.buildWorldBrief の events
 * @param {Array<object>} o.watch
 * @param {number} o.now
 */
export function buildWorldSummary({ clusters = [], events = [], watch = [], themes = [], now = Date.now() }) {
  // 情勢イベントとトレンドクラスタが同じ記事を指していれば 1 件として扱う
  const urlToCluster = new Map();
  for (const c of clusters) for (const e of c.evidence) for (const u of [e.l, e.u]) if (u) urlToCluster.set(canonicalUrl(u), c.id);
  const linked = new Map();
  const standalone = [];
  for (const ev of events) {
    const cid = (ev.evidence || []).map((e) => urlToCluster.get(canonicalUrl(e.link || e.url))).find(Boolean);
    if (cid) linked.set(cid, ev);
    else standalone.push(ev);
  }

  const items = [];
  for (const c of clusters) {
    if (c.importance == null || c.importance < 40) continue;
    const ev = linked.get(c.id);
    const v = c.verification;
    items.push({
      id: c.id,
      kind: 'trend',
      title: headlineOf(c),
      term: c.t,
      topic: c.topic,
      topicLabel: topicLabel(c.topic),
      importance: c.importance,
      attention: c.attention,
      dir: c.dir,
      verification: { status: v.status, label: v.label },
      what: `${headlineOf(c)}（${c.spread}媒体・独立した投稿 ${c.posts} 件で観測）`,
      event: ev ? ev.id : null,
      why: c.impReason || `${topicLabel(c.topic)}の話題`,
      unknown: v.notes.find((n) => !/複数の独立した情報源が言及/.test(n)) || (v.status === 'confirmed' ? '詳細や影響の範囲は、今後の続報で変わる可能性があります。' : VERIFICATION[v.status].desc),
      url: c.evidence[0]?.l || c.evidence[0]?.u || null,
      first: c.first,
    });
  }
  for (const ev of standalone) {
    if (ev.importance == null || ev.importance < 40) continue;
    items.push({
      id: ev.id,
      kind: 'event',
      title: ev.title,
      term: null,
      topic: ev.topic,
      topicLabel: topicLabel(ev.topic),
      importance: ev.importance,
      attention: null,
      dir: null,
      verification: { status: ev.verification?.status ?? 'unverified', label: ev.verification?.label ?? VERIFICATION.unverified.label },
      what: `${ev.title}（${ev.sourceCount}媒体で観測）`,
      why: ev.impReason || `${ev.categoryLabel}の見出し`,
      unknown: ev.verification?.notes?.[0] || VERIFICATION.unverified.desc,
      url: ev.evidence?.[0]?.link || ev.evidence?.[0]?.url || null,
      first: ev.at,
    });
  }
  items.sort((a, b) => b.importance - a.importance || (b.attention ?? 0) - (a.attention ?? 0));
  const strong = items.filter((x) => x.importance >= 55);
  const changes = (strong.length >= 5 ? strong : items.filter((x) => x.importance >= 40).slice(0, 5)).slice(0, 10);
  const inChanges = new Set(changes.map((x) => x.id));

  const emerging = clusters
    .filter((c) => !inChanges.has(c.id) && (c.dir === 'new' || c.dir === 'rising') && now - c.first < 24 * H && c.importance != null && c.importance >= 30 && c.posts >= 1)
    .sort((a, b) => b.rise - a.rise || b.importance - a.importance)
    .slice(0, 6)
    .map((c) => ({ id: c.id, t: c.t, title: headlineOf(c), topic: c.topic, topicLabel: topicLabel(c.topic), importance: c.importance, dir: c.dir, verification: c.verification.status, posts: c.posts, spread: c.spread }));

  // 分野ごとの傾向（重要度 35 以上の話題のみ）
  const relevant = clusters.filter((c) => c.importance != null && c.importance >= 35);
  const byTopic = {};
  for (const c of relevant) {
    const b = (byTopic[c.topic] ||= { topic: c.topic, label: topicLabel(c.topic), n: 0, rising: 0, falling: 0, sum: 0 });
    b.n += 1;
    b.sum += c.importance;
    if (c.dir === 'rising' || c.dir === 'new') b.rising += 1;
    if (c.dir === 'falling') b.falling += 1;
  }
  const overview = Object.values(byTopic).sort((a, b) => b.sum - a.sum);
  const lead = overview.slice(0, 3).map((o) => `${o.label}（${o.n}件${o.rising ? `・新規/上昇 ${o.rising}` : ''}${o.falling ? `・下降 ${o.falling}` : ''}）`);
  const headline = relevant.length
    ? `今回の観測では ${lead.join('、')} の話題が中心です。${themes[0] ? `「${themes[0].label}」が ${themes[0].size} 件の話題にまたがっています。` : ''}`
    : '重要度を判定できるだけの話題が、今回の観測では見つかりませんでした。';

  return {
    generatedAt: now,
    headline,
    changes,
    emerging,
    watch: watch.slice(0, 8),
    overview: overview.map(({ sum, ...o }) => ({ ...o, avg: Math.round(sum / o.n) })),
    note: '重要度はルールベースの推定（0〜100）で、真偽の確率や予測ではありません。「確認済み」は複数の独立した情報源が言及していることを示し、内容の最終確認ではありません。',
  };
}

/**
 * 情勢イベントに検証状態・内容分類・重要度を付ける（intelligence.js の出力を拡張）。
 * 重要度はトレンドと同じ scoreImportance で算出し、同じ尺度で比べられるようにする。
 * 旧来の impact（編集上の優先度）は互換のため残す。
 */
export function enrichEvents(events = [], { now = Date.now() } = {}) {
  return events.map((ev) => {
    const evidence = (ev.evidence || []).map((e) => ({ src: e.source, url: e.url, link: e.link, text: e.title }));
    const texts = evidence.map((e) => e.text);
    const cls = classifyTopic({ terms: [ev.title], texts });
    const topics = cls.matched ? cls.topics : [EVENT_TOPIC[ev.category] || 'other'];
    const pre = assessVerification(evidence);
    const imp = scoreImportance({
      topics,
      matched: true,
      texts,
      langs: texts.map((t) => (/[\u3040-\u30ff\u3400-\u9fff]/.test(t) ? 'ja' : 'en')),
      byType: pre.byType,
      posts: evidence.length,
      domains: pre.domains,
      spread: ev.sourceCount,
      ageH: (now - ev.at) / H,
      verification: pre.status,
    });
    const v = assessVerification(evidence, { importance: imp.importance });
    return {
      ...ev,
      importance: imp.importance,
      impReason: imp.reason,
      impFactors: imp.factors,
      topic: topics[0],
      verification: { status: v.status, label: v.label, stage: v.stage, notes: v.notes, byType: v.byType },
    };
  });
}
const EVENT_TOPIC = { security: 'security', infrastructure: 'society', geopolitics: 'politics', markets: 'economy', policy: 'politics', technology: 'technology' };

/** 観測の偏り（媒体・言語）を明示する */
export function coverageOf(signals = [], sources = []) {
  const total = signals.length || 1;
  const bySrc = tally(signals.map((s) => s.src));
  const byLang = { ja: 0, en: 0 };
  for (const s of signals) {
    const t = String(s.text || '');
    if (/[぀-ヿ㐀-鿿]/.test(t)) byLang.ja += 1;
    else if (/[A-Za-z]/.test(t)) byLang.en += 1;
  }
  const label = (id) => sources.find((m) => m.id === id)?.label || id;
  const bySource = Object.entries(bySrc)
    .sort((a, b) => b[1] - a[1])
    .map(([id, n]) => ({ id, label: label(id), n, share: Math.round((n / total) * 100) }));
  const warnings = [];
  if (bySource[0] && bySource[0].share >= 35) warnings.push(`${bySource[0].label} が全投稿の ${bySource[0].share}% を占めており、結果がこの媒体に偏っている可能性があります。`);
  const down = sources.filter((m) => !m.ok);
  if (down.length) warnings.push(`${down.length} 媒体（${down.map((m) => m.label).join('・')}）が今回は取得できていません。`);
  if (byLang.ja && byLang.en) {
    const ratio = Math.max(byLang.ja, byLang.en) / Math.min(byLang.ja, byLang.en);
    if (ratio >= 3) warnings.push(`${byLang.ja > byLang.en ? '日本語' : '英語'}の投稿が約 ${Math.round(ratio)} 倍多く、地域による偏りがあります。`);
  }
  if (signals.length < 80) warnings.push(`観測できた投稿が ${signals.length} 件と少なく、重要度・動向の判定は暫定です。`);
  return { total: signals.length, bySource, byLang, warnings };
}

/** スコアの算出基準（UI・API にそのまま載せる） */
export const METHOD = {
  attention: '注目度（0〜100）：各媒体での反応の順位 × 媒体の重み × 新しさ × 媒体側の勢い。統合した語の熱量も加味し、今回の観測内で最上位を 100 とした相対値。社会的な重要度とは別の尺度です。',
  importance: '重要度（0〜100）：内容の分野（安全保障・政治・経済・科学など）を基準に、影響範囲（言語圏・情報源の種類・発信元の数）、新規性、科学的意義、経済的影響、社会への影響、公式発表の有無を加減点。データが足りないときは「判定保留」。',
  direction: '動向：NEW＝比較対象なし／上昇中＝基準比 +25% 以上かつ独立した投稿 2 件以上（または 2 媒体以上）／下降中＝基準比 −25% 以下／それ以外は横ばい。基準は過去の指数移動平均と「24時間前の同時間帯」の大きい方。少数投稿の伸び率は投稿数に応じて割り引き、曜日タグは補正します。',
  verification: '検証状態：確認済み＝2つ以上の独立した報道・公式・論文ドメイン／調査中＝そのうち1系統のみ／未検証＝SNS・リポジトリ・検索トレンドのみ／誤情報の可能性＝デマ・誤情報・撤回などの指摘を含む。',
  window: '比較期間：前回観測（通常 3 時間前）と、24 時間前・48 時間前の観測。観測は 3 時間ごと。',
  times: '時刻：「収集」は UNDERCURRENT が取得した時刻、「公開」は元の媒体が示す時刻です。媒体が時刻を持たない場合、公開時刻は不明と表示します。',
  merge: '統合：同じ記事（URL）や同じ見出しに出る語、表記を含む語を 1 つのトレンドにまとめます。まとめた語・投稿・出典はすべて詳細で確認できます。',
};
