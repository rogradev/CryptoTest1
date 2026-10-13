import type {
  ApiResponse,
  CurrentUserDto,
  DepositAddressDto,
  HealthDto,
  OnChainBalanceDto,
  TransactionListDto,
  WalletDto,
  WithdrawalValidationDto,
  WithdrawalValidationRequest,
} from '@wallet/shared';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...init,
      headers: { Accept: 'application/json', ...(init?.body ? { 'Content-Type': 'application/json' } : {}) },
    });
  } catch {
    throw new ApiError('Cannot reach the wallet API. Is the backend running?', 'NETWORK_ERROR', 0);
  }
  let body: ApiResponse<T> | null = null;
  try {
    body = (await response.json()) as ApiResponse<T>;
  } catch {
    // fall through
  }
  // Platform errors (e.g. a crashed function) are not in our { ok, ... } envelope.
  if (!body || typeof body.ok !== 'boolean') {
    throw new ApiError(`Wallet API unavailable (HTTP ${response.status})`, 'BAD_RESPONSE', response.status);
  }
  if (!body.ok) {
    const details = body.error.code === 'CONFIG_ERROR' && Array.isArray(body.error.details) ? ` ${body.error.details.join('; ')}` : '';
    throw new ApiError(`${body.error.message}${details}`, body.error.code, response.status);
  }
  return body.data;
}

/** Health returns 503 with a valid body when degraded — still useful data. */
async function health(): Promise<HealthDto> {
  const response = await fetch('/api/health');
  const body = (await response.json()) as ApiResponse<HealthDto>;
  if (!body.ok) throw new ApiError(body.error.message, body.error.code, response.status);
  return body.data;
}

export const api = {
  health,
  me: () => request<CurrentUserDto>('/me'),
  wallet: () => request<WalletDto>('/wallet'),
  balance: () => request<OnChainBalanceDto>('/wallet/balance'),
  depositAddress: () => request<DepositAddressDto>('/wallet/deposit-address'),
  transactions: (limit = 10) => request<TransactionListDto>(`/wallet/transactions?limit=${limit}`),
  validateWithdrawal: (input: WithdrawalValidationRequest) =>
    request<WithdrawalValidationDto>('/wallet/withdrawals/validate', { method: 'POST', body: JSON.stringify(input) }),
};
