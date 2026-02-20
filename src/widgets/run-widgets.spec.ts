import { describe, expect, it } from 'vitest';
import { NextJsRouter } from '../nextjs/utils.js';
import { buildWidgetsPrompt } from './run-widgets.js';
import type { WidgetsDetectionResult } from './types.js';

describe('buildWidgetsPrompt', () => {
  const detection: WidgetsDetectionResult = {
    framework: 'nextjs',
    dataFetching: 'react-query',
    styling: 'tailwind',
    componentSystem: 'base-ui',
    usesTypeScript: true,
    packageManager: 'pnpm',
  };

  it('includes explicit [STATUS] reporting requirement', () => {
    const prompt = buildWidgetsPrompt({
      framework: 'nextjs',
      entry: 'both',
      widget: 'user-management',
      componentPath: 'src/components/workos/user-management-widget.tsx',
      pagePath: 'app/widgets/user-management/page.tsx',
      detection,
      nextjsRouter: NextJsRouter.APP_ROUTER,
    });

    expect(prompt).toContain('Report your progress using [STATUS] prefixes.');
  });

  it('includes key status milestones for generation flow', () => {
    const prompt = buildWidgetsPrompt({
      framework: 'react-router',
      entry: 'both',
      widget: 'user-profile',
      componentPath: 'src/components/workos/user-profile-widget.tsx',
      pagePath: 'src/routes/user-profile.tsx',
      detection: { ...detection, framework: 'react-router' },
    });

    expect(prompt).toContain('[STATUS] Scanning project and conventions');
    expect(prompt).toContain('[STATUS] Detecting framework/data fetching/styling/component system');
    expect(prompt).toContain('[STATUS] Creating widget component');
    expect(prompt).toContain('[STATUS] Creating widget page/route');
    expect(prompt).toContain('[STATUS] Wiring route and token flow');
    expect(prompt).toContain('[STATUS] Validating generated changes');
  });
});
