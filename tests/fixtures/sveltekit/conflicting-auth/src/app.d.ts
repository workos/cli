// Lucia v3 session types
declare global {
  namespace App {
    interface Locals {
      user: { id: string; username: string } | null;
      session: { id: string; userId: string; expiresAt: Date } | null;
    }
  }
}

export {};
