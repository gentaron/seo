import test from 'node:test';
import assert from 'node:assert/strict';
import { makeMockFetch, seedHistory } from '../scripts/mock-web.mjs';
import { memoryStore } from '../netlify/lib/store.js';
import { runPipeline, collectSignals } from '../netlify/lib/pipeline.js';
import feed from '../netlify/functions/feed.mjs';
import term from '../netlify/functions/term.mjs';
import lexicon from '../netlify/functions/lexicon.mjs';
import refresh from '../netlify/functions/refresh.mjs';
import rss from '../netlify/functions/rss.mjs';
import history from '../netlify/functions/history.mjs';

const base = Date.now();
globalThis.fetch = makeMockFetch({ base });
const store = memoryStore();
globalThis.__UNDERCURRENT_STORE__ = store;
const req = (path, init) => new Request(`https://x.test${path}`, init);

test('全媒体のアダプタがモック応答を読める', async () => {
  const reports = await collectSignals({ deadline: Date.now() + 5000 });
  const bad = reports.filter((r) => !r.ok).map((r) => `${r.id}:${r.error}`);
  assert.deepEqual(bad, []);
});

test('feed：スナップショットが無ければ初回観測して返す', async () => {
  const res = await feed(req('/api/feed'));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.terms.length > 5);
  assert.equal(body.v, 2);
  assert.ok(Array.isArray(body.analysis.events));
  assert.equal(body.stats.sourcesUp, 14);
});

test('観測を重ねると推移と大全ができる', async () => {
  await seedHistory({ runPipeline, store, base, runs: 5 });
  const body = await (await feed(req('/api/feed?lang=ja'))).json();
  assert.ok(body.terms.every((t) => t.lang === 'ja'));
  const k = body.terms[0].k;
  const detail = await (await term(req(`/api/term?k=${encodeURIComponent(k)}`))).json();
  assert.ok(detail.entry.hist.length >= 2);
  const lex = await (await lexicon(req('/api/lexicon?q=構文'))).json();
  assert.ok(lex.rows.length >= 1);
  const bytes = new Uint8Array(await (await lexicon(req('/api/lexicon?format=csv'))).arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf]); // Excel 用 BOM
  const h = await (await history(req('/api/history'))).json();
  assert.ok(h.history.length >= 5);
});

test('refresh：クールダウン中は 429、GET は 405', async () => {
  assert.equal((await refresh(req('/api/refresh'))).status, 405);
  await store.set('meta', { ...(await store.get('meta')), lastRunAt: Date.now() });
  assert.equal((await refresh(req('/api/refresh', { method: 'POST' }))).status, 429);
});

test('rss：RSS 2.0 を返す', async () => {
  const res = await rss(req('/api/rss'));
  const xml = await res.text();
  assert.match(res.headers.get('content-type'), /rss\+xml/);
  assert.ok(xml.includes('<item>'));
});

test('term：台帳に無い語は 404', async () => {
  assert.equal((await term(req('/api/term?k=zzzznotaword'))).status, 404);
});
