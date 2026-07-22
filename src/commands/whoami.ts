/**
 * `workos whoami` — resolve the caller's identity from the dashboard session.
 *
 * Unlike `auth status` (which only inspects the locally stored token), this
 * calls the dashboard GraphQL API with the OAuth bearer and reports who the
 * server says you are: the authenticated user, their team, and the environment
 * the session currently acts on. It is read-only and account-scoped.
 */

import chalk from 'chalk';
import { requireCommandToken } from '../lib/command-auth.js';
import { dashboardGraphqlRequest } from '../lib/dashboard-graphql.js';
import { reportDashboardError } from '../catalog/operation.js';
import { isJsonMode, outputJson } from '../utils/output.js';

// Every field below is read straight from the bearer guard's request context
// (`context.user` / `context.team` / `context.environment`), so all three root
// fields co-resolve under the CLI token. Selections mirror the dashboard's own
// `dashboardSession` query — no speculative fields.
const WHOAMI_QUERY = `query workosCliWhoami {
  me {
    id
    name
    email
    workosUserId
  }
  currentTeam {
    id
    name
    organizationId
    productionState
  }
  currentEnvironment {
    id
    name
    clientId
    platform
    sandbox
  }
}`;

interface WhoamiData {
  me: {
    id: string;
    name: string | null;
    email: string;
    workosUserId: string | null;
  };
  currentTeam: {
    id: string;
    name: string | null;
    organizationId: string | null;
    productionState: string | null;
  } | null;
  currentEnvironment: {
    id: string;
    name: string | null;
    clientId: string | null;
    platform: string | null;
    sandbox: boolean | null;
  } | null;
}

export async function runWhoami(): Promise<void> {
  // Resolve a usable bearer, silently refreshing an expired access token when
  // a valid refresh token exists; exits 4 when no usable session remains.
  const token = await requireCommandToken();

  let data: WhoamiData;
  try {
    data = await dashboardGraphqlRequest<WhoamiData>(WHOAMI_QUERY, { token });
  } catch (error) {
    reportDashboardError(error);
  }

  if (isJsonMode()) {
    outputJson({
      user: data.me,
      team: data.currentTeam,
      environment: data.currentEnvironment,
    });
    return;
  }

  renderHuman(data);
}

function renderHuman(data: WhoamiData): void {
  const { me, currentTeam, currentEnvironment } = data;

  console.log(chalk.bold('User'));
  console.log(`  ${me.name ?? chalk.dim('(no name)')}  ${chalk.dim(me.email)}`);
  console.log(chalk.dim(`  dashboard id: ${me.id}`));
  if (me.workosUserId) {
    console.log(chalk.dim(`  workos user:  ${me.workosUserId}`));
  }

  if (currentTeam) {
    console.log();
    console.log(chalk.bold('Team'));
    console.log(`  ${currentTeam.name ?? chalk.dim('(unnamed)')}`);
    if (currentTeam.organizationId) {
      console.log(chalk.dim(`  organization: ${currentTeam.organizationId}`));
    }
    if (currentTeam.productionState) {
      console.log(chalk.dim(`  production:   ${currentTeam.productionState}`));
    }
  }

  if (currentEnvironment) {
    console.log();
    console.log(chalk.bold('Environment'));
    const sandboxTag = currentEnvironment.sandbox ? chalk.dim(' (sandbox)') : '';
    console.log(`  ${currentEnvironment.name ?? chalk.dim('(unnamed)')}${sandboxTag}`);
    if (currentEnvironment.platform) {
      console.log(chalk.dim(`  platform:  ${currentEnvironment.platform}`));
    }
    if (currentEnvironment.clientId) {
      console.log(chalk.dim(`  client id: ${currentEnvironment.clientId}`));
    }
    console.log(chalk.dim(`  env id:    ${currentEnvironment.id}`));
  }
}
