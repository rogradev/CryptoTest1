import { Check, Loader2, X } from 'lucide-react';

export interface Step {
  label: string;
  state: 'done' | 'active' | 'todo' | 'failed';
}

/** Compact progress indicator: icons on a line, labels underneath (fits four steps on mobile). */
export function StatusSteps({ steps }: { steps: Step[] }) {
  return (
    <ol className="flex items-start">
      {steps.map((step, i) => (
        <li key={step.label} className="relative flex flex-1 flex-col items-center gap-1.5 text-center">
          {i > 0 && (
            <span
              className={`absolute right-1/2 top-2.5 h-px w-full -translate-y-1/2 ${
                step.state === 'todo' ? 'bg-white/10' : 'bg-sol-green/30'
              }`}
            />
          )}
          <span
            className={`relative z-10 flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] ${
              step.state === 'done'
                ? 'bg-[#0f2a22] text-sol-green ring-1 ring-sol-green/30'
                : step.state === 'active'
                  ? 'bg-[#2a2310] text-amber-300 ring-1 ring-amber-400/30'
                  : step.state === 'failed'
                    ? 'bg-[#2a1218] text-rose-300 ring-1 ring-rose-400/30'
                    : 'border border-dashed border-white/20 bg-ink-900 text-slate-600'
            }`}
          >
            {step.state === 'done' ? (
              <Check className="size-3" />
            ) : step.state === 'active' ? (
              <Loader2 className="size-3 animate-spin" />
            ) : step.state === 'failed' ? (
              <X className="size-3" />
            ) : (
              i + 1
            )}
          </span>
          <span
            className={`text-[11px] font-medium leading-tight ${
              step.state === 'todo' ? 'text-slate-600' : step.state === 'failed' ? 'text-rose-300' : 'text-slate-200'
            }`}
          >
            {step.label}
          </span>
        </li>
      ))}
    </ol>
  );
}

const ORDER = <T extends string>(states: readonly T[], current: T, failed: boolean): Step['state'][] => {
  const index = states.indexOf(current);
  return states.map((_, i) => (failed && i === index ? 'failed' : i < index ? 'done' : i === index ? 'active' : 'todo'));
};

export function depositSteps(status: string): Step[] {
  const labels = ['Detected', 'Confirming', 'Confirmed'] as const;
  if (status === 'confirmed') return labels.map((label) => ({ label, state: 'done' }));
  const current = status === 'confirming' ? 'Confirming' : 'Detected';
  return labels.map((label, i) => ({ label, state: ORDER(labels, current, status === 'failed')[i]! }));
}

export function withdrawalSteps(status: string): Step[] {
  const labels = ['Reserved', 'Broadcasting', 'Confirming', 'Completed'] as const;
  if (status === 'completed') return labels.map((label) => ({ label, state: 'done' }));
  const current =
    status === 'pending' ? 'Reserved' : status === 'processing' || status === 'broadcast' ? 'Broadcasting' : 'Confirming';
  return labels.map((label, i) => ({ label, state: ORDER(labels, current, status === 'failed')[i]! }));
}
