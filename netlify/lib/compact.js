/**
 * compact.js — オールコピーの “圧縮版”：同じ情報を約 1/10 の文字数で（純関数）
 *
 * 圧縮のしかた（意味は落とさず、冗長さだけを削る）
 *   1. 凡例は先頭に 1 回だけ。各行はラベルの代わりに短い記号（H=Hype、z=勢い …）
 *   2. 媒体名・層・状態は 1〜2 文字の略号（凡例で定義）
 *   3. 同じ見出しは全体で 1 回だけ（トレンド・大全・生データで重複していた分を削除）
 *   4. 見出しの中の項目名は「〃」に置換、長い見出しは要点の長さで切る
 *   5. 推移の系列は「開始→最大→現在」の 3 点に（形は保ったまま）
 *   6. 「なぜいま話題」の文章は 状態＋出来事の型＋層 から完全に再構成できるので省略
 *   7. URL は省略（媒体名は残す）。リンクが要る時は withLinks で短縮 URL を付ける
 */

import { lifeStage } from './score.js';

const one = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const cut = (s, n) => {
  const t = one(s);
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const num = (v) => {
  if (!Number.isFinite(v)) return '?';
  const a = Math.abs(v);
  const r = a >= 100 ? Math.round(v) : a >= 10 ? Math.round(v * 10) / 10 : Math.round(v * 100) / 100;
  return String(r).replace(/^0\./, '.').replace(/^-0\./, '-.');
};
const hrs = (t, now) => {
  if (!Number.isFinite(t) || t <= 0) return '?';
  const h = (now - t) / 3.6e6;
  return h < 1 ? `${Math.max(1, Math.round(h * 60))}m` : h < 48 ? `${Math.round(h)}h` : `${Math.round(h / 24)}d`;
};
const series = (vals) => {
  const v = (vals || []).filter(Number.isFinite);
  if (v.length < 2) return '';
  const max = Math.max(...v);
  const [a, z] = [v[0], v[v.length - 1]];
  if (max - Math.min(...v) < Math.max(0.05, max * 0.05)) return '';  // ほぼ平坦なら省略（＝変化なし）
  return max === z ? `${num(a)}→${num(z)}` : `${num(a)}→${num(max)}→${num(z)}`;
};
const shortUrl = (u) => {
  try {
    const x = new URL(u);
    for (const k of [...x.searchParams.keys()]) if (/^(utm_|ref|fbclid|gclid|oc$|hl$|gl$|ceid$)/.test(k)) x.searchParams.delete(k);
    return `${x.host.replace(/^www\./, '')}${x.pathname.replace(/\/$/, '')}${x.search}`;
  } catch {
    return '';
  }
};

/* 略号 */
const FAM = { community: 'コ', code: 'G', models: 'モ', research: '研', news: '報', japan: '日', products: 'P', search: '検' };
const AI_ST = { breakout: '急浮上', surging: '急騰', rising: '↑', steady: '→', cooling: '↓' };
const UC_ST = { new: '誕', surge: '騰', spread: '拡', revival: '再', cool: '失', steady: '定', slang: 'ス', mainstream: '主' };
const STAGE = { newborn: '生', alive: '活', fading: '衰', dead: '死' };
const EV = { launch: '発表', bench: '比較', open: '公開', try: '試用', money: '資金', policy: '規制', risk: '安全', price: '料金', debate: '賛否', deal: '提携', people: '人事', research: '研究' };
const CAT = { model: 'モデル', agent: '開発', product: '製品', company: '企業', research: '研究', infra: 'インフラ', opensource: 'OSS', policy: '規制', concept: '概念', emerging: '新出' };
const BAND = { hidden: '低注目', 'unknown-attention': '注目?', major: '高注目', low: '参考' };
const SRC = {
  // AI Pulse
  hackernews: 'HN', reddit: 'Rd', lobsters: 'Lo', devto: 'DEV', mastodon: 'Ms', bluesky: 'Bs', github: 'GH', hfmodels: 'HF',
  hfspaces: 'HFs', hfpapers: 'HFp', newsen: 'GN', press: '媒', newsja: 'GNj', hatena: 'はて', zenn: 'Zn', qiita: 'Qi',
  producthunt: 'PH', wikipedia: 'Wp', googletrends: 'GT',
  // Undercurrent
  misskey: 'Mk', urbandictionary: 'UD', knowyourmeme: 'KYM', niconico: 'ニコ', lemmy: 'Lm',
};
const src = (id) => SRC[id] || String(id || '').replace(/^world_/, '');

/** 「なぜ流行っているか」の数字ラベルを短い記号に（例：Hacker News 3件・最大 798pt → HN3/798p） */
function factCode(label) {
  const L = String(label);
  let m;
  if ((m = L.match(/^海外報道 (\d+)媒体/))) return `報${m[1]}`;
  if ((m = L.match(/^国内報道 (\d+)媒体/))) return `国報${m[1]}`;
  if ((m = L.match(/^Google トレンド入り（(.+)）/))) return `GT:${m[1].replace(/・/g, ',')}`;
  if ((m = L.match(/^GitHub ★([\d.万k]+)（1日あたり \+([\d.万k]+)）/))) return `GH★${m[1]}(+${m[2]}/日)`;
  if ((m = L.match(/^Wikipedia ([\d.万k]+)閲覧/))) return `Wp${m[1]}/日`;
  return L.replace(/^Hacker News /, 'HN').replace(/^Reddit /, 'Rd').replace(/^はてブ /, 'はて').replace(/^GitHub 新興リポジトリ /, 'GH')
    .replace(/^Hugging Face トレンド (\d+)位(・関連 (\d+)モデル)?/, (x, r, y, n) => `HF#${r}${n ? `(${n})` : ''}`)
    .replace(/^HF Spaces トレンド (\d+)位/, 'HFs#$1').replace(/^HF Daily Papers /, 'HFp').replace(/^Zenn /, 'Zn').replace(/^Qiita トレンド (\d+)本/, 'Qi$1')
    .replace(/^Lobsters (\d+)件/, 'Lo$1').replace(/^DEV (\d+)本/, 'DEV$1').replace(/^Mastodon (\d+)投稿/, 'Ms$1').replace(/^Bluesky トレンド入り/, 'Bs')
    .replace(/^Product Hunt 掲載/, 'PH').replace(/件・最大 |スレ・最大 |本・最大 /g, '/').replace(/ users/g, 'u').replace(/pt$/, 'p')
    .replace(/（(\d+)本）/, '($1)').replace(/\s+/g, '');
}

/** 日本語の前後の空白を詰める（「中国 DeepSeek の」→「中国DeepSeekの」） */
const tight = (s) => one(s).replace(/\s*([\u3000-\u30ff\u4e00-\u9fff（）「」、。・])\s*/g, '$1');

/** 見出しの重複を全体で 1 回にする */
function makeSeen() {
  const seen = new Set();
  return (text) => {
    const k = one(text).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '').slice(0, 60);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  };
}

