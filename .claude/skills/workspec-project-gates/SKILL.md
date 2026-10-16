---
name: workspec-project-gates
description: How this project provisions an isolated worktree and verifies a change — env files, venv, dependency install, service ports, and the full quality gate set. Invoked by the daily-workspec and address-pr-feedback routines; also use when the user asks "how do I run all the tests", "what are the quality gates", or needs a worktree set up to run the app.
allowed-tools: Bash, PowerShell, Read, Glob, Grep
---

# Matchday: Worktree Provisioning and Quality Gates

This is the project-specific half of the WorkSpec routines. The generic process
lives in the personal `daily-workspec` and `address-pr-feedback` skills; every
command below is matchday's own.

## Provisioning a worktree

A worktree is a fresh checkout of tracked files only. Four things it needs are
gitignored or uninstalled, and nothing here runs without them.

**1. The env files — already handled.** [`.worktreeinclude`](../../../.worktreeinclude)
at the repo root copies `.env` and `backend/.env` into every worktree Claude
Code creates. Confirm they arrived; if they did not, the run is blocked:

```bash
test -f .env && test -f backend/.env
```

**2. Its own ports, edited into the worktree's `.env`.** `load_dotenv` does
`set -a; source .env` ([build/project-tools/common.sh:37](../../../build/project-tools/common.sh#L37)),
so an inline `BACKEND_PORT=8100` on the command line is overwritten — the values
must live in the file. Change exactly these four keys and nothing else:

| Key | Value |
| --- | --- |
| `BACKEND_PORT` | `8100` |
| `FRONTEND_PORT` | `3100` |
| `VITE_API_URL` | `http://127.0.0.1:8100/api/v1` |
| `CORS_ORIGINS` | append `,http://localhost:3100,http://127.0.0.1:3100` |

**3. The Python venv, as a junction to the main checkout's.** `PYTHON_VENV` is
derived from `PROJECT_ROOT` unconditionally
([build/console-tools/environment-variables.sh:31](../../../build/console-tools/environment-variables.sh#L31)),
so it cannot be pointed elsewhere with an env var — it has to be a real
directory entry. A junction needs no admin rights:

```powershell
New-Item -ItemType Junction -Path "<worktree>\.venv" -Target "<main checkout>\.venv"
```

Removing the worktree later deletes only the link, never the directory it points
at, so the user's venv is safe. Never `pip install` into it: it is the user's
venv, shared by reference. A genuinely missing Python dependency blocks the run.

**4. `node_modules`, via a real install.**

```bash
npm install
```

**Do not junction `node_modules`.** These are npm workspaces: the root
`node_modules` holds symlinks like `@matchday/shared` that point back at the
*main checkout's* package directories. Reusing it would silently compile the
user's `packages/shared` into the worktree's build — the same class of bug as
reusing a running server. The install is the slow part of a run; accept it.

## Starting services

Needed only for the Robot gates; skip entirely if the change touches no user
journey and no Robot suite will run.

**Always start your own backend and frontend, even when the user's are already
running, and never point the gates at theirs.** A running `uvicorn --reload` or
Vite serves the directory it was launched from — the user's checkout — so its
process does not contain your changes at all. Reusing it would run the Robot
suites against the user's code and report the result as if it had validated
yours: a new endpoint 404s and you burn the retry budget on code that is fine,
or your regression passes because it was never executed. The unit-test and lint
gates are unaffected, because they run from files, not from a server.

`PROJECT_ROOT` is `$(pwd)`-derived, so the worktree's own `./build/run.sh` runs
the worktree's code on the ports set above.

```bash
docker ps --format '{{.Names}}' | grep -q matchday-mysql || ./build/run.sh service:db
mkdir -p .temp
./build/run.sh service:backend  > .temp/agent-backend.log  2>&1 & echo $! > .temp/agent-backend.pid
./build/run.sh service:frontend > .temp/agent-frontend.log 2>&1 & echo $! > .temp/agent-frontend.pid
```

Both are foreground dev processes with **no scripted stop** —
`./build/run.sh service:backend action:stop` deliberately fails with "stop it
with Ctrl+C" ([build/project-tools/services-internal.sh:116](../../../build/project-tools/services-internal.sh#L116)).
Backgrounding them and recording the pids is the only way to shut them down.

Poll until both answer, up to 90s, before running any suite:

```bash
curl -sf --max-time 3 http://127.0.0.1:8100/health
curl -sf --max-time 3 http://localhost:3100
```

If either never comes up, read its log and treat the run as blocked.

**Docker infra is shared and singleton.** The containers use fixed
`container_name`s and fixed host ports, so there is one MySQL on this machine.
If it was already up, leave it up: never run `action:stop` or `compose down`.

## The gates

Run from the worktree root, in order. All must pass.

```bash
./build/test.sh scope:backend
./build/test.sh scope:frontend
./build/test.sh scope:mobile
./build/lint.sh
EXTRA_VARIABLES="APP_URL_API:http://127.0.0.1:8100,APP_URL_WEB:http://localhost:3100" \
  ./build/robot-run.sh suite:api
EXTRA_VARIABLES="APP_URL_API:http://127.0.0.1:8100,APP_URL_WEB:http://localhost:3100" \
  ./build/robot-run.sh suite:ui
```

`EXTRA_VARIABLES` becomes Robot `--variable` flags, which take precedence over
the URLs baked into `automation/robot/settings/`. Without it the suites hit
ports 8000/3000 — the user's servers.

**The Robot wrapper's exit code and its "All tests passed" banner are not
trustworthy.** After each Robot run, read the xunit report and count failures:

```bash
grep -m1 -oE 'tests="[0-9]+" errors="[0-9]+" failures="[0-9]+"' .temp/robot-results/xunit_*.xml
```

`-m1` matters: it takes the root `<testsuite>` aggregate, where the later matches
are per-child-suite subtotals. A non-zero `errors` or `failures` is a failing
gate, whatever the console said. See the `robot-cli` skill for tags, threads and
browser options.

The Robot suites execute raw SQL against the **shared dev database** on 3306
(see `automation/robot/data-files/admin/`). Separate app ports do not isolate
that. Say so in the PR so the user knows test rows may have landed in their dev
data. Backend pytest is unaffected — it has its own DB on 3307.

## Gates that cannot run here

The **mobile** Robot suites (`automation/robot/suites/mobile/`, `suite:mobile`)
need Appium and a dev-client build, and run only on the user's Mac. Write or
extend them when the change affects a mobile user journey, but do not run them —
list the suite files in the PR under "Needs your Mac".

## Release bookkeeping

If any file under `mobile/` changed, increment the patch version in
`mobile/package.json` — the only file carrying it, `1.0.37` becomes `1.0.38` —
as the last commit before the PR.

Touching the Terms of Service, User Agreement or Refund Policy means updating
its "Last Updated" date. Database schema changes need an Alembic migration and a
`seed.json` update.

## Stopping what you started

```bash
kill $(cat .temp/agent-backend.pid)  2>/dev/null
kill $(cat .temp/agent-frontend.pid) 2>/dev/null
```

Leave the docker containers running.
