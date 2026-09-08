/**
 * uicheck.mjs — ブラウザでの UI スモークテスト（任意実行）
 *
 *   npm i -D playwright-core            # 初回のみ
 *   node scripts/devserver.mjs --mock & # 別ターミナルで
 *   node scripts/uicheck.mjs
 *
 * 主要な操作（探索 → 一覧 → グループ → 共起語 → 絞り込み → お気に入り →
 * 配色切替 → モバイル幅）を一通り実行し、JS エラーと横スクロールの発生を検出する。
 * playwright-core が無い環境ではスキップする（CI 必須ではない）。
 */

const BASE = process.env.BASE_URL || 'http://localhost:8888';
const SHOT_DIR = process.env.SHOT_DIR || '';

let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch {
  console.log('[uicheck] playwright-core が見つかりません。`npm i -D playwright-core` を実行してください。スキップします。');
  process.exit(0);
}

const executablePath =
  process.env.CHROMIUM_PATH ||
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 }, locale: 'ja-JP' });

const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));

const checks = [];
const check = (name, cond, detail = '') => {
  checks.push({ name, ok: !!cond, detail });
  console.log(`${cond ? '  ok' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

await page.addInitScript(() => localStorage.clear());
await page.goto(BASE, { waitUntil: 'networkidle' });

await page.fill('#keyword', '転職エージェント');
await page.click('#run');
await page.waitForTimeout(2500);

const rows = await page.locator('.kw').count();
check('探索して結果行が描画される', rows > 0, `${rows} 行`);
check('進捗表示が完了になる', (await page.locator('#progress-text').innerText()).includes('完了'));
check('中止ボタンが完了後に隠れる', await page.locator('#cancel').isHidden());

await page.locator('.kw').first().click();
await page.waitForTimeout(700);
check('詳細パネルにスコアが出る', (await page.locator('#detail-body').innerText()).includes('スコア'));

await page.click('[data-view="group"]');
await page.waitForTimeout(300);
check('グループ表示に切り替わる', (await page.locator('.group').count()) > 0);

await page.click('[data-view="cloud"]');
await page.waitForTimeout(300);
check('共起語表示に切り替わる', (await page.locator('.cloud__item').count()) > 0);

await page.click('[data-view="list"]');
await page.fill('#filter-text', 'おすすめ');
await page.waitForTimeout(350);
const filtered = await page.locator('.kw').count();
check('絞り込みが効く', filtered > 0 && filtered <= rows, `${filtered} 行`);
await page.fill('#filter-text', '');
await page.waitForTimeout(300);

await page.locator('.kw__fav').first().click();
await page.waitForTimeout(250);
check('お気に入り登録が反映される', (await page.locator('#fav-count').innerText()) === '1');

await page.click('#theme-toggle');
await page.waitForTimeout(250);
check('配色を切り替えられる', (await page.getAttribute('html', 'data-theme')) === 'light');
await page.click('#theme-toggle');

check('急上昇ワードが表示される', (await page.locator('#trends-body .tag').count()) > 0);

await page.click('[data-engine="youtube"]');
await page.waitForTimeout(200);
check(
  '媒体チップの選択が切り替わる',
  (await page.getAttribute('[data-engine="youtube"]', 'aria-pressed')) === 'true' &&
    (await page.locator('#estimate').innerText()).includes('2 媒体'),
);
await page.click('[data-engine="youtube"]');

await page.click('#preset-full');
await page.waitForTimeout(200);
check(
  'フル探索プリセットで全モードが有効になる',
  (await page.locator('.chip[data-mode][aria-pressed="true"]').count()) ===
    (await page.locator('.chip[data-mode]').count()),
);
await page.click('#preset-quick');

await page.click('#help-toggle');
await page.waitForTimeout(200);
check('ヘルプが開く', await page.locator('#help-modal').isVisible());
await page.keyboard.press('Escape');

if (SHOT_DIR) await page.screenshot({ path: `${SHOT_DIR}/desktop.png` });

await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(400);
const [scrollW, clientW] = await page.evaluate(() => [
  document.documentElement.scrollWidth,
  document.documentElement.clientWidth,
]);
check('モバイル幅で横スクロールが発生しない', scrollW <= clientW, `${scrollW} / ${clientW}`);
if (SHOT_DIR) await page.screenshot({ path: `${SHOT_DIR}/mobile.png` });

check('JS エラーが出ていない', errors.length === 0, errors.join(' / '));

await browser.close();

const failed = checks.filter((c) => !c.ok);
console.log(`\n[uicheck] ${checks.length - failed.length}/${checks.length} passed`);
process.exit(failed.length ? 1 : 0);
