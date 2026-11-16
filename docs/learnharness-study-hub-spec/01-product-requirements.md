# 01 — Product requirements

## 1. Product vision

Turn the existing practice area into an extensible Study Hub where learners can launch focused learning experiences—simulators, visualizers, interactive exercises, editors and guided labs—without making LearnHarness itself responsible for each subject's domain logic.

The host supplies lifecycle, persistence boundaries, navigation, organization and safe rendering infrastructure. Plugins supply the learning experience and its domain behavior.

## 2. User goals

A learner must be able to:

- Discover installed learning modes from one Study Hub page.
- Search and filter modes using metadata such as category, topic and activity type.
- Launch a new instance of a mode.
- Keep multiple independent instances of the same mode.
- Return to an instance later with its state intact.
- Organize chats and workspaces together in the same folders and subfolders.
- Archive and restore either kind of item without losing its data.
- Use a visual explanation during an ordinary teaching conversation when it materially improves understanding.
- Ask follow-up questions that modify an existing visual explanation rather than creating an unrelated duplicate.

## 3. Terminology and conceptual model

### Mode definition

A mode is a plugin-registered definition. It is reusable and does not contain the learner's per-instance progress.

Examples:
- Memory & Paging Lab
- TCP/IP Simulator
- Tree Visualizer
- Process Scheduling Lab

A plugin may register zero, one or many modes.

### Workspace instance

A workspace is one concrete instance created from a mode definition. It has its own stable ID, title, timestamps, plugin/mode identity and plugin-owned state.

Two instances of the same mode must not share mutable state unless the plugin explicitly implements a shared resource.

A workspace may be:
- A full custom interactive UI.
- A simulator or editor.
- A guided exercise.
- A chat-plus-visual experience.
- A compact utility-like learning tool.

Do not assume every workspace is a chat or has messages.

### Study Hub

Study Hub is the mode catalog and launcher. It is not a folder manager, course manager or subject hierarchy.

Folders already provide the user's organization model. Do not add mandatory courses, subjects, semesters or modules.

## 4. Functional requirements

### FR-01 — Mode registration
Plugins can register mode definitions through a new optional API. Registration is scoped to the plugin lifecycle and removed when that registration is revoked or the plugin is disabled/unloaded.

### FR-02 — Mode metadata
A mode definition provides:
- Stable plugin-scoped mode ID.
- Display name.
- Short description.
- Icon identifier or supported icon representation.
- Category.
- Optional tags/topics.
- Optional difficulty and estimated activity type.
- Optional capabilities, such as AI assistance, simulation, visualization or assessment.

Metadata is for discovery and display. It must not be treated as an authorization policy.

### FR-03 — Mode catalog
Study Hub lists enabled and available registered modes. It supports text search and lightweight filters. It must provide useful empty, loading and unavailable states.

### FR-04 — Create workspace
Selecting a mode creates a new workspace instance. The default title comes from the mode and may later be renamed. The new workspace is placed at the root of the common organization tree (unorganized), not inside the currently selected folder.

### FR-05 — Independent instances
The same mode can be launched repeatedly. Each launch creates a distinct workspace ID and independent persisted state.

### FR-06 — Persistence
Workspace metadata and plugin-owned instance data survive navigation and application restart. Host metadata must be separate from plugin-specific state.

### FR-07 — Mixed organization
Chats and workspaces are peers in one directory model. They can be:
- Root-level/unorganized.
- Inside any folder or nested folder.
- Reordered among siblings.
- Moved between folders.
- Archived and restored.

There must not be a separate workspace section in the sidebar or archive.

### FR-08 — Archive and restore
Archiving a workspace changes its organization metadata only. It must not delete its workspace record or plugin-owned data. Restoring returns it to the common tree and supports the same destination behavior as chats.

### FR-09 — Workspace navigation
Opening a workspace resolves its plugin and mode, loads its persisted metadata/state, and mounts the plugin's workspace renderer. If the plugin or mode is unavailable, show a recoverable unavailable state; do not silently delete the workspace.

### FR-10 — Workspace lifecycle
The host owns workspace creation, identity, navigation and persistence metadata. The plugin owns the workspace's domain state and UI. Unmounting a workspace must release view-scoped resources but must not delete persisted data.

### FR-11 — Visual explanation request
The teaching agent may request a visual artifact when a visual/interactive representation materially improves learning. The decision can be automatic, but the learner must retain control to expand, collapse or dismiss the artifact.

### FR-12 — Visual artifact continuity
A follow-up instruction may update the currently active artifact, preserving its identity and relevant state when possible. Examples include changing a parameter, adding a step, highlighting a component or showing a counterfactual.

### FR-13 — Inline and panel presentation
A single visual artifact can be presented inline in a conversation or expanded into a dedicated panel. These are two presentation modes for the same artifact, not separate implementations.

### FR-14 — Existing features
Teaching sessions, practice sessions, existing plugin views, actions, questions, problem types, tool renderers and plugin data must continue to work.

## 5. Non-functional requirements

- **Compatibility:** preserve Plugin API v1 public contracts and runtime semantics.
- **Local-first:** no remote service is required for the feature to work.
- **Small surface area:** prefer a few well-defined contracts over a generic framework.
- **Recoverability:** missing/disabled plugins must not destroy workspaces.
- **Data safety:** do not overwrite unknown/newer data formats.
- **Performance:** sidebar loading must not mount every workspace UI.
- **Accessibility:** keyboard navigation, focus handling, labels and reduced-motion support.
- **Observability:** errors should identify plugin/mode/workspace context without exposing private state.
- **Security:** generated artifacts are untrusted and isolated from host privileges.

## 6. Explicit non-goals for the first release

- Cloud sync or cross-device collaboration.
- Plugin marketplace, remote discovery or plugin purchasing.
- Required subject/course/semester hierarchy.
- Shared live workspace collaboration.
- Arbitrary plugin-to-plugin state sharing.
- A general-purpose visual programming IDE.
- Running arbitrary Python code in the host process.
- A full video generation system.
- Replacing the existing chat/session model.

## 7. Product decisions (locked)

| Decision | Choice |
|---|---|
| Workspace sidebar placement | Mixed with chats in the same tree |
| Workspace creation destination | Root/unorganized |
| Same mode launched again | Create a new independent instance |
| Subject organization | User's existing folders |
| Study Hub role | Catalog/discovery and launcher |
| Existing `registerView()` | Keep as static plugin view |
| New mode API | Optional extension to Plugin API v1 |
| Workspace data | Host metadata + plugin-owned state |
| Visual artifact | One artifact, inline or panel |
| Generated code execution | Restricted renderer, never trusted plugin context |

## 8. UX principles

- A workspace is a first-class navigable item, not a temporary dialog.
- Its icon may distinguish it from a chat, but it shares the same placement, ordering and menu behavior.
- Do not add unnecessary labels, badges or nested sections that clutter the sidebar.
- Study Hub should make launching a mode obvious and returning to existing workspaces effortless.
- Empty folders, unavailable modes and archived workspaces must have clear explanations and recovery paths.
