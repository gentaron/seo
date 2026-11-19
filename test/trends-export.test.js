import test from 'node:test';
import assert from 'node:assert/strict';
import { memoryStore } from '../netlify/lib/store.js';
import intelligence from '../netlify/functions/intelligence.mjs';

const store = memoryStore();
globalThis.__UNDERCURRENT_STORE__ = store;
const now = Date.parse('2026-11-19T03:00:00Z');

test('世界情勢APIに新語トレンドも付け、相対スコアを市場と混同しない', async () => {
  await store.set('latest', {
    generatedAt: now,
    analysis: { events: [{ id: 'uc-1234', title: 'An event', sourceCount: 1 }] },
    stats: { sourcesUp: 11, sourcesTotal: 14, usableSignals: 300, excludedSignals: 10 },
    terms: [
      { k: 'aurafarming', t: 'aura farming', lang: 'en', cat: 'meme', score: 100, vel: 2.3, spread: 3,
        srcs: ['reddit', 'bluesky', 'mastodon'], status: 'surge', first: now - 3600_000 },
      { k: 'つよい', t: 'つよい', lang: 'ja', cat: 'slang', score: 52, vel: 0.2, spread: 1,
        srcs: ['misskey'], status: 'new', first: now - 3600_000 },
    ],
  });
  const response = await intelligence(new Request('https://site.example/api/intelligence'));
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.schema, 'gentaron.world-events/1');
  assert.equal(data.trendMetric, 'within-run-relative-score-0-to-100-not-probability');
  assert.equal(data.trends[0].term, 'aura farming');
  assert.equal(data.trends[0].trendScore, 100);
  assert.equal(data.trends[0].sourceCount, 3);
  assert.equal(data.trends[0].availableAt, new Date(now).toISOString());
  assert.equal(data.events[0].verificationStatus, 'unverified');
  assert.equal(data.trends.length, 2);
});

test('トレンド50件上限と欠損除外を守る', async () => {
  const snapshot = await store.get('latest');
  await store.set('latest', {
    ...snapshot,
    terms: Array.from({ length: 80 }, (_, i) => ({ k: 'trend-' + i, t: 'trend ' + i, score: i })),
  });
  const data = await (await intelligence(new Request('https://site.example/api/intelligence'))).json();
  assert.equal(data.trends.length, 50);
});
