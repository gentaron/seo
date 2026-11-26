/**
 * ai/engine.js — 「いま本当に流行っている AI」を選ぶ採点エンジン（純関数）
 *
 * 考え方：本物の流行は “1 つの場所で大きい” ではなく “性質の違う場所で同時に起きている” 。
 * 開発者が星を付け（GitHub）、研究者が票を入れ（HF Papers）、実務家が議論し（HN・Reddit）、
 * 記者が書き（報道）、一般の人が調べ始める（Wikipedia・Google トレンド）——
 * この連鎖を数値化する。
 *
 *  1. 正規化   : 媒体ごとにスケールが違う反応量を「媒体内の順位（パーセンタイル）」に直す。
 *                HN / Reddit は “経過時間あたりの票”（HN の gravity 式）、GitHub は “1 日あたりの星” も見る
 *  2. 新しさ   : 媒体ごとの半減期で減衰（速報は 16h、リポジトリ・モデルは 4〜5 日）
 *  3. 名寄せ   : 辞書（lexicon.js）＋ 成果物名の動的照合（HF のモデル名や GitHub のリポジトリ名が
 *                別の媒体の見出しに出たら同じものとして束ねる）＋ 辞書に無い新語の発見
 *  4. 系統内は飽和 : 同じ系統（例：コミュニティ）の中では noisy-OR で頭打ち。1 媒体の連投で勝てない
 *  5. 系統間は加点 : 出ている系統の数で超加法的にボーナス（＝ 世界の別々の層で同時に話題）
 *  6. 勢い     : 過去の観測の指数移動平均・分散からの z 値（“いつも大きい” より “いま跳ねた” を評価）
 *  7. 証拠の量 : シグナル数が少ないものはベイズ的に縮める（1 件だけのまぐれを抑える）
 *  8. 傘語の抑制 : 「OpenAI」「生成AI」のような常に出る傘の語は少し割り引き、具体的な製品・モデルを前へ
 */

import {
  extractEntities, isAiContext, detectThemes, slug, THEMES, ENTITY_MAP, CATS,
} from './lexicon.js';
import { describe, EVENTS } from './describe.js';

const H = 3.6e6;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r2 = (v) => Math.round(v * 100) / 100;

/** 系統の重み */
export const FAMILY = {
  community: { w: 1.0, label: 'コミュニティ' },
  code: { w: 0.85, label: 'コード' },
  models: { w: 0.9, label: 'モデル' },
  research: { w: 0.7, label: '研究' },
  news: { w: 1.0, label: '報道' },
  japan: { w: 0.8, label: '日本' },
  products: { w: 0.55, label: 'プロダクト' },
  search: { w: 0.75, label: '検索・関心' },
};

/** 順位自体が “いま” を表している媒体（作成日時で減衰させない） */
const LIVE = new Set(['hfmodels', 'hfspaces', 'wikipedia', 'googletrends', 'bluesky']);
/** 見出し名そのものが AI 文脈でないと数えない媒体（一般のトレンド一覧） */
const STRICT = new Set(['wikipedia', 'googletrends', 'bluesky']);
/** 傘の語の割り引き */
const UMBRELLA = { company: 0.78, concept: 0.86, policy: 0.9 };
const UMBRELLA_ID = { 'genai-jp': 0.55, 'ai-agents': 0.7, agi: 0.8, claude: 0.85, chatgpt: 0.85, gemini: 0.88 };

const LEDGER_MAX = 700;
const SERIES_LEN = 36;
const EWMA = 0.3;
const TOP_N = 60;

/* ---------------------------------------------------------------------
 * 1) 正規化：媒体内パーセンタイル
 * ------------------------------------------------------------------- */
function percentiles(values) {
  const idx = values.map((v, i) => [v, i]).filter(([v]) => Number.isFinite(v));
  const out = new Array(values.length).fill(null);
  if (idx.length < 2 || idx.every(([v]) => v === idx[0][0])) return out;
  idx.sort((a, b) => a[0] - b[0]);
  // 同値は同じ順位（平均順位）
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j += 1;
    const p = (i + j) / 2 / (idx.length - 1);
    for (let k = i; k <= j; k += 1) out[idx[k][1]] = p;
    i = j + 1;
  }
  return out;
}

