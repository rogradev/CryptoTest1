import type { ActivityItemDto, ActivityListDto } from '@wallet/shared';
import { shortenAddress } from '@wallet/shared';
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, ExternalLink, Inbox, RefreshCw } from 'lucide-react';
import type { AsyncState } from '../hooks/useAsync';
import { formatSol, relativeTime } from '../lib/format';
import { Pill } from './ui';

type Tone = 'green' | 'amber' | 'red' | 'slate' | 'purple';

/** User-facing labels for deposit and withdrawal lifecycle states. */
export const STATUS_LABELS: Record<ActivityItemDto['status'], { label: string; tone: Tone }> = {
  detected: { label: 'Detected', tone: 'amber' },
  confirming: { label: 'Confirming', tone: 'amber' },
  confirmed: { label: 'Confirmed', tone: 'green' },
  pending: { label: 'Pending', tone: 'amber' },
  processing: { label: 'Broadcasting', tone: 'amber' },
  broadcast: { label: 'Broadcasting', tone: 'amber' },
  completed: { label: 'Completed', tone: 'green' },
  failed: { label: 'Failed', tone: 'red' },
  cancelled: { label: 'Cancelled', tone: 'slate' },
};

function Row({ item }: { item: ActivityItemDto }) {
  const isDeposit = item.kind === 'deposit';
  const Icon = isDeposit ? ArrowDownLeft : ArrowUpRight;
  const amount = BigInt(item.amountLamports);
  const status = STATUS_LABELS[item.status];
  const content = (
    <>
      <span
        className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${
          isDeposit ? 'bg-sol-green/10 text-sol-green' : 'bg-violet-400/10 text-violet-300'
        }`}
      >
        <Icon className="size-4.5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-sm font-medium text-slate-100">
          {isDeposit ? 'Deposit' : 'Withdrawal'}
          {item.counterparty && (
            <span className="truncate font-mono text-[11px] font-normal text-slate-500">to {shortenAddress(item.counterparty)}</span>
          )}
        </div>
        <div className="flex items-center gap-1 truncate font-mono text-[11px] text-slate-500 group-hover:text-slate-400">
          {item.signature ? shortenAddress(item.signature, 6) : 'awaiting signature'} · {relativeTime(item.createdAt)}
          {item.explorerUrl && <ExternalLink className="size-3 shrink-0 opacity-60" />}
        </div>
      </div>
      <div className="text-right">
        <div className={`tabular text-sm font-semibold ${amount > 0n ? 'text-sol-green' : 'text-slate-100'} ${item.status === 'failed' ? 'line-through opacity-60' : ''}`}>
          {amount > 0n ? '+' : ''}
          {formatSol(amount, 2)} SOL
        </div>
        <div className="mt-1">
          <Pill tone={status.tone}>{status.label}</Pill>
        </div>
      </div>
    </>
  );
  const className = 'group flex items-center gap-4 rounded-2xl px-3 py-3 transition hover:bg-white/[0.03]';
  return item.explorerUrl ? (
    <a href={item.explorerUrl} target="_blank" rel="noreferrer" className={className} title="View on Solana Explorer (devnet)">
      {content}
    </a>
  ) : (
    <div className={className}>{content}</div>
  );
}

export function TransactionsCard({ state }: { state: AsyncState<ActivityListDto | null> }) {
  const items = state.data?.items ?? [];
  return (
    <section className="card p-4 sm:p-6">
      <div className="flex items-center justify-between px-2 pb-3">
        <div>
          <h2 className="text-base font-semibold text-white">Recent Transactions</h2>
          <p className="mt-0.5 text-xs text-slate-500">Deposits &amp; withdrawals · each verifiable on Solana Explorer</p>
        </div>
        {state.refreshing && <RefreshCw className="size-4 animate-spin text-slate-500" />}
      </div>

      {state.loading && !state.data ? (
        <div className="space-y-2 px-2 py-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-4 py-2">
              <div className="skeleton size-10 rounded-xl" />
              <div className="flex-1 space-y-2">
                <div className="skeleton h-3 w-28" />
                <div className="skeleton h-2.5 w-40" />
              </div>
              <div className="skeleton h-3 w-16" />
            </div>
          ))}
        </div>
      ) : state.error && !state.data ? (
        <div className="m-2 flex items-center justify-between gap-3 rounded-2xl border border-rose-400/20 bg-rose-400/5 p-4 text-sm text-rose-200">
          <span className="flex items-center gap-2">
            <AlertTriangle className="size-4" /> {state.error}
          </span>
          <button type="button" className="font-medium underline-offset-2 hover:underline" onClick={() => void state.reload()}>
            Retry
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center px-6 py-12 text-center">
          <div className="flex size-14 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03]">
            <Inbox className="size-6 text-slate-500" />
          </div>
          <div className="mt-4 text-sm font-medium text-slate-200">No transactions yet</div>
          <p className="mt-1 max-w-xs text-xs leading-relaxed text-slate-500">
            Deposits and withdrawals will appear here. Use <span className="text-slate-300">Add Funds</span> to receive
            Devnet SOL.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-white/[0.04]">
          {items.map((item) => (
            <Row key={`${item.kind}-${item.id}`} item={item} />
          ))}
        </div>
      )}
    </section>
  );
}
