/**
 * World intelligence: separate potential societal impact from trend popularity.
 * Heuristic only: multiple feeds do not constitute independent fact checking.
 */

const SUSPECT_GITHUB = /(?:\b(?:crack(?:ed)?|keygen|activator|activation|cheat|pirated?|undetected)\b|dlc[-_ ]?unl[o0]ck|free[-_ ]?adobe|genp|unlock(?:er|ed)[-_ ]?(?:dlc|tool)|(?:office|capcut|filmora|lightroom|after.effects|indesign)[-_ ]?(?:pro[-_ ]?)?(?:for[-_ ]?)?(?:windows|macos)[-_ ]?and[-_ ]?)/i;
const GENERIC = new Set(['windows','mode','zero','system','server','desktop','software','private','ready','test','rule','named','major','awesome','lightweight','animation','automation','computer','developer-tools','open-source','管理','分析','新聞']);
export const isGenericTerm = (word) => GENERIC.has(String(word || '').normalize('NFKC').toLowerCase().trim());
export const isSuspiciousSignal = (s) => s?.src === 'github' && SUSPECT_GITHUB.test([s.text,s.ctx,s.url].join(' '));

function canonicalUrl(raw) {
  try {
    const u = new URL(raw);
    if (!['https:','http:'].includes(u.protocol)) return '';
    u.hash = '';
    for (const key of [...u.searchParams.keys()]) if (/^utm_|^(?:fbclid|gclid|ref|campaign)$/i.test(key)) u.searchParams.delete(key);
    u.searchParams.sort();
    return u.href.replace(/\/$/, '');
  } catch { return ''; }
}

/** Keep original raw streams for inspection. Filter only the scored signals. */
export function prepareSignals(signals = []) {
  const clean = [], rejected = [], seen = new Set();
  for (const s of signals) {
    if (!String(s?.text || '').trim()) continue;
    if (isSuspiciousSignal(s)) { rejected.push({ src:s.src, reason:'suspicious-distribution' }); continue; }
    const identity = canonicalUrl(s.url) || String(s.text).normalize('NFKC').toLowerCase().trim();
    const key = String(s.src) + '|' + identity;
    if (seen.has(key)) { rejected.push({ src:s.src, reason:'duplicate' }); continue; }
    seen.add(key);
    clean.push(s);
  }
  return { clean, rejected };
}

// Scores represent a transparent editorial priority heuristic, not verified
// risk, truthfulness, actual magnitude or a forecast of market moves.
const CATEGORIES = [
  { id:'security', label:'サイバー・セキュリティ', base:89, re:/(?:CVE-\d{4}-\d+|java4shell|vulnerabilit|malware|ransomware|\bRCE\b|cyber.?attack|data breach|security flaw|情報漏洩|脆弱性|不正アクセス|サイバー攻撃)/i },
  { id:'infrastructure', label:'社会インフラ', base:82, re:/(?:services? down|outage|flight stoppage|blackout|power failure|system outage|network disruption|インフラ障害|大規模障害|停電|運航停止)/i },
  { id:'geopolitics', label:'地政学・安全保障', base:80, re:/(?:ukrain|russia|crimea|kerch|military strike|missile|invasion|ceasefire|geopolitic|warfare|侵攻|軍事|停戦|戦争|台湾有事|クリミア|ウクライナ)/i },
  { id:'markets', label:'経済・金融', base:75, re:/(?:earnings|IPO|financial results|revenue forecast|stocks? (?:slide|plunge|surge)|inflation|interest rate|data center investment|決算|株式市場|上場|株価|金融市場|物価上昇)/i },
  { id:'policy', label:'政治・制度', base:66, re:/(?:regulat|court ruling|lawsuit|\bbans?\b|\bbanned\b|\bnominee\b|\bFDA\b|\bFAA\b|congress|senate|ballot measure|政府|法案|規制|指名撤回|禁止|裁判所|議会)/i },
  { id:'technology', label:'科学・テクノロジー', base:58, re:/(?:research breakthrough|clinical trial|new semiconductor|quantum computer|new ai model|autonomous vehicle|self.driving|新技術|研究成果|量子コンピュータ|自動運転)/i },
];
const CAUTION = /(?:\brumou?r\b|\brumored\b|\breportedly\b|\balleged?\b|\bclaims?\b|\bmay\b|\bcould\b|\bbefore\b|\bahead of\b|\bexpected\b|\bset to\b|疑惑|可能性|見通し|との報道|予測|うわさ)/i;
const STOP = new Set(['the','and','with','from','that','this','after','before','for','are','was','will','says','new','into','amid','over','under','its','not','has','been','against','more','about','they','their']);

