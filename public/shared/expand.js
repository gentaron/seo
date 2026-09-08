/**
 * expand.js — 掛け合わせクエリ生成器
 *
 * ブラウザ（ES Modules）と Netlify Functions の双方から import される共有モジュール。
 * 依存ゼロ・副作用なしを維持すること。
 */

/** 五十音（清音46） */
export const GOJUON = [
  'あ', 'い', 'う', 'え', 'お',
  'か', 'き', 'く', 'け', 'こ',
  'さ', 'し', 'す', 'せ', 'そ',
  'た', 'ち', 'つ', 'て', 'と',
  'な', 'に', 'ぬ', 'ね', 'の',
  'は', 'ひ', 'ふ', 'へ', 'ほ',
  'ま', 'み', 'む', 'め', 'も',
  'や', 'ゆ', 'よ',
  'ら', 'り', 'る', 'れ', 'ろ',
  'わ', 'を', 'ん',
];

/** 濁音・半濁音の行頭（サジェストの取りこぼしを防ぐ） */
export const DAKUON = ['が', 'ぎ', 'ぐ', 'げ', 'ご', 'ざ', 'じ', 'ず', 'ぜ', 'ぞ', 'だ', 'で', 'ど', 'ば', 'び', 'ぶ', 'べ', 'ぼ', 'ぱ', 'ぴ', 'ぷ', 'ぺ', 'ぽ'];

export const ALPHABET = 'abcdefghijklmnopqrstuvwxyz'.split('');
export const NUMBERS = '0123456789'.split('');

/** 疑問・意図（Q&A / インフォメーショナル） */
export const QUESTION_SUFFIX = [
  'とは', 'なぜ', 'どう', 'どうやって', 'いつ', 'どこ', 'だれ', 'なに', 'どれ', 'どっち',
  'いくら', 'できる', 'できない', 'ない', 'わからない', 'コツ', '理由', '仕組み',
];
export const QUESTION_PREFIX = ['なぜ', 'どうやって', 'いつ', 'どこで', 'どれくらい'];

/** 商用意図・比較検討（トランザクショナル / コマーシャル） */
export const COMMERCIAL_SUFFIX = [
  '料金', '費用', '相場', '価格', '安い', '無料', '比較', 'おすすめ', 'ランキング',
  '口コミ', '評判', 'レビュー', 'デメリット', 'メリット', '違い', '解約', '申し込み',
  'キャンペーン', 'クーポン', '割引', '購入', '中古', 'セール',
];

/** 学習・実務（ハウツー / ナレッジ） */
export const HOWTO_SUFFIX = [
  '方法', 'やり方', '手順', '始め方', '使い方', '書き方', '選び方', '作り方',
  '初心者', '入門', '基礎', '例', 'サンプル', 'テンプレート', 'チェックリスト',
  '注意点', '失敗', '対策', 'トラブル', '事例', '種類', '一覧', '意味', '効果',
];

/** 属性・ローカル（日本市場向け） */
export const ATTRIBUTE_PREFIX = [
  '無料', 'おすすめ', '人気', '最新', '初心者', '個人', '法人', '中小企業',
  '東京', '大阪', '名古屋', '福岡', '札幌', '横浜', '京都', '沖縄',
  '20代', '30代', '40代', '50代', '主婦', '学生', '社会人',
];

export const ATTRIBUTE_SUFFIX = [
  'アプリ', 'ツール', 'サービス', 'サイト', '会社', '本', '資格', '求人',
  '転職', '副業', 'スクール', '講座', 'セミナー', 'AI', 'スマホ', 'iphone', 'android',
];

/**
 * 年号系（直近3年 + 来年）を動的生成。SEOでは「2026」等の年指定サジェストが強い。
 * @param {number} [now] 基準となる西暦（テスト用に注入可能）
 */
export function yearTokens(now = new Date().getFullYear()) {
  return [String(now), String(now + 1), String(now - 1), `${now}年`];
}

/**
 * 展開モードの定義。
 * build(keyword) は掛け合わせ済みクエリ配列を返す純粋関数。
 */
export const MODES = [
  {
    id: 'base',
    label: '基本',
    hint: 'キーワード単体のサジェスト',
    always: true,
    build: (q) => [q],
  },
  {
    id: 'gojuon',
    label: '五十音',
    hint: '「◯◯ あ」〜「◯◯ ん」で網羅',
    build: (q) => GOJUON.map((c) => `${q} ${c}`),
  },
  {
    id: 'dakuon',
    label: '濁音・半濁音',
    hint: '「◯◯ が」〜「◯◯ ぽ」を追加',
    build: (q) => DAKUON.map((c) => `${q} ${c}`),
  },
  {
    id: 'alphabet',
    label: 'アルファベット',
    hint: '「◯◯ a」〜「◯◯ z」で英語表記も回収',
    build: (q) => ALPHABET.map((c) => `${q} ${c}`),
  },
  {
    id: 'number',
    label: '数字・年号',
    hint: '数字と年号の掛け合わせ',
    build: (q) => [...NUMBERS.map((c) => `${q} ${c}`), ...yearTokens().map((y) => `${q} ${y}`)],
  },
  {
    id: 'question',
    label: '疑問・悩み',
    hint: 'とは / なぜ / どうやって などの検索意図',
    build: (q) => [
      ...QUESTION_SUFFIX.map((s) => `${q} ${s}`),
      ...QUESTION_PREFIX.map((s) => `${s} ${q}`),
    ],
  },
  {
    id: 'commercial',
    label: '比較・購買',
    hint: '料金 / 口コミ / おすすめ など収益化に直結',
    build: (q) => COMMERCIAL_SUFFIX.map((s) => `${q} ${s}`),
  },
  {
    id: 'howto',
    label: 'ハウツー',
    hint: '方法 / やり方 / 初心者 などの解説需要',
    build: (q) => HOWTO_SUFFIX.map((s) => `${q} ${s}`),
  },
  {
    id: 'attribute',
    label: '属性・地域',
    hint: '地域名・年代・デバイスなどの修飾語',
    build: (q) => [
      ...ATTRIBUTE_PREFIX.map((s) => `${s} ${q}`),
      ...ATTRIBUTE_SUFFIX.map((s) => `${q} ${s}`),
    ],
  },
];

export const MODE_IDS = MODES.map((m) => m.id);
export const DEFAULT_MODES = ['base', 'gojuon', 'alphabet', 'question', 'commercial'];

/** 全角スペース・連続スペースを正規化し、前後を刈り取る */
export function normalizeKeyword(input) {
  return String(input ?? '')
    .replace(/[　\s]+/g, ' ')
    .trim();
}

/**
 * 指定モードのクエリを生成（重複排除・順序安定）。
 * @param {string} keyword
 * @param {string[]} modeIds
 * @returns {string[]}
 */
export function buildQueries(keyword, modeIds = DEFAULT_MODES) {
  const q = normalizeKeyword(keyword);
  if (!q) return [];
  const wanted = new Set(modeIds && modeIds.length ? modeIds : DEFAULT_MODES);
  const seen = new Set();
  const out = [];
  for (const mode of MODES) {
    if (!wanted.has(mode.id)) continue;
    for (const built of mode.build(q)) {
      const v = normalizeKeyword(built);
      if (!v || seen.has(v)) continue;
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

/** クエリ配列を size ごとのバッチに分割 */
export function chunk(list, size) {
  const n = Math.max(1, size | 0);
  const out = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}

/** クエリ数の見積り（UI のコスト表示用） */
export function estimateQueryCount(keyword, modeIds) {
  return buildQueries(keyword, modeIds).length;
}
