import test from 'node:test';
import assert from 'node:assert/strict';
import { mineCandidates } from '../netlify/lib/mine.js';
import { scoreRun } from '../netlify/lib/score.js';
import { SOURCE_MAP } from '../netlify/lib/sources.js';
import { prepareSignals } from '../netlify/lib/intelligence.js';
import { groupStories, trendDirection, periodicityOf, changeOver } from '../netlify/lib/trend.js';
import { buildClusters, trackThreads, groupTerms, lexicallyContains, linkTerms } from '../netlify/lib/cluster.js';
import { assessVerification, classifyTopic, scoreImportance, sourceTypeOf } from '../netlify/lib/topics.js';
import { buildThemes, buildWorldSummary, coverageOf } from '../netlify/lib/brief.js';

const H = 3.6e6;
const NOW = Date.parse('2026-11-21T12:00:00Z');
const post = (src, text, url, extra = {}) => ({ src, kind: 'post', text, url, score: 100, ts: NOW - H, ...extra });
const topic = (src, text, extra = {}) => ({ src, kind: 'topic', text, url: `https://bsky.app/search?q=${encodeURIComponent(text)}`, terms: [{ t: text, w: 1 }], score: 500, ts: NOW - H, ...extra });

/** パイプラインと同じ順で 1 回分を処理する */
function run(signals, { lexicon = {}, threads = {}, now = NOW } = {}) {
  const { clean } = prepareSignals(signals);
  const stories = groupStories(clean);
  const scored = scoreRun({ signals: clean, candidates: mineCandidates(clean), sourceMap: SOURCE_MAP, lexicon, now, stories });
  const clusters = buildClusters({ terms: scored.terms, signals: clean, stories, sourceMap: SOURCE_MAP, now });
  const tracked = trackThreads(clusters, threads, { now, intervalH: 3 });
  linkTerms(scored.terms, tracked.clusters);
  return { ...scored, ...tracked, signals: clean };
}

const RIEMANN = [
  post('hackernews', 'Claude proves the Riemann Hypothesis; proof formally verified in Lean', 'https://news.ycombinator.com/item?id=1', { link: 'https://arxiv.org/abs/2611.01234' }),
  post('reddit', 'An AI just proved the Riemann Hypothesis and the Lean proof checks out', 'https://www.reddit.com/r/math/comments/1/x/', { link: 'https://www.quantamagazine.org/ai-riemann-lean/' }),
  post('lobsters', 'Notes on the Lean proof of the Riemann Hypothesis', 'https://lobste.rs/s/abc', { link: 'https://arxiv.org/abs/2611.01234' }),
  post('hatena', 'リーマン予想をAIが証明、Lean proof で形式検証', 'https://www.quantamagazine.org/ai-riemann-lean/'),
  topic('bluesky', 'Riemann Hypothesis'),
  { src: 'mastodon', kind: 'tag', text: '#RiemannHypothesis', url: 'https://mastodon.social/tags/RiemannHypothesis', terms: [{ t: 'RiemannHypothesis', w: 1 }], score: 80, ts: NOW, ctx: 'mastodon.social' },
];
const OTHER = [
  topic('bluesky', 'aura farming'),
  post('reddit', 'Can someone explain the aura farming trend to an old person', 'https://www.reddit.com/r/GenZ/comments/2/x/'),
  post('reddit', 'What does "aura farming" even mean? Everyone in my class keeps saying it', 'https://www.reddit.com/r/GenZ/comments/3/x/'),
  post('reddit', 'What does "unc status" even mean? Everyone in my class keeps saying it', 'https://www.reddit.com/r/GenZ/comments/4/x/'),
  topic('bluesky', 'unc status'),
];

