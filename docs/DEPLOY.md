# 公网服务器交付与运维

面向单台 Linux、Node.js 24、pnpm 11.25.0、systemd、Caddy。服务端提供前端、HTTP 和 WebSocket；SQLite 位于持久化目录。没有运行公网部署；部署者完成下方外网验收后才能宣布上线。

## 构建与发布包

在源码目录运行：

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
pnpm test
pnpm exec playwright install chromium
pnpm test:ui
pnpm release
```

`releases/` 包含编译包、两个包的 SHA256 和对应 Git HEAD 的源码包。编译包需在服务器安装生产依赖；它与 CPU 架构无关，依赖由目标服务器安装。`RELEASE.json` 记录完整提交号和数据库 schema。打包前应确保代码已提交、检查通过；脚本拒绝未提交的源码和同版本重复打包。源码包只含已提交内容。

## 首次安装

准备已绑定域名的 Linux 服务器，安装 Node.js 24（确认 `/usr/bin/node --version`；路径不同需修改 service）、pnpm 11.25.0 和 Caddy。防火墙开放 80/443 与必要的 SSH 端口；Node 8788 只监听本机。

以下使用包名中的 `<sha>` 替换为实际提交号：

```sh
sudo useradd --system --home /var/lib/monopolypro --shell /usr/sbin/nologin monopolypro
sudo install -d -o monopolypro -g monopolypro -m 700 /var/lib/monopolypro
sudo install -d -m 755 /opt/monopolypro/releases
sudo tar -xzf monopolypro-<sha>.tar.gz -C /opt/monopolypro/releases
sudo chown -R "$(id -un):$(id -gn)" /opt/monopolypro/releases/monopolypro-<sha>
cd /opt/monopolypro/releases/monopolypro-<sha>
pnpm install --prod --frozen-lockfile
sudo chown -R root:root /opt/monopolypro/releases/monopolypro-<sha>
sudo ln -s /opt/monopolypro/releases/monopolypro-<sha> /opt/monopolypro/current
sudo install -m 600 .env.example /etc/monopolypro.env
```

编辑 `/etc/monopolypro.env`：

```ini
HOST=127.0.0.1
PORT=8788
NODE_ENV=production
DATA_DIR=/var/lib/monopolypro
PUBLIC_ORIGIN=https://your-domain.example
MAX_ROOMS=200
DISCONNECT_TAKEOVER_MS=15000
BOT_STEP_MS=1200
DECISION_TIMEOUT_MS=45000
ROOM_IDLE_MS=86400000
```

systemd 读取 EnvironmentFile，应用本身不自动读取 `.env`。本地可用 Node 的 `--env-file=.env` 参数。密码与恢复凭证不要写入日志、工单、链接或提交记录。

```sh
sudo install -m 644 deploy/monopolypro.service /etc/systemd/system/monopolypro.service
sudo systemctl daemon-reload
sudo systemctl enable --now monopolypro
curl --fail http://127.0.0.1:8788/healthz
sudo journalctl -u monopolypro -n 50 --no-pager
```

将 `deploy/Caddyfile` 中**两个**域名均改为真实域名，合并到现有 Caddy 配置，不要覆盖其他站点：

```sh
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
curl --fail https://your-domain.example/healthz
```

Caddy 自动处理 HTTPS/WSS。应用信任本机反向代理；不要将未经配置的额外代理链直接接入。生产环境只接受 `PUBLIC_ORIGIN` 浏览器来源；命令行客户端也必须拥有合法席位连接凭证。

## 备份与恢复

应用使用 SQLite WAL + FULL，每次已确认动作事务写入快照、事件和动作去重表。直接只复制主数据库文件可能漏掉 WAL；运行在线备份脚本：

```sh
sudo -u monopolypro /usr/bin/node /opt/monopolypro/current/scripts/backup.mjs \
  /var/lib/monopolypro/monopoly.sqlite /var/lib/monopolypro/backups/2026-10-11.sqlite
