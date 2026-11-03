import { devices, expect, test } from 'playwright/test';
import { clickCell, point, startAi, startLocal, stoneAt, stoneCount } from './helpers.ts';

test.beforeEach(async ({ page }) => {
  await page.route('**/fonts.g*/**', (route) => route.abort());
});

test('點擊的位置就是落子的位置', async ({ page }) => {
  await startLocal(page);
  await clickCell(page, 7, 7);
  await expect(stoneAt(page, 7, 7)).toHaveCount(1);
  // 舊版在手機上偏 4 像素就會落到隔壁格：這裡偏離但仍在格內，必須落在同一點
  const { x, y, unit } = await point(page, 3, 3);
  await page.mouse.click(x + unit * 40, y - unit * 40);
  await expect(stoneAt(page, 3, 3)).toHaveCount(1);
});

test('雙人對局：五連後顯示印章，可以再來一局', async ({ page }) => {
  await startLocal(page);
  for (let col = 0; col < 4; col++) {
    await clickCell(page, 7, col);
    await clickCell(page, 8, col);
  }
  await clickCell(page, 7, 4);
  await expect(page.locator('.seal')).toHaveText('黑勝');
  await expect(page.locator('.win-line')).toHaveCount(1);
  await expect(page.getByRole('status').first()).toContainText('黑棋獲勝');
  await page.getByRole('button', { name: '再來一局' }).click();
  await expect(page.locator('.seal')).toBeHidden();
  expect(await stoneCount(page)).toBe(0);
});

test('對電腦：回應、悔棋退回自己的回合、重開不會收到舊的 AI 棋步', async ({ page }) => {
  await startAi(page);
  await clickCell(page, 7, 7);
  await expect(page.locator('.stone')).toHaveCount(2);
  await page.getByRole('button', { name: '悔棋' }).click();
  await expect(page.locator('.stone')).toHaveCount(0);
  await expect(page.getByText('輪到你')).toBeVisible();

  // 電腦思考中悔棋：思考要被取消
  await clickCell(page, 7, 7);
  await page.getByRole('button', { name: '悔棋' }).click();
  await page.waitForTimeout(600);
  await expect(page.locator('.stone')).toHaveCount(0);
});

test('再玩一次會保留對手與難度設定', async ({ page }) => {
  await startAi(page, '入門');
  await page.getByRole('button', { name: '認輸' }).click();
  await page.getByRole('dialog').getByRole('button', { name: '認輸' }).click();
  await page.getByRole('button', { name: '再來一局' }).click();
  await expect(page.getByText('電腦（入門）')).toBeVisible();
});

test('對局自動保存，重新載入後可以繼續', async ({ page }) => {
  await startLocal(page);
  await clickCell(page, 7, 7);
  await clickCell(page, 7, 8);
  await page.reload();
  await page.getByRole('button', { name: /繼續上一盤/ }).click();
  await expect(page.locator('.stone')).toHaveCount(2);
  await expect(page.getByText('輪到黑棋')).toBeVisible();
});

test('連珠：黑棋禁手點有標記，而且下不上去', async ({ page }) => {
  await startLocal(page, '連珠');
  const moves: [number, number][] = [
    [6, 6],
    [0, 0],
    [7, 6],
    [0, 14],
    [8, 7],
    [14, 0],
    [8, 8],
    [14, 14],
  ];
  for (const [row, col] of moves) await clickCell(page, row, col);
  await expect(page.locator('.forbidden-mark')).not.toHaveCount(0);
  await clickCell(page, 8, 6);
  await expect(stoneAt(page, 8, 6)).toHaveCount(0);
  await expect(page.getByText('雙三禁手')).toBeVisible();
});

test('棋譜連結：分享後開啟可復盤與分析', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await startLocal(page);
  for (let col = 0; col < 4; col++) {
    await clickCell(page, 7, col);
    await clickCell(page, 8, col);
  }
  await clickCell(page, 7, 4);
  await page.getByRole('button', { name: '複製棋譜連結' }).click();
  await expect(page.getByText('已複製')).toBeVisible();
  const url = await page.evaluate(() => navigator.clipboard.readText());
  expect(url).toContain('#/g/1-15-f-');

  await page.goto(url);
  await page.reload();
  await expect(page.getByText('第 9 手，共 9 手')).toBeVisible();
  await page.getByRole('button', { name: '上一手' }).click();
  await expect(page.locator('.stone')).toHaveCount(8);
  await page.getByRole('button', { name: '分析這盤棋' }).click();
  await expect(page.locator('.chart-line')).toBeVisible({ timeout: 20_000 });
});

