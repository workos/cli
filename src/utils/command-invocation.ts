/**
 * Return the user-facing executable name for the standalone binary.
 */
export function getWorkOSCommand(_env: NodeJS.ProcessEnv = process.env): string {
  return 'workos';
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
