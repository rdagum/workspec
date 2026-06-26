# WorkSpec AI Skill

Version: 1.0

## Purpose

This document teaches AI software engineering agents how to work with repositories that implement the WorkSpec specification.

This document complements, but does not replace, `SPEC.md`.

Whenever this document conflicts with `SPEC.md`, `SPEC.md` takes precedence.

---

# Primary Objectives

Your objectives, in priority order, are:

1. Understand the requested work.
2. Minimize unnecessary repository changes.
3. Produce correct implementations.
4. Preserve repository consistency.
5. Preserve WorkSpec compliance.

---

# Initialization

When beginning work inside a repository:

1. Locate the repository root.
2. Locate `.workspec/`.
3. Read `.workspec/config/board.yaml`.
4. Verify `spec_version`.
5. Read `SPEC.md`.
6. Continue only if the specification version is supported.

If the specification version is unsupported, stop and explain why.

---

# Repository Rules

Treat Git as the source of truth.

Do not create databases.

Do not create hidden caches.

Do not create temporary metadata files unless explicitly requested.

All permanent project information belongs inside `.workspec`.

---

# Locating Work

When asked to work on an item:

Example:

> Implement STORY-000123

Locate:

```text
.workspec/items/STORY-000123.md
```

Do not search by title unless an ID cannot be determined.

If multiple items match the user's request, ask for clarification.

---

# Reading a Work Item

Always read the entire work item.

Process it in this order:

1. YAML front matter
2. Markdown body
3. Referenced context documents
4. Related work items (only if necessary)

Do not ignore the Markdown body.

The YAML defines structured requirements.

The Markdown provides reasoning and context.

Both are important.

---

# Loading Context

If a work item references context documents:

```yaml
context:
  - architecture
  - authentication
```

Load those documents before planning implementation.

Context documents are considered authoritative project guidance.

Do not duplicate their contents into the work item.

---

# Understanding Relationships

Before implementation, inspect:

* depends_on
* blocks
* related
* parent

If unresolved dependencies prevent implementation, explain why before making changes.

Do not silently ignore dependencies.

---

# Planning

Before writing code:

1. Understand the requirements.
2. Understand the affected areas.
3. Identify impacted files.
4. Verify assumptions.
5. Produce an implementation plan.

For complex work, present the plan to the user before implementation unless they explicitly requested autonomous execution.

---

# Implementation

While implementing:

Modify only files required for the requested work.

Avoid unrelated refactoring.

Avoid opportunistic cleanup.

Avoid formatting unrelated files.

Keep commits focused.

Prefer small, reviewable changes.

---

# Definition of Done

Treat the following as completion criteria:

1. Acceptance criteria are satisfied.
2. Definition of Done is satisfied.
3. Validation succeeds.
4. Repository remains consistent.

Do not mark work complete if these conditions are not met.

---

# Updating Work Items

When work begins:

Update:

* status
* assignee (if appropriate)
* updated

When work completes:

Update:

* status
* updated

Do not modify:

* id
* created
* type

unless explicitly instructed.

---

# Metadata Rules

Preserve:

* field ordering
* unknown fields
* comments whenever practical
* Markdown formatting

Do not reorder YAML fields.

Do not remove unknown metadata.

Unknown fields may be used by other tools.

---

# Markdown Rules

Do not rewrite Markdown simply because you can improve wording.

Only modify Markdown when:

* the user requests it
* documentation must be updated
* implementation notes need to be added

Preserve existing structure whenever possible.

---

# Context Usage

Context documents exist to avoid duplication.

Prefer referencing existing context over copying information into work items.

If project-wide knowledge changes, update the context document instead of every work item.

---

# Minimal Change Principle

Always attempt to solve the requested problem with the smallest reasonable change.

Smaller changes are easier to review, test, and merge.

---

# Git Philosophy

Git already records:

* history
* authorship
* timestamps
* diffs

Do not create additional history logs inside WorkSpec.

Do not maintain changelog metadata inside work items.

---

# Creating New Work Items

When creating a work item:

1. Use the appropriate template.
2. Generate the next available ID.
3. Preserve canonical metadata ordering.
4. Initialize required fields.
5. Save using the canonical filename.

Example:

```text
STORY-000124.md
```

---

# Error Handling

Stop and ask for clarification when:

* requirements conflict
* acceptance criteria are ambiguous
* dependencies are missing
* repository structure violates the specification
* requested work cannot be completed safely

Do not invent missing requirements.

---

# Communication

Explain important technical decisions.

State assumptions explicitly.

Identify risks.

Distinguish facts from assumptions.

When uncertain, ask instead of guessing.

---

# Behavior to Avoid

Do not:

* renumber work items
* rename IDs
* rewrite unrelated files
* modify unrelated work items
* remove unknown metadata
* ignore acceptance criteria
* ignore Definition of Done
* bypass repository conventions

---

# Completion Checklist

Before considering work complete, verify:

* The correct work item was used.
* Context documents were consulted.
* Dependencies were respected.
* Acceptance criteria are satisfied.
* Definition of Done is satisfied.
* Validation completed successfully.
* Metadata was updated.
* Unrelated files were not modified.
* WorkSpec compliance was preserved.

Only after all applicable checks pass should the work be considered complete.
