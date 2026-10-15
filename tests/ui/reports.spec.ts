import { test, expect, type Page } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
async function openFixture(page: Page, name: 'finished') {
  const fixture = JSON.parse(readFileSync('artifacts/ui-fixtures.json', 'utf8'))[name];
  await page.addInitScript((credentials) => {
    localStorage.setItem('mp-seat', JSON.stringify(credentials));
    localStorage.setItem('mp-reduced', 'true');
  }, fixture);
  await page.goto(`/?room=${fixture.code}`);
  await expect(page.locator('.connection')).toContainText('已同步');
}
for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 390, height: 844 },
]) {
  const device = viewport.width > 800 ? 'desktop' : 'mobile';
  test(`${device}: real round history, line/donut/radar charts, focus containment and report reopening`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await openFixture(page, 'finished');
    const report = page.getByRole('dialog', { name: '旅程纪念册' });
    await expect(report).toBeVisible();
    await expect(report.getByRole('heading', { name: /获胜/ })).toBeVisible();
    await expect(report.getByRole('button', { name: '再开启一段旅程 →' })).toBeVisible();
    mkdirSync('artifacts/ui', { recursive: true });
    await page.screenshot({ path: `artifacts/ui/${device}-report-overview.png` });
    await report.getByRole('button', { name: '回合复盘', exact: true }).click();
    await expect(report.getByRole('img', { name: '每轮财务趋势图' })).toBeVisible();
    await expect(report.locator('.report-table tbody tr')).toHaveCount(6);
    await report.getByLabel('选择复盘轮次').focus();
    await report.getByLabel('选择复盘轮次').press('Home');
    await expect(report.locator('.round-control')).toContainText('开局资产');
    await report.getByLabel('选择复盘轮次').press('ArrowRight');
    await expect(report.locator('.round-control')).toContainText('第 1 轮结束');
    const selected = await report.getByLabel('选择复盘轮次').inputValue();
    // A touch used to scroll the report must not change the selected round.
    await report.getByRole('img', { name: '每轮财务趋势图' }).dispatchEvent('pointermove', {
      pointerType: 'touch',
      clientX: 0,
    });
    await expect(report.getByLabel('选择复盘轮次')).toHaveValue(selected);
    await report.getByLabel('趋势指标').selectOption('netRent');
    await expect(report.locator('.trend-chart')).toBeVisible();
    await page.screenshot({ path: `artifacts/ui/${device}-report-rounds.png` });
    await report.getByRole('button', { name: '玩家对比', exact: true }).click();
    await report.getByLabel('观察玩家').selectOption({ index: 1 });
    await expect(report.getByRole('img', { name: '资产构成环图' })).toBeVisible();
    await expect(report.getByRole('img', { name: '玩家六维能力雷达图' })).toBeVisible();
    await page.screenshot({ path: `artifacts/ui/${device}-report-comparison.png` });
    expect(
      await report
        .locator('svg')
        .evaluateAll((nodes) => nodes.some((n) => n.outerHTML.includes('NaN'))),
    ).toBe(false);
    expect(await report.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    // Native dialog traps focus, and Escape returns to the board.
    await page.keyboard.press('Escape');
    await expect(report).toHaveCount(0);
    await page.getByRole('button', { name: '🏁 查看旅程纪念册' }).click();
    await expect(report).toBeVisible();
    await report.getByRole('button', { name: '收起，看看棋盘' }).click();
    await expect(report).toHaveCount(0);
    expect(errors).toEqual([]);
  });
  test(`${device}: inline trajectories expand on demand without a separate console`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await openFixture(page, 'finished');
    await page.getByRole('button', { name: '收起结算面板' }).click();
    if (viewport.width < 801)
      await page.getByRole('button', { name: '打开动态', exact: true }).click();
    await expect(page.getByRole('button', { name: 'AI 轨迹 ↗', exact: true })).toHaveCount(0);
    const feed = page.locator(`.activity-feed.${device === 'mobile' ? 'in-panel' : 'docked'}`);
    await expect(feed.locator('.trace-timeline')).toHaveCount(0);
    const detail = feed.locator('.feed-trace').first();
    await detail.locator('summary').click();
    await expect(detail.locator('.trace-timeline')).toContainText('读取全局局面');
    await expect(detail.locator('.trace-timeline')).toContainText('查询目的');
    await expect(detail.locator('.trace-timeline')).toContainText('提交决定');
    await detail.locator('summary').click();
    await expect(feed.locator('.trace-timeline')).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Agent 决策台' })).toHaveCount(0);
  });
}
