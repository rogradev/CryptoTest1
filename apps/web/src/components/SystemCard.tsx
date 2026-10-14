import type { HealthDto } from '@wallet/shared';
import { Blocks, Database, Layers, MonitorSmartphone, Server, Wallet } from 'lucide-react';
import type { AsyncState } from '../hooks/useAsync';
import { Pill } from './ui';

type Status = 'up' | 'down' | 'unknown';

function Dot({ status }: { status: Status }) {
  const color = status === 'up' ? 'bg-sol-green' : status === 'down' ? 'bg-rose-400' : 'bg-slate-600';
  return <span className={`size-2 rounded-full ${color}`} />;
}

const TABLES: { name: string; note: string }[] = [
  { name: 'users', note: 'identity' },
  { name: 'wallet_accounts', note: 'encrypted keys' },
  { name: 'blockchain_transactions', note: 'on-chain record' },
  { name: 'deposits', note: 'auto-detected' },
  { name: 'withdrawals', note: 'signed & broadcast' },
  { name: 'ledger_entries', note: 'append-only' },
];

const ROADMAP: { label: string; done: boolean }[] = [
  { label: 'Real Devnet wallet + encrypted key storage', done: true },
  { label: 'Add Funds · address · QR · live balance', done: true },
  { label: 'Automatic deposit detection', done: true },
  { label: 'Internal ledger & confirmation states', done: true },
  { label: 'Withdrawal signing & broadcasting', done: true },
  { label: 'Integration with client authentication', done: false },
];

export function SystemCard({ health }: { health: AsyncState<HealthDto> }) {
  const h = health.data;
  const apiStatus: Status = h ? 'up' : health.error ? 'down' : 'unknown';
  const dbStatus: Status = h?.database ?? (health.error ? 'down' : 'unknown');
  const chainStatus: Status = h?.solana.status ?? (health.error ? 'down' : 'unknown');

  const stack: { icon: typeof Server; label: string; detail: string; status: Status }[] = [
    { icon: MonitorSmartphone, label: 'React client', detail: 'Vite · TypeScript', status: 'up' },
    { icon: Server, label: 'Express API', detail: 'TypeScript · Zod', status: apiStatus },
    { icon: Database, label: 'PostgreSQL', detail: 'SQL migrations', status: dbStatus },
    { icon: Wallet, label: 'Wallet service', detail: 'AES-256-GCM key custody', status: apiStatus },
    {
      icon: Blocks,
      label: 'Solana Devnet',
      detail: h?.solana.slot ? `slot ${h.solana.slot.toLocaleString('en-US')}` : 'RPC',
      status: chainStatus,
    },
  ];

  return (
    <aside className="space-y-6">
      <section className="card p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-white">System</h2>
          {h && <Pill tone={h.status === 'ok' ? 'green' : 'amber'}>{h.status === 'ok' ? 'All systems live' : 'Degraded'}</Pill>}
        </div>
        <ol className="relative mt-5 space-y-3">
          <span className="absolute bottom-5 left-[19px] top-5 w-px bg-gradient-to-b from-sol-purple/50 to-sol-green/50" />
          {stack.map(({ icon: Icon, label, detail, status }) => (
            <li key={label} className="relative flex items-center gap-3">
              <span className="z-10 flex size-10 items-center justify-center rounded-xl border border-white/10 bg-ink-800">
                <Icon className="size-4 text-slate-300" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-slate-100">{label}</div>
                <div className="truncate text-[11px] text-slate-500">{detail}</div>
              </div>
              <Dot status={status} />
            </li>
          ))}
        </ol>
      </section>

      <section className="card p-6">
        <div className="flex items-center gap-2">
          <Layers className="size-4 text-slate-400" />
          <h2 className="text-base font-semibold text-white">Data foundation</h2>
        </div>
        <p className="mt-1 text-xs text-slate-500">PostgreSQL schema · amounts stored as integer lamports</p>
        <ul className="mt-4 space-y-2">
          {TABLES.map((t) => (
            <li key={t.name} className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.02] px-3 py-2">
              <span className="min-w-0">
                <code className="block truncate font-mono text-xs text-slate-300">{t.name}</code>
                <span className="block text-[10px] text-slate-500">{t.note}</span>
              </span>
              <span className="shrink-0">
                <Pill tone="green">In use</Pill>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="card p-6">
        <h2 className="text-base font-semibold text-white">Roadmap</h2>
        <ul className="mt-4 space-y-3">
          {ROADMAP.map((item) => (
            <li key={item.label} className="flex items-start gap-3 text-sm">
              <span
                className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                  item.done ? 'bg-sol-green/15 text-sol-green' : 'border border-dashed border-white/20 text-slate-500'
                }`}
              >
                {item.done ? '✓' : '→'}
              </span>
              <span className={item.done ? 'text-slate-200' : 'text-slate-400'}>{item.label}</span>
            </li>
          ))}
        </ul>
      </section>
    </aside>
  );
}
