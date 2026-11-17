/**
 * store.js — 永続化（Netlify Blobs。ローカルではファイル、テストではメモリ）
 *
 * Netlify Blobs は全プラン無料で使える KV。Functions 内では設定不要で getStore() が繋がる。
 * Netlify の外（npm run serve / テスト）では自動で .netlify/local-blobs/ にフォールバックする。
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const STORE_NAME = 'undercurrent';
const LOCAL_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../.netlify/local-blobs', STORE_NAME);

/** メモリ実装（テスト用） */
export function memoryStore(seed = {}) {
  const m = new Map(Object.entries(seed).map(([k, v]) => [k, JSON.stringify(v)]));
  return {
    kind: 'memory',
    async get(key) {
      return m.has(key) ? JSON.parse(m.get(key)) : null;
    },
    async set(key, value) {
      m.set(key, JSON.stringify(value));
    },
    dump: () => Object.fromEntries([...m].map(([k, v]) => [k, JSON.parse(v)])),
  };
}

/** ファイル実装（ローカル開発用） */
function fileStore() {
  const path = (key) => join(LOCAL_DIR, `${encodeURIComponent(key)}.json`);
  return {
    kind: 'file',
    async get(key) {
      try {
        return JSON.parse(await readFile(path(key), 'utf8'));
      } catch {
        return null;
      }
    },
    async set(key, value) {
      await mkdir(LOCAL_DIR, { recursive: true });
      await writeFile(path(key), JSON.stringify(value), 'utf8');
    },
  };
}

/** Netlify Blobs 実装 */
async function blobsStore() {
  const { getStore } = await import('@netlify/blobs');
  const store = getStore({ name: STORE_NAME, consistency: 'strong' });
  return {
    kind: 'blobs',
    async get(key) {
      return (await store.get(key, { type: 'json' })) ?? null;
    },
    async set(key, value) {
      await store.setJSON(key, value);
    },
  };
}

let cached;
/** 実行環境に合った store を返す（同一インスタンス内ではキャッシュ） */
export async function openStore() {
  if (globalThis.__UNDERCURRENT_STORE__) return globalThis.__UNDERCURRENT_STORE__;
  if (cached) return cached;
  const env = process.env;
  const onNetlify = Boolean(
    globalThis.netlifyBlobsContext || env.NETLIFY_BLOBS_CONTEXT || env.NETLIFY || env.AWS_LAMBDA_FUNCTION_NAME || env.NETLIFY_DEV,
  );
  if (onNetlify) {
    try {
      cached = await blobsStore();
      return cached;
    } catch (err) {
      console.warn('[store] Netlify Blobs に接続できないためファイルへフォールバック:', err?.message);
    }
  }
  cached = fileStore();
  return cached;
}
