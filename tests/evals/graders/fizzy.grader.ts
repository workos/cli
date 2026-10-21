import { FileGrader } from './file-grader.js';
import type { Grader, GradeResult } from '../types.js';

export const FIZZY_ACCEPTANCE = [
  'Visible signed-out login and signed-in account/logout controls',
  'Callback establishes approved identity/session/account association',
  'Repeat login does not duplicate identities/accounts/memberships',
  'Protected access denied after logout, including old-session replay',
  'Targeted callback/CORS/sign-out/Initiate login read-back preserves unrelated settings',
  'Existing account boundaries, roles, magic links/passkeys and routes preserved',
] as const;

/** Source observations only. Never turn a grep match into Rails/hosted acceptance. */
export class FizzyGrader implements Grader {
  constructor(private workDir: string) {}

  async grade(): Promise<GradeResult> {
    const files = new FileGrader(this.workDir);
    const checks = [
      ...(await files.checkFileContains('Gemfile', ['workos'])),
      await files.checkFileWithPattern(
        'app/controllers/**/*.rb',
        [/authenticate_with_code/],
        'Callback source candidate',
      ),
      await files.checkFileWithPattern('config/routes.rb', [/auth/], 'Auth route source candidate'),
      await files.checkFileWithPattern(
        'app/views/**/*',
        [/logout|sign.out/i, /login|sign.in/i],
        'Auth UI source candidate',
      ),
    ].map((check) => ({ ...check, name: `Static only: ${check.name}` }));
    return {
      passed: false,
      checks: [
        ...checks,
        ...FIZZY_ACCEPTANCE.map((name) => ({
          name,
          passed: false,
          message:
            'UNVERIFIED: requires recorded route/session/browser or hosted evidence; this source grader cannot prove acceptance. Account policy must be approved first.',
        })),
      ],
    };
  }
}
