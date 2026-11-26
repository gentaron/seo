/**
 * ai/sources.js — AI / テックの “いま” を世界中から集める観測網（すべて無料・API キー不要）
 *
 * 媒体は「系統（family）」に分けてある。同じ系統の中で何度出ても頭打ちになり、
 * 系統をまたいで出ているもの（例：Hugging Face トレンド ＋ Hacker News ＋ 報道 ＋ はてブ）ほど強く効く。
 *
 *   community : Hacker News / Reddit (AI 系 14 サブレ) / Lobsters / DEV / Mastodon / Bluesky
 *   code      : GitHub（直近に生まれて星を集めるリポジトリ）
 *   models    : Hugging Face のトレンドモデル・Spaces
 *   research  : Hugging Face Daily Papers（研究者コミュニティの投票）
 *   news      : Google News（英・日）＋ テック媒体 9 誌の AI 面
 *   japan     : はてブ IT / Zenn / Qiita
 *   products  : Product Hunt（AI カテゴリ）
 *   search    : Wikipedia 閲覧数・Google トレンド（一般層の “調べられている” 量）
 *
 * シグナルの形：
 *   { text, desc?, url, score, ts, rank, n, pub?, art?, native?, vel? }
 *     score : 媒体内の反応量（票・星・いいね等。媒体ごとにスケールは別 → engine 側で順位化）
 *     rank/n: 媒体が付けた順位とリスト長（反応量が取れない RSS 用）
 *     pub   : 報道の発行元（独立した媒体数を数えるため）
 *     art   : 成果物そのもの（{type:'repo'|'model'|'space'|'paper', id, name}）
 *     native: その媒体自体が AI 専門（AI 文脈判定を省略できる）
 */

import { parseFeed, parseDate } from '../feedparse.js';
import { stripHtml } from '../text.js';
import { getJson, getText, firstOk, BROWSER_UA } from '../sources.js';

const H = 3.6e6;
const now = () => Date.now();
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const ymd = (d) => [d.getUTCFullYear(), String(d.getUTCMonth() + 1).padStart(2, '0'), String(d.getUTCDate()).padStart(2, '0')];

/** allSettled して成功分だけ平らにする。全滅なら最初の失敗理由で throw */
async function settleAll(tasks) {
  const settled = await Promise.allSettled(tasks);
  const ok = settled.filter((s) => s.status === 'fulfilled').map((s) => s.value);
  if (!ok.length) throw new Error(settled.find((s) => s.status === 'rejected')?.reason?.message || 'empty');
  return { ok, failed: settled.length - ok.length };
}

function nonEmpty(list) {
  if (!list.length) throw new Error('empty');
  return list;
}

/* =====================================================================
 * Hacker News（Algolia）— 48 時間以内の人気記事 ＋ AI 語での横断検索
 * =================================================================== */
const HN_QUERIES = ['', 'AI', 'LLM', 'GPT', 'Claude', 'Gemini', 'agent', 'model'];

async function hackernews(ctx) {
  const since = Math.floor((now() - 48 * H) / 1000);
  const { ok } = await settleAll(
    HN_QUERIES.map((q) =>
      getJson(
        `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(q)}&tags=story&numericFilters=created_at_i>${since},points>12&hitsPerPage=${q ? 60 : 100}`,
        ctx,
      ),
    ),
  );
  const seen = new Set();
  const out = [];
  for (const r of ok) {
    for (const h of r?.hits ?? []) {
      if (!h.title || seen.has(h.objectID)) continue;
      seen.add(h.objectID);
      out.push({
        text: h.title.replace(/^(Show|Ask|Tell|Launch) HN:\s*/i, ''),
        url: `https://news.ycombinator.com/item?id=${h.objectID}`,
        ext: h.url || '',
        score: num(h.points) + num(h.num_comments) * 0.6,
        ts: num(h.created_at_i) * 1000 || now(),
        ctx: `${num(h.points)} points · ${num(h.num_comments)} comments`,
        pts: num(h.points),
      });
    }
  }
  return nonEmpty(out);
}

/* =====================================================================
 * Reddit — AI 専門サブレの “今日のトップ” と “hot”
 * =================================================================== */
