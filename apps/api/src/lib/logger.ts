/**
 * Minimal structured logger. Wallet secrets are never passed to it —
 * secret material only exists transiently inside WalletService.
 */
type Level = 'debug' | 'info' | 'warn' | 'error';

function write(level: Level, message: string, meta?: Record<string, unknown>) {
  if (process.env.NODE_ENV === 'test' && level !== 'error') return;
  const line = JSON.stringify({ time: new Date().toISOString(), level, message, ...meta });
  if (level === 'error' || level === 'warn') console.error(line);
  else console.log(line);
}

export const logger = {
  debug: (message: string, meta?: Record<string, unknown>) => write('debug', message, meta),
  info: (message: string, meta?: Record<string, unknown>) => write('info', message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => write('warn', message, meta),
  error: (message: string, meta?: Record<string, unknown>) => write('error', message, meta),
};
