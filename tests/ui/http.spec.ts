import { test, expect } from '@playwright/test';

test.use({
  baseURL: 'http://monopolypro.test:8792',
  launchOptions: { args: ['--host-resolver-rules=MAP monopolypro.test 127.0.0.1'] },
});

test('plain HTTP: a six-player match acknowledges ability and dice commands', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  // Localhost is a secure context even on HTTP; use a non-local hostname to reproduce production.
  expect(await page.evaluate(() => window.isSecureContext)).toBe(false);
  expect(await page.evaluate(() => typeof crypto.randomUUID)).toBe('undefined');
  await page.getByRole('button', { name: '创建房间', exact: true }).click();
  await expect(page.getByRole('heading', { name: '准备出发' })).toBeVisible();
  await page.getByRole('radio', { name: /顾老板/ }).click();
  await page.getByLabel('席位上限').selectOption('6');
  for (let i = 0; i < 5; i++) {
    await page.getByRole('button', { name: '添加规则机器人' }).first().click();
    await expect(page.locator('.seat-row:not(.empty)')).toHaveCount(i + 2);
  }
  await page.getByRole('button', { name: '开始旅程' }).click();
  await expect(page.locator('.player-card')).toHaveCount(6);
  const board = page.locator('.board-meta');
  const revision = await board.getAttribute('data-revision');
  await page.getByRole('button', { name: /^使用角色天赋/ }).click();
  await expect(board).not.toHaveAttribute('data-revision', revision!);
  await expect(page.locator('.player-card[data-self="true"]')).toContainText('3,150');
  await expect(page.getByRole('button', { name: '掷骰出发', exact: true })).toBeEnabled();
  const afterAbility = await board.getAttribute('data-revision');
  await page.getByRole('button', { name: '掷骰出发', exact: true }).click();
  await expect(board).not.toHaveAttribute('data-revision', afterAbility!);
  await expect(page.locator('.dice-stage')).toContainText('掷出');
  await expect(page.getByRole('button', { name: '等待确认…', exact: true })).toHaveCount(0);
  const acceptedRevision = await board.getAttribute('data-revision');
  await page.reload();
  await expect(page.locator('.connection')).toContainText('已同步');
  await expect(board).toHaveAttribute('data-revision', acceptedRevision!);
  expect(errors).toEqual([]);
});
