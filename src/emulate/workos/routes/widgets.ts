import { type RouteContext, parseJsonBody, validationError } from '../../core/index.js';

export function widgetRoutes(ctx: RouteContext): void {
  const { app, jwt } = ctx;

  app.post('/widgets/token', async (c) => {
    const body = await parseJsonBody(c);
    const organizationId = body.organization_id as string | undefined;
    const userId = body.user_id as string | undefined;
    const scopes = body.scopes as string[] | undefined;

    if (!organizationId) {
      throw validationError('organization_id is required', [{ field: 'organization_id', code: 'required' }]);
    }
    if (!userId) {
      throw validationError('user_id is required', [{ field: 'user_id', code: 'required' }]);
    }
    if (!scopes || !Array.isArray(scopes)) {
      throw validationError('scopes is required', [{ field: 'scopes', code: 'required' }]);
    }

    const token = jwt.sign({
      sub: userId,
      org_id: organizationId,
      aud: 'widgets',
      scopes,
    } as any);

    return c.json({ token });
  });
}
