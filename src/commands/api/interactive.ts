import ui from '../../utils/ui.js';
import { loadCatalog, endpointsByTag, type EndpointInfo } from './catalog.js';
import { apiRequest } from './request.js';
import { colorMethod, printResponse } from './format.js';
import { resolveApiKeyAsync, resolveApiBaseUrl } from '../../lib/api-key.js';
import { ExitCode, exitWithCode } from '../../utils/exit-codes.js';
import { exitWithError } from '../../utils/output.js';

function assertNotCanceled<T>(value: T | symbol): T {
  if (ui.isCancel(value)) exitWithCode(ExitCode.CANCELED);
  return value as T;
}

export async function apiInteractive(options?: { apiKey?: string }): Promise<void> {
  const catalog = await loadCatalog();
  const grouped = endpointsByTag(catalog.endpoints);

  const tag = assertNotCanceled(
    await ui.select({
      message: 'Select a category:',
      options: catalog.tags.map((t) => {
        const count = grouped.get(t)?.length ?? 0;
        return { value: t, label: `${t} (${count})` };
      }),
    }),
  );

  const endpoints = grouped.get(tag)!;
  const ep = assertNotCanceled(
    await ui.select<EndpointInfo>({
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
    const value = assertNotCanceled(
      await ui.text({
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
    const requiredParams = ep.queryParams.filter((qp) => qp.required);
    const optionalParams = ep.queryParams.filter((qp) => !qp.required);
    const params: string[] = [];

    for (const qp of requiredParams) {
      const value = assertNotCanceled(
        await ui.text({
          message: `${qp.name} (required):`,
          placeholder: qp.description || undefined,
          validate: (v) => {
            if (!v?.trim()) return `${qp.name} is required`;
          },
        }),
      );
      params.push(`${encodeURIComponent(qp.name)}=${encodeURIComponent(value.trim())}`);
    }

    if (optionalParams.length > 0) {
      const wantsOptional = assertNotCanceled(
        await ui.confirm({
          message: `Add optional query parameters? (${optionalParams.length} available)`,
          initialValue: false,
        }),
      );

      if (wantsOptional) {
        for (const qp of optionalParams) {
          const value = assertNotCanceled(
            await ui.text({
              message: `${qp.name}:`,
              placeholder: qp.description || undefined,
            }),
          );
          const trimmed = value.trim();
          if (trimmed) {
            params.push(`${encodeURIComponent(qp.name)}=${encodeURIComponent(trimmed)}`);
          }
        }
      }
    }

    if (params.length > 0) {
      queryString = `?${params.join('&')}`;
    }
  }

  let body: string | undefined;
  if (ep.hasRequestBody) {
    let collectBody = ep.requestBodyRequired;
    if (!collectBody) {
      collectBody = assertNotCanceled(
        await ui.confirm({
          message: 'Provide a request body?',
          initialValue: ep.method === 'POST' || ep.method === 'PUT',
        }),
      );
    }

    if (collectBody) {
      body = assertNotCanceled(
        await ui.text({
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

  const ok = assertNotCanceled(await ui.confirm({ message: 'Execute this request?' }));
  if (!ok) exitWithCode(ExitCode.CANCELED);

  const response = await apiRequest({
    method: ep.method,
    path: fullPath,
    apiKey: options?.apiKey ?? (await resolveApiKeyAsync()),
    baseUrl: resolveApiBaseUrl(),
    body,
  });

  printResponse(response, { includeStatus: true });

  if (response.status >= 400) {
    exitWithError({
      code: `http_${response.status}`,
      message: `API request failed with status ${response.status}`,
      apiContext: { status: response.status },
    });
  }
}
