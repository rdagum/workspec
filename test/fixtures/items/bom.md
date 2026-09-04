---
id: BUG-000110
type: BUG
title: A UTF-8 byte-order mark precedes the opening fence
status: Ready
priority: medium
assignee:
reporter: rdagum
created: 2026-09-04
updated: 2026-09-04
labels:
  - encoding
spec_version: 1.0
description: |
  Saved by an editor that writes a BOM
custom:
  nested: value
---

# Summary

The BOM must be dropped before the front matter is recognised; the item must
parse cleanly and the serialized form must be content-equal.
