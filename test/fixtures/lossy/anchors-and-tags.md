---
id: STORY-000202
type: STORY
title: Anchors, aliases and tags this engine reads as plain text
status: Ready
priority: medium
created: 2026-10-19
updated: 2026-10-19
spec_version: 1.0
owner: &owner rdagum
reviewer: *owner
estimate: !!str 3
---

# Summary

Real YAML gives `&owner`, `*owner` and `!!str` a meaning; this engine keeps
them as strings, and writing those strings back (quoted) would change the
file. The round-trip guard flags the item: raw YAML only, saved verbatim.
