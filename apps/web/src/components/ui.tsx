import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

type Variant = 'primary' | 'secondary' | 'ghost';

const variants: Record<Variant, string> = {
  primary:
    'bg-gradient-to-r from-sol-purple to-[#7b5cff] text-white shadow-[0_8px_24px_-8px_rgba(153,69,255,0.7)] hover:brightness-110',
  secondary: 'bg-white/[0.06] text-slate-100 ring-1 ring-inset ring-white/10 hover:bg-white/[0.1]',
  ghost: 'text-slate-300 hover:bg-white/[0.06] hover:text-white',
};

export function Button({
  variant = 'primary',
  className = '',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-2 rounded-2xl px-5 py-3 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sol-purple disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:brightness-100 ${variants[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function NetworkBadge({ size = 'md' }: { size?: 'sm' | 'md' }) {
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border border-sol-green/30 bg-sol-green/10 font-semibold uppercase tracking-[0.14em] text-sol-green ${
        size === 'sm' ? 'px-2.5 py-1 text-[10px]' : 'px-3.5 py-1.5 text-[11px]'
      }`}
    >
      <span className="relative flex size-2">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-sol-green opacity-60" />
        <span className="relative inline-flex size-2 rounded-full bg-sol-green" />
      </span>
      Solana Devnet
    </span>
  );
}

export function Pill({ tone, children }: { tone: 'green' | 'amber' | 'red' | 'slate' | 'purple'; children: ReactNode }) {
  const tones = {
    green: 'bg-emerald-400/10 text-emerald-300 ring-emerald-400/20',
    amber: 'bg-amber-400/10 text-amber-300 ring-amber-400/20',
    red: 'bg-rose-400/10 text-rose-300 ring-rose-400/20',
    slate: 'bg-white/5 text-slate-300 ring-white/10',
    purple: 'bg-sol-purple/15 text-violet-300 ring-sol-purple/30',
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="animate-fade-up relative max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl border border-white/10 bg-ink-900 p-6 shadow-2xl outline-none sm:max-w-md sm:rounded-3xl sm:p-7"
      >
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-white">{title}</h2>
            {subtitle && <p className="mt-1 text-sm text-slate-400">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="-mr-2 -mt-1 rounded-xl p-2 text-slate-400 transition hover:bg-white/5 hover:text-white"
            aria-label="Close"
          >
            <X className="size-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-medium text-slate-100">{children}</div>
    </div>
  );
}
