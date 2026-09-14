# WorkSpec Specification

**Version:** 1.0.0 (Draft)

**Status:** Draft

**Specification ID:** WS-1.0

---

## Table of Contents

```text
1. Introduction
2. Goals
3. Design Principles
4. Terminology
5. Repository Structure
6. Configuration
7. Work Items
8. Metadata Schema
9. Markdown Body
10. Relationships
11. Workflow
12. Context Documents
13. Templates
14. Local Configuration
15. Reference Implementation Requirements
16. Compatibility
17. Compliance
18. Future Extensions
19. Appendix A - Canonical YAML Layout
20. Appendix B - Reserved Fields
```

---

# 1. Introduction

## 1.1 Purpose

WorkSpec defines a Git-native, implementation-independent specification for managing software development work inside a source code repository.

The specification is designed to satisfy two equally important consumers:

* Human developers
* AI software engineering agents

Unlike traditional issue tracking systems, WorkSpec treats the repository itself as the single source of truth. All work definitions, planning artifacts, project context, and metadata reside within the repository and are versioned alongside the source code.

The specification intentionally separates **data** from **presentation**. A graphical board, IDE extension, command-line interface, or AI assistant are all considered implementations of the same underlying specification.

---

## 1.2 Non-Goals

WorkSpec is **not** intended to define:

* Scrum methodology
* Kanban methodology
* Sprint planning rules
* Velocity calculations
* Time tracking
* Team management
* Authentication
* Cloud synchronization
* Hosted services

Implementations MAY provide these features, but they are outside the scope of the specification.

AI usage accounting (18.2) is not time tracking: it records the resource consumption of automated agents — tokens and their list-price equivalent — never human time.

---

# 2. Goals

A compliant implementation MUST satisfy the following goals.

## G1 — Repository Native

Every artifact required to understand and manage project work MUST exist within the repository.

No database is required.

No external service is required.

---

## G2 — AI First

Every work item MUST expose sufficient structured metadata to allow an AI agent to perform autonomous planning and implementation whenever possible.

---

## G3 — Human Readable

Every work item MUST remain understandable when opened in a standard text editor.

---

## G4 — Portable

Copying the `.workspec` directory into another repository MUST preserve all project planning information.

---

## G5 — Git Friendly

The specification SHOULD minimize merge conflicts.

---

## G6 — Tool Independent

No part of the specification SHALL require:

* a browser
* a server
* Node.js
* a database
* a specific IDE
* a particular AI model

---

# 3. Design Principles

Every future revision of WorkSpec SHOULD preserve these principles.

---

### P1

Git is the source of truth.

---

### P2

Everything important is machine-readable.

---

### P3

Everything useful remains human-readable.

---

### P4

One work item equals one file.

---

### P5

Work items are immutable in identity.

Titles change.

IDs never change.

---

### P6

The specification defines data.

Implementations define presentation.

---

### P7

AI agents are first-class consumers of the specification.

---

# 4. Terminology

## Repository

A Git repository containing a `.workspec` directory.

---

## Project

A repository implementing WorkSpec.

---

## Work Item

A single Markdown document representing one unit of work.

Examples:

* Story
* Epic
* Task
* Bug
* Spike

---

## Context Document

A Markdown document providing reusable project knowledge.

Examples:

* Architecture
* Coding Standards
* Database Design
* API Design
* Deployment

---

## Board

A visualization of work items grouped according to workflow state.

The Board does not own project data.

---

## Implementation

Any software capable of reading and writing WorkSpec repositories.

Examples:

* HTML application
* CLI
* IDE plugin
* AI Agent
* Terminal UI

---

# 5. Repository Structure

Every WorkSpec repository MUST contain:

```text
.workspec/
│
├── config/
│
├── items/
│
├── templates/
│
├── context/
│
├── assets/
│
├── archive/
│
└── board/
```

Additional directories MAY exist.

Unknown directories MUST be ignored.

---

# 6. Configuration

Configuration files reside under:

```text
.workspec/config/
```

Required files:

```text
board.yaml
workflow.yaml
```

Optional:

```text
users.yaml
templates.yaml
id-blocks.yaml   (see 18.1)
ai.yaml          (see 18.2)
```

Unknown configuration files MUST be preserved.

---

# 7. Work Items

Every work item MUST:

* be a Markdown file
* contain YAML front matter
* contain exactly one metadata section
* have exactly one immutable ID

---

## 7.1 Supported Types

Version 1.0 defines:

```text
EPIC

STORY

TASK

BUG

SPIKE
```

Future versions MAY introduce additional types.

---

## 7.2 File Names

Canonical naming:

```text
STORY-000001.md
```

Rules:

* filename MUST equal ID
* filename MUST NOT contain the title
* filename MUST remain immutable
* IDs MUST be zero-padded to six digits
* IDs MUST be unique within a project

---

# 8. Metadata Schema

Every work item MUST contain the following required fields, in this canonical order:

