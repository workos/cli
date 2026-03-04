// Lucia v3 auth configuration
// In production this would use a database adapter
// Simplified for fixture — uses cookie-based sessions

export const sessionCookieName = 'auth_session';

export function createSession(userId: string, username: string) {
  const session = {
    id: crypto.randomUUID(),
    userId,
    expiresAt: new Date(Date.now() + 86400000),
  };
  const user = { id: userId, username };
  return { session, user };
}

export function encodeSession(data: { user: unknown; session: unknown }): string {
  return Buffer.from(JSON.stringify(data)).toString('base64url');
}

export function decodeSession(
  token: string,
): { user: { id: string; username: string }; session: { id: string; userId: string; expiresAt: Date } } | null {
  try {
    return JSON.parse(Buffer.from(token, 'base64url').toString());
  } catch {
    return null;
  }
}