/** 見出し中の項目名を 〃 に */
function ditto(text, name) {
  const n = one(name);
  if (!n || n.length < 2) return one(text);
  const re = new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[-\s]+/g, '[-\\s]?'), 'gi');
  return one(text).replace(re, '〃');
}

function head(text, name, seen, n = 64, url, withLinks) {
  if (!text || !seen(text)) return null;
  const t = cut(ditto(text, name).replace(/^【[^】]{1,8}】\s*/, '').replace(/^(?:Ask|Show|Tell|Launch)(?: HN)?:\s*|^POV:\s*|^Can someone explain\s+/i, '').replace(/\s+[-–—|]\s+[^-–—|]{2,30}$/, ''), n);
  if (t === '〃' || t.length < 4) return null;
  return withLinks && url ? `${t}<${shortUrl(url)}>` : t;
}

/* ---------------- グループ ---------------- */
function radar(snap, now, seen, withLinks) {
  const events = snap?.analysis?.events || [];
  return events.map((e, i) => {
    const ev = (e.evidence || []).map((s) => `${src(s.source)}${withLinks && s.url ? `<${shortUrl(s.url)}>` : ''}`).join(',');
    seen(e.title);
    return `R${i + 1} [${e.categoryLabel.replace(/・.*/, '')}]影${e.impact}${e.discoveryPriority != null ? ` 優${e.discoveryPriority}` : ''}${e.priorityBand ? ` ${BAND[e.priorityBand] || e.priorityBand}${e.attention != null ? e.attention : ''}` : ''} ${e.sourceCount}媒 ${hrs(e.at, now)}|${one(e.title)}|源:${ev}`;
  });
}