```yaml
id:
type:
title:

status:
priority:

assignee:
reporter:

created:
updated:

estimate:
labels:

parent:
depends_on:
blocks:
related:

context:
affected_paths:
related_files:

acceptance_criteria:
definition_of_done:

spec_version:
```

Implementations SHOULD preserve this order.

Unknown fields MUST NOT be removed.

---

## Required Fields

Required:

```text
id
type
title
status
created
updated
spec_version
```

All others are optional.

---

# 9. Markdown Body

The body begins immediately after the front matter.

Recommended headings:

```markdown
# Summary

# Business Context

# Technical Context

# Requirements

# Implementation Notes

# Risks

# References

# Discussion
```

Implementations MUST NOT depend on these headings.

They exist for humans and AI.

---

# 10. Relationships

Relationships are expressed exclusively through IDs.

Example:

```yaml
depends_on:

- STORY-000051

blocks:

- BUG-000004
```

No filesystem hierarchy shall imply relationships.

---

# 11. Workflow

Workflow is configuration-driven.

Example:

```yaml
columns:

- Backlog
- Ready
- In Progress
- Review
- Done
```

The specification defines no default methodology.

---

# 12. Context Documents

Reusable project documentation resides under:

```text
.workspec/context/
```

Example:

```text
architecture.md

database.md

coding-standards.md

deployment.md
```

Work items reference these by identifier rather than duplicating content.

---

# 13. Templates

Templates reside under:

```text
.workspec/templates/
```

Implementations MAY create work items from templates.

---

# 14. Local Configuration

Local, user-specific configuration SHALL reside in:

```text
.workspec/config/user.local.yaml
```

This file SHOULD be Git ignored.

Example:

```yaml
name:

email:

theme:

default_assignee:

handle:

id_block:
```

`handle` and `id_block` belong to the ID allocation extension (18.1). Because this file is per working copy, it is the natural home for anything that must differ between two clones of the same repository.

---

# 15. Reference Implementation Requirements

Any compliant implementation MUST:

* load repositories
* parse metadata
* preserve Markdown
* preserve unknown fields
* preserve field ordering whenever practical
* write valid UTF-8
* avoid unnecessary formatting changes

---

# 16. Compatibility

Every project MUST declare:

```yaml
spec_version: 1.0
```

Implementations:

MUST reject unsupported major versions.

SHOULD warn about newer minor versions.

---

# 17. Compliance

An implementation is WorkSpec-compliant if it can:

✓ Parse every valid work item

✓ Preserve unknown fields

✓ Preserve Markdown

✓ Validate required metadata

✓ Read configuration

✓ Save without data loss

---

# 18. Future Extensions

Reserved namespaces:

```yaml
extensions:

custom:

agent:
```

Implementations MUST preserve unknown namespaces.

---

## 18.1 ID Allocation Blocks (WS-1.1 extension)

**Status:** optional extension introduced by WorkSpec 1.1. An implementation that ignores it remains 1.0-compliant. A repository that does not declare `id_allocation` behaves exactly as in 1.0.

### Problem

"Next available ID" is computed from the files in one working copy. Two clones that each create an item before synchronising mint the same ID; the merge then either conflicts on the file or, when resolved by taking one side, silently drops an item. The unit that collides is the working copy, not the person: one engineer with two machines collides with themselves.

### Configuration

`board.yaml`:

```yaml
id_allocation:
  strategy: block        # sequential (default) | block
  block_size: 1000       # optional; default 1000
```

Registry of claimed blocks, `.workspec/config/id-blocks.yaml`, committed to Git:

```yaml
blocks:
  - { block: 1, owner: rdagum, label: windows-pc, claimed: 2026-09-04 }
  - { block: 2, owner: rdagum, label: macbook, claimed: 2026-09-04 }
  - { block: 3, owner: claude, label: ci-agent }
```

Per working copy, `.workspec/config/user.local.yaml` (Git-ignored, 14):

```yaml
handle: rdagum
id_block: 2
```

### Rules

* Block *N* covers the numbers *N × block_size + 1* through *(N + 1) × block_size*, for every type. Block 0 is the legacy sequential range; it MUST NOT be claimed and existing items never move.
* Under `strategy: block`, an implementation MUST allocate a new ID only inside the block named by `id_block`, choosing the lowest unused number in it. It MUST refuse to allocate when no block is configured or the block is not in the registry, and MUST NOT allocate outside the block when the block is exhausted; a new block is claimed instead.
* Block numbers in the registry MUST be unique. `owner` is required. `label` names the working copy. `claimed` (YYYY-MM-DD) is optional and lets a validator recognise items that occupied the range before the claim.
* Claiming a block means appending the lowest block number that is neither registered nor populated by existing items, then committing the registry. Two clones that claim concurrently produce a Git conflict on the registry rather than a silent double claim.
* Under `strategy: sequential`, the default, allocation is unchanged from 1.0.
* ID format, uniqueness and immutability (7.2) are unchanged. IDs are no longer globally consecutive, so order by `created`, not by ID.

### Validation

An implementation SHOULD report, when loading a repository: two files declaring the same ID; a filename that does not equal the ID (an error, not a warning); duplicate block numbers in the registry; a local `id_block` that the registry does not contain; and an item inside a claimed block whose `created` date precedes the block's `claimed` date.

