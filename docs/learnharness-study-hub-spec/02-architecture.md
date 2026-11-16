# 02 — Architecture and component boundaries

## 1. Architectural direction

Extend LearnHarness with a small host-owned workspace subsystem and an optional plugin mode registry.

Do not make workspaces a subtype of chat records. Do not store workspace payloads in chat transcripts. Reuse the existing organization metadata where safe, but generalize its domain model and UI adapters so that both chats and workspaces are represented as directory entries.

### High-level flow

```text
Plugin package
  └─ registers ModeDefinition (optional Plugin API extension)
       └─ Host Mode Registry
            ├─ Study Hub catalog
            └─ Create Workspace
                 ├─ Workspace metadata store (host-owned)
                 ├─ Plugin instance data directory (plugin-owned)
                 └─ Common organization placement
                      └─ Mixed sidebar/archive directory
                           └─ Workspace route
                                └─ Plugin workspace renderer
```

Visual explanation flow:

```text
Teaching agent
  └─ visual artifact tool/request
       └─ validate artifact envelope
            └─ restricted visual runtime
                 ├─ inline conversation renderer
                 └─ expanded panel renderer
```

## 2. Ownership boundaries

### Host owns
- Plugin/mode registration admission and lifecycle.
- Mode catalog metadata projection.
- Workspace IDs and host metadata.
- Workspace persistence location and schema version.
- Workspace create/open/rename/delete policy.
- Directory entry aggregation.
- Common organization operations.
- Workspace routing and mount lifecycle.
- Visual artifact envelope validation, renderer isolation and resource limits.

### Plugin owns
- Mode-specific UI and domain behavior.
- Workspace-specific state schema and migrations.
- Learning content, exercises, algorithms and simulation semantics.
- Optional AI instructions/tools used by that mode.
- Interpretation of its own persisted workspace state.

### Teaching agent owns
- Deciding whether a visual explanation is useful.
- Choosing the conceptual content and parameters to visualize.
- Requesting a new or updated visual artifact through the approved tool contract.
- Explaining the visualization in natural language.

The agent does not own filesystem paths, renderer privileges or host routing.

## 3. Existing seams to reuse

The following existing areas were identified during static inspection. T3 Code must re-open them before editing and confirm exact current signatures.

| Existing area | Intended use |
|---|---|
| `src/core/plugins.ts` | Add optional mode/workspace registration types without changing existing API v1 contracts |
| `src/server/plugins.ts`, `plugin-host.ts` | Server-side plugin/mode admission and lifecycle, if appropriate |
| `components/plugin-manager.ts`, `plugins.tsx` | Frontend mode registry and mount lifecycle |
| `src/core/chat-organization.ts` | Reuse organization persistence concepts and `placements`; generalize item actions safely |
| `src/server/chat-organization.ts` | Aggregate chats and workspaces into one directory |
| `components/chat-folder-tree.tsx` | Keep shared tree, DnD, folder menus and sibling ordering; introduce item-specific renderers |
| `components/sidebar.tsx` | Add Study Hub navigation and render the common mixed tree |
| `components/archive-page.tsx` | Render archived chats and workspaces together |
| `src/core/events.ts` | Add narrowly scoped workspace/directory change events if existing events are insufficient |
| `components/plugin-view.tsx` | Reference for existing plugin view shell; do not assume it is suitable for per-instance workspaces unchanged |

Existing `registerView()` registers fixed plugin views. It is not a workspace-instance API. Existing sidebar action placements are action buttons, not persistent directory entries.

## 4. Proposed subsystem boundaries

### 4.1 Mode Registry
Responsibilities:
- Register/unregister definitions from enabled plugins.
- Enforce plugin-scoped IDs and duplicate rejection.
- Expose read-only catalog data.
- Reject malformed metadata.
- Ensure definitions disappear when their plugin lifecycle is revoked.

It must not persist learner instances.

### 4.2 Workspace Service
Responsibilities:
- Create a workspace from an admitted mode definition.
- Generate a stable unique workspace ID.
- Persist host-owned metadata.
- Initialize plugin-owned instance data using a documented lifecycle hook if supported.
- Return the created workspace directory entry.
- Resolve workspaces for navigation.
- Rename or delete according to explicit host policy.

Avoid a large generic workflow engine. Keep the service synchronous where the current storage architecture allows; otherwise use the repository's existing async patterns.

### 4.3 Workspace Store
Stores host-owned metadata only. It should not parse or rewrite plugin-owned state.

Suggested location (confirm actual data root and path conventions before implementation):

