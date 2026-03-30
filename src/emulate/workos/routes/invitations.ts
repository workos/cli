import {
  type RouteContext,
  notFound,
  validationError,
  parseJsonBody,
  WorkOSApiError,
  parseListParams,
} from '../../core/index.js';
import { getWorkOSStore } from '../store.js';
import { formatInvitation, generateVerificationToken, expiresIn, formatListResponse } from '../helpers.js';
import type { EventBus } from '../event-bus.js';
import { STORE_KEYS, EVENTS } from '../constants.js';

export function invitationRoutes(ctx: RouteContext): void {
  const { app, store, baseUrl } = ctx;
  const ws = getWorkOSStore(store);

  app.post('/user_management/invitations', async (c) => {
    const body = await parseJsonBody(c);
    const email = body.email as string | undefined;
    if (!email) {
      throw validationError('email is required', [{ field: 'email', code: 'required' }]);
    }

    const token = generateVerificationToken();
    const inv = ws.invitations.insert({
      object: 'invitation',
      email,
      state: 'pending',
      token,
      accept_invitation_url: `${baseUrl}/user_management/invitations/accept?token=${token}`,
      organization_id: (body.organization_id as string) ?? null,
      inviter_user_id: (body.inviter_user_id as string) ?? null,
      role_slug: (body.role_slug as string) ?? null,
      expires_at: expiresIn(72 * 60), // 72 hours
    });

    return c.json(formatInvitation(inv), 201);
  });

  app.get('/user_management/invitations', (c) => {
    const url = new URL(c.req.url);
    const params = parseListParams(url);
    const emailFilter = url.searchParams.get('email') ?? undefined;
    const orgFilter = url.searchParams.get('organization_id') ?? undefined;

    const result = ws.invitations.list({
      ...params,
      filter: (inv) => {
        if (emailFilter && inv.email !== emailFilter) return false;
        if (orgFilter && inv.organization_id !== orgFilter) return false;
        return true;
      },
    });

    return c.json(formatListResponse(result, formatInvitation));
  });

  app.get('/user_management/invitations/by_token/:token', (c) => {
    const inv = ws.invitations.findOneBy('token', c.req.param('token'));
    if (!inv) throw notFound('Invitation');
    return c.json(formatInvitation(inv));
  });

  app.get('/user_management/invitations/:id', (c) => {
    const inv = ws.invitations.get(c.req.param('id'));
    if (!inv) throw notFound('Invitation');
    return c.json(formatInvitation(inv));
  });

  app.post('/user_management/invitations/:id/accept', (c) => {
    const inv = ws.invitations.get(c.req.param('id'));
    if (!inv) throw notFound('Invitation');

    if (inv.state !== 'pending') {
      throw new WorkOSApiError(400, `Invitation is ${inv.state}`, 'invalid_invitation_state');
    }

    ws.invitations.update(inv.id, { state: 'accepted' });
    const eventBus = store.getData<EventBus>(STORE_KEYS.eventBus);
    eventBus?.emit({ event: EVENTS.invitationAccepted, data: formatInvitation(ws.invitations.get(inv.id)!) });

    // Create org membership if invitation has an organization
    if (inv.organization_id) {
      const user = ws.users.findOneBy('email', inv.email);
      if (user) {
        ws.organizationMemberships.insert({
          object: 'organization_membership',
          organization_id: inv.organization_id,
          user_id: user.id,
          role: { slug: inv.role_slug ?? 'member' },
          status: 'active',
          external_id: null,
          metadata: {},
        });
      }
    }

    const updated = ws.invitations.get(inv.id)!;
    return c.json(formatInvitation(updated));
  });

  app.post('/user_management/invitations/:id/revoke', (c) => {
    const inv = ws.invitations.get(c.req.param('id'));
    if (!inv) throw notFound('Invitation');

    if (inv.state !== 'pending') {
      throw new WorkOSApiError(400, `Invitation is ${inv.state}`, 'invalid_invitation_state');
    }

    ws.invitations.update(inv.id, { state: 'revoked' });
    const eventBus = store.getData<EventBus>(STORE_KEYS.eventBus);
    eventBus?.emit({ event: EVENTS.invitationRevoked, data: formatInvitation(ws.invitations.get(inv.id)!) });
    const updated = ws.invitations.get(inv.id)!;
    return c.json(formatInvitation(updated));
  });

  app.post('/user_management/invitations/:id/resend', (c) => {
    const inv = ws.invitations.get(c.req.param('id'));
    if (!inv) throw notFound('Invitation');

    const newToken = generateVerificationToken();
    ws.invitations.update(inv.id, {
      token: newToken,
      accept_invitation_url: `${baseUrl}/user_management/invitations/accept?token=${newToken}`,
      expires_at: expiresIn(72 * 60),
      state: 'pending',
    });

    const eventBus = store.getData<EventBus>(STORE_KEYS.eventBus);
    eventBus?.emit({ event: EVENTS.invitationResent, data: formatInvitation(ws.invitations.get(inv.id)!) });
    const updated = ws.invitations.get(inv.id)!;
    return c.json(formatInvitation(updated));
  });

  app.delete('/user_management/invitations/:id', (c) => {
    const inv = ws.invitations.get(c.req.param('id'));
    if (!inv) throw notFound('Invitation');
    ws.invitations.delete(inv.id);
    return c.body(null, 204);
  });
}