export const AI_SUBS = [
  'LocalLLaMA', 'MachineLearning', 'singularity', 'OpenAI', 'ClaudeAI', 'ChatGPT', 'StableDiffusion',
  'artificial', 'LocalLLM', 'GeminiAI', 'cursor', 'ChatGPTCoding', 'aivideo', 'comfyui', 'Bard', 'AI_Agents',
];

async function reddit(ctx) {
  const multi = AI_SUBS.join('+');
  const urlsFor = (sort) => [
    `https://www.reddit.com/r/${multi}/${sort}.json?limit=100&raw_json=1${sort === 'top' ? '&t=day' : ''}`,
    `https://old.reddit.com/r/${multi}/${sort}.json?limit=100&raw_json=1${sort === 'top' ? '&t=day' : ''}`,
  ];
  const readJson = (u) => getJson(u, { ...ctx, ua: BROWSER_UA });
  const lists = await Promise.allSettled([
    firstOk(urlsFor('top'), readJson),
    firstOk(urlsFor('hot'), readJson),
  ]);
  const out = [];
  const seen = new Set();
  for (const r of lists) {
    if (r.status !== 'fulfilled') continue;
    for (const c of r.value?.data?.children ?? []) {
      const d = c.data;
      if (!d || d.over_18 || d.stickied || seen.has(d.id)) continue;
      seen.add(d.id);
      out.push({
        text: d.title,
        desc: String(d.selftext || '').slice(0, 280),
        url: `https://www.reddit.com${d.permalink}`,
        score: num(d.score) + num(d.num_comments) * 1.5,
        ts: num(d.created_utc) * 1000 || now(),
        ctx: `r/${d.subreddit}${d.link_flair_text ? ` · ${d.link_flair_text}` : ''}`,
        native: true,
      });
    }
  }
  if (out.length) return out;
  // JSON が弾かれた時は RSS（反応量は取れないので順位だけ）
  const xml = await getText(`https://www.reddit.com/r/${multi}/top/.rss?t=day&limit=60`, { ...ctx, ua: BROWSER_UA });
  const items = parseFeed(xml);
  return nonEmpty(
    items.map((i, idx) => ({
      text: i.title,
      url: i.link,
      score: 0,
      rank: idx,
      n: items.length,
      ts: parseDate(i.date) || now(),
      ctx: (i.link.match(/\/r\/([^/]+)/) || [])[1] || '',
      native: true,
    })),
  );
}

/* =====================================================================
 * GitHub — 直近 7 日／2 日に生まれて星を集めているリポジトリ（＝ 星の “速度”）
 * =================================================================== */
async function github(ctx) {
  const d7 = new Date(now() - 7 * 864e5).toISOString().slice(0, 10);
  const d2 = new Date(now() - 2 * 864e5).toISOString().slice(0, 10);
  const q = (s) => `https://api.github.com/search/repositories?q=${encodeURIComponent(s)}&sort=stars&order=desc&per_page=60`;
  const { ok } = await settleAll([
    getJson(q(`created:>${d7} stars:>40`), { ...ctx, accept: 'application/vnd.github+json' }),
    getJson(q(`created:>${d2} stars:>15`), { ...ctx, accept: 'application/vnd.github+json' }),
  ]);
  const seen = new Set();
  const out = [];
  for (const data of ok) {
    for (const r of data?.items ?? []) {
      if (!r?.full_name || seen.has(r.full_name)) continue;
      seen.add(r.full_name);
      const created = parseDate(r.created_at) || now();
      const ageD = Math.max(0.25, (now() - created) / 864e5);
      const topics = (r.topics ?? []).slice(0, 8);
      out.push({
        text: `${r.name}${r.description ? ` — ${r.description}` : ''}`.slice(0, 260),
        desc: topics.join(' '),
        url: r.html_url,
        score: num(r.stargazers_count),
        vel: num(r.stargazers_count) / ageD, // 1 日あたりの星
        ts: created,
        ctx: `★${num(r.stargazers_count)} · ${r.language || '—'}`,
        art: { type: 'repo', id: r.full_name, name: r.name },
        stars: num(r.stargazers_count),
      });
    }
  }
  return nonEmpty(out);
}

/* =====================================================================
 * Hugging Face — トレンドのモデル・Spaces・Daily Papers
 * =================================================================== */
