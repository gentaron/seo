import test from 'node:test';
import assert from 'node:assert/strict';

import { ENGINES, ENGINE_IDS, engineCatalog, resolveEngine, fetchSuggest } from '../netlify/lib/engines.js';
import { ENGINE_META } from '../public/shared/engines-meta.js';
import { pool, TTLCache, RateLimiter, parseGuardedJson } from '../netlify/lib/http.js';

test('エンジン定義とメタ情報の id が一致する', () => {
  const metaIds = ENGINE_META.map((e) => e.id).sort();
  assert.deepEqual([...ENGINE_IDS].sort(), metaIds);
  for (const e of engineCatalog()) {
    assert.equal(typeof e.label, 'string');
    assert.match(e.accent, /^#[0-9a-f]{6}$/i);
  }
});

test('Google: OpenSearch 形式をパースする', () => {
  const body = JSON.stringify(['転職', ['転職 エージェント', '転職 サイト']]);
  assert.deepEqual(ENGINES.google.parse(body), ['転職 エージェント', '転職 サイト']);
});

test('Google: chrome クライアント形式（入れ子配列）にも耐える', () => {
  const body = JSON.stringify(['転職', [['転職 20代'], ['転職 30代']]]);
  assert.deepEqual(ENGINES.google.parse(body), ['転職 20代', '転職 30代']);
});

test('DuckDuckGo: phrase キーの配列をパースする', () => {
  assert.deepEqual(ENGINES.duckduckgo.parse(JSON.stringify([{ phrase: '転職 20代' }])), ['転職 20代']);
});

test('Amazon: suggestions[].value をパースする', () => {
  assert.deepEqual(ENGINES.amazon.parse(JSON.stringify({ suggestions: [{ value: '転職 本' }] })), ['転職 本']);
});

test('Yahoo: Result[].Query をパースする', () => {
  assert.deepEqual(ENGINES.yahoo.parse(JSON.stringify({ Result: [{ Query: '転職 求人' }] })), ['転職 求人']);
});

test('未知のエンジンは解決できない', () => {
  assert.equal(resolveEngine('unknown'), null);
});

test('fetchSuggest: 1つ目のURLが落ちても次の候補で回復する', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) throw new Error('boom');
    return new Response(JSON.stringify(['転職', ['転職 エージェント  ', '']]), { status: 200 });
  };
  try {
    const list = await fetchSuggest('google', '転職', { timeout: 500 });
    assert.deepEqual(list, ['転職 エージェント']); // 空文字は除去、空白は正規化
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = original;
  }
});

test('fetchSuggest: すべて失敗したら例外を投げる', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('offline');
  };
  try {
    await assert.rejects(() => fetchSuggest('bing', '転職', { timeout: 200 }));
  } finally {
    globalThis.fetch = original;
  }
});

test('pool: 同時実行を制限しつつ失敗を握りつぶさない', async () => {
  let running = 0;
  let peak = 0;
  const results = await pool([1, 2, 3, 4, 5, 6], 2, async (n) => {
    running += 1;
    peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, 5));
    running -= 1;
    if (n === 3) throw new Error('ng');
    return n;
  });
  assert.ok(peak <= 2);
  assert.equal(results.filter((r) => r.status === 'rejected').length, 1);
});

test('TTLCache: 期限切れは取り出せない', async () => {
  const cache = new TTLCache(10, 10);
  cache.set('a', 1);
  assert.equal(cache.get('a'), 1);
  await new Promise((r) => setTimeout(r, 25));
  assert.equal(cache.get('a'), undefined);
});

test('RateLimiter: 容量を超えると拒否する', () => {
  const rl = new RateLimiter(2, 0);
  assert.equal(rl.take('ip'), true);
  assert.equal(rl.take('ip'), true);
  assert.equal(rl.take('ip'), false);
  assert.equal(rl.take('other'), true);
});

test('parseGuardedJson: XSSI プレフィックスを剥がす', () => {
  assert.deepEqual(parseGuardedJson(")]}',\n{\"a\":1}"), { a: 1 });
  assert.deepEqual(parseGuardedJson('[1,2]'), [1, 2]);
});