function keywords(title) {
  const parts = String(title).toLowerCase().normalize('NFKC').match(/[a-z][a-z0-9-]{2,}|[\p{Script=Han}]{2,}|[\p{Script=Katakana}]{2,}/gu) || [];
  return [...new Set(parts.filter((x) => x.length > 2 && !STOP.has(x)))];
}
function sameEvent(g, x) {
  if (g.category !== x.category) return false;
  if (g.urlKey && g.urlKey === x.urlKey) return true;
  const a = new Set(g.words), b = new Set(x.words);
  const shared = [...a].filter((word) => b.has(word)).length;
  return shared >= 2 && shared / Math.max(1, Math.min(a.size, b.size)) >= 0.6;
}

/** Return evidence-linked candidate events, never claims of verified facts. */
export function buildWorldBrief(signals, { now = Date.now(), rejected = [] } = {}) {
  const groups = [];
  for (const s of signals || []) {
    if (s.src === 'github') continue; // Repo promotion is not a news citation.
    const title = String(s.text || '').trim();
    if (title.length < 16 || title.length > 300) continue;
    const cat = CATEGORIES.find((c) => c.re.test(title));
    if (!cat) continue;
    const ts = Number(s.ts) || now, ageH = Math.max(0, (now - ts) / 3.6e6);
    if (ageH > 72) continue;
    const url = canonicalUrl(s.url);
    if (!url) continue;
    const item = { title, category:cat.id, label:cat.label, base:cat.base, words:keywords(title), urlKey:url, source:s.src, url, ts, cautious:CAUTION.test(title) };
    let group = groups.find((g) => sameEvent(g, item));
    if (!group) { group = { ...item, evidence:[], latest:ts }; groups.push(group); }
    if (!group.evidence.some((e) => e.source === item.source && e.url === url)) group.evidence.push({ source:item.source, title, url, ts });
    group.latest = Math.max(group.latest, ts);
    group.cautious ||= item.cautious;
  }
  const events = groups.map((g) => {
    const nSources = new Set(g.evidence.map((e) => e.source)).size;
    const nPublishers = new Set(g.evidence.map((e) => { try { return new URL(e.url).hostname.replace(/^www\./, ''); } catch { return ''; } })).size;
    const ageH = Math.max(0, (now - g.latest) / 3.6e6);
    const impact = Math.max(0, Math.min(100, Math.round(g.base + Math.min(8, (nSources - 1) * 4) + 5 * Math.exp(-ageH / 24) - (g.cautious ? 3 : 0))));
    const evidence=[], used = new Set();
    for (const e of g.evidence.sort((a,b)=>b.ts-a.ts)) {
      if (used.has(e.source)) continue;
      evidence.push(e); used.add(e.source);
      if (evidence.length >= 5) break;
    }
    return {
      title:g.title, category:g.category, categoryLabel:g.label, impact, at:g.latest,
      sourceCount:nSources, publisherCount:nPublishers, evidence,
      status:nSources > 1 ? '複数チャネルで言及・真偽未検証' : '単独観測・真偽未検証',
      caution:g.cautious ? '予測・疑惑・時点依存の表現を含む可能性。一次情報で確認してください。' : '重要度は自動推定です。内容の真偽は一次情報で確認してください。',
    };
  }).sort((a,b)=>b.impact-a.impact || b.sourceCount-a.sourceCount || b.at-a.at).slice(0,30);
  return {
    version:1, generatedAt:now,
    disclaimer:'自動抽出による重要度の推定であり、事実確認・報道の独立性の証明ではありません。',
    stats:{
      reviewed:(signals || []).length,
      flagged:rejected.filter((r)=>r.reason==='suspicious-distribution').length,
      duplicates:rejected.filter((r)=>r.reason==='duplicate').length,
      events:events.length,
      byCategory:Object.fromEntries(CATEGORIES.map((c)=>[c.id,events.filter((e)=>e.category===c.id).length])),
    }, events,
  };
}
