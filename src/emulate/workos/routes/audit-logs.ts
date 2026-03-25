import { type RouteContext, notFound, parseJsonBody, validationError } from '../../core/index.js';
import { getWorkOSStore } from '../store.js';
import { formatAuditLogAction, formatAuditLogEvent, formatAuditLogExport, parseListParams } from '../helpers.js';

export function auditLogRoutes(ctx: RouteContext): void {
  const { app, store } = ctx;
  const ws = getWorkOSStore(store);

  // List actions
  app.get('/audit_logs/actions', (c) => {
    const url = new URL(c.req.url);
    const params = parseListParams(url);
    const result = ws.auditLogActions.list({ ...params });
    return c.json({
      object: 'list',
      data: result.data.map(formatAuditLogAction),
      list_metadata: result.list_metadata,
    });
  });

  // Create/update action schema
  app.post('/audit_logs/actions/:actionName/schemas', async (c) => {
    const actionName = c.req.param('actionName');
    const body = await parseJsonBody(c);

    // Upsert: find existing action or create new one
    let action = ws.auditLogActions.findOneBy('name', actionName);
    if (action) {
      // Store schema in store data keyed by action name
      store.setData(`audit_schema_${actionName}`, body);
      return c.json(formatAuditLogAction(action));
    }

    action = ws.auditLogActions.insert({
      object: 'audit_log_action',
      name: actionName,
      description: null,
      condition: null,
    });
    store.setData(`audit_schema_${actionName}`, body);
    return c.json(formatAuditLogAction(action), 201);
  });

  // Create audit log event
  app.post('/audit_logs/events', async (c) => {
    const body = await parseJsonBody(c);
    const organizationId = body.organization_id as string | undefined;
    if (!organizationId) {
      throw validationError('organization_id is required', [{ field: 'organization_id', code: 'required' }]);
    }

    const actionBody = body.action as Record<string, string> | undefined;
    if (!actionBody?.name) {
      throw validationError('action.name is required', [{ field: 'action.name', code: 'required' }]);
    }

    const event = ws.auditLogEvents.insert({
      object: 'audit_log_event',
      organization_id: organizationId,
      action: {
        name: actionBody.name,
        type: actionBody.type ?? 'C',
        id: actionBody.id ?? actionBody.name,
      },
      actor: (body.actor as Record<string, unknown>) ?? {},
      targets: (body.targets as Array<Record<string, unknown>>) ?? [],
      metadata: (body.metadata as Record<string, unknown>) ?? null,
      occurred_at: (body.occurred_at as string) ?? new Date().toISOString(),
    });

    return c.json(formatAuditLogEvent(event), 201);
  });

  // Create export (auto-transition to ready)
  app.post('/audit_logs/exports', async (c) => {
    const body = await parseJsonBody(c);
    const organizationId = body.organization_id as string | undefined;
    if (!organizationId) {
      throw validationError('organization_id is required', [{ field: 'organization_id', code: 'required' }]);
    }

    const exp = ws.auditLogExports.insert({
      object: 'audit_log_export',
      organization_id: organizationId,
      state: 'ready',
      url: `https://emulator.workos.test/exports/audit_log_export_mock.csv`,
      filters: (body.filters as Record<string, unknown>) ?? {},
    });

    return c.json(formatAuditLogExport(exp), 201);
  });

  // Get export
  app.get('/audit_logs/exports/:id', (c) => {
    const exp = ws.auditLogExports.get(c.req.param('id'));
    if (!exp) throw notFound('AuditLogExport');
    return c.json(formatAuditLogExport(exp));
  });

  // Get org audit log configuration
  app.get('/organizations/:id/audit_log_configuration', (c) => {
    const orgId = c.req.param('id');
    return c.json({
      object: 'audit_log_configuration',
      organization_id: orgId,
      enabled: true,
      retention_days: 365,
    });
  });

  // Get org audit logs retention
  app.get('/organizations/:id/audit_logs_retention', (c) => {
    const orgId = c.req.param('id');
    return c.json({
      object: 'audit_logs_retention',
      organization_id: orgId,
      retention_days: 365,
    });
  });
}
