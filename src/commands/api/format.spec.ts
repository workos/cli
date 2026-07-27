import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import chalk from 'chalk';
import { colorMethod, printResponse } from './format.js';
import { setOutputMode } from '../../utils/output.js';
import type { ApiResponse } from './request.js';

const previousChalkLevel = chalk.level;

function buildResponse(overrides: Partial<ApiResponse> = {}): ApiResponse {
  const headers = new Headers();
  headers.set('content-type', 'application/json');
  return {
    status: 200,
    headers,
    body: { ok: true },
    rawBody: '{"ok":true}',
    ...overrides,
  };
}

describe('colorMethod', () => {
  beforeEach(() => {
    chalk.level = 1;
  });

  afterEach(() => {
    chalk.level = previousChalkLevel;
  });

  it('returns the method string regardless of color level', () => {
    chalk.level = 0;
    expect(colorMethod('GET')).toBe('GET');
    expect(colorMethod('POST')).toBe('POST');
    expect(colorMethod('PUT')).toBe('PUT');
    expect(colorMethod('PATCH')).toBe('PATCH');
    expect(colorMethod('DELETE')).toBe('DELETE');
    expect(colorMethod('OPTIONS')).toBe('OPTIONS');
  });

  it('matches chalk color helpers when colors are enabled', () => {
    expect(colorMethod('GET')).toBe(chalk.green('GET'));
    expect(colorMethod('POST')).toBe(chalk.blue('POST'));
    expect(colorMethod('PUT')).toBe(chalk.yellow('PUT'));
    expect(colorMethod('PATCH')).toBe(chalk.yellow('PATCH'));
    expect(colorMethod('DELETE')).toBe(chalk.red('DELETE'));
  });

  it('passes through unknown verbs unchanged', () => {
    expect(colorMethod('TRACE')).toBe('TRACE');
  });
});

describe('printResponse', () => {
  let consoleOutput: string[];

  beforeEach(() => {
    consoleOutput = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      consoleOutput.push(args.map(String).join(' '));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setOutputMode('human');
  });

  it('prints a pretty JSON body in human mode', () => {
    setOutputMode('human');
    printResponse(buildResponse({ body: { ok: true, count: 2 } }));
    expect(consoleOutput.some((l) => l.includes('"ok": true'))).toBe(true);
    expect(consoleOutput.some((l) => l.includes('"count": 2'))).toBe(true);
  });

  it('prints raw body when human mode receives a non-object body', () => {
    setOutputMode('human');
    printResponse(buildResponse({ body: 'plain text', rawBody: 'plain text' }));
    expect(consoleOutput).toContain('plain text');
  });

  it('prints status and headers when includeStatus is true in human mode', () => {
    setOutputMode('human');
    const headers = new Headers({ 'x-request-id': 'abc' });
    printResponse(buildResponse({ status: 201, headers }), { includeStatus: true });
    const joined = consoleOutput.join('\n');
    expect(joined).toContain('HTTP 201');
    expect(joined).toContain('x-request-id: abc');
  });

  it('emits a single JSON line in JSON mode', () => {
    setOutputMode('json');
    printResponse(buildResponse({ body: { ok: true } }));
    expect(consoleOutput).toEqual([JSON.stringify({ ok: true })]);
  });

  it('emits a single structured JSON line in JSON mode when includeStatus is true', () => {
    setOutputMode('json');
    const headers = new Headers({ 'x-request-id': 'abc' });
    printResponse(buildResponse({ status: 201, headers, body: { ok: true } }), { includeStatus: true });

    expect(consoleOutput).toHaveLength(1);
    const parsed = JSON.parse(consoleOutput[0]!) as {
      status: number;
      headers: Record<string, string>;
      body: { ok: boolean };
    };
    expect(parsed.status).toBe(201);
    expect(parsed.headers['x-request-id']).toBe('abc');
    expect(parsed.body).toEqual({ ok: true });
  });

  it('does not emit any human-readable status/header lines in JSON mode', () => {
    setOutputMode('json');
    const headers = new Headers({ 'x-request-id': 'abc' });
    printResponse(buildResponse({ status: 201, headers, body: { ok: true } }), { includeStatus: true });

    for (const line of consoleOutput) {
      expect(line).not.toMatch(/^HTTP \d/);
      expect(line).not.toMatch(/^x-request-id:/);
    }
  });
});
