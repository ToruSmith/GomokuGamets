import type { Page } from 'playwright/test';

/** 棋盤 (row, col) 交叉點的螢幕座標 */
export async function point(page: Page, row: number, col: number, size = 15) {
  const box = await page.locator('.board-svg').boundingBox();
  if (!box) throw new Error('找不到棋盤');
  const unit = box.width / ((size - 1) * 100 + 160);
  return { x: box.x + (80 + col * 100) * unit, y: box.y + (80 + row * 100) * unit, unit };
}

export async function clickCell(page: Page, row: number, col: number, size = 15) {
  const { x, y } = await point(page, row, col, size);
  await page.mouse.click(x, y);
}

export const stoneAt = (page: Page, row: number, col: number, size = 15) =>
  page.locator(`.stone[data-cell="${row * size + col}"]`);

export const stoneCount = (page: Page) => page.locator('.stone').count();

export async function startLocal(page: Page, rule?: string) {
  await page.goto('./');
  await page.getByRole('button', { name: /兩人同機/ }).click();
  if (rule) await page.getByRole('radio', { name: rule }).click();
  await page.getByRole('button', { name: '開始對局' }).click();
}

export async function startAi(page: Page, level = '入門', side = '黑棋') {
  await page.goto('./');
  await page.getByRole('button', { name: /和電腦下/ }).click();
  await page.getByRole('radio', { name: level }).click();
  await page.getByRole('radio', { name: side }).click();
  await page.getByRole('button', { name: '開始對局' }).click();
}
