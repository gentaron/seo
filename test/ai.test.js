import test from 'node:test';
import assert from 'node:assert/strict';
import { extractEntities, isAiContext } from '../netlify/lib/ai/lexicon.js';
import { analyzeAi, artifactBase } from '../netlify/lib/ai/engine.js';
import { AI_SOURCE_MAP, collectAiSignals } from '../netlify/lib/ai/sources.js';
import { runAiPipeline } from '../netlify/lib/ai/pipeline.js';
import { makeMockFetch } from '../scripts/mock-web.mjs';
import { wrapAiMockFetch, seedAiHistory } from '../scripts/mock-ai.mjs';
import { memoryStore } from '../netlify/lib/store.js';
import ai from '../netlify/functions/ai.mjs';
import aiRefresh from '../netlify/functions/ai-refresh.mjs';

const names = (t) => extractEntities(t, { aiContext: isAiContext(t) }).map((e) => e.name);

test('lexicon：版つきモデル名を正規化し、内側の短い名前は二重に数えない', () => {
  assert.deepEqual(names('Claude Opus 4.5 beats GPT-5.1 Codex on SWE-bench'), ['Claude Opus 4.5', 'GPT-5.1 Codex']);
  assert.deepEqual(names('NVIDIA Blackwell GB300 shipments'), ['NVIDIA Blackwell']);
  assert.deepEqual(names('DeepSeek-V3.2-Exp and DeepSeek-R2'), ['DeepSeek-V3.2', 'DeepSeek-R2']);
  assert.deepEqual(names('I tried Claude Code with MCP servers'), ['Claude Code', 'MCP (Model Context Protocol)']);
  assert.deepEqual(names('生成AIで画像生成'), ['生成AI']);
});

test('lexicon：一般語との衝突を避ける', () => {
  assert.deepEqual(names('The cursor blinks on the screen'), []);
  assert.deepEqual(names('Cursor 2.0 ships Composer'), ['Cursor']);
  assert.equal(isAiContext('Gemini (constellation)'), false);
});

test('artifactBase：サイズや量子化の接尾辞を落とす', () => {
  assert.equal(artifactBase('VibeVoice-1.5B'), 'VibeVoice');
  assert.equal(artifactBase('Kimi Linear: An Expressive Attention'), 'Kimi Linear');
});

test('engine：層をまたぐ話題は 1 媒体の連投より上に来る', () => {
  const now = Date.now();
  const mk = (src, text, extra = {}) => ({ src, fam: AI_SOURCE_MAP[src].fam, text, url: `https://x/${src}/${Math.random()}`, score: 100, ts: now - 3.6e6, native: true, ...extra });
  const signals = [
    mk('hackernews', 'Claude Opus 4.5 is out'),
    mk('press', 'Anthropic launches Claude Opus 4.5', { pub: 'TechCrunch', rank: 0, n: 10, score: 0 }),
    mk('hatena', 'Claude Opus 4.5 を試した'),
    ...Array.from({ length: 6 }, (_, i) => mk('reddit', `Grok 4.1 thoughts part ${i}`, { score: 100 + i })),
    ...Array.from({ length: 6 }, (_, i) => mk('reddit', `random filler ${i}`, { score: 1 })),
  ];
  const { top } = analyzeAi({ signals, sourceMap: AI_SOURCE_MAP, ledger: {}, now });
  const a = top.find((t) => t.name === 'Claude Opus 4.5');
  const b = top.find((t) => t.name === 'Grok 4.1');
  assert.ok(a && b);
  assert.ok(a.rank < b.rank, `${a.rank} vs ${b.rank}`);
  assert.equal(a.breadth, 3);
});

test('engine：成果物名は AI の語を含まない見出しとも束ねられる', () => {
  const now = Date.now();
  const signals = [
    { src: 'hfmodels', fam: 'models', text: 'VibeVoice-1.5B (text-to-speech)', url: 'https://hf/1', score: 300, rank: 0, n: 10, ts: now, native: true, art: { type: 'model', id: 'microsoft/VibeVoice-1.5B', name: 'VibeVoice-1.5B' } },
    { src: 'hackernews', fam: 'community', text: 'VibeVoice: open-source frontier voice', url: 'https://hn/1', score: 400, ts: now },
  ];
  const { top } = analyzeAi({ signals, sourceMap: AI_SOURCE_MAP, ledger: {}, now });
  const v = top.find((t) => t.name === 'VibeVoice');
  assert.ok(v);
  assert.deepEqual(Object.keys(v.fams).sort(), ['community', 'models']);
});

const base = Date.now();
globalThis.fetch = wrapAiMockFetch(makeMockFetch({ base }), { base });
const store = memoryStore();
globalThis.__UNDERCURRENT_STORE__ = store;
const req = (path, init) => new Request(`https://x.test${path}`, init);