### Repair

A duplicate ID that reaches a merge is repaired by renumbering the item on the side that has not reached the main branch; IDs already on the main branch remain immutable. Renumbering renames the file, rewrites `id:` and every reference in `parent`, `depends_on`, `blocks` and `related`, and is committed on its own.

---

## 18.2 AI Usage and Budgets (WS-1.2 extension)

**Status:** optional extension introduced by WorkSpec 1.2. An implementation that ignores it remains 1.0-compliant. A repository in which no item carries `agent.runs` and no `config/ai.yaml` exists behaves exactly as in 1.0. Design rationale: `docs/DESIGN-2026-09-ai-usage.md`.

### Problem

Work items are consumed by AI agents, and every agent session consumes tokens that cost money. Git records who changed what; it does not record what producing the change cost, and the tools that know (session transcripts) are local and short-lived. Usage is therefore data about the work item, not history, and it belongs in the item.

### Data

Inside the reserved `agent` namespace (18) this extension defines two keys, `budget_usd` and `runs`. Every other key under `agent` remains undefined and MUST be preserved and ignored.

```yaml
agent:
  budget_usd: 10
  runs:
    - date: 2026-09-09
      handle: Fable
      model: claude-fable-5-1
      input_tokens: 2
      output_tokens: 8000
      cache_read_tokens: 900000
      cache_write_tokens: 40000
      cache_write_1h_tokens: 12000
      cost_usd: 1.12
      purpose: implement
      ref: https://github.com/rdagum/workspec/pull/12
      session: c08bb153-da05-4380-a295-7b0fd56f92c5
      source: claude-code
      estimated: true
```

* `runs` is a sequence of mappings, one per agent session on the item. `date` (YYYY-MM-DD), `handle` (a `users.yaml` handle) and `model` are required; every other key is optional. Unknown keys inside a run MUST be preserved.
* `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens` (five-minute cache writes) and `cache_write_1h_tokens` (one-hour cache writes) are non-negative integers; an absent key means zero.
* `cost_usd` and `budget_usd` are non-negative decimals in US dollars.
* `session` identifies the producing tool's session and makes imports idempotent. `source` names the tool (`manual` for a hand-written run). `estimated: true` marks approximate or trimmed numbers.

### Configuration

`.workspec/config/ai.yaml`, optional, committed:

```yaml
pricing:                     # list-price equivalents per million tokens
  claude-fable-5-1: { input: 0, output: 0, cache_read: 0, cache_write: 0, cache_write_1h: 0 }
defaults:
  budget_usd: { STORY: 10, BUG: 5, TASK: 3, SPIKE: 5 }
policy:
  require_usage: true
  require_usage_from: Review   # a workflow column; default: the last column
```

Entries in `users.yaml` MAY carry `kind: agent` (and `model`) to distinguish agents from people.

### Rules

* Runs are facts. An implementation MUST append; it MUST NOT edit, reorder or remove existing runs, and MUST NOT change `updated` when appending a run.
* Everything else is derived and MUST NOT be stored. The cost of a run is `cost_usd` when present, otherwise its tokens priced by `pricing[model]`, otherwise unknown. The cost of an item is the sum over its runs, unknown if any run is unknown. The roll-up of an epic is the sum over the items that reach it through `parent`.
* A derived cost is a list-price equivalent, not an invoice.
* The budget of an item is `agent.budget_usd`, else `defaults.budget_usd` for its type, else none. An item whose cost exceeds its budget is over budget. That is a warning for validators and a stop rule for agents (`SKILL.md`), not a repository error.
* Two branches that both append a run to the same item conflict on the same lines; the resolution is to keep both runs. Order is not significant.
* Appending a run SHOULD be a line-level edit that leaves every other line of the file unchanged (15).

### Validation

An implementation SHOULD report as errors: `agent` that is not a mapping, `runs` that is not a sequence, a run that is not a mapping or lacks `date`, `handle` or `model`, a malformed date, and a negative or non-numeric number. It SHOULD report as warnings: a model absent from a non-empty `pricing`, an item over budget, a `handle` not in `users.yaml`, two runs with the same `source`, `session` and `model`, a run dated before the item's `created`, and — when `policy.require_usage` is set — an item assigned to a `kind: agent` user whose status is `require_usage_from` or a later column and which has no `runs` key. `runs: []` satisfies the policy explicitly.

---

# 19. Appendix A — Canonical YAML Layout

This appendix will contain a fully populated example of every field in the required order, serving as the reference layout for all templates.

---

# 20. Appendix B — Reserved Fields

This appendix will enumerate reserved keywords, future-proofing guidance, and rules for introducing new metadata without breaking existing implementations.

Reserved by 18.2 inside the `agent` namespace: `budget_usd` and `runs`; inside a run: `date`, `handle`, `model`, `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens`, `cache_write_1h_tokens`, `cost_usd`, `purpose`, `ref`, `session`, `source`, `estimated`.

