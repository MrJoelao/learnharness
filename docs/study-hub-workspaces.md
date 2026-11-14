# Study Hub workspace storage

This page records the host storage contract for Phase 1 of the Study Hub. It covers persistent workspace identity and metadata. It does not add a catalog page, workspace route, or plugin mode API.

## Keep workspace data separate

The host stores workspace metadata under `PATHS.data/workspaces/`. Each workspace has one JSON record named `<workspace-id>.json`. `index.json` stores the schema version and the ordered list of workspace IDs. It does not copy titles, plugin IDs, mode IDs, or timestamps.

The workspace record owns the host metadata: its ID, plugin ID, mode ID, title, creation time, and update time. The record has its own schema version. A plugin owns its domain state. The host does not read or rewrite that state. A later phase will place plugin state under the owning plugin's writable data directory and scope it by workspace ID.

Workspace records do not use chat IDs or chat files. This phase does not change `ChatRecord`, `ChatOrganization`, or the public Plugin API v1 contracts.

## Keep IDs safe and stable

The host generates IDs with the `workspace_` prefix and a UUID. `parseWorkspaceId` checks the complete format before a value becomes a `WorkspaceId` or a file path. Plugin IDs use the existing lowercase hyphen pattern. Mode IDs use the existing plugin view ID pattern: 1 to 128 ASCII letters, digits, periods, underscores, or hyphens, starting with a letter or digit.

Workspace titles are trimmed and limited to 200 characters. Timestamps use normalized ISO format. The parser rejects unknown fields and unsupported schema versions. A write never replaces a record or index that this app cannot parse.

## Write one file at a time

The store uses `writeFileAtomicSync` for each record and for `index.json`. Workspace creation writes the record first, then adds its ID to the index. If the index write fails, the record remains an orphan. A normal list does not include it.

The index controls normal directory membership. Each record controls its own metadata. The two files cannot be committed as one filesystem transaction, so the store reports inconsistencies instead of repairing them during a read.

`list()` returns valid indexed workspaces and per-record issues. A missing, invalid, or unreadable record does not prevent other workspaces from loading. An invalid or newer index stops the operation because its membership list cannot be trusted.

`inspect()` reports valid orphan IDs, missing record IDs, invalid orphan IDs, invalid indexed records, and unreadable indexed records. It does not write files. `recoverOrphan(id)` adds a valid orphan to the index after an explicit request. `removeMissingReference(id)` removes an indexed ID only when its record is confirmed missing.

Deleting a listed workspace first removes its ID from the index, then unlinks the record. If unlinking fails, the service reports the partial failure. The remaining record is an orphan and stays out of normal lists. The caller can inspect and recover it explicitly.

Phase 1 deletion removes host metadata only. It does not delete plugin-owned state. A later phase must define an explicit cleanup flow before it removes that state.

## Keep service rules in the host

`createWorkspaceService` owns create, read, list, rename, delete, and explicit reconciliation operations. It generates stable IDs and changes only host metadata. Rename cannot change the workspace ID, plugin ID, mode ID, or creation time.

`resolveWorkspaceAvailability` accepts a host-provided snapshot of enabled plugins and registered mode IDs. Phase 1 defines this seam without adding mode registration. A later plugin API phase can provide the snapshot without putting plugin lifecycle logic in the store.

The filesystem adapter lives in `src/store/workspaces.ts`. The storage contract lives in `src/core/ports.ts`. The pure schema and availability rules live in `src/core/workspaces.ts`. `src/server/workspaces.ts` wires the host service. No frontend consumer or workspace event is needed in this phase.
