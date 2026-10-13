import { lamportsToSol } from '@wallet/shared';

/** Display helper: trims trailing zeros but keeps at least `min` decimals. */
export function formatSol(lamports: string | bigint, min = 4): string {
  const full = lamportsToSol(lamports);
  const [whole, fraction = ''] = full.replace('-', '').split('.');
  const trimmed = fraction.replace(/0+$/, '').padEnd(min, '0');
  const sign = full.startsWith('-') ? '-' : '';
  const grouped = BigInt(whole ?? '0').toLocaleString('en-US');
  return `${sign}${grouped}.${trimmed}`;
}

export function relativeTime(iso: string | null): string {
  if (!iso) return 'Pending';
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 45) return 'Just now';
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (seconds < 3600) return rtf.format(-Math.round(seconds / 60), 'minute');
  if (seconds < 86400) return rtf.format(-Math.round(seconds / 3600), 'hour');
  return rtf.format(-Math.round(seconds / 86400), 'day');
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall back below
  }
  // Fallback for non-secure contexts (e.g. LAN IP during a demo).
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const ok = document.execCommand('copy');
  document.body.removeChild(textarea);
  return ok;
}
