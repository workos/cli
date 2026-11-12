# WorkOS API from GitHub Actions with workload identity federation

This example calls the WorkOS API from a GitHub Actions workflow with **no `WORKOS_API_KEY`**. The job asks GitHub for an OIDC ID token, exchanges it at WorkOS for a short-lived access token (the OAuth `urn:ietf:params:oauth:grant-type:jwt-bearer` grant), and uses that token as the Bearer for API calls.

> **The server side isn't deployed yet.** The WorkOS token endpoint for this grant is still being built, behind the `workos-api-workload-identity` and `management-api-oauth` team feature flags, and there is no production endpoint. This example only works for a team that has those flags on, with `WORKOS_WIF_TOKEN_URL` pointing at its token endpoint.

[`.github/workflows/wif-test.yml`](.github/workflows/wif-test.yml) has two jobs that do the same thing:

- **`curl`**: plain bash and curl. It requests the OIDC token, does the exchange, runs `GET /organizations`, creates an organization with `POST /organizations` named `wif-test-<run id>`, and checks that the new organization is listed.
- **`cli`**: the same through the `workos` CLI (`workos api ...`). The CLI does the exchange itself when it runs in GitHub Actions with `WORKOS_CLIENT_ID` set and no API key. It names its organization `wif-test-<run id>-cli`.

Neither job prints a token. Both tokens are masked with `::add-mask::`, nothing uses `set -x`, and the curl job keeps the access token in shell memory instead of writing it to `GITHUB_ENV`.

## 1. Create a test repository

Create a new repository (a private one is fine) and copy the workflow into it:

```bash
mkdir -p .github/workflows
cp path/to/workos-cli/examples/wif-github-actions/.github/workflows/wif-test.yml .github/workflows/
git add .github/workflows/wif-test.yml
git commit -m "Add WorkOS WIF test workflow"
git push
```

The workflow runs only when you start it (`workflow_dispatch`). It needs `permissions: id-token: write` (already set) so GitHub hands the job an OIDC token, and `contents: read`.

## 2. Set the repository variables

Under **Settings → Secrets and variables → Actions → Variables**, add these as **variables**, not secrets. None of them is a credential:

| Variable                | Value                                                                                                                                                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `WORKOS_CLIENT_ID`      | Client ID of the M2M application from step 3                                                                                                                                                                             |
| `WORKOS_WIF_TOKEN_URL`  | The token endpoint, shaped like `https://<your AuthKit domain>/oauth2/token`                                                                                                                                             |
| `WORKOS_API_URL`        | WorkOS API base URL. Leave it unset for `https://api.workos.com`                                                                                                                                                         |
| `WORKOS_ENVIRONMENT_ID` | Optional. The M2M application is bound to one environment and its tokens act on that environment. When set (`environment_...`), the value is sent as the `x-url-environment-id` header and must be that same environment |

The CLI also reads `WORKOS_WIF_AUDIENCE` (default `https://api.workos.com`) and `WORKOS_WIF_SCOPE` (optional, sent as `scope` only when set). The workflow pins the audience to the default.

## 3. Seed the M2M application and its trust rule in WorkOS

In the WorkOS environment you're testing against:

1. Make sure the **`workos-api-workload-identity`** and **`management-api-oauth`** feature flags are on for the team. Without them the token endpoint rejects the grant with `unauthorized_client`.
2. Create an M2M application bound to the environment you want the workflow to act on. Its client ID is `WORKOS_CLIENT_ID`. Production environments are refused for now, so use a sandbox or staging environment.
3. Add a GitHub trust rule to the application:
   - **Issuer:** `https://token.actions.githubusercontent.com`
   - **Audience:** `https://api.workos.com`. It must match the `audience` the job requests (`WORKOS_WIF_AUDIENCE`).
   - **Claims:** `repository_id` set to your test repository's numeric ID, and `ref` set to the branch you'll run from, such as `refs/heads/main`.

To find the repository ID, run `gh api repos/<owner>/<repo> --jq .id`. Use `repository_id` rather than the repository name, because the name can be renamed or reused.

## 4. Run the workflow

Go to **Actions → WorkOS WIF test → Run workflow** and pick the branch named in the trust rule's `ref` claim.

The `cli` job takes an optional `cli_ref` input:

