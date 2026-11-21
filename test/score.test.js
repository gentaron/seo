import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreRun, halfLife, lifeStage, pruneLexicon } from '../netlify/lib/score.js';
import { mineCandidates } from '../netlify/lib/mine.js';
import { SOURCE_MAP } from '../netlify/lib/sources.js';

const H = 3.6e6;
const sig = (src, text, extra = {}) => ({ src, kind: 'topic', text, terms: [{ t: text, w: 1 }], score: 10, ts: Date.now(), ...extra });

test('新語は new、伸びた語は surge、主流だけの語は減点', () => {
  const now = Date.now();
  const signals = [
    sig('misskey', 'ぱおん'),
    sig('bluesky', 'ぱおん'),
    sig('urbandictionary', 'clanker'),
    sig('reddit', 'clanker', { url: 'https://reddit.com/r/a/1' }),
    sig('bluesky', 'clanker', { url: 'https://bsky.app/x/1' }),
    sig('googletrends', 'Election', { mainstream: true }),
    sig('wikipedia', 'Election', { mainstream: true }),
  ];
  const lexicon = { clanker: { k: 'clanker', t: 'clanker', first: now - 48 * H, last: now - 3 * H, ema: 0.1, peak: 10, runs: 5, hist: [], samples: [], srcs: {} } };
  const { terms, lexicon: next } = scoreRun({ signals, candidates: mineCandidates(signals), sourceMap: SOURCE_MAP, lexicon, now });
  const by = Object.fromEntries(terms.map((t) => [t.k, t]));
  assert.equal(by['ぱおん'].status, 'new');
  assert.ok(by.clanker.badges.includes('surge'));
  assert.equal(by.clanker.dir, 'rising');
  assert.equal(by['ぱおん'].dir, 'new');
  assert.ok(by.election.score < by['ぱおん'].score);
  assert.equal(next.clanker.runs, 6);
  assert.equal(terms[0].score, 100);
});

test('halfLife：減衰しているときだけ推定する', () => {
  assert.equal(halfLife([[0, 1], [3 * H, 2]]), null);
  assert.equal(halfLife([[0, 4], [3 * H, 2]]), 3);
});

test('lifeStage と台帳の剪定', () => {
  const now = Date.now();
  assert.equal(lifeStage({ first: now - H, last: now }, now), 'newborn');
  assert.equal(lifeStage({ first: now - 99 * H, last: now - 80 * H }, now), 'dead');
  const lex = { a: { k: 'a', last: now - 40 * 864e5, peak: 10 }, b: { k: 'b', last: now, peak: 1 } };
  assert.deepEqual(Object.keys(pruneLexicon(lex, now)), ['b']);
});
