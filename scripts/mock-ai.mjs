/**
 * mock-ai.mjs — AI Pulse 観測網の疑似レスポンス（オフライン開発・テスト用）
 *
 * globalThis.__MOCK_NOW__ の時刻に応じて各トピックの “波” が動くので、
 * 何回か観測を回すと 出現 → 急騰 → 定着 → 失速 が UI で確認できる。
 * 既存の mock-web.mjs の fetch をラップし、AI Pulse 用の URL だけを横取りする。
 */

const H = 3.6e6;

/** 波：peak（基準からの時間）・幅 w・強さ amp。where は出る系統 */
const WAVES = [
  { t: 'Claude Opus 4.5', peak: -3, w: 14, amp: 1, org: 'Anthropic', where: 'hn reddit news press ja hatena zenn wiki gtrend' },
  { t: 'Gemini 3 Pro', peak: -14, w: 22, amp: 0.95, org: 'Google', where: 'hn reddit news press ja hatena wiki gtrend' },
  { t: 'Nano Banana Pro', peak: -7, w: 16, amp: 0.8, org: 'Google', where: 'reddit news press ja hatena zenn bsky' },
  { t: 'Google Antigravity', peak: -9, w: 18, amp: 0.7, org: 'Google', where: 'hn reddit press hatena zenn devto' },
  { t: 'DeepSeek-V3.2', peak: 1, w: 7, amp: 0.75, hf: 'deepseek-ai/DeepSeek-V3.2-Exp', where: 'hn reddit hf news hatena' },
  { t: 'GPT-5.1 Codex', peak: -26, w: 20, amp: 0.7, org: 'OpenAI', where: 'hn reddit news press zenn' },
  { t: 'Kimi K2 Thinking', peak: -34, w: 20, amp: 0.6, hf: 'moonshotai/Kimi-K2-Thinking', where: 'hn reddit hf news' },
  { t: 'Qwen3-VL', peak: -18, w: 26, amp: 0.55, hf: 'Qwen/Qwen3-VL-8B-Instruct', where: 'reddit hf zenn' },
  { t: 'FLUX.2', peak: 0, w: 4, amp: 0.7, hf: 'black-forest-labs/FLUX.2-dev', where: 'reddit hf hn press' },
  { t: 'VibeVoice', peak: -6, w: 14, amp: 0.55, hf: 'microsoft/VibeVoice-1.5B', where: 'hn reddit hf hatena' },
  { t: 'nanochat', peak: -10, w: 30, amp: 0.65, gh: 'karpathy/nanochat', where: 'hn gh reddit hatena zenn' },
  { t: 'Claude Code', peak: -6, w: 200, amp: 0.7, where: 'hn reddit zenn qiita hatena devto gh' },
  { t: 'MCP', peak: -6, w: 200, amp: 0.45, where: 'hn zenn qiita devto gh mastodon' },
  { t: 'Agent Skills', peak: -2, w: 10, amp: 0.6, where: 'hn reddit zenn hatena gh' },
  { t: 'OpenEvolve', peak: -1, w: 6, amp: 0.5, where: 'hn hatena zenn' },
  { t: 'vibe coding', peak: -60, w: 60, amp: 0.4, where: 'hn reddit devto ja' },
  { t: 'Sora 2', peak: -70, w: 30, amp: 0.6, org: 'OpenAI', where: 'reddit news ja' },
  { t: 'NVIDIA Blackwell', peak: -5, w: 120, amp: 0.4, where: 'news press hn' },
  { t: 'humanoid robots', peak: -20, w: 40, amp: 0.35, where: 'news press reddit' },
  { t: 'EU AI Act', peak: -12, w: 30, amp: 0.3, where: 'news press ja' },
];