function aiPulse(ai, now, seen, withLinks) {
  const lines = [];
  const code = new Map((ai?.top || []).map((t) => [t.id, `A${t.rank}`]));
  for (const t of ai?.top || []) {
    const fams = Object.entries(t.fams || {}).filter(([, v]) => v >= 0.05).sort((a, b) => b[1] - a[1]).map(([f, v]) => `${FAM[f] || f}${Math.round(v * 100)}`).join(' ');
    const mv = t.prevRank == null ? '新' : t.prevRank === t.rank ? '' : t.prevRank > t.rank ? `▲${t.prevRank - t.rank}` : `▼${t.rank - t.prevRank}`;
    const facts = (t.facts || []).map((f) => factCode(f.label)).filter(Boolean).join(' ');
    // HF のモデル名・Spaces 名は「数:HF#n」と同じ情報なので見出しからは外す
    const heads = (t.ev || []).filter((e) => !['hfmodels', 'hfspaces'].includes(e.src)).map((e) => head(e.t, t.name, seen, 42, e.u, withLinks)).filter(Boolean).slice(0, t.rank <= 12 ? 2 : 1);
    lines.push(
      [
        `A${t.rank} ${t.name} H${t.hype}${AI_ST[t.status] || t.status}${mv ? ` ${mv}` : ''}`,
        `${CAT[t.cat] || t.catLabel}${t.org && !String(t.about || '').includes(t.org) ? `/${t.org}` : ''}`,
        cut(tight(t.about).replace(/。$/, ''), 44),
        t.events?.length ? `型:${t.events.map((x) => EV[x] || x).join(',')}` : '',
        `層:${fams}`,
        `z${t.z > 0 ? '+' : ''}${num(t.z)} n${t.n} ${hrs(t.first, now)}${series(t.spark) ? ` 推${series(t.spark)}` : ''}`,
        facts ? `数:${facts}` : '',
        heads.length ? `見:${heads.join('／')}` : '',
      ].filter(Boolean).join('|'),
    );
  }
  const th = (ai?.themes || []).map((x) => `${x.label}${x.heat}${x.z >= 0.5 ? '↑' : x.z <= -0.5 ? '↓' : ''}${x.top?.length ? `(${x.top.map((y) => code.get(y.id) || cut(y.name, 14)).join(',')})` : ''}`).join(' ');
  if (th) lines.push(`テーマ:${th}`);
  const down = (ai?.sources || []).filter((s) => !s.ok);
  if (ai?.sources) lines.push(`AI源:${ai.sources.length - down.length}/${ai.sources.length}稼働${down.length ? ` 停止:${down.map((s) => s.label).join(',')}` : ''}`);
  return lines;
}

function trends(snap, lexicon, defs, now, seen, withLinks) {
  return (snap?.terms || []).map((t, i) => {
    const e = lexicon?.[t.k] || {};
    const st = [t.status, ...(t.badges || [])].filter((x, k, a) => a.indexOf(x) === k).map((b) => UC_ST[b] || b).join('');
    const d = (defs?.[t.k] || []).map((x) => `${cut(ditto(tight(x.text), t.t).replace(/^〃\s*[—:-]\s*/, ''), 70)}(${x.source.startsWith('Urban') ? 'UD' : 'Wp'})${x.example ? `例:${cut(ditto(x.example, t.t), 30)}` : ''}`).join('／');
    const srcs = Object.entries(e.srcs || {}).sort((a, b) => b[1] - a[1]).map(([id, n]) => `${src(id)}${n > 1 ? n : ''}`).join(' ') || (t.srcs || []).map(src).join(' ');
    const samples = ((e.samples?.length ? e.samples : t.samples) || []).map((s) => head(s.x, t.t, seen, 42, s.u, withLinks)).filter(Boolean).slice(0, i < 12 ? 2 : 1);
    return [
      `T${i + 1} ${t.t} ${t.score} ${st} ${t.lang} ${Math.round((t.vel || 0) * 100)}% ${hrs(t.first, now)}${t.hl != null ? ` 半${Math.round(t.hl)}h` : ''}`,
      d ? `意:${d}` : '',
      e.runs ? `台:${STAGE[lifeStage(e, now)]}${e.runs}回${e.peak !== t.score ? ` 最${e.peak}` : ''} ス${Math.round((e.slang || 0) * 100)}` : '',
      series((e.hist || []).map((h) => h[1])) ? `推${series(e.hist.map((h) => h[1]))}` : '',
      `源:${srcs}`,
      samples.length ? `例:${samples.join('／')}` : '',
    ].filter(Boolean).join('|');
  });
}