test('全 19 媒体のアダプタがモック応答を読める', async () => {
  const reports = await collectAiSignals({ deadline: Date.now() + 5000 });
  assert.equal(reports.length, 19);
  assert.deepEqual(reports.filter((r) => !r.ok).map((r) => `${r.id}:${r.error}`), []);
});

test('api/ai：初回は同期観測し、観測を重ねると勢い・推移・新語が出る', async () => {
  const first = await ai(req('/api/ai'));
  assert.equal(first.status, 200);
  await seedAiHistory({ runAiPipeline, store, base, runs: 10 });
  const body = await (await ai(req('/api/ai'))).json();
  assert.equal(body.schema, 'undercurrent.ai-pulse/1');
  assert.ok(body.top.length >= 15);
  assert.equal(body.top[0].hype, 100);
  assert.ok(body.top[0].breadth >= 3);
  assert.ok(body.top[0].spark.length >= 5);
  assert.ok(body.top[0].ev.length > 0 && body.top[0].facts.length > 0);
  assert.ok(body.top.some((t) => t.kind === 'emerging'), '辞書に無い新語が発見される');
  assert.ok(body.themes.length > 3);
  const models = await (await ai(req('/api/ai?cat=model'))).json();
  assert.ok(models.top.every((t) => t.cat === 'model'));
});

test('api/ai-refresh：GET は 405、直後は 429', async () => {
  assert.equal((await aiRefresh(req('/api/ai-refresh'))).status, 405);
  const latest = await store.get('ai-latest');
  await store.set('ai-latest', { ...latest, generatedAt: Date.now() });
  assert.equal((await aiRefresh(req('/api/ai-refresh', { method: 'POST' }))).status, 429);
});

test('AI 観測も同時実行ロックを尊重する', async () => {
  const isolated = memoryStore({ 'ai-lock': { at: Date.now() } });
  assert.deepEqual(await runAiPipeline({ store: isolated, budgetMs: 1000 }), { skipped: true, reason: 'locked' });
});

test('describe：キーワードに「これは何」「なぜいま」が付く', async () => {
  const body = await (await ai(req('/api/ai'))).json();
  for (const t of body.top.slice(0, 15)) {
    assert.ok(t.about && t.about.length > 8, `about missing: ${t.name}`);
    assert.ok(t.why && /話題/.test(t.why), `why missing: ${t.name}`);
    assert.ok(t.angle, `angle missing: ${t.name}`);
  }
  const opus = body.top.find((t) => t.name === 'Claude Opus 4.5');
  assert.match(opus.about, /Anthropic/);
});

test('allcopy：3 つの観測を項目ごとに詳細まで全部書き出す', async () => {
  const { default: allcopy } = await import('../netlify/functions/allcopy.mjs');
  const { default: legacy } = await import('../netlify/functions/export.mjs');
  const { runPipeline } = await import('../netlify/lib/pipeline.js');
  await runPipeline({ store, budgetMs: 5000, trigger: 'schedule' });
  const j = await (await allcopy(req('/api/allcopy'))).json();
  assert.deepEqual(j.groups.map((g) => g.id), ['radar', 'ai', 'trends', 'lexicon', 'raw', 'history', 'sources']);
  const ai = j.groups.find((g) => g.id === 'ai');
  const snap = await store.get('ai-latest');
  // AI Pulse：ランキング全件が、タップ時の中身（これは何・なぜ・見出し）つきで入る
  assert.ok(ai.items.filter((i) => i.id.startsWith('ai-') && /^ai-\d+$/.test(i.id)).length === snap.top.length);
  const first = ai.items[0].md;
  for (const k of ['これは何: ', 'なぜいま話題: ', '層ごとの熱量: ', '実際に話題になっている見出し:']) assert.ok(first.includes(k), k);
  // SNS トレンド：意味・台帳・媒体・用例まで入る
  const tr = j.groups.find((g) => g.id === 'trends').items[0].md;
  for (const k of ['意味・背景', '台帳: ', '出現した媒体: ', '用例（実際の投稿・見出し）:']) assert.ok(tr.includes(k), k);
  assert.match(tr, /Urban Dictionary|Wikipedia/);
  // 全文 = 見出し + 全グループ
  assert.ok(j.all.startsWith('# Undercurrent × AI Pulse オールコピー'));
  assert.equal(j.chars, j.all.length);
  const md = await allcopy(req('/api/allcopy?format=md'));
  assert.match(md.headers.get('content-type'), /markdown/);
  assert.equal((await md.text()).length, j.all.length);
  assert.equal((await legacy(req('/api/export'))).status, 200);
});
