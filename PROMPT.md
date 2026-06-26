# PROMPT.md — WorkSpec Reference Implementation

**Version:** 1.0.0
**Goal:** Build a zero-backend, file-based WorkSpec board application

---

# 1. Objective

You are tasked with generating a **fully local, single-folder web application** that implements the WorkSpec specification.

This application is the **reference implementation** of WorkSpec v1.0.

It MUST operate entirely on the local filesystem and MUST NOT require:

* Node.js runtime
* Backend server
* Database
* Build pipeline
* External services

The application MUST open directly in a browser from a local file or static folder.

---

# 2. Core Concept

The application is a **visual editor and navigator for `.workspec/` repositories**.

It allows users to:

* Browse work items
* Edit YAML metadata
* Edit Markdown content
* Move items across workflow states
* Create new items from templates
* Maintain Git-friendly file structure

The application is a **renderer and editor of files**, not a system of record.

---

# 3. System Constraints

The implementation MUST:

## 3.1 Zero backend

* No server code
* No API layer
* No runtime dependencies

## 3.2 File-based operation

All data is stored in:

```text
.workspec/
```

## 3.3 Browser-only execution

The app MUST run in modern browsers using:

* File System Access API (preferred)
* OR folder upload fallback (zip or directory selection)

## 3.4 No build tools

* No React
* No Vue
* No Angular
* No bundlers

Only:

* HTML
* CSS
* Vanilla JavaScript (ES modules allowed)

---

# 4. Required Features

## 4.1 Repository Loading

The application MUST allow the user to:

* Select a `.workspec` folder
* Parse all files under `.workspec/items/`
* Load configuration from `.workspec/config/`

It MUST build an in-memory representation of:

* Work items
* Workflow states
* Metadata schema

---

## 4.2 Board View

The UI MUST display a Kanban-style board:

Columns are defined by:

```yaml
.workspec/config/workflow.yaml
```

Each column contains work items filtered by `status`.

Each item card MUST display:

* ID
* Title
* Type (Epic/Story/Task/Bug/Spike)
* Priority
* Assignee (if present)

---

## 4.3 Work Item Viewer / Editor

Clicking a card opens a split view:

### Left pane:

* YAML metadata editor (structured form OR raw YAML toggle)

### Right pane:

* Markdown editor

Edits MUST:

* auto-save to file
* preserve YAML field order
* preserve unknown fields
* preserve Markdown formatting

---

## 4.4 Create Work Item

User MUST be able to:

* Create new work items
* Select type (Story, Bug, Task, Epic, Spike)
* Apply template from `.workspec/templates/`

The system MUST:

* Generate next available padded ID
* Create file in `.workspec/items/`

---

## 4.5 Drag and Drop

Users MUST be able to:

* Move items between workflow columns

This MUST update:

```yaml
status:
```

in the file.

No other changes are allowed.

---

## 4.6 Search and Filter

The UI MUST support:

* search by ID
* search by title
* filter by:

  * type
  * status
  * assignee
  * labels

---

## 4.7 Context Viewer

The application MUST allow viewing:

```
.workspec/context/*.md
```

These are read-only within the UI.

---

## 4.8 Templates

The system MUST load:

```
.workspec/templates/
```

Each template MUST define:

* default YAML structure
* default Markdown structure

---

## 4.9 Configuration

Load:

```text
.workspec/config/board.yaml
.workspec/config/workflow.yaml
```

These define:

* board name
* columns
* optional UI settings

---

# 5. Data Handling Rules

## 5.1 YAML parsing

The application MUST:

* preserve field order
* preserve unknown fields
* support multiline values
* NOT reorder keys on save

---

## 5.2 File writing rules

When saving:

* only modified file is rewritten
* no batch rewriting
* no normalization unless required

---

## 5.3 ID rules

IDs:

* immutable
* zero-padded (6 digits)
* format: `TYPE-000123`

---

## 5.4 Status rules

Status MUST always match workflow column names exactly.

---

# 6. Architecture Requirements

The application SHOULD be structured as:

```text
/ui
  board.js
  editor.js
  sidebar.js

/core
  parser.js
  filesystem.js
  model.js

/state
  store.js

/utils
  yaml.js
  ids.js
```

No framework abstractions allowed.

---

# 7. File System Abstraction

The system MUST implement an abstraction layer over:

* File System Access API
* fallback file import mode

All file reads/writes MUST go through this layer.

---

# 8. Performance Requirements

The system MUST:

* support at least 2,000 work items
* load initial board in < 1 second for typical repos
* avoid full re-parsing on every edit

---

# 9. UX Requirements

## 9.1 Board UX

* drag and drop support
* column grouping
* smooth updates

## 9.2 Editor UX

* auto-save
* unsaved changes indicator
* toggle YAML/raw view

## 9.3 Navigation

* click item opens editor
* escape closes editor
* keyboard navigation SHOULD be supported

---

# 10. Validation Rules

The system MUST validate:

* YAML syntax correctness
* required fields presence
* valid status values
* valid ID format

Errors MUST be shown in UI.

---

# 11. Error Handling

The system MUST:

* never silently fail
* show file-level errors
* continue loading valid items even if some fail

---

# 12. Security Constraints

* no network requests
* no remote code execution
* no external script loading

---

# 13. Extensibility

The architecture SHOULD allow:

* plugin-like extensions (future)
* additional work item types
* custom metadata fields

Without modifying core logic.

---

# 14. Output Deliverable

The model MUST generate:

```text
index.html
style.css
app.js
/core/*
/ui/*
/utils/*
```

All files MUST be self-contained and runnable.

---

# 15. Non-Goals

The implementation MUST NOT include:

* authentication
* multi-user sync
* cloud storage
* git integration
* CI/CD
* database layer
* server APIs

---

# 16. Core Philosophy

This implementation is:

> A local viewer/editor for a Git-native work specification

NOT:

* a project management SaaS
* a backend system
* a collaboration platform

---

# 17. Final Instruction to Model

Generate a complete working implementation that satisfies this specification.

The output MUST be:

* fully functional
* browser runnable
* file-system based
* minimal but production-quality
* consistent with WorkSpec v1.0

---

