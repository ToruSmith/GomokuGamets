// 部署後驗收：node scripts/smoke.mjs <網址> [--online]
//
// 不加參數只讀取網站；加上 --online 會真的匿名登入 Firebase、開一間房間再離開（離開時房間會被刪除），
// 並用 REST API 確認 Firebase 上已經發布最新的 database.rules.json。
// 每月的巡檢（.github/workflows/health.yml）也跑這支腳本。
import fs from 'node:fs';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const online = args.includes('--online');
const target = args.find((arg) => !arg.startsWith('--'));
if (!target) {
  console.error('用法：node scripts/smoke.mjs <網址> [--online]');
  process.exit(2);
}
const base = new URL(target.endsWith('/') ? target : `${target}/`);

let failures = 0;
const pass = (label) => console.log(`✓ ${label}`);
const fail = (label, reason) => {
  failures++;
  console.log(`✗ ${label}：${reason}`);
};
async function check(label, fn) {
  try {
    await fn();
    pass(label);
  } catch (error) {
    fail(label, error instanceof Error ? error.message : String(error));
  }
}
function expect(condition, reason) {
  if (!condition) throw new Error(reason);
}

await check('首頁', async () => {
  const response = await fetch(base);
  expect(response.ok, `HTTP ${response.status}`);
  const html = await response.text();
  expect(html.includes('<title>'), '找不到 <title>');
  expect(
    response.headers.get('x-content-type-options') === 'nosniff',
    '缺少 X-Content-Type-Options（public/_headers 沒有生效）',
  );
  expect(
    (response.headers.get('content-security-policy') ?? '').includes('frame-ancestors'),
    '缺少 Content-Security-Policy',
  );
});

await check('manifest 與圖示', async () => {
  const response = await fetch(new URL('manifest.webmanifest', base));
  expect(response.ok, `manifest HTTP ${response.status}`);
  const manifest = await response.json();
  for (const icon of manifest.icons ?? []) {
    const image = await fetch(new URL(icon.src, base));
    expect(image.ok, `${icon.src} HTTP ${image.status}`);
  }
});

await check('Service Worker', async () => {
  const response = await fetch(new URL('sw.js', base));
  expect(response.ok, `HTTP ${response.status}`);
  const source = await response.text();
  expect(source.includes("'gomoku-"), '快取名稱不是 gomoku- 開頭');
  expect(!source.includes('__VERSION__'), '版本號沒有在建置時填入');
});

const browser = await chromium.launch();
try {
  // 介面語言跟著瀏覽器；巡檢用繁體中文的按鈕文字找元素
  const page = await browser.newPage({ locale: 'zh-TW' });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await check('瀏覽器載入沒有錯誤', async () => {
    await page.goto(base.href, { waitUntil: 'load' });
    await page.getByRole('button', { name: /線上對戰/ }).waitFor({ timeout: 15_000 });
    expect(errors.length === 0, errors.join('；'));
  });

  if (online) {
    await check('線上對戰：匿名登入並開房', async () => {
      await page.getByRole('button', { name: /線上對戰/ }).click();
      await page.getByRole('textbox', { name: '你的暱稱' }).fill('巡檢');
      await page.getByRole('button', { name: '開新房間' }).click();
      const code = page.locator('.room-code');
      await code.waitFor({ timeout: 30_000 });
      const text = (await code.innerText()).trim();
      expect(/^[A-HJ-NP-Z2-9]{6}$/.test(text), `房號格式不對：${text}`);
      // 還沒有對手的房間，離開時會被刪除
      await page.getByRole('button', { name: '離開' }).first().click();
      // 入座後離開會先跳出確認視窗
      await page.getByRole('dialog').getByRole('button', { name: '離開' }).click();
      await code.waitFor({ state: 'detached', timeout: 15_000 });
      expect(errors.length === 0, errors.join('；'));
    });
  }
} finally {
  await browser.close();
}

if (online) {
  // 直接用 REST API 確認 Firebase 上的規則是這個儲存庫的版本：用裝置時間當開房時間的寫入必須被拒絕。
  await check('資料庫規則已發布（開房時間必須是伺服器時間）', async () => {
    const source = fs.readFileSync(
      new URL('../src/online/firebase-config.ts', import.meta.url),
      'utf8',
    );
    const field = (name) => new RegExp(`${name}: '([^']+)'`).exec(source)?.[1];
    const apiKey = field('apiKey');
    const databaseURL = field('databaseURL');
    expect(apiKey && databaseURL, '讀不到 firebase-config.ts');
    const signUp = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Referer: base.href },
        body: JSON.stringify({ returnSecureToken: true }),
      },
    );
    expect(signUp.ok, `匿名登入失敗：HTTP ${signUp.status}`);
    const { idToken, localId } = await signUp.json();
    const code = 'ZZZZZ' + 'ABCDEFGHJKMNPQRSTUVWXY'[Math.floor(Math.random() * 22)];
    const room = (createdAt) => ({
      createdAt,
      config: { size: 15, rule: 'freestyle' },
      n: 0,
      players: { black: { uid: localId, name: '巡檢' } },
    });
    const url = `${databaseURL}/rooms/${code}.json?auth=${idToken}`;
    const stale = await fetch(url, { method: 'PUT', body: JSON.stringify(room(1)) });
    if (stale.ok) await fetch(url, { method: 'DELETE' });
    expect(
      !stale.ok,
      '舊規則還在：用裝置時間開房沒有被擋下，請到 Firebase Console 發布 database.rules.json',
    );
    const fresh = await fetch(url, {
      method: 'PUT',
      body: JSON.stringify(room({ '.sv': 'timestamp' })),
    });
    expect(fresh.ok, `用伺服器時間開房被拒絕：HTTP ${fresh.status}`);
    const removed = await fetch(url, { method: 'DELETE' });
    expect(removed.ok, `刪除測試房間失敗：HTTP ${removed.status}`);
  });
}

if (failures > 0) {
  console.log(`\n${failures} 項沒有通過`);
  process.exit(1);
}
console.log('\n全部通過');
