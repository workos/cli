import { type RouteContext, notFound, validationError, parseJsonBody } from '../../core/index.js';
import { getWorkOSStore } from '../store.js';
import { formatPipeConnection, parseListParams } from '../helpers.js';
import type { PipeProvider } from '../entities.js';

const VALID_PROVIDERS: PipeProvider[] = ['github', 'slack', 'google', 'salesforce'];

export function pipeRoutes(ctx: RouteContext): void {
  const { app, store } = ctx;
  const ws = getWorkOSStore(store);

  app.post('/pipes/connections', async (c) => {
    const body = await parseJsonBody(c);
    const userId = body.user_id as string | undefined;
    const provider = body.provider as PipeProvider | undefined;
    const scopes = (body.scopes as string[]) ?? [];

    if (!userId) {
      throw validationError('user_id is required', [{ field: 'user_id', code: 'required' }]);
    }
    if (!provider) {
      throw validationError('provider is required', [{ field: 'provider', code: 'required' }]);
    }
    if (!VALID_PROVIDERS.includes(provider)) {
      throw validationError(`provider must be one of: ${VALID_PROVIDERS.join(', ')}`, [
        { field: 'provider', code: 'invalid' },
      ]);
    }

    const conn = ws.pipeConnections.insert({
      object: 'pipe_connection',
      user_id: userId,
      provider,
      scopes,
      status: 'connected',
      external_account_id: (body.external_account_id as string) ?? null,
    });

    return c.json(formatPipeConnection(conn), 201);
  });

  app.get('/pipes/connections', (c) => {
    const url = new URL(c.req.url);
    const params = parseListParams(url);
    const userIdFilter = url.searchParams.get('user_id') ?? undefined;
    const providerFilter = url.searchParams.get('provider') ?? undefined;

    const result = ws.pipeConnections.list({
      ...params,
      filter: (pc) => {
        if (userIdFilter && pc.user_id !== userIdFilter) return false;
        if (providerFilter && pc.provider !== providerFilter) return false;
        return true;
      },
    });

    return c.json({
      object: 'list',
      data: result.data.map(formatPipeConnection),
      list_metadata: result.list_metadata,
    });
  });

  app.get('/pipes/connections/:id', (c) => {
    const conn = ws.pipeConnections.get(c.req.param('id'));
    if (!conn) throw notFound('Pipe connection');
    return c.json(formatPipeConnection(conn));
  });

  app.delete('/pipes/connections/:id', (c) => {
    const conn = ws.pipeConnections.get(c.req.param('id'));
    if (!conn) throw notFound('Pipe connection');
    ws.pipeConnections.delete(conn.id);
    return c.body(null, 204);
  });

  app.post('/pipes/connections/:id/access_token', (c) => {
    const conn = ws.pipeConnections.get(c.req.param('id'));
    if (!conn) throw notFound('Pipe connection');
    if (conn.status !== 'connected') {
      return c.json(
        {
          error: 'connection_inactive',
          message: `Connection is ${conn.status}`,
        },
        400,
      );
    }

    return c.json({
      access_token: `pipes_mock_${conn.provider}_${conn.user_id}`,
      token_type: 'bearer',
      scopes: conn.scopes,
      expires_in: 3600,
    });
  });
}
