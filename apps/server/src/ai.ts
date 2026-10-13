import { BOARD, CARDS, mapById } from '../../../packages/content/src/index.ts';
import type { GameAction, GameView } from '../../../packages/shared/src/index.ts';
import { AI_DECISION_CAP_MS } from '../../../packages/shared/src/index.ts';
import type { AiTools } from './ai-tools.ts';
export interface AiDecision {
  action: GameAction;
  source: 'llm' | 'rule';
  message: string;
  /** Short public explanation shown in the activity feed. */
  reason?: string;
  /** Public labels of the tools the model used, in order. */
  steps?: string[];
}
export interface ChooseHooks {
  /** Read-only tools the model may call before it decides. */
  tools?: AiTools;
  /** Called after every tool call, for the live "thinking" strip. */
  onStep?: (label: string, steps: string[]) => void;
  /** The rule bot's reason, reported when the rule bot plays instead. */
  fallbackReason?: string;
}
export interface BotBrain {
  model: string;
  choose: (
    view: GameView,
    choices: GameAction[],
    fallback: GameAction,
    signal: AbortSignal,
    hooks?: ChooseHooks,
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
  /** Tool calls allowed before the model must decide; 0 asks for a choice straight away. */
  maxSteps?: number;
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
  const maxSteps = Number(env.MONOPOLY_AI_MAX_STEPS ?? 3);
  if (!Number.isInteger(maxSteps) || maxSteps < 0 || maxSteps > 8)
    throw Error('Invalid LLM step limit');
  return {
    baseUrl,
    key,
    model,
    mode: mode as AiConfig['mode'],
    // One request may use up to the table-wide two-minute cap for AI decisions.
    timeoutMs: Math.min(timeoutMs, AI_DECISION_CAP_MS),
    disableThinking: env.MONOPOLY_AI_DISABLE_THINKING === 'true',
    reasoningEffort: env.MONOPOLY_AI_REASONING_EFFORT || undefined,
    maxSteps,
  };
}
type Message = { role: 'system' | 'user' | 'assistant'; content: string };
/** Failures worth one more, simpler attempt (bad output), as opposed to provider/network errors. */
class OutputError extends Error {}

const LOOP_PROMPT = (steps: number) =>
  `你是大富翁策略玩家，正在服务器的「观察 → 调用工具 → 决定」循环中行动。每一步只返回一个 JSON 对象，二选一：
1) 调用只读工具：{"tool":"工具名","args":{...}}
2) 给出最终决定：{"choice":候选序号,"reason":"不超过 30 字的公开理由"}
最多调用 ${steps} 次工具，信息足够就立即决定。只能从候选中选择，序号从 0 开始；兼顾现金储备、同色组、队伍与租金风险。理由会公开给所有玩家，不要透露手牌内容，也不要请求其他玩家的私有信息。`;
const DIRECT_PROMPT =
  '你是大富翁策略玩家。只能从给定合法候选中选择一项，兼顾现金储备、地产组、队伍与租金。不要发明动作，不要请求其他玩家私有手牌。只返回 JSON：{"choice":候选序号,"reason":"不超过 30 字的公开理由"}，序号从 0 开始。';

function parseObject(content: string): Record<string, unknown> {
  try {
    const value = JSON.parse(
      content
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '')
        .trim(),
    );
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  } catch {
    // fall through
  }
  throw new OutputError('invalid');
}
/** A short public reason, dropped if it names a card the seat is still holding. */
function publicReason(reason: unknown, view: GameView, action: GameAction): string | undefined {
  if (typeof reason !== 'string') return undefined;
  const text = reason.replace(/\s+/g, ' ').trim().slice(0, 40);
  const me = view.players.find((p) => p.id === view.viewerId);
  const played = action.type === 'playCard' ? action.cardId : null;
  for (const id of [...(me?.cards ?? []), ...(me?.newCards ?? [])]) {
    const name = CARDS.find((c) => c.id === id)?.name;
    if (id !== played && name && text.includes(name)) return undefined;
  }
  return text || undefined;
}

