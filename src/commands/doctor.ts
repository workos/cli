import type { ArgumentsCamelCase } from 'yargs';
import { runDoctor, formatReport } from '../doctor/index.js';
import clack from '../utils/clack.js';

interface DoctorArgs {
  verbose?: boolean;
  skipApi?: boolean;
  installDir?: string;
  json?: boolean;
}

export async function handleDoctor(argv: ArgumentsCamelCase<DoctorArgs>): Promise<void> {
  const options = {
    installDir: argv.installDir ?? process.cwd(),
    verbose: argv.verbose ?? false,
    skipApi: argv.skipApi ?? false,
  };

  try {
    const report = await runDoctor(options);

    // JSON output mode
    if (argv.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      formatReport(report);
    }

    // Exit with error code if critical issues found
    if (report.summary.errors > 0) {
      process.exit(1);
    }
    process.exit(0);
  } catch (error) {
    clack.log.error(`Doctor failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    process.exit(1);
  }
}
