declare global {
  namespace App {
    interface Locals {
      user: { sub: string; email: string; name: string } | null;
    }
  }
}

export {};
