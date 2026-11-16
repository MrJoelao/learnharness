# Multi Mode Example

This no-build API v1 example declares two independent modes from one plugin backend
and registers interactive browser renderers explicitly. It serves as a canonical
reference for authors creating plugins with multiple modes and persistent workspace state.

## Architecture

1. **Backend (`backend.cjs`)**:
   - Owns catalog metadata, categories, difficulty, tags, host Lucide icons (`Brain`, `Network`), and instance initialization.
   - Registers two modes:
     - `recall-lab`: "Recall Lab" (`category: "Practice"`, `icon: "Brain"`) — Spaced recall workspace with an interactive counter and reflections notebook.
     - `tree-lab`: "Tree Lab" (`category: "Visual"`, `icon: "Network"`) — Visual hierarchy exploration workspace.
   - `initializeWorkspace({ workspace, storage })` runs once per created workspace, establishing default persistent state keyed by workspace ID.

2. **Frontend (`main.js`)**:
   - Registers browser renderers with `ctx.registerModeRenderer(ctx.manifest.id, modeId, renderer)`.
   - Modifies and persists application state via the async `storage` API (`get`, `set`).
   - Updates the DOM immediately upon user interaction (counter increment, reset, notes editing).
   - Cleans up event listeners, pending timers, and DOM nodes when the view unmounts or its `signal` is aborted.

3. **Instance Isolation**:
   - Each launch in Study Hub generates a fresh, unique host `workspace_` ID.
   - Plugin state is strictly scoped to that workspace ID under the plugin data directory.
   - Two concurrent or sequential instances of `recall-lab` never share or overwrite each other's state.

4. **Lifecycle and Recovery**:
   - Disabling the plugin hides its modes from the catalog without removing existing workspaces from the sidebar or deleting workspace data.
   - Opening a workspace whose plugin is disabled displays the appropriate unavailable state.
   - Re-enabling the plugin restores full access and loads original state intact.
