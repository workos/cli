// Embedded Agent SDK assets.
//
// In dev (`bun run` / tsx) these are all null: the Claude Code native binary and
// the @workos/skills plugin resolve from node_modules the normal way.
//
// At `bun build --compile` time, scripts/build-binary.ts replaces this module
// (via a build plugin) with the real embedded values:
//   - EMBEDDED_CLAUDE_PATH points at the native `claude` binary embedded with
//     `with { type: 'file' }` (a virtual bunfs path at runtime).
//   - EMBEDDED_SKILLS is a map of skills-plugin file paths -> base64 contents.
// These are extracted to ~/.workos/runtime on first agent run because the OS
// cannot spawn an executable, nor a plugin read a directory, from inside the
// single-file binary's virtual filesystem.
export const EMBEDDED_CLAUDE_PATH: string | null = null;
export const EMBEDDED_SKILLS: Record<string, string> | null = null;
export const EMBEDDED_SKILLS_VERSION: string | null = null;
