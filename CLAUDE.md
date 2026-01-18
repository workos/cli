# wizard

This ia an AI Installer agent and CLI project for automatically installing WorkOS AuthKit into a project.

## Tech Notes

- This project uses pnpm
- This project uses ESM, not CJS. Never use CJS-only syntax.
- Strict TypeScript is essential. never use `as any` or any other hacky tricks
- Anywhere that it can be avoided, we should not be using node-specific APIs like crytpo, etc.
- Use fetch for networking
- Assume Node 22+ support

