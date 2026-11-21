/**
 * cluster.js — 同じニュース・事件・研究・プロジェクトを指す語を 1 つの「トレンド」に統合し、
 *              観測をまたいで追跡する（継続性）
 *
 * 統合のルール（誤統合を避けるため保守的）：
 *   1. 注目度の高い語から順に「代表語」としてクラスタを作る
 *   2. 後続の語は、その語が出たストーリー（同じ記事・転載をまとめた単位）の 6 割以上が
 *      既存クラスタと重なり、かつ代表語とも 1 件以上同じストーリーに出ているときだけ合流する
 *      （A–B、B–C の連鎖で無関係な A と C がつながるのを防ぐ）
 *   3. 1 件のストーリーにしか出ていない語は、そのストーリーが「複数の確立した話題を並べた
 *      まとめ記事」でない場合に限り合流する
 *   4. 表記の包含（「生成AI切り抜き」⊂「生成AI切り抜き一色」、"Riemann Hypothesis" ⊂
 *      "Riemann Hypothesis proof"）は、短い側が 2 語以上（日本語は 4 文字以上）のときだけ同一視する
 * 統合された語・投稿・出典はすべて members / evidence に残る（元情報は失わない）。
 */

import { normKey, detectLang } from './text.js';
import { classifyTopic, assessVerification, scoreImportance, sourceTypeOf, hostOf } from './topics.js';
import { trendDirection, periodicityOf, voiceOf, changeOver, canonicalUrl, describeBasis } from './trend.js';

const H = 3.6e6;
const MAX_MEMBERS = 12;
const MAX_EVIDENCE = 8;
const THREAD_TTL_D = 14;
const THREAD_MAX = 600;
const THREAD_HIST = 40; // 3h × 40 = 5 日分
const SEEN_MAX = 60;
const EMA_ALPHA = 0.35;
const TYPE_RANK = { official: 6, paper: 5, news: 4, web: 3, repo: 2, sns: 1, reference: 0, search: 0 };

const r2 = (v) => Math.round(v * 100) / 100;

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/** 表記の包含で同一視してよいか（短い側が十分に具体的なときだけ） */
export function lexicallyContains(longer, shorter) {
  const a = normKey(longer);
  const b = normKey(shorter);
  if (!a || !b || a === b || b.length >= a.length) return false;
  if (detectLang(b) === 'en') {
    const words = b.split(' ');
    if (words.length < 2) return false;
    return new RegExp(`(^| )${b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`).test(a);
  }
  return b.length >= 4 && a.includes(b);
}

/**
 * 語をクラスタに統合する
 * @param {Array<object>} terms   score.js の terms（_hits / _heat 付き）
 * @param {Array<object>} signals
 * @param {number[]} stories      groupStories の出力
 * @returns {Array<{anchor:number, members:number[], stories:Set<number>}>}
 */
export function groupTerms(terms, signals, stories) {
  const sets = terms.map((t) => new Set((t._hits || []).map((i) => stories[i])));
  const order = terms.map((_, i) => i).sort((a, b) => terms[b].score - terms[a].score);
  const groups = [];
  for (const idx of order) {
    const S = sets[idx];
    if (!S.size) {
      groups.push({ anchor: idx, members: [idx], stories: new Set() });
      continue;
    }
    let best = null;
    for (const g of groups) {
      const anchorSet = sets[g.anchor];
      const lexical = lexicallyContains(terms[idx].t, terms[g.anchor].t) || lexicallyContains(terms[g.anchor].t, terms[idx].t);
      let shared = 0;
      let anchorShared = 0;
      for (const st of S) {
        if (g.stories.has(st)) shared += 1;
        if (anchorSet.has(st)) anchorShared += 1;
      }
      if (!lexical && anchorShared === 0) continue;
      const cont = shared / S.size;
      if (!lexical && cont < 0.6) continue;
      if (!lexical && S.size === 1) {
        // まとめ記事（確立した別の話題が 2 つ以上同居するストーリー）を根拠にした合流はしない
        const [only] = S;
        const hosts = groups.filter((x) => sets[x.anchor].size >= 2 && x.stories.has(only)).length;
        if (hosts >= 2) continue;
      }
      const fit = cont + (lexical ? 0.5 : 0) + (anchorShared ? 0.2 : 0);
      if (!best || fit > best.fit) best = { g, fit };
    }
    if (best) {
      best.g.members.push(idx);
      for (const st of S) best.g.stories.add(st);
    } else groups.push({ anchor: idx, members: [idx], stories: new Set(S) });
  }
  return groups;
}

