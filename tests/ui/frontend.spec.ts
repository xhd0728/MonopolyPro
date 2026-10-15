import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
for (const viewport of [
  { width: 1280, height: 720 },
  { width: 820, height: 900 },
  { width: 360, height: 800 },
]) {
  test(`frontend layout and controls at ${viewport.width}px: long names, six players, trade, atlas, cards and settings`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');
    await page.getByRole('button', { name: '创建房间', exact: true }).click();
    await expect(page.getByRole('heading', { name: '准备出发' })).toBeVisible();
    await page.getByLabel('我的昵称').fill('界'.repeat(16));
    await page.getByLabel('我的昵称').press('Enter');
    await expect(page.locator('.seat-rename button')).toHaveCount(0);
    // Dispatch in one browser task so no server reply can refresh the view between edits.
    await page.evaluate(() => {
      for (const [label, value] of [
        ['席位上限', '6'],
        ['地图大小', '44'],
      ]) {
        const select = document.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
        select.value = value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    await expect(page.getByLabel('席位上限')).toHaveValue('6');
    await expect(page.getByLabel('地图大小')).toHaveValue('44');
    for (let i = 0; i < 5; i++) {
      await page.getByRole('button', { name: '添加规则机器人', exact: true }).first().click();
      await expect(page.locator('.seat-row:not(.empty)')).toHaveCount(i + 2);
    }
    await page.getByRole('button', { name: '开始旅程', exact: true }).click();
    await expect(page.locator('.player-card')).toHaveCount(6);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    mkdirSync('artifacts/ui-review', { recursive: true });
    await page.screenshot({ path: `artifacts/ui-review/board-${viewport.width}.png` });
    await page
      .getByRole('button', { name: viewport.width <= 800 ? '打开资产' : '资产', exact: true })
      .click();
    await expect(page.locator('.bank-panel .section-heading > span')).toBeVisible();
    await expect(page.locator('.bank-panel .section-heading')).toContainText('本轮利息 1.5%');
    if (viewport.width <= 800) await page.getByRole('button', { name: '关闭详情抽屉' }).click();
    else
      await page
        .locator('.action-panel')
        .getByRole('button', { name: '操作', exact: true })
        .click();
    if (viewport.width <= 800)
      await page.getByRole('button', { name: '打开操作', exact: true }).click();
    await page
      .locator('.action-panel')
      .getByRole('button', { name: /发起交易/ })
      .click();
    const trade = page.getByRole('dialog', { name: '提出一笔交易' });
    await expect(trade).toBeVisible();
    await expect(trade.getByRole('button', { name: '发出提案', exact: true })).toBeInViewport();
    expect(await trade.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    const boxes = await trade
      .locator('.trade-grid > section')
      .evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect().toJSON()));
    if (viewport.width <= 480) expect(boxes[1].top).toBeGreaterThanOrEqual(boxes[0].bottom);
    else expect(Math.abs(boxes[1].top - boxes[0].top)).toBeLessThan(1);
    expect(
      await trade.locator('.trade-cash button').evaluateAll((buttons) =>
        buttons.every((button) => {
          const range = document.createRange();
          range.selectNodeContents(button);
          const tops = [...range.getClientRects()].map((rect) => rect.top);
          return tops.length > 0 && Math.max(...tops) - Math.min(...tops) < 3;
        }),
      ),
    ).toBe(true);
    await page.keyboard.press('?');
    await expect(page.locator('.toast')).toHaveCount(0);
    await page.screenshot({ path: `artifacts/ui-review/trade-${viewport.width}.png` });
    await trade.getByRole('button', { name: '关闭', exact: true }).click();
    await page
      .locator('.action-panel')
      .getByRole('button', { name: '♧ 卡牌市场', exact: true })
      .click();
    const shop = page.getByRole('dialog', { name: '旅途卡牌市场' });
    await expect(shop.locator('.catalog-grid article')).toHaveCount(30);
    expect(await shop.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await shop.locator('.catalog-grid article').last().scrollIntoViewIfNeeded();
    await expect(shop.getByRole('button', { name: '关闭', exact: true })).toBeInViewport();
    await shop.getByRole('button', { name: '关闭', exact: true }).click();
    if (viewport.width <= 800) await page.getByRole('button', { name: '关闭详情抽屉' }).click();
    await page.getByRole('button', { name: '规则图鉴', exact: true }).click();
    const atlas = page.getByRole('dialog', { name: '旅途图鉴' });
    for (const tab of ['地图', '角色', '卡牌', '机会命运', '规则']) {
      await atlas.getByRole('button', { name: tab, exact: true }).click();
      expect(await atlas.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    }
    expect(
      await atlas.locator('.panel-tabs button').evaluateAll((buttons) =>
        buttons.every((button) => {
          const range = document.createRange();
          range.selectNodeContents(button);
          const tops = [...range.getClientRects()].map((rect) => rect.top);
          return tops.length > 0 && Math.max(...tops) - Math.min(...tops) < 3;
        }),
      ),
    ).toBe(true);
    await atlas.getByRole('button', { name: '关闭', exact: true }).click();
    await page.getByRole('button', { name: '设置', exact: true }).click();
    const settings = page.getByRole('dialog', { name: '让旅程更合心意' });
    await settings.getByLabel('减少移动动画').check();
    await expect(settings.getByLabel('减少移动动画')).toBeChecked();
    await settings.getByRole('button', { name: '关闭', exact: true }).click();
    await page.getByRole('button', { name: /^查看1号玩家/ }).click();
    const profile = page.getByRole('dialog').filter({ has: page.getByLabel('资产明细') });
    expect(await profile.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await page.getByRole('button', { name: '关闭玩家资料' }).click();
    await page.getByRole('button', { name: '查看新加坡', exact: true }).click();
    const country = page.getByRole('dialog', { name: '地点详情' });
    const cards = await country
      .locator('.country-finances > div')
      .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().toJSON()));
    expect(cards).toHaveLength(4);
    expect(cards[0].top).toEqual(cards[1].top);
    expect(cards[2].top).toEqual(cards[3].top);
    expect(cards[2].top).toBeGreaterThan(cards[0].top);
    await page.screenshot({ path: `artifacts/ui-review/country-${viewport.width}.png` });
    await country.getByRole('button', { name: '关闭地点详情', exact: true }).click();
    expect(errors).toEqual([]);
  });
}