/** 各シグナルに engagement(0〜1) と strength を付与 */
export function scoreSignals(signals, sourceMap, now) {
  const bySrc = new Map();
  signals.forEach((s, i) => {
    if (!bySrc.has(s.src)) bySrc.set(s.src, []);
    bySrc.get(s.src).push(i);
  });
  const eng = new Array(signals.length).fill(0.5);
  for (const idxs of bySrc.values()) {
    const list = idxs.map((i) => signals[i]);
    const pScore = percentiles(list.map((s) => (s.score > 0 ? Math.log1p(s.score) : s.score === 0 && s.rank == null ? 0 : NaN)));
    // 経過時間あたりの反応（HN の gravity 式）。GitHub は 1 日あたりの星
    const pRate = percentiles(
      list.map((s) => {
        if (s.vel != null) return s.vel;
        if (!(s.score > 0) || !s.ts) return NaN;
        const ageH = Math.max(0, (now - s.ts) / H);
        return s.score / (ageH + 2) ** 1.4;
      }),
    );
    list.forEach((s, k) => {
      let e;
      if (pScore[k] != null || pRate[k] != null) {
        e = Math.max(pScore[k] ?? 0, (pRate[k] ?? 0) * 0.97);
      } else if (s.rank != null) {
        e = 1 - (s.rank / Math.max(1, (s.n || 1) - 1)) * 0.75;
      } else {
        e = 0.5;
      }
      eng[idxs[k]] = clamp(e, 0, 1);
    });
  }
  return signals.map((s, i) => {
    const src = sourceMap[s.src] || { weight: 0.5, half: 24 };
    const ageH = Math.max(0, (now - (s.ts || now)) / H);
    const rec = LIVE.has(s.src) ? 1 : Math.max(0.06, 0.5 ** (ageH / (src.half || 24)));
    const e = eng[i];
    return { ...s, eng: r2(e), strength: src.weight * (0.18 + 0.82 * e ** 1.5) * rec };
  });
}

/* ---------------------------------------------------------------------
 * 2) 成果物名（リポジトリ・モデル・論文）の正規化と動的照合
 * ------------------------------------------------------------------- */
const COMMON = new Set(
  `agent agents chat chatbot model models demo app apps tool tools docs api server client code coder llm llms ai
  awesome skills skill prompts prompt notes web browser search editor studio lab labs hub kit sdk cli bot bots
  image video audio voice music assistant gpt open free mini nano base instruct preview release test data dataset
  system framework engine platform project template starter example examples playground benchmark eval evals
  research paper papers learning deep machine vision language speech text world mcp rag memory workflow flow`.split(/\s+/),
);

/** “Qwen3-VL-8B-Instruct-GGUF” → “Qwen3-VL”、“VibeVoice-1.5B” → “VibeVoice” */
export function artifactBase(name) {
  let n = String(name || '').trim();
  const colon = n.match(/^([^:：]{2,32})[:：]\s/);
  if (colon && colon[1].split(/\s+/).length <= 3) n = colon[1];
  n = n
    .replace(/[-_. ](?:\d+(?:\.\d+)?[BMK]|A\d+B|\d+x\d+B)(?=$|[-_. ])/gi, '')
    .replace(/[-_. ](?:instruct|chat|base|it|gguf|awq|gptq|fp8|fp16|bf16|mlx|onnx|int4|int8|preview|exp|hf|v\d+(?:\.\d+)*|\d{4}|20\d{2}[-_]?\d{2}(?:[-_]?\d{2})?|thinking|turbo|distill|q\d_k_m|4bit|8bit|lora|demo|app|space)(?=$|[-_. ])/gi, '')
    .replace(/[-_. ]+$/, '');
  return n.trim();
}

