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
```

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

# 19. Appendix A — Canonical YAML Layout

This appendix will contain a fully populated example of every field in the required order, serving as the reference layout for all templates.

---

# 20. Appendix B — Reserved Fields

This appendix will enumerate reserved keywords, future-proofing guidance, and rules for introducing new metadata without breaking existing implementations.

