export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const Errors = {
  badRequest: (message: string, details?: unknown) => new AppError(400, 'BAD_REQUEST', message, details),
  validation: (details: unknown) => new AppError(400, 'VALIDATION_ERROR', 'Request validation failed', details),
  unauthorized: () => new AppError(401, 'UNAUTHORIZED', 'Authentication required'),
  notFound: (message = 'Resource not found') => new AppError(404, 'NOT_FOUND', message),
  userNotFound: (userId: string) =>
    new AppError(404, 'USER_NOT_FOUND', `User "${userId}" does not exist. Run \`npm run db:seed\`.`),
  blockchainUnavailable: () =>
    new AppError(503, 'BLOCKCHAIN_UNAVAILABLE', 'Solana Devnet RPC is unavailable. Please try again shortly.'),
  notImplemented: (message: string) => new AppError(501, 'NOT_IMPLEMENTED', message),
};
