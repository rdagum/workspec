---
id: STORY-000105
type: STORY
title: AI usage runs under the agent namespace survive a save
status: Review
priority: high
assignee: Fable
reporter: rdagum
created: 2026-09-09
updated: 2026-09-12
labels:
  - ai-usage
spec_version: 1.0
agent:
  budget_usd: 7.5
  runs:
    - date: 2026-09-10
      handle: Fable
      model: claude-fable-5-1
      input_tokens: 2
      output_tokens: 8000
      cache_read_tokens: 900000
      cache_write_tokens: 40000
      cache_write_1h_tokens: 12000
      purpose: implement
      ref: https://github.com/rdagum/workspec/pull/12
      session: c08bb153-da05-4380-a295-7b0fd56f92c5
      source: claude-code
    - date: 2026-09-12
      handle: rdagum
      model: claude-sonnet-5
      output_tokens: 1500
      cost_usd: 1.12
      purpose: review
      source: manual
      estimated: true
  status: idle
---

# Summary

Two runs (SPEC.md 18.2): one imported from a transcript with every token kind,
one recorded by hand with a decimal `cost_usd`, which the YAML engine keeps as
the string `1.12`. `agent.status` is not defined by the extension and must be
preserved untouched.
