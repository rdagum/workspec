---
name: workspec-worktrees-cleanup
description: Remove the git worktrees the daily-workspec routine left under .claude/worktrees/ once their workspec pull request has been merged, plus the local workspec/* branches of merged PRs. Never deletes a worktree holding uncommitted or unpushed work. Use when the user asks to "clean up workspec worktrees", "remove merged worktrees", "prune the routine's worktrees", or mentions "/workspec-worktrees-cleanup".
allowed-tools: Bash, PowerShell, Read
---

# Clean Up Merged WorkSpec Worktrees

The `daily-workspec` routine runs each session in its own worktree under
`<repo>/.claude/worktrees/<random-name>/`, and the `address-pr-feedback` routine
reuses them. Desktop rarely deletes these worktrees, so each one keeps its full
`node_modules`, venv and build output. This skill removes the ones whose work is
safely merged.

## Hard rules

- **Never remove a worktree the script marks `KEEP`** unless the user approves
  that specific worktree after seeing what would be lost (step 3).
- **Never touch a `STRAY` directory.** Git does not know about it, so nothing
  proves it is disposable. Report it and leave it.
- **Never delete remote branches.** GitHub owns them. This skill only removes
  local worktrees and local branches.
- **Never remove the worktree you are running in.** Run from the main checkout.
- **Never delete a worktree folder while its `.venv` link is still in it.**
  Every routine worktree's `.venv` is a junction to the main checkout's venv.
  On Windows, `git worktree remove` recurses _through_ junctions and deletes
  the user's real venv contents. Windows PowerShell 5.1's `Remove-Item -Recurse`
  does too. The script unlinks first. When removing anything by hand, run
  `rm <path>/.venv` (no `-r`: it deletes only the link and refuses a real
  folder) before anything else.

## Step 1 — Dry run

From the repository's main checkout (not a worktree):

```bash
bash .claude/skills/workspec-worktrees-cleanup/scripts/scan_worktrees.sh
```

It fetches with `--prune`, reads every workspec PR through `gh`, and prints one
tab-separated line per subject: `VERDICT name branch pr reason`. It changes
nothing.

A worktree is `REMOVE` only when **all** of these hold:

| Check                                                                                                                                                                                                                                      | Why                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| Registered, under `.claude/worktrees/`, not locked, not the current one                                                                                                                                                                    | Scope and safety                                          |
| The routine created it: its name is an item id (how every run names it now), or every session transcript in `~/.claude/projects/<encoded path>/` starts with the `daily-workspec` scheduled-task prompt (older, Desktop-created worktrees) | Your own interactive worktrees are never candidates       |
| Tied to a `workspec/*` PR that is `MERGED`                                                                                                                                                                                                 | The requested condition                                   |
| No uncommitted or untracked (non-ignored) files; every submodule clean with its HEAD on a remote branch                                                                                                                                    | Nothing unsaved is lost                                   |
| HEAD is an ancestor of the merged PR's head, or `git cherry` finds no commit missing from the base                                                                                                                                         | Nothing unpushed is lost. Rebased copies count as merged. |

The script ties a worktree to a PR by the first of these that matches:

- its `workspec/*` branch;
- its HEAD SHA being a PR's head;
- an item id in its HEAD commit message;
- the newest `workspec/*` branch in its reflog.

The reason column says which rule matched.

`BRANCH-DELETE` lines are local `workspec/*` branches not checked out anywhere,
whose PR is merged and whose tip is fully upstream.

## Step 2 — Confirm, then apply

Show the user the dry-run output as a short table grouped by verdict, with the
disk space involved if it is cheap to get (`du -sh` on the `REMOVE` paths). For
every `KEEP`, give the reason.

Removal is not reversible for ignored files: `.env`, installed dependencies and
local databases in the worktree go with it. **Ask before applying** when the user
is present. In an unattended scheduled run, apply without asking. Only `REMOVE`
and `BRANCH-DELETE` rows are acted on, and those checks are built so nothing
unsaved is lost.

```bash
bash .claude/skills/workspec-worktrees-cleanup/scripts/scan_worktrees.sh --apply
```

The script re-runs every check, so it is safe even if something changed since
the dry run. For each worktree it first deletes every symlink and junction
inside it (the `.venv` link, `node_modules` workspace links), leaving their
targets alone. It then runs `git worktree remove --force` and deletes the
worktree's own local branch. If a link cannot be deleted, the worktree is
`FAILED` and git never touches it. Next it deletes the `BRANCH-DELETE` branches
and runs `git worktree prune`. Verdicts come back as `REMOVED`, `FAILED` and
`BRANCH-DELETED`.

Last, it checks every installed package in the main checkout's venv against its
pip `RECORD`. Each package with missing files prints a `VENV-DAMAGED` line.
`pip check` cannot catch this, because the metadata is intact. Any such line
means a removal reached the user's venv: stop and tell the user. The repair is
`pip install --force-reinstall --no-deps <name>==<version>` for each listed
package, then `./build/setup.sh scope:venv`.

`--force` is needed only because git refuses to remove any worktree that has
initialised submodules. The script has already checked cleanliness itself.

## Step 3 — Worktrees kept for uncommitted changes (only if the user asks)

If the user wants a `KEEP … uncommitted changes` worktree gone anyway, show them
the actual content first:

```bash
git -C <path> status --short
git -C <path> diff
```

Name anything that looks like real work, such as edits to `.workspec/items/`,
source files or plans. Tell it apart from provisioning noise, such as a
`package-lock.json` rewritten by `npm install`. Remove it only on explicit
approval for that path, unlinking `.venv` first:

```bash
rm <path>/.venv
git worktree remove --force <path>
```

Never do this for `commit(s) not on origin/…` or `submodule: … unpushed`. Those
hold commits that exist nowhere else. Offer to push them to a branch instead.

## Step 4 — When a removal fails (Windows)

A `FAILED` line almost always means a process still holds a file in the
worktree, typically a dev server, Metro, esbuild or a Python process the routine
started. It can also mean a path longer than Windows allows.

- Find processes whose command line points into the worktree, and stop them only
  if they clearly belong to it:

  ```powershell
  Get-CimInstance Win32_Process |
    Where-Object { $_.CommandLine -like '*\.claude\worktrees\<name>*' } |
    Select-Object ProcessId, Name, CommandLine
  ```

- On `Filename too long`, run `git config --global core.longpaths true` once and
  retry.
- Re-run the scan with `--apply`. It picks up only what is still there.

If the directory is half deleted but still registered, `git worktree prune`
clears the registration once the folder is gone.

Often git deletes the worktree's `.git` file first and then fails on the rest,
typically deep `node_modules` paths. The final `prune` then unregisters it. The
worktree drops out of `git worktree list`, and a rerun reports its folder as
`STRAY`. That folder is no longer a git checkout, and it already passed every
check before removal. Tell the user which folders these are and let them delete
the folders themselves, after unlinking any `.venv` still in them:

```powershell
if ((Get-Item "<full path>\.venv" -ErrorAction SilentlyContinue).LinkType) { cmd /c rmdir "<full path>\.venv" }
Remove-Item -LiteralPath "\\?\<full path>" -Recurse -Force
```

Its `claude/*` branch is also left behind, because the branch is deleted only
after a removal succeeds. Name it so the user can run `git branch -D` on it.

**A failure on a `.venv\Lib\site-packages\…` path is not a long-path nuisance.**
It means the removal went through the junction into the user's venv. Do not
retry. Report the `VENV-DAMAGED` lines, or run the scan with `--apply` to get
them.

## Step 5 — Report

Keep the report to a few lines:

- how many worktrees were removed, with names and PR numbers;
- how many branches were deleted;
- every `KEEP` and `FAILED` with its reason;
- any `STRAY` directories;
- any `VENV-DAMAGED` lines, first and prominently;
- a reminder that the Desktop sessions of removed worktrees should be archived
  in the Desktop app, because they now point at a missing folder.
