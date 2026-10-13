import type { Response } from 'express';
import type { ApiSuccess } from '@wallet/shared';

export function ok<T>(res: Response, data: T, status = 200): void {
  const body: ApiSuccess<T> = { ok: true, data };
  res.status(status).json(body);
}
