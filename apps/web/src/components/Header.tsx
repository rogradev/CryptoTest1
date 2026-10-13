import type { CurrentUserDto } from '@wallet/shared';
import { NetworkBadge } from './ui';

export function Header({ user }: { user: CurrentUserDto | null }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <img src="/favicon.svg" alt="" className="size-9" />
        <div>
          <div className="text-lg font-semibold tracking-tight text-white">Wallet</div>
          <div className="text-xs text-slate-500">Custodial SOL wallet · prototype</div>
        </div>
      </div>
      <div className="flex items-center gap-3">
        {user && (
          <div className="hidden items-center gap-2.5 rounded-full border border-white/10 bg-white/[0.03] py-1 pl-1 pr-3.5 sm:flex">
            <span className="flex size-7 items-center justify-center rounded-full bg-gradient-to-br from-slate-600 to-slate-800 text-xs font-semibold text-white">
              {(user.displayName ?? user.id).slice(0, 1).toUpperCase()}
            </span>
            <div className="leading-tight">
              <div className="text-xs font-medium text-slate-200">{user.displayName ?? user.id}</div>
              <div className="font-mono text-[10px] text-slate-500">
                {user.id}
                {user.authMode === 'demo' && <span className="ml-1.5 text-amber-300/80">· demo session</span>}
              </div>
            </div>
          </div>
        )}
        <NetworkBadge />
      </div>
    </header>
  );
}
