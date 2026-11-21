/**
 * topics.js — 話題の「中身」による分類、情報源の種類、検証状態、社会的重要度
 *
 * ・注目度（SNS 上でどれだけ話題か）と重要度（社会をどれだけ変えうるか）は別の物差し。
 *   ここでは重要度だけを扱い、注目度（score.js）には一切混ぜない。
 * ・すべてルールベースの推定。重要度 0〜100 は真偽確率でも予測でもない。
 * ・データが足りないときは importance を null（判定保留）にして、結論を無理に確定しない。
 * 純関数のみ（ネットワーク・ストレージは触らない）。
 */

/* ------------------------------------------------------------------ *
 * 1) 内容カテゴリ（投稿元ではなく話題そのもので分類）
 * ------------------------------------------------------------------ */
export const TOPICS = [
  { id: 'security', label: '安全保障', base: 66 },
  { id: 'politics', label: '政治・国際情勢', base: 60 },
  { id: 'economy', label: '経済・金融', base: 58 },
  { id: 'science', label: '科学・研究', base: 58 },
  { id: 'ai', label: 'AI', base: 54 },
  { id: 'society', label: '社会', base: 52 },
  { id: 'technology', label: 'テクノロジー', base: 44 },
  { id: 'sports', label: 'スポーツ', base: 24 },
  { id: 'culture', label: '文化・娯楽', base: 20 },
  { id: 'other', label: 'その他', base: 26 },
];
export const TOPIC_MAP = Object.fromEntries(TOPICS.map((t) => [t.id, t]));

