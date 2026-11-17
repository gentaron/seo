/**
 * feedparse.js — RSS 2.0 / RSS 1.0(RDF) / Atom を正規表現で読む極小パーサ
 * 依存ゼロ。完全な XML パーサではないが、トレンド系フィードの読み取りには十分。
 */

import { stripHtml } from './text.js';

function tag(block, name) {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i');
  const m = block.match(re);
  return m ? stripHtml(m[1]) : '';
}

function attr(block, name, attrName) {
  const re = new RegExp(`<${name}\\b[^>]*\\b${attrName}=["']([^"']+)["'][^>]*/?>`, 'i');
  const m = block.match(re);
  return m ? m[1] : '';
}

/**
 * @param {string} xml
 * @param {string[]} [extra] 追加で拾いたい要素名（例: 'ht:approx_traffic'）
 * @returns {Array<{title:string, link:string, date:string, description:string, extra:Record<string,string>, raw:string}>}
 */
export function parseFeed(xml, extra = []) {
  const text = String(xml ?? '');
  const blocks = text.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) || [];
  return blocks.map((raw) => {
    let link = tag(raw, 'link');
    if (!link) link = attr(raw, 'link', 'href');
    if (!link) link = (raw.match(/rdf:about=["']([^"']+)["']/) || [])[1] || '';
    const extras = {};
    for (const name of extra) extras[name] = tag(raw, name.replace(':', '\\:'));
    return {
      title: tag(raw, 'title'),
      link: link.trim(),
      date: tag(raw, 'pubDate') || tag(raw, 'dc:date') || tag(raw, 'updated') || tag(raw, 'published'),
      description: tag(raw, 'description') || tag(raw, 'summary') || tag(raw, 'content'),
      extra: extras,
      raw,
    };
  });
}

export function parseDate(s) {
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : 0;
}