test('同一トレンドの統合：リーマン予想・Lean proof を 1 つのトレンドにまとめ、元の語と出典を残す', () => {
  const { clusters, terms } = run([...RIEMANN, ...OTHER]);
  const rh = clusters.find((c) => c.members.some((m) => m.k === 'riemannhypothesis'));
  assert.ok(rh, 'Riemann cluster exists');
  const keys = rh.members.map((m) => m.k);
  assert.ok(keys.includes('leanproof') || keys.includes('lean'), `Lean is merged: ${keys}`);
  // 統合後も元の語・投稿・URL を参照できる
  assert.ok(rh.evidence.some((e) => e.l === 'https://arxiv.org/abs/2611.01234'));
  assert.ok(rh.evidence.every((e) => e.u && e.s));
  assert.ok(terms.filter((t) => keys.includes(t.k)).every((t) => t.cl === rh.id), 'terms link back to their cluster');
  // 無関係な話題とは混ぜない
  assert.ok(!keys.includes('aurafarming') && !keys.includes('uncstatus'));
  assert.equal(new Set(clusters.map((c) => c.id)).size, clusters.length);
});

test('誤統合の防止：定型文の見出しや「まとめ記事」で別々の語をつなげない', () => {
  const { clusters } = run(OTHER);
  const aura = clusters.find((c) => c.members.some((m) => m.k === 'aurafarming'));
  const unc = clusters.find((c) => c.members.some((m) => m.k === 'uncstatus'));
  assert.ok(aura && unc);
  assert.notEqual(aura.id, unc.id);

  // まとめ記事に複数の確立した語が並んでいても、1 件しか出ていない語はどちらにも合流させない
  const listicle = [
    ...['aura farming', 'unc status'].flatMap((t, i) => [topic('bluesky', t), topic('mastodon', t, { url: `https://m.example/${i}` }), post('reddit', `the ${t} discourse keeps going`, `https://reddit.com/r/x/${i}`)]),
    post('hatena', '今週のネット流行語：aura farming、unc status、skibidi rizzler', 'https://example.jp/matome'),
    post('reddit', 'skibidi rizzler is the strangest one yet', 'https://reddit.com/r/x/z'),
  ];
  const r = run(listicle);
  const a2 = r.clusters.find((c) => c.members.some((m) => m.k === 'aurafarming'));
  const u2 = r.clusters.find((c) => c.members.some((m) => m.k === 'uncstatus'));
  assert.notEqual(a2.id, u2.id);
  assert.ok(!a2.members.some((m) => m.k === 'skibidirizzler') || !u2.members.some((m) => m.k === 'skibidirizzler'));
});

test('表記の包含による統合は具体的な語に限る', () => {
  assert.equal(lexicallyContains('Riemann Hypothesis proof', 'Riemann Hypothesis'), true);
  assert.equal(lexicallyContains('生成AI切り抜き一色', '生成AI切り抜き'), true);
  assert.equal(lexicallyContains('Claude Code', 'Claude'), false); // 1 語は別の話題の可能性
  assert.equal(lexicallyContains('チー牛構文', '構文'), false); // 2 文字は一般語
});

test('一般語ノイズ：proof / bad / home / user を独立トレンドにしない', () => {
  const noise = [
    post('reddit', 'This proof is bad, go home user', 'https://reddit.com/r/a/1'),
    post('hackernews', 'Show HN: proof that home user setups are bad', 'https://news.ycombinator.com/item?id=9'),
    post('lemmy', 'The home user has no proof', 'https://lemmy.world/post/3'),
    { src: 'mastodon', kind: 'tag', text: '#proof', url: 'https://mastodon.social/tags/proof', terms: [{ t: 'proof', w: 1 }], score: 10, ts: NOW },
  ];
  const { terms, droppedGeneric } = run([...noise, ...RIEMANN]);
  for (const w of ['proof', 'bad', 'home', 'user']) assert.ok(!terms.some((t) => t.k === w), `${w} must not be a trend`);
  assert.ok(droppedGeneric >= 4);
  assert.ok(terms.some((t) => t.k === 'riemannhypothesis'));
});

