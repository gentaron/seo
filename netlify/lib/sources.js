/**
 * sources.js — 無料・キー不要のトレンド源アダプタ群
 *
 * 各アダプタは「シグナル」の配列を返す：
 *   { src, kind, text, url, score, ts, ctx?, terms?: [{t, w}] }
 *     kind  : 'topic'(媒体側が既に“話題”として切り出したもの) | 'tag' | 'post'(本文から語を掘る)
 *     score : 媒体内のエンゲージメント（いいね・票・閲覧など、媒体ごとにスケールは別）
 *     terms : 媒体が明示している語（ハッシュタグ・トピック名）。post は本文から mine.js が掘る
 *     vel   : 媒体自身が持つ勢いの手がかり（0〜1、任意）
 *
 * どれか一つが落ちても全体は止めない（pipeline 側で allSettled 相当に扱う）。
 */

import { parseFeed, parseDate } from './feedparse.js';
import { stripHtml } from './text.js';

const SITE = process.env.URL || 'https://undercurrent.netlify.app';
/** 公開 API の作法として、正直で連絡先の分かる UA を名乗る */
const BOT_UA = `UndercurrentBot/1.0 (+${SITE}; niche trend radar)`;
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';

/**
 * 取得ヘルパ：タイムアウトは呼び出し元の締切と個別上限の小さい方
 * @param {string} url
 * @param {{deadline:number, ua?:string, method?:string, body?:any, accept?:string, timeout?:number}} o
 */
