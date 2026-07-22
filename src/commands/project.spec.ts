import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mockRequireCommandToken = vi.fn();
const mockGraphqlRequest = vi.fn();

vi.mock('../lib/command-auth.js', async (importActual) => {
  const actual = await importActual<typeof import('../lib/command-auth.js')>();
  return {
    ...actual,
    requireCommandToken: () => mockRequireCommandToken(),
  };
});

vi.mock('../lib/dashboard-graphql.js', async (importActual) => {
  const actual = await importActual<typeof import('../lib/dashboard-graphql.js')>();
  return {
    ...actual,
    dashboardGraphqlRequest: (...args: unknown[]) => mockGraphqlRequest(...args),
  };
});

const { setOutputMode } = await import('../utils/output.js');
const { resetInteractionModeForTests, setInteractionMode } = await import('../utils/interaction-mode.js');
const { CliExit } = await import('../utils/cli-exit.js');
const { loadManagementCatalog } = await import('../catalog/loader.js');
const { resolveCommandMeta } = await import('../catalog/curation.js');
const { runProjectCreate, runProjectRename, runProjectList } = await import('./project.js');

async function expectExit(promise: Promise<unknown>, code: number): Promise<CliExit> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof CliExit) {
      expect(err.exitCode).toBe(code);
      return err;
    }
    throw err;
  }
  throw new Error(`Expected CliExit(${code}) but promise resolved`);
}

describe('project command', () => {
  let consoleOutput: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    resetInteractionModeForTests();
    setOutputMode('human');
    mockRequireCommandToken.mockResolvedValue('tok_123');
    consoleOutput = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      consoleOutput.push(args.map(String).join(' '));
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetInteractionModeForTests();
    setOutputMode('human');
  });

  describe('create (require-flag)', () => {
    it('refuses non-interactive without --yes (exit 1, confirmation_required)', async () => {
      setInteractionMode({ mode: 'ci', source: 'ci_env' });
      const err = await expectExit(runProjectCreate({ name: 'Acme', production: true, yes: false }), 1);
      expect(err.context?.errorCode).toBe('confirmation_required');
      expect(mockGraphqlRequest).not.toHaveBeenCalled();
    });

    it('proceeds non-interactive with --yes', async () => {
      setInteractionMode({ mode: 'ci', source: 'ci_env' });
      mockGraphqlRequest.mockResolvedValue({
        createProjectWithNewEnvironments: { __typename: 'ProjectCreated', project: { id: 'proj_1', name: 'Acme' } },
      });
      await runProjectCreate({ name: 'Acme', production: true, yes: true });
      expect(mockGraphqlRequest).toHaveBeenCalledWith(expect.stringContaining('createProjectWithNewEnvironments'), {
        token: 'tok_123',
        variables: { input: { name: 'Acme', includeProductionEnvironment: true } },
      });
    });

    it('proceeds interactively without --yes (human is trusted)', async () => {
      setInteractionMode({ mode: 'human', source: 'default' });
      mockGraphqlRequest.mockResolvedValue({
        createProjectWithNewEnvironments: { __typename: 'ProjectCreated', project: { id: 'proj_1', name: 'Acme' } },
      });
      await runProjectCreate({ name: 'Acme', production: false, yes: false });
      expect(mockGraphqlRequest).toHaveBeenCalledWith(expect.anything(), {
        token: 'tok_123',
        variables: { input: { name: 'Acme', includeProductionEnvironment: false } },
      });
    });

    it('errors when the project name already exists', async () => {
      setInteractionMode({ mode: 'human', source: 'default' });
      mockGraphqlRequest.mockResolvedValue({
        createProjectWithNewEnvironments: { __typename: 'ProjectNameAlreadyUsed', name: 'Acme' },
      });
      const err = await expectExit(runProjectCreate({ name: 'Acme', production: true, yes: false }), 1);
      expect(err.context?.errorCode).toBe('name_already_used');
    });
  });

  describe('rename', () => {
    it('maps projectId + name to the input', async () => {
      mockGraphqlRequest.mockResolvedValue({
        renameProject: { __typename: 'ProjectRenamed', project: { id: 'proj_1', name: 'New' } },
      });
      await runProjectRename({ projectId: 'proj_1', name: 'New' });
      expect(mockGraphqlRequest).toHaveBeenCalledWith(expect.stringContaining('renameProject'), {
        token: 'tok_123',
        variables: { input: { projectId: 'proj_1', name: 'New' } },
      });
    });

    it('errors on ProjectNotFound', async () => {
      mockGraphqlRequest.mockResolvedValue({
        renameProject: { __typename: 'ProjectNotFound', projectId: 'proj_x' },
      });
      const err = await expectExit(runProjectRename({ projectId: 'proj_x', name: 'New' }), 1);
      expect(err.context?.errorCode).toBe('not_found');
    });
  });

  describe('list', () => {
    it('renders projects in human mode', async () => {
      mockGraphqlRequest.mockResolvedValue({
        currentTeam: { id: 'team_1', projectsV2: [{ id: 'proj_1', name: 'Acme', environments: [{ id: 'env_1' }] }] },
      });
      await runProjectList();
      const out = consoleOutput.join('\n');
      expect(out).toContain('proj_1');
      expect(out).toContain('Acme');
    });

    it('outputs JSON in json mode', async () => {
      setOutputMode('json');
      mockGraphqlRequest.mockResolvedValue({
        currentTeam: { id: 'team_1', projectsV2: [{ id: 'proj_1', name: 'Acme', environments: [] }] },
      });
      await runProjectList();
      const out = JSON.parse(consoleOutput[0]);
      expect(out.projects[0].id).toBe('proj_1');
    });

    it('handles an empty team', async () => {
      mockGraphqlRequest.mockResolvedValue({ currentTeam: null });
      await runProjectList();
      expect(consoleOutput.join('\n')).toContain('No projects found.');
    });

    it('uses the curated (non-rotten) description, not the catalog rot string', () => {
      // teamProjectsV2's catalog description is wrong upstream ("Return the team
      // for the current dashboard session"). The curation override must win.
      const catalog = loadManagementCatalog(undefined, { includeFeatureFlagged: true });
      const op = catalog.operations.find((o) => o.name === 'teamProjectsV2')!;
      expect(op.description).toMatch(/return the team for the current dashboard session/i);
      const meta = resolveCommandMeta(op);
      expect(meta.command).toBe('project list');
      expect(meta.describe).toBe('List projects in the current team');
      expect(meta.describe).not.toMatch(/return the team for the current dashboard session/i);
    });
  });
});