test('同じ記事の転載は 1 ストーリー（UTM などの追跡パラメータは無視）', () => {
  const s = [
    post('reddit', 'Big outage hits cloud provider', 'https://reddit.com/r/a/1', { link: 'https://www.reuters.com/x?utm_source=a' }),
    post('hackernews', 'Big outage hits cloud provider (reuters)', 'https://news.ycombinator.com/item?id=2', { link: 'https://reuters.com/x' }),
    post('hatena', 'Cloud provider outage', 'https://example.com/other'),
  ];
  const ids = groupStories(s);
  assert.equal(ids[0], ids[1]);
  assert.notEqual(ids[0], ids[2]);
});

test('動向の判定：少数投稿の急増を過大評価せず、0% やマイナスを上昇中にしない', () => {
  const base = { now: NOW, intervalH: 3, prevAt: NOW - 3 * H };
  assert.equal(trendDirection({ ...base, cur: 1, ema: null }).dir, 'new');
  // 1 件の投稿で 0.2 → 2 に増えても「上昇中」にはしない（根拠に理由を残す）
  const lone = trendDirection({ ...base, cur: 2, ema: 0.2, posts: 1, spread: 1, voices: 1 });
  assert.equal(lone.dir, 'flat');
  assert.match(lone.basis.note, /保留/);
  // 複数の投稿・媒体に支えられた増加は上昇中
  const broad = trendDirection({ ...base, cur: 6, ema: 1.5, posts: 6, spread: 4, voices: 6 });
  assert.equal(broad.dir, 'rising');
  assert.ok(broad.velocity < (6 - 1.5) / 2.1, 'velocity is shrunk');
  assert.equal(trendDirection({ ...base, cur: 1.5, ema: 1.5, posts: 5, spread: 3, voices: 5 }).dir, 'flat');
  assert.equal(trendDirection({ ...base, cur: 0.5, ema: 3, posts: 2, spread: 2, voices: 2 }).dir, 'falling');
  // 再掲のみ（新しい投稿 0）は上昇中にしない
  const repost = trendDirection({ ...base, cur: 6, ema: 1.5, posts: 6, spread: 4, voices: 6, newPosts: 0 });
  assert.equal(repost.dir, 'flat');
  assert.match(repost.basis.note, /再掲/);
});

test('周期的なトレンドの補正：曜日タグと毎日同じ時間帯の話題', () => {
  assert.equal(periodicityOf('#TuneTuesday', [], NOW, 5).kind, 'weekly');
  const hist = [[NOW - 24 * H, 4], [NOW - 12 * H, 0.2]];
  const p = periodicityOf('morning show', hist, NOW, 4.2);
  assert.equal(p.kind, 'daily');
  const d = trendDirection({ cur: 4.2, ema: 1, posts: 5, spread: 3, voices: 5, periodic: p, now: NOW, intervalH: 3 });
  assert.equal(d.basis.cmp, 'seasonal24');
  assert.notEqual(d.dir, 'rising');
  assert.equal(changeOver(hist, NOW, 4.2, 24).prev, 4);
  assert.equal(changeOver(hist, NOW, 4.2, 48).ratio, null);
});