test('亂改的棋譜連結不會讓程式壞掉', async ({ page }) => {
  await page.goto('./#/g/1-15-f-zzzz');
  await expect(page.getByText('讀不出這份棋譜')).toBeVisible();
  await expect(page.getByRole('button', { name: /和電腦下/ })).toBeVisible();
});

test('殘局題：能解開並記錄', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: /殘局題/ }).click();
  await page.getByRole('button', { name: /第 1 題/ }).click();
  await page.getByRole('button', { name: '提示' }).click();
  await expect(page.locator('.hint-mark')).toHaveCount(1);
  // 一路照提示下
  for (let i = 0; i < 3; i++) {
    await expect(page.locator('.hint-mark')).toHaveCount(1);
    const box = await page.locator('.hint-mark').boundingBox();
    if (!box) throw new Error('沒有提示');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(700);
    if ((await page.locator('.seal:visible').count()) > 0) break;
    await page.getByRole('button', { name: '提示' }).click();
  }
  await expect(page.getByText('解開了！')).toBeVisible();
  await page.getByRole('button', { name: '離開' }).click();
  await expect(page.getByText('已解開').first()).toBeVisible();
});

test('設定：主題、語言、棋盤材質會保存', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: '設定' }).click();
  await page.getByRole('radio', { name: '深色' }).click();
  await page.getByRole('radio', { name: '墨色' }).click();
  await page.getByRole('radio', { name: 'English' }).click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-skin', 'sumi');
  await expect(page.getByRole('button', { name: /Play the computer/ })).toBeVisible();
});

test('鍵盤可以完整下棋', async ({ page }) => {
  await startLocal(page);
  await page.locator('.board-svg').focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(page.locator('.stone')).toHaveCount(1);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Space');
  await expect(page.locator('.stone')).toHaveCount(2);
  await page.keyboard.press('u');
  await expect(page.locator('.stone')).toHaveCount(1);
});

test.describe('手機', () => {
  test.use({ viewport: devices['iPhone 13'].viewport, hasTouch: true, isMobile: true });

  test('觸控：第一下預覽，第二下才落子，不會有橫向捲動', async ({ page }) => {
    await startLocal(page);
    const { x, y } = await point(page, 7, 7);
    await page.touchscreen.tap(x, y);
    await expect(page.locator('.ghost.is-pending')).toHaveCount(1);
    await expect(page.locator('.stone')).toHaveCount(0);
    await page.touchscreen.tap(x, y);
    await expect(stoneAt(page, 7, 7)).toHaveCount(1);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe('手機首頁', () => {
  test.use({ viewport: devices['iPhone 13'].viewport, hasTouch: true, isMobile: true });

  test('第一屏就看得到主要選單', async ({ page }) => {
    await page.goto('./');
    const box = await page.getByRole('button', { name: /線上對戰/ }).boundingBox();
    expect((box?.y ?? 9999) + (box?.height ?? 0)).toBeLessThan(844);
  });
});

test.describe('環境不允許 Worker', () => {
  test('建立 Worker 直接失敗時，電腦仍會回應', async ({ page }) => {
    await page.addInitScript(() => {
      window.Worker = class {
        constructor() {
          throw new Error('blocked');
        }
      } as unknown as typeof Worker;
    });
    await startAi(page);
    await clickCell(page, 7, 7);
    await expect(page.locator('.stone')).toHaveCount(2);
  });

  test('Worker 載入失敗時，電腦仍會回應', async ({ page }) => {
    await page.addInitScript(() => {
      window.Worker = class {
        onerror: (() => void) | null = null;
        postMessage() {
          setTimeout(() => this.onerror?.(), 10);
        }
        terminate() {}
      } as unknown as typeof Worker;
    });
    await startAi(page);
    await clickCell(page, 7, 7);
    await expect(page.locator('.stone')).toHaveCount(2);
  });
});
