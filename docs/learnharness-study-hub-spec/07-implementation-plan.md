# 07 — Implementation plan

## 1. Execution strategy

Implement in small, reviewable phases. T3 Code must not implement the entire feature in one pass.

Before each phase:
1. Read this package.
2. Inspect the current implementation and tests.
3. Identify affected contracts and callers.
4. State the intended changes and compatibility risks.
5. Implement only the phase scope.
6. Run focused tests, then relevant broader checks.
7. Report changed files, tests, failures and remaining risks.

Do not commit unless explicitly requested.

## Phase 0 — Repository reconnaissance and design lock

Deliver:
- Current source map and exact call graph for chat organization.
- All consumers of `ChatDirectory`, `ChatDirectoryItem`, `ChatOrganizationAction`.
- All route/API callers for organization actions.
- Full plugin registration and frontend mount lifecycle.
- Existing storage/path resolver conventions.
- Existing test coverage and test commands.
- Confirmed approach for common directory entries and workspace persistence.

Must explicitly inspect:
- Folder emptiness and deletion.
- Folder archive/restore cascades.
- Reorder and move validation.
- Placement cleanup on chat deletion.
- Archived directory construction.
- Sidebar and archive rendering.
- Event invalidation.
- Plugin enable/disable/uninstall behavior.

No code changes in Phase 0.

## Phase 1 — Workspace foundation (host-only)

Implement:
- Workspace host metadata contract.
- Workspace store using existing safe data-root conventions.
- Workspace service (create/read/rename/delete policy).
- Workspace availability resolution.
- Focused unit tests.

Do not implement Study Hub UI, mixed sidebar or visual engine yet.

Acceptance:
- Can create/read a workspace record.
- IDs are unique.
- Unknown newer schema is not overwritten.
- Plugin-owned payload is not parsed by host.
- Plugin disable/missing does not delete records.

## Phase 2 — Optional Mode API

Implement:
- Public type contracts.
- Plugin registration lifecycle.
- Duplicate/invalid registration handling.
- Catalog projection.
- Workspace creation hook/context.
- Frontend renderer resolution.

Update SDK generation and API docs. Keep old plugins unchanged.

Acceptance:
- Legacy API v1 plugin loads unchanged.
- One plugin can register multiple modes.
- Multiple instances of one mode are independent.
- Registration cleanup removes catalog entry but preserves existing workspace records.
- Disabled/missing plugin workspaces remain recoverable.

## Phase 3 — Mixed directory and organization

Implement:
- Common `DirectoryEntry` union.
- Directory aggregation from chats and workspaces.
- Generalized organization actions and validation.
- Shared sorting.
- Mixed archive projection.
- Event invalidation.

Preserve `ChatOrganization` v1 serialization if possible. If an action API must change, preserve old callers with an adapter.

Acceptance:
- Mixed root/folder ordering.
- Move/reorder across supported targets.
- Folder archive/restore includes both kinds.
- Empty-folder detection includes both kinds.
- No chat regression.

## Phase 4 — Sidebar and archive UX

Implement:
- Study Hub entry below New Session.
- Mixed chat/workspace tree.
- Workspace row renderer.
- Common drag/drop/context menu/keyboard behavior.
- Mixed archive/restore.
- Workspace route shell and unavailable states.

Do not add separate workspace sections.

Acceptance:
- Workspaces and chats can be interleaved in one folder.
- New workspaces appear at root.
- All existing folder interactions work for both item types.
- Archive and restore preserve data.

## Phase 5 — Study Hub catalog

Implement:
- Catalog page.
- Search and basic filters.
- Mode cards/list.
- Launch flow and loading/error/empty states.

Acceptance:
- Modes from enabled plugins appear.
- Search/filter works.
- Launch creates a fresh workspace every time.
- No mandatory subject taxonomy.
- Unavailable definitions cannot be launched.

## Phase 6 — Visual Explanation Engine MVP

Implement only after the workspace subsystem is stable:
- Artifact envelope.
- Agent tool contract and validation.
- Static/declarative SVG renderer.
- Inline presentation.
- Expand to panel.
- Reduced-motion/accessibility behavior.
- Security boundary.

Do not execute arbitrary generated JavaScript in the host page. Do not add Python runtime in this phase.

## Phase 7 — Hardening and examples

Add:
- Example plugin registering multiple modes.
- Example mode with interactive state and persistence.
- Example visual artifact.
- Restart/recovery tests.
- Plugin disable/uninstall tests.
- Accessibility checks.
- Performance checks.
- Documentation and migration notes.

## 2. Dependency order

```text
Phase 0
  → Phase 1
    → Phase 2
      → Phase 3
        → Phase 4
        → Phase 5
          → Phase 6
            → Phase 7
```

Phase 4 and 5 may be developed in parallel only after the mode/workspace and mixed-directory contracts are stable.

## 3. Scope control

If a phase discovers a required contract change:
- Stop before silently expanding scope.
- Explain why it is needed.
- Identify compatibility impact.
- Propose the smallest additive solution.
- Update the docs before continuing.

Do not combine unrelated refactors with feature work.
