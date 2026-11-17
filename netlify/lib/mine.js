/**
 * mine.js — シグナル群から「語」の候補を掘り出す
 *
 * ・媒体が明示した語（トピック名・ハッシュタグ）はそのまま候補
 * ・本文（投稿タイトル等）からは
 *     - ハッシュタグ / 括弧でくくられた語（「」『』【】“”）
 *     - 日本語：Intl.Segmenter で分かち書き → 複合語を再結合 → 部分列
 *     - 英語  ：固有名詞っぽい大文字連続 / 1〜3-gram
 * ・最後に「より長い語に常に包含される短い語」を間引く（skibidi ⊂ skibidi toilet）
 *
 * 純関数。入出力はプレーンなオブジェクトのみ。
 */

import {
  termKey,
  normKey,
  cleanDisplay,
  detectLang,
  isPlausibleTerm,
  RE_HIRA_ONLY,
  RE_KATA,
  RE_KANJI,
  RE_LATIN,
  RE_HIRA,
  STOP_EN,
  STOP_JA,
} from './text.js';

const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('ja', { granularity: 'word' }) : null;

/** 直前の語にくっついて造語を作るひらがな（推“し”活／ヤバ“み”／エモ“すぎ”） */
const GLUE = new Set(['し', 'み', 'い', 'すぎ', 'すぎる', 'ぽい', 'っぽい', 'がち', 'ちゃん', 'たん', 'ンゴ']);
/** 語頭・語末に来てはいけない glue（「し活」「み」単体などを避ける） */
const GLUE_EDGE_OK_END = new Set(['み', 'い', 'すぎ', 'ぽい', 'っぽい', 'ちゃん', 'たん']);

