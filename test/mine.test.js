import test from 'node:test';
import assert from 'node:assert/strict';
import { mineJapanese, mineEnglish, mineCandidates } from '../netlify/lib/mine.js';

test('日本語：造語の複合語を再結合して拾う', () => {
  const got = mineJapanese('推し活界隈で蛙化現象がエモすぎてヤバみ').map((x) => x.t);
  for (const w of ['推し活', '蛙化現象', 'ヤバみ']) assert.ok(got.includes(w), `${w} が無い: ${got}`);
  assert.ok(!got.includes('で'));
});

test('日本語：カタカナ語の途中では切らない', () => {
  const got = mineJapanese('ラーメンタイムラインの話').map((x) => x.t);
  assert.ok(!got.includes('ライン'));
});

test('英語：固有名詞の連続と n-gram', () => {
  const got = mineEnglish('my friend keeps doing the Skibidi Toilet dance').map((x) => x.t);
  assert.ok(got.includes('Skibidi Toilet'));
  assert.ok(!got.includes('the'));
});

test('候補集計：明示語・表記ゆれ統合・包含の間引き', () => {
  const sigs = [
    { src: 'mastodon', kind: 'tag', text: '#aurafarming', terms: [{ t: 'aurafarming', w: 1 }] },
    { src: 'reddit', kind: 'post', text: 'Why is aura farming everywhere' },
    { src: 'reddit', kind: 'post', text: 'aura farming at school lol' },
  ];
  const c = mineCandidates(sigs);
  const af = c.get('aurafarming');
  assert.ok(af, 'aura farming が統合されていない');
  assert.equal(af.hits.length, 3);
  assert.equal(af.display, 'aura farming');
  assert.ok(!c.has('farming'), '包含される短い語が残っている');
});
