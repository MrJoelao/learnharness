# 05 — UX specification

## 1. Navigation structure

The sidebar keeps the existing overall structure. Add **Study Hub** immediately below **New Session**.

The common content area below it contains one mixed tree of folders, chats and workspaces.

Conceptual example:

```text
New Session
Study Hub
────────────────────
▾ Sicurezza informatica
    ◉ Teaching session
    ▣ Memory & Paging Lab
    ▣ TCP/IP Simulator
    ◉ Teaching session
▾ Algoritmi
    ◉ Teaching session
    ▣ Tree Visualizer
◉ Unorganized chat
▣ Unorganized workspace
────────────────────
Archive
Settings
```

Symbols are illustrative only. Use the app's established icon system.

### Critical rule
Do not create separate `Workspaces`, `Modes` or `Labs` sidebar sections. Do not split the tree into chat and workspace groups. The common list is the product behavior.

## 2. Study Hub page

Study Hub is a catalog and launcher.

### Header
- Title: Study Hub.
- Short description explaining that the learner can open interactive learning tools.
- Search field.
- Lightweight category/topic filters.

### Mode cards/list items
Each mode should display:
- Icon.
- Name.
- One-sentence description.
- Optional category/tags.
- Optional difficulty/activity label only if it adds real decision value.
- Clear launch action.

Avoid overloading cards with metadata. Search and filters should remain secondary to the mode name and description.

### States
- Loading: stable skeleton or concise loading state.
- Empty catalog: explain that no modes are currently available and point to plugin management/developer examples if appropriate.
- No search results: offer clear query reset.
- Plugin unavailable: do not show an unusable launch action.
- Registration error: surface a useful diagnostic in developer-facing context, not a raw stack trace to learners.

## 3. Creating a workspace

When a learner launches a mode:
1. Create a new independent instance.
2. Navigate to the new workspace.
3. Add it to the common sidebar tree at root/unorganized.
4. Do not ask which folder to use.
5. Do not automatically place it in the currently selected folder.

The learner may move it afterward using the same existing drag-and-drop/context-menu interactions as a chat.

## 4. Mixed sidebar item rendering

Both item types must share:
- Row height and alignment.
- Hover and selected states.
- Keyboard focus behavior.
- Context-menu placement and interaction.
- Drag handle/drag ghost/drop indicators.
- Folder indentation.
- Sibling reorder behavior.
- Archive and restore affordances.
- Responsive behavior.

Allowed visual distinction:
- Different leading icon for chat vs workspace.
- A subtle secondary cue only if usability testing demonstrates a need.

Do not add large badges or text labels that shift dates, titles or row alignment.

### Context menu
A workspace should expose applicable common actions:
- Open.
- Rename.
- Move to folder / root.
- Archive.
- Delete only if permanent deletion is implemented safely.

Chat-only actions must not appear on workspaces. Workspace-specific actions may be added later but must not clutter the common menu.

## 5. Archive

Archive is also a mixed tree/list:
- Archived chats and workspaces appear together.
- Folder archive behavior includes both entry kinds.
- Restore works for either kind.
- Workspace data is retained.
- Missing/disabled plugin entries remain visible and can be restored even if they cannot currently open.

Do not create separate archive tabs for chats and workspaces unless a demonstrated scale problem requires it.

## 6. Workspace page shell

Host-owned shell:
- Back/navigation affordance consistent with the app.
- Workspace title.
- Optional rename action.
- Plugin/mode identity may be displayed subtly.
- Main content area for plugin renderer.
- Standard loading, unavailable and error states.

Plugin body:
- Owns the experience's domain UI.
- Must not duplicate the global app sidebar or host navigation.
- Should fit within available viewport and handle its own internal scrolling.

The host should not impose a chat transcript layout on a simulator/editor.

## 7. Unavailable workspace state

If plugin is disabled, missing, or mode registration no longer exists:
- Keep the workspace in the tree.
- Show a clear unavailable state when opened.
- Explain whether enabling/reinstalling the plugin may restore access.
- Never delete state.
- Do not silently substitute another mode.

## 8. Visual explanation in teaching

When a visual artifact is generated:
- Inline presentation should have a concise explanation/title and a contained visual region.
- Provide an expand/open-panel affordance when the artifact benefits from more space.
- Provide collapse/close behavior.
- Keep surrounding chat readable.
- Do not force every visualization into a huge full-width card.
- Support reduced motion and keyboard-accessible controls.
- Preserve a meaningful static fallback if animation is disabled or unsupported.

The panel view must display the same artifact identity and state as the inline view.

## 9. Accessibility and interaction details

- All launch/open/archive/restore actions must be keyboard accessible.
- Focus should move predictably after navigation or item deletion.
- Drag-and-drop must have a keyboard/context-menu alternative.
- Icons need accessible labels/tooltips where the action is not obvious.
- Animations respect `prefers-reduced-motion`.
- Do not use color as the only indication of item type or status.
- Avoid row height changes when metadata or status appears.
