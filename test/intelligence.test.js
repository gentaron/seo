import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareSignals, isGenericTerm, buildWorldBrief } from '../netlify/lib/intelligence.js';

const NOW = Date.parse('2026-11-18T03:00:00Z');
const signal = (src, text, url, extra = {}) => ({
  src, kind: 'post', text, url, ts: NOW - 3.6e6, score: 10, ...extra,
});

test('GitHubの疑わしいソフトウェア宣伝を隔離し正常情報は保持', () => {
  const input = [
    signal('github', 'free-adobe-activation — Adobe activation with GenP', 'https://github.com/example/free-adobe-activation'),
    signal('github', 'Cyberpunk trainer undetected cheat', 'https://github.com/example/cheat'),
    signal('github', 'A new open source parser for logs', 'https://github.com/example/parser'),
    signal('hatena', '大手サイトにサイバー攻撃が発生したという報道', 'https://example.com/story'),
  ];
  const { clean, rejected } = prepareSignals(input);
  assert.equal(clean.length, 2);
  assert.equal(rejected.filter((r) => r.reason === 'suspicious-distribution').length, 2);
  assert.equal(isGenericTerm('Windows'), true);
  assert.equal(isGenericTerm('NVIDIA'), false);
});

test('同じ媒体の同じURLは重複排除、別媒体からの言及は維持', () => {
  const input = [
    signal('reddit', 'Site outage reported in Europe', 'https://example.com/a?utm_source=one'),
    signal('reddit', 'Site outage reported in Europe', 'https://example.com/a?utm_source=two'),
    signal('hatena', 'Site outage reported in Europe', 'https://example.com/a'),
  ];
  const { clean, rejected } = prepareSignals(input);
  assert.equal(clean.length, 2);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason, 'duplicate');
});

test('社会的重要度とSNSの盛り上がりを分離し真偽未検証を明示', () => {
  const input = [
    signal('reddit', 'CVE-2026-12345 vulnerability reported in widely used library', 'https://example.org/security'),
    signal('hatena', 'CVE-2026-12345 vulnerability reported in widely used library', 'https://example.net/security'),
    signal('bluesky', '#TuneTuesday', 'https://bsky.app/search?q=TuneTuesday', { kind: 'topic' }),
    signal('reddit', 'Stocks slide before NVIDIA earnings report', 'https://example.com/earnings'),
  ];
  const { events } = buildWorldBrief(input, { now: NOW });
  assert.equal(events[0].category, 'security');
  assert.equal(events[0].sourceCount, 2);
  assert.match(events[0].status, /真偽未検証/);
  assert.ok(events.some((e) => e.category === 'markets'));
  assert.ok(!events.some((e) => /TuneTuesday/.test(e.title)));
  assert.match(events.find((e) => e.category === 'markets').caution, /一次情報/);
});

test('古い見出しとGitHub宣伝は情勢ニュースに混ぜない', () => {
  const input = [
    signal('hatena', 'Major infrastructure outage in city', 'https://example.org/old', { ts: NOW - 80 * 3.6e6 }),
    signal('github', 'CVE-2026-12345 exploit demo', 'https://github.com/example/demo'),
  ];
  assert.equal(buildWorldBrief(input, { now: NOW }).events.length, 0);
});
