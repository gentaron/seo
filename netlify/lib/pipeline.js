/**
 * pipeline.js — 観測 1 回分：収集 → 語の採掘 → 採点 → 台帳更新 → スナップショット保存
 *
 * 呼び出し元：
 *   - collect.mjs（Netlify Scheduled Function、3 時間ごと）
 *   - feed.mjs（スナップショットが無いときの初回だけ、締切短めで同期実行）
 *   - refresh.mjs（手動更新。クールダウン付き）
 */

import { SOURCES, SOURCE_MAP, sourceMeta } from './sources.js';
import { mineCandidates } from './mine.js';
import { scoreRun, RUN_INTERVAL_H } from './score.js';
import { prepareSignals, buildWorldBrief } from './intelligence.js';

export const KEYS = {
  latest: 'latest',
  lexicon: 'lexicon',
  meta: 'meta',
  lock: 'lock',
};

const STREAM_LEN = 30;
const HISTORY_LEN = 40;
const LOCK_TTL_MS = 45_000;

/**
 * 全媒体を並列取得。締切を過ぎた媒体は timeout 扱いで切り捨てる。
 * @param {{deadline:number, only?:string[]}} o
 */
export async function collectSignals({ deadline, only }) {
  const targets = only ? SOURCES.filter((s) => only.includes(s.id)) : SOURCES;
  const reports = await Promise.all(
    targets.map(async (src) => {
      const started = Date.now();
      let timer;
      try {
        const watchdog = new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('deadline')), Math.max(0, deadline - Date.now()));
        });
        const signals = await Promise.race([src.fetch({ deadline }), watchdog]);
        const clean = (signals || [])
          .filter((s) => s && s.text)
          .map((s) => ({ ...s, src: src.id, text: String(s.text).slice(0, 300) }));
        return { id: src.id, ok: clean.length > 0, count: clean.length, ms: Date.now() - started, signals: clean };
      } catch (err) {
        return { id: src.id, ok: false, count: 0, ms: Date.now() - started, error: String(err?.message || err).slice(0, 120), signals: [] };
      } finally {
        clearTimeout(timer);
      }
    }),
  );
  return reports;
}

/**
 * @param {object} o
 * @param {{get:Function,set:Function}} o.store
 * @param {number} [o.budgetMs]  全体の時間予算（Scheduled は 30 秒上限、同期 Function は 10 秒）
 * @param {string} [o.trigger]   'schedule' | 'bootstrap' | 'manual'
 * @param {number} [o.now]
 */
export async function runPipeline({ store, budgetMs = 22_000, trigger = 'schedule', now = Date.now() }) {
  const started = Date.now();
  const deadline = started + budgetMs - 1500; // 保存のための余白を残す

  // Scheduled / manual / bootstrap all share a best-effort lock.
  // Netlify Blobs has no compare-and-swap: this mitigates common overlaps but
  // is NOT a distributed mutex. Preserve the acquisition token on release.
  const lock = await store.get(KEYS.lock);
  if (lock && Date.now() - lock.at < LOCK_TTL_MS && Date.now() >= lock.at) {
    return { skipped: true, reason: 'locked' };
  }
  const lockAt = Date.now();
  await store.set(KEYS.lock, { at: lockAt, trigger });

  try {
    const [reports, lexicon, meta] = await Promise.all([
      collectSignals({ deadline }),
      store.get(KEYS.lexicon).then((v) => v || {}),
      store.get(KEYS.meta).then((v) => v || {}),
    ]);

    const signals = reports.flatMap((r) => r.signals);
    // Preserve the raw streams for auditing; score only deduplicated, safe signals.
    const { clean: usableSignals, rejected } = prepareSignals(signals);
    const candidates = mineCandidates(usableSignals);
    const { terms, lexicon: nextLexicon, considered } = scoreRun({
      signals: usableSignals,
      candidates,
      sourceMap: SOURCE_MAP,
      lexicon,
      now,
    });

    const snapshot = {
      ok: true,
      v: 2,
      runId: new Date(now).toISOString(),
      generatedAt: now,
      nextRunAt: nextScheduled(now),
      intervalH: RUN_INTERVAL_H,
      trigger,
      tookMs: Date.now() - started,
      stats: {
        signals: signals.length,
        usableSignals: usableSignals.length,
        excludedSignals: rejected.length,
        candidates: candidates.size,
        considered,
        lexicon: Object.keys(nextLexicon).length,
        sourcesUp: reports.filter((r) => r.ok).length,
        sourcesTotal: reports.length,
      },
      sources: sourceMeta().map((m) => {
        const r = reports.find((x) => x.id === m.id);
        return { ...m, ok: !!r?.ok, count: r?.count ?? 0, ms: r?.ms ?? 0, error: r?.error };
      }),
      terms,
      analysis: buildWorldBrief(usableSignals, { now, rejected }),
      streams: Object.fromEntries(
        reports
          .filter((r) => r.signals.length)
          .map((r) => [
            r.id,
            [...r.signals]
              .sort((a, b) => (b.score || 0) - (a.score || 0) || (b.ts || 0) - (a.ts || 0))
              .slice(0, STREAM_LEN)
              .map((s) => ({ x: s.text, u: s.url, sc: s.score || 0, ts: s.ts || now, c: s.ctx || '' })),
          ]),
      ),
    };

    // 取得が全滅した回は台帳を汚さない（前回スナップショットを残す）
    if (usableSignals.length === 0) {
      const prev = await store.get(KEYS.latest);
      return { ...(prev || snapshot), ok: !!prev, degraded: true, sources: snapshot.sources, tookMs: snapshot.tookMs };
    }

    const history = [
      { at: now, top: terms.slice(0, 8).map((t) => t.t), up: snapshot.stats.sourcesUp },
      ...(meta.history ?? []),
    ].slice(0, HISTORY_LEN);

    await Promise.all([
      store.set(KEYS.latest, snapshot),
      store.set(KEYS.lexicon, nextLexicon),
      store.set(KEYS.meta, { ...meta, lastRunAt: now, lastTrigger: trigger, runs: (meta.runs ?? 0) + 1, history }),
    ]);
    return snapshot;
  } finally {
    // A later run may have acquired the lock: don't blindly clear its token.
    const current = await store.get(KEYS.lock).catch(() => null);
    if (current?.at === lockAt) await store.set(KEYS.lock, { at: 0 }).catch(() => {});
  }
}

/** 次の定時（UTC で RUN_INTERVAL_H 時間ごとの 0 分）。cron `0 *\/3 * * *` と一致 */
export function nextScheduled(now = Date.now()) {
  const step = RUN_INTERVAL_H * 3.6e6;
  return Math.floor(now / step) * step + step;
}