- **Empty (default):** installs the published `workos` package with `oven-sh/setup-bun` and `bun add --global workos@latest`. WIF support isn't in a published release yet, so until it is, use `cli_ref`.
- **A workos/cli branch, tag or SHA:** checks that ref out, runs `bun install --frozen-lockfile`, and puts a `workos` wrapper on `PATH` that runs `bun src/bin.ts` from source.

## 5. What success looks like

Both jobs go green.

- The **curl** job log shows the masked token steps, an organization count from `GET /organizations`, the `{ id, name }` of the new `wif-test-<run id>` organization, and finally `Created and listed wif-test-<run id> (org_...) with a WIF access token.`
- The **cli** job shows the same for `wif-test-<run id>-cli` and ends with `... through the CLI with no WORKOS_API_KEY.`

Both new organizations show up in the WorkOS dashboard for that environment. Delete them when you're done.

## Retries

The CLI retries on its own, within limits:

- **Token exchange:** if the token endpoint can't be reached or answers 5xx, the CLI tries up to three times in total, waiting 0.5 s and then 1 s. Each attempt requests a new GitHub OIDC token, because WorkOS accepts each one only once. A 4xx answer (`invalid_grant`, `invalid_client`, ...) is never retried: fix the configuration and re-run.
- **API calls:** the access token is exchanged again shortly before it expires. If the API still answers 401, the CLI exchanges once more and re-sends that request once. A second 401 is reported as is.

The `curl` job does not retry.

## Common errors

| Symptom                                                         | Fix                                                                                                                                                                                                                                                        |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `No OIDC token available` / CLI `wif_id_token_unavailable`      | Add `permissions: id-token: write` to the workflow or job.                                                                                                                                                                                                 |
| CLI `wif_token_url_missing`                                     | Set the `WORKOS_WIF_TOKEN_URL` variable. There is no default until the server side ships.                                                                                                                                                                  |
| `invalid_grant`                                                 | No trust rule matched: check the issuer, the `repository_id` value, the audience, that the run's `ref` (branch) matches the rule, and that the rule is enabled. The GitHub token may also have expired or been used already; re-run the job.               |
| `invalid_client`                                                | `WORKOS_CLIENT_ID` isn't the M2M application with the trust rule, or `WORKOS_WIF_TOKEN_URL` belongs to a different WorkOS environment than that application.                                                                                               |
| `unauthorized_client`                                           | The client can't use workload identity federation. Check that it is an M2M application with an enabled GitHub trust rule, that the feature flags from step 3 are on for the team, and that the application targets a non-production environment.           |
| `invalid_target`                                                | Resource or audience mismatch. The trust rule's audience must be `https://api.workos.com`, the same as `WORKOS_WIF_AUDIENCE`.                                                                                                                              |
| `invalid_scope`                                                 | `WORKOS_WIF_SCOPE` asks for a scope the application may not be granted. Set it to scopes the application has, or unset it to get the application's default scopes.                                                                                         |
| `invalid_request`                                               | Malformed request, often a `WORKOS_WIF_TOKEN_URL` that isn't the `/oauth2/token` endpoint.                                                                                                                                                                 |
| Token exchange fails with HTTP 404, or the response is not JSON | `WORKOS_WIF_TOKEN_URL` is wrong. It must be the `/oauth2/token` endpoint of your WorkOS environment.                                                                                                                                                       |
| CLI `wif_exchange_failed` ending in `Gave up after 3 attempts`  | The token endpoint was unreachable or answered 5xx three times in a row. Re-run the job, and check `WORKOS_WIF_TOKEN_URL` if it keeps happening.                                                                                                           |
| The API returns 401 after a successful exchange                 | The CLI already exchanged again and re-sent the request once. Check that `WORKOS_API_URL` points at the same deployment that issued the token, and that `WORKOS_ENVIRONMENT_ID`, if set, is the environment the M2M application is bound to (or unset it). |
| The API returns 403 after a successful exchange                 | The token doesn't carry the scope that endpoint needs. Grant the scope to the M2M application, and include it in `WORKOS_WIF_SCOPE` if you set that variable.                                                                                              |
| The CLI job uses an API key instead of WIF                      | `WORKOS_API_KEY` (or `--api-key`) always wins. Remove it from the job's environment.                                                                                                                                                                       |
| CLI `wif_unsupported_command`                                   | That command can't use WIF (for example `workos verify-login`, which won't create users when it can't confirm the environment isn't production). Use a sandbox `WORKOS_API_KEY` for that step. `workos migrations` ignores WIF entirely.                   |