/**
 * クラスタを表示用オブジェクトにする（重要度・検証状態・内容分類つき）
 * @param {object} o
 * @param {Array<object>} o.terms
 * @param {Array<object>} o.signals
 * @param {number[]} o.stories
 * @param {Record<string,{genre:string}>} o.sourceMap
 * @param {number} o.now
 */
export function buildClusters({ terms, signals, stories, sourceMap = {}, now = Date.now() }) {
  const groups = groupTerms(terms, signals, stories);
  const out = groups.map((g) => {
    const members = g.members.map((i) => terms[i]);
    const rep = members[0];
    const sigIdx = [...new Set(members.flatMap((m) => m._hits || []))];
    // ストーリーごとに代表シグナル（情報源の格 → 反応の大きさ順）
    const perStory = new Map();
    for (const i of sigIdx) {
      const sg = signals[i];
      const type = sourceTypeOf(sg);
      const st = stories[i];
      const cur = perStory.get(st);
      if (!cur || TYPE_RANK[type] > TYPE_RANK[cur.type] || (TYPE_RANK[type] === TYPE_RANK[cur.type] && (sg.score || 0) > (cur.sig.score || 0))) {
        perStory.set(st, { i, sig: sg, type, dup: (cur?.dup ?? 0) + (cur ? 1 : 0) });
      } else cur.dup += 1;
    }
    const reps = [...perStory.values()];
    const allSigs = sigIdx.map((i) => signals[i]);
    const srcCount = {};
    for (const sg of allSigs) srcCount[sg.src] = (srcCount[sg.src] || 0) + 1;
    const srcs = Object.entries(srcCount).sort((a, b) => b[1] - a[1]).map(([id]) => id);
    const voices = new Set(allSigs.map(voiceOf)).size;
    const posts = perStory.size;
    const evidenceSigs = reps.map((r) => ({ ...r.sig, type: r.type }));

    const texts = reps.map((r) => r.sig.text).slice(0, 30);
    const langs = [...new Set([...members.map((m) => m.lang), ...texts.map((x) => detectLang(x))])];
    const memberLangs = new Set(members.map((m) => m.lang).filter((l) => l === 'ja' || l === 'en'));
    const lang = memberLangs.size >= 2 ? 'mix' : rep.lang;
    const genres = srcs.map((s) => sourceMap[s]?.genre).filter(Boolean);
    const topic = classifyTopic({ terms: members.map((m) => m.t), texts, genres, slang: rep.slang });

    const first = Math.min(...members.map((m) => m.first ?? now));
    const pre = assessVerification(evidenceSigs);
    const imp = scoreImportance({
      topics: topic.topics,
      matched: topic.matched,
      texts,
      langs,
      byType: pre.byType,
      posts,
      domains: pre.domains,
      spread: srcs.length,
      ageH: (now - first) / H,
      verification: pre.status,
      slang: rep.slang,
      // 語そのもの以外の文脈（見出し・投稿本文）があるか
      hasContext: reps.some((r) => r.type !== 'search' && r.type !== 'reference' && String(r.sig.text).length > rep.t.length + 8),
    });
    const verification = assessVerification(evidenceSigs, { importance: imp.importance });

    const evidence = reps
      .sort((a, b) => TYPE_RANK[b.type] - TYPE_RANK[a.type] || (b.sig.score || 0) - (a.sig.score || 0))
      .slice(0, MAX_EVIDENCE)
      .map((r) => ({
        s: r.sig.src,
        x: String(r.sig.text).slice(0, 220),
        u: r.sig.url,
        l: r.sig.link || undefined,
        type: r.type,
        host: hostOf(r.sig.link || r.sig.url),
        // 公開時刻：媒体が時刻を持たない場合は収集時刻で埋まっているので区別する
        pt: Math.abs((r.sig.ts || now) - now) > 2 * 60 * 1000 ? r.sig.ts : null,
        dup: r.dup,
      }));
    const pubTimes = evidence.map((e) => e.pt).filter(Boolean);

    const others = members.slice(1);
    const heat = (rep._heat || 0) + 0.3 * others.reduce((a, m) => a + (m._heat || 0), 0);
    return {
      k: rep.k,
      t: rep.t,
      members: members.slice(0, MAX_MEMBERS).map((m) => ({ k: m.k, t: m.t, score: m.score, lang: m.lang, srcs: m.srcs.slice(0, 6) })),
      merged: members.length - 1,
      lang,
      rawAttention: rep.score + 0.3 * others.reduce((a, m) => a + m.score, 0),
      heat: r2(heat),
      importance: imp.importance,
      impConf: imp.confidence,
      impReason: imp.reason,
      impFactors: imp.factors,
      verification: { status: verification.status, label: verification.label, stage: verification.stage, notes: verification.notes, byType: verification.byType, independent: verification.independent, domains: verification.domains },
      topic: topic.topic,
      topics: topic.topics,
      srcCat: rep.cat,
      srcs,
      srcCount,
      spread: srcs.length,
      posts,
      reposts: sigIdx.length - posts,
      voices,
      first,
      lastPub: pubTimes.length ? Math.max(...pubTimes) : null,
      status: rep.status,
      badges: rep.badges,
      slang: rep.slang,
      main: members.every((m) => m.main),
      repDir: rep.dir,
      repBasis: rep.basis,
      repVel: rep.vel,
      repSpark: rep.spark,
      evidence,
      _memberKeys: members.map((m) => m.k),
      _urls: [...new Set(reps.map((r) => canonicalUrl(r.sig.link || r.sig.url)).filter(Boolean))],
    };
  });
  const max = Math.max(1, ...out.map((c) => c.rawAttention));
  for (const c of out) {
    c.attention = Math.round((100 * c.rawAttention) / max);
    delete c.rawAttention;
  }
  return out.sort((a, b) => b.attention - a.attention);
}