export function createBotBrain(config: AiConfig, request: typeof fetch = fetch): BotBrain {
  const path =
    config.mode === 'chat'
      ? '/chat/completions'
      : config.mode === 'responses'
        ? '/responses'
        : '/messages';
  const base = config.baseUrl.replace(/\/+$/, '');
  /** One provider round trip; returns the assistant's text. */
  async function send(messages: Message[], signal: AbortSignal): Promise<string> {
    const timeout = AbortSignal.timeout(config.timeoutMs);
    const combined = AbortSignal.any([signal, timeout]);
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    let body: unknown;
    if (config.mode === 'anthropic') {
      headers['x-api-key'] = config.key;
      headers['anthropic-version'] = '2023-06-01';
      body = {
        model: config.model,
        max_tokens: 512,
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
    let response: Response;
    try {
      response = await request(base.endsWith(path) ? base : base + path, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: combined,
      });
    } catch (error) {
      throw timeout.aborted ? Error('timeout') : error;
    }
    if (!response.ok) throw Error('provider');
    // Bound untrusted provider output instead of retaining a potentially huge response.
    const reader = response.body?.getReader();
    if (!reader) throw new OutputError('empty');
    let output = '',
      size = 0;
    const decoder = new TextDecoder();
    for (;;) {
      const chunk = await reader.read().catch((error) => {
        throw timeout.aborted ? Error('timeout') : error;
      });
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 65536) {
        await reader.cancel();
        throw new OutputError('oversize');
      }
      output += decoder.decode(chunk.value, { stream: true });
    }
    output += decoder.decode();
    let data: any;
    try {
      data = JSON.parse(output);
    } catch {
      throw new OutputError('invalid');
    }
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
    if (typeof content !== 'string') throw new OutputError('invalid');
    return content;
  }
  return {
    model: config.model,
    async choose(view, choices, fallback, signal, hooks = {}) {
      const map = mapById(view.settings.mapId, view.settings.size);
      const tools = hooks.tools ?? {};
      const maxSteps = Object.keys(tools).length ? (config.maxSteps ?? 3) : 0;
      const state = (withTools: boolean) =>
        JSON.stringify({
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
            handLimit: BOARD.handLimit,
            note: '单骰子 1–6；落在遣返或抽到遣返时直接进入拘留所，不经过起点。拘留所可缴纳保释金、使用自由通行或掷出 6 点出狱；否则停留一回合。税费与保释金进入免费停车场奖池。每回合最多使用一张卡，新得到的卡下回合才能用；租金护盾最多 1 次。',
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
          ...(withTools
            ? {
                tools: Object.fromEntries(
                  Object.entries(tools).map(([name, t]) => [name, t.description]),
                ),
              }
            : {}),
        });
      const decided = (parsed: Record<string, unknown>, steps: string[], message: string) => {
        const choice = parsed.choice;
        if (
          !Number.isSafeInteger(choice) ||
          (choice as number) < 0 ||
          (choice as number) >= choices.length
        )
          return null;
        const action = choices[choice as number];
        const reason = publicReason(parsed.reason, view, action);
        return {
          action,
          source: 'llm' as const,
          message,
          ...(reason ? { reason } : {}),
          steps,
        };
      };
      const steps: string[] = [];
      // Layer 1: the agentic loop. Observe, call read-only tools, then decide.
      try {
        const convo: Message[] = [
          { role: 'system', content: maxSteps ? LOOP_PROMPT(maxSteps) : DIRECT_PROMPT },
          { role: 'user', content: state(maxSteps > 0) },
        ];
        let used = 0,
          corrections = 0;
        for (;;) {
          const content = await send(convo, signal);
          const parsed = parseObject(content);
          if ('choice' in parsed) {
            const result = decided(
              parsed,
              steps,
              steps.length ? `模型调用 ${steps.length} 次工具后决定` : '模型已选择合法操作',
            );
            if (result) return result;
          }
          const tool = typeof parsed.tool === 'string' ? tools[parsed.tool] : undefined;
          let reply: unknown;
          if (tool && used < maxSteps) {
            const args =
              parsed.args && typeof parsed.args === 'object'
                ? (parsed.args as Record<string, unknown>)
                : {};
            used++;
            const label = tool.label(args);
            steps.push(label);
            hooks.onStep?.(label, [...steps]);
            reply = { tool: parsed.tool, result: tool.run(args), toolsLeft: maxSteps - used };
          } else {
            // Wrong shape, unknown tool or out of tool calls: correct it once, then give up.
            if (++corrections > 1) throw new OutputError('invalid');
            reply = {
              error: used >= maxSteps ? '工具次数已用完' : '无法识别，请返回工具调用或最终决定',
            };
          }
          const last = used >= maxSteps;
          convo.push({ role: 'assistant', content });
          convo.push({
            role: 'user',
            content: JSON.stringify({
              ...(reply as object),
              ...(last ? { next: '现在必须给出最终决定 {"choice":序号,"reason":"..."}' } : {}),
            }),
          });
        }
      } catch (error) {
        if (signal.aborted) throw Error('cancelled');
        // Layer 2: if the loop produced unusable output, ask once for a direct choice.
        if (error instanceof OutputError && maxSteps > 0) {
          try {
            const content = await send(
              [
                { role: 'system', content: DIRECT_PROMPT },
                { role: 'user', content: state(false) },
              ],
              signal,
            );
            const result = decided(parseObject(content), steps, '工具循环未完成，模型直接选择');
            if (result) return result;
          } catch {
            if (signal.aborted) throw Error('cancelled');
          }
        }
        // Layer 3: the rule bot (the service adds a safe default if even that is rejected).
        return {
          action: fallback,
          source: 'rule',
          message:
            (error as Error).message === 'timeout'
              ? '模型超时，规则机器人继续'
              : error instanceof OutputError
                ? '模型输出无效，规则机器人继续'
                : '模型暂不可用，规则机器人继续',
          ...(hooks.fallbackReason ? { reason: hooks.fallbackReason } : {}),
          steps,
        };
      }
    },
  };
}
