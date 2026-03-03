import chalk from 'chalk';
import { createWorkOSClient } from '../lib/workos-client.js';
import { outputJson, isJsonMode } from '../utils/output.js';
import { createApiErrorHandler } from '../lib/api-error-handler.js';

const handleApiError = createApiErrorHandler('SetupOrg');

export interface SetupOrgOptions {
  name: string;
  domain?: string;
  roles?: string[];
}

export async function runSetupOrg(options: SetupOrgOptions, apiKey: string, baseUrl?: string): Promise<void> {
  const client = createWorkOSClient(apiKey, baseUrl);
  const summary: Record<string, unknown> = {};

  try {
    // 1. Create organization
    if (!isJsonMode()) console.log(chalk.bold(`Setting up organization: ${options.name}`));

    const org = await client.sdk.organizations.createOrganization({
      name: options.name,
    });
    summary.organizationId = org.id;
    if (!isJsonMode()) console.log(chalk.green(`  Created org: ${org.name} (${org.id})`));

    // 2. Add domain
    if (options.domain) {
      const domainResult = await client.sdk.organizationDomains.create({
        domain: options.domain,
        organizationId: org.id,
      });
      summary.domainId = domainResult.id;
      if (!isJsonMode()) console.log(chalk.green(`  Added domain: ${options.domain}`));

      // 3. Verify domain
      try {
        await client.sdk.organizationDomains.verify(domainResult.id);
        summary.domainVerified = true;
        if (!isJsonMode()) console.log(chalk.green(`  Verified domain: ${options.domain}`));
      } catch {
        summary.domainVerified = false;
        if (!isJsonMode()) console.log(chalk.yellow(`  Domain verification pending: ${options.domain}`));
      }
    }

    // 4. Create org-scoped roles (copy from env role names)
    if (options.roles?.length) {
      summary.roles = [];
      for (const roleSlug of options.roles) {
        try {
          const role = await client.sdk.authorization.createOrganizationRole(org.id, {
            slug: roleSlug,
            name: roleSlug,
          });
          (summary.roles as string[]).push(role.slug);
          if (!isJsonMode()) console.log(chalk.green(`  Created org role: ${roleSlug}`));
        } catch (error: unknown) {
          if (error instanceof Error && error.message.toLowerCase().includes('already exists')) {
            if (!isJsonMode()) console.log(chalk.dim(`  Role exists: ${roleSlug} (skipped)`));
          } else {
            if (!isJsonMode()) console.log(chalk.yellow(`  Warning: Could not create role ${roleSlug}`));
          }
        }
      }
    }

    // 5. Generate Admin Portal link
    try {
      const portal = await client.sdk.portal.generateLink({
        intent: 'sso' as Parameters<typeof client.sdk.portal.generateLink>[0]['intent'],
        organization: org.id,
      });
      summary.portalLink = portal.link;
      if (!isJsonMode()) {
        console.log(chalk.green(`  Portal link: ${portal.link}`));
        console.log(chalk.dim('  Note: Portal links expire after 5 minutes.'));
      }
    } catch {
      if (!isJsonMode()) console.log(chalk.dim('  Portal link: skipped (may require plan upgrade)'));
    }

    // 6. Print summary
    if (isJsonMode()) {
      outputJson({ status: 'ok', ...summary });
    } else {
      console.log(chalk.bold('\nSetup complete:'));
      console.log(`  Organization: ${org.id}`);
      if (options.domain)
        console.log(`  Domain: ${options.domain} (${summary.domainVerified ? 'verified' : 'pending'})`);
      if (summary.portalLink) console.log(`  Portal: ${summary.portalLink}`);
    }
  } catch (error) {
    handleApiError(error);
  }
}
