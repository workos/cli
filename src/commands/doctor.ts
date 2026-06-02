import type { ArgumentsCamelCase } from 'yargs';
import { runDoctor, outputReport } from '../doctor/index.js';
import clack from '../utils/clack.js';
import { ExitCode, exitWithCode } from '../utils/exit-codes.js';
import { CliExit } from '../utils/cli-exit.js';

interface DoctorArgs {
  verbose?: boolean;
  skipApi?: boolean;
  skipAi?: boolean;
  installDir?: string;
  json?: boolean;
  copy?: boolean;
  fix?: boolean;
}

export async function handleDoctor(argv: ArgumentsCamelCase<DoctorArgs>): Promise<void> {
  const options = {
    installDir: argv.installDir ?? process.cwd(),
    verbose: argv.verbose ?? false,
    skipApi: argv.skipApi ?? false,
    skipAi: argv.skipAi ?? false,
    json: argv.json ?? false,
    copy: argv.copy ?? false,
    fix: argv.fix ?? false,
  };

  try {
    const report = await runDoctor(options);
    await outputReport(report, options);

    // Exit with error code if critical issues found
    if (report.summary.errors > 0) {
      exitWithCode(ExitCode.GENERAL_ERROR);
    }
    exitWithCode(ExitCode.SUCCESS);
  } catch (error) {
    if (error instanceof CliExit) throw error;
    if (!options.json) {
      clack.log.error(`Doctor failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } else {
      console.error(
        JSON.stringify({
          error: {
            code: 'doctor_failed',
            message: error instanceof Error ? error.message : 'Unknown error',
          },
        }),
      );
    }
    exitWithCode(ExitCode.GENERAL_ERROR);
  }
}