const EN_TPL = [
  (t) => `${t} is out and it's a big deal`,
  (t) => `I spent a weekend with ${t}: here's what surprised me`,
  (t) => `${t} benchmarks: a closer look at the numbers`,
  (t) => `How ${t} changes the AI agent landscape`,
  (t) => `Ask: is anyone actually using ${t} in production?`,
  (t) => `${t} – first impressions after the launch`,
];
const NEWS_TPL = [
  (t) => `${t} launch signals new phase in AI race`,
  (t) => `What ${t} means for developers and businesses`,
  (t) => `Inside the AI industry's response to ${t}`,
  (t) => `${t}: everything you need to know`,
];
const JA_TPL = [
  (t) => `${t}を1日触ってわかったこと`,
  (t) => `【速報】${t}が登場、生成AIの勢力図はどう変わる？`,
  (t) => `${t}で業務をまるごと自動化してみた`,
  (t) => `いま話題の${t}を徹底解説`,
];
const NOISE_EN = ['The unreasonable effectiveness of SQLite', 'Rust 2.0 roadmap', 'A history of the floppy disk', 'Show HN: A tiny Lisp in 500 lines'];
const NOISE_JA = ['円安が続く理由を整理する', '新しいキーボードを買った話', 'Kubernetes 運用の失敗談'];
const PUBS = ['Reuters', 'Bloomberg', 'The New York Times', 'CNBC', 'Financial Times', 'The Guardian', 'Axios', 'Business Insider', 'Fortune', 'Forbes'];
const JA_PUBS = ['日本経済新聞', 'ITmedia', 'Impress Watch', 'ASCII.jp', '日経クロステック', 'GIGAZINE'];

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
const heat = (w, now, base) => {
  const d = (now - base) / H - w.peak;
  return w.amp * Math.exp(-(d * d) / (2 * w.w * w.w));
};

