---
id: STORY-000201
type: STORY
title: 'Single-quoted title that needs no quotes'
status: Ready
priority: medium # trailing comment
assignee: ~
reporter: "rdagum"
created: 2026-10-19
updated: 2026-10-19
labels: [yaml, "flow, quoted", reformat]
depends_on: []
spec_version: 1.0
extensions: { vendor: acme, tier: 2, flags: [x, y] }
custom:
    four_space_indent: true
    wrapped:
        { a: 1,
          b: [p, q] }
steps:
- name: indentless sequence, as PyYAML writes it
  tags:
  - one
  - two
- name: second
---

# Summary

Valid front matter the serializer rewrites in its own layout without changing
any value: quote styles, `~`, a trailing comment, flow sequences and mappings
(one wrapped over several lines), four-space indentation, and indentless
sequences. It must not be flagged lossy, and a save must keep every value.
