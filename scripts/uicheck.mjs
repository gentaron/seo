/**
 * uicheck.mjs — ブラウザでの UI スモークテスト（任意実行）
 *
 *   node scripts/devserver.mjs --mock &   # 別ターミナルで
 *   node scripts/uicheck.mjs              # SHOT_DIR=dir を付けるとスクショ保存
 *
 * 主要操作（フィード → 絞り込み → 詳細 → ネタ帳 → 大全 → 生データ → 観測網 → 配色 → モバイル幅）を
 * 一通り実行し、JS エラーと横スクロールの発生を検出する。playwright が無ければスキップ。
 */

const BASE = process.env.BASE_URL || 'http://localhost:8888';
const SHOT_DIR = process.env.SHOT_DIR || '';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  try {
    // グローバル導入（NODE_PATH）の playwright は ESM の import では解決されないので require で拾う
    const { createRequire } = await import('node:module');
    ({ chromium } = createRequire(import.meta.url)('playwright'));
  } catch {
    console.log('[uicheck] playwright が見つかりません。スキップします。');
    process.exit(0);
  }
}

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1360, height: 900 }, locale: 'ja-JP', colorScheme: 'dark', deviceScaleFactor: SHOT_DIR ? 2 : 1 });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));

const results = [];
const check = (name, cond, detail = '') => {
  results.push(!!cond);
  console.log(`${cond ? '  ok' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const shot = async (name) => SHOT_DIR && page.screenshot({ path: `${SHOT_DIR}/${name}.png`, fullPage: false });

await page.addInitScript(() => localStorage.clear());
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('#board tr');

const rows = await page.locator('#board tr').count();
check('最初の画面はトレンド一覧（検索なしで全部並ぶ）', rows > 5, `${rows} 行`);
await page.click('#b-region [data-v="ja"]');
const jaRows = await page.locator('#board tr').count();
check('トレンド一覧：日本で絞り込める', jaRows > 0 && jaRows < rows, `${jaRows} 行`);
await page.click('#b-region [data-v=""]');
for (const v of ['importance', 'rise', 'attention']) {
  await page.click(`#b-sortseg [data-v="${v}"]`);
  check(`トレンド一覧：${v} 順に切り替えられる`, (await page.locator('#board tr').count()) === rows);
}
const impFirst = await page.evaluate(async () => {
  document.querySelector('#b-sortseg [data-v="importance"]').click();
  const vals = [...document.querySelectorAll('#board .c-imp b')].map((b) => Number(b.textContent));
  document.querySelector('#b-sortseg [data-v="attention"]').click();
  return vals;
});
check('重要度順は重要度の降順', impFirst.every((v, i) => i === 0 || impFirst[i - 1] >= v), impFirst.slice(0, 5).join(','));
check('同じ話題の語が統合されている（＋N語）', (await page.locator('#board .merged').count()) > 0);
check('検証状態が各トレンドに付く', (await page.locator('#board .ver').count()) === rows);
check('動向は共通ルール（NEW/上昇中/横ばい/下降中）', (await page.locator('#board .c-vel .dir').count()) === rows);
await page.selectOption('#b-topic', 'science');
const sci = await page.locator('#board tr').count();
check('分野（内容）で絞り込める', sci > 0 && sci < rows, `${sci} 行`);
await page.selectOption('#b-topic', '');
await page.selectOption('#b-ver', 'unverified');
check('検証状態で絞り込める', (await page.locator('#board tr').count()) < rows);
await page.selectOption('#b-ver', '');
await shot('00-board');
await page.locator('#board tr').first().click();
await page.waitForSelector('#drawer[open]');
check('トレンド一覧：行クリックで詳細が開く（根拠・継続性つき）', (await page.locator('#dr-body .evidence li').count()) > 0 && /初回検出/.test(await page.locator('#dr-body').innerText()));
await page.click('#dr-close');

await page.click('[data-tab="world"]');
await page.waitForSelector('#brief-changes li');
check('世界の情勢：重要な変化が 5〜10 件', (n => n >= 5 && n <= 10)(await page.locator('#brief-changes .brief__item').count()));
check('世界の情勢：何が起きたか／なぜ重要か／何が未確認か', (await page.locator('#brief-changes .wwu').first().innerText()).includes('何が未確認か'));
check('世界の情勢：関連する動き（テーマ）が出る', (await page.locator('#themes .theme').count()) > 0);
check('世界の情勢：因果関係を断定しない注記', /因果関係/.test(await page.locator('#themes').innerText()));
check('世界の情勢：継続監視の欄がある', (await page.locator('#brief-watch li').count()) > 0);
await shot('06-world');
await page.click('[data-tab="board"]');

await page.click('[data-tab="feed"]');
await page.waitForSelector('.card');

const cards = await page.locator('.card').count();
check('フィードにカードが並ぶ', cards > 5, `${cards} 枚`);
check('鼓動に次回観測のカウントダウンが出る', /次の観測まで \d+:\d\d:\d\d/.test(await page.locator('#pulse-text').innerText()));
check('ティッカーに語が流れる', (await page.locator('.ticker__item').count()) > 0);
check('サイドに履歴が出る', (await page.locator('#history li').count()) > 0);
await shot('01-feed');

await page.click('[data-status="new"]');
const newOnly = await page.locator('.card').count();
check('🌱 誕生で絞り込める', newOnly > 0 && newOnly <= cards, `${newOnly} 枚`);
await page.click('[data-status=""]');
await page.click('[data-lang="ja"]');
const ja = await page.locator('.card').count();
check('日本語圏で絞り込める', ja > 0 && ja < cards, `${ja} 枚`);
await page.click('[data-lang=""]');

await page.locator('.card__term').first().click();
await page.waitForSelector('#drawer[open] .chart');
check('詳細ドロワに推移グラフと意味が出る', (await page.locator('#dr-body .def').count()) > 0);
await shot('02-drawer');
await page.click('#dr-close');

await page.locator('.star').first().click();
check('☆ でネタ帳に入る', (await page.locator('#notes-count').innerText()) === '1');

await page.click('[data-tab="lexicon"]');
await page.waitForSelector('.lex li[data-open]');
check('大全が表示される', (await page.locator('.lex li[data-open]').count()) > 5);
await page.fill('#lex-q', '構文');
await page.waitForTimeout(500);
check('大全を検索できる', (await page.locator('.lex li[data-open]').count()) >= 1);
await shot('03-lexicon');

await page.click('[data-tab="raw"]');
check('生データが媒体ごとに出る', (await page.locator('#raw section').count()) >= 10);
await page.click('[data-tab="notes"]');
check('ネタ帳タブに保存した語がある', (await page.locator('#notes li').count()) === 1);
await page.click('[data-tab="sources"]');
check('観測網に 14 媒体', (await page.locator('.src').count()) === 14);
check('観測網にスコアの算出基準と偏りの表示', /比較期間/.test(await page.locator('#method').innerText()) && (await page.locator('#coverage .covbars div').count()) > 5);

const before = await page.evaluate(() => document.documentElement.dataset.theme);
await page.click('#theme');
check('配色を切り替えられる', (await page.evaluate(() => document.documentElement.dataset.theme)) !== before);
await shot('04-light');
await page.click('[data-tab="board"]');

await page.setViewportSize({ width: 375, height: 800 });
await page.waitForTimeout(300);
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check('モバイル幅で横スクロールしない', overflow <= 0, `${overflow}px`);
await page.click('#theme');
await page.waitForTimeout(300);
await shot('05-mobile');
await page.click('[data-tab="feed"]');

await page.goto(`${BASE}/?term=aurafarming`, { waitUntil: 'networkidle' });
await page.waitForSelector('#drawer[open]');
check('?term= で詳細が直接開く', (await page.locator('#dr-title').innerText()).toLowerCase().includes('aura'));
const trendId = await page.evaluate(() => document.querySelector('#board tr[data-trend]')?.dataset.trend);
await page.goto(`${BASE}/?trend=${encodeURIComponent(trendId)}`, { waitUntil: 'networkidle' });
await page.waitForSelector('#drawer[open]');
check('?trend= でトレンド詳細が直接開く', (await page.locator('#dr-body .evidence').count()) === 1);

check('JS エラーなし', errors.length === 0, errors.join(' | '));
await browser.close();
const failed = results.filter((r) => !r).length;
console.log(failed ? `\n${failed} 件失敗` : '\nすべて成功');
process.exit(failed ? 1 : 0);
