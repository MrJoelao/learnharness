# Study Hub workspace storage and lifecycle

This document records the host storage contract, plugin mode architecture, and lifecycle rules for Study Hub workspaces (Phases 1–7).

## Keep workspace data separate

The host stores workspace metadata under `PATHS.data/workspaces/`. Each workspace has one JSON record named `<workspace-id>.json`. `index.json` stores the schema version and the ordered list of workspace IDs. It does not copy titles, plugin IDs, mode IDs, or timestamps.

The workspace record owns the host metadata: its ID, plugin ID, mode ID, title, creation time, and update time. The record has its own schema version. A plugin owns its domain state. The host does not interpret or rewrite that state.

Plugin-owned state is stored under the owning plugin's writable data directory:
`<learning data>/plugins/<plugin-id>/data/workspaces/<workspace-id>/<key>.json`
Each value is limited to 1 MiB and must be valid JSON.

Workspace records never use chat IDs, chat files, or chat transcripts. Workspaces and chats are peers in the mixed sidebar organization tree (`OrganizationV2`), but their underlying storage engines remain strictly separated.

## Keep IDs safe and stable

The host generates IDs with the `workspace_` prefix and a UUID (`parseWorkspaceId`). Plugin IDs use the standard lowercase hyphen pattern. Mode IDs use 1 to 128 ASCII letters, digits, periods, underscores, or hyphens, starting with a letter or digit.

Workspace titles are trimmed and limited to 200 characters. Timestamps use normalized ISO format. The parser rejects unknown fields and unsupported schema versions. A write never replaces a record or index that this app cannot parse.

## Write one file at a time

The store uses `writeFileAtomicSync` for each record and for `index.json`. Workspace creation writes the record first, then adds its ID to the index. If the index write fails, the record remains an orphan. A normal list does not include it.

The index controls normal directory membership. Each record controls its own metadata. The two files cannot be committed as one filesystem transaction, so the store reports inconsistencies instead of repairing them during a read.

- `list()` returns valid indexed workspaces and per-record issues. A missing, invalid, or unreadable record does not prevent other workspaces from loading. An invalid or newer index stops the operation because its membership list cannot be trusted.
- `inspect()` reports orphan IDs, missing IDs, invalid orphan IDs, invalid record IDs, and unreadable record IDs. It does not write files.
- `recoverOrphan(id)` adds a valid orphan to the index after an explicit request.
- `removeMissingReference(id)` removes an indexed ID only when its record is confirmed missing.

Deleting a listed workspace follows a phased resilient process:
1. State is deleted from disk.
2. The workspace ID is removed from `index.json`.
3. The metadata record is unlinked from disk.
If any step fails, an idempotent deletion journal records the progress so restart recovery can resume and complete the operation cleanly.

## Multi-Mode Plugin Registration

A single plugin backend can register multiple distinct modes using `ctx.registerMode(definition)`:
- Each mode must provide a stable, distinct `id`, `name`, `description`, `category`, and `initializeWorkspace` hook.
- Optional fields: `icon` (one of the host's supported Lucide identifiers: `BookOpen`, `Brain`, `Calculator`, `Code`, `FlaskConical`, `GraduationCap`, `Lightbulb`, `Network`, `Puzzle`, `Target`), `tags`, `difficulty`, `activityType`, `capabilities`.
- Duplicate mode IDs within the same plugin are rejected.
- Different plugins may use the same mode ID because mode identity is composed of `(pluginId, modeId)`.
- When `registerMode()` is invoked, it returns an idempotent unregister callback.

Frontend renderers are registered explicitly with `ctx.registerModeRenderer(pluginId, modeId, renderer)`:
- `renderer.mount(container, { workspace, storage, signal, setTitle })` mounts the workspace UI.
- The returned cleanup function or `signal` abort releases all DOM nodes, listeners, and pending timers on unmount.

## Instance Independence

Launching a mode multiple times creates distinct workspaces:
- Each launch receives a fresh, unique host `workspace_` ID.
- Storage operations through `context.storage` (`get`, `set`, `delete`) are strictly scoped to that workspace ID.
- Changes made in one workspace instance do not mutate or collide with other instances of the same or different modes.

## Lifecycle: Disabling, Uninstalling, and Re-enabling

1. **Plugin Disable**:
   - Disabling a plugin removes its modes from the active catalog (`host.modes()`).
   - Existing workspaces remain in the directory and sidebar.
   - On-disk workspace records and plugin-owned data are preserved.
   - Opening an existing workspace while its plugin is disabled displays an informative, accessible unavailable message explaining that enabling the plugin in Settings restores access.
   - Re-enabling the plugin restores catalog availability, resolves the workspace as `available`, and loads original data intact.

2. **Plugin Missing / Uninstalled**:
   - If a plugin is uninstalled or absent from disk, its workspaces remain in the directory with availability `plugin-missing`.
   - Host metadata and plugin data files are preserved.
   - The host does not perform automatic substitution or fallback to other modes.
   - Reinstalling the plugin restores access.

3. **Async Lifecycle Safety**:
   - Stale async registrations attempting to register modes after plugin deactivation or revocation are rejected.
   - Repeated cleanup calls are safe no-ops.

## Migration Notes

- **Plugin API v1 Compatibility**: Existing plugins that do not call `registerMode` or `registerModeRenderer` continue to load and function identically. `registerView()`, `placeAction()`, custom views, question/problem renderers, and plugin storage are completely unaffected.
- **Organization V2**: Workspaces and chats share the mixed directory structure. Workspaces are never stored in chat transcripts or chat JSON files.
- **Forward Compatibility & Versioning**: If a workspace record with an unknown newer version (e.g., version 2 or higher) is encountered on disk, the host store reports it as an invalid record issue and refuses destructive writes or renames, ensuring newer data formats are never corrupted by an older host.
