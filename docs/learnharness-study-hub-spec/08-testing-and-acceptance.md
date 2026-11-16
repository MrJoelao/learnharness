# 08 — Testing and acceptance criteria

## 1. Compatibility regression suite

- Existing API v1 plugin without mode registration still loads.
- Existing `registerView()` still creates the same static plugin view.
- Existing `placeAction()` behavior is unchanged.
- Existing question/problem types and renderers are unchanged.
- Existing plugin storage paths and data survive.
- Existing teaching and practice flows still work.
- Existing plugin enable/disable semantics remain unchanged.

## 2. Mode registry tests

- Valid mode registration appears in catalog.
- One plugin can register multiple modes.
- Duplicate mode ID within the same plugin is rejected.
- Same mode ID across different plugins is allowed if identity is `(pluginId, modeId)`.
- Invalid metadata is rejected without crashing the plugin host.
- Unregister removes the catalog entry.
- Plugin disable removes active definitions.
- Re-enable restores definitions.
- A stale async registration cannot reappear after lifecycle revocation.

## 3. Workspace persistence tests

- Create/read workspace.
- Two launches of the same mode create different IDs.
- State is isolated between instances.
- State persists after route navigation.
- State persists after application restart.
- Rename updates host metadata but does not overwrite plugin state.
- Unknown newer metadata version is preserved and refuses destructive write.
- Plugin state schema is not interpreted by host.
- Failed initialization has deterministic rollback/recovery behavior.
- Plugin disable/missing preserves workspace metadata and data.

## 4. Mixed directory and organization tests

Test all combinations:
- Chat + chat.
- Workspace + workspace.
- Chat + workspace.
- Root + nested folder.
- Active + archived.

Assertions:
- Both types appear in the same directory collection.
- Both types sort deterministically.
- Move to root/folder works.
- Reorder siblings works.
- Drag/drop uses same folder rules.
- Folder cannot be moved into itself/descendant.
- Archived folders reject new entries.
- Folder archive cascades to both entry kinds.
- Folder restore restores both entry kinds.
- Empty-folder detection sees archived and active placements according to the product rule.
- Delete-folder refuses when either entry kind remains.
- Permanent entry deletion cleans only its own placement.
- Restoring to missing folder follows documented fallback/error behavior.

## 5. Archive tests

- Chat archive behavior unchanged.
- Workspace archive does not delete workspace record.
- Workspace archive does not delete plugin-owned state.
- Both appear in the same archive view.
- Restore works for both.
- Restore after plugin disable works.
- Restore after plugin uninstall preserves unavailable entry.
- Restored workspace opens again after plugin re-enable.

## 6. UI tests

- Study Hub appears immediately below New Session.
- No separate workspace sidebar section exists.
- Chats and workspaces can be interleaved in folders.
- Both rows have aligned height, icon/title baseline and menus.
- Workspace icon does not shift other row metadata.
- Drag/drop, keyboard and context-menu actions work.
- New workspace appears at root.
- Workspace route loads correct instance.
- Unavailable workspace shows recoverable explanation.
- Archive is mixed.
- Search/filter empty states work.

## 7. Visual engine tests

- Valid artifact renders.
- Invalid schema/source is rejected.
- Oversized source is rejected.
- Unsupported renderer is rejected.
- Artifact has stable identity.
- Expand/collapse preserves state.
- Follow-up update targets correct artifact.
- Failed update preserves last known good artifact.
- Renderer cannot access host globals, credentials, storage or plugin context.
- Network and top navigation are blocked unless a separately reviewed requirement permits them.
- Runtime can be terminated.
- Animation pauses when hidden/collapsed.
- Reduced-motion mode has static fallback.
- Keyboard controls and accessible descriptions work.

## 8. Manual end-to-end acceptance scenario

The automated component and service suites cover individual interactions, but they do not launch Electron or prove the complete navigation flow in a running application. Treat the numbered scenario below as a manual Electron acceptance check; do not report it as automated end-to-end coverage unless it is run in that environment.

1. Enable a sample plugin that registers two modes.
2. Open Study Hub.
3. Launch Mode A twice.
4. Verify two separate workspace entries appear at the root.
5. Move the first workspace into a subject folder.
6. Move a chat between the two workspace entries in the same folder.
7. Reorder all three mixed entries.
8. Open both Mode A instances and verify their state is independent.
9. Archive the folder.
10. Verify both workspaces and chat appear in the same archive.
11. Restore the folder.
12. Disable the sample plugin.
13. Verify the workspace entries remain and show unavailable state.
14. Re-enable the plugin and open both workspaces with their state intact.
15. In a teaching chat, request a visual explanation.
16. Expand the artifact to panel, change a parameter via follow-up, and verify the same artifact updates.

## 9. Required implementation report

At the end of each phase T3 Code must report:
- Summary of behavior implemented.
- Files added/changed.
- Public contracts changed or added.
- Data format/migration impact.
- Tests executed and exact results.
- Tests not executed and why.
- Known limitations.
- Compatibility risks.
- Recommended next phase.

Never report a test as passed if it was not run.
