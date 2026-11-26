/**
 * World intelligence: separate potential societal impact from trend popularity.
 * Heuristic only: multiple feeds do not constitute independent fact checking.
 */

const SUSPECT_GITHUB = /(?:\b(?:crack(?:ed)?|keygen|activator|activation|cheat|pirated?|undetected)\b|dlc[-_ ]?unl[o0]ck|free[-_ ]?adobe|genp|unlock(?:er|ed)[-_ ]?(?:dlc|tool)|(?:office|capcut|filmora|lightroom|after.effects|indesign)[-_ ]?(?:pro[-_ ]?)?(?:for[-_ ]?)?(?:windows|macos)[-_ ]?and[-_ ]?)/i;
const GENERIC = new Set(['windows','mode','zero','system','server','desktop','software','private','ready','test','rule','named','major','awesome','lightweight','animation','automation','computer','developer-tools','open-source','管理','分析','新聞']);
export const isGenericTerm = (word) => GENERIC.has(String(word || '').normalize('NFKC').toLowerCase().trim());
// Restrict promotional cheat/unauthorized distribution filtering to GitHub repository listings.
// A legitimate security report mentioning an exploit is not a downloadable cheat release.
const SUSPICIOUS_GITHUB_DISTRIBUTION = /(?:\b(?:aimbot|wallhack|cheats?|keygen|pirated|cracked|activator|auto[-_ ]?farm|mod[-_ ]?menu|premium[-_ ]?free|fully[-_ ]?unlocked)\b|\b(?:aim[-_ ]?wh[-_ ]?hacks|rob[-_ ]?run[-_ ]?(?:aim|bush|cheat))\b)/i;
export const isSuspiciousSignal = (s) =>
  s?.src === 'github' && (SUSPECT_GITHUB.test([s.text,s.ctx,s.url].join(' ')) ||
    SUSPICIOUS_GITHUB_DISTRIBUTION.test([s.text,s.ctx,s.url].join(' ')));

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
  { id:'security', label:'サイバー・セキュリティ', base:89, re:/(?:CVE-\d{4}-\d+|java4shell|vulnerabilit|malware|ransomware|\bRCE\b|cyber.?attack|data breach|security flaw|情報漏[え洩]い?|情報流出|脆弱性|不正アクセス|サイバー攻撃)/i },
  { id:'infrastructure', label:'社会インフラ', base:82, re:/(?:services? down|outage|flight stoppage|blackout|power failure|system outage|network disruption|インフラ障害|大規模障害|停電|運航停止)/i },
  { id:'geopolitics', label:'地政学・安全保障', base:80, re:/(?:ukrain|russia|crimea|kerch|military strike|missile|invasion|ceasefire|geopolitic|warfare|侵攻|軍事|停戦|戦争|台湾有事|クリミア|ウクライナ)/i },
  { id:'markets', label:'経済・金融', base:75, re:/(?:earnings|IPO|financial results|revenue forecast|stocks? (?:slide|plunge|surge)|inflation|interest rate|FOMC statement|monetary policy decision|data center investment|net migration|immigration statistics|labour market statistics|純移民|移民統計|決算|株式市場|上場|株価|金融市場|物価上昇)/i },
  { id:'policy', label:'政治・制度', base:66, re:/(?:regulat|court ruling|lawsuit|export controls?|export restrictions?|(?:regulated|restricted|banned) (?:NVIDIA )?GPUs?|規制されているNVIDIAのGPU|輸出規制|輸出管理|\bbans?\b|\bbanned\b|\bnominee\b|\bFDA\b|\bFAA\b|congress|senate|ballot measure|政府|法案|規制|指名撤回|禁止|裁判所|議会)/i },
  { id:'technology', label:'科学・テクノロジー', base:76, re:/(?:research breakthrough|first direct detection|gravitational wave detection|new particle discovery|phase (?:III|3) clinical trial|millennium prize problem|generalized riemann hypothesis|riemann hypothesis|リーマン予想|formal proof|形式証明|orbital data cent[er]+|data cent(?:er|re)s? in space|宇宙データセンター|asteroid impact crater|clinical trial|new semiconductor|quantum computer|new ai model|autonomous vehicle|self.driving|新技術|研究成果|量子コンピュータ|自動運転)/i },
];
// Research artifacts are leads, not independent reporting. Do not promote generic repositories.
const RESEARCH_LEAD = /(?:generalized riemann hypothesis|riemann hypothesis|リーマン予想|formal proof|形式証明|millennium prize problem|P versus NP|P vs NP|navier.stokes (?:existence|regularity)|birch.and.swinnerton.dyer|hodge conjecture)/i;
const RESEARCH_RESULT = /(?:\bproof\b|\bproves?\b|\bdisproof\b|\btheorem\b|\bformaliz\w*\b|証明|反証)/i;
const PERIODIC = /(?:throwbackthursday|thursdayfivelist|doorsday|wipwednesday|whiskerswednesday|いい風呂の日|自由律すぎ俳句|画像をなんでもいいので|今日の(?:写真|イラスト))/i;
const HYPOTHETICAL = /^(?:when |what if |imagine |もし)|(?:will occasionally just show up|wouldn't it be|shower thought)/i;
const QUERY_ONLY = /^(?:report power outage|power outage|outage map|停電情報|停電|outage)$/i;
const STRONG = /(?:generalized riemann hypothesis|riemann hypothesis|リーマン予想|orbital data cent[er]+|data cent(?:er|re)s? in space|宇宙データセンター|critical vulnerability|actively exploited|zero.day|重大な脆弱性|net migration|純移民|export controls?|(?:regulated|restricted|banned) (?:NVIDIA )?GPUs?|規制されているNVIDIAのGPU|輸出規制|大規模障害)/i;
const MATERIAL = /(?:customer|personal data|個人情報|顧客|万人|万件|million|billion|全国|national|critical infrastructure|基幹インフラ|emergency|緊急)/i;
const WORLD_ONLY = (source) => String(source).startsWith('world_');
const CAUTION = /(?:\brumou?r\b|\brumored\b|\breportedly\b|\balleged?\b|\bclaims?\b|\bmay\b|\bcould\b|\bbefore\b|\bahead of\b|\bexpected\b|\bset to\b|疑惑|可能性|見通し|との報道|予測|うわさ)/i;
const STOP = new Set(['the','and','with','from','that','this','after','before','for','are','was','will','says','new','into','amid','over','under','its','not','has','been','against','more','about','they','their']);

function keywords(title) {
  const parts = String(title).toLowerCase().normalize('NFKC').match(/[a-z][a-z0-9-]{2,}|[\p{Script=Han}]{2,}|[\p{Script=Katakana}]{2,}/gu) || [];
  return [...new Set(parts.filter((x) => x.length > 2 && !STOP.has(x)))];
}
function cveIds(title) {
  return [...new Set((String(title).match(/CVE-\d{4}-\d{4,}/gi) || []).map((x) => x.toUpperCase()))].sort();
}
function eventId(g) {
  // Stable for one CVE or one canonical source URL; not an assertion of identity across syndication.
  const key = g.cves.length ? g.cves.join('+') : g.category + '|' + g.urlKey;
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return 'uc-' + (hash >>> 0).toString(16).padStart(8, '0');
}
function sameEvent(g, x) {
  // Similar headlines about different disclosed vulnerabilities are different incidents.
  if (g.cves.length && x.cves.length && !g.cves.some((id) => x.cves.includes(id))) return false;
  if (g.category !== x.category) return false;
  if (g.urlKey && g.urlKey === x.urlKey) return true;
  const a = new Set(g.words), b = new Set(x.words);
  const shared = [...a].filter((word) => b.has(word)).length;
  return shared >= 2 && shared / Math.max(1, Math.min(a.size, b.size)) >= 0.6;
}

/** Return evidence-linked candidate events, never claims of verified facts. */
export function buildWorldBrief(signals, { now = Date.now(), rejected = [], terms = [] } = {}) {
  // Use only current-run URL-linked trend samples. No match is unknown, not zero.
  const attentionByUrl = new Map();
  for (const t of terms) {
    if (!Number.isFinite(t.score)) continue;
    for (const s of t.samples || []) {
      if (!Number.isFinite(s.ts) || s.ts < now - 72 * 3.6e6 || s.ts > now) continue;
      const key = canonicalUrl(s.u);
      if (key) attentionByUrl.set(key, Math.max(attentionByUrl.get(key) ?? 0, t.score));
    }
  }
  let lowValueExcluded = 0;
  const groups = [];
  for (const s of signals || []) {
    const title = String(s.text || '').trim();
    if (PERIODIC.test(title) || HYPOTHETICAL.test(title) || QUERY_ONLY.test(title) || ['urbandictionary','knowyourmeme','niconico','wikipedia'].includes(s.src)) {
      lowValueExcluded++; continue;
    }
    const researchLead = s.src === 'github' && RESEARCH_LEAD.test(title) && RESEARCH_RESULT.test(title);
    if (s.src === 'github' && (!researchLead || isSuspiciousSignal(s))) continue;
    if (title.length < 16 || title.length > 300) continue;
    const cat = researchLead ? CATEGORIES.find((c) => c.id === 'technology') : CATEGORIES.find((c) => c.re.test(title));
    // Routine papers are not automatically breakthroughs simply because arXiv published them.
    if (String(s.src).startsWith('world_arxiv') && !STRONG.test(title) && !RESEARCH_LEAD.test(title) && !/(?:first direct detection|new particle discovery|gravitational wave detection)/i.test(title)) continue;
    if (!cat) continue;
    const ts = Number(s.ts) || now, ageH = Math.max(0, (now - ts) / 3.6e6);
    if (ageH > 72) continue;
    const url = canonicalUrl(s.url);
    if (!url) continue;
    const item = { title, category:cat.id, label:cat.label, base:cat.base, words:keywords(title), urlKey:url, source:s.src, url, ts, cves:cveIds(title), cautious:CAUTION.test(title), researchLead, direct:WORLD_ONLY(s.src) };
    let group = groups.find((g) => sameEvent(g, item));
    if (!group) { group = { ...item, evidence:[], latest:ts }; groups.push(group); }
    if (!group.evidence.some((e) => e.source === item.source && e.url === url)) group.evidence.push({ source:item.source, title, url, ts, kind:item.researchLead ? 'research-artifact' : item.direct ? 'direct-feed' : 'observed-headline' });
    group.latest = Math.max(group.latest, ts);
    group.cautious ||= item.cautious;
  }
  const events = groups.map((g) => {
    const nSources = new Set(g.evidence.map((e) => e.source)).size;
    const nPublishers = new Set(g.evidence.map((e) => { try { return new URL(e.url).hostname.replace(/^www\./, ''); } catch { return ''; } })).size;
    const ageH = Math.max(0, (now - g.latest) / 3.6e6);
    // Potential impact is independent of popularity, source count and truth status.
    const strong = g.evidence.some((e) => STRONG.test(e.title));
    const material = g.evidence.some((e) => MATERIAL.test(e.title));
    const impact = Math.max(0, Math.min(100, Math.round(g.base + (strong ? 12 : 0) + (material ? 5 : 0))));
    const attentionValues = g.evidence.map((e) => attentionByUrl.get(e.url)).filter(Number.isFinite);
    const attention = attentionValues.length ? Math.max(...attentionValues) : null;
    const priorityBand = impact < 70 ? 'low' : attention === null ? 'unknown-attention' : attention <= 45 ? 'hidden' : 'major';
    const discoveryPriority = Math.round(impact + (priorityBand === 'hidden' ? 25 : priorityBand === 'unknown-attention' ? 10 : 0) + 5 * Math.exp(-ageH / 24));
    const researchOnly = g.evidence.every((e) => e.kind === 'research-artifact' || String(e.source).startsWith('world_arxiv'));
    const evidence=[], used = new Set();
    for (const e of g.evidence.sort((a,b)=>b.ts-a.ts)) {
      if (used.has(e.source)) continue;
      evidence.push(e); used.add(e.source);
      if (evidence.length >= 5) break;
    }
    return {
      id:eventId(g), title:g.title, category:g.category, categoryLabel:g.label, impact, attention, priorityBand, discoveryPriority, at:g.latest,
      verificationStatus:'unverified',
      corroborationStatus:nPublishers > 1 ? 'multiple-publisher-domains-not-independent-verification' : 'single-publisher-domain',
      sourceCount:nSources, publisherCount:nPublishers, evidence,
      status:nSources > 1 ? '複数チャネルで言及・真偽未検証' : '単独観測・真偽未検証',
      caution:researchOnly ? '公開リポジトリまたはプレプリントによる研究上の主張です。証明・査読・独立検証は未確認です。' : g.cautious ? '予測・疑惑・時点依存の表現を含む可能性。一次情報で確認してください。' : '重要度は自動推定です。内容の真偽は一次情報で確認してください。',
    };
  }).filter((e) => e.priorityBand !== 'low').sort((a,b)=>b.discoveryPriority-a.discoveryPriority || b.impact-a.impact || b.at-a.at || a.id.localeCompare(b.id)).slice(0,30);
  return {
    version:2, generatedAt:now,
    disclaimer:'自動抽出による重要度の推定であり、事実確認・報道の独立性の証明ではありません。',
    stats:{
      reviewed:(signals || []).length,
      flagged:rejected.filter((r)=>r.reason==='suspicious-distribution').length,
      duplicates:rejected.filter((r)=>r.reason==='duplicate').length,
      lowValueExcluded,
      hidden:events.filter((e)=>e.priorityBand==='hidden').length,
      unknownAttention:events.filter((e)=>e.priorityBand==='unknown-attention').length,
      events:events.length,
      byCategory:Object.fromEntries(CATEGORIES.map((c)=>[c.id,events.filter((e)=>e.category===c.id).length])),
    }, events,
  };
}