test('検証状態：SNS のみ／単独報道／複数報道／論文の発表段階／ソフトの公開のみ／誤情報の可能性', () => {
  const sns = assessVerification([{ src: 'bluesky', url: 'https://bsky.app/x', text: 'wow' }]);
  assert.equal(sns.status, 'unverified');
  const one = assessVerification([{ src: 'hackernews', url: 'https://news.ycombinator.com/item?id=1', link: 'https://www.reuters.com/a', text: 'x' }]);
  assert.equal(one.status, 'investigating');
  const two = assessVerification([
    { src: 'hackernews', url: 'u', link: 'https://www.reuters.com/a', text: 'x' },
    { src: 'reddit', url: 'u', link: 'https://apnews.com/b', text: 'x' },
  ]);
  assert.equal(two.status, 'confirmed');
  // 論文 + その報道 1 件 → 論文は主張そのものなので独立した裏付けとは数えない
  const paper = assessVerification([
    { src: 'hackernews', url: 'u', link: 'https://arxiv.org/abs/1', text: 'Claude proves the Riemann Hypothesis' },
    { src: 'reddit', url: 'u', link: 'https://www.quantamagazine.org/a', text: 'AI proof' },
  ]);
  assert.equal(paper.status, 'investigating');
  assert.equal(paper.stage, 'research-reported');
  assert.ok(paper.notes.some((n) => /独立検証/.test(n)));
  const repo = assessVerification([{ src: 'github', url: 'https://github.com/a/b', text: 'tiny llm' }]);
  assert.equal(repo.stage, 'software-released');
  assert.ok(repo.notes.some((n) => /動作/.test(n)));
  const hoax = assessVerification([{ src: 'reddit', url: 'u', link: 'https://apnews.com/x', text: 'Viral claim is a hoax, officials say' }]);
  assert.equal(hoax.status, 'disputed');
  assert.equal(sourceTypeOf({ src: 'hatena', url: 'https://ec.europa.eu/commission/presscorner/x' }), 'official');
  assert.equal(sourceTypeOf({ src: 'github', url: 'https://github.com/a/b' }), 'repo');
});

test('未検証でも重要な話題は除外しない（状態を付けて残す）', () => {
  const s = [
    post('reddit', 'Massive earthquake reported near the coast, thousands evacuated', 'https://reddit.com/r/w/1'),
    post('lemmy', 'Earthquake near the coast: thousands evacuated overnight', 'https://lemmy.world/post/5'),
  ];
  const { clusters } = run(s);
  const eq = clusters.find((c) => c.members.some((m) => /earthquake/i.test(m.t)));
  assert.ok(eq, 'kept despite being SNS-only');
  assert.equal(eq.verification.status, 'unverified');
  assert.ok(eq.importance >= 50, `importance ${eq.importance}`);
});

test('注目度と社会的重要度は別の尺度', () => {
  const { clusters } = run([...RIEMANN, ...OTHER, topic('mastodon', 'aura farming', { url: 'https://m.example/a' }), topic('misskey', 'aura farming', { url: 'https://misskey.io/tags/a' })]);
  const aura = clusters.find((c) => c.members.some((m) => m.k === 'aurafarming'));
  const rh = clusters.find((c) => c.members.some((m) => m.k === 'riemannhypothesis'));
  assert.ok(aura.attention > rh.attention || aura.attention === 100, 'slang leads on attention');
  assert.ok(rh.importance > (aura.importance ?? 0), 'research leads on importance');
  assert.equal(rh.topic, 'science');
  assert.ok(rh.impFactors.length >= 2);
  // 文脈がなく裏付けもない語は重要度を確定しない
  assert.equal(scoreImportance({ topics: ['other'], matched: false, posts: 1, domains: 0 }).importance, null);
  assert.equal(scoreImportance({ topics: ['politics'], matched: true, posts: 3, domains: 0, hasContext: false }).importance, null);
});

test('内容カテゴリ：投稿元ではなく話題で分類し、複数分野も保持', () => {
  assert.equal(classifyTopic({ terms: ['AI chip stocks'], texts: ['AI chip stocks slide as investors question spending'] }).topic, 'economy');
  const r = classifyTopic({ terms: ['Riemann Hypothesis'], texts: ['Claude proves the Riemann Hypothesis'] });
  assert.equal(r.topic, 'science');
  assert.equal(classifyTopic({ terms: ['ぱおん'], texts: [], genres: ['sns'], slang: 0.6 }).topic, 'culture');
  assert.equal(classifyTopic({ terms: ['大谷翔平'], texts: ['大谷翔平、今季も記録更新'] }).topic, 'sports');
});

