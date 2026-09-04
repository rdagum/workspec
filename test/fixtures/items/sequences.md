---
id: STORY-000103
type: STORY
title: Block sequences of scalars and of mappings
status: In Progress
priority: high
assignee: rdagum
reporter: rdagum
created: 2026-09-04
updated: 2026-09-04
estimate: 5
labels:
  - architecture
  - testing
parent: EPIC-000001
depends_on:
  - STORY-000101
  - STORY-000102
blocks: []
related:
  - BUG-000001
context:
  - architecture
affected_paths:
  - test/
  - utils/yaml.js
related_files: []
acceptance_criteria:
  - "node --test runs: with zero dependencies"
  - Second criterion with, commas and 'inner quotes'
  - 42
  - true
  -
definition_of_done:
  - Suite passes on a clean checkout
spec_version: 1.0
steps:
  - name: first
    done: true
  - name: second
    done: false
    notes: "trailing: colon"
    tags:
      - alpha
      - beta
  - name: third
    owner:
      team: platform
      handle: rdagum
---

# Summary

Sequences of scalars (strings, numbers, booleans, a null item) and sequences
of mappings with nested sequences and mappings inside the items.
