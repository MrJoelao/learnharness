# Repository and feature context

This document records the architecture facts relevant to the Study Hub repair work. It is not a replacement for the original specification or source code. Verify every path and symbol against the current branch before editing.

## 1. Repository scope

- Fork: `MrJoelao/learnharness`
- Upstream: `amosblomqvist/learnharness`
- Target branch: `feat/study-hub`
- Main feature groups:
  1. Study Hub plugin modes and persistent workspaces.
  2. Shared organization of chats and workspaces.
  3. Visual Explanation Engine with a declarative SVG MVP.

The branch may contain additional changes unrelated to these feature groups. Do not assume every change on `feat/study-hub` belongs to this repair effort.

## 2. Workspace domain

Conceptual distinction:
- **Plugin**: installed package and runtime contribution.
- **Mode**: reusable activity definition registered by a plugin.
- **Workspace**: persistent instance created from a plugin mode.

A workspace must not be treated as a chat transcript. Its metadata and private plugin state have separate ownership.

Relevant paths previously inspected:
- `src/core/workspaces.ts`
- `src/store/workspaces.ts`
- `src/store/plugin-workspace-state.ts`
- `src/server/workspaces.ts`
- `src/server/plugin-host.ts`
- `src/core/plugin-modes.ts`
- `components/workspace-row.tsx`
- `components/workspace-screen.tsx`
- `components/study-hub-catalog.tsx`

Verify the current source before relying on this list.

### Invariants to preserve

- Workspace identity is independent from chat identity.
- A workspace refers to a `pluginId` and `modeId`.
- A plugin mode is optional. Legacy Plugin API v1 plugins must not be forced to register modes.
- A disabled, missing, or temporarily unavailable plugin must not silently erase its workspace.
- Workspace state belongs to the workspace and plugin, not to the chat store.
- Deletion must handle partial failure and recovery without silently losing metadata or private state.
- Plugin package replacement must not overwrite persistent plugin data.
- Plugin data paths must remain confined to the intended data root and reject unsafe symlink/path traversal cases.

## 3. Shared organization

Previously inspected paths:
- `src/core/organization.ts`
- `src/core/directory.ts`
- `src/server/directory.ts`
- `src/store/chat-organization.ts`
- `components/sidebar.tsx`
- `components/chat-folder-tree.tsx`
- `components/archive-page.tsx`

The v2 organization model uses typed item keys, with distinct `chat:` and `workspace:` namespaces. The shared directory combines chat and workspace entries while the underlying stores retain ownership of their records.

### Invariants to preserve

- Chat and workspace items can share folders and sibling ordering.
- Folder emptiness must account for both item kinds.
- Folder archive/restore operations must apply to the intended subtree.
- Deleting a placement must not accidentally delete the underlying chat or workspace record.
- Legacy v1 chat organization data must remain readable and migrate without data loss.
- Reads must not cause unnecessary destructive migration writes.
- Unknown future schema versions must not be overwritten.
- Existing chat routes and legacy API consumers must continue to work.

## 4. Plugin modes and runtime

Previously inspected paths:
- `src/core/plugin-modes.ts`
- `src/server/plugin-host.ts`
- `src/server/plugin-transport.ts`
- `src/server/plugins.ts`
- `app/api/plugins/modes/route.ts`
- `app/api/directory/route.ts`

The plugin host owns mode registration and workspace lifecycle. Do not duplicate mode validity checks across UI and service layers. UI availability is not authoritative; the host must validate creation and operations.

### Invariants to preserve

- Mode identity is scoped by plugin identity.
- Plugin API v1 remains compatible.
- A mode is not available merely because stale frontend metadata exists.
- Disable/deactivate must invalidate plugin contributions and clean up registered resources.
- Re-enable/refresh must rediscover and reactivate safely.
- Workspace availability must be derived from current plugin and mode state.
- Plugin state and workspace metadata must not be conflated.

## 5. Visual Explanation Engine

Previously inspected paths:
- `src/core/contracts/visual-explanation.ts`
- `src/core/visual-explanation-validator.ts`
- `src/agent/tools/visual-explanation.ts`
- `components/artifacts/declarative-svg-renderer.tsx`
- `components/artifacts/visual-explanation-card.tsx`
- `src/agent/prompts/teacher/56-visual-explanation.md`
- related `tests/visual-explanation-*.test.*`

The intended MVP uses the versioned envelope and the JSON schema `learnharness.visual.svg.v1`. The declarative renderer maps a strict allowlist of SVG primitives into native React SVG elements.

Previously documented allowed primitives include:
- `rect`
- `circle`
- `ellipse`
- `line`
- `polyline`
- `polygon`
- `text`

The agent tool should be the strict trust boundary. The renderer must not accept untrusted arbitrary markup simply because a frontend compatibility path exists.

### Invariants to preserve

- Host owns artifact identity on creation.
- Updates must be scoped to the current chat and artifact identity.
- Invalid updates must preserve the last valid artifact.
- No arbitrary executable code in the declarative MVP.
- No `eval`, `new Function`, `dangerouslySetInnerHTML`, or arbitrary DOM HTML insertion in the declarative renderer.
- Validate structure, element count, step count, source size, coordinates, colors, attributes, and control values.
- Keep artifacts isolated by chat.
- Preserve user interaction state only when compatible with the updated artifact.
- Respect reduced-motion preferences and accessible keyboard interaction.
- Do not let legacy compatibility silently weaken the new-agent input contract.

### Open product decision

The previous audit found a legacy HTML renderer branch in `visual-explanation-card.tsx`, while the current agent tool was described as accepting only strict declarative SVG. Do not remove or broaden that branch without checking actual persisted legacy data and the original specification. The orchestrator must decide whether legacy HTML is:
1. still-supported persisted content;
2. a temporary migration path;
3. unsupported and removable after a migration plan.

The previous audit also noted a difference between control descriptors available in the contract/UI and the smaller set accepted by the agent tool. Verify current code and original spec before deciding whether to expand the MVP or document the reduced supported set.

## 6. UI integration

Previously inspected paths:
- `components/sidebar.tsx`
- `components/chat-folder-tree.tsx`
- `components/workspace-row.tsx`
- `components/archive-page.tsx`
- `components/study-hub-catalog.tsx`
- `components/workspace-screen.tsx`

The sidebar and archive should represent mixed directory entries. Keep row geometry and interaction behavior consistent without forcing workspace-specific logic into chat-only components.

Verify:
- active workspace expansion in folder tree;
- mixed search results;
- keyboard selection;
- drag/drop between chat and workspace siblings;
- folder archive/restore;
- archive search and restore;
- context menu actions;
- unavailable plugin state;
- navigation to `/workspaces/:id`.

## 7. Do not trust stale audit numbers

Any previous test counts, commit hashes, branch-ahead counts, or CI observations are historical snapshots. Recompute them on the current checkout. Do not quote an old count as a current result.
