import test from 'node:test';
import assert from 'node:assert/strict';
import { termKey, detectLang, slangness, isPlausibleTerm, stripHtml } from '../netlify/lib/text.js';
import { parseFeed } from '../netlify/lib/feedparse.js';

test('termKey: 表記ゆれを同じキーに寄せる', () => {
  assert.equal(termKey('Aura Farming'), termKey('#aurafarming'));
  assert.equal(termKey('aura-farming'), 'aurafarming');
  assert.equal(termKey('ＡＩ絵師'), 'ai絵師');
});

test('detectLang', () => {
  assert.equal(detectLang('チー牛構文'), 'ja');
  assert.equal(detectLang('rizz'), 'en');
});

test('slangness: 造語っぽい形は高く、一般語は低い', () => {
  assert.ok(slangness('looksmaxxing') >= 0.4);
  assert.ok(slangness('チー牛構文') >= 0.4);
  assert.ok(slangness('ヤバみ') >= 0.3);
  assert.ok(slangness('government') < 0.2);
  assert.ok(slangness('政府') < 0.2);
});

test('isPlausibleTerm: ノイズを弾く', () => {
  assert.equal(isPlausibleTerm('the'), false);
  assert.equal(isPlausibleTerm('2026'), false);
  assert.equal(isPlausibleTerm('https://x.com'), false);
  assert.equal(isPlausibleTerm('reddit'), false);
  assert.equal(isPlausibleTerm('aura farming'), true);
});

test('stripHtml と RSS/RDF/Atom の読み取り', () => {
  assert.equal(stripHtml('<b>a&amp;b</b> &#x3042;'), 'a&b あ');
  const rss = '<rss><channel><item><title><![CDATA[Hello]]></title><link>https://a</link><ht:approx_traffic>200+</ht:approx_traffic></item></channel></rss>';
  const [i] = parseFeed(rss, ['ht:approx_traffic']);
  assert.equal(i.title, 'Hello');
  assert.equal(i.extra['ht:approx_traffic'], '200+');
  const rdf = '<rdf:RDF><item rdf:about="https://b"><title>T</title><hatena:bookmarkcount>12</hatena:bookmarkcount></item></rdf:RDF>';
  assert.equal(parseFeed(rdf)[0].link, 'https://b');
  const atom = '<feed><entry><title>A</title><link href="https://c"/></entry></feed>';
  assert.equal(parseFeed(atom)[0].link, 'https://c');
});
