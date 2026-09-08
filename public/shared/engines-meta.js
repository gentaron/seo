/**
 * engines-meta.js — サジェスト提供元の公開メタ情報（UI表示用）
 * 取得ロジック（URL/パーサ）は netlify/lib/engines.js 側が保持し、
 * この定義を単一の情報源として参照する。
 */

export const ENGINE_META = [
  { id: 'google', label: 'Google', short: 'G', group: '検索エンジン', accent: '#4285f4', desc: '日本の検索需要の基準。まずここから' },
  { id: 'youtube', label: 'YouTube', short: 'YT', group: '動画', accent: '#ff0033', desc: '動画・ハウツー需要の発見に強い' },
  { id: 'bing', label: 'Bing', short: 'B', group: '検索エンジン', accent: '#00809d', desc: 'PC・法人ユーザー層の傾向が出やすい' },
  { id: 'duckduckgo', label: 'DuckDuckGo', short: 'DDG', group: '検索エンジン', accent: '#de5833', desc: '英語混じりのクエリに強い' },
  { id: 'amazon', label: 'Amazon.co.jp', short: 'AMZ', group: 'EC・購買', accent: '#ff9900', desc: '購買直前の指名検索を拾える' },
  { id: 'google_news', label: 'Google ニュース', short: 'GN', group: '検索エンジン', accent: '#1a73e8', desc: '時事・トレンド寄りの語を回収' },
  { id: 'google_images', label: 'Google 画像', short: 'GI', group: '検索エンジン', accent: '#34a853', desc: 'ビジュアル需要（作例・図解）を発見' },
  { id: 'yahoo', label: 'Yahoo! JAPAN', short: 'Y!', group: '検索エンジン', accent: '#ff0033', beta: true, desc: '国内シェア2位。仕様変更で不安定な場合あり' },
];

export const ENGINE_META_MAP = Object.fromEntries(ENGINE_META.map((e) => [e.id, e]));
export const DEFAULT_ENGINES = ['google'];