test('継続性：観測をまたいで同じ ID を保ち、再掲を新しい投稿として数えない', () => {
  const first = run([...RIEMANN, ...OTHER]);
  const rh1 = first.clusters.find((c) => c.members.some((m) => m.k === 'riemannhypothesis'));
  const later = NOW + 3 * H;
  const second = run([...RIEMANN, ...OTHER].map((s) => ({ ...s, ts: later - H })), { lexicon: first.lexicon, threads: first.threads, now: later });
  const rh2 = second.clusters.find((c) => c.members.some((m) => m.k === 'riemannhypothesis'));
  assert.equal(rh2.id, rh1.id);
  assert.equal(rh2.runs, 2);
  assert.equal(rh2.newPosts, 0);
  assert.notEqual(rh2.dir, 'rising');
  assert.ok(rh2.durationH >= 3);

  // ランキングから消えても、重要な話題は継続監視に残る
  let threads = second.threads;
  let lex = second.lexicon;
  for (let i = 2; i <= 3; i += 1) {
    const at = NOW + i * 3 * H;
    const r = run([...RIEMANN, ...OTHER].map((s) => ({ ...s, ts: at - H })), { lexicon: lex, threads, now: at });
    threads = r.threads;
    lex = r.lexicon;
  }
  const gone = run(OTHER, { lexicon: lex, threads, now: NOW + 15 * H });
  const w = gone.watch.find((x) => x.id === rh1.id);
  assert.ok(w, 'still tracked');
  assert.equal(w.onBoard, false);
});

test('関連分析：共通の語で束ねるが因果関係は断定しない', () => {
  const s = [
    post('hackernews', 'AI chip stocks slide as investors question data center spending', 'h1', { link: 'https://www.reuters.com/ai-stocks' }),
    post('reddit', 'AI chip stocks slide again as selloff deepens', 'r1', { link: 'https://www.bloomberg.com/ai-stocks' }),
    post('hackernews', 'EU regulators open probe into AI training data under the AI Act', 'h2', { link: 'https://www.theverge.com/eu-ai' }),
    post('lobsters', 'EU regulators open probe into AI training data', 'l2', { link: 'https://www.politico.eu/ai-probe' }),
  ];
  const { clusters } = run(s);
  const themes = buildThemes(clusters, { minImportance: 30 });
  const ai = themes.find((t) => t.label === 'AI');
  assert.ok(ai, `themes: ${themes.map((t) => t.label)}`);
  assert.ok(ai.size >= 2);
  assert.match(ai.caution, /因果関係/);
  assert.ok(ai.background && ai.common && ai.differences.length && ai.outlook);
  const summary = buildWorldSummary({ clusters, events: [], watch: [], themes, now: NOW });
  assert.ok(summary.changes.length >= 1);
  assert.ok(summary.changes.every((x) => x.what && x.why && x.unknown));
});

test('観測の偏りを明示する', () => {
  const sigs = Array.from({ length: 50 }, (_, i) => ({ src: i < 40 ? 'hatena' : 'reddit', text: i < 40 ? '日本語の見出し' : 'english title' }));
  const cov = coverageOf(sigs, [{ id: 'hatena', label: 'はてブ', ok: true }, { id: 'reddit', label: 'Reddit', ok: true }, { id: 'lemmy', label: 'Lemmy', ok: false }]);
  assert.ok(cov.warnings.some((w) => /はてブ/.test(w)));
  assert.ok(cov.warnings.some((w) => /Lemmy/.test(w)));
  assert.ok(cov.warnings.some((w) => /少なく/.test(w)));
});

test('groupTerms はストーリーを持たない語も落とさない', () => {
  const terms = [{ t: 'a', score: 10, _hits: [] }, { t: 'b', score: 5, _hits: [0] }];
  const g = groupTerms(terms, [{}], [0]);
  assert.equal(g.reduce((a, x) => a + x.members.length, 0), 2);
});