const HF_SKIP_ORGS = /^(?:sentence-transformers|google-bert|FacebookAI|openai-community|distilbert)\//i;

async function hfmodels(ctx) {
  const list = await getJson('https://huggingface.co/api/models?sort=trendingScore&direction=-1&limit=50', ctx);
  if (!Array.isArray(list)) throw new Error('bad shape');
  return nonEmpty(
    list
      .filter((m) => m?.id && !HF_SKIP_ORGS.test(m.id))
      .map((m, idx) => {
        const [org, name = m.id] = String(m.id).split('/');
        return {
          text: `${name}${m.pipeline_tag ? ` (${m.pipeline_tag})` : ''}`,
          desc: `${org} ${(m.tags ?? []).slice(0, 10).join(' ')}`,
          url: `https://huggingface.co/${m.id}`,
          score: num(m.trendingScore) || num(m.likes),
          rank: idx,
          n: list.length,
          ts: parseDate(m.createdAt) || now() - 24 * H,
          ctx: `${org} · ♥${num(m.likes)}${m.downloads ? ` · ↓${num(m.downloads)}` : ''}`,
          art: { type: 'model', id: m.id, name, org },
          native: true,
          likes: num(m.likes),
        };
      }),
  );
}

async function hfspaces(ctx) {
  const list = await getJson('https://huggingface.co/api/spaces?sort=trendingScore&direction=-1&limit=40', ctx);
  if (!Array.isArray(list)) throw new Error('bad shape');
  return nonEmpty(
    list
      .filter((s) => s?.id)
      .map((s, idx) => {
        const [org, name = s.id] = String(s.id).split('/');
        const title = s.cardData?.title || name.replace(/[-_]+/g, ' ');
        return {
          text: `${title}${s.cardData?.short_description ? ` — ${s.cardData.short_description}` : ''}`,
          desc: `${org} ${(s.tags ?? []).slice(0, 8).join(' ')} ${s.sdk || ''}`,
          url: `https://huggingface.co/spaces/${s.id}`,
          score: num(s.trendingScore) || num(s.likes),
          rank: idx,
          n: list.length,
          ts: parseDate(s.createdAt) || now() - 24 * H,
          ctx: `${org} · ♥${num(s.likes)}`,
          art: { type: 'space', id: s.id, name: title, org },
          native: true,
        };
      }),
  );
}

async function hfpapers(ctx) {
  const list = await getJson('https://huggingface.co/api/daily_papers?limit=60', ctx);
  if (!Array.isArray(list)) throw new Error('bad shape');
  return nonEmpty(
    list
      .filter((p) => p?.paper?.id || p?.title)
      .map((p) => {
        const paper = p.paper || {};
        const title = stripHtml(paper.title || p.title || '');
        const keywords = (paper.ai_keywords ?? []).slice(0, 8).join(' ');
        return {
          text: title,
          desc: `${stripHtml(paper.summary || p.summary || '').slice(0, 320)} ${keywords}`,
          url: `https://huggingface.co/papers/${paper.id}`,
          score: num(paper.upvotes) + num(p.numComments) * 2,
          ts: parseDate(p.publishedAt || paper.publishedAt) || now() - 24 * H,
          ctx: `▲${num(paper.upvotes)}${paper.githubRepo ? ' · code' : ''}`,
          art: { type: 'paper', id: paper.id, name: title },
          native: true,
          votes: num(paper.upvotes),
        };
      }),
  );
}

/* =====================================================================
 * 報道：Google News（英・日の横断検索）＋ テック媒体の AI 面
 * =================================================================== */
const GNEWS = [
  { q: '"artificial intelligence" OR "AI model" when:1d', hl: 'en-US', gl: 'US', ceid: 'US:en' },
  { q: 'OpenAI OR Anthropic OR "Google Gemini" OR DeepSeek OR Nvidia AI when:1d', hl: 'en-US', gl: 'US', ceid: 'US:en' },
  { q: 'LLM OR "AI agent" OR "AI startup" when:1d', hl: 'en-GB', gl: 'GB', ceid: 'GB:en' },
  { q: 'AI when:1d', hl: 'en-IN', gl: 'IN', ceid: 'IN:en' },
];
const GNEWS_JA = [
  { q: '生成AI when:1d', hl: 'ja', gl: 'JP', ceid: 'JP:ja' },
  { q: 'AI OR ChatGPT OR Gemini OR Claude when:1d', hl: 'ja', gl: 'JP', ceid: 'JP:ja' },
];

