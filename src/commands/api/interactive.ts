/**
 * Interactive API request builder for `workos api` (no args, TTY only).
 *
 * Flow: category → endpoint → path params → body → confirm → execute.
 */

import chalk from 'chalk';
import clack from '../../utils/clack.js';
import { loadCatalog, endpointsByTag, type EndpointInfo } from './catalog.js';
import { apiRequest } from './request.js';
import { colorMethod } from './index.js';
import { resolveApiKey, resolveApiBaseUrl } from '../../lib/api-key.js';
import { isJsonMode, outputJson } from '../../utils/output.js';

export async function apiInteractive(): Promise<void> {
  const catalog = loadCatalog();
  const grouped = endpointsByTag(catalog);

  // 1. Select category
  const tag = await clack.select({
    message: 'Select a category:',
    options: catalog.tags.map((t) => {
      const count = grouped.get(t)?.length ?? 0;
      return { value: t, label: `${t} (${count})` };
    }),
  });

  if (clack.isCancel(tag)) process.exit(0);

  // 2. Select endpoint
  const endpoints = grouped.get(tag as string)!;
  const endpoint = await clack.select<EndpointInfo>({
    message: 'Select an endpoint:',
    options: endpoints.map((e) => ({
      value: e,
      label: `${colorMethod(e.method).padEnd(18)} ${e.path}`,
      hint: e.summary,
    })),
  });

  if (clack.isCancel(endpoint)) process.exit(0);

  const ep = endpoint as EndpointInfo;

  // 3. Fill path parameters
  let resolvedPath = ep.path;
  for (const param of ep.pathParams) {
    const hint = param.description || undefined;
    const value = await clack.text({
      message: `${param.name}:`,
      placeholder: hint,
      validate: (v) => {
        if (!v?.trim()) return `${param.name} is required`;
      },
    });

    if (clack.isCancel(value)) process.exit(0);
    resolvedPath = resolvedPath.replace(`{${param.name}}`, (value as string).trim());
  }

  // 4. Query parameters (optional)
  let queryString = '';
  if (ep.queryParams.length > 0) {
    const wantsQuery = await clack.confirm({
      message: `Add query parameters? (${ep.queryParams.length} available)`,
      initialValue: false,
    });

    if (clack.isCancel(wantsQuery)) process.exit(0);

    if (wantsQuery) {
      const params: string[] = [];
      for (const qp of ep.queryParams) {
        const label = qp.required ? `${qp.name} (required):` : `${qp.name}:`;
        const value = await clack.text({
          message: label,
          placeholder: qp.description || undefined,
          validate: qp.required
            ? (v) => {
                if (!v?.trim()) return `${qp.name} is required`;
              }
            : undefined,
        });

        if (clack.isCancel(value)) process.exit(0);
        const trimmed = (value as string).trim();
        if (trimmed) {
          params.push(`${encodeURIComponent(qp.name)}=${encodeURIComponent(trimmed)}`);
        }
      }
      if (params.length > 0) {
        queryString = `?${params.join('&')}`;
      }
    }
  }

  // 5. Request body
  let body: string | undefined;
  if (ep.hasRequestBody) {
    const wantsBody = await clack.confirm({
      message: 'Provide a request body?',
      initialValue: ep.method === 'POST' || ep.method === 'PUT',
    });

    if (clack.isCancel(wantsBody)) process.exit(0);

    if (wantsBody) {
      const bodyText = await clack.text({
        message: 'Request body (JSON):',
        placeholder: '{"key": "value"}',
        validate: (v) => {
          if (!v?.trim()) return 'Body cannot be empty';
          try {
            JSON.parse(v);
          } catch {
            return 'Invalid JSON';
          }
        },
      });

      if (clack.isCancel(bodyText)) process.exit(0);
      body = (bodyText as string).trim();
    }
  }

  const fullPath = `${resolvedPath}${queryString}`;

  // 6. Confirm
  console.log();
  console.log(`  ${colorMethod(ep.method)}  ${fullPath}`);
  if (body) {
    console.log(chalk.dim(JSON.stringify(JSON.parse(body), null, 2)));
  }
  console.log();

  const ok = await clack.confirm({ message: 'Execute this request?' });
  if (clack.isCancel(ok) || !ok) process.exit(0);

  // 7. Execute
  const apiKey = resolveApiKey();
  const baseUrl = resolveApiBaseUrl();

  const response = await apiRequest({
    method: ep.method,
    path: fullPath,
    apiKey,
    baseUrl,
    body,
  });

  console.log(chalk.dim(`\nHTTP ${response.status}`));

  if (isJsonMode()) {
    outputJson(response.body);
  } else if (typeof response.body === 'object' && response.body !== null) {
    console.log(JSON.stringify(response.body, null, 2));
  } else {
    console.log(response.rawBody);
  }

  if (response.status >= 400) {
    process.exit(1);
  }
}
