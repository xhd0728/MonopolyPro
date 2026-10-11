# MonopolyPro · 富翁之旅

独立服务端裁定规则的中文浏览器大富翁。2–6 人或机器人，四张 2D 国家路线地图、六个角色、30 张原创卡牌；支持邀请房、密码、观战、自由/快速/团队战、刷新恢复与断线托管。

## 本地运行

使用 **Node.js 24** 和 **pnpm 11.25.0**：

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
pnpm start
```

打开 <http://127.0.0.1:8788>，创建房间；第二个浏览器或独立浏览器配置可加入同一房间。一个浏览器配置的多个窗口会恢复同一游客席位，后进入的窗口接管该席位。

开发时分别运行 `pnpm dev` 与 `pnpm dev:client`，前端在 <http://127.0.0.1:5173>。`pnpm start` 自动读取 `dist/client`，与 API / WebSocket 同源。

`pnpm test` 验证规则、真实 WebSocket 和恢复。先构建服务端，再运行测试。`pnpm test:ui` 验证浏览器流程；`pnpm test:load` 启动隔离服务并进行 20 房间 / 120 席位 / 30 分钟测试。产物保存在忽略的 `artifacts/`。

## 工程结构

- `packages/shared`：共享契约与输入校验。
- `packages/content`：原创地图、角色、卡牌配置。
- `packages/engine`：纯规则引擎与不依赖外部模型的机器人。
- `apps/server`：Colyseus 房间、HTTP、SQLite WAL 事务持久化。
- `apps/client`：React / HTML / SVG 二维棋盘，桌面环路和手机折线路线；玩家资产由服务端计算。
- `docs`：来源、架构、阶段验收。

恢复凭证只保存在本机浏览器；对手和观众不接收私有手牌。每个动作携带 UUID 与状态版本；确认前，将状态、事件和去重结果原子写入数据库。

公网部署、备份和回滚见 [部署文档](docs/DEPLOY.md)，检查结果见 [验收记录](docs/VALIDATION.md)，本轮界面与规则 review 见 [Review 记录](docs/REVIEW.md)。编译包只需安装生产依赖并运行 `pnpm start`；工程检查请在源码目录执行。公网部署和真实外网验收由部署者执行；本地测试不代表已上线。
