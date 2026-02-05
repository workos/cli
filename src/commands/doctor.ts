import type { ArgumentsCamelCase } from 'yargs';
import { runDoctor, outputReport } from '../doctor/index.js';
import clack from '../utils/clack.js';

interface DoctorArgs {
  verbose?: boolean;
  skipApi?: boolean;
  installDir?: string;
  json?: boolean;
  copy?: boolean;
}

export async function handleDoctor(argv: ArgumentsCamelCase<DoctorArgs>): Promise<void> {
  const options = {
    installDir: argv.installDir ?? process.cwd(),
    verbose: argv.verbose ?? false,
    skipApi: argv.skipApi ?? false,
    json: argv.json ?? false,
    copy: argv.copy ?? false,
  };

  try {
    const report = await runDoctor(options);
    await outputReport(report, options);

    // Exit with error code if critical issues found
    if (report.summary.errors > 0) {
      process.exit(1);
    }
    process.exit(0);
  } catch (error) {
    if (!options.json) {
      clack.log.error(`Doctor failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } else {
      console.error(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }));
    }
    process.exit(1);
  }
}
