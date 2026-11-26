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


test('別々のCVEは見出しが似ていても同じ事件にしない', () => {
  const input = [
    signal('hatena', 'NGINX CVE-2026-123007 vulnerability detected in HTTP2 parser', 'https://example.com/nginx-1'),
    signal('hatena', 'NGINX CVE-2026-123633 vulnerability detected in HTTP2 parser', 'https://example.com/nginx-2'),
  ];
  const result = buildWorldBrief(input, { now: NOW });
  assert.equal(result.events.length, 2);
  assert.ok(result.events.every((e) => e.verificationStatus === 'unverified'));
  assert.ok(result.events.every((e) => e.id.startsWith('uc-')));
});

test('GitHubのチート関連語を配布宣伝として除外し報道記事は残す', () => {
  const input = [
    signal('github', 'ROB-RUN-Aim-WH-Hacks — Wallhack ESP tools', 'https://github.com/example/rob-run-aimbot'),
    signal('github', 'ROB RUN mod menu free download', 'https://github.com/example/rob-run-mod'),
    signal('hatena', 'Security researchers investigate game cheat malware', 'https://example.com/report'),
  ];
  const { clean, rejected } = prepareSignals(input);
  assert.equal(clean.length, 1);
  assert.equal(rejected.length, 2);
});

test('低注目・高影響を優先し不明な注目度をゼロと見なさない', () => {
  const input = [
    signal('github', 'grh-lean — A short Lean 4 proof of the Generalized Riemann Hypothesis', 'https://github.com/example/grh-lean'),
    signal('lemmy', 'SpaceX wins FCC approval for orbital data center satellites', 'https://example.org/orbit'),
    signal('hatena', '1Passwordへの不正アクセスについてまとめてみた', 'https://example.net/password'),
    signal('bluesky', 'UK net migration falls to 77,000', 'https://example.net/migration'),
    signal('world_cisa', 'Critical vulnerability actively exploited in network infrastructure', 'https://example.net/cisa'),
    signal('misskey', 'いい風呂の日', 'https://example.net/bath'),
    signal('googletrends', 'report power outage', 'https://example.net/search'),
    signal('lemmy', 'When self-driving vehicles become mainstream, dead old people will occasionally just show up at their destinations.', 'https://example.net/joke'),
    signal('world_arxiv_ai', 'A new AI model for routine document classification', 'https://example.net/routine'),
    signal('hatena', 'New York bans talking AI stuffed animals and dolls for five years', 'https://example.net/dolls'),
  ];
  const terms = [16, 35, 74, 38].map((score,i) => ({ score, samples:[{ u:input[i].url, ts:input[i].ts }] }));
  const { events, stats } = buildWorldBrief(input,{now:NOW,terms});
  assert.equal(events.length,5);
  assert.equal(events[0].priorityBand,'hidden');
  assert.ok(events.find(e=>e.title.includes('Riemann')).caution.includes('未確認'));
  assert.equal(events.find(e=>e.title.includes('1Password')).priorityBand,'major');
  assert.equal(events.find(e=>e.title.includes('Critical vulnerability')).attention,null);
  assert.equal(events.find(e=>e.title.includes('Critical vulnerability')).priorityBand,'unknown-attention');
  assert.equal(stats.hidden,3);
  assert.ok(events.every(e=>e.verificationStatus==='unverified'));
});

test('媒体数を増やしても推定影響度を水増ししない', () => {
  const a = signal('hatena','Critical vulnerability in widely used software','https://example.net/cve');
  const b = {...a,src:'reddit'};
  const one = buildWorldBrief([a],{now:NOW}).events[0];
  const two = buildWorldBrief([a,b],{now:NOW}).events[0];
  assert.equal(one.impact,two.impact);
  assert.equal(two.sourceCount,2);
});

test('同じ事象の複数トレンド断片を加算しない', () => {
  const a = signal('github','grh-lean — A short Lean 4 proof of the Generalized Riemann Hypothesis','https://github.com/example/grh');
  const terms = [16,13,10,9].map(score=>({score,samples:[{u:a.url,ts:a.ts}]}));
  const {events} = buildWorldBrief([a],{now:NOW,terms});
  assert.equal(events.length,1);
  assert.equal(events[0].attention,16);
});
