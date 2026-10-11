import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
async function create(page: Page, name: string) {
  await page.goto('/');
  await page.getByRole('button', { name: '创建朋友房间' }).click();
  await page.getByLabel('游客昵称').fill(name);
  await page.getByLabel('席位上限').selectOption('2');
  await page.getByRole('button', { name: '创建并进入' }).click();
  await expect(page.getByRole('heading', { name: '准备出发' })).toBeVisible();
  return new URL(page.url()).searchParams.get('room')!;
}
test('desktop and mobile multiplayer journey: invite, ready, card, purchase, build, trade, refresh, reconnect, atlas and settlement', async ({
  browser,
}) => {
  mkdirSync('artifacts/ui', { recursive: true });
  const a = await browser.newContext({ viewport: { width: 1440, height: 1000 } }),
    b = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const host = await a.newPage(),
    guest = await b.newPage();
  const errors: string[] = [];
  host.on('pageerror', (e) => errors.push(e.message));
  guest.on('pageerror', (e) => errors.push(e.message));
  const code = await create(host, '小筑');
  await guest.goto(`/?room=${code}`);
  await guest.getByRole('button', { name: '加入房间', exact: true }).click();
  await guest.getByLabel('游客昵称').fill('飞飞');
  await guest.getByRole('button', { name: '加入房间', exact: true }).last().click();
  await expect(guest.getByRole('heading', { name: '准备出发' })).toBeVisible();
  await host.getByRole('button', { name: '我准备好了' }).click();
  await guest.getByRole('button', { name: '我准备好了' }).click();
  await expect(host.getByRole('button', { name: '开始旅程' })).toBeEnabled();
  await host.getByRole('button', { name: '开始旅程' }).click();
  await expect(host.getByRole('button', { name: '掷骰出发', exact: true })).toBeVisible();
  await expect(guest.getByText('小筑正在操作')).toBeVisible();
  // Named contextual hints, authority-supplied buttons and modal targets are exercised through the UI.
  const ownCard = host.locator('.hand button:not([disabled])').first();
  await ownCard.click();
  await expect(host.getByRole('dialog', { name: /使用/ })).toBeVisible();
  const target = host.getByLabel('选择目标');
  if (await target.isVisible()) {
    const values = await target
      .locator('option')
      .evaluateAll((options) => options.map((o) => (o as HTMLOptionElement).value).filter(Boolean));
    if (values.length) await target.selectOption(values[0]);
  }
  const confirm = host.getByRole('button', { name: '确认使用' });
  if (await confirm.isEnabled()) await confirm.click();
  else await host.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(host.locator('.actions button').first()).toBeEnabled();
  for (let turn = 0; turn < 10; turn++) {
    const p = (await host.locator('.turn-prompt').innerText()).includes('轮到你了') ? host : guest;
    await expect(p.locator('.actions button').first()).toBeEnabled();
    const roll = p.getByRole('button', { name: '掷骰出发', exact: true });
    if (await roll.isVisible()) {
      await roll.click();
      await expect(p.locator('.turn-prompt h2')).not.toHaveText('掷骰出发');
    }
    const buy = p.getByRole('button', { name: /^购买 ·/ });
    if (await buy.isVisible()) {
      await buy.click();
      await p.getByRole('button', { name: '资产', exact: true }).click();
      const build = p.getByRole('button', { name: /^升级建筑/ }).first();
      if (await build.isVisible()) await build.click();
      await p.getByRole('button', { name: '操作', exact: true }).click();
      break;
    }
    const end = p.getByRole('button', { name: '结束回合', exact: true });
    if (await end.isVisible()) await end.click();
    await expect(p.getByText(/正在操作/)).toBeVisible();
  }
  const current = (await host.locator('.turn-prompt').innerText()).includes('轮到你了')
      ? host
      : guest,
    other = current === host ? guest : host;
  await current.getByRole('button', { name: '发起交易' }).click();
  await current
    .getByRole('dialog', { name: '提出一笔交易' })
    .getByLabel('现金', { exact: true })
    .first()
    .fill('50');
  await current.getByRole('button', { name: '发出提案' }).click();
  await expect(other.getByRole('button', { name: '接受交易' })).toBeVisible();
  await other.getByRole('button', { name: '接受交易' }).click();
  await expect(current.getByRole('button', { name: '结束回合', exact: true })).toBeVisible();
  await host.getByRole('button', { name: '动态', exact: true }).click();
  await expect(host.locator('.event-feed').getByText(/完成交易，资产同时结算/)).toBeVisible();
  await host.getByRole('button', { name: '操作', exact: true }).click();
  await host.reload();
  await expect(host.locator('.connection')).toContainText('已同步');
  await expect(host.locator('.player-panel')).toContainText('小筑 · 我');
  await b.setOffline(true);
  await expect(guest.locator('.connection')).toContainText(/重连|恢复/, { timeout: 15000 });
  await expect(host.locator('.player-panel')).toContainText('机器人托管', { timeout: 15000 });
  await b.setOffline(false);
  await expect(guest.locator('.connection')).toContainText('已同步', { timeout: 20000 });
  await expect(guest.locator('.player-panel')).toContainText('飞飞 · 我');
  await guest.getByRole('button', { name: '打开资产', exact: true }).click();
  await expect(guest.locator('.sheet-open')).toBeVisible();
  await guest.getByRole('button', { name: '关闭详情抽屉' }).click();
  await guest.getByRole('button', { name: '规则图鉴' }).click();
  await guest.getByRole('button', { name: '卡牌', exact: true }).click();
  await expect(guest.locator('.catalog-grid article')).toHaveCount(30);
  await guest.getByRole('button', { name: '关闭', exact: true }).click();
  await guest.getByRole('button', { name: '查看梧桐公寓', exact: true }).click();
  await expect(guest.getByRole('dialog', { name: '地点详情' })).toBeVisible();
  await guest.getByRole('button', { name: '关闭地点详情' }).click();
  await host.screenshot({ path: 'artifacts/ui/desktop-match.png', fullPage: true });
  await guest.screenshot({ path: 'artifacts/ui/mobile-match.png', fullPage: true });
  const width = await guest.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    viewport: innerWidth,
  }));
  expect(width.scroll).toBeLessThanOrEqual(width.viewport + 1);
  await guest.getByRole('button', { name: '离开房间', exact: true }).click();
  await guest.getByRole('button', { name: '确认退出经营' }).click();
  await expect(host.locator('.settlement')).toContainText('小筑获胜');
  expect(errors).toEqual([]);
  await a.close();
  await b.close();
});
test('interactive tutorial can be skipped and restarted, settings and map previews work', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.screenshot({ path: 'artifacts/ui/mobile-home.png', fullPage: true });
  await page.getByRole('button', { name: /滨海群岛/ }).click();
  await expect(page.getByRole('img', { name: /滨海群岛立体棋盘/ })).toBeVisible();
  await page.getByRole('button', { name: '开始互动教学' }).click();
  await expect(page.getByRole('region', { name: '互动教学' })).toBeVisible();
  await page.getByRole('button', { name: '添加机器人' }).click();
  await page.getByRole('button', { name: '我准备好了' }).click();
  await page.getByRole('button', { name: '开始旅程' }).click();
  await expect(page.getByRole('region', { name: '互动教学' })).toContainText('掷骰，探索城市');
  await page.getByRole('button', { name: '跳过教学' }).click();
  await expect(page.getByRole('region', { name: '互动教学' })).toHaveCount(0);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByLabel('减少移动动画').check();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '规则图鉴' }).click();
  await page.getByRole('button', { name: '重新开始互动教学' }).click();
  await expect(page.getByRole('region', { name: '互动教学' })).toBeVisible();
});
