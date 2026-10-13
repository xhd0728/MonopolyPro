import { test, expect, type Page, type Locator } from '@playwright/test';
import { mkdirSync } from 'node:fs';
async function accepted(page: Page, button: Locator) {
  const board = page.locator('.board-meta'),
    revision = await board.getAttribute('data-revision');
  await button.click();
  await expect(board).not.toHaveAttribute('data-revision', revision!);
}
async function create(page: Page, name: string, seats = 2) {
  await page.goto('/');
  await page.getByRole('button', { name: '创建朋友房间' }).click();
  await page.getByLabel('游客昵称').fill(name);
  await page.getByLabel('席位上限').selectOption(String(seats));
  await page.getByRole('button', { name: '创建并进入' }).click();
  await expect(page.getByRole('heading', { name: '准备出发' })).toBeVisible();
  return new URL(page.url()).searchParams.get('room')!;
}
async function openPanel(page: Page, panel = '操作') {
  const quick = page.getByRole('button', { name: `打开${panel}`, exact: true });
  await expect(page.locator('.board-meta')).toBeVisible();
  if ((page.viewportSize()?.width ?? 1440) <= 800) await quick.click();
  else
    await page.locator('.action-panel').getByRole('button', { name: panel, exact: true }).click();
}
async function closePanel(page: Page) {
  const close = page.getByRole('button', { name: '关闭详情抽屉' });
  if (await close.isVisible()) await close.click();
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
  await host.getByLabel('聊天内容').fill('<b>一起出发</b>');
  await host.getByRole('button', { name: '发送聊天' }).click();
  await expect(guest.locator('.chat-feed')).toContainText('<b>一起出发</b>');
  await expect(guest.locator('.chat-feed b')).toHaveCount(1);
  await host.getByRole('button', { name: '我准备好了' }).click();
  await guest.getByRole('button', { name: '我准备好了' }).click();
  await expect(host.getByRole('button', { name: '开始旅程' })).toBeEnabled();
  await host.getByRole('button', { name: '开始旅程' }).click();
  await expect(host.getByRole('button', { name: '掷骰出发', exact: true })).toBeVisible();
  await expect(guest.locator('.mobile-primary-row')).toContainText('等待小筑的回合');
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
    await openPanel(p);
    await expect(p.locator('.actions button').first()).toBeEnabled();
    const jail = p.getByRole('button', { name: '掷骰出狱', exact: true });
    if (await jail.isVisible()) {
      await accepted(p, jail);
      await openPanel(p);
    }
    const roll = p.getByRole('button', { name: '掷骰出发', exact: true });
    if (await roll.isVisible()) {
      await roll.click();
      await expect(p.locator('.turn-prompt h2')).not.toHaveText('掷骰出发');
    }
    const buy = p.getByRole('button', { name: /^购买 ·/ });
    if (await buy.isVisible()) {
      await buy.click();
      await openPanel(p, '资产');
      const build = p.getByRole('button', { name: /^升级建筑/ }).first();
      if (await build.isVisible()) await build.click();
      await openPanel(p);
      break;
    }
    const end = p.getByRole('button', { name: '结束回合', exact: true });
    if (await end.isVisible()) await end.click();
    await expect(p.locator('.player-card[data-self="true"]')).not.toHaveClass(/active/);
  }
  const current = (await host.locator('.turn-prompt').innerText()).includes('轮到你了')
      ? host
      : guest,
    other = current === host ? guest : host;
  await closePanel(current);
  await current.locator('.player-card[data-self="true"]').click();
  const financials = await current.getByLabel('资产明细').locator('strong').allTextContents();
  const [net, cash, savings, property, debt] = financials.map((v) => Number(v.replaceAll(',', '')));
  expect(net).toBe(cash + savings + property - debt);
  expect(await current.locator('.public-property-list button').count()).toBeGreaterThan(0);
  await current.screenshot({ path: 'artifacts/ui/player-assets.png', fullPage: true });
  await current.getByRole('button', { name: '关闭玩家资料' }).click();
  await openPanel(current);
  await current.getByRole('button', { name: '发起交易' }).click();
  await current
    .getByRole('dialog', { name: '提出一笔交易' })
    .getByLabel('现金', { exact: true })
    .first()
    .fill('50');
  const cashInput = current
    .getByRole('dialog', { name: '提出一笔交易' })
    .getByLabel('现金', { exact: true })
    .first();
  await cashInput.fill('-1');
  await expect(current.getByRole('button', { name: '发出提案' })).toBeDisabled();
  await expect(current.getByText('现金必须是非负整数', { exact: true })).toBeVisible();
  await cashInput.fill('50');
  await current.getByRole('button', { name: '发出提案' }).click();
  await expect(other.getByRole('button', { name: '接受交易' })).toBeVisible();
  await other.getByRole('button', { name: '接受交易' }).click();
  await expect(current.getByRole('button', { name: '结束回合', exact: true })).toBeVisible();
  // Desktop keeps the activity feed docked bottom-right, newest first; phones open it as a tab.
  await expect(host.locator('.activity-feed.docked .feed-row').first()).toBeVisible();
  await expect(host.locator('.activity-feed.docked')).toContainText(/完成交易，资产同时结算/);
  await openPanel(guest, '动态');
  await expect(guest.locator('.activity-feed.in-panel')).toContainText(/完成交易，资产同时结算/);
  await closePanel(guest);
  await host.reload();
  await expect(host.locator('.connection')).toContainText('已同步');
  await expect(host.getByRole('button', { name: /查看1号玩家小筑的资产/ })).toContainText('我');
  await b.setOffline(true);
  await expect(guest.locator('.connection')).toContainText(/重连|恢复/, { timeout: 15000 });
  await expect(host.locator('.player-panel')).toContainText('机器人托管', { timeout: 15000 });
  // The turn loop may leave the mobile drawer open; its backdrop covers the top bar.
  await closePanel(guest);
  await guest.getByRole('button', { name: '离开房间', exact: true }).click();
  await expect(guest.getByRole('button', { name: '确认退出经营' })).toBeDisabled();
  expect(await guest.evaluate(() => !!localStorage.getItem('mp-seat'))).toBe(true);
  await guest.getByRole('button', { name: '继续旅程', exact: true }).click();
  await b.setOffline(false);
  await expect(guest.locator('.connection')).toContainText('已同步', { timeout: 20000 });
  await expect(guest.getByRole('button', { name: /查看2号玩家飞飞的资产/ })).toContainText('我');
  await guest.getByRole('button', { name: '打开资产', exact: true }).click();
  await expect(guest.locator('.sheet-open')).toBeVisible();
  await guest.getByRole('button', { name: '关闭详情抽屉' }).click();
  await guest.getByRole('button', { name: '规则图鉴' }).click();
  await guest.getByRole('button', { name: '卡牌', exact: true }).click();
  await expect(guest.locator('.catalog-grid article')).toHaveCount(30);
  await guest.getByRole('button', { name: '关闭', exact: true }).click();
  await guest.getByRole('button', { name: '查看中国', exact: true }).click();
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
  await page.getByRole('button', { name: /海洋航线/ }).click();
  await expect(page.getByRole('group', { name: /海洋航线二维国家棋盘/ })).toBeVisible();
  await page.getByRole('button', { name: '开始互动教学' }).click();
  await expect(page.getByRole('region', { name: '互动教学' })).toBeVisible();
  await page.getByRole('button', { name: '添加机器人' }).click();
  await page.getByRole('button', { name: '我准备好了' }).click();
  await page.getByRole('button', { name: '开始旅程' }).click();
  await expect(page.getByRole('region', { name: '互动教学' })).toContainText('掷骰，探索世界');
  await page.getByRole('button', { name: '跳过教学' }).click();
  await expect(page.getByRole('region', { name: '互动教学' })).toHaveCount(0);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByLabel('减少移动动画').check();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '规则图鉴' }).click();
  await page.getByRole('button', { name: '重新开始互动教学' }).click();
  await expect(page.getByRole('region', { name: '互动教学' })).toBeVisible();
});
test('mobile country express map: real fork selection and auction input advance the match', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await create(page, '路线玩家');
  await page.getByLabel('地图', { exact: true }).selectOption('neon');
  await page.getByLabel('空地拍卖').selectOption('on');
  await page.getByRole('button', { name: '添加机器人' }).click();
  await page.getByRole('button', { name: '我准备好了' }).click();
  await page.getByRole('button', { name: '开始旅程' }).click();
  let fork = false,
    auction = false;
  for (let turn = 0; turn < 12 && (!fork || !auction); turn++) {
    await openPanel(page);
    // A jailed player rolls for a six instead of rolling to move. Bots may also offer to buy
    // a square they need; this flow declines such offers.
    const start = page.locator('.actions').getByRole('button', { name: /^掷骰出(发|狱)$/ });
    const decline = page.getByRole('button', { name: '拒绝交易' });
    await expect(start.or(decline)).toBeVisible({ timeout: 12000 });
    if (await decline.isVisible()) {
      await accepted(page, decline);
      await openPanel(page);
    }
    await expect(start).toBeEnabled({ timeout: 12000 });
    await accepted(page, start);
    await expect(page.locator('.turn-prompt h2')).not.toHaveText('掷骰出发');
    while (await page.getByRole('button', { name: /^前往/ }).count()) {
      fork = true;
      await accepted(page, page.getByRole('button', { name: /^前往/ }).last());
      await expect(page.locator('.actions button').first()).toBeEnabled();
    }
    await openPanel(page);
    if (await page.getByRole('button', { name: /^进入拍卖/ }).isVisible()) {
      if (!auction) {
        await accepted(page, page.getByRole('button', { name: /^进入拍卖/ }));
        await expect(page.getByLabel('竞价金额')).toBeVisible();
        await page.getByLabel('竞价金额').fill('999999');
        await expect(page.getByRole('button', { name: /^出价/ })).toBeDisabled();
        await expect(page.getByText('竞价不能超过可用现金')).toBeVisible();
        await page.getByLabel('竞价金额').fill('100');
        // The bid button names the amount actually typed, not the minimum.
        await expect(page.getByRole('button', { name: /^出价/ })).toHaveText(/出价 100/);
        await accepted(page, page.getByRole('button', { name: /^出价/ }));
        await expect(page.getByRole('button', { name: /^退出竞拍/ })).toBeEnabled();
        await accepted(page, page.getByRole('button', { name: /^退出竞拍/ }));
        await openPanel(page);
        await expect(page.getByRole('button', { name: '结束回合', exact: true })).toBeVisible();
        auction = true;
      } else {
        await accepted(page, page.getByRole('button', { name: /^购买 ·/ }));
        await openPanel(page);
        await expect(page.getByRole('button', { name: '结束回合', exact: true })).toBeVisible();
      }
    }
    await accepted(page, page.getByRole('button', { name: '结束回合', exact: true }));
  }
  expect(fork).toBe(true);
  expect(auction).toBe(true);
  await page.screenshot({ path: 'artifacts/ui/mobile-express.png', fullPage: true });
});
test('six player finances remain readable on desktop and mobile; a second window cannot control the old seat', async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  const code = await create(page, '资产玩家', 6);
  for (let i = 0; i < 5; i++) {
    await page.getByRole('button', { name: '添加机器人' }).first().click();
    await expect(page.locator('.seat')).toHaveCount(i + 2);
  }
  await page.getByRole('button', { name: '我准备好了' }).click();
  await page.getByRole('button', { name: '开始旅程' }).click();
  await expect(page.locator('.player-card')).toHaveCount(6);
  await expect(page.locator('.board-meta')).toContainText('第 1 / 16 轮');
  // Human decisions are not timed unless the host turns a limit on.
  await expect(page.locator('.decision-timer')).toContainText('不限时');
  await expect(page.locator('.country-tile.property').first()).toBeVisible();
  // Emotes: fixed reactions, shown on the sender's card and pawn.
  await page.getByRole('button', { name: '发送表情' }).click();
  await page.getByRole('menuitem', { name: '发送🎉' }).click();
  await expect(page.locator('.player-card[data-self="true"] .card-emote')).toHaveText('🎉');
  await expect(page.locator('.pawn-emote')).toHaveText('🎉');
  // Rename mid-match from settings; everyone's roster updates.
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByLabel('我的昵称').fill('新名字');
  await page.getByRole('button', { name: '保存昵称' }).click();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(page.locator('.player-card[data-self="true"]')).toContainText('新名字');
  // Auto-play on and off.
  await page.locator('.meta-afk').click();
  await expect(page.locator('.player-card[data-self="true"]')).toContainText('挂机托管中');
  await page.locator('.meta-afk').click();
  await expect(page.locator('.player-card[data-self="true"]')).not.toContainText('挂机托管中');
  await page.screenshot({ path: 'artifacts/ui/desktop-six-players.png', fullPage: true });
  const clipped = await page
    .locator('.country-tile')
    .evaluateAll((tiles) =>
      tiles
        .filter((t) => t.scrollHeight > t.clientHeight + 1)
        .map((t) => t.getAttribute('aria-label')),
    );
  expect(clipped).toEqual([]);
  for (const width of [390, 360]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.getByRole('button', { name: '快捷掷骰出发' })).toBeVisible();
    await page.getByRole('button', { name: /查看6号玩家/ }).click();
    await expect(page.getByRole('dialog', { name: 'AI · 6的资产' })).toContainText('地产回收价值');
    await expect(page.getByLabel('资产明细').locator('strong').first()).toHaveText('3,000');
    await page.keyboard.press('Escape');
    const layout = await page.evaluate(() => ({
      body: document.documentElement.scrollWidth,
      width: innerWidth,
      baseFont: parseFloat(getComputedStyle(document.documentElement).fontSize),
    }));
    expect(layout.body).toBeLessThanOrEqual(layout.width + 1);
    expect(layout.baseFont).toBeGreaterThanOrEqual(15);
  }
  await page.getByRole('button', { name: /查看1号玩家新名字的资产/ }).click();
  await page.getByRole('button', { name: '管理我的资产' }).click();
  await expect(page.getByLabel('存取金额')).toBeVisible();
  await page.getByLabel('存取金额').fill('-1');
  await expect(page.getByRole('button', { name: '存入银行', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '取出存款', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '关闭详情抽屉' }).click();
  await page.screenshot({ path: 'artifacts/ui/mobile-six-players.png', fullPage: true });
  const replacement = await context.newPage();
  await replacement.goto(`/?room=${code}`);
  await expect(replacement.locator('.connection')).toContainText('已同步');
  await expect(page.locator('.connection')).toContainText('席位已在其他窗口恢复');
  await expect(page.getByRole('button', { name: '快捷掷骰出发' })).toBeDisabled();
  await openPanel(replacement);
  await replacement.getByRole('button', { name: '掷骰出发', exact: true }).click();
  await expect(replacement.locator('.board-meta')).not.toHaveAttribute('data-revision', '0');
  await expect(page.locator('.connection')).toContainText('席位已在其他窗口恢复');
  expect(errors).toEqual([]);
  await replacement.close();
});
test('the complete board and all six players fit one screen; dice and opponent actions explain themselves', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await create(page, '一屏验收', 6);
  await expect(page.getByLabel('机器人策略')).toHaveValue('rule');
  for (let i = 0; i < 5; i++) {
    await page.getByRole('button', { name: '添加机器人' }).first().click();
    await expect(page.locator('.seat')).toHaveCount(i + 2);
  }
  await page.getByRole('button', { name: '我准备好了' }).click();
  await page.getByRole('button', { name: '开始旅程' }).click();
  await expect(page.locator('.country-tile')).toHaveCount(36);
  await expect(page.locator('.pawn')).toHaveCount(6);
  // Every seat sees whose turn it is; the acting seat's board glows.
  await expect(page.getByLabel('全场提示')).toContainText('轮到你了');
  await expect(page.locator('.board-square.attention')).toBeVisible();
  await expect(page.getByRole('button', { name: '棋盘上掷骰出发' })).toBeVisible();
  for (const [width, height] of [
    [1440, 900],
    [1366, 768],
    [1280, 720],
    [1024, 768],
    [900, 768],
    [390, 844],
    [360, 740],
  ]) {
    await page.setViewportSize({ width, height });
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const tiles = [...document.querySelectorAll<HTMLElement>('.country-tile')];
            const players = [...document.querySelectorAll<HTMLElement>('.player-card')];
            const within = (e: HTMLElement) => {
              const r = e.getBoundingClientRect();
              return (
                r.top >= 0 &&
                r.left >= 0 &&
                r.right <= innerWidth + 1 &&
                r.bottom <= innerHeight + 1
              );
            };
            return {
              pageFits:
                document.documentElement.scrollHeight <= innerHeight + 1 &&
                document.documentElement.scrollWidth <= innerWidth + 1,
              boardFits: tiles.length === 36 && tiles.every(within),
              pawnsOnBoard: [...document.querySelectorAll<HTMLElement>('.pawn')].every(within),
              playersFit: players.length === 6 && players.every(within),
              tileContentFits: tiles.every((t) => t.scrollHeight <= t.clientHeight + 1),
              handFits:
                innerWidth <= 800 ||
                [...document.querySelectorAll<HTMLElement>('.hand button')].every(within),
              diceVisible: [...document.querySelectorAll<HTMLElement>('.dice-stage')].some(
                (d) => d.getClientRects().length > 0 && within(d),
              ),
            };
          }),
        { message: `${width}x${height} must show the entire game` },
      )
      .toEqual({
        pageFits: true,
        boardFits: true,
        pawnsOnBoard: true,
        playersFit: true,
        tileContentFits: true,
        handFits: true,
        diceVisible: true,
      });
    if (width === 1440 || width === 1366 || width === 390 || width === 360)
      await page.screenshot({ path: `artifacts/ui/one-screen-${width}.png` });
  }
  await accepted(page, page.getByRole('button', { name: '快捷掷骰出发' }));
  const cubes = page.locator('.dice-stage:visible .dice-cube');
  for (const cube of await cubes.all()) {
    const value = Number((await cube.getAttribute('aria-label'))!.split(' ')[0]);
    expect(await cube.locator('.pip').count()).toBe(value);
  }
  await expect(page.locator('.dice-stage:visible')).toContainText('前进');
  await expect(page.getByLabel('实时行动提示')).toBeVisible();
  await openPanel(page);
  const buy = page.getByRole('button', { name: /^购买 ·/ });
  if (await buy.isVisible()) {
    await accepted(page, buy);
    // Purchases are announced to the table and the buyer's card shows the cost.
    // The cost chip is immediate and short-lived; the headline may wait behind the turn banner.
    await expect(page.locator('.player-card[data-self="true"] .cash-delta.down')).toBeVisible();
    await expect(page.getByLabel('全场提示')).toContainText('新地产');
    await openPanel(page);
  }
  while (await page.getByRole('button', { name: /^前往/ }).count()) {
    await accepted(page, page.getByRole('button', { name: /^前往/ }).first());
    await openPanel(page);
  }
  await accepted(page, page.getByRole('button', { name: '结束回合', exact: true }));
  await closePanel(page);
  await expect(page.getByLabel('实时行动提示')).toContainText('对手行动');
  await page.screenshot({ path: 'artifacts/ui/opponent-action.png' });
});
test('the 44-square board fits the screen on desktop and phones', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await create(page, '大地图', 2);
  await page.getByLabel('地图大小').selectOption('44');
  await page.getByRole('button', { name: '添加机器人' }).click();
  await page.getByRole('button', { name: '我准备好了' }).click();
  await page.getByRole('button', { name: '开始旅程' }).click();
  await expect(page.locator('.country-tile')).toHaveCount(44);
  // Keyboard play: Space presses the main action (roll).
  const revision = await page.locator('.board-meta').getAttribute('data-revision');
  await page.locator('body').click({ position: { x: 5, y: 300 } });
  await page.keyboard.press('Space');
  await expect(page.locator('.board-meta')).not.toHaveAttribute('data-revision', revision!);
  await expect(page.locator('.dice-stage')).toContainText('掷出');
  for (const [width, height] of [
    [1440, 900],
    [1280, 720],
    [390, 844],
    [360, 740],
  ]) {
    await page.setViewportSize({ width, height });
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const tiles = [...document.querySelectorAll<HTMLElement>('.country-tile')];
            return (
              tiles.length === 44 &&
              tiles.every((t) => {
                const r = t.getBoundingClientRect();
                return (
                  r.left >= 0 &&
                  r.top >= 0 &&
                  r.right <= innerWidth + 1 &&
                  r.bottom <= innerHeight + 1
                );
              }) &&
              document.documentElement.scrollWidth <= innerWidth + 1
            );
          }),
        { message: `${width}x${height} shows all 44 squares` },
      )
      .toBe(true);
  }
});
