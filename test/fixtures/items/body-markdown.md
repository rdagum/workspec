---
id: STORY-000108
type: STORY
title: Markdown body with fences, rules and YAML-looking lines
status: Ready
priority: medium
assignee: rdagum
reporter: rdagum
created: 2026-09-04
updated: 2026-09-04
spec_version: 1.0
---

# Summary

The body must be passed through byte for byte.

---

A horizontal rule above and YAML-looking lines below:

status: Done
id: STORY-999999

```yaml
---
title: front matter inside a code fence
status: In Progress
---
```

- list item
  - nested list item

> quote

| col | col |
|-----|-----|
| a   | b   |
