import type { Integration } from '../../lib/constants.js';
import { traceStep } from '../../telemetry.js';
import { analytics } from '../../utils/analytics.js';
import ui from '../../utils/ui.js';
import { abortIfCancelled } from '../../utils/ui-utils.js';
import { isPromptAllowed } from '../../utils/interaction-mode.js';
import type { InstallerOptions } from '../../utils/types.js';
import { EnvironmentProvider } from './EnvironmentProvider.js';
import { VercelEnvironmentProvider } from './providers/vercel.js';

export const uploadEnvironmentVariablesStep = async (
  envVars: Record<string, string>,
  {
    integration,
    options,
  }: {
    integration: Integration;
    options: InstallerOptions;
  },
): Promise<string[]> => {
  const providers: EnvironmentProvider[] = [new VercelEnvironmentProvider(options)];

  let provider: EnvironmentProvider | null = null;

  for (const p of providers) {
    if (await p.detect()) {
      provider = p;
      break;
    }
  }

  if (!provider) {
    analytics.capture('installer interaction', {
      action: 'not uploading environment variables',
      reason: 'no environment provider found',
      integration,
    });
    return [];
  }

  // Non-interactive mode: default to skipping the upload rather than prompting
  // (or failing fast via the abortIfCancelled guard below).
  if (!isPromptAllowed()) {
    analytics.capture('installer interaction', {
      action: 'not uploading environment variables',
      reason: 'non-interactive mode',
      provider: provider.name,
      integration,
    });
    return [];
  }

  const upload: boolean = await abortIfCancelled(
    ui.select({
      message: `It looks like you are using ${provider.name}. Would you like to upload the environment variables?`,
      options: [
        {
          value: true,
          label: 'Yes',
          hint: `Upload the environment variables to ${provider.name}`,
        },
        {
          value: false,
          label: 'No',
          hint: `Skip uploading environment variables to ${provider.name} - you can do this later`,
        },
      ],
    }),
    integration,
  );

  if (!upload) {
    analytics.capture('installer interaction', {
      action: 'not uploading environment variables',
      reason: 'user declined to upload',
      provider: provider.name,
      integration,
    });
    return [];
  }

  const results = await traceStep('uploading environment variables', async () => {
    return await provider.uploadEnvVars(envVars);
  });

  analytics.capture('installer interaction', {
    action: 'uploaded environment variables',
    provider: provider.name,
    integration,
  });

  return Object.keys(results).filter((key) => results[key]);
};