function lexiconLines(lexicon, snap, defs, now) {
  const inTrends = new Set((snap?.terms || []).map((t) => t.k));
  const rows = Object.values(lexicon || {}).filter((e) => !inTrends.has(e.k)).sort((a, b) => b.last - a.last || b.peak - a.peak);
  if (!rows.length) return [];
  // 状態ごとにまとめ、1 語 = 「語 最高/回数」で詰める
  const by = {};
  for (const e of rows) (by[lifeStage(e, now)] ||= []).push(`${e.t} ${e.peak}/${e.runs}${defs?.[e.k]?.[0] ? `「${cut(defs[e.k][0].text, 40)}」` : ''}`);
  return Object.entries(by).map(([st, list]) => `大全${STAGE[st]}(${list.length}):${list.join('、')}`);
}

function rawLines(snap, seen, withLinks) {
  const out = [];
  for (const s of snap?.sources || []) {
    const list = (snap?.streams?.[s.id] || []).map((x) => head(x.x, '', seen, 42, x.u, withLinks)).filter(Boolean);
    if (list.length) out.push(`生${src(s.id)}:${list.join('／')}`);
  }
  return out;
}

/**
 * @returns {{text:string, groups:Record<string,string>, items:Record<string,string>}}
 *   items のキーはオールコピーの項目 ID（radar-1 / ai-1 / trend-1 …）と一致
 */
export function buildCompact({ ai, snap, lexicon, meta, defs = {}, now = Date.now(), withLinks = false }) {
  const seen = makeSeen();
  const R = radar(snap, now, seen, withLinks);
  const A = aiPulse(ai, now, seen, withLinks);
  const T = trends(snap, lexicon, defs, now, seen, withLinks);
  const L = lexiconLines(lexicon, snap, defs, now);
  const W = rawLines(snap, seen, withLinks);
  const tcode = new Map((snap?.terms || []).map((t, i) => [t.t, `T${i + 1}`]));
  const H = (meta?.history || []).map((r) => `-${hrs(r.at, now)}:${r.top.slice(0, 5).map((x) => tcode.get(x) || x).join(',')}`);
  const ucDown = (snap?.sources || []).filter((s) => !s.ok);
  const S = snap?.sources ? [`UC源:${snap.sources.length - ucDown.length}/${snap.sources.length}稼働${ucDown.length ? ` 停止:${ucDown.map((s) => s.label).join(',')}` : ''}`] : [];

  const t0 = new Date(now).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const legend = [
    `#UC×AIPulse ${t0}JST 自動推定・真偽未検証`,
    '凡例 R=重要情報(影=影響度 優=発見優先) A=AI(H=Hype/首位100 ↑→↓=上昇定着失速 ▲▼前回比 新=初登場 z=勢い n=信号数) T=SNS(スコア 状態:誕騰拡再失ス 伸び率) 時間=初観測から h/m/d 推=始→最大→今(最大=今なら始→今・平坦は省略) 〃=項目名',
    '層 コ=コミュ G=GitHub モ=HF 研=論文 報=海外報道 日=日本 P=PH 検=検索 | 源 HN Rd=Reddit GH HF HFs HFp GN=GNews 媒=テック誌 はて Zn Qi Wp GT=Gトレンド Bs Ms Mk UD KYM Lm ニコ | 型 発表比較公開試用資金規制安全料金賛否提携人事研究 | 台=台帳(生活衰死 回 最高 ス=スラング度) 意=意味 例=用例 見=見出し 数=根拠',
  ].join('\n');

  const groups = {
    radar: R.length ? `■重要情報レーダー\n${R.join('\n')}` : '',
    ai: A.length ? `■AI Pulse\n${A.join('\n')}` : '',
    trends: T.length ? `■SNSトレンド\n${T.join('\n')}` : '',
    lexicon: L.length ? `■スラング大全(トレンド以外)\n${L.join('\n')}` : '',
    raw: W.length ? `■生データ(重複除去)\n${W.join('\n')}` : '',
    history: H.length ? `■過去の上位(何時間前:T番号)\n${H.join(' ')}` : '',
    sources: S.join('\n'),
  };
  const items = {};
  R.forEach((l, i) => (items[`radar-${i + 1}`] = l));
  (ai?.top || []).forEach((t, i) => (items[`ai-${t.rank}`] = A[i]));
  T.forEach((l, i) => (items[`trend-${i + 1}`] = l));
  const text = `${legend}\n${Object.values(groups).filter(Boolean).join('\n')}\n`;
  return { legend, text, groups, items };
}
