---
id: STORY-000102
type: STORY
title: "Quoted scalars: every path the serializer quotes"
status: Ready
priority: medium
assignee: rdagum
reporter: rdagum
created: 2026-09-04
updated: 2026-09-04
estimate:
labels:
  - "yaml: engine"
  - "with: colon"
spec_version: 1.0
empty_string: ""
leading_space: " padded"
trailing_space: "padded "
looks_like_true: "true"
looks_like_false: "false"
looks_like_null: "null"
looks_like_tilde: "~"
looks_like_yes: "yes"
looks_like_no: "no"
looks_like_on: "on"
looks_like_off: "off"
looks_like_int: "42"
leading_zeros: "007"
looks_like_negative: "-1"
starts_with_dash: "- not a list item"
starts_with_hash: "# not a comment"
starts_with_bracket: "[not a flow sequence"
starts_with_brace: "{not a flow mapping}"
starts_with_ampersand: "&anchor"
starts_with_star: "*alias"
starts_with_bang: "!tag"
starts_with_pipe: "| not a block"
starts_with_gt: "> not a folded block"
starts_with_percent: "%directive"
starts_with_at: "@handle"
starts_with_backtick: "`code`"
starts_with_colon: ":colon"
starts_with_question: "?question"
starts_with_comma: ",comma"
starts_with_quote: "'single' inside double"
colon_space: "key: value inside"
space_hash: "value # with a hash"
escaped_quote: "He said: \"hi\""
---

# Summary

Double-quoted values that must stay quoted: empty, padded, reserved leading
characters, booleans/nulls/numbers as strings, and an escaped inner quote.