// 英語は単語境界つき・大文字小文字無視、日本語は部分一致。
// 誤検出を減らすため、文脈なしでは意味が広すぎる語（"market" 単体など）は複合表現で拾う。
const RULES = {
  security: [
    /\b(?:military|missiles?|troops|warfare|invasion|invaded|ceasefire|airstrikes?|drone strikes?|nuclear (?:weapons?|test)|defen[cs]e ministry|pentagon|nato|cyber ?attacks?|ransomware|vulnerabilit(?:y|ies)|zero-day|malware|data breach|breached|hackers?|espionage|terroris[mt]|sabotage)\b/i,
    /\bCVE-\d{4}-\d+/i,
    /軍事|ミサイル|戦争|侵攻|停戦|空爆|防衛|核実験|サイバー攻撃|脆弱性|不正アクセス|情報漏洩|ランサムウェア|テロ|安全保障/,
  ],
  politics: [
    /\b(?:elections?|electoral|president(?:ial)?|prime minister|parliament|congress|senate|lawmakers?|ministers?|government|sanctions?|diplomat(?:s|ic)?|summit|treaty|tariffs?|regulat(?:ion|ions|ors?|e|es|ed|ing)|legislation|bill passes|ban(?:s|ned)? on|executive order|white house|kremlin|ukrain(?:e|ian)|russia(?:n)?|taiwan|gaza|israel|iran|united nations|european union|\bEU\b)\b/i,
    /選挙|首相|大統領|国会|政府|外交|制裁|首脳|条約|議員|政権|法案|規制|関税|閣議|与党|野党|ウクライナ|ロシア|台湾|中東/,
  ],
  economy: [
    /\b(?:stocks?|shares (?:fell|rose|slid|jumped|plunged|surged)|stock market|nasdaq|dow jones|s&p 500|nikkei|earnings|revenue|quarterly results|ipo|inflation|interest rates?|federal reserve|\bfed\b|central bank|recession|gdp|layoffs?|valuation|market cap|sell-?off|bitcoin|crypto(?:currency)?|\$\d+(?:\.\d+)? ?(?:billion|trillion|bn|tn)|billion-dollar|trillion)\b/i,
    /株価|株式|日経平均|為替|円安|円高|決算|上場|インフレ|物価|金利|日銀|景気|リストラ|暗号資産|ビットコイン|兆円|億円|時価総額|売上高|業績/,
  ],
  science: [
    /\b(?:theorem|hypothesis|conjecture|proofs?|proved|proves|mathematic(?:s|al|ians?)|physics|physicists?|quantum|genome|genetic|proteins?|vaccines?|clinical trials?|peer[- ]reviewed|arxiv|preprint|study finds|researchers|scientists|telescope|nasa|jaxa|\besa\b|asteroid|exoplanet|fusion|discovery|discovered|species|neuroscience|climate study)\b/i,
    /論文|研究(?:者|チーム|成果)|証明|予想|定理|数学|物理|量子|遺伝子|ゲノム|発見|宇宙|探査|ワクチン|治験|新種|学会/,
  ],
  ai: [
    /\b(?:AI|A\.I\.|AGI|LLMs?|GPT-?\d+(?:\.\d+)?|GPT)\b/,
    /\b(?:artificial intelligence|machine learning|deep learning|neural networks?|language models?|chatgpt|claude|gemini|openai|anthropic|deepmind|copilot|mistral|llama|ai agents?|agentic|diffusion models?|vibe coding)\b/i,
    /人工知能|生成AI|機械学習|大規模言語モデル|深層学習|AI(?:絵師|規制|開発|企業|モデル)/,
  ],
  society: [
    /\b(?:protests?|protesters|strikes? (?:by|at)|walkout|lawsuits?|sued|court|ruling|judge|privacy|copyright|backlash|boycott|outrage|earthquakes?|floods?|flooding|wildfires?|hurricanes?|typhoons?|tsunami|outbreak|pandemic|epidemic|public health|deaths?|killed|died|shooting|police|immigration|refugees?|housing crisis|education|homeless(?:ness)?|data (?:scraping|collection|harvesting)|training data)\b/i,
    /死者|地震|台風|豪雨|津波|火災|事件|事故|裁判|訴訟|判決|プライバシー|著作権|反発|炎上|抗議|デモ|教育|医療|少子化|移民|感染|逮捕|学習データ|無断学習/,
  ],
  technology: [
    /\b(?:software|hardware|chips?|semiconductors?|gpus?|nvidia|apple|google|microsoft|amazon|meta|tesla|smartphones?|iphone|android|linux|windows|macos|open[- ]source|programming|developers?|javascript|typescript|python|rust|sqlite|postgres|databases?|browsers?|cloud|robots?|robotics|electric vehicles?|\bEVs?\b|batter(?:y|ies)|rockets?|spacex|satellites?|starlink|github)\b/i,
    /半導体|スマホ|ソフトウェア|オープンソース|ロボット|クラウド|アプリ|プログラミング|エンジニア|新製品|ロケット|衛星|電気自動車/,
  ],
  sports: [
    /\b(?:football|soccer|nba|nfl|mlb|nhl|baseball|basketball|tennis|golf|olympics?|world cup|world series|super bowl|formula 1|\bF1\b|ufc|boxing|marathon|playoffs?|champions league|premier league|grand slam)\b/i,
    /野球|サッカー|大谷|五輪|オリンピック|試合|優勝|W杯|ワールドカップ|相撲|ラグビー|選手|甲子園|Jリーグ|日本シリーズ/,
  ],
  culture: [
    /\b(?:memes?|slang|anime|manga|gaming|video games?|music|songs?|albums?|movies?|films?|tv shows?|netflix|drama|vtubers?|idols?|celebrit(?:y|ies)|fashion|tiktok|viral|aesthetic|fandom|k-?pop|trailer|box office)\b/i,
    /アニメ|漫画|マンガ|ゲーム|音楽|映画|ドラマ|アイドル|声優|ミーム|構文|界隈|推し|VTuber|ボカロ|歌ってみた|配信者|流行語|若者言葉/,
  ],
};
const TOPIC_PRIORITY = ['security', 'politics', 'economy', 'science', 'ai', 'society', 'technology', 'sports', 'culture'];
const GENRE_FALLBACK = { slang: 'culture', video: 'culture', sns: 'culture', community: 'culture', tech: 'technology', mainstream: 'other' };

