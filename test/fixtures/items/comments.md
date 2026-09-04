---
# Leading comment before the first key
id: TASK-000106
type: TASK
# A comment between two keys
title: Standalone comment lines are skipped without losing neighbours
status: Backlog
priority: medium
assignee:
reporter: rdagum
created: 2026-09-04
updated: 2026-09-04
estimate:
labels:
  # A comment inside a sequence
  - one
  - two
  # A comment at the end of a sequence
depends_on: []
spec_version: 1.0
custom:
  # A comment inside a nested mapping
  key: value
  nested:
    # A comment two levels deep
    deeper: true
# A trailing comment before the closing fence
---

# Summary

Comment lines (full-line `#`) at every nesting level. The engine drops them on
a metadata re-serialize; the round-trip assertion compares with comments
removed from the front matter, and the body must survive untouched, including
this `# hash` in prose and the heading above.
