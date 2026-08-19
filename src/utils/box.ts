/**
 * Flat, gutterless notice to stderr — the de-boxed startup/notice output.
 *
 * Callers pass already-styled lines; this indents them two spaces and frames
 * them with a single blank line above and below so the notice reads as its own
 * beat without a border. This is the only notice primitive: the CLI no longer
 * draws bordered boxes for startup notices (telemetry, unclaimed env, provision).
 */
export function renderStderrNotice(...lines: string[]): void {
  console.error('');
  for (const ln of lines) console.error(`  ${ln}`);
  console.error('');
}
