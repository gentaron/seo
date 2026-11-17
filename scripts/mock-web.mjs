/**
 * mock-web.mjs — 外部媒体の疑似レスポンス（オフライン開発・テスト用）
 *
 * globalThis.__MOCK_NOW__ の時刻に応じて語の “流行り廃り” が変わるので、
 * 何回か観測を回すと 誕生 → 急騰 → 拡散 → 失速 の流れが UI で確認できる。
 */

const H = 3.6e6;

/** 語ごとの流行曲線：peak 時刻（基準からの時間）と幅 */
const WAVES = [
  // 英語圏スラング／ミーム
  { t: 'aura farming', peak: -2, w: 10, en: true },
  { t: 'clanker', peak: -14, w: 14, en: true },
  { t: 'six seven', peak: -30, w: 20, en: true },
  { t: 'crash out', peak: -8, w: 18, en: true },
  { t: 'unc status', peak: 0, w: 6, en: true },
  { t: 'chopped', peak: -20, w: 12, en: true },
  { t: 'brainrot core', peak: 1, w: 5, en: true },
  { t: 'Labubu', peak: -40, w: 40, en: true },
  { t: 'tung tung sahur', peak: -4, w: 8, en: true },
  { t: 'looksmaxxing', peak: -60, w: 50, en: true },
  { t: 'vibe coding', peak: -10, w: 30, en: true },
  { t: 'goblin mode', peak: -100, w: 30, en: true },
  // 日本語圏
  { t: 'チー牛構文', peak: -3, w: 9 },
  { t: '蛙化現象', peak: -50, w: 40 },
  { t: 'ぱおん', peak: -6, w: 10 },
  { t: '界隈曲', peak: 0, w: 7 },
  { t: 'メロい', peak: -2, w: 12 },
  { t: 'ちいかわ構文', peak: -18, w: 16 },
  { t: 'AI絵師', peak: -36, w: 30 },
  { t: 'ラブブ沼', peak: -12, w: 14 },
  { t: '生成AI切り抜き', peak: 2, w: 6 },
  { t: 'ヤバみ', peak: -80, w: 60 },
  // 炎上・事件・どうでもいいニュース
  { t: '回転寿司テロ', peak: -1, w: 6, news: true },
  { t: '謝罪会見', peak: -5, w: 8, news: true },
  { t: '巨大カボチャ', peak: 0, w: 5, news: true, odd: true },
  { t: 'kiss cam', peak: -3, w: 7, en: true, news: true },
  { t: 'Florida Man', peak: -9, w: 12, en: true, news: true, odd: true },
  { t: 'emotional support alligator', peak: 0, w: 5, en: true, news: true, odd: true },
];

const JA_NEWS = [
  (t) => `${t}で騒動、運営が謝罪「再発防止に努める」`,
  (t) => `【炎上】${t}がSNSで物議　批判殺到`,
  (t) => `${t}巡り20代の男を逮捕　警視庁`,
  (t) => `まさかの${t}、ネットで話題に`,
];
const EN_NEWS = [
  (t) => `${t} sparks backlash online`,
  (t) => `Man arrested after ${t} incident at stadium`,
  (t) => `${t} goes viral for all the wrong reasons`,
  (t) => `Why everyone is talking about ${t}`,
];
const NEWS_HOSTS = /news\.google|yahoo\.co\.jp|nhk\.or\.jp|itmedia|gigazine|togetter|livedoor|jbpress|hamusoku|jin115|esuteru|girlschannel|himasoku|bunshun|dailyshincho|jprime|tmz\.com|pagesix|dailymail|upi\.com|fark\.com|boingboing|huffpost|bbci|theguardian|npr\.org|aljazeera|france24|nhkworld|producthunt/;

/** 主流（どこでも話題になっているが “ニッチ” ではない） */
const MAINSTREAM = ['World Series', 'Election', '大谷翔平', '紅白歌合戦', 'iPhone 18', 'Taylor Swift'];