```text
<learning-data>/
  workspaces/
    index.json
    <workspace-id>.json
```

The plugin-owned state must live in the plugin's writable data area, namespaced by workspace ID, using the existing origin-aware directory/path APIs. Do not invent paths from plugin IDs or trust paths supplied by plugin metadata.

Suggested plugin-owned structure:

```text
<plugin writable data>/
  workspaces/
    <workspace-id>/
      state.json
      ...
```

If the existing plugin data context cannot safely expose a per-workspace directory, add a narrow host API that resolves it. Do not expose arbitrary host filesystem paths to frontend plugin code.

### 4.4 Directory Aggregator
Builds one common list from:
- Native chat summaries.
- Workspace metadata summaries.

It returns a discriminated union, sorted using the existing placement/order semantics.

Suggested shape:

```ts
type DirectoryEntry = ChatDirectoryEntry | WorkspaceDirectoryEntry;

interface ChatDirectoryEntry {
  kind: "chat";
  id: string;
  title: string;
  // Preserve existing chat summary fields.
  folderId: string | null;
  order?: number;
  archivedAt?: string | null;
}

interface WorkspaceDirectoryEntry {
  kind: "workspace";
  id: string;
  title: string;
  pluginId: string;
  modeId: string;
  icon?: string;
  createdAt: string;
  updatedAt: string;
  folderId: string | null;
  order?: number;
  archivedAt?: string | null;
  availability: "available" | "plugin-disabled" | "plugin-missing" | "mode-missing";
}
```

This is a conceptual target, not a requirement to copy the exact names. Prefer repository naming conventions. Keep kind discriminators stable and explicit.

### 4.5 Workspace Renderer
Mounts a workspace by workspace ID:
1. Resolve host metadata.
2. Resolve plugin and mode registration.
3. Check availability and compatibility.
4. Create a workspace-scoped context.
5. Mount the plugin-provided renderer.
6. Dispose view-scoped resources on unmount.
7. Preserve workspace data on navigation/unmount.

Do not mount every workspace to build the sidebar.

## 5. Workspace lifecycle

```text
Plugin enabled
  → frontend/backend plugin lifecycle starts
  → mode definition registered
  → mode appears in Study Hub

Learner selects mode
  → host validates mode is still registered
  → host creates workspace ID
  → host writes workspace metadata
  → plugin initialization hook creates initial state (if required)
  → workspace gets root placement
  → directory change event
  → navigate to workspace route
  → plugin workspace renderer mounts

Learner navigates away
  → renderer cleanup runs
  → workspace metadata and plugin data remain

Learner archives workspace
  → organization placement gets archivedAt
  → workspace remains persisted
  → item appears in common archive

Plugin disabled/uninstalled
  → mode is unavailable
  → workspace record/data remain
  → directory shows recoverable unavailable state
```

## 6. Plugin lifecycle and async safety

Follow existing plugin registration ownership and cleanup semantics:
- A mode registration belongs to the plugin lifecycle that created it.
- Revoking the registration prevents future creation/opening through that definition.
- An already persisted workspace must not be deleted when registration is revoked.
- Async creation/mount completion must re-check that the plugin/mode/workspace is still valid before committing late results.
- Unmount cleanup must be idempotent.
- Do not add hot code replacement if the current host requires restart for plugin code updates.

## 7. Routing

Use a dedicated workspace route, for example:

```text
/workspaces/[workspaceId]
```

The route must not be confused with:
- `/chat/[id]`
- `/plugins/[pluginId]/[viewId]`

A workspace route identifies an instance, not a plugin view. The host resolves the plugin/mode using stored metadata. Do not trust route query parameters as authoritative plugin identity.

Unknown or unavailable workspace IDs should show a recoverable not-found/unavailable page.

## 8. Events and cache invalidation

Reuse existing event patterns. Add only the events needed for:
- workspace created/updated/deleted,
- directory entries changed,
- mode catalog changed.

Avoid firing duplicate refreshes for one logical operation. Organization changes should refresh both chat and workspace entries because the tree is shared.

## 9. Failure behavior

- If metadata write fails, do not navigate to a phantom workspace.
- If plugin initialization fails after metadata creation, either roll back the new host record safely or keep a recoverable failed workspace with an explicit status; choose one behavior and test it.
- If plugin is disabled/missing, preserve metadata and data.
- If plugin mode registration changes its display name, existing workspace title should remain user-controlled; do not silently overwrite a renamed instance.
- If an unknown newer workspace schema is encountered, refuse destructive writes and show a clear compatibility error.
