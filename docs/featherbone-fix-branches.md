> Copied from the Featherbone Claude project into the repo on 2026-10-06.
> Update 2026-10-06: the local checkout is now `Documents/featherbone` (a fresh
> clone of `jrogelstad/featherbone`); the old `Documents/Featherbone` folder,
> including `claude-branches/`, was deleted. `fix/test-battery` is merged (PR
> #125), so nothing from that folder needed recovering.

# Featherbone fix branches: how they're delivered, and status

Read this together with `featherbone-review-handover.md`. Started 2026-10-01.

## Delivery: why bundles

- **Pushing from the cloud is blocked.** Cloud sessions can't push to FeatherboneJS/Featherbone because the repo isn't in the session's authorized repository set. Reading the repo works, since it's public.
- **No shell on John's laptop.** Cowork sessions linked to it have no git there.
- **Writing into `.git` is refused.** Writing objects or refs into John's `.git` was blocked by a safety check. Don't try it again.
- **What works:** build each fix as a commit on `fix/<item>` on top of `refactor` in the cloud. Then write a git bundle plus PR text to `Documents/Featherbone/claude-branches/`. John runs `sh claude-branches/fetch-branches.sh --push` and opens the PRs. One branch per plan item.
- **Authorship:** commits are authored as `jrogelstad <john@rogelstad.net>` with a Co-Authored-By Claude trailer.

## Cloud test environment (rebuild notes)

- **Postgres:** the cluster is Postgres 16 (`/usr/lib/postgresql/16/bin`). Run `initdb` as the `postgres` user, auth md5. Because of PG15+ public-schema permissions, before `node install.js` run `ALTER SCHEMA public OWNER TO admin; ALTER DATABASE demo OWNER TO admin; ALTER ROLE admin CREATEDB CREATEROLE`.
- **SupplyChain** is a private repo (`jrogelstad/SupplyChain`). Rebuild it by staging the `.git` pack from `Documents/SupplyChain`. Install `17aabed`, not HEAD `9de2417`: that commit fails with "Relation feather Product required by InventoryValueDetail not found". Install by zipping the folder and POSTing it to `/demo/module/install/x=1` as `admin`/`password`.
- **Job Shop:** without it, five snapshot tests fail (`catalog-routes`, `catalog-settings-definition`, `catalog-workbooks`, `settings-definitions`, `workbooks-catalog`). Never regenerate those from the cloud database.

## Findings

- **John's `demo` grants `everyone` full CRUD** on `role`, `user_account`, `feather`, `script`, `module`, `route`, `form` and others. A fresh install gives read access on `role` only. Flagged to John; not changed.

## Status

| Branch | Plan item | State |
| --- | --- | --- |
| `fix/test-battery` (df4ec01) | Tier 0: battery green after UI refresh and on upgraded DBs | Merged (PR #125, 2026-10-06) |
| | 0.1–0.9, 0.11 | Next, one branch each |
| | 0.10 | SupplyChain repo; later |

## Notes from 2026-10-06 (checkout rebuilt)

- Fresh clone of `jrogelstad/featherbone` at master `920dee6`; `FeatherboneJS/Featherbone` master is the same plus one merge commit (#179). All branches on the org repo (`refactor`, `fresh_ui`, `test_suite`, `fix/test-battery`) are contained in master.
- `package.json` and `package-lock.json` were restored to master after an `npm audit fix --force` style update downgraded `pdfjs` to 0.5.4 (no `pdfjs/font/*`), which stopped the server starting. Do not use `--force` updates.
- `npm run test:unit`: 271 pass, 0 fail, 1 skipped, 16 todo (known defects, tests 0.8 and 0.9 in the plan).
- New default test reporter `test/harness/reporter.js` hides todo tests from the trailing "failing tests" block so the summary is last; `FB_TEST_REPORTER=spec` restores stock output.
- `server/config.json` is local and git-ignored: `clientPort` 3003 (browse `http://localhost:3003/demo/`), and `pgCryptoKey` must match the key `demo` was encrypted with.