function gnewsUrl({ q, hl, gl, ceid }) {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=${hl}&gl=${gl}&ceid=${encodeURIComponent(ceid)}`;
}

function readGoogleNews(xmls) {
  const out = [];
  const seen = new Set();
  for (const xml of xmls) {
    const items = parseFeed(xml);
    items.forEach((i, idx) => {
      const pub = (i.raw.match(/<source[^>]*>([\s\S]*?)<\/source>/i) || [])[1];
      const publisher = pub ? stripHtml(pub) : (i.title.match(/\s[-–—]\s([^-–—]+)$/) || [])[1] || '';
      const title = i.title.replace(/\s[-–—]\s[^-–—]+$/, '').trim();
      const key = title.toLowerCase().slice(0, 90);
      if (!title || seen.has(key)) return;
      seen.add(key);
      out.push({
        text: title,
        url: i.link,
        score: 0,
        rank: idx,
        n: items.length,
        ts: parseDate(i.date) || now(),
        ctx: publisher,
        pub: publisher.trim(),
      });
    });
  }
  return out;
}

async function newsen(ctx) {
  const { ok } = await settleAll(GNEWS.map((g) => getText(gnewsUrl(g), { ...ctx, ua: BROWSER_UA })));
  return nonEmpty(readGoogleNews(ok));
}

async function newsja(ctx) {
  const { ok } = await settleAll([
    ...GNEWS_JA.map((g) => getText(gnewsUrl(g), { ...ctx, ua: BROWSER_UA })),
  ]);
  return nonEmpty(readGoogleNews(ok));
}

export const PRESS_FEEDS = [
  ['TechCrunch', 'https://techcrunch.com/category/artificial-intelligence/feed/'],
  ['The Verge', 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml'],
  ['Ars Technica', 'https://arstechnica.com/ai/feed/'],
  ['VentureBeat', 'https://venturebeat.com/category/ai/feed/'],
  ['MIT Technology Review', 'https://www.technologyreview.com/topic/artificial-intelligence/feed'],
  ['WIRED', 'https://www.wired.com/feed/tag/ai/latest/rss'],
  ['The Decoder', 'https://the-decoder.com/feed/'],
  ['MarkTechPost', 'https://www.marktechpost.com/feed/'],
  ['ITmedia AI+', 'https://rss.itmedia.co.jp/rss/2.0/aiplus.xml'],
];

async function press(ctx) {
  const settled = await Promise.allSettled(
    PRESS_FEEDS.map(([pub, url]) => getText(url, { ...ctx, ua: BROWSER_UA }).then((xml) => ({ pub, xml }))),
  );
  const out = [];
  for (const r of settled) {
    if (r.status !== 'fulfilled') continue;
    const items = parseFeed(r.value.xml).slice(0, 25);
    items.forEach((i, idx) => {
      if (!i.title) return;
      out.push({
        text: i.title,
        desc: i.description.slice(0, 260),
        url: i.link,
        score: 0,
        rank: idx,
        n: items.length,
        ts: parseDate(i.date) || now() - 6 * H,
        ctx: r.value.pub,
        pub: r.value.pub,
        native: true, // どの媒体も AI 専門面
      });
    });
  }
  if (!out.length) throw new Error(settled.find((s) => s.status === 'rejected')?.reason?.message || 'empty');
  return out;
}

/* =====================================================================
 * 日本：はてブ IT ／ Zenn ／ Qiita
 * =================================================================== */
async function hatena(ctx) {
  const { ok } = await settleAll(
    ['https://b.hatena.ne.jp/hotentry/it.rss', 'https://b.hatena.ne.jp/entrylist/it.rss'].map((u) => getText(u, ctx)),
  );
  const out = [];
  const seen = new Set();
  for (const xml of ok) {
    for (const i of parseFeed(xml, ['hatena:bookmarkcount'])) {
      if (!i.title || seen.has(i.link)) continue;
      seen.add(i.link);
      out.push({
        text: i.title,
        desc: i.description.slice(0, 200),
        url: i.link,
        score: num(i.extra['hatena:bookmarkcount']),
        ts: parseDate(i.date) || now(),
        ctx: `${num(i.extra['hatena:bookmarkcount'])} users`,
        users: num(i.extra['hatena:bookmarkcount']),
      });
    }
  }
  return nonEmpty(out);
}

const ZENN_TOPICS = ['ai', 'llm', 'claudecode', 'mcp', 'chatgpt'];

async function zenn(ctx) {
  const { ok } = await settleAll(
    ZENN_TOPICS.map((t) => getJson(`https://zenn.dev/api/articles?topicname=${t}&order=daily`, ctx)),
  );
  const out = [];
  const seen = new Set();
  for (const data of ok) {
    for (const a of data?.articles ?? []) {
      if (!a?.path || seen.has(a.path)) continue;
      seen.add(a.path);
      out.push({
        text: a.title,
        url: `https://zenn.dev${a.path}`,
        score: num(a.liked_count) + num(a.bookmarked_count),
        ts: parseDate(a.published_at) || now(),
        ctx: `♥${num(a.liked_count)}${a.user?.username ? ` · @${a.user.username}` : ''}`,
        native: true,
      });
    }
  }
  return nonEmpty(out);
}

