import type { TransactionDto } from '@wallet/shared';
import { shortenAddress } from '@wallet/shared';
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, Inbox, Repeat, RefreshCw } from 'lucide-react';
import type { AsyncState } from '../hooks/useAsync';
import type { TransactionListDto } from '@wallet/shared';
import { formatSol, relativeTime } from '../lib/format';
import { Pill } from './ui';

const LABELS: Record<TransactionDto['direction'], string> = {
  inbound: 'Deposit',
  outbound: 'Withdrawal',
  self: 'Network fee',
  unknown: 'Transaction',
};

function StatusPill({ status }: { status: TransactionDto['status'] }) {
  if (status === 'failed') return <Pill tone="red">Failed</Pill>;
  if (status === 'finalized') return <Pill tone="green">Finalized</Pill>;
  if (status === 'confirmed') return <Pill tone="green">Confirmed</Pill>;
  return <Pill tone="amber">Processing</Pill>;
}

function Row({ tx }: { tx: TransactionDto }) {
  const Icon = tx.direction === 'inbound' ? ArrowDownLeft : tx.direction === 'outbound' ? ArrowUpRight : Repeat;
  const amount = tx.amountLamports ? BigInt(tx.amountLamports) : null;
  return (
    <a
      href={tx.explorerUrl}
      target="_blank"
      rel="noreferrer"
      className="group flex items-center gap-4 rounded-2xl px-3 py-3 transition hover:bg-white/[0.03]"
    >
      <span
        className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${
          tx.direction === 'inbound' ? 'bg-sol-green/10 text-sol-green' : 'bg-white/5 text-slate-300'
        }`}
      >
        <Icon className="size-4.5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-slate-100">{LABELS[tx.direction]}</div>
        <div className="truncate font-mono text-[11px] text-slate-500 group-hover:text-slate-400">
          {shortenAddress(tx.signature, 6)} · {relativeTime(tx.blockTime)}
        </div>
      </div>
      <div className="text-right">
        <div
          className={`tabular text-sm font-semibold ${
            amount === null ? 'text-slate-400' : amount > 0n ? 'text-sol-green' : 'text-slate-100'
          }`}
        >
          {amount === null ? '—' : `${amount > 0n ? '+' : ''}${formatSol(amount, 2)} SOL`}
        </div>
        <div className="mt-1">
          <StatusPill status={tx.status} />
        </div>
      </div>
    </a>
  );
}

export function TransactionsCard({ state }: { state: AsyncState<TransactionListDto | null> }) {
  const txs = state.data?.transactions ?? [];
  return (
    <section className="card p-4 sm:p-6">
      <div className="flex items-center justify-between px-2 pb-3">
        <div>
          <h2 className="text-base font-semibold text-white">Recent Transactions</h2>
          <p className="mt-0.5 text-xs text-slate-500">Read directly from Solana Devnet</p>
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
      ) : txs.length === 0 ? (
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
          {txs.map((tx) => (
            <Row key={tx.signature} tx={tx} />
          ))}
        </div>
      )}
    </section>
  );
}
