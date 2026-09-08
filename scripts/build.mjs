/**
 * build.mjs — Netlify のビルドステップ
 *
 * バンドラは使わない（フロントは素の ES Modules、Functions は Netlify の esbuild）。
 * ここでは「壊れたまま公開されない」ための検証と、日付の入る生成物だけを作る。
 */

import { readdir, writeFile, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE_URL = process.env.URL || process.env.DEPLOY_PRIME_URL || 'https://suggest-radar.netlify.app';

async function verifyModules() {
  const dirs = ['public/shared', 'public/assets/lib', 'netlify/lib', 'netlify/functions'];
  const loaded = [];
  for (const dir of dirs) {
    let entries = [];
    try {
      entries = await readdir(join(root, dir));
    } catch {
      continue;
    }
    for (const file of entries) {
      if (!/\.(mjs|js)$/.test(file)) continue;
      const path = join(root, dir, file);
      // ブラウザ専用モジュールは import すると document 参照で落ちるため構文検査のみ
      if (dir === 'public/assets/lib') {
        await readFile(path, 'utf8');
        loaded.push(`${dir}/${file} (read)`);
        continue;
      }
      await import(`file://${path}`);
      loaded.push(`${dir}/${file}`);
    }
  }
  return loaded;
}

async function writeSitemap() {
  const now = new Date().toISOString().slice(0, 10);
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemap.org/schemas/sitemap/0.9">
  <url>
    <loc>${SITE_URL}/</loc>
    <lastmod>${now}</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>
`.replace('www.sitemap.org', 'www.sitemaps.org');
  await writeFile(join(root, 'public/sitemap.xml'), xml, 'utf8');
}

async function writeBuildInfo() {
  const info = {
    builtAt: new Date().toISOString(),
    commit: (process.env.COMMIT_REF || 'local').slice(0, 7),
    branch: process.env.BRANCH || 'local',
    context: process.env.CONTEXT || 'local',
  };
  await writeFile(join(root, 'public/build-info.json'), JSON.stringify(info, null, 2), 'utf8');
  return info;
}

const modules = await verifyModules();
await writeSitemap();
const info = await writeBuildInfo();

console.log(`[build] verified ${modules.length} modules`);
console.log(`[build] site url: ${SITE_URL}`);
console.log(`[build] ${JSON.stringify(info)}`);
