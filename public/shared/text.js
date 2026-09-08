/**
 * text.js — 日本語テキストの正規化・トークン化・スコアリング
 *
 * 形態素解析器は載せない（バンドルサイズと速度を優先）。
 * 代わりに「文字種の切り替わり」でチャンク分割するヒューリスティクスを使う。
 * 実運用の共起語抽出ではこれで十分な精度が出る。
 */

const KANJI = '\\u4E00-\\u9FFF\\u3005\\u3006\\u30F6';
const KATAKANA = '\\u30A1-\\u30FA\\u30FC\\u31F0-\\u31FF\\u3099-\\u309C';
const HIRAGANA = '\\u3041-\\u309F';

const TOKEN_RE = new RegExp(
  `[${KANJI}]+|[${KATAKANA}]+|[${HIRAGANA}]+|[A-Za-z][A-Za-z0-9'’.+#-]*|[0-9]+(?:[.,][0-9]+)*`,
  'g',
);

/** 共起語として無意味な語（助詞・形式名詞・汎用語） */
export const STOPWORDS = new Set([
  'とは', 'こと', 'もの', 'ため', 'よう', 'これ', 'それ', 'あれ', 'ここ', 'そこ',
  'です', 'ます', 'する', 'した', 'して', 'される', 'ない', 'いる', 'ある', 'なる',
  'など', 'から', 'まで', 'より', 'ので', 'だけ', 'その', 'この', 'あの', 'どの',
  'とき', 'ところ', 'ほう', 'たち', 'さん', 'ちゃん', 'って', 'てる', 'ても', 'でも',
  'ながら', 'および', 'または', 'について', 'における', 'に関する',
  'the', 'and', 'for', 'you', 'with', 'this', 'that', 'are', 'not',
]);

/** 全角英数を半角に、カタカナ全角化、小文字化などの検索用正規化 */
export function normalize(str) {
  return String(str ?? '')
    .normalize('NFKC')
    .replace(/[　\s]+/g, ' ')
    .trim();
}

/** 比較用キー（大小文字・空白差を吸収） */
export function keyOf(str) {
  return normalize(str).toLowerCase().replace(/\s+/g, ' ');
}

/**
 * 文字列を語に分割する。
 * @param {string} str
 * @returns {string[]}
 */
export function tokenize(str) {
  const src = normalize(str);
  const raw = src.match(TOKEN_RE) || [];
  const merged = [];
  // 「20」＋「代」→「20代」のように、数値＋助数詞（漢字1文字）を結合する
  for (let i = 0; i < raw.length; i += 1) {
    const cur = raw[i];
    const next = raw[i + 1];
    if (/^[0-9]+$/.test(cur) && next && next.length === 1 && new RegExp(`^[${KANJI}]$`).test(next)) {
      merged.push(cur + next);
      i += 1;
      continue;
    }
    merged.push(cur);
  }
  const out = [];
  for (const t of merged) {
    const token = t.toLowerCase();
    if (STOPWORDS.has(token)) continue;
    // ひらがなのみの短い語（助詞など）はノイズになりやすい
    const hiraganaOnly = new RegExp(`^[${HIRAGANA}]+$`).test(token);
    if (hiraganaOnly && token.length < 3) continue;
    if (!hiraganaOnly && token.length < 2 && !/^[0-9]$/.test(token)) continue;
    out.push(token);
  }
  return out;
}

/**
 * 共起語（頻出ワード）を集計する。
 * @param {string[]} phrases サジェスト文字列の配列
 * @param {string} seed 除外する元キーワード
 * @param {number} limit
 */
export function cooccurrence(phrases, seed = '', limit = 40) {
  const seedTokens = new Set(tokenize(seed));
  const counts = new Map();
  for (const p of phrases) {
    const uniq = new Set(tokenize(p));
    for (const token of uniq) {
      if (seedTokens.has(token)) continue;
      counts.set(token, (counts.get(token) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word, 'ja'))
    .slice(0, limit);
}

/**
 * キーワードのスコアリング。
 * 検索ボリュームではなく「サジェストにおける出現の強さ」を 0-100 で表す独自指標。
 *
 *  - 出現した掛け合わせクエリ数（露出の広さ）      … 45%
 *  - 出現したエンジン数（媒体を跨いだ普遍性）      … 25%
 *  - 最良表示順位（上位ほどユーザー需要が強い）    … 30%
 *
 * @param {{hits:number, engines:number, bestRank:number}} item
 * @param {{maxHits:number, engineCount:number}} ctx
 */
export function scoreOf(item, ctx) {
  const maxHits = Math.max(1, ctx.maxHits || 1);
  const engineCount = Math.max(1, ctx.engineCount || 1);
  const hitScore = Math.log1p(item.hits) / Math.log1p(maxHits);
  const engineScore = engineCount > 1 ? (item.engines - 1) / (engineCount - 1) : 1;
  const rankScore = Math.max(0, 1 - item.bestRank / 12);
  const raw = 0.45 * hitScore + 0.25 * engineScore + 0.3 * rankScore;
  return Math.max(1, Math.min(100, Math.round(raw * 100)));
}

/** 五十音行の判定（グルーピング用） */
const KANA_ROWS = [
  ['あ行', 'あいうえおぁぃぅぇぉ'],
  ['か行', 'かきくけこがぎぐげご'],
  ['さ行', 'さしすせそざじずぜぞ'],
  ['た行', 'たちつてとだぢづでど'],
  ['な行', 'なにぬねの'],
  ['は行', 'はひふへほばびぶべぼぱぴぷぺぽ'],
  ['ま行', 'まみむめも'],
  ['や行', 'やゆよゃゅょ'],
  ['ら行', 'らりるれろ'],
  ['わ行', 'わをん'],
];

/** かな→行ラベル。該当なしは null */
export function kanaRow(ch) {
  if (!ch) return null;
  const hira = katakanaToHiragana(ch);
  for (const [label, chars] of KANA_ROWS) {
    if (chars.includes(hira)) return label;
  }
  return null;
}

export function katakanaToHiragana(str) {
  return String(str ?? '').replace(/[ァ-ヶ]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0x60),
  );
}

/**
 * 「元キーワードの直後に続く語」でグルーピングするためのラベルを返す。
 * 例: seed=「転職 」 phrase=「転職 エージェント 比較」 → 「エージェント」
 */
export function groupLabel(phrase, seed) {
  const p = normalize(phrase);
  const s = normalize(seed);
  let rest = p;
  if (s && p.toLowerCase().startsWith(s.toLowerCase())) {
    rest = p.slice(s.length).trim();
  }
  if (!rest) return '完全一致';
  const first = tokenize(rest)[0] || rest.split(' ')[0];
  return first || 'その他';
}

/** CSV / TSV へのシリアライズ（Excel での文字化けを避けるため BOM を付ける） */
export function toDelimited(rows, headers, delimiter = ',') {
  const esc = (v) => {
    const s = String(v ?? '');
    if (delimiter === '\t') return s.replace(/[\t\r\n]/g, ' ');
    return /["\n,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = headers.map((h) => esc(h.label)).join(delimiter);
  const body = rows.map((r) => headers.map((h) => esc(r[h.key])).join(delimiter));
  return '﻿' + [head, ...body].join('\r\n');
}