/* ------------------------------------------------------------------ *
 * 継続性：観測をまたいだ追跡（スレッド）
 * ------------------------------------------------------------------ */
export function persistenceOf(durationH, active) {
  if (!active && durationH < 12) return { id: 'flash', label: '一過性' };
  if (durationH < 12) return { id: 'emerging', label: '出現直後' };
  if (durationH < 72) return { id: 'developing', label: '継続中' };
  return { id: 'sustained', label: '長期潮流' };
}

/**
 * クラスタをスレッド台帳と突き合わせ、ID・動向・継続性を確定する
 * @param {Array<object>} clusters  buildClusters の出力
 * @param {Record<string, object>} threads  前回までのスレッド台帳
 * @param {{now:number, intervalH:number}} o
 * @returns {{clusters:Array<object>, threads:Record<string,object>, watch:Array<object>}}
 */
export function trackThreads(clusters, threads = {}, { now = Date.now(), intervalH = 3 } = {}) {
  const keyIndex = new Map();
  for (const th of Object.values(threads)) for (const k of th.keys || []) if (!keyIndex.has(k)) keyIndex.set(k, th.id);
  const next = {};
  for (const [id, th] of Object.entries(threads)) next[id] = { ...th, ema: r2((th.ema || 0) * (1 - EMA_ALPHA)) };
  const claimed = new Set();

  for (const c of clusters) {
    const votes = new Map();
    for (const k of c._memberKeys) {
      const id = keyIndex.get(k);
      if (id && !claimed.has(id)) votes.set(id, (votes.get(id) || 0) + (k === c.k ? 2 : 1));
    }
    const hit = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const prev = hit ? threads[hit] : null;
    const id = prev?.id || `tr-${hash(c.k + '|' + c.first)}`;
    claimed.add(id);

    const seen = new Set(prev?.seen || []);
    const urlHashes = c._urls.map(hash);
    const newPosts = prev ? urlHashes.filter((u) => !seen.has(u)).length + Math.max(0, c.posts - c._urls.length) : null;
    const hist = prev?.hist || [];
    const last = hist[hist.length - 1];

    let trend;
    if (prev) {
      trend = trendDirection({
        cur: c.heat,
        ema: prev.ema ?? 0,
        prevHeat: last?.[1] ?? null,
        prevAt: prev.last,
        posts: c.posts,
        prevPosts: last?.[2] ?? null,
        spread: c.spread,
        voices: c.voices,
        periodic: periodicityOf(c.t, hist, now, c.heat),
        newPosts,
        now,
        intervalH,
      });
    } else {
      // スレッドが新しくても、代表語に台帳の履歴があればそちらの判定を使う（デプロイ直後に全部 NEW にならないように）
      trend = { dir: c.repDir || 'new', velocity: c.repDir === 'new' ? 0 : c.repVel ?? 0, basis: c.repBasis };
    }

    const first = Math.min(prev?.first ?? c.first, c.first);
    const durationH = Math.round(((now - first) / H) * 10) / 10;
    const change24 = changeOver(hist, now, c.heat, 24);
    const change48 = changeOver(hist, now, c.heat, 48);
    const runs = (prev?.runs ?? 0) + 1;
    const newHist = [...hist, [now, c.heat, c.posts, c.importance ?? -1]].slice(-THREAD_HIST);
    const rise = trend.dir === 'rising' ? 2 + trend.velocity * Math.log2(2 + c.posts) : trend.dir === 'new' ? 1 + Math.min(1, c.posts / 6) : trend.dir === 'falling' ? trend.velocity - 1 : trend.velocity;

    Object.assign(c, {
      id,
      dir: trend.dir,
      velocity: trend.velocity,
      basis: trend.basis,
      basisText: describeBasis(trend.dir, trend.basis),
      rise: r2(rise),
      newPosts,
      first,
      durationH,
      runs,
      change24,
      change48,
      persistence: persistenceOf(durationH, true),
      spark: newHist.length >= 2 ? newHist.slice(-16).map((p) => p[1]) : c.repSpark,
    });

    for (const u of urlHashes) seen.add(u);
    next[id] = {
      id,
      k: c.k,
      t: c.t,
      title: c.evidence.find((e) => e.type !== 'search' && e.x.length > c.t.length + 8)?.x || c.t,
      keys: [...new Set([c.k, ...c._memberKeys, ...(prev?.keys || [])])].slice(0, 30),
      first,
      last: now,
      runs,
      ema: r2(prev ? prev.ema * (1 - EMA_ALPHA) + c.heat * EMA_ALPHA : c.heat),
      hist: newHist,
      peakImp: Math.max(prev?.peakImp ?? -1, c.importance ?? -1),
      peakAtt: Math.max(prev?.peakAtt ?? 0, c.attention),
      topic: c.topic,
      ver: c.verification.status,
      dir: trend.dir,
      seen: [...seen].slice(-SEEN_MAX),
    };
  }

  // 剪定：14 日観測されないスレッドは捨てる。上限を超えたら重要度・最近さで残す
  let list = Object.values(next).filter((th) => now - th.last < THREAD_TTL_D * 864e5);
  if (list.length > THREAD_MAX) {
    const keep = (th) => Math.max(0, th.peakImp) * 1.2 + th.peakAtt * 0.4 + th.runs * 2 - ((now - th.last) / H) * 0.8;
    list.sort((a, b) => keep(b) - keep(a));
    list = list.slice(0, THREAD_MAX);
  }
  const threadsOut = Object.fromEntries(list.map((th) => [th.id, th]));
  return { clusters, threads: threadsOut, watch: watchList(threadsOut, clusters, now) };
}

