# WorkOS API from GitHub Actions with workload identity federation

This example calls the WorkOS API from a GitHub Actions workflow with **no `WORKOS_API_KEY`**. The job asks GitHub for an OIDC ID token, exchanges it at WorkOS for a short-lived access token (the OAuth `urn:ietf:params:oauth:grant-type:jwt-bearer` grant), and uses that token as the Bearer for API calls.

> **The server side isn't deployed yet.** The WorkOS token endpoint for this grant is still being built, behind the `management-api-oauth` feature flag, and there is no production endpoint. This example only works against an environment where that flag is on, with `WORKOS_WIF_TOKEN_URL` pointing at its token endpoint.

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

| Variable                | Value                                                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `WORKOS_CLIENT_ID`      | Client ID of the M2M application from step 3                                                                                          |
| `WORKOS_WIF_TOKEN_URL`  | The token endpoint, shaped like `https://<your AuthKit domain>/oauth2/token`                                                          |
| `WORKOS_API_URL`        | WorkOS API base URL. Leave it unset for `https://api.workos.com`                                                                      |
| `WORKOS_ENVIRONMENT_ID` | The environment the M2M application belongs to (`environment_...`), sent as the `x-url-environment-id` header. Machine tokens need it |

The CLI also reads `WORKOS_WIF_AUDIENCE` (default `https://api.workos.com`) and `WORKOS_WIF_SCOPE` (optional, sent as `scope` only when set). The workflow pins the audience to the default.

## 3. Seed the M2M application and its trust rule in WorkOS

In the WorkOS environment you're testing against:

1. Make sure the **`management-api-oauth`** feature flag is on for the environment. Without it the token endpoint rejects the grant.
2. Create an M2M application. Its client ID is `WORKOS_CLIENT_ID`.
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

## Common errors

| Symptom                                                         | Fix                                                                                                                                                                                                                                      |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `No OIDC token available` / CLI `wif_id_token_unavailable`      | Add `permissions: id-token: write` to the workflow or job.                                                                                                                                                                               |
| CLI `wif_token_url_missing`                                     | Set the `WORKOS_WIF_TOKEN_URL` variable. There is no default until the server side ships.                                                                                                                                                |
| `invalid_grant`                                                 | The trust rule didn't match: check the issuer, the `repository_id` value, and that the run's `ref` (branch) matches the rule. The GitHub token may also have expired.                                                                    |
| `invalid_client`                                                | `WORKOS_CLIENT_ID` isn't the M2M application with the trust rule, or that application is in another environment.                                                                                                                         |
| `invalid_target`                                                | Resource or audience mismatch. The trust rule's audience must be `https://api.workos.com`, the same as `WORKOS_WIF_AUDIENCE`.                                                                                                            |
| `invalid_scope`                                                 | `WORKOS_WIF_SCOPE` asks for a scope the application isn't allowed. Fix or unset it.                                                                                                                                                      |
| `invalid_request`                                               | Malformed request, often a `WORKOS_WIF_TOKEN_URL` that isn't the `/oauth2/token` endpoint.                                                                                                                                               |
| Token exchange fails with HTTP 404, or the response is not JSON | `WORKOS_WIF_TOKEN_URL` is wrong, or the `management-api-oauth` flag is off for the environment.                                                                                                                                          |
| The API returns 401 or 403 after a successful exchange          | Set `WORKOS_ENVIRONMENT_ID` to the M2M application's environment, and check `WORKOS_API_URL` points at the same deployment that issued the token.                                                                                        |
| The CLI job uses an API key instead of WIF                      | `WORKOS_API_KEY` (or `--api-key`) always wins. Remove it from the job's environment.                                                                                                                                                     |
| CLI `wif_unsupported_command`                                   | That command can't use WIF (for example `workos verify-login`, which won't create users when it can't confirm the environment isn't production). Use a sandbox `WORKOS_API_KEY` for that step. `workos migrations` ignores WIF entirely. |
