import { expect, test } from 'playwright/test';
import type { Page } from 'playwright/test';
import { clickCell, stoneAt } from './helpers.ts';

/**
 * 兩個分頁透過模擬後端真的對戰。舊版這條路徑完全不能動：
 * 對手一加入，大廳關閉時就把自己的房間資訊清掉了。
 */
async function openRoom(host: Page, guest: Page) {
  await host.goto('./');
  await host.getByRole('button', { name: /線上對戰/ }).click();
  await host.getByRole('textbox', { name: '你的暱稱' }).fill('小明');
  await host.getByRole('button', { name: '開新房間' }).click();
  await expect(host.locator('.room-code')).toBeVisible();
  const code = await host.locator('.room-code').innerText();

  await guest.goto('./');
  await guest.getByRole('button', { name: /線上對戰/ }).click();
  await guest.getByRole('textbox', { name: '你的暱稱' }).fill('小華');
  await guest.getByRole('textbox', { name: '房間代碼或邀請連結' }).fill(code.toLowerCase());
  await guest.getByRole('button', { name: '加入', exact: true }).click();
  await expect(host.getByText('小華')).toBeVisible();
  return code;
}

test.beforeEach(async ({ context }) => {
  await context.route('**/fonts.g*/**', (route) => route.abort());
});

test('開房、加入、對戰、分出勝負、再戰', async ({ context }) => {
  const host = await context.newPage();
  const guest = await context.newPage();
  await openRoom(host, guest);

  await expect(host.getByRole('status').first()).toHaveText('輪到你');
  await expect(guest.getByRole('status').first()).toHaveText('等對手落子');

  // 沒輪到時點棋盤沒有作用
  await clickCell(guest, 0, 0);
  await expect(stoneAt(host, 0, 0)).toHaveCount(0);

  for (let col = 0; col < 4; col++) {
    await clickCell(host, 7, col);
    await expect(stoneAt(guest, 7, col)).toHaveCount(1);
    await clickCell(guest, 8, col);
    await expect(stoneAt(host, 8, col)).toHaveCount(1);
  }
  await clickCell(host, 7, 4);
  await expect(host.locator('.seal')).toHaveText('黑勝');
  await expect(guest.locator('.seal')).toHaveText('黑勝');
  await expect(host.getByRole('status').first()).toHaveText('你贏了');
  await expect(guest.getByRole('status').first()).toHaveText('你輸了');

  await host.getByRole('button', { name: '再戰一局' }).click();
  await guest.getByRole('button', { name: /對方想再戰/ }).click();
  await expect(guest.getByRole('status').first()).toHaveText('輪到你');
  await expect(host.getByRole('status').first()).toHaveText('等對手落子');
  await expect(host.locator('.stone')).toHaveCount(0);
});

test('重新整理後回到對局', async ({ context }) => {
  const host = await context.newPage();
  const guest = await context.newPage();
  await openRoom(host, guest);
  await clickCell(host, 7, 7);
  await expect(stoneAt(guest, 7, 7)).toHaveCount(1);

  await guest.reload();
  await expect(stoneAt(guest, 7, 7)).toHaveCount(1);
  await expect(guest.getByRole('status').first()).toHaveText('輪到你');
  await clickCell(guest, 8, 8);
  await expect(stoneAt(host, 8, 8)).toHaveCount(1);
});

test('對手認輸', async ({ context }) => {
  const host = await context.newPage();
  const guest = await context.newPage();
  await openRoom(host, guest);
  await guest.getByRole('button', { name: '認輸' }).click();
  await guest.getByRole('dialog').getByRole('button', { name: '認輸' }).click();
  await expect(host.locator('.seal')).toHaveText('黑勝');
  await expect(host.getByText('對方認輸')).toBeVisible();
});

test('第三人用邀請連結進來會變成觀戰', async ({ context }) => {
  const host = await context.newPage();
  const guest = await context.newPage();
  const code = await openRoom(host, guest);
  await clickCell(host, 7, 7);

  const viewer = await context.newPage();
  await viewer.goto(`./#/r/${code}`);
  await expect(viewer.getByRole('status').first()).toHaveText('觀戰中');
  await expect(stoneAt(viewer, 7, 7)).toHaveCount(1);
  await clickCell(viewer, 0, 0);
  await expect(stoneAt(host, 0, 0)).toHaveCount(0);
});

test('對手離開時會提示', async ({ context }) => {
  const host = await context.newPage();
  const guest = await context.newPage();
  await openRoom(host, guest);
  await guest.getByRole('button', { name: '離開' }).click();
  await guest.getByRole('dialog').getByRole('button', { name: '離開' }).click();
  await expect(host.getByRole('status').first()).toHaveText(/對手離線/);
});

test('找不到房間有明確訊息', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: /線上對戰/ }).click();
  await page.getByRole('textbox', { name: '房間代碼或邀請連結' }).fill('ABC');
  await page.getByRole('button', { name: '加入', exact: true }).click();
  await expect(page.getByText('請輸入 6 位房間代碼')).toBeVisible();
  await page.getByRole('textbox', { name: '房間代碼或邀請連結' }).fill('ZZZZZZ');
  await page.getByRole('button', { name: '加入', exact: true }).click();
  await expect(page.getByText('找不到這個房間')).toBeVisible();
});
