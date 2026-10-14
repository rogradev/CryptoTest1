import { useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { AddFundsModal } from './components/AddFundsModal';
import { BalanceCard } from './components/BalanceCard';
import { Header } from './components/Header';
import { SystemCard } from './components/SystemCard';
import { TransactionsCard } from './components/TransactionsCard';
import { WithdrawModal } from './components/WithdrawModal';
import { Button } from './components/ui';
import { useAsync } from './hooks/useAsync';
import { useWallet } from './hooks/useWallet';
import { api } from './lib/api';

export function App() {
  const [modal, setModal] = useState<'add-funds' | 'withdraw' | null>(null);
  const wallet = useWallet({ fastPolling: modal !== null });
  const health = useAsync(api.health);
  const close = () => setModal(null);

  useEffect(() => {
    const t = setInterval(() => void health.reload(), 30_000);
    return () => clearInterval(t);
  }, [health]);

  const fatal = wallet.wallet.error && !wallet.wallet.data;

  return (
    <div className="relative min-h-dvh overflow-x-hidden">
      <div className="pointer-events-none fixed inset-x-0 top-0 h-[480px] bg-[radial-gradient(ellipse_at_top,rgba(153,69,255,0.16),transparent_60%)]" />
      <div className="relative mx-auto max-w-6xl px-4 pb-16 pt-6 sm:px-6 sm:pt-10">
        <Header user={wallet.user.data} />

        {fatal ? (
          <div className="card mx-auto mt-16 max-w-lg p-8 text-center">
            <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-rose-400/10">
              <AlertTriangle className="size-6 text-rose-300" />
            </div>
            <h1 className="mt-4 text-lg font-semibold text-white">Wallet unavailable</h1>
            <p className="mt-2 text-sm text-slate-400">{wallet.wallet.error}</p>
            <Button className="mt-6" variant="secondary" onClick={() => void wallet.wallet.reload()}>
              <RefreshCw className="size-4" /> Try again
            </Button>
          </div>
        ) : (
          <main className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-6 lg:mt-10 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="space-y-6">
              <BalanceCard state={wallet} onAddFunds={() => setModal('add-funds')} onWithdraw={() => setModal('withdraw')} />
              <TransactionsCard state={wallet.activity} />
            </div>
            <SystemCard health={health} />
          </main>
        )}

        <footer className="mt-12 text-center text-xs leading-relaxed text-slate-600">
          Development checkpoint · Solana Devnet only · Devnet custody prototype, not production custody.
        </footer>
      </div>

      <AddFundsModal open={modal === 'add-funds'} onClose={close} state={wallet} />
      <WithdrawModal open={modal === 'withdraw'} onClose={close} state={wallet} />
    </div>
  );
}
