import test from 'node:test';
import assert from 'node:assert/strict';

import suggest from '../netlify/functions/suggest.mjs';
import health from '../netlify/functions/health.mjs';
import related from '../netlify/functions/related.mjs';
import trends from '../netlify/functions/trends.mjs';

/** 外部APIを叩かずにハンドラを検証するためのスタブ */
function stubFetch(impl) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return () => {
    globalThis.fetch = original;
  };
}

const okSuggest = async (url) => {
  const u = String(url);
  const q = decodeURIComponent((u.match(/[?&](?:q|query|prefix|p)=([^&]*)/) || [])[1] || 'x');
  return new Response(JSON.stringify([q, [`${q} おすすめ`, `${q} 比較`]]), { status: 200 });
};

const req = (url, init) => new Request(url, init);

test('suggest: POST で複数エンジンの結果をまとめて返す', async () => {
  const restore = stubFetch(okSuggest);
  try {
    const res = await suggest(
      req('https://example.com/api/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-nf-client-connection-ip': '1.1.1.1' },
        body: JSON.stringify({ queries: ['転職', '転職 あ'], engines: ['google', 'bing'] }),
      }),
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.queryCount, 2);
    assert.deepEqual(body.engines, ['google', 'bing']);
    assert.equal(body.results.length, 4); // 2クエリ × 2エンジン
    assert.ok(body.results[0].suggestions.length > 0);
  } finally {
    restore();
  }
});

test('suggest: GET はサーバ側で掛け合わせを展開する', async () => {
  const restore = stubFetch(okSuggest);
  try {
    const res = await suggest(
      req('https://example.com/api/suggest?q=%E8%BB%A2%E8%81%B7&modes=base,question&engines=google', {
        headers: { 'x-nf-client-connection-ip': '2.2.2.2' },
      }),
    );
    const body = await res.json();
    assert.ok(body.queryCount > 5);
    assert.ok(body.results.every((r) => r.engine === 'google'));
  } finally {
    restore();
  }
});

test('suggest: クエリが無ければ 400', async () => {
  const res = await suggest(req('https://example.com/api/suggest'));
  assert.equal(res.status, 400);
});

test('suggest: 不正な JSON は 400 を返す', async () => {
  const res = await suggest(
    req('https://example.com/api/suggest', { method: 'POST', body: '{壊れた' }),
  );
  assert.equal(res.status, 400);
});

test('suggest: 一部のエンジンが落ちても部分成功で返す', async () => {
  const restore = stubFetch(async (url) => {
    if (String(url).includes('bing.com')) throw new Error('down');
    return okSuggest(url);
  });
  try {
    const res = await suggest(
      req('https://example.com/api/suggest', {
        method: 'POST',
        headers: { 'x-nf-client-connection-ip': '3.3.3.3' },
        // 他テストのキャッシュに影響されないよう固有のクエリを使う
        body: JSON.stringify({ queries: ['部分成功テスト'], engines: ['google', 'bing'] }),
      }),
    );
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.stats.google.ok, 1);
    assert.equal(body.stats.bing.failed, 1);
    assert.equal(body.results.length, 1);
    assert.ok(body.failures.length >= 1);
  } finally {
    restore();
  }
});

test('suggest: OPTIONS はプリフライトに 204 を返す', async () => {
  const res = await suggest(req('https://example.com/api/suggest', { method: 'OPTIONS' }));
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
});

test('suggest: 未知のエンジン指定は既定エンジンにフォールバックする', async () => {
  const restore = stubFetch(okSuggest);
  try {
    const res = await suggest(
      req('https://example.com/api/suggest', {
        method: 'POST',
        headers: { 'x-nf-client-connection-ip': '4.4.4.4' },
        body: JSON.stringify({ queries: ['フォールバックテスト'], engines: ['nonexistent'] }),
      }),
    );
    const body = await res.json();
    assert.deepEqual(body.engines, ['google']);
  } finally {
    restore();
  }
});

test('health: 各エンジンの疎通結果を返す', async () => {
  const restore = stubFetch(okSuggest);
  try {
    const res = await health(req('https://example.com/api/health?q=%E3%83%A9%E3%83%BC%E3%83%A1%E3%83%B3'));
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.total, body.engines.length);
    assert.ok(body.engines.every((e) => typeof e.ms === 'number'));
  } finally {
    restore();
  }
});

test('related: Wikipedia の要約とリンクを返す', async () => {
  const restore = stubFetch(async (url) => {
    const u = String(url);
    if (u.includes('opensearch')) {
      return new Response(JSON.stringify(['SEO', ['SEO'], [''], ['https://ja.wikipedia.org/wiki/SEO']]), { status: 200 });
    }
    if (u.includes('rest_v1')) {
      return new Response(JSON.stringify({ title: 'SEO', extract: '検索エンジン最適化。', content_urls: { desktop: { page: 'https://ja.wikipedia.org/wiki/SEO' } } }), { status: 200 });
    }
    return new Response(JSON.stringify({ query: { pages: { 1: { links: [{ title: '検索エンジン' }] } } } }), { status: 200 });
  });
  try {
    const res = await related(req('https://example.com/api/related?q=SEO'));
    const body = await res.json();
    assert.equal(body.found, true);
    assert.equal(body.summary.extract, '検索エンジン最適化。');
    assert.deepEqual(body.links, ['検索エンジン']);
  } finally {
    restore();
  }
});

test('related: q が無ければ 400', async () => {
  const res = await related(req('https://example.com/api/related'));
  assert.equal(res.status, 400);
});

test('trends: XSSI プレフィックス付きのレスポンスを解釈する', async () => {
  const restore = stubFetch(async () => {
    const payload = {
      default: {
        trendingSearchesDays: [
          {
            formattedDate: '9月8日',
            trendingSearches: [
              { title: { query: '新NISA' }, formattedTraffic: '20万+', relatedQueries: [{ query: '新NISA 出口' }], articles: [{ title: 'x', url: 'https://e.com', source: 's' }] },
            ],
          },
        ],
      },
    };
    return new Response(`)]}',\n${JSON.stringify(payload)}`, { status: 200 });
  });
  try {
    const res = await trends(req('https://example.com/api/trends'));
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.items[0].query, '新NISA');
    assert.equal(body.items[0].traffic, '20万+');
  } finally {
    restore();
  }
});
