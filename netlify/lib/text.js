/**
 * text.js — 正規化・言語判定・スラングらしさ判定
 * すべて純関数（ネットワークもストレージも触らない）
 */

const KATA = '\\u30A0-\\u30FF\\u31F0-\\u31FF\\uFF66-\\uFF9F';
const HIRA = '\\u3040-\\u309F';
const KANJI = '\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uF900-\\uFAFF\\u3005';

export const RE_KATA = new RegExp(`[${KATA}]`);
export const RE_HIRA = new RegExp(`[${HIRA}]`);
export const RE_KANJI = new RegExp(`[${KANJI}]`);
export const RE_KATA_ONLY = new RegExp(`^[${KATA}ー・]+$`);
export const RE_HIRA_ONLY = new RegExp(`^[${HIRA}ー]+$`);
export const RE_LATIN = /[A-Za-z]/;

/** 照合キー：NFKC・小文字・空白圧縮・先頭の # や記号を除去 */
export function normKey(s) {
  return String(s ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/^[#＃@\s"'“”‘’「『【(（\[]+/, '')
    .replace(/[\s"'“”‘’」』】)）\].,!?！？:：;。、…]+$/, '')
    .replace(/[\s_]+/g, ' ')
    .trim();
}

/** 台帳・照合用の主キー：空白・ハイフン・中黒を潰す（aura farming = aurafarming = aura-farming） */
export function termKey(s) {
  return normKey(s).replace(/[\s\-_・.'’]/g, '');
}

/** 表示形：NFKC して余計な記号と空白を整える（大文字小文字は保持） */
export function cleanDisplay(s) {
  return String(s ?? '')
    .normalize('NFKC')
    .replace(/^[#＃\s"'“”‘’「『【(（\[]+/, '')
    .replace(/[\s"'“”‘’」』】)）\].,!?:;。、…]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** ざっくり言語判定：ja / en / xx */
export function detectLang(s) {
  const t = String(s ?? '');
  if (RE_KATA.test(t) || RE_HIRA.test(t)) return 'ja';
  if (RE_KANJI.test(t)) return 'ja';
  if (RE_LATIN.test(t)) return 'en';
  return 'xx';
}

/** HTML エンティティとタグを落とす（RSS の title/description 用） */
export function stripHtml(s) {
  return String(s ?? '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos|nbsp);/gi, (m, e) => {
      const map = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
      const k = e.toLowerCase();
      if (map[k]) return map[k];
      const code = k.startsWith('#x') ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

/* ---------------------------------------------------------------------
 * 英語のストップワード（＋ニュース見出しに頻出する汎用語）
 * ------------------------------------------------------------------- */
export const STOP_EN = new Set(
  `a about above after again against all almost also am among an and any are aren't around as at back
  be became because become been before being below best better between big both but by can can't cannot
  could couldn't day days did didn't do does doesn't doing don't done down during each early even ever every
  few first for from full further get gets getting give go goes going gone good got great had hadn't has hasn't
  have haven't having he he's her here here's hers herself him himself his how how's however i i'd i'll i'm i've
  if in into is isn't it it's its itself just know last late least less let let's like little look made make makes
  making many may me might more most much must my myself need never new news next no nor not now of off often
  old on once one only or other our ours ourselves out over own part people per put rather really right said same
  say says see seems she she'd she'll she's should shouldn't show since so some something still such take than that that's
  the their theirs them themselves then there there's these they they'd they'll they're they've thing things think this
  those though three through time times to today too top two under until up upon us use used using very via want
  was wasn't way ways we we'd we'll we're we've well were weren't what what's when when's where where's whether which while
  who who's whom why why's will with without won't work world would wouldn't year years yes yet you you'd you'll
  you're you've your yours yourself yourselves 's s t re ve ll d m im dont cant wont isnt didnt doesnt
  ask hn tell show anyone anybody everyone guys reddit post posts thread comments comment discussion question
  update updates video videos photo photos pic pics image images official trailer live stream watch read
  week weeks month months hour hours minute minutes second seconds year's 2024 2025 2026 2027
  man woman men women guy girl kid kids person thing stuff lot lots got gonna wanna kinda sorta
  help please thanks thank anyone's someone somebody nothing anything everything
  free full high low long short small large real true false sure maybe probably actually literally
  why's how-to vs via based-on per cent percent amp quot www com http https html
  explain explained explains mean means meaning meant trend trends trending funny hand finally understand keeps
  saying class getting discourse pov fyp lol lmao omg wtf tho rn ngl tbh imo idk smh fr
  game games team season film movie song album book app apps tool tools guide review reviews
  arrested arrest incident incidents stadium viral goes sparks backlash online talking wrong reasons crash police
  scandal controversy lawsuit charged dies dead death killed missing report reports reportedly claims according
  breaking latest live updates officials president minister government court judge says said told
  sources source woman's man's after amid over against video photos watch inside behind`
    .split(/\s+/)
    .filter(Boolean),
);

/** 日本語側で単体だと意味を持たない語 */
export const STOP_JA = new Set(
  `こと もの ため よう これ それ あれ どれ ここ そこ さん ちゃん くん たち など まで から より
  について による として ニュース 速報 動画 記事 公式 発表 情報 まとめ 話題 今日 明日 昨日 今年 来年
  日本 世界 年 月 日 時 分 人 円 ドル 万 億 件 回 位 第 版 号 歳 代 中 後 前 的 系 様 方 者 氏
  ランキング コメント ブログ サイト ページ アプリ サービス ユーザー システム データ ゲーム チャンネル
  ライブ 配信 放送 番組 生放送 実況 投稿 更新 公開 開始 終了 発売 決定 解説 紹介 方法 理由 結果 問題
  ニコニコ はてな ブックマーク エントリー ホッテントリ ニコ動 ツイート ポスト リツイート
  ネット タイムライン 最近 若者 結局 悲報 朗報 元ネタ 意味 一色 本当 普通 自分 相手 全部 今回 感じ
  みんな やっぱり ちょっと 解説 ゆっくり解説 してみた 歌ってみた 踊ってみた 実況プレイ 切り抜き
  炎上 謝罪 逮捕 容疑 容疑者 警視庁 警察 府警 県警 批判 批判殺到 物議 騒動 事件 事故 疑惑 判明 発覚 報道
  再発防止 再発防止に努める まさか まさかの SNS ネットで話題 話題に 運営 男性 女性 男 女 会社員 無職
  政府 首相 大臣 総理 発言 会見 記者会見 声明 コメント 現場 死亡 けが 重傷 行方不明 速報値 予想 見通し`
    .split(/\s+/)
    .filter(Boolean),
);

/** 媒体名などノイズになる語（全言語） */
export const STOP_ANY = new Set(
  `reddit hacker news hn lobsters github bluesky bsky mastodon misskey lemmy wikipedia youtube tiktok
  twitter x instagram facebook threads google urban dictionary know your meme kym hatena nicovideo niconico
  main_page メインページ special 特別 - sns`
    .split(/\s+/)
    .filter(Boolean),
);

/* ---------------------------------------------------------------------
 * スラングらしさ（0〜1）
 * 「新語・内輪語っぽい形」をしているかの形態的ヒューリスティック。
 * 決め打ちの辞書で当てに行くのではなく、造語パターンを見る。
 * ------------------------------------------------------------------- */

const EN_SLANG_AFFIX =
  /(maxx?ing|maxxer|pilled|posting|poster|core|coded|mogg?ing|mogged|cel|ussy|ification|flation|gate|bait|tok|verse|wave|pilling|brained|brain|rot|fluencer|ception|tastic|ish|ie|y2k|era|aesthetic|slop|farming|cope|seethe|stan|stans|ship|shipping|szn|bro|bros|vibes?|cooked|delulu|rizz|gyat+|sigma|skibidi|aura|mewing|fanum|glaze|glazing|yap|yapping|ick|slay|bussin|npc|ratio|mid|based|cringe|unc|huzz|crash ?out|chopped|six seven|67)$/i;
const EN_SLANG_PREFIX = /^(rizz|delulu|gyat|sigma|skibidi|aura|mew|glaze|yap|npc|brain ?rot|mog|looks|goon|ohio|unc|lowkey|highkey|no ?cap|big ?back)/i;

const JA_SLANG_SUFFIX = new RegExp(
  [
    '草', 'ww+', 'ｗ+', 'ンゴ', 'ニキ', 'ネキ', 'おじ', 'おば', 'しか勝たん', 'すぎ(る|ん)?', 'み$',
    '界隈', '民', '勢', '沼', '活', 'ハラ', '構文', '案件', 'ムーブ', 'ガチャ', 'チャレンジ', 'ミーム',
    '顔', '芸', '型', '系(女子|男子)?', '化', '待ち', '不可避', '確定', 'しぐさ', '仕草', 'ぴえん', 'ぱお',
    'たん', 'りん', 'ちゃそ', 'ぽ', 'ﾁｬﾝ', 'しか', '一択', '案件', '詐欺', '疲れ', '離れ', '落ち', '推し', '担',
  ]
    .map((s) => (s.endsWith('$') ? s : `${s}$`))
    .join('|'),
);
const JA_SLANG_ANY = /(推し|オタク|ヲタ|ガチ|エモ|バズ|映え|沼|尊い|てぇてぇ|てえてえ|ぴえん|ぱおん|きゅんです|草|オワコン|陰キャ|陽キャ|ワンチャン|メンヘラ|地雷|量産型|ぶりっ|界隈|蛙化|ギャル|リア充|コスパ|タイパ|チー牛|弱者男性|ミーム|切り抜き|VTuber|Vtuber|ボカロ|歌ってみた|踊ってみた|ゆっくり|AI絵|生成AI)/;

export function slangness(term, lang = detectLang(term)) {
  const t = String(term ?? '').normalize('NFKC');
  if (!t) return 0;
  let s = 0;
  if (lang === 'ja') {
    if (RE_KATA_ONLY.test(t) && t.length >= 3) s += 0.18;
    if (JA_SLANG_SUFFIX.test(t)) s += 0.4;
    if (JA_SLANG_ANY.test(t)) s += 0.3;
    if (RE_LATIN.test(t) && (RE_KATA.test(t) || RE_KANJI.test(t) || RE_HIRA.test(t))) s += 0.2; // 「AI絵師」「Z世代」
    if (/[ァ-ヶー]+[いみ]$/.test(t)) s += 0.25; // 「エモい」「ヤバみ」
    if (/(.)\1{2,}/.test(t)) s += 0.15;
    if (t.length > 14) s -= 0.2;
  } else {
    const words = t.split(/\s+/);
    if (EN_SLANG_AFFIX.test(t)) s += 0.4;
    if (EN_SLANG_PREFIX.test(t)) s += 0.35;
    if (/([a-z])\1{2,}/i.test(t)) s += 0.2; // 「sooo」
    if (/[a-z][0-9]|[0-9][a-z]/i.test(t) && t.length <= 10) s += 0.12;
    if (/^[a-z]+[A-Z][a-z]+/.test(t)) s += 0.1; // camelCase
    if (/^[A-Z]{2,5}$/.test(t)) s += 0.12; // 略語
    if (words.length === 1 && /^[a-z]{3,8}$/.test(t) && !STOP_EN.has(t)) s += 0.08;
    if (words.length > 4) s -= 0.25;
  }
  return Math.max(0, Math.min(1, s));
}

/** 候補語として最低限の体裁を満たすか */
/** ニュース見出しの定型句の断片（「巡り20代」「27歳の男」など）を含む日本語候補は捨てる */
const RE_JA_NEWS_FRAGMENT = /(巡り|めぐり|\d+代|\d+歳|\d+人|容疑者|警視庁|府警|県警|再発防止|による|について|された|している|していた)/;

export function isPlausibleTerm(display) {
  const t = String(display ?? '');
  const key = normKey(t);
  if (!key || key.length < 2) return false;
  if (detectLang(key) === 'ja' && RE_JA_NEWS_FRAGMENT.test(key) && key.length > 2) return false;
  if (key.length > 48) return false;
  if (/^[\d\s.,:/%-]+$/.test(key)) return false; // 数値だけ
  if (/^https?:|www\.|\.com\b|\.jp\b/.test(key)) return false;
  if (STOP_ANY.has(key) || STOP_EN.has(key) || STOP_JA.has(key)) return false;
  if (RE_HIRA_ONLY.test(key) && key.length < 3) return false; // 2 文字以下のひらがなは助詞の可能性が高い（ぴえん・ぱおんは通す）
  if (detectLang(key) === 'en') {
    const words = key.split(' ');
    if (words.every((w) => STOP_EN.has(w))) return false;
    if (STOP_EN.has(words[0]) || STOP_EN.has(words[words.length - 1])) return false;
    if (words.length === 1 && key.length < 3) return false;
  }
  return true;
}
