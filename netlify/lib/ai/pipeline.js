/**
 * ai/pipeline.js — AI Pulse の観測 1 回分：収集 → 名寄せ・採点 → 台帳更新 → スナップショット保存
 *
 * 呼び出し元：ai-collect.mjs（毎時）／ ai.mjs（初回のみ同期）／ ai-refresh.mjs（手動）
 * 既存の Undercurrent とは別のキー（ai-*）に保存し、互いの観測を邪魔しない。
 */

import { AI_SOURCES, AI_SOURCE_MAP, collectAiSignals } from './sources.js';
import { analyzeAi, FAMILY } from './engine.js';

export const AI_KEYS = { latest: 'ai-latest', ledger: 'ai-ledger', lock: 'ai-lock', meta: 'ai-meta' };
export const AI_INTERVAL_MIN = 60; // ai-collect.mjs の cron と揃える
const LOCK_TTL_MS = 45_000;

export function nextAiRun(now = Date.now()) {
  const step = AI_INTERVAL_MIN * 60_000;
  const offset = 20 * 60_000; // 毎時 20 分（既存の 3 時間ごとの観測と重ならないように）
  return Math.floor((now - offset) / step) * step + step + offset;
}

/**
 * @param {{store:{get:Function,set:Function}, budgetMs?:number, trigger?:string, now?:number}} o
 */
export async function runAiPipeline({ store, budgetMs = 22_000, trigger = 'schedule', now = Date.now() }) {
  const started = Date.now();
  const deadline = started + budgetMs - 1500;

  const lock = await store.get(AI_KEYS.lock);
  if (lock && Date.now() - lock.at < LOCK_TTL_MS && Date.now() >= lock.at) return { skipped: true, reason: 'locked' };
  const lockAt = Date.now();
  await store.set(AI_KEYS.lock, { at: lockAt, trigger });

  try {
    const [reports, ledger] = await Promise.all([
      collectAiSignals({ deadline }),
      store.get(AI_KEYS.ledger).then((v) => v || {}),
    ]);
    const signals = reports.flatMap((r) => r.signals);
    const sources = AI_SOURCES.map(({ id, label, fam, weight }) => {
      const r = reports.find((x) => x.id === id);
      return { id, label, fam, famLabel: FAMILY[fam]?.label || fam, weight, ok: !!r?.ok, count: r?.count ?? 0, ms: r?.ms ?? 0, error: r?.error };
    });

    if (!signals.length) {
      const prev = await store.get(AI_KEYS.latest);
      return { ...(prev || { ok: false, top: [], themes: [] }), degraded: true, sources };
    }

    const { top, themes, ledger: nextLedger, stats } = analyzeAi({ signals, sourceMap: AI_SOURCE_MAP, ledger, now });
    const snapshot = {
      ok: true,
      v: 1,
      schema: 'undercurrent.ai-pulse/1',
      generatedAt: now,
      nextRunAt: nextAiRun(now),
      intervalMin: AI_INTERVAL_MIN,
      trigger,
      tookMs: Date.now() - started,
      stats: {
        ...stats,
        signals: signals.length,
        sourcesUp: sources.filter((s) => s.ok).length,
        sourcesTotal: sources.length,
      },
      sources,
      families: Object.entries(FAMILY).map(([id, f]) => ({ id, label: f.label, w: f.w })),
      top,
      themes,
      volume: nextLedger.vol,
    };
    await Promise.all([store.set(AI_KEYS.latest, snapshot), store.set(AI_KEYS.ledger, nextLedger)]);
    return snapshot;
  } finally {
    const current = await store.get(AI_KEYS.lock).catch(() => null);
    if (current?.at === lockAt) await store.set(AI_KEYS.lock, { at: 0 }).catch(() => {});
  }
}
