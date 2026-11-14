# Plugin mode and workspace contract

This contract adds optional workspace modes to Plugin API v1. Existing manifests,
views, actions, renderer contracts and runtime behavior do not change. `registerView()`
continues to mean a static plugin page view.

## Backend: authority and initialization

`PluginBackendContext.registerMode(definition)` admits a plugin-scoped mode definition.
The required fields are `id`, `name`, `description`, `category`, and
`initializeWorkspace`. `icon`, `tags`, `difficulty`, `activityType`, and `capabilities`
are optional. IDs use 1–128 ASCII letters/digits/dot/underscore/hyphen characters and
must start with a letter or digit. Display fields and lists have explicit size limits;
list values are case-insensitively unique. Unknown properties are rejected.

Registration returns an idempotent unregister callback and is tied to the backend
activation. Duplicate mode IDs within one plugin or invalid definitions are rejected
and reported as a mode contribution warning; other capabilities from that activation
remain available. Only active, enabled registrations appear in
`GET /api/plugins/modes`. The backend works without any frontend renderer.
The optional `icon` must be one of the host's Lucide identifiers: `BookOpen`, `Brain`,
`Calculator`, `Code`, `FlaskConical`, `GraduationCap`, `Lightbulb`, `Network`, `Puzzle`,
or `Target`. URLs, markup and SVG input are rejected.

The host creates every workspace from an active `(pluginId, modeId)` registration and
generates a fresh `workspace_` UUID. A requested title is validated by the host; by
default the mode's display name is used. `initializeWorkspace` receives an immutable
host metadata record, the backend activation signal and a storage facade. `storage`
has synchronous `get`, `set` and `delete` for JSON values, keyed by bounded identifiers.
Each value is limited to 1 MiB and stored under the owning plugin's data directory,
scoped by workspace ID. The host does not interpret the plugin's payload schema.

If initialization fails or its registration is revoked before it completes, the host
removes the just-created metadata record and plugin state namespace and returns an error.
If rollback fails, the error includes the workspace ID, primary failure and rollback
diagnostics; the metadata record is retained when state cleanup fails so it remains
identifiable for recovery. Disabling/removing a plugin or unregistering a mode removes catalog
availability but never deletes existing workspace records or plugin state. Re-enabling
the plugin and registering the same mode ID makes the original workspaces resolvable.

## Frontend: explicit renderer pairing

`PluginFrontendContext.registerModeRenderer(modeId, renderer)` registers a browser
`mount(container, context)` callback. The plugin ID comes from the current frontend
activation; the backend catalog must contain the exact pair. A frontend registration
cannot declare metadata, launch a mode, or make a backend mode available. Duplicate,
invalid or undeclared renderer registrations fail visibly for that plugin.

The mount context includes read-only current workspace metadata, a mount-scoped abort signal,
plugin-owned async storage methods and `setTitle`. Unregistering a renderer aborts its
current mounts. `setTitle` updates the context's workspace metadata after the host
confirms the rename. Requests are aborted when the mount closes. Remounting an existing
workspace reads the same persistent state; initialization runs only on creation. The host
owns navigation, title shell and availability messaging. The
renderer owns only the workspace body. A missing renderer is an unavailable state, not
a deletion condition.

## Compatibility and recovery

All additions are optional. A Plugin API v1 plugin that never calls `registerMode` or
`registerModeRenderer` loads as before. The portable SDK is type-only. Plugins must not
import host internals or infer a renderer from a filename/convention. Disabled, removed
or mode-missing workspaces and their data remain recoverable; no automatic cleanup or
remapping occurs.