function heatAt(wave, now, base) {
  const dtH = (now - base) / H - wave.peak;
  return Math.exp(-(dtH * dtH) / (2 * wave.w * wave.w));
}

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function live(now, base, filter) {
  return WAVES.filter(filter)
    .map((w) => ({ ...w, h: heatAt(w, now, base) }))
    .filter((w) => w.h > 0.08)
    .sort((a, b) => b.h - a.h);
}

const EN_TEMPLATES = [
  (t) => `What does "${t}" even mean? Everyone in my class keeps saying it`,
  (t) => `Can someone explain the ${t} trend to an old person`,
  (t) => `${t} is getting out of hand on my FYP`,
  (t) => `POV: you finally understand ${t}`,
  (t) => `The ${t} discourse is so funny`,
];
const JA_TEMPLATES = [
  (t) => `【悲報】最近の若者「${t}」←意味わかる？`,
  (t) => `${t}って結局なんなの？ネットで急に見るようになった`,
  (t) => `${t}が流行りすぎてタイムラインが${t}一色`,
  (t) => `【ゆっくり解説】${t}の元ネタと広まり方`,
];

export function makeMockFetch({ base = Date.now() } = {}) {
  return async function mockFetch(url, init = {}) {
    const u = String(url);
    const now = globalThis.__MOCK_NOW__ ?? Date.now();
    const r = rng(Math.floor(now / H) * 7 + u.length);
    const enLive = live(now, base, (w) => w.en);
    const jaLive = live(now, base, (w) => !w.en);
    const ok = (body, type = 'application/json') =>
      new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200, headers: { 'Content-Type': type } });
    const rss = (items) =>
      ok(
        `<?xml version="1.0"?><rss><channel>${items
          .map((i) => `<item><title><![CDATA[${i.title}]]></title><link>${i.link}</link><pubDate>${new Date(now - r() * 6 * H).toUTCString()}</pubDate>${i.extra || ''}</item>`)
          .join('')}</channel></rss>`,
        'application/rss+xml',
      );

    if (u.includes('bsky.app')) {
      if (u.includes('getTrends'))
        return ok({
          trends: [...enLive.slice(0, 6), ...jaLive.slice(0, 2)].map((w) => ({
            topic: w.t,
            displayName: w.t,
            link: `/search?q=${encodeURIComponent(w.t)}`,
            startedAt: new Date(now - (1 - w.h) * 10 * H).toISOString(),
            postCount: Math.round(w.h * 4000 + r() * 300),
            status: w.h > 0.8 ? 'hot' : undefined,
            category: 'pop-culture',
          })),
        });
      return ok({ topics: MAINSTREAM.slice(0, 3).map((t) => ({ topic: t, link: `/search?q=${t}` })), suggested: [] });
    }
    if (u.includes('/api/v1/trends/tags')) {
      const pool = u.includes('mstdn.jp') ? jaLive : enLive;
      return ok(
        pool.slice(0, 5).map((w) => ({
          name: w.t.replace(/\s+/g, ''),
          url: `https://example.social/tags/${encodeURIComponent(w.t)}`,
          history: Array.from({ length: 7 }, (_, i) => ({ day: String(Math.floor(now / 1000) - i * 86400), uses: String(Math.round((i === 0 ? w.h : w.h * 0.3) * 200)), accounts: '10' })),
        })),
      );
    }
    if (u.includes('misskey.io')) {
      return ok(
        jaLive.slice(0, 8).map((w) => ({
          tag: w.t,
          chart: Array.from({ length: 20 }, (_, i) => Math.round(w.h * (i > 16 ? 30 : 8) + r() * 3)),
          usersCount: Math.round(w.h * 500),
        })),
      );
    }
    if (u.includes('reddit.com')) {
      const children = [];
      for (const w of enLive) {
        const n = Math.ceil(w.h * 4);
        for (let i = 0; i < n; i += 1) {
          children.push({
            data: {
              title: EN_TEMPLATES[(i + w.t.length) % EN_TEMPLATES.length](w.t),
              permalink: `/r/OutOfTheLoop/comments/${w.t.length}${i}/x/`,
              score: Math.round(w.h * 900 * r()),
              num_comments: Math.round(w.h * 200 * r()),
              created_utc: Math.floor((now - r() * 5 * H) / 1000),
              subreddit: ['OutOfTheLoop', 'GenZ', 'teenagers'][i % 3],
            },
          });
        }
      }
      children.push({ data: { title: `${MAINSTREAM[0]} game 7 thread`, permalink: '/r/x/1', score: 50, num_comments: 3, created_utc: now / 1000, subreddit: 'sports' } });
      return ok({ data: { children } });
    }
    if (u.includes('hn.algolia.com')) {
      return ok({
        hits: [
          { objectID: '1', title: 'Show HN: A vibe coding tool that writes vibe coding tools', points: 340, num_comments: 120, created_at_i: Math.floor(now / 1000) - 3600 },
          { objectID: '2', title: 'The unreasonable effectiveness of SQLite', points: 220, num_comments: 80, created_at_i: Math.floor(now / 1000) - 7200 },
          { objectID: '3', title: 'Why everyone is talking about the clanker discourse', points: Math.round(150 * (enLive.find((w) => w.t === 'clanker')?.h ?? 0.1)), num_comments: 40, created_at_i: Math.floor(now / 1000) - 9000 },
        ],
      });
    }
    if (u.includes('lobste.rs')) return ok([{ title: 'Vibe coding considered harmful', short_id_url: 'https://lobste.rs/s/abc', score: 40, comment_count: 22, created_at: new Date(now - 4 * H).toISOString(), tags: ['ai'] }]);
    if (u.includes('trends.google')) {
      const isJP = u.includes('geo=JP');
      return rss(
        MAINSTREAM.filter((t) => isJP === /[^\x00-\x7F]/.test(t) || t === 'iPhone 18').map((t) => ({
          title: t,
          link: 'https://trends.google.com',
          extra: `<ht:approx_traffic>${isJP ? '200000+' : '500000+'}</ht:approx_traffic>`,
        })),
      );
    }
    if (u.includes('wikimedia.org')) {
      return ok({
        items: [
          {
            articles: [
              { article: 'Main_Page', views: 5000000, rank: 1 },
              ...MAINSTREAM.map((t, i) => ({ article: t.replace(/ /g, '_'), views: 300000 - i * 1000, rank: i + 2 })),
              { article: 'Labubu', views: 40000, rank: 40 },
            ],
          },
        ],
      });
    }
    if (u.includes('urbandictionary.com/v0/words_of_the_day')) {
      return ok({
        list: enLive.slice(0, 4).map((w) => ({
          word: w.t,
          definition: `A [slang] term for something very ${w.t.length % 2 ? 'cool' : 'cringe'}.`,
          example: `bro is ${w.t}`,
          thumbs_up: Math.round(w.h * 1000),
          permalink: `https://www.urbandictionary.com/define.php?term=${encodeURIComponent(w.t)}`,
          date: new Date(now).toISOString(),
        })),
      });
    }
    if (u.includes('urbandictionary.com/v0/define')) {
      const term = decodeURIComponent((u.match(/term=([^&]*)/) || [])[1] || '');
      return ok({ list: [{ definition: `[${term}] — mock definition: used ironically online.`, example: `that's so ${term}`, permalink: 'https://www.urbandictionary.com', thumbs_up: 120, thumbs_down: 4 }] });
    }
    if (u.includes('knowyourmeme.com')) {
      return rss(enLive.slice(0, 5).map((w) => ({ title: w.t.replace(/\b\w/g, (c) => c.toUpperCase()), link: `https://knowyourmeme.com/memes/${w.t.replace(/\s+/g, '-')}` })));
    }
    if (u.includes('hatena.ne.jp')) {
      const items = [];
      for (const w of jaLive) {
        const n = Math.ceil(w.h * 3);
        for (let i = 0; i < n; i += 1)
          items.push({
            title: JA_TEMPLATES[(i + w.t.length) % JA_TEMPLATES.length](w.t),
            link: `https://example.jp/${encodeURIComponent(w.t)}/${i}${u.includes('entrylist') ? 'n' : ''}`,
            extra: `<hatena:bookmarkcount>${Math.round(w.h * 300 * r())}</hatena:bookmarkcount>`,
          });
      }
      items.push({ title: '大谷翔平、今季も記録更新', link: 'https://example.jp/ohtani', extra: '<hatena:bookmarkcount>900</hatena:bookmarkcount>' });
      return rss(items);
    }
    if (u.includes('nicovideo.jp')) {
      return rss(jaLive.slice(0, 6).map((w, i) => ({ title: `第${i + 1}位：【${w.t}】${w.t}してみた`, link: `https://www.nicovideo.jp/watch/sm${1000 + i}` })));
    }
    if (u.includes('api.github.com')) {
      return ok({
        items: [
          { name: 'vibe-kit', full_name: 'someone/vibe-kit', description: 'Vibe coding starter kit', stargazers_count: 1800, html_url: 'https://github.com/someone/vibe-kit', created_at: new Date(now - 20 * H).toISOString(), topics: ['vibe-coding', 'agents'] },
          { name: 'tiny-llm', full_name: 'x/tiny-llm', description: 'A tiny LLM in 300 lines', stargazers_count: 900, html_url: 'https://github.com/x/tiny-llm', created_at: new Date(now - 30 * H).toISOString(), topics: ['llm'] },
        ],
      });
    }
    if (u.includes('lemmy.world')) {
      return ok({ posts: enLive.slice(0, 3).map((w, i) => ({ post: { name: `Is "${w.t}" the new "goblin mode"?`, ap_id: `https://lemmy.world/post/${i}`, published: new Date(now - H).toISOString() }, counts: { score: 50, comments: 12 }, community: { name: 'memes' } })) });
    }
    if (NEWS_HOSTS.test(u)) {
      const enHost = /google\.com\/rss.*(US|GB|IN|AU)|tmz|pagesix|dailymail|upi|fark|boingboing|huffpost|bbci|guardian|npr|aljazeera|france24|nhkworld|producthunt/.test(u);
      const pool = live(now, base, (w) => !!w.en === enHost && (w.news || r() < 0.3));
      const tpl = enHost ? EN_NEWS : JA_NEWS;
      const items = pool.slice(0, 6).map((w, i) => ({
        title: `${tpl[(i + w.t.length) % tpl.length](w.t)}${u.includes('news.google') ? ' - モック新聞' : ''}`,
        link: `https://news.example/${encodeURIComponent(w.t)}/${u.length % 97}/${i}`,
      }));
      items.push({ title: enHost ? 'Stock markets close mixed' : '各地で冷え込み　平年を下回る', link: `https://news.example/plain/${u.length}` });
      return rss(items);
    }
    if (u.includes('wikipedia.org/api/rest_v1/page/summary')) {
      return ok({ type: 'standard', extract: 'モックの Wikipedia 要約です。', content_urls: { desktop: { page: 'https://ja.wikipedia.org/' } } });
    }
    return new Response('not mocked', { status: 404 });
  };
}

/** 過去にさかのぼって数回観測し、推移のある状態を作る */
export async function seedHistory({ runPipeline, store, base = Date.now(), runs = 8, stepH = 3 }) {
  for (let i = runs - 1; i >= 0; i -= 1) {
    const at = base - i * stepH * H;
    globalThis.__MOCK_NOW__ = at;
    await runPipeline({ store, now: at, trigger: 'schedule', budgetMs: 5000 });
  }
  delete globalThis.__MOCK_NOW__;
}