async function qiita(ctx) {
  const xml = await getText('https://qiita.com/popular-items/feed', { ...ctx, ua: BROWSER_UA });
  const items = parseFeed(xml);
  return nonEmpty(
    items.map((i, idx) => ({
      text: i.title,
      url: i.link,
      score: 0,
      rank: idx,
      n: items.length,
      ts: parseDate(i.date) || now(),
      ctx: 'Qiita トレンド',
    })),
  );
}

/* =====================================================================
 * 開発者コミュニティ：DEV / Lobsters / Mastodon / Bluesky
 * =================================================================== */
async function devto(ctx) {
  const { ok } = await settleAll(
    ['ai', 'llm', 'machinelearning', 'mcp'].map((t) => getJson(`https://dev.to/api/articles?tag=${t}&top=2&per_page=40`, ctx)),
  );
  const out = [];
  const seen = new Set();
  for (const list of ok) {
    for (const a of Array.isArray(list) ? list : []) {
      if (!a?.url || seen.has(a.url)) continue;
      seen.add(a.url);
      out.push({
        text: a.title,
        desc: (Array.isArray(a.tag_list) ? a.tag_list : String(a.tag_list || '').split(',')).join(' '),
        url: a.url,
        score: num(a.public_reactions_count) + num(a.comments_count) * 2,
        ts: parseDate(a.published_timestamp || a.published_at) || now(),
        ctx: `♥${num(a.public_reactions_count)}`,
        native: true,
      });
    }
  }
  return nonEmpty(out);
}

async function lobsters(ctx) {
  const { ok } = await settleAll(['ai', 'vibecoding'].map((t) => getJson(`https://lobste.rs/t/${t}.json`, ctx)));
  const out = [];
  const seen = new Set();
  for (const list of ok) {
    for (const s of Array.isArray(list) ? list : []) {
      if (!s?.short_id || seen.has(s.short_id)) continue;
      seen.add(s.short_id);
      out.push({
        text: s.title,
        url: s.short_id_url || s.comments_url || s.url,
        score: num(s.score) + num(s.comment_count),
        ts: parseDate(s.created_at) || now(),
        ctx: (s.tags ?? []).join(' '),
        native: true,
      });
    }
  }
  return nonEmpty(out);
}

const MASTO = [
  ['mastodon.social', 'ai'],
  ['mastodon.social', 'llm'],
  ['fosstodon.org', 'llm'],
  ['mstdn.jp', '生成AI'],
];

