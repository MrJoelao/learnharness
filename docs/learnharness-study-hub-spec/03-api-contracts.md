# 03 — Optional Plugin API contracts

## 1. Compatibility rule

The existing Plugin API v1 is public and must remain compatible.

Do not:
- Change the meaning or required fields of existing plugin manifest/API v1.
- Change `registerView()` semantics.
- Turn `placeAction()` into a navigation/workspace registration mechanism.
- Change existing question/problem/tool renderer contracts.
- Change existing plugin data directory ownership rules.
- Require existing plugins to implement a new method.

Do:
- Add an optional, additive capability to the host API.
- Keep old plugins loadable without changes.
- Add type-only SDK declarations through the repository's existing SDK build process.
- Document new lifecycle, persistence and error semantics.

Compatibility means runtime behavior and data formats, not just TypeScript compilation.

## 2. Proposed public concepts

Names below are proposals. Before implementation, inspect `src/core/plugins.ts` and adjacent contracts and adapt names to established conventions without changing the semantics.

```ts
export interface PluginModeDefinition {
  id: string;                 // Stable ID scoped to plugin
  name: string;
  description: string;
  icon?: string;
  category: string;
  tags?: string[];
  difficulty?: "beginner" | "intermediate" | "advanced";
  activityType?: string;
  capabilities?: string[];
  createWorkspace: (
    context: WorkspaceCreateContext
  ) => Promise<WorkspaceInitialState | void> | WorkspaceInitialState | void;
  renderWorkspace: (
    context: WorkspaceContext
  ) => ReactNode;
}
```

Do not assume React types are available in the public SDK. If the existing plugin UI uses a renderer registration/handle pattern, follow that pattern instead of exporting React-specific contracts. The code above describes intent, not a mandate for a particular rendering technology.

The public API should expose a registration method conceptually equivalent to:

```ts
registerMode(definition: PluginModeDefinition): () => void;
```

The returned cleanup unregisters the definition. The host must own registration identity and lifecycle.

## 3. Workspace context

A workspace-scoped context should provide only what the plugin needs:

```ts
interface WorkspaceContext {
  workspace: {
    id: string;
    pluginId: string;
    modeId: string;
    title: string;
    createdAt: string;
    updatedAt: string;
  };

  // Plugin-scoped, workspace-scoped persistence.
  storage: {
    get<T>(key: string): Promise<T | undefined>;
    set<T>(key: string, value: T): Promise<void>;
    delete(key: string): Promise<void>;
  };

  // Host-owned metadata operations.
  setTitle(title: string): Promise<void>;

  // Lifecycle and host UI integrations, only if supported by current API.
  signal: AbortSignal;
}
```

This is a conceptual interface. Adapt to existing `PluginFrontendContext`, `PluginBackendContext`, storage and UI conventions.

### Context rules
- `workspace.id`, `pluginId` and `modeId` are immutable.
- Plugin storage is automatically namespaced by plugin and workspace.
- A plugin cannot access another plugin's workspace storage through this API.
- Do not expose raw filesystem paths to the browser.
- Storage writes must be bounded/validated according to existing host patterns.
- `signal` is aborted when the workspace renderer is disposed or its owning plugin lifecycle is revoked, as appropriate.
- Host metadata changes are explicit; plugins cannot rewrite identity or organization placement.

## 4. Create lifecycle

Preferred lifecycle:
1. Host validates mode registration.
2. Host allocates workspace ID and metadata.
3. Host creates the plugin-scoped storage namespace.
4. Host calls optional `createWorkspace`.
5. Host commits the workspace as available and navigates.

If the existing persistence model requires metadata to be committed before plugin initialization, define a `creating` state and recover interrupted creation on next startup. Do not leave ambiguous half-created records.

Creation must be idempotent only if the host already has a reliable operation ID. Otherwise, each explicit launch is a new instance.

## 5. Rendering contract

The workspace renderer receives the instance context and renders only the experience body. The host owns:
- Global application shell.
- Workspace title/header and navigation.
- Loading/error/unavailable states.
- Sidebar and organization.
- Route identity.
- Persistence and lifecycle.

The plugin owns:
- Workspace-specific body and interactions.
- Domain state and validation.
- Any internal tabs/panels within its body.

A plugin may optionally declare a preferred layout hint (`full`, `split`, `compact`) only if there is a real host use case. Avoid a large layout DSL in v1.

## 6. Catalog metadata schema

Required:
- `id`
- `name`
- `description`
- `category`

Optional:
- `icon`
- `tags`
- `difficulty`
- `activityType`
- `capabilities`

Validation:
- IDs are non-empty, bounded, stable and plugin-scoped.
- Duplicate `(pluginId, modeId)` registrations are rejected.
- Display strings have reasonable length limits.
- Tags are normalized for search but original display labels may be preserved.
- Metadata is data, not executable code.
- Invalid registration should fail visibly for the plugin developer and must not crash the entire plugin host.

Do not bake course subjects into required categories. Tags should support broad discoverability without a fixed university curriculum taxonomy.

## 7. Workspace persistence ownership

Host metadata (identity, plugin/mode reference, title, timestamps, schema version) is host-owned.

Mode state is plugin-owned and namespaced per workspace.

Plugins own their own data schema and migrations. The host must not inspect or rewrite plugin payloads. Unknown/newer plugin state must be preserved.

## 8. Plugin disable, uninstall and missing mode

- Disabling a plugin prevents its mode definitions from being admitted.
- Existing workspace metadata and plugin data remain untouched.
- If the plugin is later re-enabled and registers the same mode ID, its workspaces become available again.
- If the plugin is uninstalled, preserve orphaned workspace records/data. Offer an explicit cleanup path only in a later, separately designed feature.
- If the plugin loads but no longer registers a referenced mode ID, show `mode-missing`.
- Never silently map an old workspace to a different mode ID.

## 9. SDK and documentation

Update the canonical API source and generated type package using existing scripts. Add:
- API reference page for modes/workspaces.
- Authoring guide section with a minimal example.
- Lifecycle and persistence contract.
- Error/compatibility behavior.
- Example plugin with two modes and multiple instances.
- Tests proving a legacy API v1 plugin works unchanged.

Do not ask plugin authors to import private host modules or runtime internals.
