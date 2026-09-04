---
id: BUG-000104
type: BUG
title: Nested reserved namespaces and unknown fields survive a save
status: Review
priority: critical
assignee: rdagum
reporter: rdagum
created: 2026-09-04
updated: 2026-09-04
estimate: 2
labels:
  - data-safety
spec_version: 1.0
extensions:
  vendor:
    name: acme
    tier: 2
    enabled: true
  flags:
    - beta
    - dark-mode
custom:
  release: 2026.09
  owner:
    team: platform
    contact: "ops: on-call"
    escalation:
      primary: rdagum
      secondary:
agent:
  status: idle
  model: claude-fable-5-1
  history:
    - run: 1
      result: pass
    - run: 2
      result: fail
      note: "flaky: retry"
unknown_top_level: kept as written
---

# Summary

The `extensions`, `custom` and `agent` namespaces nest three levels deep and
mix mappings, sequences, and sequences of mappings. `unknown_top_level` is not
in the spec and must be preserved verbatim.
