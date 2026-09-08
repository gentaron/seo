import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildQueries,
  chunk,
  normalizeKeyword,
  yearTokens,
  MODES,
  MODE_IDS,
  DEFAULT_MODES,
  GOJUON,
} from '../public/shared/expand.js';

test('normalizeKeyword: 全角スペースと連続スペースを畳む', () => {
  assert.equal(normalizeKeyword('　転職　　エージェント '), '転職 エージェント');
  assert.equal(normalizeKeyword(null), '');
});

test('buildQueries: base のみなら元キーワード1件', () => {
  assert.deepEqual(buildQueries('転職', ['base']), ['転職']);
});

test('buildQueries: 五十音は46行ぶんの掛け合わせを生成する', () => {
  const q = buildQueries('転職', ['gojuon']);
  assert.equal(q.length, GOJUON.length);
  assert.equal(q[0], '転職 あ');
  assert.equal(q.at(-1), '転職 ん');
});

test('buildQueries: 重複は排除され順序は安定する', () => {
  const q = buildQueries('転職', ['base', 'base', 'gojuon']);
  assert.equal(new Set(q).size, q.length);
  assert.equal(q[0], '転職');
});

test('buildQueries: 空文字なら何も作らない', () => {
  assert.deepEqual(buildQueries('   ', MODE_IDS), []);
});

test('buildQueries: 未知のモードは無視され、空指定は既定モードになる', () => {
  assert.deepEqual(buildQueries('転職', ['unknown']), []);
  assert.deepEqual(buildQueries('転職', []), buildQueries('転職', DEFAULT_MODES));
});

test('全モードでも現実的なクエリ数に収まる', () => {
  const q = buildQueries('転職エージェント', MODE_IDS);
  assert.ok(q.length > 150, `想定より少ない: ${q.length}`);
  assert.ok(q.length < 320, `想定より多い: ${q.length}`);
});

test('MODES: すべて id / label / build を備える', () => {
  for (const m of MODES) {
    assert.equal(typeof m.id, 'string');
    assert.equal(typeof m.label, 'string');
    assert.equal(typeof m.build, 'function');
    assert.ok(Array.isArray(m.build('テスト')));
  }
});

test('yearTokens: 前年・当年・翌年を含む', () => {
  const t = yearTokens(2026);
  assert.ok(t.includes('2025') && t.includes('2026') && t.includes('2027'));
});

test('chunk: 端数を含めて分割する', () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunk([], 3), []);
  assert.deepEqual(chunk([1], 0), [[1]]);
});