/**
 * 継続監視：重要度が高く、複数回・長時間観測されている話題。
 * 今回の急上昇ランキングから消えていても残す。
 */
export function watchList(threads, clusters, now = Date.now(), limit = 12) {
  const live = new Map(clusters.map((c) => [c.id, c]));
  return Object.values(threads)
    .filter((th) => th.peakImp >= 55 && (th.runs >= 3 || now - th.first >= 24 * H) && now - th.last < 7 * 864e5)
    .map((th) => {
      const c = live.get(th.id);
      const durationH = Math.round(((th.last - th.first) / H) * 10) / 10;
      return {
        id: th.id,
        k: th.k,
        t: th.t,
        title: th.title,
        topic: th.topic,
        importance: c?.importance ?? th.peakImp,
        peakImp: th.peakImp,
        verification: th.ver,
        dir: c ? c.dir : 'falling',
        onBoard: Boolean(c),
        first: th.first,
        last: th.last,
        runs: th.runs,
        durationH,
        persistence: persistenceOf(durationH, Boolean(c)),
        spark: th.hist.slice(-16).map((p) => p[1]),
      };
    })
    .sort((a, b) => b.peakImp - a.peakImp || b.runs - a.runs || b.last - a.last)
    .slice(0, limit);
}

/** 語 → 所属トレンド ID を付け、語の内部フィールドを落とす（語単位の画面からトレンドへ辿れるように） */
export function linkTerms(terms, clusters) {
  const byKey = new Map();
  for (const c of clusters) for (const k of c._memberKeys || c.members.map((m) => m.k)) byKey.set(k, c.id);
  for (const t of terms) {
    t.cl = byKey.get(t.k);
    delete t._hits;
    delete t._heat;
  }
  return terms;
}

/** スナップショットに載せない内部フィールドを落とす */
export function publicCluster(c) {
  const { _memberKeys, _urls, repDir, repBasis, repVel, repSpark, ...rest } = c;
  return rest;
}