function distinctive(base) {
  const b = base.trim();
  if (b.length < 4 || b.length > 40) return false;
  if (/\s/.test(b) && b.split(/\s+/).length > 3) return false;
  const low = b.toLowerCase();
  if (COMMON.has(low)) return false;
  if (/^[a-z]+$/.test(b) && b.length < 7) return false; // 小文字だけの短い一般語
  if (/^[a-z]+(?:[- ][a-z]+)+$/.test(b) && b.split(/[- ]/).every((w) => COMMON.has(w) || w.length < 4)) return false;
  return true;
}

function escapeRx(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* ---------------------------------------------------------------------
 * 3) 辞書に無い新語の発見（固有名詞らしさ × 系統の広がり）
 * ------------------------------------------------------------------- */
const EMERGE_STOP = new Set(
  `JavaScript TypeScript PostgreSQL WebAssembly GitHub GitLab YouTube LinkedIn TikTok iPhone iPad macOS iOS
  PlayStation PyPI DevOps SaaS FastAPI NextJS LeetCode SpaceX OpenAPI GraphQL MongoDB MySQL SQLite PowerPoint
  ShowHN AskHN HackerNews ProductHunt DeepMind ChatGPT OpenAI WordPress JetBrains VSCode NeurIPS ICLR ICML CVPR
  COVID GDPR CEO CTO CFO API APIs GPU GPUs CPU CPUs LLM LLMs AGI USA UK EU AI ML NLP RAG SQL CLI SDK IDE PDF
  HTML CSS JSON HTTP HTTPS URL UI UX OS PC IPO VC VCs US FAQ TL DR AMA PSA RIP LOL WTF YoY QA PR PRs MVP B2B
  B2C SOTA FOMO TBD ETA NYT WSJ BBC CNN CNBC MIT IEEE ACM AWS GCP TPU NPU RAM SSD HBM 2FA Q1 Q2 Q3 Q4 H1 H2`.split(/\s+/),
);

