# Cloudflare Secret Sync Harness Fix

## Purpose / Outcome

Make production Cloudflare secret sync upload only the Worker bindings that are meant to be managed through `wrangler secret bulk`, so deploys stop failing on keys already owned by `apps/api/wrangler.toml [vars]`.

## Scope

- Split the current shared Worker env key list into explicit runtime and Cloudflare-sync lists.
- Update CI/CD to use the Cloudflare-sync list for `wrangler secret bulk`.
- Add a regression test that enforces the boundary between Worker runtime bindings and Wrangler `vars`.

## Non-goals

- Rework the full production environment model.
- Convert `wrangler.toml` to `wrangler.jsonc`.
- Change Worker runtime behavior beyond fixing the broken sync boundary.

## Architecture Impact

This is a harness-only change. It keeps deployment concerns in repo-managed scripts/workflows and makes the Worker config boundary legible:

- `scripts/worker-env-keys.txt` remains the runtime key source for local `.dev.vars`.
- `scripts/worker-cloudflare-sync-keys.txt` becomes the source for keys uploaded through Cloudflare secret bindings.
- CI enforces that secret-sync keys never overlap with Wrangler `vars`.

## Milestones

1. Confirm the failing deploy path and identify the key-source mismatch.
2. Add an execution plan and explicit key lists.
3. Update CI/CD and supporting comments/scripts.
4. Add regression coverage for the key-boundary rules.
5. Run targeted validation and record outcomes.

## Likely Files

- `docs/exec-plans/2026-03-26-cloudflare-secret-sync.md`
- `scripts/worker-env-keys.txt`
- `scripts/worker-cloudflare-sync-keys.txt`
- `.github/workflows/ci-cd.yml`
- `scripts/worker-env-keys.test.ts`

## Commands

```bash
sed -n '1,260p' .github/workflows/ci-cd.yml
sed -n '1,240p' apps/api/wrangler.toml
sed -n '1,220p' scripts/worker-env-keys.txt
bun test scripts/worker-env-keys.test.ts
bun run lint
```

## Acceptance Checks

- `bun test scripts/worker-env-keys.test.ts` passes.
- `scripts/worker-cloudflare-sync-keys.txt` contains no key declared in `apps/api/wrangler.toml [vars]`.
- CI secret sync uses `scripts/worker-cloudflare-sync-keys.txt`, not the local runtime key list.
- `scripts/worker-env-keys.txt` contains only Worker runtime binding keys.

## Progress Log

- 2026-03-26: Confirmed the failing GitHub Actions step uses `scripts/worker-env-keys.txt` to build the `wrangler secret bulk` payload filter.
- 2026-03-26: Confirmed `apps/api/wrangler.toml` declares `API_URL` in `[vars]`, which explains the Cloudflare API rejection when CI tries to upload it as a secret binding.
- 2026-03-26: Split the runtime key list from the Cloudflare sync key list and updated CI to use the sync list for `wrangler secret bulk`.
- 2026-03-26: Added `scripts/worker-env-keys.test.ts` to enforce runtime-key alignment and prevent future `vars`/secret overlap.
- 2026-03-26: Ran `bun test scripts/worker-env-keys.test.ts` successfully.
- 2026-03-26: Inspected the live `amby-api` Worker settings and confirmed stale secrets from the old sync model still exist (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `DATABASE_URL`).

## Surprises / Discoveries

- `scripts/worker-env-keys.txt` included deploy-time credentials (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`) even though its comment said it was derived from Worker runtime bindings.
- The broken behavior lives in the harness, not in application code.
- The Cloudflare credentials available in this session can read Worker settings but could not delete secrets (`10000: Authentication error` on DELETE).

## Decision Log

- Keep the fix narrow and harness-focused instead of changing application runtime code.
- Add a checked-in regression test so the repo enforces the secret/var boundary mechanically.

## Retrospective

- The harness change is complete and verified with a regression test.
- Repo linting could not be rerun here because the available `bunx @biomejs/biome` resolves to `1.8.3`, which rejects the repo's checked-in `biome.json` keys before file-level checks start.
- A one-time production cleanup is still needed for the stale live secrets that the old sync flow uploaded. The repo fix prevents those bindings from being reintroduced.
