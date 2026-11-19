import test from 'node:test';
import assert from 'node:assert/strict';
import { memoryStore } from '../netlify/lib/store.js';
import unified, { qaizFeedUrl, UNIFIED_SCHEMA } from '../netlify/functions/unified.mjs';

const store = memoryStore();
globalThis.__UNDERCURRENT_STORE__ = store;
const request = () => new Request('https://example.com/api/unified');

test('bridge validates configured host instead of accepting user-supplied fetch targets', () => {
  assert.equal(qaizFeedUrl('http://qaiz.example.org'), null);
  assert.equal(qaizFeedUrl('https://127.0.0.1'), null);
  assert.equal(qaizFeedUrl('https://localhost'), null);
  assert.equal(qaizFeedUrl('https://qaiz.example.org:8787'), null);
  assert.equal(qaizFeedUrl('https://qaiz.example.org/dashboard'), 'https://qaiz.example.org/api/feed');
});

test('bridge retains separately labeled observations when QAIZ is not configured', async () => {
  process.env.QAIZ_PUBLIC_URL = 'disabled';
  const ts = Date.parse('2026-11-19T00:00:00Z');
  await store.set('latest', {
    generatedAt: ts, stats: { sourcesUp: 9, sourcesTotal: 14 },
    analysis: { events: [{ title: 'A reported outage', impact: 92, evidence: [] }] },
  });
  const res = await unified(request());
  assert.equal(res.status, 200);
  const b = await res.json();
  assert.equal(b.schema, UNIFIED_SCHEMA);
  assert.equal(b.qaiz.status, 'not-configured');
  assert.equal(b.undercurrent.verificationStatus, 'unverified');
  assert.equal(b.inferenceStatus, 'not-evaluated');
  assert.deepEqual(b.jointSignals, []);
  delete process.env.QAIZ_PUBLIC_URL;
});

test('bridge reads only observed, evidenced QAIZ feed items', async () => {
  process.env.QAIZ_PUBLIC_URL = 'https://qaiz.example.org';
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.equal(url, 'https://qaiz.example.org/api/feed');
    return new Response(JSON.stringify({ schema: 'gentaron.feed/1', generatedAt: '2026-11-19T00:00:00Z', items: [
      { evidence: 'observed', url: 'https://qaiz.example.org/api/regime', title: 'Observed regime' },
      { evidence: 'draft', url: 'https://qaiz.example.org/research', title: 'Draft hypothesis' },
    ] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const b = await (await unified(request())).json();
    assert.equal(b.qaiz.status, 'ok');
    assert.deepEqual(b.qaiz.feed.items.map((x) => x.title), ['Observed regime']);
  } finally {
    globalThis.fetch = oldFetch;
    delete process.env.QAIZ_PUBLIC_URL;
  }
});


test('production bridge defaults to public QAIZ URL when Netlify env is unset', async () => {
  delete process.env.QAIZ_PUBLIC_URL;
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.equal(url, 'https://qaiz.gen5wx.workers.dev/api/feed');
    return new Response(JSON.stringify({ schema: 'gentaron.feed/1', generatedAt: '2026-11-19T00:00:00Z', items: [
      { evidence: 'observed', url: 'https://qaiz.gen5wx.workers.dev/api/regime', title: 'Observed market regime' },
    ] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const res = await unified(request());
    assert.equal(res.status, 200);
    const b = await res.json();
    assert.equal(b.qaiz.status, 'ok');
    assert.equal(b.qaiz.feed.items.length, 1);
    assert.equal(b.inferenceStatus, 'not-evaluated');
  } finally {
    globalThis.fetch = oldFetch;
  }
});
