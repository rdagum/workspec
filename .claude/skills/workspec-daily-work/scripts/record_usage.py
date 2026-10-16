#!/usr/bin/env python3
"""Record this Claude Code session's token usage on a WorkSpec item.

Implements the WorkSpec "Tracking AI usage" convention
(https://github.com/rdagum/workspec#tracking-ai-usage): one ``agent.runs``
entry per model that produced output in the session, with tokens by kind.
The main transcript and every subagent transcript of the session are summed
separately per model, so an orchestrating Fable run and the Opus subagent it
delegated to appear as two runs.

Usage:
    record_usage.py <item-file> [--session <uuid>] [--cwd <dir>] [--dry-run]

The session uuid is the directory name that precedes ``scratchpad`` in the
session's scratchpad path (``.../<uuid>/scratchpad``). When omitted, the most
recently modified transcript under the project's transcript directory is used.

Runs for the same session and model are replaced, not duplicated, so the
script can be re-run at the end of a session to finalise the totals; runs from
other sessions are never touched. ``updated`` is not bumped, as the spec
requires.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

HANDLES = {"fable": "Fable", "opus": "Opus", "sonnet": "Sonnet", "haiku": "Haiku"}
RUN_KEYS = (
    "date",
    "handle",
    "model",
    "input_tokens",
    "output_tokens",
    "cache_read_tokens",
    "cache_write_tokens",
    "session",
    "source",
)


def encode_cwd(cwd: str) -> str:
    """Claude Code's transcript directory name for a working directory."""
    return re.sub(r"[:\\/.]", "-", cwd)


def transcript_dir(cwd: str) -> Path:
    return Path.home() / ".claude" / "projects" / encode_cwd(cwd)


def locate_session(tdir: Path, session: str) -> Path:
    """The transcript folder holding ``session``.

    A session that moved into a worktree mid-run (EnterWorktree) keeps its
    transcript under the folder it started in, so fall back to searching every
    project folder.
    """
    if (tdir / f"{session}.jsonl").exists():
        return tdir
    for found in tdir.parent.glob(f"*/{session}.jsonl"):
        return found.parent
    sys.exit(f"no transcript {tdir / (session + '.jsonl')}")


def find_session(tdir: Path, session: str | None) -> str:
    if session:
        return session
    candidates = sorted(tdir.glob("*.jsonl"), key=lambda p: p.stat().st_mtime, reverse=True)
    if not candidates:
        sys.exit(f"no transcripts under {tdir}")
    return candidates[0].stem


def sum_usage(files: list[Path]) -> dict[str, Counter]:
    totals: dict[str, Counter] = defaultdict(Counter)
    for f in files:
        for line in f.read_text(encoding="utf-8", errors="ignore").splitlines():
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            if obj.get("type") != "assistant":
                continue
            msg = obj.get("message") or {}
            usage = msg.get("usage")
            if not usage:
                continue
            c = totals[msg.get("model", "unknown")]
            c["input_tokens"] += usage.get("input_tokens", 0)
            c["output_tokens"] += usage.get("output_tokens", 0)
            c["cache_read_tokens"] += usage.get("cache_read_input_tokens", 0)
            c["cache_write_tokens"] += usage.get("cache_creation_input_tokens", 0)
    return totals


def handle_for(model: str) -> str:
    for key, handle in HANDLES.items():
        if key in model:
            return handle
    return model


def build_runs(totals: dict[str, Counter], session: str) -> list[dict]:
    runs = []
    for model, c in sorted(totals.items()):
        if not any(c.values()):
            continue
        runs.append(
            {
                "date": date.today().isoformat(),
                "handle": handle_for(model),
                "model": model,
                "input_tokens": c["input_tokens"],
                "output_tokens": c["output_tokens"],
                "cache_read_tokens": c["cache_read_tokens"],
                "cache_write_tokens": c["cache_write_tokens"],
                "session": session,
                "source": "claude-code",
            }
        )
    return runs


def render_run(run: dict) -> str:
    lines = []
    for i, key in enumerate(RUN_KEYS):
        prefix = "    - " if i == 0 else "      "
        lines.append(f"{prefix}{key}: {run[key]}")
    return "\n".join(lines)


RUN_BLOCK = re.compile(r"^    - date: .*?(?=^    - date: |^\S|\Z)", re.M | re.S)


def parse_existing_runs(agent_block: str) -> list[dict]:
    runs = []
    for m in RUN_BLOCK.finditer(agent_block):
        run: dict = {}
        for line in m.group(0).splitlines():
            key, _, value = line.strip().lstrip("- ").partition(": ")
            if key in RUN_KEYS:
                run[key] = int(value) if key.endswith("_tokens") else value
        if run:
            runs.append(run)
    return runs


def splice(item_text: str, new_runs: list[dict], session: str) -> str:
    front_end = item_text.find("\n---", 4)
    if not item_text.startswith("---") or front_end < 0:
        sys.exit("item has no YAML front matter")
    front, rest = item_text[: front_end + 1], item_text[front_end + 1 :]

    agent_match = re.search(r"^agent:\n(?:[ \t].*\n?)*", front, re.M)
    budget_line = ""
    existing: list[dict] = []
    if agent_match:
        block = agent_match.group(0)
        b = re.search(r"^  budget_usd: .*$", block, re.M)
        if b:
            budget_line = b.group(0) + "\n"
        existing = parse_existing_runs(block)
        front = front[: agent_match.start()] + front[agent_match.end() :]

    kept = [
        r
        for r in existing
        if not (r.get("session") == session and r.get("model") in {n["model"] for n in new_runs})
    ]
    runs = kept + new_runs
    agent_block = (
        "agent:\n" + budget_line + "  runs:\n" + "\n".join(render_run(r) for r in runs) + "\n"
    )

    spec = re.search(r"^spec_version: .*$", front, re.M)
    if spec:
        front = front[: spec.start()] + agent_block + front[spec.start() :]
    else:
        front = front.rstrip("\n") + "\n" + agent_block
    return front + rest


def main() -> None:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("item", type=Path)
    ap.add_argument("--session", help="session uuid (defaults to the newest transcript)")
    ap.add_argument("--cwd", default=str(Path.cwd()), help="working directory the session runs in")
    ap.add_argument("--dry-run", action="store_true", help="print the runs, do not write the item")
    args = ap.parse_args()

    tdir = transcript_dir(args.cwd)
    session = find_session(tdir, args.session)
    tdir = locate_session(tdir, session)
    files = [
        tdir / f"{session}.jsonl",
        *sorted((tdir / session / "subagents").glob("agent-*.jsonl")),
    ]
    runs = build_runs(sum_usage([f for f in files if f.exists()]), session)
    if not runs:
        sys.exit(f"no assistant usage found in {files[0]}")

    for run in runs:
        print(render_run(run))
    if args.dry_run:
        return
    text = args.item.read_text(encoding="utf-8")
    args.item.write_text(splice(text, runs, session), encoding="utf-8", newline="\n")
    print(f"recorded {len(runs)} run(s) on {args.item}")


if __name__ == "__main__":
    main()
