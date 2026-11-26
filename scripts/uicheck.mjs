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
check('最初の画面は重要情報レーダー', await page.locator('[data-panel="world"]').isVisible());
await page.click('.tabs .tab[data-tab="board"]');
await page.waitForSelector('#board tr');

const rows = await page.locator('#board tr').count();
check('トレンド一覧（検索なしで全部並ぶ）', rows > 5, `${rows} 行`);
await page.click('#b-region [data-v="ja"]');
const jaRows = await page.locator('#board tr').count();
check('トレンド一覧：日本で絞り込める', jaRows > 0 && jaRows < rows, `${jaRows} 行`);
await page.click('#b-region [data-v=""]');
await page.selectOption('#b-cat', 'scandal');
check('トレンド一覧：炎上・事件カテゴリで絞り込める', (await page.locator('#board tr').count()) > 0);
await page.selectOption('#b-cat', '');
await page.selectOption('#b-sort', 'vel');
check('トレンド一覧：伸び率順に並び替えられる', (await page.locator('#board tr').count()) === rows);
await shot('00-board');
await page.locator('#board tr').first().click();
await page.waitForSelector('#drawer[open]');
check('トレンド一覧：行クリックで詳細が開く', true);
await page.click('#dr-close');

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
const nSrc = await page.locator('.src').count();
check('観測網に全媒体が並ぶ', nSrc >= 20, `${nSrc} 媒体`);

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
check('モバイル：下部タブバーが出る', await page.locator('.mbar').isVisible());
await page.click('.mbar [data-tab="feed"]');
check('モバイル：下部タブでフィードへ', await page.locator('[data-panel="feed"]').isVisible());
await page.click('#m-more');
await page.click('.msheet [data-tab="lexicon"]');
check('モバイル：その他から大全へ', await page.locator('[data-panel="lexicon"]').isVisible());

await page.goto(`${BASE}/?term=aurafarming`, { waitUntil: 'networkidle' });
await page.waitForSelector('#drawer[open]');
check('?term= で詳細が直接開く', (await page.locator('#dr-title').innerText()).toLowerCase().includes('aura'));

check('JS エラーなし', errors.length === 0, errors.join(' | '));
await browser.close();
const failed = results.filter((r) => !r).length;
console.log(failed ? `\n${failed} 件失敗` : '\nすべて成功');
process.exit(failed ? 1 : 0);
