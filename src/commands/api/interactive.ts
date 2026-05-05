import clack from '../../utils/clack.js';
import { loadCatalog, endpointsByTag, type EndpointInfo } from './catalog.js';
import { apiRequest } from './request.js';
import { colorMethod, printResponse } from './format.js';
import { resolveApiKey, resolveApiBaseUrl } from '../../lib/api-key.js';

function assertNotCancelled<T>(value: T | symbol): T {
  if (clack.isCancel(value)) process.exit(0);
  return value as T;
}

export async function apiInteractive(): Promise<void> {
  const catalog = loadCatalog();
  const grouped = endpointsByTag(catalog.endpoints);

  const tag = assertNotCancelled(
    await clack.select({
      message: 'Select a category:',
      options: catalog.tags.map((t) => {
        const count = grouped.get(t)?.length ?? 0;
        return { value: t, label: `${t} (${count})` };
      }),
    }),
  );

  const endpoints = grouped.get(tag)!;
  const ep = assertNotCancelled(
    await clack.select<EndpointInfo>({
      message: 'Select an endpoint:',
      options: endpoints.map((e) => ({
        value: e,
        label: `${colorMethod(e.method).padEnd(18)} ${e.path}`,
        hint: e.summary,
      })),
    }),
  );

  let resolvedPath = ep.path;
  for (const param of ep.pathParams) {
    const value = assertNotCancelled(
      await clack.text({
        message: `${param.name}:`,
        placeholder: param.description || undefined,
        validate: (v) => {
          if (!v?.trim()) return `${param.name} is required`;
        },
      }),
    );
    resolvedPath = resolvedPath.replaceAll(`{${param.name}}`, encodeURIComponent(value.trim()));
  }

  let queryString = '';
  if (ep.queryParams.length > 0) {
    const wantsQuery = assertNotCancelled(
      await clack.confirm({
        message: `Add query parameters? (${ep.queryParams.length} available)`,
        initialValue: false,
      }),
    );

    if (wantsQuery) {
      const params: string[] = [];
      for (const qp of ep.queryParams) {
        const label = qp.required ? `${qp.name} (required):` : `${qp.name}:`;
        const value = assertNotCancelled(
          await clack.text({
            message: label,
            placeholder: qp.description || undefined,
            validate: qp.required
              ? (v) => {
                  if (!v?.trim()) return `${qp.name} is required`;
                }
              : undefined,
          }),
        );
        const trimmed = value.trim();
        if (trimmed) {
          params.push(`${encodeURIComponent(qp.name)}=${encodeURIComponent(trimmed)}`);
        }
      }
      if (params.length > 0) {
        queryString = `?${params.join('&')}`;
      }
    }
  }

  let body: string | undefined;
  if (ep.hasRequestBody) {
    const wantsBody = assertNotCancelled(
      await clack.confirm({
        message: 'Provide a request body?',
        initialValue: ep.method === 'POST' || ep.method === 'PUT',
      }),
    );

    if (wantsBody) {
      body = assertNotCancelled(
        await clack.text({
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
        }),
      ).trim();
    }
  }

  const fullPath = `${resolvedPath}${queryString}`;

  console.log(`\n  ${colorMethod(ep.method)}  ${fullPath}`);
  if (body) {
    console.log(JSON.stringify(JSON.parse(body), null, 2));
  }
  console.log();

  const ok = assertNotCancelled(await clack.confirm({ message: 'Execute this request?' }));
  if (!ok) process.exit(0);

  const response = await apiRequest({
    method: ep.method,
    path: fullPath,
    apiKey: resolveApiKey(),
    baseUrl: resolveApiBaseUrl(),
    body,
  });

  printResponse(response, { includeStatus: true });

  if (response.status >= 400) {
    process.exit(1);
  }
}
