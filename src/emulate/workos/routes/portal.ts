import { type RouteContext, parseJsonBody, validationError } from '../../core/index.js';

export function portalRoutes(ctx: RouteContext): void {
  const { app } = ctx;

  app.post('/portal/generate_link', async (c) => {
    const body = await parseJsonBody(c);
    const intent = body.intent as string | undefined;
    const organization = body.organization as string | undefined;

    if (!intent) {
      throw validationError('intent is required', [{ field: 'intent', code: 'required' }]);
    }
    if (!organization) {
      throw validationError('organization is required', [{ field: 'organization', code: 'required' }]);
    }

    const baseUrl = new URL(c.req.url).origin;
    return c.json({ link: `${baseUrl}/portal/${intent}/${organization}` });
  });
}
