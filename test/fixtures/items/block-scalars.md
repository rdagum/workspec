---
id: SPIKE-000105
type: SPIKE
title: Literal block scalars at the top level and nested
status: Done
priority: low
assignee: rdagum
reporter: rdagum
created: 2026-09-04
updated: 2026-09-04
estimate: 1
labels: []
spec_version: 1.0
description: |
  First line
  Second line with: a colon and "quotes"

  Fourth line after a blank line
    Fifth line with extra indentation
  - Sixth line starts with a dash
notes: |
  A single line
custom:
  rationale: |
    Nested under a namespace
    two lines deep
  after: value that follows a nested block
  stripped_nested: |-
    Nested strip block
    without a final newline
stripped: |-
  Strip chomping: no trailing newline

  even after a blank line
trailing: last key after the block scalars
---

# Summary

Literal (`|`) block scalars with blank lines, deeper indentation, and a line
starting with a dash, both at the top level and nested inside a mapping.