async function mastodon(ctx) {
  const { ok } = await settleAll(
    MASTO.map(([host, tag]) =>
      getJson(`https://${host}/api/v1/timelines/tag/${encodeURIComponent(tag)}?limit=40`, ctx).then((list) => ({ host, list })),
    ),
  );
  const out = [];
  const seen = new Set();
  for (const { host, list } of ok) {
    for (const p of Array.isArray(list) ? list : []) {
      if (!p?.id || p.sensitive || seen.has(p.url || p.uri)) continue;
      seen.add(p.url || p.uri);
      const text = stripHtml(p.content).slice(0, 280);
      if (text.length < 20) continue;
      out.push({
        text,
        url: p.url || p.uri,
        score: num(p.favourites_count) + num(p.reblogs_count) * 2 + num(p.replies_count),
        ts: parseDate(p.created_at) || now(),
        ctx: host,
        native: true,
      });
    }
  }
  return nonEmpty(out);
}

async function bluesky(ctx) {
  const data = await getJson('https://public.api.bsky.app/xrpc/app.bsky.unspecced.getTrends?limit=25', ctx);
  return nonEmpty(
    (data?.trends ?? [])
      .filter((t) => t.displayName || t.topic)
      .map((t, idx, arr) => ({
        text: t.displayName || t.topic,
        url: t.link ? `https://bsky.app${t.link}` : 'https://bsky.app',
        score: num(t.postCount),
        rank: idx,
        n: arr.length,
        ts: parseDate(t.startedAt) || now(),
        ctx: t.category || '',
      })),
  );
}

/* =====================================================================
 * プロダクト：Product Hunt（AI カテゴリ）
 * =================================================================== */
async function producthunt(ctx) {
  const xml = await firstOk(
    ['https://www.producthunt.com/feed?category=artificial-intelligence', 'https://www.producthunt.com/feed'],
    (u) => getText(u, { ...ctx, ua: BROWSER_UA }),
  );
  const items = parseFeed(xml).slice(0, 50);
  return nonEmpty(
    items.map((i, idx) => ({
      text: `${i.title}${i.description ? ` — ${i.description.slice(0, 140)}` : ''}`,
      url: i.link,
      score: 0,
      rank: idx,
      n: items.length,
      ts: parseDate(i.date) || now(),
      ctx: 'Product Hunt',
      art: { type: 'product', id: i.link, name: i.title },
    })),
  );
}

/* =====================================================================
 * 一般層の関心：Wikipedia 閲覧数（ja/en）・Google トレンド（4 地域）
 * =================================================================== */
async function wikipedia(ctx) {
  const out = [];
  for (const project of ['en.wikipedia', 'ja.wikipedia']) {
    const tries = [1, 2].map((d) => ymd(new Date(now() - d * 864e5)).join('/'));
    try {
      const data = await firstOk(
        tries.map((t) => `https://wikimedia.org/api/rest_v1/metrics/pageviews/top/${project}/all-access/${t}`),
        (u) => getJson(u, ctx),
      );
      const lang = project.slice(0, 2);
      const arts = data?.items?.[0]?.articles ?? [];
      for (const a of arts.slice(0, 1000)) {
        if (!a.article || /[:：]/.test(a.article) || a.article === 'Main_Page') continue;
        out.push({
          text: a.article.replace(/_/g, ' '),
          url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(a.article)}`,
          score: num(a.views),
          ts: now() - 18 * H,
          ctx: `${lang}wiki #${a.rank} · ${num(a.views).toLocaleString('en-US')} views`,
          views: num(a.views),
          strict: true, // 記事名そのものが AI 文脈であることを要求（一般記事の誤爆防止）
        });
      }
    } catch {
      /* 片方だけ落ちても続行 */
    }
  }
  return nonEmpty(out);
}

async function googletrends(ctx) {
  const geos = ['US', 'JP', 'GB', 'IN'];
  const { ok } = await settleAll(
    geos.map((g) => getText(`https://trends.google.com/trending/rss?geo=${g}`, { ...ctx, ua: BROWSER_UA }).then((x) => ({ g, x }))),
  );
  const out = [];
  for (const { g, x } of ok) {
    for (const i of parseFeed(x, ['ht:approx_traffic', 'ht:news_item_title'])) {
      if (!i.title) continue;
      out.push({
        text: i.title,
        desc: i.extra['ht:news_item_title'] || '',
        url: `https://trends.google.com/trends/explore?geo=${g}&q=${encodeURIComponent(i.title)}`,
        score: num(String(i.extra['ht:approx_traffic']).replace(/[^\d]/g, '')),
        ts: parseDate(i.date) || now(),
        ctx: `Google トレンド ${g}`,
      });
    }
  }
  return nonEmpty(out);
}

