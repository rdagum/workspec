---
id: STORY-000203
type: STORY
title: A folded block scalar
status: Ready
created: 2026-10-19
updated: 2026-10-19
spec_version: 1.0
description: >
  Folded text is joined
  into one line on read,

  and the serializer never writes ">" back.
legacy_id: 0042
---

# Summary

A `>` block is never written back folded, and `0042` would be saved as `42`.
Either is enough for the round-trip guard to flag the item.