const GLOBAL_RULES = Object.fromEntries(
  Object.entries(RULES).map(([id, list]) => [id, list.map((re) => new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'))]),
);

function matchCount(rules, text) {
  let n = 0;
  for (const re of rules) n += (text.match(re) || []).length;
  return n;
}

/**
 * 話題の内容から分類する
 * @param {{terms?:string[], texts?:string[], genres?:string[], slang?:number}} o
 *   terms : 語そのもの（重み 2 倍） / texts : 用例の見出し・投稿
 * @returns {{topic:string, topics:string[], matched:boolean}}
 */
export function classifyTopic({ terms = [], texts = [], genres = [], slang = 0 } = {}) {
  const termText = terms.join(' \n ');
  const bodyText = texts.join(' \n ');
  const scores = {};
  for (const id of TOPIC_PRIORITY) {
    const s = 2 * matchCount(GLOBAL_RULES[id], termText) + matchCount(GLOBAL_RULES[id], bodyText);
    if (s > 0) scores[id] = s;
  }
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1] || TOPIC_PRIORITY.indexOf(a[0]) - TOPIC_PRIORITY.indexOf(b[0]));
  if (ranked.length) {
    // 主分類の半分以上の強さで当たった分類を副分類として残す（フィルタで両方から見えるように）
    const top = ranked[0][1];
    const topics = ranked.filter(([, s]) => s >= Math.max(1, top / 2)).map(([id]) => id);
    return { topic: ranked[0][0], topics, matched: true };
  }
  const g = genres.find((x) => x !== 'mainstream') || genres[0];
  const fallback = slang >= 0.45 ? 'culture' : GENRE_FALLBACK[g] || 'other';
  return { topic: fallback, topics: [fallback], matched: false };
}

/* ------------------------------------------------------------------ *
 * 2) 情報源の種類（SNS 投稿／報道／公式発表／論文／リポジトリ…）
 * ------------------------------------------------------------------ */
export const SOURCE_TYPES = {
  official: '公式発表',
  paper: '論文・プレプリント',
  news: '報道',
  web: 'Web記事・ブログ',
  repo: 'リポジトリ',
  sns: 'SNS投稿',
  reference: '辞典・百科',
  search: '検索トレンド',
};

const PAPER_HOSTS = /(?:^|\.)(?:arxiv\.org|doi\.org|nature\.com|science\.org|sciencemag\.org|cell\.com|thelancet\.com|nejm\.org|biorxiv\.org|medrxiv\.org|pnas\.org|acm\.org|ieee\.org|springer\.com|link\.springer\.com|sciencedirect\.com|plos\.org|ssrn\.com|openreview\.net|aclanthology\.org|jstage\.jst\.go\.jp|cir\.nii\.ac\.jp|semanticscholar\.org|pubmed\.ncbi\.nlm\.nih\.gov|ncbi\.nlm\.nih\.gov|zenodo\.org|hal\.science)$/i;
const OFFICIAL_HOSTS = /(?:\.gov|\.gov\.[a-z]{2}|\.go\.jp|\.lg\.jp|\.mil|\.int|europa\.eu|un\.org|who\.int|imf\.org|worldbank\.org|oecd\.org|boj\.or\.jp|federalreserve\.gov|ecb\.europa\.eu)$/i;
// 企業・研究機関の一次発表（ニュースルーム・公式ブログ）
const OFFICIAL_PATHS = /^(?:(?:www\.)?(?:openai\.com|anthropic\.com|deepmind\.google|blog\.google|ai\.meta\.com|about\.fb\.com|nvidianews\.nvidia\.com|apple\.com\/newsroom|news\.microsoft\.com|blogs\.microsoft\.com|aws\.amazon\.com\/blogs|blog\.rust-lang\.org|lean-lang\.org|press\.|newsroom\.|ir\.)|[a-z0-9.-]+\.(?:ac\.jp|edu)\/)/i;
const REPO_HOSTS = /(?:^|\.)(?:github\.com|gitlab\.com|codeberg\.org|huggingface\.co|sourceforge\.net|bitbucket\.org|npmjs\.com|pypi\.org|crates\.io)$/i;
const SNS_HOSTS = /(?:^|\.)(?:bsky\.app|reddit\.com|redd\.it|misskey\.io|lemmy\.world|nicovideo\.jp|x\.com|twitter\.com|youtube\.com|youtu\.be|tiktok\.com|instagram\.com|facebook\.com|threads\.net|news\.ycombinator\.com|lobste\.rs|b\.hatena\.ne\.jp|mastodon\.social|mstdn\.jp|fosstodon\.org|mas\.to|example\.social|note\.com|medium\.com|substack\.com)$/i;
const NEWS_HOSTS = /(?:^|\.)(?:reuters\.com|apnews\.com|bbc\.co\.uk|bbc\.com|nytimes\.com|washingtonpost\.com|theguardian\.com|wsj\.com|ft\.com|bloomberg\.com|cnbc\.com|cnn\.com|npr\.org|aljazeera\.com|theverge\.com|arstechnica\.com|techcrunch\.com|wired\.com|engadget\.com|axios\.com|politico\.com|economist\.com|theatlantic\.com|404media\.co|zdnet\.com|venturebeat\.com|businessinsider\.com|forbes\.com|fortune\.com|quantamagazine\.org|newscientist\.com|scientificamerican\.com|technologyreview\.com|theregister\.com|bleepingcomputer\.com|nhk\.or\.jp|asahi\.com|mainichi\.jp|yomiuri\.co\.jp|nikkei\.com|sankei\.com|jiji\.com|kyodonews\.net|nordot\.app|itmedia\.co\.jp|impress\.co\.jp|gigazine\.net|japantimes\.co\.jp|toyokeizai\.net|news\.yahoo\.co\.jp|nikkansports\.com|47news\.jp|tokyo-np\.co\.jp|afpbb\.com|cnn\.co\.jp|bbc\.co\.jp|lemonde\.fr|spiegel\.de|dw\.com|france24\.com|abc\.net\.au|cbc\.ca|nbcnews\.com|cbsnews\.com|abcnews\.go\.com|foxnews\.com|usatoday\.com|latimes\.com|time\.com|newsweek\.com|semafor\.com|theinformation\.com|scmp\.com|nikkei\.asia|koreaherald\.com|yna\.co\.kr)$/i;

export function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** シグナル 1 件の情報源の種類。外部記事を指していれば記事側（link）で判定する */
export function sourceTypeOf(sig) {
  if (sig?.src === 'googletrends') return 'search';
  if (sig?.src === 'wikipedia' || sig?.src === 'urbandictionary' || sig?.src === 'knowyourmeme') return 'reference';
  const target = sig?.link || sig?.url || '';
  const host = hostOf(target);
  if (!host) return sig?.src === 'github' ? 'repo' : 'sns';
  let path = '';
  try {
    const u = new URL(target);
    path = (u.hostname.replace(/^www\./, '') + u.pathname).toLowerCase();
  } catch {
    /* noop */
  }
  if (PAPER_HOSTS.test(host)) return 'paper';
  if (OFFICIAL_HOSTS.test(host) || OFFICIAL_PATHS.test(path)) return 'official';
  if (REPO_HOSTS.test(host)) return 'repo';
  if (SNS_HOSTS.test(host)) return 'sns';
  if (NEWS_HOSTS.test(host) || /(?:^|\.)(?:news|press|times|post|journal|herald|tribune|shimbun)\./i.test(host + '.')) return 'news';
  // はてブはブックマーク先（記事そのもの）を url に持つので、SNS ではなく Web 記事として扱う
  return 'web';
}

/* ------------------------------------------------------------------ *
 * 3) 検証状態
 * ------------------------------------------------------------------ */
export const VERIFICATION = {
  confirmed: { label: '確認済み', desc: '2 つ以上の独立した報道・公式・論文ドメインが言及（事実そのものの最終確認ではありません）' },
  investigating: { label: '調査中', desc: '報道・公式・論文のいずれか 1 系統のみ。独立した裏付けを待っています' },
  unverified: { label: '未検証', desc: 'SNS 投稿・リポジトリ・検索トレンドのみ。報道や公式の裏付けはまだありません' },
  disputed: { label: '誤情報の可能性', desc: 'デマ・誤情報・捏造などの指摘を含む投稿があります。一次情報で確認してください' },
};

const MISINFO = /\b(?:hoax|fake news|debunk(?:ed|s)?|misinformation|disinformation|false claims?|fabricated|doctored|deepfakes?|not true|fact[- ]check(?:ed)?|scam|retracted|retraction)\b|デマ|誤情報|偽情報|フェイク|捏造|事実無根|虚偽|撤回|なりすまし|ファクトチェック/i;
export const CAUTIOUS = /\b(?:rumou?rs?|rumored|reportedly|alleged(?:ly)?|claims?|claimed|unconfirmed|may|could|might|expected to|set to|leaks?|leaked)\b|疑惑|可能性|見通し|との報道|予測|うわさ|噂|リーク|とみられる|[?？]\s*$|か$|か[　 ]/i;
const STRONG = new Set(['official', 'paper', 'news']);
const PUBLISHER = new Set(['official', 'paper', 'news', 'web']);
const REPLICATED = /\b(?:independently (?:verified|confirmed|replicated|reproduced)|replicat(?:ed|ion)|reproduced by|peer[- ]reviewed|confirmed by (?:independent|other) (?:researchers|teams))\b|独立(?:に|した)?(?:検証|確認)(?:され|に成功)|追試(?:に成功|で確認)|再現に成功|査読済み/i;

/**
 * 根拠となるシグナル群から検証状態を判定する。
 * 「情報が未確認」であることは除外の理由にしない（状態を付けて表示するだけ）。
 * @param {Array<object>} evidence  シグナル（src, url, link, text）
 * @param {{importance?:number|null}} [o]
 */
export function assessVerification(evidence = [], { importance = null } = {}) {
  const byType = {};
  const strongHosts = new Set(); // 報道・公式・論文の発信元
  const reporters = new Set(); // そのうち論文そのものを除いたもの（論文は「主張」であって裏付けではない）
  const publishers = new Set(); // SNS・検索・辞典を除く発信元ドメイン
  let misinfo = false;
  let cautious = false;
  let replicated = false;
  for (const s of evidence) {
    const type = s.type || sourceTypeOf(s);
    byType[type] = (byType[type] || 0) + 1;
    const host = hostOf(s.link || s.url);
    if (host && PUBLISHER.has(type)) publishers.add(host);
    if (STRONG.has(type) && host) strongHosts.add(host);
    if ((type === 'news' || type === 'official') && host) reporters.add(host);
    const text = String(s.text || s.x || '');
    if (MISINFO.test(text)) misinfo = true;
    if (CAUTIOUS.test(text)) cautious = true;
    if (REPLICATED.test(text)) replicated = true;
  }
  const has = (t) => (byType[t] || 0) > 0;
  let status;
  if (misinfo) status = 'disputed';
  else if (reporters.size >= 2) status = 'confirmed';
  else if (strongHosts.size >= 1) status = 'investigating';
  else status = 'unverified';

  // 段階：研究は「発表」と「独立検証」、ソフトウェアは「公開」と「動作確認」を区別する
  let stage = null;
  if (has('paper')) stage = replicated ? 'research-replicated' : reporters.size ? 'research-reported' : 'research-announced';
  else if (has('repo')) stage = reporters.size ? 'software-reported' : 'software-released';

  const notes = [];
  if (misinfo) notes.push('デマ・誤情報・撤回などの指摘を含む投稿があります。');
  if (stage === 'research-announced') notes.push('研究の発表段階です。独立した検証・追試はまだ確認できていません。');
  if (stage === 'research-reported') notes.push('論文・プレプリントとその報道はありますが、第三者による独立検証は確認できていません。');
  if (stage === 'research-replicated') notes.push('独立した検証・追試に言及する情報があります（内容は一次情報で確認してください）。');
  if (stage === 'software-released') notes.push('ソフトウェア／リポジトリの公開のみです。実際に動作するかは確認されていません。');
  if (stage === 'software-reported') notes.push('ソフトウェアの公開と報道はありますが、実際の動作は確認されていません。');
  if (cautious) notes.push('推測・疑惑・疑問形を含む表現があります。');
  if (status === 'unverified' && has('sns')) notes.push('SNS 上の投稿のみで、報道や公式の裏付けはまだありません。');
  if (status !== 'confirmed' && importance != null && importance >= 60) notes.push('重大な主張のため、複数の独立した情報源での確認が必要です。');
  if (status === 'confirmed') notes.push('複数の独立した情報源が言及しています（内容の真偽を最終確認したものではありません）。');

  return {
    status,
    label: VERIFICATION[status].label,
    stage,
    byType,
    independent: reporters.size,
    domains: publishers.size,
    cautious,
    notes,
  };
}

/* ------------------------------------------------------------------ *
 * 4) 社会的重要度（SNS の注目度とは独立）
 * ------------------------------------------------------------------ */
const NOVEL = /\b(?:first(?:-ever)?|breakthrough|unprecedented|historic|record(?:-breaking)?|new species|world'?s first|solved|resolves?|landmark|milestone)\b|世界初|初めて|史上初|前例のない|画期的|快挙|解決/i;
const SCI_SIG = /\b(?:theorem|proof|proves|proved|hypothesis|conjecture|peer[- ]reviewed|clinical trial|discovery|nature paper|published in)\b|証明|定理|予想|論文|治験|発見/i;
const ECON_SIG = /\b(?:billion|trillion|stocks? (?:fell|plunge|plunged|slid|slump|tumble|surge|soar)|sell-?off|layoffs?|recession|market cap|rate (?:cut|hike))\b|兆円|億円|株価(?:急落|急騰|下落|上昇)|大幅安|大幅高|リストラ|利上げ|利下げ/i;
const SOC_SIG = /\b(?:killed|deaths?|dead|injured|evacuat|earthquake|tsunami|outbreak|ban(?:s|ned)?|law|ruling|mass|nationwide|millions of|protests?|backlash)\b|死者|負傷|避難|地震|津波|感染拡大|禁止|法案|判決|全国|数百万|抗議|反発/i;

/**
 * @param {object} o
 * @param {string[]} o.topics      classifyTopic の topics
 * @param {boolean}  o.matched     内容から分類できたか
 * @param {string[]} o.texts       用例テキスト
 * @param {string[]} o.langs       出現した言語（ja/en）
 * @param {Record<string,number>} o.byType   情報源の種類ごとの件数
 * @param {number}   o.posts       独立した投稿（記事）数
 * @param {number}   o.domains     発信元ドメイン数
 * @param {number}   o.spread      媒体数
 * @param {number}   o.ageH        初観測からの経過時間
 * @param {string}   o.verification  assessVerification().status
 * @returns {{importance:number|null, confidence:'low'|'medium'|'high', factors:Array<{k:string,v:number}>, reason:string}}
 */
export function scoreImportance({ topics = ['other'], matched = false, texts = [], langs = [], byType = {}, posts = 1, domains = 0, spread = 1, ageH = 0, verification = 'unverified', slang = 0, hasContext = true }) {
  const strong = (byType.news || 0) + (byType.official || 0) + (byType.paper || 0);
  // データ不足：内容から分類できず、裏付けも 1 件しかない → 重要度は確定しない
  if (!matched && posts <= 1 && domains <= 1 && strong === 0) {
    return { importance: null, confidence: 'low', factors: [], reason: 'データ不足のため判定保留' };
  }
  // 語の名前しか分からない（見出し・本文の文脈がない）→ 何が起きたか不明なので確定しない
  if (!hasContext && strong === 0) {
    return { importance: null, confidence: 'low', factors: [], reason: '文脈となる見出し・投稿がないため判定保留' };
  }
  const text = texts.join(' \n ');
  const factors = [];
  const base = Math.max(...topics.map((t) => TOPIC_MAP[t]?.base ?? 26));
  factors.push({ k: `分野（${topics.map((t) => TOPIC_MAP[t]?.label ?? t).join('・')}）`, v: base });
  if (topics.length >= 2) factors.push({ k: '複数分野にまたがる', v: 4 });

  // 影響範囲：言語圏・情報源の多様さ・発信元の数
  const regions = new Set(langs.filter((l) => l === 'ja' || l === 'en')).size;
  if (regions >= 2) factors.push({ k: '日本語圏・英語圏の両方で観測', v: 6 });
  const typeKinds = Object.keys(byType).filter((t) => byType[t] > 0).length;
  if (typeKinds >= 3) factors.push({ k: '異なる種類の情報源（報道・SNS など）', v: 4 });
  if (domains >= 3) factors.push({ k: `発信元ドメイン ${domains} 件`, v: Math.min(8, 2 * (domains - 2)) });
  else if (spread >= 3) factors.push({ k: `${spread} 媒体で観測`, v: 3 });

  // 新規性・科学・経済・社会への影響（見出しの表現から）
  if (NOVEL.test(text)) factors.push({ k: '新規性（初・画期的などの記述）', v: 6 });
  if (byType.paper || (topics.includes('science') && SCI_SIG.test(text))) factors.push({ k: '科学的意義（論文・証明・発見）', v: 6 });
  if (ECON_SIG.test(text)) factors.push({ k: '経済的影響（金額・株価・雇用）', v: 6 });
  if (SOC_SIG.test(text)) factors.push({ k: '社会への影響（被害・制度・抗議）', v: 6 });
  if (byType.official) factors.push({ k: '公式発表を含む', v: 4 });
  if (ageH < 24) factors.push({ k: '24時間以内に出現', v: 2 });
  if (slang >= 0.5 && strong === 0) factors.push({ k: 'ネットスラング・ミーム的な語', v: -14 });
  if (verification === 'disputed') factors.push({ k: '誤情報の可能性', v: -10 });

  const importance = Math.max(0, Math.min(100, Math.round(factors.reduce((a, f) => a + f.v, 0))));
  const confidence = strong >= 2 && posts >= 2 ? 'high' : strong >= 1 || posts >= 3 || domains >= 2 ? 'medium' : 'low';
  const reason = factors
    .slice()
    .sort((a, b) => b.v - a.v)
    .slice(0, 3)
    .map((f) => f.k)
    .join(' / ');
  return { importance, confidence, factors, reason };
}
