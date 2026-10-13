// Error with a stable code, returned to clients as { code, message, retryable } (FSD §10).
export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public retryable = false,
    public details?: unknown,
  ) {
    super(message);
  }
}
