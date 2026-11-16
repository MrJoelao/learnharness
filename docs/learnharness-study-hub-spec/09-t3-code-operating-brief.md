# 09 — T3 Code operating brief

Use this brief as the initial instruction for T3 Code. Keep the specification files available in the repository or attach this package to the coding session.

---

You are implementing the LearnHarness Study Hub and Workspace system described in this documentation package.

## Mandatory first action

Do not start coding immediately.

Read all documents in this package, then inspect the current repository branch. Verify the exact implementation and tests before proposing changes.

Start with Phase 0 from `07-implementation-plan.md`. Produce a concise reconnaissance report covering:
1. Current chat organization types, action parser, validators and all consumers.
2. Every route/API caller that reads or changes organization.
3. Folder empty/delete/archive/restore/reorder/move behavior.
4. Sidebar and archive row rendering, drag/drop and context menus.
5. Plugin API registration and frontend/backend lifecycle.
6. Plugin data path and workspace persistence conventions.
7. Event invalidation and test coverage.
8. The smallest compatible design for the common mixed directory.

Do not modify source files in Phase 0.

## Non-negotiable rules

- Chats and workspaces are peers in one mixed sidebar tree.
- Do not create a separate workspace section.
- Study Hub is a catalog/launcher, not a course organizer.
- New workspace instances are created at root/unorganized.
- Every launch creates a new independent instance.
- Preserve existing Plugin API v1 contracts and runtime semantics.
- Do not repurpose `registerView()` or `placeAction()`.
- Do not store workspace state in chat transcripts.
- Do not delete workspace data when archiving, disabling or uninstalling a plugin.
- Do not execute model-generated JavaScript in the trusted host page.
- Do not add cloud sync, marketplace, required course hierarchy or unrelated refactors.
- Do not commit unless the user explicitly asks.

## Implementation discipline

Work one phase at a time. Before editing, state:
- Intended files.
- Existing behavior being reused.
- New contracts being introduced.
- Compatibility and migration risks.
- Tests that will prove the change.

After each phase:
- Run focused tests.
- Run relevant typecheck/lint/build commands when practical.
- Report exact commands and results.
- Update documentation if implementation decisions change.
- Stop if a requirement cannot be met without breaking an existing public contract; explain the issue and propose an additive alternative.

Do not silently invent missing APIs. Inspect the code and follow existing naming, storage, event and UI conventions.

## First task

Execute Phase 0 only. Return the reconnaissance report and a proposed Phase 1 implementation plan. Wait for approval before changing source code.