```

建议每日备份并复制到受控的异机存储，保留 7 个日备份和 4 个周备份。备份包含游客恢复凭证的哈希与对局私有手牌，按应用数据保护；脚本将备份权限设为 600。

恢复时停服务，保留当前数据库及 `-wal` / `-shm` 文件到独立故障目录，再从备份恢复主文件；旧 WAL / SHM 不得与新主文件混用。确认目录和文件归属 `monopolypro`，再启动服务。备份恢复会回退到备份时点，之后的动作不能宣称保留。首次部署前实际执行一次备份恢复演练。

## 升级、回滚与维护

1. 按首次安装的方法解包，在新的 release 目录以部署用户安装生产依赖，再把目录归属改回 root；检查 `RELEASE.json` 和 schema，保留旧版本。
2. 向朋友提前告知维护窗口。暂停新局并等现有局结束，或直接停服务保存当前状态；每次动作已落盘，服务停止期间网页显示重连。
3. `systemctl stop monopolypro`，备份数据库，然后把 `current` 原子切换到新目录（使用临时符号链接与 `mv -T`）。
4. 启动，检查健康、日志、原席位恢复和一笔动作。状态保持原时间限制，停机期间仍计入比赛时间；超过限时恢复后结算。
5. 同 schema 版本可切回旧 release。schema 不兼容时必须使用对应备份，并明确告知数据回退；服务拒绝高于自身支持版本的数据库。

停机采用 SIGTERM，关闭房间与连接后检查点 WAL；systemd 超时为 20 秒。SIGKILL 后也应从最后已确认的事务恢复。框架房间 ID 会变化，业务房间码与持久化游客凭证保持有效。

## 观测、限制与清理

- `/healthz` 校验数据库并返回版本、存活时间和房间数；故障监控可每 30 秒访问，失败后查看 journal。
- 日志为 JSON，不包含连接凭证或手牌。检查 `http_error`、`room_tick`、`bot_rejected` 和进程重启次数。
- 默认最多 200 房间；每房 6 玩家、最多 20 观众；HTTP 每 IP 600 请求/分钟，建房每 IP 30 次/分钟，WebSocket 每连接 60 消息/10 秒，载荷 8 KiB。
- 离线超过 `ROOM_IDLE_MS` 的房间清理，事件和动作去重记录级联删除。游客未连接的空房 60 秒清理。保留周期可调整；先用备份保存需留存的战绩。
- 单实例 SQLite 写入串行化。200 是硬上限，不是已测容量；本地 20 房间测试不能推断公网机器的容量。

## 真实外网验收清单

- [ ] HTTPS 首页、WSS、密码房、邀请链接正确，8788 未公网暴露。
- [ ] 两个不同网络的客户端加入同一房间，准备并完成一场完整对局。
- [ ] 手机完成买地、卡牌目标、升级、交易、岔路、聊天、结算，无横向溢出。
- [ ] 关闭网络超过 15 秒显示托管，恢复网络交还席位；刷新恢复，旧窗口不能抢回控制。
- [ ] 在拍卖、交易与岔路阶段停服务再启动，资产与待处理决策一致。
- [ ] 已确认动作重试不重复扣款，观众不取得私有手牌。
- [ ] 在对应源码包目录安装开发依赖并构建，运行 `LOAD_SECONDS=1800 pnpm test:load`，保存硬件、系统、动作确认延迟、拒绝/断线数；目标服务器也需压测。
- [ ] 备份恢复和同 schema 版本回滚演练成功。

当前实现无公开匹配、账号、支付或多实例调度。它作为原创策略派对游戏发布，不含商业 Monopoly / 大富翁的官方地图、角色或素材。

## 可选 LLM 机器人

本机 `.env` 不包含在发布包内。需要模型机器人时，参照 [AI 配置](AI.md) 将 `MONOPOLY_AI_*` 字段填写到 `/etc/monopolypro.env`（权限 600），然后重启 systemd 服务。原有 KatanPro 的 API 可复用，但不要把端口、数据目录和公共域名设置直接搬到新服务。模型暂不可用时规则机器人继续推进；API 密钥只保留在服务端。
