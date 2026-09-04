---
id: TASK-000109
type: TASK
title: "CRLF line endings: every line of this file ends in a carriage return"
status: In Progress
priority: high
assignee: rdagum
reporter: rdagum
created: 2026-09-04
updated: 2026-09-04
estimate: 2
labels:
  - windows
  - line-endings
depends_on: []
spec_version: 1.0
description: |
  A block scalar
  split over two lines
custom:
  nested: value
  list:
    - a
    - b
---

# Summary

Written on Windows with CRLF line endings. Parsing must not leave a stray
carriage return in any value, and the serialized form must be content-equal.

- one
- two
