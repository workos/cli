/**
 * Shared mock for UnclaimedEnvApiError — used by claim.spec.ts and unclaimed-warning.spec.ts.
 */
export class MockUnclaimedEnvApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = 'UnclaimedEnvApiError';
  }
}