function emergentCandidates(text) {
  const out = new Set();
  const t = String(text || '');
  // CamelCase（NotebookLM / OpenEvolve / DeepWiki）
  for (const m of t.matchAll(/(?<![A-Za-z0-9])([A-Z][a-z]+(?:[A-Z][a-z0-9]*|[A-Z]{2,})+[a-z0-9]*)(?![A-Za-z0-9])/g)) out.add(m[1]);
  // 英字＋数字の型番（Veo3 / Wan2.2 / HunyuanVideo-1.5 は家族で拾えない時の受け皿）
  for (const m of t.matchAll(/(?<![A-Za-z0-9.])([A-Z][A-Za-z]{2,}[-]?\d+(?:\.\d+)?[A-Za-z]?)(?![A-Za-z0-9])/g)) out.add(m[1]);
  // 引用符・鉤括弧で囲まれた名前
  for (const m of t.matchAll(/[“"「『]([^”"」』]{3,28})[”"」』]/g)) {
    const q = m[1].trim();
    if (q.split(/\s+/).length <= 4) out.add(q);
  }
  return [...out].filter((c) => !EMERGE_STOP.has(c) && !EMERGE_STOP.has(c.replace(/s$/, '')) && c.length >= 3);
}

/* ---------------------------------------------------------------------
 * 4) 本体
 * ------------------------------------------------------------------- */

/**
 * @param {object} p
 * @param {Array<object>} p.signals   collectAiSignals の全シグナル（src/fam 付き）
 * @param {Record<string,object>} p.sourceMap
 * @param {object} p.ledger           前回までの台帳（無ければ {}）
 * @param {number} p.now
 */
export function analyzeAi({ signals, sourceMap, ledger = {}, now = Date.now() }) {
  const runs = ledger.runs || 0;
  const warm = runs >= 3;
  const scored = scoreSignals(signals, sourceMap, now);

  // ---- AI 文脈の判定。文脈外のシグナルも “成果物名・新語の照合” にだけは使う
  //      （例：HN の「VibeVoice: open-source TTS」は AI の語を含まないが、HF のトレンドモデルと同じもの）
  const all = [];
  for (const s of scored) {
    const head = s.text;
    const body = s.desc || '';
    const strict = STRICT.has(s.src);
    const isAi = !!(s.native || isAiContext(strict ? head : `${head} ${body}`));
    all.push({ ...s, strict, isAi, ctxTitle: !!(s.native || isAiContext(head)) });
  }
  const ai = all.filter((s) => s.isAi);

  // ---- 名寄せの準備：成果物の “素の名前” を辞書照合し、照合できないものは動的辞書へ
  const ents = new Map(); // id → entity accumulator
  const touch = (id, init) => {
    if (!ents.has(id)) ents.set(id, { id, hits: [], kinds: new Set(), names: new Map(), arts: [], ...init });
    return ents.get(id);
  };
  const dyn = new Map(); // baseLower → entity id（動的照合）

  for (const s of ai) {
    if (!s.art) continue;
    const isPaper = s.art.type === 'paper';
    const rawName = s.art.name;
    // 論文は「名前: 副題」の名前部分だけを見る（“DeepSeek-V3.2: Sparse Attention …” → DeepSeek-V3.2）
    const head = isPaper ? (rawName.match(/^([^:：]{2,40})[:：]\s/) || [])[1] || '' : rawName;
    // 家族・辞書に当たるか（モデル名の “-” を空白にすると家族の正規表現が素直に当たる）
    const known = head ? extractEntities(`${head} ${head.replace(/[-_]+/g, ' ')}`, { aiContext: true }) : [];
    const base = isPaper ? artifactBase(rawName) : artifactBase(rawName.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ')).trim();
    if (known.length) {
      s.link = known[0].id;
      const e = touch(known[0].id, { name: known[0].name, cat: known[0].cat, org: known[0].org, kind: 'entity' });
      e.arts.push({ type: s.art.type, id: s.art.id, url: s.url });
      for (const k of known) touch(k.id, { name: k.name, cat: k.cat, org: k.org, kind: 'entity' });
      continue;
    }
    const label = isPaper ? (base.length <= 32 && base !== s.art.name ? base : s.art.name) : base || s.art.name;
    const id = `art:${slug(isPaper && label === s.art.name ? s.art.id : label)}`;
    s.link = id;
    const e = touch(id, { name: label, cat: isPaper ? 'research' : s.art.type === 'product' ? 'product' : s.art.type === 'repo' ? 'opensource' : 'model', kind: s.art.type, org: s.art.org });
    e.arts.push({ type: s.art.type, id: s.art.id, url: s.url, org: s.art.org });
    e.names.set(label, (e.names.get(label) || 0) + 1);
    if (distinctive(label) && (!isPaper || label !== s.art.name)) dyn.set(label.toLowerCase(), id);
  }
  const dynList = [...dyn.entries()].sort((a, b) => b[0].length - a[0].length);
  const dynRx = dynList.length
    ? new RegExp(`(?<![A-Za-z0-9])(${dynList.map(([b]) => b.split(/[-_ ]+/).map(escapeRx).join('[-_ ]?')).join('|')})(?![A-Za-z0-9])`, 'gi')
    : null;

  // ---- 新語の候補を数える（辞書・成果物に当たらないもの）
  const emerge = new Map();

  // ---- シグナル → エンティティ
  for (const s of all) {
    const mentions = new Map(); // id → weight
    const add = (id, w) => mentions.set(id, Math.max(mentions.get(id) || 0, w));
    if (s.link) add(s.link, 1);

    const titleEnts = s.isAi ? extractEntities(s.text, { aiContext: s.ctxTitle || s.native }) : [];
    for (const e of titleEnts) {
      touch(e.id, { name: e.name, cat: e.cat, org: e.org, kind: 'entity' });
      add(e.id, s.link && s.link !== e.id ? 0.55 : 1);
    }
    if (s.isAi && !s.strict && s.desc) {
      for (const e of extractEntities(s.desc, { aiContext: true })) {
        touch(e.id, { name: e.name, cat: e.cat, org: e.org, kind: 'entity' });
        add(e.id, 0.4);
      }
    }
    if (dynRx && !s.strict) {
      dynRx.lastIndex = 0;
      for (const m of `${s.text} ${s.desc || ''}`.matchAll(dynRx)) {
        const key = m[1].toLowerCase().replace(/[-_ ]/g, '');
        const hit = dynList.find(([b]) => b.replace(/[-_ ]/g, '') === key);
        if (hit && hit[1] !== s.link) add(hit[1], m.index < s.text.length ? 0.9 : 0.4);
      }
    }
    if (!s.strict && !s.art) {
      for (const c of emergentCandidates(s.text)) {
        if (extractEntities(c, { aiContext: true }).length) continue;
        if (dyn.has(c.toLowerCase())) continue;
        const key = slug(c);
        if (!emerge.has(key)) emerge.set(key, { name: c, sig: [] });
        emerge.get(key).sig.push(s);
      }
    }
    s.themes = s.strict || !s.isAi ? [] : detectThemes(`${s.text} ${s.desc || ''}`);
    for (const [id, w] of mentions) ents.get(id)?.hits.push({ s, w });
  }

  // 新語の昇格：2 系統以上 × 3 シグナル以上 × 2 媒体以上、かつ 1/3 以上が AI 文脈
  for (const [key, c] of emerge) {
    const fams = new Set(c.sig.map((s) => s.fam));
    const srcs = new Set(c.sig.map((s) => s.src));
    if (fams.size < 2 || c.sig.length < 3 || srcs.size < 2) continue;
    if (c.sig.filter((s) => s.isAi).length / c.sig.length < 0.34) continue;
    const id = `new:${key}`;
    const e = touch(id, { name: c.name, cat: 'emerging', kind: 'emerging' });
    for (const s of c.sig) e.hits.push({ s, w: 0.85 });
  }

  // ---- 集計
  const prevEnts = ledger.ents || {};
  const rows = [];
  for (const e of ents.values()) {
    if (!e.hits.length) continue;
    // 同じ URL は 1 回だけ（媒体をまたいだ同一記事は残す）
    const seen = new Set();
    const hits = e.hits.filter(({ s }) => {
      const k = `${s.src}|${s.url}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    const famAgg = {};
    for (const { s, w } of hits) {
      const v = clamp(s.strength * w, 0, 0.95);
      famAgg[s.fam] = famAgg[s.fam] || { miss: 1, n: 0 };
      famAgg[s.fam].miss *= 1 - v;
      famAgg[s.fam].n += 1;
    }
    let A = 0;
    const famScore = {};
    for (const [fam, agg] of Object.entries(famAgg)) {
      const f = 1 - agg.miss;
      famScore[fam] = r2(f);
      A += (FAMILY[fam]?.w ?? 0.5) * f;
    }
    const breadth = Object.values(famScore).filter((f) => f >= 0.05).length;
    const srcs = [...new Set(hits.map(({ s }) => s.src))];
    const n = hits.length;

    // 勢い（z 値）
    const prev = prevEnts[e.id];
    let z;
    if (prev && prev.runs >= 2) {
      z = (A - prev.mu) / Math.sqrt((prev.v || 0) + 0.015);
    } else if (prev) {
      z = clamp((A - prev.mu) / 0.2, -2, 3);
    } else if (warm) {
      z = clamp(A / 0.18, 0, 3); // それまで一度も観測されていなかったのに今回出てきた
    } else {
      // 立ち上げ直後：シグナル自体の新しさで代用（12h 以内の比率）
      const fresh = hits.filter(({ s }) => now - (s.ts || now) < 12 * H).length / n;
      z = r2(fresh * 1.6 - 0.3);
    }
    z = clamp(z, -3, 5);

    const first = prev?.f || Math.min(now, ...hits.map(({ s }) => (LIVE.has(s.src) ? now : s.ts || now)));
    const isNewToLedger = !prev;
    const novelty = warm && isNewToLedger ? 1.12 : warm && now - (prev?.f || now) < 24 * H ? 1.06 : 1;
    const umbrella = UMBRELLA_ID[e.id] ?? UMBRELLA[e.cat] ?? 1;
    const emergingDamp = e.kind === 'emerging' ? 0.85 : 1;
    const raw =
      A *
      (1 + 0.28 * (breadth - 1)) *
      (1 + 0.2 * clamp(z, -2, 4)) *
      (n / (n + 0.8)) *
      novelty *
      umbrella *
      emergingDamp;

    rows.push({ e, hits, famScore, A, breadth, srcs, n, z, raw, first, isNewToLedger });
  }
  rows.sort((a, b) => b.raw - a.raw);
  const maxRaw = rows[0]?.raw || 1;

  // ---- テーマ
  const themeAgg = {};
  for (const s of ai) {
    for (const th of s.themes || []) {
      themeAgg[th] = themeAgg[th] || {};
      themeAgg[th][s.fam] = (themeAgg[th][s.fam] || 0) + s.strength;
    }
  }
  const themeRaw = Object.fromEntries(
    Object.entries(themeAgg).map(([th, fams]) => [
      th,
      Object.entries(fams).reduce((acc, [fam, v]) => acc + (FAMILY[fam]?.w ?? 0.5) * Math.log1p(v * 2), 0),
    ]),
  );

  // ---- 出力（上位）と台帳更新
  const prevRanks = ledger.ranks || {};
  const top = rows.slice(0, TOP_N).map((row, i) => {
    const { e, hits, famScore } = row;
    const hype = Math.max(1, Math.round(100 * (row.raw / maxRaw) ** 0.75));
    const name = pickName(e);
    const themeCount = {};
    for (const { s } of hits) for (const th of s.themes || []) themeCount[th] = (themeCount[th] || 0) + 1;
    const themes = Object.entries(themeCount)
      .filter(([, c]) => c / hits.length >= 0.25)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([th]) => th);
    const ev = [...hits]
      .sort((a, b) => b.s.strength * b.w - a.s.strength * a.w)
      .filter((h, k, arr) => arr.findIndex((x) => x.s.url === h.s.url) === k)
      .slice(0, 8)
      .map(({ s }) => ({ t: s.text, u: s.url, src: s.src, fam: s.fam, c: s.ctx || '', ts: s.ts || now, pub: s.pub || undefined }));
    const prev = prevEnts[e.id];
    const spark = [...(prev?.s || []).map((p) => p[1]), r2(row.A)].slice(-24);
    const status = statusOf(row, warm, now);
    const facts = factsOf(hits);
    const ctx = describe(e, hits, { famScore, facts, status });
    for (const x of ev) x.tag = EVENTS.find((k) => k.re.test(x.t))?.angle;
    return {
      rank: i + 1,
      prevRank: prevRanks[e.id] ?? null,
      id: e.id,
      name,
      cat: e.cat,
      catLabel: e.cat === 'emerging' ? '新出' : CATS[e.cat] || 'その他',
      kind: e.kind,
      org: e.org || ENTITY_MAP[e.id]?.org || undefined,
      hype,
      attention: r2(row.A),
      z: r2(row.z),
      breadth: row.breadth,
      fams: famScore,
      srcs: row.srcs,
      n: row.n,
      status,
      first: row.first,
      themes,
      spark,
      url: e.arts[0]?.url || ev[0]?.u || '',
      arts: e.arts.slice(0, 4),
      facts,
      about: ctx.about,
      why: ctx.why,
      angle: ctx.angle,
      quote: ctx.quote,
      events: ctx.events,
      ev,
    };
  });

  const nextLedger = updateLedger({ ledger, rows, top, themeRaw, now, aiCount: ai.length });

  const themeMax = Math.max(0.001, ...Object.values(themeRaw));
  const themes = Object.entries(themeRaw)
    .map(([id, raw]) => {
      const prev = ledger.themes?.[id];
      const z = prev && prev.runs >= 2 ? (raw - prev.mu) / Math.sqrt((prev.v || 0) + 0.05) : 0;
      return {
        id,
        label: THEMES[id].label,
        icon: THEMES[id].icon,
        heat: Math.round(100 * raw / themeMax),
        z: r2(clamp(z, -3, 5)),
        spark: [...(prev?.s || []).map((p) => p[1]), r2(raw)].slice(-24),
        top: top.filter((t) => t.themes.includes(id)).slice(0, 4).map((t) => ({ id: t.id, name: t.name, hype: t.hype })),
      };
    })
    .sort((a, b) => b.heat - a.heat);

  return {
    top,
    themes,
    ledger: nextLedger,
    stats: {
      aiSignals: ai.length,
      linkedSignals: all.length - ai.length,
      entities: rows.length,
      emerging: rows.filter((r) => r.e.kind === 'emerging').length,
      publishers: new Set(ai.filter((s) => s.pub).map((s) => s.pub)).size,
      families: new Set(ai.map((s) => s.fam)).size,
      warm,
      runs: runs + 1,
    },
  };
}

function pickName(e) {
  if (!e.names.size) return e.name;
  return [...e.names.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

/** 状態：breakout（突如出現・複数系統）／surging（急騰）／rising（上昇）／steady（定着）／cooling（失速） */
function statusOf(row, warm, now) {
  if (!warm) {
    if (row.breadth >= 3 && row.z >= 0.9) return 'surging';
    return row.z >= 0.5 ? 'rising' : 'steady';
  }
  const young = now - row.first < 36 * H;
  if (young && ((row.breadth >= 2 && row.z >= 0.3) || row.z >= 2.5)) return 'breakout';
  if (row.z >= 1.5) return 'surging';
  if (row.z >= 0.5) return 'rising';
  if (row.z <= -0.8) return 'cooling';
  return 'steady';
}

/* ---------------------------------------------------------------------
 * 「なぜ流行っているか」を短い事実の列にする（日本語・UI 用）
 * ------------------------------------------------------------------- */
const kfmt = (v) => (v >= 10000 ? `${(v / 10000).toFixed(v >= 100000 ? 0 : 1)}万` : v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v)));

export function factsOf(hits) {
  const by = {};
  for (const { s } of hits) (by[s.src] = by[s.src] || []).push(s);
  const facts = [];
  const push = (fam, label, weight) => facts.push({ fam, label, w: weight });
  const max = (list, f) => Math.max(0, ...list.map(f));
  if (by.hackernews) push('community', `Hacker News ${by.hackernews.length}件・最大 ${kfmt(max(by.hackernews, (s) => s.pts || 0))}pt`, 3 + by.hackernews.length);
  if (by.reddit) push('community', `Reddit ${by.reddit.length}スレ・最大 ${kfmt(max(by.reddit, (s) => s.score || 0))}`, 3 + by.reddit.length);
  if (by.github) {
    const best = by.github.reduce((a, b) => ((b.stars || 0) > (a.stars || 0) ? b : a));
    push('code', by.github.length > 1 ? `GitHub 新興リポジトリ ${by.github.length}件・最大 ★${kfmt(best.stars || 0)}` : `GitHub ★${kfmt(best.stars || 0)}（1日あたり +${kfmt(best.vel || 0)}）`, 3);
  }
  if (by.hfmodels) push('models', `Hugging Face トレンド ${Math.min(...by.hfmodels.map((s) => (s.rank ?? 99) + 1))}位${by.hfmodels.length > 1 ? `・関連 ${by.hfmodels.length}モデル` : ''}`, 4);
  if (by.hfspaces) push('models', `HF Spaces トレンド ${Math.min(...by.hfspaces.map((s) => (s.rank ?? 99) + 1))}位`, 2);
  if (by.hfpapers) push('research', `HF Daily Papers ▲${kfmt(max(by.hfpapers, (s) => s.votes || 0))}${by.hfpapers.length > 1 ? `（${by.hfpapers.length}本）` : ''}`, 2.5);
  const pubs = new Set([...(by.newsen || []), ...(by.press || [])].map((s) => s.pub).filter(Boolean));
  if (pubs.size) push('news', `海外報道 ${pubs.size}媒体（${[...pubs].slice(0, 3).join('・')}${pubs.size > 3 ? ' ほか' : ''}）`, 2 + pubs.size);
  if (by.hatena) push('japan', `はてブ ${by.hatena.length}件・最大 ${kfmt(max(by.hatena, (s) => s.users || 0))} users`, 2 + by.hatena.length);
  const jaPubs = new Set((by.newsja || []).map((s) => s.pub).filter(Boolean));
  if (jaPubs.size) push('japan', `国内報道 ${jaPubs.size}媒体`, 1.5 + jaPubs.size * 0.5);
  if (by.zenn) push('japan', `Zenn ${by.zenn.length}本・最大 ♥${kfmt(max(by.zenn, (s) => s.score || 0))}`, 2);
  if (by.qiita) push('japan', `Qiita トレンド ${by.qiita.length}本`, 1);
  if (by.lobsters) push('community', `Lobsters ${by.lobsters.length}件`, 1);
  if (by.devto) push('community', `DEV ${by.devto.length}本`, 1);
  if (by.mastodon) push('community', `Mastodon ${by.mastodon.length}投稿`, 1);
  if (by.bluesky) push('community', 'Bluesky トレンド入り', 2.5);
  if (by.producthunt) push('products', 'Product Hunt 掲載', 1.5);
  if (by.wikipedia) push('search', `Wikipedia ${kfmt(max(by.wikipedia, (s) => s.views || 0))}閲覧/日`, 2.5);
  if (by.googletrends) push('search', `Google トレンド入り（${[...new Set(by.googletrends.map((s) => String(s.ctx || '').split(' ').pop()))].join('・')}）`, 3);
  return facts.sort((a, b) => b.w - a.w).slice(0, 6).map(({ fam, label }) => ({ fam, label }));
}

/* ---------------------------------------------------------------------
 * 台帳：EWMA の平均と分散、推移、前回順位
 * ------------------------------------------------------------------- */
function ewma(prev, x) {
  if (!prev) return { mu: x, v: 0, runs: 1 };
  const d = x - prev.mu;
  const mu = prev.mu + EWMA * d;
  const v = (1 - EWMA) * ((prev.v || 0) + EWMA * d * d);
  return { mu, v, runs: (prev.runs || 0) + 1 };
}

function updateLedger({ ledger, rows, top, themeRaw, now, aiCount }) {
  const ents = { ...(ledger.ents || {}) };
  const present = new Set();
  for (const row of rows) {
    const id = row.e.id;
    present.add(id);
    const prev = ents[id];
    const st = ewma(prev, row.A);
    ents[id] = {
      n: pickName(row.e),
      c: row.e.cat,
      f: prev?.f || row.first,
      l: now,
      ...st,
      mu: r2(st.mu * 1000) / 1000,
      v: Math.round(st.v * 1e5) / 1e5,
      s: [...(prev?.s || []), [now, r2(row.A)]].slice(-SERIES_LEN),
    };
  }
  // 今回出なかった語：0 として平均を下げる（3 日以上見えないものは削除）
  for (const [id, prev] of Object.entries(ents)) {
    if (present.has(id)) continue;
    if (now - (prev.l || 0) > 3 * 864e5) {
      delete ents[id];
      continue;
    }
    const st = ewma(prev, 0);
    ents[id] = { ...prev, ...st, mu: Math.round(st.mu * 1e5) / 1e5, v: Math.round(st.v * 1e5) / 1e5, s: [...(prev.s || []), [now, 0]].slice(-SERIES_LEN) };
  }
  // 件数の上限：最後に見た時刻が古い順に捨てる
  const ids = Object.keys(ents);
  if (ids.length > LEDGER_MAX) {
    ids.sort((a, b) => (ents[a].l || 0) - (ents[b].l || 0));
    for (const id of ids.slice(0, ids.length - LEDGER_MAX)) delete ents[id];
  }
  const themes = { ...(ledger.themes || {}) };
  for (const [id, raw] of Object.entries(themeRaw)) {
    const st = ewma(themes[id], raw);
    themes[id] = { ...st, s: [...(themes[id]?.s || []), [now, r2(raw)]].slice(-SERIES_LEN) };
  }
  return {
    runs: (ledger.runs || 0) + 1,
    lastAt: now,
    ents,
    themes,
    ranks: Object.fromEntries(top.map((t) => [t.id, t.rank])),
    vol: [...(ledger.vol || []), [now, aiCount]].slice(-SERIES_LEN),
  };
}
