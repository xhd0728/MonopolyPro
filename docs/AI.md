# 服务端 LLM 机器人

规则引擎始终负责掷骰、费用、归属、合法性和胜负。LLM 只从服务端生成并验证的候选动作中选择序号。API 请求位于 `apps/server/src/ai.ts`，规则引擎没有网络依赖。

## 本地配置

Node.js 24 启动时自动读取根目录 `.env`（测试服务不读取）；已有进程环境变量优先。此次只将本地 KatanPro 的 `CATAN_AI_*` API 配置映射为 `MONOPOLY_AI_*`，保存在权限 600 的忽略文件 `.env`。没有复制卡坦岛的服务器端口或其他设置。

```dotenv
MONOPOLY_AI_ENABLED=true
MONOPOLY_AI_API_MODE=chat
MONOPOLY_AI_BASE_URL=https://your-provider.example/v1
MONOPOLY_AI_MODEL=your-model
MONOPOLY_AI_KEY=your-key
MONOPOLY_AI_TIMEOUT_MS=12000
MONOPOLY_AI_MAX_CONCURRENT=4
```

支持 `chat`（Chat Completions）、`responses` 和 `anthropic` 三种协议。URL 可为基础路径或对应完整接口路径。关闭 `MONOPOLY_AI_ENABLED` 后不请求模型。

公网 systemd 部署时，将这些字段加入 `/etc/monopolypro.env` 并限制权限，然后重启服务。密钥不会通过 API、房间状态或前端设置返回。部署包和 Git 不包含本机 `.env`。

## 行为与连续性

房主可选择规则机器人或 LLM 机器人；未配置模型时只允许添加规则机器人。旧存档没有 `botMode` 的席位继续使用规则策略。显式 LLM 席位在模型配置撤掉时回退到规则策略；真人断线托管继续使用本地规则策略。

机器人每次决策最多两分钟：`MONOPOLY_AI_TIMEOUT_MS` 最大 120000（默认 12000），服务端另有两分钟总上限，到时中止请求并由规则机器人接手。真人玩家默认不限时，房主可以在房间里设置 60 / 120 / 300 秒的操作时限。

LLM 获得该机器人自己的手牌和公开局面，对手手牌、预设骰子、席位恢复凭证和密码不会进入请求。请求只允许选择候选序号；超时、HTTP 失败、过大/格式错误的响应或非法序号会回退到规则机器人。并发数有上限，拥堵时也由规则机器人继续。不会无限重试或因模型不可用卡住对局。

每个异步任务绑定房间、对局 ID、状态版本、席位与控制 epoch。返回时重新核对，过时结果废弃；最终动作再次由引擎校验，快照和事件事务落盘后才发布。服务关闭时取消未完成请求。

前端显示模型是否配置、机器人模式、思考/回退状态。公开的决策说明使用固定文字，不发布模型原始输出或内部推理。

## 已有接口的兼容验证

2026-10-12，复用配置的 `qwen3.8-flash-next` 接口最初返回 HTTP 200，但输出预算全部用于内部推理，没有最终 JSON。加入该兼容接口支持的 `reasoning_effort=none` 后，真实请求约 528ms 返回合法候选，未触发规则回退。`MONOPOLY_AI_REASONING_EFFORT` 仅在聊天接口配置该字段时发送；本机另设置 `MONOPOLY_AI_DISABLE_THINKING=true`，标准提供者可保留默认关闭。内部推理从不作为游戏提示或日志发布。

有关思考开关的提供者说明：[Alibaba Cloud OpenAI 兼容接口文档](https://www.alibabacloud.com/help/zh/model-studio/qwen-api-via-openai-chat-completions)。实际兼容性以本机真实接口验证为准；原始输出和 API 密钥不进入验收记录。