/* =====================================================================
 * 登録簿
 *   fam    : 系統（engine.js の FAMILY_WEIGHT と対応）
 *   weight : 系統内での媒体の重み
 *   half   : 新しさの半減期（時間）。速報系は短く、論文・リポジトリは長め
 * =================================================================== */
export const AI_SOURCES = [
  { id: 'hackernews', label: 'Hacker News', fam: 'community', weight: 1.0, half: 20, fetch: hackernews },
  { id: 'reddit', label: 'Reddit (AI 16 サブレ)', fam: 'community', weight: 1.0, half: 20, fetch: reddit },
  { id: 'lobsters', label: 'Lobsters', fam: 'community', weight: 0.55, half: 36, fetch: lobsters },
  { id: 'devto', label: 'DEV Community', fam: 'community', weight: 0.5, half: 48, fetch: devto },
  { id: 'mastodon', label: 'Mastodon', fam: 'community', weight: 0.45, half: 18, fetch: mastodon },
  { id: 'bluesky', label: 'Bluesky トレンド', fam: 'community', weight: 0.6, half: 12, fetch: bluesky },
  { id: 'github', label: 'GitHub 新興リポジトリ', fam: 'code', weight: 1.0, half: 96, fetch: github },
  { id: 'hfmodels', label: 'Hugging Face モデル', fam: 'models', weight: 1.0, half: 120, fetch: hfmodels },
  { id: 'hfspaces', label: 'Hugging Face Spaces', fam: 'models', weight: 0.65, half: 120, fetch: hfspaces },
  { id: 'hfpapers', label: 'HF Daily Papers', fam: 'research', weight: 1.0, half: 48, fetch: hfpapers },
  { id: 'newsen', label: 'Google News (英語圏 4 地域)', fam: 'news', weight: 0.9, half: 16, fetch: newsen },
  { id: 'press', label: 'テック媒体 9 誌', fam: 'news', weight: 1.0, half: 24, fetch: press },
  { id: 'newsja', label: 'Google News (日本)', fam: 'japan', weight: 0.8, half: 16, fetch: newsja },
  { id: 'hatena', label: 'はてブ テクノロジー', fam: 'japan', weight: 1.0, half: 24, fetch: hatena },
  { id: 'zenn', label: 'Zenn', fam: 'japan', weight: 0.8, half: 36, fetch: zenn },
  { id: 'qiita', label: 'Qiita', fam: 'japan', weight: 0.55, half: 36, fetch: qiita },
  { id: 'producthunt', label: 'Product Hunt', fam: 'products', weight: 1.0, half: 30, fetch: producthunt },
  { id: 'wikipedia', label: 'Wikipedia 閲覧数', fam: 'search', weight: 1.0, half: 48, fetch: wikipedia },
  { id: 'googletrends', label: 'Google トレンド (4 地域)', fam: 'search', weight: 0.8, half: 24, fetch: googletrends },
];

export const AI_SOURCE_MAP = Object.fromEntries(AI_SOURCES.map((s) => [s.id, s]));

/** 全媒体を並列取得。締切に間に合わなかった媒体は timeout として切り捨てる */
export async function collectAiSignals({ deadline, only }) {
  const targets = only ? AI_SOURCES.filter((s) => only.includes(s.id)) : AI_SOURCES;
  return Promise.all(
    targets.map(async (src) => {
      const started = Date.now();
      let timer;
      try {
        const watchdog = new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('deadline')), Math.max(0, deadline - Date.now()));
        });
        const signals = await Promise.race([src.fetch({ deadline, timeout: 8000 }), watchdog]);
        const clean = (signals || [])
          .filter((s) => s && s.text)
          .map((s) => ({ ...s, src: src.id, fam: src.fam, text: String(s.text).slice(0, 300) }));
        return { id: src.id, ok: clean.length > 0, count: clean.length, ms: Date.now() - started, signals: clean };
      } catch (err) {
        return { id: src.id, ok: false, count: 0, ms: Date.now() - started, error: String(err?.message || err).slice(0, 120), signals: [] };
      } finally {
        clearTimeout(timer);
      }
    }),
  );
}
