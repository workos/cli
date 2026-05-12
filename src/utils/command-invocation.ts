/**
 * Return the safest user-facing way to invoke this CLI.
 *
 * When the package is run through npm exec/npx, `workos ...` may resolve to an
 * older global binary in the user's shell. Recovery hints should keep using npx.
 */
export function getWorkOSCommand(env: NodeJS.ProcessEnv = process.env): string {
  const npmCommand = env.npm_command;
  const npmExecPath = env.npm_execpath ?? '';
  const npmUserAgent = env.npm_config_user_agent ?? '';

  const launchedByNpmExec = npmCommand === 'exec' || npmExecPath.includes('npx-cli') || /\bnpx\//.test(npmUserAgent);

  return launchedByNpmExec ? 'npx workos@latest' : 'workos';
}

export function formatWorkOSCommand(args: string, env: NodeJS.ProcessEnv = process.env): string {
  return `${getWorkOSCommand(env)} ${args}`;
}

export function shellQuoteArg(arg: string): string {
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(arg)) {
    return arg;
  }
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

export function formatWorkOSCommandArgs(args: string[], env: NodeJS.ProcessEnv = process.env): string {
  return [getWorkOSCommand(env), ...args.map(shellQuoteArg)].join(' ');
}