export function wrapAiMockFetch(fallback, { base = Date.now() } = {}) {
  return async function aiMockFetch(url, init = {}) {
    const u = String(url);
    const now = globalThis.__MOCK_NOW__ ?? Date.now();
    const r = rng(Math.floor(now / H) * 13 + u.length * 7);
    const live = (tag) =>
      WAVES.filter((w) => w.where.split(' ').includes(tag))
        .map((w) => ({ ...w, h: heat(w, now, base) }))
        .filter((w) => w.h > 0.06)
        .sort((a, b) => b.h - a.h);
    const ok = (body, type = 'application/json') =>
      new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200, headers: { 'Content-Type': type } });
    const rss = (items) =>
      ok(
        `<?xml version="1.0"?><rss><channel>${items
          .map((i) => `<item><title><![CDATA[${i.title}]]></title><link>${i.link}</link><pubDate>${new Date(i.ts ?? now - r() * 8 * H).toUTCString()}</pubDate>${i.extra || ''}</item>`)
          .join('')}</channel></rss>`,
        'application/rss+xml',
      );
    const ago = (maxH) => now - r() * maxH * H;

    // ---- Hacker News（AI Pulse は query= を必ず付ける）
    if (u.includes('hn.algolia.com') && u.includes('query=')) {
      const hits = [];
      for (const w of live('hn')) {
        const n = Math.ceil(w.h * 3);
        for (let i = 0; i < n; i += 1) {
          hits.push({ objectID: `${w.t.length}${i}${Math.floor(w.peak)}`, title: EN_TPL[(i + w.t.length) % EN_TPL.length](w.t), points: Math.round(w.h * 900 * (0.4 + r())), num_comments: Math.round(w.h * 400 * r()), created_at_i: Math.floor(ago(20) / 1000), url: 'https://example.com/a' });
        }
      }
      NOISE_EN.forEach((t, i) => hits.push({ objectID: `n${i}`, title: t, points: 200 + i * 40, num_comments: 80, created_at_i: Math.floor(ago(24) / 1000) }));
      return ok({ hits });
    }
    // ---- Reddit（AI サブレ）
    if (u.includes('reddit.com') && u.includes('LocalLLaMA')) {
      const children = [];
      for (const w of live('reddit')) {
        const n = Math.ceil(w.h * 4);
        for (let i = 0; i < n; i += 1)
          children.push({ data: { id: `${w.t}${i}${u.includes('/hot') ? 'h' : 't'}`, title: EN_TPL[(i * 3 + w.t.length) % EN_TPL.length](w.t), permalink: `/r/LocalLLaMA/comments/${w.t.length}${i}/x/`, score: Math.round(w.h * 2400 * (0.3 + r())), num_comments: Math.round(w.h * 500 * r()), created_utc: Math.floor(ago(18) / 1000), subreddit: ['LocalLLaMA', 'singularity', 'ClaudeAI', 'OpenAI'][i % 4] } });
      }
      return ok({ data: { children } });
    }
    // ---- GitHub（AI Pulse は stars:> を含む）
    if (u.includes('api.github.com/search/repositories') && u.includes('stars%3A')) {
      const items = [];
      for (const w of live('gh')) {
        const name = w.gh ? w.gh.split('/')[1] : `${w.t.toLowerCase().replace(/\s+/g, '-')}-starter`;
        items.push({ name, full_name: w.gh || `dev${w.t.length}/${name}`, description: `${w.t} — ${w.gh ? 'The best ChatGPT that $100 can buy' : 'templates and tools for AI agents'}`, stargazers_count: Math.round(w.h * 18000 + 200), html_url: `https://github.com/${w.gh || `dev${w.t.length}/${name}`}`, created_at: new Date(now - (w.gh ? 3 : 1.5) * 864e5).toISOString(), topics: ['llm', 'ai'], language: 'Python' });
      }
      items.push({ name: 'awesome-claude-skills', full_name: 'x/awesome-claude-skills', description: 'A curated list of Agent Skills for Claude Code', stargazers_count: Math.round(3000 * (heat(WAVES[13], now, base) + 0.2)), html_url: 'https://github.com/x/awesome-claude-skills', created_at: new Date(now - 2 * 864e5).toISOString(), topics: ['claude', 'agent-skills'] });
      items.push({ name: 'rust-todo', full_name: 'y/rust-todo', description: 'A todo app in Rust', stargazers_count: 120, html_url: 'https://github.com/y/rust-todo', created_at: new Date(now - 864e5).toISOString(), topics: [] });
      return ok({ items });
    }
    // ---- Hugging Face
    if (u.includes('huggingface.co/api/models')) {
      const list = live('hf').filter((w) => w.hf).map((w) => ({ id: w.hf, likes: Math.round(w.h * 2000), downloads: Math.round(w.h * 90000), trendingScore: Math.round(w.h * 600), pipeline_tag: w.t.includes('FLUX') ? 'text-to-image' : w.t.includes('Vibe') ? 'text-to-speech' : 'text-generation', tags: ['transformers'], createdAt: new Date(now - 6 * 864e5).toISOString() }));
      list.push({ id: 'sentence-transformers/all-MiniLM-L6-v2', likes: 3000, trendingScore: 20, pipeline_tag: 'sentence-similarity' });
      list.push({ id: 'Wan-AI/Wan2.2-Animate-14B', likes: 900, trendingScore: 140, pipeline_tag: 'image-to-video', createdAt: new Date(now - 20 * 864e5).toISOString() });
      return ok(list.sort((a, b) => b.trendingScore - a.trendingScore));
    }
    if (u.includes('huggingface.co/api/spaces')) {
      return ok(live('hf').filter((w) => w.hf).slice(0, 3).map((w) => ({ id: `${w.hf.split('/')[0]}/${w.hf.split('/')[1]}-demo`, likes: Math.round(w.h * 400), trendingScore: Math.round(w.h * 80), sdk: 'gradio', tags: ['gradio'] })));
    }
    if (u.includes('huggingface.co/api/daily_papers')) {
      const papers = [
        { id: '2511.01234', title: 'Kimi Linear: An Expressive, Efficient Attention Architecture', upvotes: 180 },
        { id: '2511.04567', title: 'Scaling Agent Skills with Reinforcement Learning from Tool Feedback', upvotes: 95 },
        { id: '2511.07890', title: 'DeepSeek-V3.2: Sparse Attention for Long Context', upvotes: Math.round(250 * (heat(WAVES[4], now, base) + 0.1)) },
      ];
      return ok(papers.map((p) => ({ paper: { ...p, summary: 'We propose a method for efficient reasoning in large language models.', publishedAt: new Date(now - 20 * H).toISOString() }, publishedAt: new Date(now - 20 * H).toISOString(), numComments: 4 })));
    }
    // ---- Google News
    if (u.includes('news.google.com')) {
      const ja = u.includes('hl=ja');
      const items = [];
      for (const w of live(ja ? 'ja' : 'news')) {
        const n = Math.ceil(w.h * 6);
        for (let i = 0; i < n; i += 1) {
          const pub = (ja ? JA_PUBS : PUBS)[(i * 3 + w.t.length + u.length) % (ja ? JA_PUBS : PUBS).length];
          const title = ja ? JA_TPL[(i + w.t.length) % JA_TPL.length](w.t) : NEWS_TPL[(i + w.t.length) % NEWS_TPL.length](w.t);
          items.push({ title: `${title} - ${pub}`, link: `https://news.example/${encodeURIComponent(w.t)}/${i}/${u.length}`, extra: `<source url="https://${pub.replace(/\s/g, '').toLowerCase()}.com">${pub}</source>`, ts: ago(14) });
        }
      }
      items.push({ title: `Stocks rally as markets digest data - ${PUBS[0]}`, link: 'https://news.example/markets', extra: `<source url="https://reuters.com">${PUBS[0]}</source>` });
      return rss(items);
    }
    // ---- テック媒体
    if (/techcrunch|theverge|arstechnica|venturebeat|technologyreview|wired\.com|the-decoder|marktechpost|itmedia/.test(u)) {
      const items = live('press').slice(0, 6).map((w, i) => ({ title: NEWS_TPL[(i + u.length) % NEWS_TPL.length](w.t), link: `https://press.example/${u.length}/${encodeURIComponent(w.t)}`, ts: ago(18) }));
      return rss(items);
    }
    // ---- はてブ IT
    if (u.includes('hatena.ne.jp') && u.includes('/it.rss')) {
      const items = [];
      for (const w of live('hatena')) {
        const n = Math.ceil(w.h * 3);
        for (let i = 0; i < n; i += 1) items.push({ title: JA_TPL[(i + w.t.length) % JA_TPL.length](w.t), link: `https://example.jp/ai/${encodeURIComponent(w.t)}/${i}${u.includes('entrylist') ? 'n' : ''}`, extra: `<hatena:bookmarkcount>${Math.round(w.h * 700 * (0.3 + r()))}</hatena:bookmarkcount>` });
      }
      NOISE_JA.forEach((t, i) => items.push({ title: t, link: `https://example.jp/noise/${i}`, extra: '<hatena:bookmarkcount>300</hatena:bookmarkcount>' }));
      return rss(items);
    }
    // ---- Zenn / Qiita / DEV / Lobsters / Mastodon / Product Hunt
    if (u.includes('zenn.dev/api/articles')) {
      const articles = live('zenn').flatMap((w, k) => [0, 1].slice(0, Math.ceil(w.h * 2)).map((i) => ({ title: JA_TPL[(i + k) % JA_TPL.length](w.t), path: `/u/articles/${encodeURIComponent(w.t)}-${i}-${u.length}`, liked_count: Math.round(w.h * 300 * r()), published_at: new Date(ago(30)).toISOString(), user: { username: 'dev' } })));
      return ok({ articles });
    }
    if (u.includes('qiita.com')) {
      return ok(`<?xml version="1.0"?><feed>${live('qiita').map((w, i) => `<entry><title>${JA_TPL[i % JA_TPL.length](w.t)}</title><link href="https://qiita.com/x/items/${i}"/><updated>${new Date(ago(20)).toISOString()}</updated></entry>`).join('')}</feed>`, 'application/atom+xml');
    }
    if (u.includes('dev.to/api/articles')) {
      return ok(live('devto').map((w, i) => ({ title: EN_TPL[i % EN_TPL.length](w.t), url: `https://dev.to/x/${encodeURIComponent(w.t)}-${u.length}`, public_reactions_count: Math.round(w.h * 300), comments_count: 12, published_timestamp: new Date(ago(40)).toISOString(), tag_list: ['ai', 'llm'] })));
    }
    if (u.includes('lobste.rs/t/')) {
      return ok(live('hn').slice(0, 3).map((w, i) => ({ short_id: `${i}${u.length}`, title: `${w.t}: notes from the trenches`, short_id_url: `https://lobste.rs/s/${i}${u.length}`, score: Math.round(w.h * 60), comment_count: 14, created_at: new Date(ago(30)).toISOString(), tags: ['ai'] })));
    }
    if (u.includes('/api/v1/timelines/tag/')) {
      return ok(live('mastodon').concat(live('hn').slice(0, 2)).map((w, i) => ({ id: `${i}${u.length}`, url: `https://social.example/@a/${i}${u.length}`, content: `<p>Playing with ${w.t} today — the AI tooling keeps getting better #ai #llm</p>`, favourites_count: Math.round(w.h * 40), reblogs_count: 5, replies_count: 2, created_at: new Date(ago(12)).toISOString() })));
    }
    if (u.includes('producthunt.com')) {
      return ok(`<?xml version="1.0"?><feed><entry><title>VibeVoice Studio</title><link href="https://www.producthunt.com/products/vibevoice-studio"/><content>Turn scripts into podcasts with open-source AI voices</content><updated>${new Date(ago(20)).toISOString()}</updated></entry><entry><title>Antigravity</title><link href="https://www.producthunt.com/products/antigravity"/><content>Google's agent-first IDE</content><updated>${new Date(ago(30)).toISOString()}</updated></entry></feed>`, 'application/atom+xml');
    }
    if (u.includes('wikimedia.org') && u.includes('pageviews/top')) {
      const ai = [
        { article: 'Gemini_(chatbot)', views: Math.round(120000 * (heat(WAVES[1], now, base) + 0.15)) },
        { article: 'Claude_(language_model)', views: Math.round(90000 * (heat(WAVES[0], now, base) + 0.15)) },
        { article: 'ChatGPT', views: 160000 },
        { article: 'Gemini_(constellation)', views: 5000 },
      ];
      const fallbackBody = await (await fallback(url, init)).json().catch(() => ({ items: [{ articles: [] }] }));
      const arts = [...(fallbackBody.items?.[0]?.articles ?? []), ...ai.map((a, i) => ({ ...a, rank: 50 + i }))];
      return ok({ items: [{ articles: arts }] });
    }
    if (u.includes('trends.google') && (u.includes('geo=GB') || u.includes('geo=IN'))) {
      const g = live('gtrend')[0];
      return rss(g ? [{ title: g.t, link: 'https://trends.google.com', extra: '<ht:approx_traffic>100000+</ht:approx_traffic>' }] : []);
    }
    if (u.includes('trends.google') && u.includes('geo=US')) {
      const res = await fallback(url, init);
      const xml = await res.text();
      const g = live('gtrend')[0];
      return ok(g ? xml.replace('</channel>', `<item><title>${g.t}</title><link>https://trends.google.com</link><ht:approx_traffic>200000+</ht:approx_traffic></item></channel>`) : xml, 'application/rss+xml');
    }
    return fallback(url, init);
  };
}

/** 毎時の観測を過去にさかのぼって回し、推移のある台帳を作る */
export async function seedAiHistory({ runAiPipeline, store, base = Date.now(), runs = 18, stepH = 1 }) {
  for (let i = runs - 1; i >= 0; i -= 1) {
    const at = base - i * stepH * H;
    globalThis.__MOCK_NOW__ = at;
    await runAiPipeline({ store, now: at, trigger: 'schedule', budgetMs: 6000 });
  }
  delete globalThis.__MOCK_NOW__;
}