async function get(url, o) {
  const left = o.deadline - Date.now();
  const timeout = Math.max(500, Math.min(o.timeout ?? 7000, left - 150));
  if (left < 600) throw new Error('budget exhausted');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      method: o.method || 'GET',
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': o.ua || BOT_UA,
        Accept: o.accept || 'application/json, application/xml;q=0.9, */*;q=0.5',
        'Accept-Language': 'ja,en;q=0.8',
        ...(o.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: o.body ? JSON.stringify(o.body) : undefined,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  } catch (err) {
    if (err?.name === 'AbortError') throw new Error(`timeout ${timeout}ms`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
const getJson = async (url, o) => (await get(url, o)).json();
const getText = async (url, o) => (await get(url, { accept: 'application/rss+xml, application/xml, text/xml, */*', ...o })).text();

/** 複数 URL を順に試し、最初に成功したものを返す */
async function firstOk(urls, fn) {
  let last;
  for (const u of urls) {
    try {
      return await fn(u);
    } catch (err) {
      last = err;
    }
  }
  throw last ?? new Error('no url');
}

const now = () => Date.now();
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/* =====================================================================
 * 1) Bluesky — 公開 AppView のトレンド（認証不要）
 * =================================================================== */
async function bluesky(ctx) {
  const base = 'https://public.api.bsky.app/xrpc';
  const out = [];
  const [trends, topics] = await Promise.allSettled([
    getJson(`${base}/app.bsky.unspecced.getTrends?limit=25`, ctx),
    getJson(`${base}/app.bsky.unspecced.getTrendingTopics?limit=25`, ctx),
  ]);
  if (trends.status === 'fulfilled') {
    for (const t of trends.value?.trends ?? []) {
      const name = t.displayName || t.topic;
      if (!name) continue;
      const started = parseDate(t.startedAt);
      const ageH = started ? (now() - started) / 3.6e6 : 12;
      out.push({
        kind: 'topic',
        text: name,
        url: t.link ? `https://bsky.app${t.link}` : `https://bsky.app/search?q=${encodeURIComponent(name)}`,
        score: num(t.postCount),
        ts: started || now(),
        ctx: t.category || t.status || '',
        terms: [{ t: name, w: 1 }],
        vel: t.status === 'hot' ? 1 : Math.max(0, 1 - ageH / 24),
      });
    }
  }
  if (topics.status === 'fulfilled') {
    for (const t of [...(topics.value?.topics ?? []), ...(topics.value?.suggested ?? []).slice(0, 8)]) {
      const name = t.displayName || t.topic;
      if (!name || out.some((o) => o.text === name)) continue;
      out.push({
        kind: 'topic',
        text: name,
        url: t.link ? `https://bsky.app${t.link}` : `https://bsky.app/search?q=${encodeURIComponent(name)}`,
        score: 0,
        ts: now(),
        ctx: t.description || '',
        terms: [{ t: name, w: 0.8 }],
      });
    }
  }
  if (!out.length) throw new Error(trends.reason?.message || topics.reason?.message || 'empty');
  return out;
}

/* =====================================================================
 * 2) Mastodon — 複数インスタンスのトレンドタグ（7 日分の利用履歴つき）
 * =================================================================== */
const MASTODON_INSTANCES = ['mastodon.social', 'mstdn.jp', 'fosstodon.org', 'mas.to'];

async function mastodon(ctx) {
  const settled = await Promise.allSettled(
    MASTODON_INSTANCES.map((host) => getJson(`https://${host}/api/v1/trends/tags?limit=20`, ctx).then((list) => ({ host, list }))),
  );
  const out = [];
  for (const r of settled) {
    if (r.status !== 'fulfilled' || !Array.isArray(r.value.list)) continue;
    const { host, list } = r.value;
    for (const tag of list) {
      const hist = (tag.history ?? []).map((h) => num(h.uses));
      const today = hist[0] ?? 0;
      const prev = hist.slice(1);
      const avg = prev.length ? prev.reduce((a, b) => a + b, 0) / prev.length : 0;
      out.push({
        kind: 'tag',
        text: `#${tag.name}`,
        url: tag.url || `https://${host}/tags/${encodeURIComponent(tag.name)}`,
        score: today,
        ts: now(),
        ctx: host,
        terms: [{ t: tag.name, w: 1 }],
        vel: Math.max(0, Math.min(1, (today - avg) / (avg + 5))),
      });
    }
  }
  if (!out.length) throw new Error(settled.find((s) => s.status === 'rejected')?.reason?.message || 'empty');
  return out;
}

/* =====================================================================
 * 3) Misskey.io — 日本語圏最大級の連合 SNS。ハッシュタグの直近チャート
 * =================================================================== */
async function misskey(ctx) {
  const list = await getJson('https://misskey.io/api/hashtags/trend', { ...ctx, method: 'POST', body: {} });
  if (!Array.isArray(list) || !list.length) throw new Error('empty');
  return list.map((t) => {
    const chart = (t.chart ?? []).map(num);
    const recent = chart.slice(-3).reduce((a, b) => a + b, 0);
    const earlier = chart.slice(0, -3).reduce((a, b) => a + b, 0) / Math.max(1, chart.length - 3);
    return {
      kind: 'tag',
      text: `#${t.tag}`,
      url: `https://misskey.io/tags/${encodeURIComponent(t.tag)}`,
      score: num(t.usersCount),
      ts: now(),
      ctx: 'misskey.io',
      terms: [{ t: t.tag, w: 1 }],
      vel: Math.max(0, Math.min(1, (recent / 3 - earlier) / (earlier + 2))),
    };
  });
}

/* =====================================================================
 * 4) Reddit — ネットスラングが生まれやすいサブレの “rising”
 * =================================================================== */
export const REDDIT_SUBS = [
  'OutOfTheLoop', 'GenZ', 'TikTokCringe', 'BrandNewSentence', 'copypasta', 'teenagers',
  'LivestreamFail', 'internetculture', 'NoStupidQuestions', 'memes', 'whennews', 'okbuddycinephile',
  'ExplainTheJoke', 'OnlineCulture', 'youngpeopleyoutube', 'starterpacks',
];

/** 事件・珍ニュース・芸能ゴシップ系のサブレ */
export const REDDIT_NEWS_SUBS = [
  'nottheonion', 'offbeat', 'FloridaMan', 'Fauxmoi', 'popculturechat', 'byebyejob', 'news', 'worldnews',
  'UpliftingNews', 'CrazyFuckingVideos', 'PublicFreakout', 'mildlyinfuriating', 'interestingasfuck', 'facepalm',
];

const reddit = (ctx) => redditFor(REDDIT_SUBS, 'rising', ctx);
const redditNews = (ctx) => redditFor(REDDIT_NEWS_SUBS, 'hot', ctx);

async function redditFor(subs, sort, ctx) {
  const multi = subs.join('+');
  return firstOk(
    [
      `https://www.reddit.com/r/${multi}/${sort}.json?limit=100&raw_json=1`,
      `https://old.reddit.com/r/${multi}/${sort}.json?limit=100&raw_json=1`,
      `https://www.reddit.com/r/${multi}/${sort}/.rss?limit=100`,
    ],
    async (url) => {
      if (url.includes('.rss')) {
        const items = parseFeed(await getText(url, { ...ctx, ua: BROWSER_UA }));
        if (!items.length) throw new Error('empty rss');
        return items.map((i) => ({
          kind: 'post',
          text: i.title,
          url: i.link,
          score: 0,
          ts: parseDate(i.date) || now(),
          ctx: (i.link.match(/\/r\/([^/]+)/) || [])[1] || '',
        }));
      }
      const data = await getJson(url, ctx);
      const children = data?.data?.children ?? [];
      if (!children.length) throw new Error('empty');
      return children
        .map((c) => c.data)
        .filter((d) => d && !d.over_18 && !d.stickied)
        .map((d) => ({
          kind: 'post',
          text: d.title,
          url: `https://www.reddit.com${d.permalink}`,
          score: num(d.score) + num(d.num_comments) * 2,
          ts: num(d.created_utc) * 1000 || now(),
          ctx: `r/${d.subreddit}`,
        }));
    },
  );
}

/* =====================================================================
 * 5) Hacker News（Algolia API）— 技術系ニッチ
 * =================================================================== */
async function hackernews(ctx) {
  const since = Math.floor((now() - 36 * 3.6e6) / 1000);
  const [front, show] = await Promise.allSettled([
    getJson('https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=60', ctx),
    getJson(`https://hn.algolia.com/api/v1/search_by_date?tags=(story,show_hn)&numericFilters=points>15,created_at_i>${since}&hitsPerPage=60`, ctx),
  ]);
  const seen = new Set();
  const out = [];
  for (const r of [front, show]) {
    if (r.status !== 'fulfilled') continue;
    for (const h of r.value?.hits ?? []) {
      if (!h.title || seen.has(h.objectID)) continue;
      seen.add(h.objectID);
      out.push({
        kind: 'post',
        text: h.title.replace(/^(Show|Ask|Tell|Launch) HN:\s*/i, ''),
        url: `https://news.ycombinator.com/item?id=${h.objectID}`,
        score: num(h.points) + num(h.num_comments),
        ts: num(h.created_at_i) * 1000 || now(),
        ctx: 'HN',
      });
    }
  }
  if (!out.length) throw new Error(front.reason?.message || 'empty');
  return out;
}

/* =====================================================================
 * 6) Lobsters — 濃いめの技術コミュニティ
 * =================================================================== */
async function lobsters(ctx) {
  const list = await getJson('https://lobste.rs/hottest.json', ctx);
  if (!Array.isArray(list)) throw new Error('bad shape');
  return list.map((s) => ({
    kind: 'post',
    text: s.title,
    url: s.short_id_url || s.comments_url || s.url,
    score: num(s.score) + num(s.comment_count),
    ts: parseDate(s.created_at) || now(),
    ctx: (s.tags ?? []).join(' '),
  }));
}

/* =====================================================================
 * 7) Google トレンド（RSS）— 主流側の物差し。ニッチ判定の “減点” にも使う
 * =================================================================== */
const GEO_LANG = { JP: 'ja', US: 'en', GB: 'en', IN: 'en', CA: 'en', AU: 'en', PH: 'en', KR: 'ko', TW: 'zh', BR: 'pt', DE: 'de', FR: 'fr', MX: 'es', ID: 'id' };

async function googletrends(ctx) {
  // 世界の主要地域。言語ヒントは語の言語判定（漢字だけの中国語を日本語と誤判定しない等）に使う
  const geos = ['JP', 'US', 'GB', 'IN', 'CA', 'AU', 'PH', 'KR', 'TW', 'BR', 'DE', 'FR', 'MX', 'ID'];
  const settled = await Promise.allSettled(
    geos.map((g) => getText(`https://trends.google.com/trending/rss?geo=${g}`, { ...ctx, ua: BROWSER_UA }).then((x) => ({ g, x }))),
  );
  const out = [];
  for (const r of settled) {
    if (r.status !== 'fulfilled') continue;
    for (const i of parseFeed(r.value.x, ['ht:approx_traffic', 'ht:news_item_title', 'ht:news_item_url'])) {
      if (!i.title) continue;
      const traffic = num(String(i.extra['ht:approx_traffic']).replace(/[^\d]/g, ''));
      out.push({
        kind: 'topic',
        text: i.title,
        url: i.extra['ht:news_item_url'] || `https://trends.google.com/trends/explore?geo=${r.value.g}&q=${encodeURIComponent(i.title)}`,
        score: traffic,
        ts: parseDate(i.date) || now(),
        ctx: `${r.value.g}${i.extra['ht:news_item_title'] ? ` · ${i.extra['ht:news_item_title']}` : ''}`,
        terms: [{ t: i.title, w: 1 }],
        lang: GEO_LANG[r.value.g],
        mainstream: traffic >= 20000,
      });
    }
  }
  if (!out.length) throw new Error(settled.find((s) => s.status === 'rejected')?.reason?.message || 'empty');
  return out;
}

/* =====================================================================
 * 8) Wikipedia 閲覧数トップ（ja / en）— 何が “調べられて” いるか
 * =================================================================== */
const WIKI_SKIP = /^(Main_Page|Special:|特別:|メインページ|Wikipedia:|Portal:|Help:|File:|Template:|Category:|-$)/i;

async function wikipedia(ctx) {
  const projects = ['ja.wikipedia', 'en.wikipedia'];
  const ymd = (d) => [d.getUTCFullYear(), String(d.getUTCMonth() + 1).padStart(2, '0'), String(d.getUTCDate()).padStart(2, '0')].join('/');
  const out = [];
  for (const project of projects) {
    // 前日分は UTC 午前中は未集計のことがあるので 1→2 日前の順に試す
    const tries = [1, 2].map((d) => ymd(new Date(now() - d * 864e5)));
    try {
      const data = await firstOk(
        tries.map((t) => `https://wikimedia.org/api/rest_v1/metrics/pageviews/top/${project}/all-access/${t}`),
        (u) => getJson(u, ctx),
      );
      const arts = data?.items?.[0]?.articles ?? [];
      const lang = project.slice(0, 2);
      for (const a of arts.slice(0, 90)) {
        if (!a.article || WIKI_SKIP.test(a.article)) continue;
        const title = a.article.replace(/_/g, ' ');
        out.push({
          kind: 'topic',
          text: title,
          url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(a.article)}`,
          score: num(a.views),
          ts: now() - 12 * 3.6e6,
          ctx: `${lang}wiki #${a.rank}`,
          terms: [{ t: title, w: 0.7 }],
          mainstream: a.rank <= 15,
        });
      }
    } catch {
      /* 片方だけ落ちても続行 */
    }
  }
  if (!out.length) throw new Error('empty');
  return out;
}

/* =====================================================================
 * 9) Urban Dictionary — 英語スラングの一次ソース
 * =================================================================== */
async function urbandictionary(ctx) {
  const data = await getJson('https://api.urbandictionary.com/v0/words_of_the_day', ctx);
  const list = data?.list ?? [];
  if (!list.length) throw new Error('empty');
  return list.slice(0, 20).map((d) => ({
    kind: 'topic',
    text: d.word,
    url: d.permalink || `https://www.urbandictionary.com/define.php?term=${encodeURIComponent(d.word)}`,
    score: num(d.thumbs_up),
    ts: parseDate(d.date || d.written_on) || now(),
    ctx: stripHtml(String(d.definition || '').replace(/[[\]]/g, '')).slice(0, 160),
    terms: [{ t: d.word, w: 1 }],
    slang: true,
  }));
}

/* =====================================================================
 * 10) Know Your Meme — ミームの台帳（RSS）
 * =================================================================== */
async function knowyourmeme(ctx) {
  const xml = await firstOk(
    ['https://knowyourmeme.com/newsfeed.rss', 'https://knowyourmeme.com/memes.rss', 'https://knowyourmeme.com/memes/submissions.rss'],
    (u) => getText(u, { ...ctx, ua: BROWSER_UA }),
  );
  const items = parseFeed(xml);
  if (!items.length) throw new Error('empty');
  return items.slice(0, 40).map((i) => {
    const isEntry = /\/memes\//.test(i.link) && !/\/photos|\/videos|\/news/.test(i.link);
    return {
      kind: isEntry ? 'topic' : 'post',
      text: i.title,
      url: i.link,
      score: 0,
      ts: parseDate(i.date) || now(),
      ctx: i.description.slice(0, 160),
      terms: isEntry ? [{ t: i.title, w: 1 }] : undefined,
      slang: true,
    };
  });
}

/* =====================================================================
 * 11) はてなブックマーク — 人気＋新着（日本語圏の “いま読まれてる” ）
 * =================================================================== */
async function hatena(ctx) {
  const feeds = [
    'https://b.hatena.ne.jp/hotentry/all.rss',
    'https://b.hatena.ne.jp/entrylist/all.rss',
    'https://b.hatena.ne.jp/hotentry/social.rss', // 世の中（事件・炎上）
    'https://b.hatena.ne.jp/hotentry/entertainment.rss',
    'https://b.hatena.ne.jp/hotentry/fun.rss', // おもしろ（どうでもいい系）
    'https://b.hatena.ne.jp/hotentry/game.rss',
  ];
  const settled = await Promise.allSettled(feeds.map((u) => getText(u, ctx)));
  const out = [];
  const seen = new Set();
  for (const r of settled) {
    if (r.status !== 'fulfilled') continue;
    for (const i of parseFeed(r.value, ['hatena:bookmarkcount'])) {
      if (!i.title || seen.has(i.link)) continue;
      seen.add(i.link);
      out.push({
        kind: 'post',
        text: i.title,
        url: i.link,
        score: num(i.extra['hatena:bookmarkcount']),
        ts: parseDate(i.date) || now(),
        ctx: 'はてブ',
      });
    }
  }
  if (!out.length) throw new Error(settled.find((s) => s.status === 'rejected')?.reason?.message || 'empty');
  return out;
}

/* =====================================================================
 * 12) ニコニコ動画 毎時ランキング — 日本のネット文化の震源
 * =================================================================== */
async function niconico(ctx) {
  const xml = await getText('https://www.nicovideo.jp/ranking/genre/all?term=hour&rss=2.0&lang=ja-jp', { ...ctx, ua: BROWSER_UA });
  const items = parseFeed(xml);
  if (!items.length) throw new Error('empty');
  return items.map((i, idx) => ({
    kind: 'post',
    text: i.title.replace(/^第\d+位[：:]\s*/, ''),
    url: i.link,
    score: Math.max(1, 100 - idx),
    ts: parseDate(i.date) || now(),
    ctx: 'ニコ動 毎時',
  }));
}

/* =====================================================================
 * 13) GitHub — 直近 48 時間に生まれて星を集めているリポジトリ
 * =================================================================== */
async function github(ctx) {
  const since = new Date(now() - 2 * 864e5).toISOString().slice(0, 10);
  const data = await getJson(
    `https://api.github.com/search/repositories?q=created:%3E${since}&sort=stars&order=desc&per_page=40`,
    { ...ctx, accept: 'application/vnd.github+json' },
  );
  const items = data?.items ?? [];
  if (!items.length) throw new Error('empty');
  return items.map((r) => ({
    kind: 'topic',
    text: `${r.name}${r.description ? ` — ${r.description}` : ''}`.slice(0, 200),
    url: r.html_url,
    score: num(r.stargazers_count),
    ts: parseDate(r.created_at) || now(),
    ctx: r.full_name,
    terms: [{ t: r.name, w: 0.6 }, ...(r.topics ?? []).slice(0, 4).map((t) => ({ t, w: 0.35 }))],
  }));
}

/* =====================================================================
 * 14) Lemmy — 連合型 Reddit 代替の “Active”
 * =================================================================== */
async function lemmy(ctx) {
  const data = await getJson('https://lemmy.world/api/v3/post/list?sort=Active&type_=All&limit=50', ctx);
  const posts = data?.posts ?? [];
  if (!posts.length) throw new Error('empty');
  return posts
    .filter((p) => !p.post?.nsfw)
    .map((p) => ({
      kind: 'post',
      text: p.post?.name ?? '',
      url: p.post?.ap_id || p.post?.url || '',
      score: num(p.counts?.score) + num(p.counts?.comments) * 2,
      ts: parseDate(p.post?.published) || now(),
      ctx: p.community?.name ? `!${p.community.name}` : '',
    }));
}


/* =====================================================================
 * 汎用 RSS アダプタ — ニュース／ゴシップ／まとめ／珍ニュース
 *   feeds: [{ u: URL, c: 表示用の出どころ, lang?: 言語ヒント, strip?: 末尾の「 - 媒体名」を落とす }]
 *   1 本でも読めれば成功。全部落ちたときだけ失敗扱い。
 * =================================================================== */
function rssSource(feeds, { perFeed = 40, ua = BROWSER_UA } = {}) {
  return async function fetchRss(ctx) {
    const settled = await Promise.allSettled(feeds.map((f) => firstOk([].concat(f.u), (u) => getText(u, { ...ctx, ua })).then((x) => ({ f, x }))));
    const out = [];
    const seen = new Set();
    for (const r of settled) {
      if (r.status !== 'fulfilled') continue;
      const { f, x } = r.value;
      const items = parseFeed(x, ['hatena:bookmarkcount', 'slash:comments']);
      items.slice(0, perFeed).forEach((i, idx) => {
        let title = i.title;
        if (f.strip) title = title.replace(/\s+[-–—|｜]\s+[^-–—|｜]{1,40}$/, ''); // Google ニュースの「 - 媒体名」
        title = title.replace(/^【[^】]{0,8}速報[^】]{0,8}】\s*/, '').trim();
        if (!title || seen.has(title)) return;
        seen.add(title);
        out.push({
          kind: 'post',
          text: title,
          url: i.link,
          // RSS には反応数が無いことが多いので、並び順（上ほど注目）を代わりに使う
          score: Number(i.extra['hatena:bookmarkcount'] || i.extra['slash:comments'] || 0) || Math.max(1, perFeed - idx),
          ts: parseDate(i.date) || now(),
          ctx: f.c,
          lang: f.lang,
        });
      });
    }
    if (!out.length) throw new Error(settled.find((s) => s.status === 'rejected')?.reason?.message || 'empty');
    return out;
  };
}

const gnews = (q, hl, gl, ceid) =>
  q
    ? `https://news.google.com/rss/search?q=${encodeURIComponent(`${q} when:1d`)}&hl=${hl}&gl=${gl}&ceid=${ceid}`
    : `https://news.google.com/rss?hl=${hl}&gl=${gl}&ceid=${ceid}`;
const JA = ['ja', 'JP', 'JP:ja'];
const EN_US = ['en-US', 'US', 'US:en'];

/** Google ニュース：総合＋「炎上・事件・不祥事」「珍ニュース」の検索フィードを各国で */
const googlenews = rssSource([
  { u: gnews('', ...JA), c: 'Googleニュース 日本', lang: 'ja', strip: true },
  { u: gnews('炎上 OR 謝罪 OR 不祥事 OR 物議 OR 騒動', ...JA), c: 'Googleニュース 炎上', lang: 'ja', strip: true },
  { u: gnews('逮捕 OR 容疑者 OR 書類送検 OR 事件', ...JA), c: 'Googleニュース 事件', lang: 'ja', strip: true },
  { u: gnews('珍事 OR まさかの OR 話題に OR SNSで話題', ...JA), c: 'Googleニュース 話題', lang: 'ja', strip: true },
  { u: gnews('', ...EN_US), c: 'Google News US', lang: 'en', strip: true },
  { u: gnews('scandal OR backlash OR controversy OR apologizes', ...EN_US), c: 'Google News scandal', lang: 'en', strip: true },
  { u: gnews('arrested OR charged OR lawsuit OR "goes viral"', ...EN_US), c: 'Google News incidents', lang: 'en', strip: true },
  { u: gnews('', 'en-GB', 'GB', 'GB:en'), c: 'Google News UK', lang: 'en', strip: true },
  { u: gnews('', 'en-IN', 'IN', 'IN:en'), c: 'Google News India', lang: 'en', strip: true },
  { u: gnews('', 'en-AU', 'AU', 'AU:en'), c: 'Google News Australia', lang: 'en', strip: true },
], { perFeed: 30 });

/** Yahoo!ニュース トピックス（日本で一番読まれているニュースの見出し） */
const yahoonews = rssSource(
  ['top-picks', 'domestic', 'world', 'business', 'entertainment', 'sports', 'it', 'science', 'local'].map((c) => ({
    u: `https://news.yahoo.co.jp/rss/topics/${c}.xml`,
    c: `Yahoo!ニュース ${c}`,
    lang: 'ja',
  })),
  { perFeed: 12 },
);

/** NHK（主要・社会＝事件事故・文化エンタメ） */
const nhk = rssSource([
  { u: 'https://www.nhk.or.jp/rss/news/cat0.xml', c: 'NHK 主要', lang: 'ja' },
  { u: 'https://www.nhk.or.jp/rss/news/cat1.xml', c: 'NHK 社会', lang: 'ja' },
  { u: 'https://www.nhk.or.jp/rss/news/cat2.xml', c: 'NHK 文化', lang: 'ja' },
]);

/** ネット発ニュース（炎上・バズの記事化が速い） */
const netnews = rssSource([
  { u: 'https://rss.itmedia.co.jp/rss/2.0/netlab.xml', c: 'ねとらぼ', lang: 'ja' },
  { u: 'https://gigazine.net/news/rss_2.0/', c: 'GIGAZINE', lang: 'ja' },
  { u: ['https://togetter.com/rss/index', 'https://togetter.com/rss/hot'], c: 'Togetter', lang: 'ja' },
  { u: 'https://news.livedoor.com/topics/rss/top.xml', c: 'ライブドア', lang: 'ja' },
  { u: 'https://news.livedoor.com/topics/rss/ent.xml', c: 'ライブドア 芸能', lang: 'ja' },
  { u: 'https://jbpress.ismedia.jp/list/feed/rss', c: 'JBpress', lang: 'ja' },
]);

/** 掲示板まとめ（5ch 由来の “どうでもいい” 話題と事件ネタの宝庫） */
const matome = rssSource([
  { u: 'http://blog.livedoor.jp/dqnplus/index.rdf', c: '痛いニュース', lang: 'ja' },
  { u: 'http://hamusoku.com/index.rdf', c: 'ハムスター速報', lang: 'ja' },
  { u: 'https://jin115.com/index.rdf', c: 'オレ的ゲーム速報', lang: 'ja' },
  { u: 'http://news4vip.livedoor.biz/index.rdf', c: 'ニュー速クオリティ', lang: 'ja' },
  { u: 'http://blog.esuteru.com/index.rdf', c: 'はちま起稿', lang: 'ja' },
  { u: 'https://girlschannel.net/topics/rss/', c: 'ガールズちゃんねる', lang: 'ja' },
  { u: 'http://himasoku.com/index.rdf', c: 'ひまわり速報', lang: 'ja' },
], { perFeed: 30 });

/** 芸能・ゴシップ・スクープ */
const gossip = rssSource([
  { u: 'https://bunshun.jp/list/feed/rss', c: '文春オンライン', lang: 'ja' },
  { u: ['https://www.dailyshincho.jp/feed/', 'https://www.dailyshincho.jp/rss/'], c: 'デイリー新潮', lang: 'ja' },
  { u: 'https://www.jprime.jp/list/feed/rss', c: '週刊女性PRIME', lang: 'ja' },
  { u: 'https://www.tmz.com/rss.xml', c: 'TMZ', lang: 'en' },
  { u: 'https://pagesix.com/feed/', c: 'Page Six', lang: 'en' },
  { u: 'https://www.dailymail.co.uk/tvshowbiz/index.rss', c: 'Daily Mail Showbiz', lang: 'en' },
]);

/** 世界の珍ニュース・どうでもいいニュース */
const oddnews = rssSource([
  { u: 'https://rss.upi.com/news/odd_news.rss', c: 'UPI Odd News', lang: 'en' },
  { u: 'https://www.fark.com/fark.rss', c: 'Fark', lang: 'en' },
  { u: 'https://boingboing.net/feed', c: 'Boing Boing', lang: 'en' },
  { u: 'https://www.dailymail.co.uk/news/weird_news/index.rss', c: 'Daily Mail Weird', lang: 'en' },
  { u: 'https://www.huffpost.com/section/weird-news/feed', c: 'HuffPost Weird', lang: 'en' },
]);

/** 世界のニュース（英語圏の主要紙・通信） */
const worldnews = rssSource([
  { u: 'https://feeds.bbci.co.uk/news/rss.xml', c: 'BBC', lang: 'en' },
  { u: 'https://www.theguardian.com/world/rss', c: 'Guardian', lang: 'en' },
  { u: 'https://feeds.npr.org/1001/rss.xml', c: 'NPR', lang: 'en' },
  { u: 'https://www.aljazeera.com/xml/rss/all.xml', c: 'Al Jazeera', lang: 'en' },
  { u: 'https://www.france24.com/en/rss', c: 'France 24', lang: 'en' },
  { u: 'https://www3.nhk.or.jp/nhkworld/en/news/feeds/', c: 'NHK World', lang: 'en' },
]);

/** 新しいプロダクト（ガジェット・アプリ・AI ツールの流行り） */
const producthunt = rssSource([{ u: 'https://www.producthunt.com/feed', c: 'Product Hunt', lang: 'en' }]);

/* =====================================================================
 * 登録簿
 *   weight: 語のスコアに効く媒体の重み（ニッチ寄り・スラング寄りほど高い）
 *   lang  : 主な言語（UI のフィルタ既定値。語ごとの判定は別途行う）
 * =================================================================== */
export const SOURCES = [
  { id: 'bluesky', label: 'Bluesky', icon: '🦋', lang: 'en', genre: 'sns', weight: 1.0, fetch: bluesky },
  { id: 'mastodon', label: 'Mastodon', icon: '🐘', lang: 'mix', genre: 'sns', weight: 0.85, fetch: mastodon },
  { id: 'misskey', label: 'Misskey', icon: '🥑', lang: 'ja', genre: 'sns', weight: 1.0, fetch: misskey },
  { id: 'reddit', label: 'Reddit', icon: '👽', lang: 'en', genre: 'community', weight: 1.0, fetch: reddit },
  { id: 'urbandictionary', label: 'Urban Dictionary', icon: '📕', lang: 'en', genre: 'slang', weight: 1.2, fetch: urbandictionary },
  { id: 'knowyourmeme', label: 'Know Your Meme', icon: '🧌', lang: 'en', genre: 'slang', weight: 1.2, fetch: knowyourmeme },
  { id: 'niconico', label: 'ニコニコ', icon: '📺', lang: 'ja', genre: 'video', weight: 0.9, fetch: niconico },
  { id: 'hatena', label: 'はてブ', icon: '🔖', lang: 'ja', genre: 'community', weight: 0.8, fetch: hatena },
  { id: 'hackernews', label: 'Hacker News', icon: '🟧', lang: 'en', genre: 'tech', weight: 0.7, fetch: hackernews },
  { id: 'lobsters', label: 'Lobsters', icon: '🦞', lang: 'en', genre: 'tech', weight: 0.6, fetch: lobsters },
  { id: 'github', label: 'GitHub', icon: '🐙', lang: 'en', genre: 'tech', weight: 0.55, fetch: github },
  { id: 'lemmy', label: 'Lemmy', icon: '🐭', lang: 'en', genre: 'community', weight: 0.7, fetch: lemmy },
  { id: 'redditnews', label: 'Reddit 事件・珍ニュース', icon: '🗞', lang: 'en', genre: 'oddity', weight: 0.85, fetch: redditNews },
  { id: 'matome', label: '掲示板まとめ', icon: '🗯', lang: 'ja', genre: 'board', weight: 0.9, fetch: matome },
  { id: 'netnews', label: 'ネット発ニュース', icon: '🌐', lang: 'ja', genre: 'netnews', weight: 0.85, fetch: netnews },
  { id: 'gossip', label: '芸能・ゴシップ', icon: '📸', lang: 'mix', genre: 'gossip', weight: 0.8, fetch: gossip },
  { id: 'oddnews', label: '世界の珍ニュース', icon: '🦩', lang: 'en', genre: 'oddity', weight: 0.9, fetch: oddnews },
  { id: 'googlenews', label: 'Google ニュース', icon: '📰', lang: 'mix', genre: 'news', weight: 0.6, fetch: googlenews },
  { id: 'yahoonews', label: 'Yahoo!ニュース', icon: '🟥', lang: 'ja', genre: 'news', weight: 0.6, fetch: yahoonews },
  { id: 'nhk', label: 'NHK', icon: '📡', lang: 'ja', genre: 'news', weight: 0.45, fetch: nhk },
  { id: 'worldnews', label: '海外ニュース', icon: '🌍', lang: 'en', genre: 'news', weight: 0.45, fetch: worldnews },
  { id: 'producthunt', label: 'Product Hunt', icon: '🐱', lang: 'en', genre: 'tech', weight: 0.5, fetch: producthunt },
  { id: 'googletrends', label: 'Google Trends', icon: '📈', lang: 'mix', genre: 'mainstream', weight: 0.45, fetch: googletrends },
  { id: 'wikipedia', label: 'Wikipedia', icon: '📚', lang: 'mix', genre: 'mainstream', weight: 0.35, fetch: wikipedia },
];

export const SOURCE_MAP = Object.fromEntries(SOURCES.map((s) => [s.id, s]));

/** 公開用メタ（関数本体を除く） */
export function sourceMeta() {
  return SOURCES.map(({ id, label, icon, lang, genre, weight }) => ({ id, label, icon, lang, genre, weight }));
}
