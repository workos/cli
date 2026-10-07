import { describe, expect, it } from 'vitest';
import { UnauthorizedException } from '@workos-inc/node';
import { DashboardGraphqlError } from './dashboard-graphql.js';
import { WorkOSApiError } from './workos-api.js';
import { DashboardConfigError, isConfigurationUnauthorized } from './configuration-recovery.js';

describe('configuration Unauthorized classification', () => {
  it.each([
    new UnauthorizedException('fake-request-id'),
    new WorkOSApiError('Unauthorized', 401),
    new DashboardConfigError(401),
    new DashboardGraphqlError('Session rejected', 'forbidden', 401),
  ])('accepts typed 401 from each supported transport: %s', (error) => {
    expect(isConfigurationUnauthorized(error)).toBe(true);
  });

  it.each([
    new Error('Unauthorized HTTP 401'),
    { status: 401, message: 'Unauthorized' },
    new WorkOSApiError('Unauthorized', 403),
    new DashboardConfigError(422),
    new DashboardGraphqlError('Unauthorized', 'forbidden', 403),
    new DashboardGraphqlError('Unauthorized', 'network_error'),
    new DashboardGraphqlError('Unauthorized', 'graphql_error'),
  ])('does not infer authentication failure from an untyped message: %s', (error) => {
    expect(isConfigurationUnauthorized(error)).toBe(false);
  });
});
