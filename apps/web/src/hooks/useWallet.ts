import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAsync } from './useAsync';

/**
 * Wallet state for the dashboard. The wallet must exist before balance and
 * transactions are fetched (first call creates it server-side).
 */
export function useWallet() {
  const user = useAsync(api.me);
  const wallet = useAsync(api.wallet);
  const address = wallet.data?.address;

  const balance = useAsync(async () => (address ? api.balance() : null), [address]);
  const transactions = useAsync(async () => (address ? api.transactions(10) : null), [address]);

  /** Signed lamport change detected by the most recent manual refresh. */
  const [lastChange, setLastChange] = useState<bigint | null>(null);

  const refreshBalance = useCallback(async () => {
    const previous = balance.data ? BigInt(balance.data.balanceLamports) : null;
    const [next] = await Promise.all([balance.reload(), transactions.reload()]);
    if (next && previous !== null) {
      const delta = BigInt(next.balanceLamports) - previous;
      setLastChange(delta !== 0n ? delta : null);
    }
  }, [balance, transactions]);

  useEffect(() => {
    if (lastChange === null) return;
    const t = setTimeout(() => setLastChange(null), 8000);
    return () => clearTimeout(t);
  }, [lastChange]);

  return { user, wallet, balance, transactions, refreshBalance, lastChange };
}

export type WalletState = ReturnType<typeof useWallet>;
