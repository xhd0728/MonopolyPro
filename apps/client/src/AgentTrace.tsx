import { useState } from 'react';
import type { AiTraceStep } from '../../../packages/shared/src/index.ts';
import './reports.css';

const KINDS: Record<AiTraceStep['kind'], string> = {
  context: '局面',
  summary: '摘要',
  tool: '工具',
  validation: '校验',
  retry: '重试',
  decision: '决定',
  fallback: '接管',
  execution: '执行',
};
export function TraceTimeline({ trace }: { trace: AiTraceStep[] }) {
  return (
    <ol className="trace-timeline">
      {trace.map((step, i) => (
        <li key={i} className={`trace-${step.kind}`}>
          <span className="trace-node">{KINDS[step.kind]}</span>
          <div>
            <header>
              <b>{step.title}</b>
              <time>+{(step.ms / 1000).toFixed(1)}s</time>
            </header>
            {step.tool && <code>{step.tool}</code>}
            <p>{step.text}</p>
            {!!step.facts?.length && (
              <ul>
                {step.facts.map((fact, j) => (
                  <li key={j}>{fact}</li>
                ))}
              </ul>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
export function DecisionTrace({ trace }: { trace: AiTraceStep[] }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="feed-trace" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>查看决策轨迹 · {trace.length} 步</summary>
      {open && <TraceTimeline trace={trace} />}
    </details>
  );
}
