import { BOARD, CARDS, mapById } from '../../../packages/content/src/index.ts';
import type { GameAction, GameView } from '../../../packages/shared/src/index.ts';
import { AI_DECISION_CAP_MS } from '../../../packages/shared/src/index.ts';
export interface AiDecision {
  action: GameAction;
  source: 'llm' | 'rule';
  message: string;
}
export interface BotBrain {
  model: string;
  choose: (
    view: GameView,
    choices: GameAction[],
    fallback: GameAction,
    signal: AbortSignal,
  ) => Promise<AiDecision>;
}
export interface AiConfig {
  baseUrl: string;
  key: string;
  model: string;
  mode: 'chat' | 'responses' | 'anthropic';
  timeoutMs: number;
  disableThinking?: boolean;
  reasoningEffort?: string;
}
export function readAiConfig(env: NodeJS.ProcessEnv): AiConfig | null {
  if (env.MONOPOLY_AI_ENABLED !== 'true') return null;
  const baseUrl = env.MONOPOLY_AI_BASE_URL?.trim() ?? '',
    key = env.MONOPOLY_AI_KEY?.trim() ?? '',
    model = env.MONOPOLY_AI_MODEL?.trim() ?? '';
  if (!baseUrl || !key || !model || model.length > 100) throw Error('LLM configuration incomplete');
  const url = new URL(baseUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw Error('Invalid LLM endpoint');
  const mode = env.MONOPOLY_AI_API_MODE ?? 'chat';
  if (!['chat', 'responses', 'anthropic'].includes(mode)) throw Error('Invalid LLM API mode');
  const timeoutMs = Number(env.MONOPOLY_AI_TIMEOUT_MS ?? 12000);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 100) throw Error('Invalid LLM timeout');
  if (
    env.MONOPOLY_AI_REASONING_EFFORT &&
    !['none', 'minimal', 'low', 'medium', 'high', 'xhigh'].includes(
      env.MONOPOLY_AI_REASONING_EFFORT,
    )
  )
    throw Error('Invalid LLM reasoning effort');
  return {
    baseUrl,
    key,
    model,
    mode: mode as AiConfig['mode'],
    // One request may use up to the table-wide two-minute cap for AI decisions.
    timeoutMs: Math.min(timeoutMs, AI_DECISION_CAP_MS),
    disableThinking: env.MONOPOLY_AI_DISABLE_THINKING === 'true',
    reasoningEffort: env.MONOPOLY_AI_REASONING_EFFORT || undefined,
  };
}
export function createBotBrain(config: AiConfig, request: typeof fetch = fetch): BotBrain {
  return {
    model: config.model,
    async choose(view, choices, fallback, signal) {
      const timeout = AbortSignal.timeout(config.timeoutMs);
      const combined = AbortSignal.any([signal, timeout]);
      const map = mapById(view.settings.mapId, view.settings.size);
      const messages = [
        {
          role: 'system',
          content:
            '你是大富翁策略玩家。只能从给定合法候选中选择一项，兼顾现金储备、地产组、队伍与租金。不要发明动作，不要请求其他玩家私有手牌。只返回 JSON：{"choice":候选序号}，序号从 0 开始。',
        },
        {
          role: 'user',
          content: JSON.stringify({
            me: view.viewerId,
            round: view.round,
            phase: view.phase,
            players: view.players,
            properties: view.properties,
            trade: view.trade,
            auction: view.auction,
            debt: view.debt,
            rules: {
              salary: map.salary,
              bail: BOARD.bail,
              jailEscapeFace: BOARD.jailEscapeFace,
              freeParkingPot: view.pot,
              note: '单骰子 1–6；落在遣返或抽到遣返时直接进入拘留所，不经过起点。拘留所可缴纳保释金、使用自由通行或掷出 6 点出狱；否则停留一回合。税费与保释金进入免费停车场奖池。',
            },
            board: map.tiles.map((t) => ({
              index: t.index,
              name: t.name,
              kind: t.kind,
              price: t.price,
              group: t.group,
            })),
            cards: CARDS.filter((c) =>
              view.players.find((p) => p.id === view.viewerId)?.cards?.includes(c.id),
            ),
            recentEvents: view.events.slice(-8),
            choices: choices.map((action, choice) => ({ choice, action })),
          }),
        },
      ];
      const path =
        config.mode === 'chat'
          ? '/chat/completions'
          : config.mode === 'responses'
            ? '/responses'
            : '/messages';
      const base = config.baseUrl.replace(/\/+$/, '');
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      let body: unknown;
      if (config.mode === 'anthropic') {
        headers['x-api-key'] = config.key;
        headers['anthropic-version'] = '2023-06-01';
        body = {
          model: config.model,
          max_tokens: 256,
          system: messages[0].content,
          messages: messages.slice(1),
        };
      } else {
        headers.Authorization = `Bearer ${config.key}`;
        body =
          config.mode === 'responses'
            ? {
                model: config.model,
                input: messages,
                store: false,
                max_output_tokens: 512,
                text: { format: { type: 'json_object' } },
              }
            : {
                model: config.model,
                messages,
                max_tokens: 2048,
                temperature: 0.2,
                ...(config.reasoningEffort ? { reasoning_effort: config.reasoningEffort } : {}),
                ...(config.disableThinking
                  ? { enable_thinking: false, chat_template_kwargs: { enable_thinking: false } }
                  : {}),
                response_format: { type: 'json_object' },
              };
      }
      try {
        const response = await request(base.endsWith(path) ? base : base + path, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: combined,
        });
        if (!response.ok) throw Error('provider');
        // Bound untrusted provider output instead of retaining a potentially huge response.
        const reader = response.body?.getReader();
        if (!reader) throw Error('empty');
        let output = '',
          size = 0;
        const decoder = new TextDecoder();
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > 65536) {
            await reader.cancel();
            throw Error('oversize');
          }
          output += decoder.decode(chunk.value, { stream: true });
        }
        output += decoder.decode();
        const data = JSON.parse(output);
        const content =
          config.mode === 'chat'
            ? data?.choices?.[0]?.message?.content
            : config.mode === 'anthropic'
              ? data?.content
                  ?.filter((x: any) => x.type === 'text')
                  .map((x: any) => x.text)
                  .join('')
              : data?.output
                  ?.filter((x: any) => x.type === 'message' && x.role === 'assistant')
                  .flatMap((x: any) => x.content ?? [])
                  .filter((x: any) => x.type === 'output_text')
                  .map((x: any) => x.text)
                  .join('') || data?.output_text;
        if (typeof content !== 'string') throw Error('invalid');
        const parsed = JSON.parse(
          content
            .replace(/^```(?:json)?\s*/i, '')
            .replace(/\s*```$/, '')
            .trim(),
        );
        if (
          !Number.isSafeInteger(parsed.choice) ||
          parsed.choice < 0 ||
          parsed.choice >= choices.length
        )
          throw Error('invalid');
        return { action: choices[parsed.choice], source: 'llm', message: '模型已选择合法操作' };
      } catch {
        if (signal.aborted) throw Error('cancelled');
        return {
          action: fallback,
          source: 'rule',
          message: timeout.aborted ? '模型超时，规则机器人继续' : '模型暂不可用，规则机器人继续',
        };
      }
    },
  };
}
