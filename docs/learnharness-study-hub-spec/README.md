# LearnHarness — Study Hub & Workspace Architecture

**Technical specification package — v1.0 — 2026-11-13**

This package is the implementation source of truth for adding a Study Hub, plugin-provided modes, persistent workspace instances, mixed chat/workspace organization, and a Visual Explanation Engine to the LearnHarness fork.

## Document map

| Document | Purpose |
|---|---|
| [01-product-requirements.md](01-product-requirements.md) | Product goals, terminology, requirements, non-goals and decisions |
| [02-architecture.md](02-architecture.md) | System boundaries, components, ownership and lifecycle |
| [03-api-contracts.md](03-api-contracts.md) | Proposed optional plugin API and compatibility rules |
| [04-data-model.md](04-data-model.md) | Persistence, directory entries, organization, migrations and invariants |
| [05-ux-specification.md](05-ux-specification.md) | Study Hub, mixed sidebar, workspace screens and interaction behavior |
| [06-visual-explanation-engine.md](06-visual-explanation-engine.md) | AI-generated visual artifacts, rendering modes and security model |
| [07-implementation-plan.md](07-implementation-plan.md) | Ordered delivery phases and implementation boundaries |
| [08-testing-and-acceptance.md](08-testing-and-acceptance.md) | Test matrix, acceptance criteria and regression requirements |
| [09-t3-code-operating-brief.md](09-t3-code-operating-brief.md) | Instructions to give T3 Code before implementation |

## Status and authority

This is a design specification, not a claim that these features already exist. Existing source behavior must be verified before implementation. If the repository differs from this document, T3 Code must report the discrepancy and propose a compatible adjustment rather than silently changing the design.

The repository inspection informing this specification covered the `main` branch and included, among others:

- `src/core/chat-organization.ts`
- `src/server/chat-organization.ts`
- `components/chat-folder-tree.tsx`
- `components/sidebar.tsx`
- `src/core/plugins.ts`
- `components/plugin-view.tsx`
- `src/core/events.ts`
- `docs/plugin-authoring.md`
- `docs/plugin-architecture.md`

No source code was changed and no build or test suite was run during that inspection.

## Non-negotiable product decisions

1. Chats and workspaces are peers in one mixed sidebar tree. A workspace is not a separate sidebar section.
2. A mode is a reusable plugin-provided definition. A workspace is one independent instance of a mode.
3. Creating a mode instance creates a new independent workspace. Multiple instances of the same mode are supported.
4. New workspaces appear in the general sidebar list, not automatically inside the currently selected folder.
5. Users can move, reorder, archive, restore and nest workspaces using the same organization behavior as chats.
6. Study Hub is a discovery/catalog page, not a course or subject organizer.
7. Existing Plugin API v1 contracts and runtime semantics must remain compatible. New capabilities are optional extensions.
8. Existing `registerView()` remains a static plugin view API. It must not be repurposed as a dynamic workspace-instance API.
9. Generated visual artifacts are untrusted content and must run in a restricted renderer, not in the trusted plugin execution context.
10. Keep the first implementation small, local-first and maintainable. Do not introduce enterprise infrastructure, cloud sync, a marketplace, or a mandatory course hierarchy.

## Vocabulary

- **Plugin:** installed LearnHarness extension package.
- **Mode:** reusable experience registered by a plugin, such as a memory simulator or tree visualizer.
- **Workspace:** persistent, independent instance of a mode.
- **Study Hub:** catalog and discovery surface for installed/available modes.
- **Directory entry:** one item shown in the common sidebar/archive tree; either a chat or a workspace.
- **Visual artifact:** one generated interactive visual explanation, rendered inline or in a dedicated panel.
