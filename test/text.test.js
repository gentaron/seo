import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalize,
  keyOf,
  tokenize,
  cooccurrence,
  scoreOf,
  kanaRow,
  katakanaToHiragana,
  groupLabel,
  toDelimited,
} from '../public/shared/text.js';

test('normalize: NFKC 正規化と空白の畳み込み', () => {
  assert.equal(normalize('ＳＥＯ　対策'), 'SEO 対策');
  assert.equal(keyOf('SEO  対策'), 'seo 対策');
});

test('tokenize: 文字種の切り替わりで語を切り出す', () => {
  assert.deepEqual(tokenize('転職エージェント おすすめ'), ['転職', 'エージェント', 'おすすめ']);
});

test('tokenize: 数値＋助数詞を1語として扱う', () => {
  assert.ok(tokenize('おすすめ 20代 5選').includes('20代'));
  assert.ok(tokenize('おすすめ 20代 5選').includes('5選'));
});

test('tokenize: 助詞や短いひらがなは落とす', () => {
  const t = tokenize('転職 とは その から');
  assert.deepEqual(t, ['転職']);
});

test('cooccurrence: 元キーワードを除いた頻出語を返す', () => {
  const phrases = ['転職 エージェント おすすめ', '転職 エージェント 比較', '転職 サイト おすすめ'];
  const result = cooccurrence(phrases, '転職', 10);
  assert.equal(result[0].count, 2);
  assert.ok(!result.some((r) => r.word === '転職'));
});

test('scoreOf: 出現数・媒体数・順位が高いほどスコアが高い', () => {
  const ctx = { maxHits: 10, engineCount: 3 };
  const strong = scoreOf({ hits: 10, engines: 3, bestRank: 0 }, ctx);
  const weak = scoreOf({ hits: 1, engines: 1, bestRank: 9 }, ctx);
  assert.ok(strong > weak);
  assert.ok(strong <= 100 && weak >= 1);
});

test('scoreOf: 単一エンジン運用でも減点されない', () => {
  const s = scoreOf({ hits: 5, engines: 1, bestRank: 0 }, { maxHits: 5, engineCount: 1 });
  assert.equal(s, 100);
});

test('kanaRow / katakanaToHiragana', () => {
  assert.equal(kanaRow('が'), 'か行');
  assert.equal(kanaRow('ガ'), 'か行');
  assert.equal(kanaRow('A'), null);
  assert.equal(katakanaToHiragana('エージェント'), 'えーじぇんと');
});

test('groupLabel: 元キーワードの直後の語でまとめる', () => {
  assert.equal(groupLabel('転職 エージェント 比較', '転職'), 'エージェント');
  assert.equal(groupLabel('転職', '転職'), '完全一致');
});

test('toDelimited: CSV のエスケープと BOM', () => {
  const csv = toDelimited([{ a: 'あ,い', b: 1 }], [{ key: 'a', label: '語' }, { key: 'b', label: '数' }]);
  assert.ok(csv.startsWith('﻿'));
  assert.ok(csv.includes('"あ,い"'));
  const tsv = toDelimited([{ a: 'あ\tい' }], [{ key: 'a', label: '語' }], '\t');
  assert.ok(!tsv.split('\r\n')[1].includes('\t\t'));
});
