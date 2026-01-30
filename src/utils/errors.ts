export class RateLimitError extends Error {
  constructor() {
    super('Installer usage limit reached.');
    this.name = 'RateLimitError';
  }
}
