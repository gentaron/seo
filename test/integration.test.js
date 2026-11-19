import test from 'node:test';
import assert from 'node:assert/strict';
import { memoryStore } from '../netlify/lib/store.js';
import intelligence, { INTELLIGENCE_SCHEMA } from '../netlify/functions/intelligence.mjs';

const store = memoryStore();
globalThis.__UNDERCURRENT_STORE__ = store;
const req = (method = 'GET', path = '/api/intelligence') => new Request('https://undercurrent.test' + path, { method });

test('intelligence export is read-only and refuses missing snapshots', async () => {
  assert.equal((await intelligence(req('POST'))).status, 405);
  assert.equal((await intelligence(req())).status, 503);
});

test('intelligence export retains provenance and never markets risk as verified', async () => {
  const ts = Date.parse('2026-11-19T00:00:00Z');
  await store.set('latest', {
    generatedAt: ts,
    stats: { sourcesUp: 11, sourcesTotal: 14, usableSignals: 495, excludedSignals: 20 },
    analysis: { events: [{
      id: 'uc-00000001', title: 'A reported outage', category: 'infrastructure',
      impact: 92, at: ts - 1000, evidence: [{source: 'hatena', url: 'https://example.com/1', ts: ts - 1000}],
      verificationStatus: 'unverified',
    }] },
  });
  const res = await intelligence(req());
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.schema, INTELLIGENCE_SCHEMA);
  assert.equal(body.sourceCoverage.signals, 495);
  assert.equal(body.events[0].verificationStatus, 'unverified');
  assert.equal(body.events[0].availableAt, '2026-11-19T00:00:00.000Z');
  assert.equal(body.events[0].metricType, 'editorial-impact-heuristic');
  assert.deepEqual(body.events[0].evidence.map((e) => e.url), ['https://example.com/1']);
  assert.ok(!('predictedReturn' in body.events[0]));
});