const RE_HASHTAG = /[#＃]([\p{L}\p{N}_ー]{2,40})/gu;
const RE_BRACKET = /[「『【“"]([^「」『』【】“”"\n]{2,24})[」』】”"]/g;
const RE_EN_TOKEN = /[A-Za-z][A-Za-z0-9'’-]*[A-Za-z0-9]|[A-Za-z]/g;

/**
 * 日本語テキストから複合語候補を作る
 * @param {string} text
 * @returns {Array<{t:string, w:number}>}
 */
export function mineJapanese(text) {
  if (!segmenter) return [];
  const out = [];
  const segs = [...segmenter.segment(String(text).normalize('NFKC'))];
  /** @type {string[][]} */
  const compounds = [];
  let cur = [];
  const flush = () => {
    if (cur.length) compounds.push(cur);
    cur = [];
  };
  for (const s of segs) {
    const w = s.segment;
    if (!s.isWordLike || /^\s+$/.test(w)) {
      // 長音・中黒は語の一部として許容
      if (/^[ー・]$/.test(w) && cur.length) cur.push(w);
      else flush();
      continue;
    }
    if (RE_HIRA_ONLY.test(w) && !GLUE.has(w)) {
      // ひらがなだけの長めの語（例：てぇてぇ、ぴえん）は単独候補として残す
      if (w.length >= 3) {
        flush();
        compounds.push([w]);
      } else flush();
      continue;
    }
    if (GLUE.has(w) && !cur.length) continue; // 語頭の glue は捨てる
    cur.push(w);
  }
  flush();

  const kataEnd = (x) => /[ァ-ヶー]$/.test(x);
  const kataStart = (x) => /^[ァ-ヶ]/.test(x);
  for (const segsOf of compounds) {
    const n = segsOf.length;
    if (STOP_JA.has(segsOf.join(''))) continue; // 「タイムライン」が停止語なら「タイム」「ライン」も出さない
    // 部分列（最大 4 セグメント）を候補に。ただしカタカナ語の途中では切らない（タイム|ライン）
    for (let i = 0; i < n; i += 1) {
      if (GLUE.has(segsOf[i])) continue;
      if (i > 0 && kataEnd(segsOf[i - 1]) && kataStart(segsOf[i])) continue;
      for (let j = i + 1; j <= Math.min(n, i + 4); j += 1) {
        if (j < n && kataEnd(segsOf[j - 1]) && kataStart(segsOf[j])) continue;
        const last = segsOf[j - 1];
        if (GLUE.has(last) && !GLUE_EDGE_OK_END.has(last)) continue;
        if (/^[ー・]$/.test(last)) continue;
        const t = segsOf.slice(i, j).join('');
        const w = jaWeight(t, j - i);
        if (w > 0) out.push({ t, w });
      }
    }
  }
  return out;
}

function jaWeight(t, segCount) {
  if (t.length < 2 || t.length > 20) return 0;
  if (STOP_JA.has(t)) return 0;
  const hasKata = RE_KATA.test(t);
  const hasKanji = RE_KANJI.test(t);
  const hasLatin = RE_LATIN.test(t);
  const hasHira = RE_HIRA.test(t);
  if (/^[\d０-９]+$/.test(t)) return 0;
  if (hasLatin && !hasKata && !hasKanji && !hasHira) return 0; // 英字のみは英語側で扱う
  if (hasKata && t.replace(/[^ァ-ヶー]/g, '').length >= 3) return segCount > 1 ? 0.9 : 0.8;
  if (hasLatin && (hasKata || hasKanji)) return 0.85; // AI絵師・Z世代
  if (hasKata && hasKanji) return 0.75; // 推し活ガチ勢 など
  if (hasHira && (hasKata || hasKanji)) {
    // ヤバみ・エモすぎ・推し活 は拾うが、「見る」「食べた」のような活用語単体は捨てる
    if (segCount < 2) return 0;
    return hasKata ? 0.6 : 0.4;
  }
  if (hasKanji && !hasKata && !hasHira) {
    if (t.length >= 3) return segCount > 1 ? 0.55 : 0.45;
    return 0.25; // 2 文字の漢語は一般語が多い
  }
  if (hasKata) return 0.4;
  return 0.3;
}

/**
 * 英語テキストから候補を作る
 * @param {string} text
 */
export function mineEnglish(text) {
  const out = [];
  const raw = String(text).normalize('NFKC');
  const tokens = raw.match(RE_EN_TOKEN) || [];
  if (!tokens.length) return out;

  // タイトルケース（ほぼ全単語が大文字始まり）なら大文字連続は当てにしない
  const capRatio = tokens.filter((t) => /^[A-Z]/.test(t)).length / tokens.length;
  if (capRatio < 0.6) {
    let run = [];
    const push = () => {
      const trimmed = trimStops(run);
      if (trimmed.length >= 2 && trimmed.length <= 4) out.push({ t: trimmed.join(' '), w: 1 });
      run = [];
    };
    tokens.forEach((tok, i) => {
      const isCap = /^[A-Z][a-z0-9'’-]*[A-Za-z0-9]?$/.test(tok) || /^[A-Z]{2,6}$/.test(tok);
      if (isCap && !(i === 0 && STOP_EN.has(tok.toLowerCase()))) run.push(tok);
      else push();
    });
    push();
  }

  const low = tokens.map((t) => t.toLowerCase().replace(/[’']s$/, '').replace(/’/g, "'"));
  for (let n = 1; n <= 3; n += 1) {
    for (let i = 0; i + n <= low.length; i += 1) {
      const gram = low.slice(i, i + n);
      if (STOP_EN.has(gram[0]) || STOP_EN.has(gram[n - 1])) continue;
      if (n === 3 && STOP_EN.has(gram[1]) && !MID_OK.has(gram[1])) continue;
      if (gram.some((g) => g.length < 2 && n === 1)) continue;
      if (n === 1 && gram[0].length < 3) continue;
      // 元の大文字小文字を保った表示形
      const display = tokens.slice(i, i + n).join(' ');
      out.push({ t: display, w: n === 1 ? 0.45 : n === 2 ? 0.8 : 0.6 });
    }
  }
  return out;
}

const MID_OK = new Set(['of', 'the', 'and', 'n', 'on', 'in', 'a']);

function trimStops(words) {
  let a = 0;
  let b = words.length;
  while (a < b && STOP_EN.has(words[a].toLowerCase())) a += 1;
  while (b > a && STOP_EN.has(words[b - 1].toLowerCase())) b -= 1;
  return words.slice(a, b);
}

/** 1 シグナルから候補語（表示形と重み）を取り出す */
export function extractFromSignal(sig) {
  const found = [];
  for (const term of sig.terms ?? []) found.push({ t: term.t, w: term.w ?? 1, explicit: true });
  if (sig.kind === 'post' || (sig.kind === 'topic' && sig.src === 'github')) {
    const text = String(sig.text ?? '');
    for (const m of text.matchAll(RE_HASHTAG)) found.push({ t: m[1], w: 1, explicit: true });
    for (const m of text.matchAll(RE_BRACKET)) found.push({ t: m[1], w: 0.9 });
    const lang = detectLang(text);
    if (lang === 'ja') found.push(...mineJapanese(text));
    if (RE_LATIN.test(text)) {
      // 日本語に挟まれた英字は塊ごとに分けて掘る（「AI絵師とZ世代」→ AI と Z を連結しない）
      for (const chunk of text.split(/[^\x20-\x7E’]+/)) if (RE_LATIN.test(chunk)) found.push(...mineEnglish(chunk));
    }
  }
  return found;
}

/**
 * 全シグナルから候補を集計する
 * @param {Array<object>} signals  src を含むシグナル
 * @returns {Map<string, {key:string, display:string, lang:string, explicit:boolean, hits:Array<{i:number, w:number}>, forms:Map<string,number>}>}
 */
export function mineCandidates(signals) {
  /** @type {Map<string, any>} */
  const cands = new Map();
  signals.forEach((sig, i) => {
    const local = new Map(); // 1 シグナル内での重複は最大重みだけ数える
    for (const f of extractFromSignal(sig)) {
      const display = cleanDisplay(f.t);
      if (!isPlausibleTerm(display)) continue;
      const key = termKey(display);
      const prev = local.get(key);
      if (!prev || prev.w < f.w) local.set(key, { display, w: f.w, explicit: !!f.explicit || prev?.explicit });
    }
    for (const [key, f] of local) {
      let c = cands.get(key);
      if (!c) {
        c = { key, display: f.display, lang: detectLang(f.display), explicit: false, hits: [], forms: new Map() };
        cands.set(key, c);
      }
      c.explicit ||= f.explicit;
      c.hits.push({ i, w: f.w });
      c.forms.set(f.display, (c.forms.get(f.display) || 0) + 1);
    }
  });

  // 代表表示形：最頻。同数なら大文字を含むもの（固有名詞の綴りを優先）
  for (const c of cands.values()) {
    let best = c.display;
    let bestN = -1;
    for (const [form, n] of c.forms) {
      // 同数なら：区切りのある綴り（aura farming > aurafarming）→ 大文字を含む綴り（固有名詞）を優先
      const better =
        n > bestN ||
        (n === bestN && /[\s-]/.test(form) && !/[\s-]/.test(best)) ||
        (n === bestN && /[A-Z]/.test(form) && !/[A-Z]/.test(best));
      if (better) {
        best = form;
        bestN = n;
      }
    }
    c.display = best;
  }

  pruneSubsumed(cands);
  return cands;
}

/**
 * 「ほぼ常に長い語の一部として出てくる短い語」を落とす
 * 例：skibidi toilet が 5 回、toilet が 5 回 → toilet は落とす
 *     推し活 が 4 回、推し が 9 回 → 推し は単独でも使われているので残す
 */
export function pruneSubsumed(cands) {
  const arr = [...cands.values()].sort((a, b) => b.key.length - a.key.length);
  for (const long of arr) {
    if (!cands.has(long.key) || long.hits.length < 2) continue;
    const longSet = new Set(long.hits.map((h) => h.i));
    const lk = normKey(long.display);
    for (const short of cands.values()) {
      if (short === long || short.key.length >= long.key.length || short.explicit) continue;
      if (!long.key.includes(short.key)) continue;
      // 英語は単語境界で包含しているときだけ（表示形の空白で判定）
      if (long.lang === 'en' && /\s/.test(lk) && !new RegExp(`(^| )${escapeRe(normKey(short.display))}( |$)`).test(lk)) continue;
      const inside = short.hits.filter((h) => longSet.has(h.i)).length;
      if (inside / short.hits.length >= 0.8) cands.delete(short.key);
    }
  }
  return cands;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
