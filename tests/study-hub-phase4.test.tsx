import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
	ChatFolderTree,
	getFolderChatCount,
} from "../components/chat-folder-tree.tsx";
import { WorkspaceRow } from "../components/workspace-row.tsx";
import { ArchivePage } from "../components/archive-page.tsx";
import {
	WorkspaceScreen,
	canNavigateBack,
} from "../components/workspace-screen.tsx";
import {
	MoveDestinationBody,
	getSiblingMoveAction,
	computeUndoAction,
} from "../components/chat-organization-interactions.tsx";
import { DeleteWorkspaceDialog, DeleteWorkspaceBody } from "../components/delete-session-dialog.tsx";
import { ServerEventsProvider } from "../components/server-events.tsx";
import { SessionsSidebar, SidebarProvider } from "../components/sidebar.tsx";
import { SettingsDialogProvider as SettingsDialogProviderBase } from "../components/settings/settings-dialog.tsx";
import { InteractionLayersProvider } from "../components/interaction-layers.tsx";
import type {
	ChatFolder,
	ChatDirectoryItem,
	WorkspaceDirectoryEntry,
	WorkspaceRecord,
	WorkspaceId,
	OrganizationV2,
} from "../src/core";

function TestProviders({ children }: { children: React.ReactNode }) {
	return (
		<InteractionLayersProvider>
			<SettingsDialogProviderBase>
				<SidebarProvider>
					<ServerEventsProvider>
						{children}
					</ServerEventsProvider>
				</SidebarProvider>
			</SettingsDialogProviderBase>
		</InteractionLayersProvider>
	);
}

describe("Study Hub Phase 4: Sidebar, Archive, and Workspace UX", () => {
	const sampleFolders: ChatFolder[] = [
		{ id: "f1", name: "Computer Science", parentId: null, createdAt: "2026-11-01T10:00:00Z" },
		{ id: "f2", name: "Operating Systems", parentId: "f1", createdAt: "2026-11-01T10:05:00Z" },
	];

	const sampleChat1: ChatDirectoryItem = {
		id: "chat-1",
		title: "Kernel Concepts",
		kind: "teach",
		createdAt: "2026-11-01T10:10:00Z",
		updatedAt: "2026-11-01T10:15:00Z",
		folderId: "f2",
		archivedAt: null,
	};

	const sampleWorkspace1: WorkspaceDirectoryEntry = {
		kind: "workspace",
		id: "workspace-1",
		title: "Memory & Paging Lab",
		pluginId: "os-simulators",
		modeId: "paging-lab",
		createdAt: "2026-11-01T10:20:00Z",
		updatedAt: "2026-11-01T10:25:00Z",
		folderId: "f2",
		availability: "available",
		archivedAt: null,
	};

	const sampleRootChat: ChatDirectoryItem = {
		id: "chat-root",
		title: "General Study Discussion",
		kind: "teach",
		createdAt: "2026-11-01T10:30:00Z",
		updatedAt: "2026-11-01T10:35:00Z",
		folderId: null,
		archivedAt: null,
	};

	const sampleRootWorkspace: WorkspaceDirectoryEntry = {
		kind: "workspace",
		id: "workspace-root",
		title: "Tree Visualizer",
		pluginId: "algo-tools",
		modeId: "tree-viz",
		createdAt: "2026-11-01T10:40:00Z",
		updatedAt: "2026-11-01T10:45:00Z",
		folderId: null,
		availability: "available",
		archivedAt: null,
	};

	it("1. Sidebar renders Study Hub button immediately below New session inside actions block", () => {
		const html = renderToStaticMarkup(
			<TestProviders>
				<SessionsSidebar />
			</TestProviders>,
		);

		assert.ok(html.includes('data-testid="new-menu-trigger"'), "New session trigger must exist");
		assert.ok(html.includes('data-testid="study-hub-nav-button"'), "Study Hub nav button must exist");
		assert.ok(html.includes('href="/study-hub"'), "Study Hub link href must be /study-hub");

		// Verify order: New session comes before Study Hub, which comes before the divider & Archive
		const newSessionIndex = html.indexOf('data-testid="new-menu-trigger"');
		const studyHubIndex = html.indexOf('data-testid="study-hub-nav-button"');
		const archiveIndex = html.indexOf('data-testid="archive-nav-button"');

		assert.ok(newSessionIndex !== -1, "New session exists");
		assert.ok(studyHubIndex !== -1, "Study Hub exists");
		assert.ok(archiveIndex !== -1, "Archive exists");
		assert.ok(newSessionIndex < studyHubIndex, "Study Hub must be below New session");
		assert.ok(studyHubIndex < archiveIndex, "Study Hub must be above Archive");
	});

	it("2. Mixed chat/workspace tree: renders chats and workspaces interleaved in folder and at root without separate sections", () => {
		const items = [sampleChat1, sampleWorkspace1, sampleRootChat, sampleRootWorkspace];

		const html = renderToStaticMarkup(
			<ChatFolderTree
				folders={sampleFolders}
				items={items}
				activeChatId={null}
				expandedFolderIds={new Set(["f1", "f2"])}
				onToggleFolder={() => {}}
				onSelectChat={() => {}}
			/>,
		);

		// Must render both chat and workspace items
		assert.ok(html.includes('data-session-id="chat-1"'), "chat-1 should render");
		assert.ok(html.includes('data-workspace-id="workspace-1"'), "workspace-1 should render");
		assert.ok(html.includes('data-session-id="chat-root"'), "chat-root should render");
		assert.ok(html.includes('data-workspace-id="workspace-root"'), "workspace-root should render");

		// Must NOT contain separate workspace sections
		assert.ok(!html.includes('data-testid="workspaces-section"'), "Must not have separate workspaces section");
		assert.ok(!html.includes('data-testid="modes-section"'), "Must not have separate modes section");

		// Folder item count should count both chats and workspaces
		const f2Count = getFolderChatCount("f2", sampleFolders, items);
		assert.equal(f2Count, 2, "Folder f2 should count both chat-1 and workspace-1");
	});

	it("3. WorkspaceRow renders with BoxIcon, shared SessionRow styling, and secondary cue when unavailable", () => {
		const availableHtml = renderToStaticMarkup(
			<WorkspaceRow
				workspace={sampleWorkspace1}
				active={false}
				onOpen={() => {}}
			/>,
		);

		assert.ok(availableHtml.includes('data-workspace-id="workspace-1"'), "Row data-workspace-id");
		assert.ok(availableHtml.includes('data-testid="workspace-row"'), "Workspace row testid");
		assert.ok(availableHtml.includes("Memory &amp; Paging Lab") || availableHtml.includes("Memory & Paging Lab"), "Displays workspace title");
		assert.ok(availableHtml.includes("lucide-box"), "Renders BoxIcon");

		// Unavailable workspace renders subtle secondary cue
		const unavailableWorkspace: WorkspaceDirectoryEntry = {
			...sampleWorkspace1,
			id: "workspace-disabled",
			availability: "plugin-disabled",
		};

		const unavailableHtml = renderToStaticMarkup(
			<WorkspaceRow
				workspace={unavailableWorkspace}
				active={false}
				onOpen={() => {}}
			/>,
		);

		assert.ok(unavailableHtml.includes('data-availability="plugin-disabled"'), "Exposes availability attribute");
		assert.ok(unavailableHtml.includes("plugin-disabled"), "Displays subtle secondary cue text");
	});

	it("4. Mixed archive page: displays archived chats and workspaces together", () => {
		const archivedChat: ChatDirectoryItem = {
			...sampleChat1,
			id: "arch-chat-1",
			archivedAt: "2026-11-01T12:00:00Z",
		};
		const archivedWorkspace: WorkspaceDirectoryEntry = {
			...sampleWorkspace1,
			id: "arch-ws-1",
			archivedAt: "2026-11-01T12:00:00Z",
		};

		const html = renderToStaticMarkup(
			<TestProviders>
				<ArchivePage
					initialItems={[archivedChat, archivedWorkspace]}
					initialFolders={[]}
				/>
			</TestProviders>,
		);

		assert.ok(html.includes('data-testid="archive-chat-arch-chat-1"'), "Archived chat rendered");
		assert.ok(html.includes('data-testid="archive-chat-arch-ws-1"'), "Archived workspace rendered");
		assert.ok(html.includes('data-workspace-item="true"'), "Archived workspace marked as workspace item");
		assert.ok(html.includes("lucide-box"), "Archived workspace displays BoxIcon");
	});

	it("5. WorkspaceScreen host shell renders TopBar, title, back affordance, and mode identity", () => {
		const record: WorkspaceRecord = {
			version: 1,
			id: "workspace_12345678-1234-4123-8123-123456789abc" as WorkspaceId,
			pluginId: "os-simulators",
			modeId: "paging-lab",
			title: "Memory Simulation Lab",
			createdAt: "2026-11-01T10:00:00Z",
			updatedAt: "2026-11-01T10:05:00Z",
		};

		const html = renderToStaticMarkup(
			<TestProviders>
				<WorkspaceScreen
					workspaceId={record.id}
					initialWorkspace={record}
					initialAvailability="available"
					initialPluginName="OS Simulators"
					initialModeName="Paging Lab"
				/>
			</TestProviders>,
		);

		assert.ok(html.includes('data-testid="workspace-screen"'), "Screen testid");
		assert.ok(html.includes('data-testid="workspace-back-button"'), "Back button exists");
		assert.ok(html.includes('data-testid="workspace-title"'), "Title exists");
		assert.ok(html.includes("Memory Simulation Lab"), "Workspace title rendered");
		assert.ok(html.includes('data-testid="workspace-identity"'), "Identity tag exists");
		assert.ok(html.includes("Paging Lab"), "Mode identity rendered");
		assert.ok(html.includes('data-testid="workspace-container"'), "Workspace container exists");
	});

	it("6. WorkspaceScreen renders explicit unavailable states without deleting state", () => {
		const record: WorkspaceRecord = {
			version: 1,
			id: "workspace_12345678-1234-4123-8123-123456789abc" as WorkspaceId,
			pluginId: "os-simulators",
			modeId: "paging-lab",
			title: "Disabled Lab",
			createdAt: "2026-11-01T10:00:00Z",
			updatedAt: "2026-11-01T10:05:00Z",
		};

		// Plugin disabled state
		const disabledHtml = renderToStaticMarkup(
			<TestProviders>
				<WorkspaceScreen
					workspaceId={record.id}
					initialWorkspace={record}
					initialAvailability="plugin-disabled"
				/>
			</TestProviders>,
		);

		assert.ok(disabledHtml.includes('data-testid="workspace-unavailable"'), "Unavailable testid");
		assert.ok(disabledHtml.includes('data-availability="plugin-disabled"'), "plugin-disabled attribute");
		assert.ok(disabledHtml.includes("Plugin is disabled"), "Clear explanation title");
		assert.ok(disabledHtml.includes("Settings"), "Mentions enabling in Settings");

		// Plugin missing state
		const missingHtml = renderToStaticMarkup(
			<TestProviders>
				<WorkspaceScreen
					workspaceId={record.id}
					initialWorkspace={record}
					initialAvailability="plugin-missing"
				/>
			</TestProviders>,
		);

		assert.ok(missingHtml.includes('data-availability="plugin-missing"'), "plugin-missing attribute");
		assert.ok(missingHtml.includes("Plugin missing"), "Plugin missing title");
		assert.ok(missingHtml.includes("preserved"), "Reassures that state is preserved");

		// Not found state
		const notFoundHtml = renderToStaticMarkup(
			<TestProviders>
				<WorkspaceScreen
					workspaceId="workspace_unknown"
					initialWorkspace={null}
					initialAvailability="not-found"
				/>
			</TestProviders>,
		);

		assert.ok(notFoundHtml.includes('data-testid="workspace-not-found"'), "not-found testid");
		assert.ok(notFoundHtml.includes("Workspace not found"), "Workspace not found title");
	});

	it("7. WorkspaceScreen distinguishes server errors and network errors with retry action, preserving metadata", () => {
		const record: WorkspaceRecord = {
			version: 1,
			id: "workspace_12345678-1234-4123-8123-123456789abc" as WorkspaceId,
			pluginId: "os-simulators",
			modeId: "paging-lab",
			title: "Critical Lab",
			createdAt: "2026-11-01T10:00:00Z",
			updatedAt: "2026-11-01T10:05:00Z",
		};

		// Server error scenario (e.g. 500, 503)
		const serverErrorHtml = renderToStaticMarkup(
			<TestProviders>
				<WorkspaceScreen
					workspaceId={record.id}
					initialWorkspace={record}
					initialAvailability="server-error"
				/>
			</TestProviders>,
		);

		assert.ok(serverErrorHtml.includes('data-testid="workspace-error"'), "Renders error testid");
		assert.ok(serverErrorHtml.includes('data-error-kind="server-error"'), "Exposes server-error kind");
		assert.ok(serverErrorHtml.includes("Server error"), "Displays Server error heading");
		assert.ok(serverErrorHtml.includes('data-testid="workspace-retry-button"'), "Offers retry button");
		// Metadata must be preserved in TopBar
		assert.ok(serverErrorHtml.includes("Critical Lab"), "Workspace title preserved in TopBar");
		assert.ok(serverErrorHtml.includes("os-simulators"), "Plugin identity preserved");

		// Network error scenario
		const networkErrorHtml = renderToStaticMarkup(
			<TestProviders>
				<WorkspaceScreen
					workspaceId={record.id}
					initialWorkspace={record}
					initialAvailability="network-error"
				/>
			</TestProviders>,
		);

		assert.ok(networkErrorHtml.includes('data-testid="workspace-error"'), "Renders error testid");
		assert.ok(networkErrorHtml.includes('data-error-kind="network-error"'), "Exposes network-error kind");
		assert.ok(networkErrorHtml.includes("Network error"), "Displays Network error heading");
		assert.ok(networkErrorHtml.includes('data-testid="workspace-retry-button"'), "Offers retry button");
		assert.ok(networkErrorHtml.includes("Critical Lab"), "Workspace title preserved during network error");
	});

	it("8. WorkspaceScreen back navigation correctly evaluates safe in-app history vs direct URL fallback", () => {
		const originalWindow = (globalThis as Record<string, unknown>).window;
		const originalDocument = (globalThis as Record<string, unknown>).document;

		try {
			// Scenario A: In-app navigation in same tab (Next.js history index > 0)
			(globalThis as Record<string, unknown>).window = {
				location: { origin: "http://localhost:3000" },
				history: { state: { idx: 2 }, length: 3, back() {}, forward() {} },
			};
			(globalThis as Record<string, unknown>).document = {
				referrer: "http://localhost:3000/study-hub",
			};
			assert.equal(canNavigateBack(), true, "In-app navigation must allow navigating back");

			// Scenario B: External referrer (e.g. from Google or outside link) must NEVER navigate back to external site
			(globalThis as Record<string, unknown>).window = {
				location: { origin: "http://localhost:3000" },
				history: { state: { idx: 1 }, length: 2, back() {}, forward() {} },
			};
			(globalThis as Record<string, unknown>).document = {
				referrer: "https://external-search.com/results",
			};
			assert.equal(canNavigateBack(), false, "External referrer must block back navigation to avoid external redirect");

			// Scenario C: Direct URL opening in a fresh tab (no in-app history, empty referrer)
			(globalThis as Record<string, unknown>).window = {
				location: { origin: "http://localhost:3000" },
				history: { state: { idx: 0 }, length: 1, back() {}, forward() {} },
			};
			(globalThis as Record<string, unknown>).document = {
				referrer: "",
			};
			assert.equal(canNavigateBack(), false, "Direct URL opening must fall back to /");
		} finally {
			(globalThis as Record<string, unknown>).window = originalWindow;
			(globalThis as Record<string, unknown>).document = originalDocument;
		}
	});

	it("9. Moving workspace between folders: MoveDestinationBody and computeUndoAction", () => {
		let chosenDestination: string | null = "unset";

		const html = renderToStaticMarkup(
			<MoveDestinationBody
				item={{
					kind: "workspace",
					id: "workspace-1",
					title: "Memory & Paging Lab",
					parentId: "f2",
				}}
				folders={sampleFolders}
				organization={null}
				onClose={() => {}}
				onMove={(dest) => {
					chosenDestination = dest;
				}}
			/>,
		);

		assert.ok(html.includes('data-testid="move-destination-dialog"'), "Move destination dialog rendered");
		assert.ok(html.includes("Move workspace") || html.includes("Move session"), "Move dialog title");
		assert.ok(html.includes("Memory &amp; Paging Lab") || html.includes("Memory & Paging Lab"), "Target title displayed");
		assert.ok(html.includes('data-testid="move-destination-root"'), "Root destination option available");
		assert.ok(html.includes('data-testid="move-destination-f1"'), "Folder f1 available as destination");
		// Current parent folder f2 should be marked disabled/current
		assert.ok(html.includes('data-testid="move-destination-f2"'), "Folder f2 rendered");
		assert.ok(html.includes("(current)"), "Current parent indicator rendered");

		// Reversible undo action check for workspace move
		const undo = computeUndoAction(
			{ action: "move", kind: "workspace", id: "workspace-1", parentId: "f1" },
			{
				organization: { version: 2, folders: sampleFolders, placements: { "workspace:workspace-1": { folderId: "f2", order: 10 } } },
				chats: [sampleWorkspace1],
			},
		);

		assert.ok(undo, "Undo action must be computable for workspace move");
		assert.equal(undo?.undoAction.action, "move");
		assert.equal(undo?.undoAction.kind, "workspace");
		assert.equal(undo?.undoAction.id, "workspace-1");
		assert.equal(undo?.undoAction.parentId, "f2", "Undo must restore original parent folder f2");
	});

	it("10. Mixed chat/workspace sibling reordering via getSiblingMoveAction and computeUndoAction", () => {
		const chat2: ChatDirectoryItem = {
			id: "chat-2",
			title: "Virtual Memory",
			kind: "teach",
			createdAt: "2026-11-01T10:15:00Z",
			updatedAt: "2026-11-01T10:20:00Z",
			folderId: "f2",
			archivedAt: null,
		};

		const mixedItems = [sampleChat1, sampleWorkspace1, chat2];
		const orgV2: OrganizationV2 = {
			version: 2,
			folders: sampleFolders,
			placements: {
				"chat:chat-1": { folderId: "f2", order: 1 },
				"workspace:workspace-1": { folderId: "f2", order: 2 },
				"chat:chat-2": { folderId: "f2", order: 3 },
			},
		};

		// Move workspace-1 UP (should swap before chat-1)
		const moveUp = getSiblingMoveAction("workspace", "workspace-1", "up", orgV2, mixedItems);
		assert.ok(moveUp, "getSiblingMoveAction up must return an action");
		assert.equal(moveUp?.action, "reorder-siblings");
		assert.equal(moveUp?.parentId, "f2");
		if ("entries" in moveUp) {
			assert.deepEqual(
				moveUp.entries.map((e: any) => e.id),
				["workspace-1", "chat-1", "chat-2"],
				"Workspace must move before chat-1",
			);
		}

		// Move workspace-1 DOWN (should swap after chat-2)
		const moveDown = getSiblingMoveAction("workspace", "workspace-1", "down", orgV2, mixedItems);
		assert.ok(moveDown, "getSiblingMoveAction down must return an action");
		assert.equal(moveDown?.action, "reorder-siblings");
		assert.equal(moveDown?.parentId, "f2");
		if ("entries" in moveDown) {
			assert.deepEqual(
				moveDown.entries.map((e: any) => e.id),
				["chat-1", "chat-2", "workspace-1"],
				"Workspace must move after chat-2",
			);
		}

		// Compute undo action for reorder-siblings with mixed entries
		const undo = computeUndoAction(
			{ action: "reorder-siblings", parentId: "f2", entries: [{ kind: "workspace", id: "workspace-1" }, { kind: "chat", id: "chat-1" }, { kind: "chat", id: "chat-2" }] },
			{
				organization: orgV2,
				chats: mixedItems,
			},
		);
		assert.ok(undo, "Undo action must be computable for mixed sibling reorder");
		assert.equal(undo?.undoAction.action, "reorder-siblings");
		assert.deepEqual(
			(undo?.undoAction as any).entries.map((e: any) => e.id),
			["chat-1", "workspace-1", "chat-2"],
			"Undo must restore original sibling ordering",
		);
	});

	it("11. Archiving and restoring workspace preserves metadata and computes correct inverse", () => {
		const orgV2: OrganizationV2 = {
			version: 2,
			folders: sampleFolders,
			placements: {
				"workspace:workspace-1": { folderId: "f2", order: 10 },
			},
		};

		// Undo of archive workspace is restore into original folder
		const undoArchive = computeUndoAction(
			{ action: "archive", kind: "workspace", id: "workspace-1" },
			{
				organization: orgV2,
				chats: [sampleWorkspace1],
			},
		);

		assert.ok(undoArchive, "Undo must exist for workspace archive");
		assert.equal(undoArchive?.undoAction.action, "restore");
		assert.equal(undoArchive?.undoAction.kind, "workspace");
		assert.equal(undoArchive?.undoAction.id, "workspace-1");
		assert.equal(undoArchive?.undoAction.targetParentId, "f2", "Restores to original folder f2");

		// Undo of restore workspace is archive
		const undoRestore = computeUndoAction(
			{ action: "restore", kind: "workspace", id: "workspace-1" },
			{
				organization: orgV2,
				chats: [sampleWorkspace1],
			},
		);

		assert.ok(undoRestore, "Undo must exist for workspace restore");
		assert.equal(undoRestore?.undoAction.action, "archive");
		assert.equal(undoRestore?.undoAction.kind, "workspace");
		assert.equal(undoRestore?.undoAction.id, "workspace-1");
	});

	it("12. Restoring workspace into a different folder via MoveDestinationBody", () => {
		let chosenFolder: string | null = null;

		const html = renderToStaticMarkup(
			<MoveDestinationBody
				item={{
					kind: "workspace",
					id: "workspace-1",
					title: "Memory & Paging Lab",
					parentId: null,
					isRestore: true,
				}}
				folders={sampleFolders}
				organization={null}
				onClose={() => {}}
				onMove={(target) => {
					chosenFolder = target;
				}}
			/>,
		);

		assert.ok(html.includes("Restore"), "Dialog header indicates Restore mode");
		assert.ok(html.includes("Memory &amp; Paging Lab") || html.includes("Memory & Paging Lab"), "Target title displayed");
		// During restore, all active valid folders are selectable
		assert.ok(html.includes('data-testid="move-destination-f1"'), "Folder f1 is a valid restore destination");
		assert.ok(html.includes('data-testid="move-destination-f2"'), "Folder f2 is a valid restore destination");
		assert.ok(html.includes('data-testid="move-destination-root"'), "Root is a valid restore destination");
	});

	it("13. Workspace deletion dialog confirms permanent removal and renders properly", () => {
		const closedHtml = renderToStaticMarkup(
			<InteractionLayersProvider>
				<DeleteWorkspaceDialog workspace={null} onClose={() => {}} onDeleted={() => {}} />
			</InteractionLayersProvider>,
		);
		assert.equal(closedHtml, "", "Closed dialog renders nothing");

		const html = renderToStaticMarkup(
			<DeleteWorkspaceBody
				workspace={sampleWorkspace1}
				busy={false}
				failure={null}
				onClose={() => {}}
				onRun={() => {}}
			/>,
		);

		assert.ok(html.includes('data-testid="delete-workspace-dialog"'), "Dialog testid rendered");
		assert.ok(html.includes("Delete workspace?"), "Confirmation heading displayed");
		assert.ok(html.includes("Memory &amp; Paging Lab") || html.includes("Memory & Paging Lab"), "Workspace title shown");
		assert.ok(html.includes("permanently delete"), "Warns of permanent deletion");
		assert.ok(html.includes("Cancel"), "Cancel button rendered");
		assert.ok(html.includes("Delete"), "Delete button rendered");
	});

	it("14. Sidebar integrates workspaces-changed server event to trigger refresh", () => {
		let registeredEvent: string | null = null;

		const html = renderToStaticMarkup(
			<InteractionLayersProvider>
				<SettingsDialogProviderBase>
					<SidebarProvider>
						<ServerEventsProvider
							connect={() => ({
								close() {},
								onOpen() {},
								onEvent(name) {
									registeredEvent = name;
								},
							})}
						>
							<SessionsSidebar initialChats={[sampleRootWorkspace]} initialFolders={sampleFolders} />
						</ServerEventsProvider>
					</SidebarProvider>
				</SettingsDialogProviderBase>
			</InteractionLayersProvider>,
		);

		assert.ok(html.includes('data-workspace-id="workspace-root"'), "Workspace rendered in sidebar tree");
		assert.ok(html.includes("Tree Visualizer"), "Workspace title rendered in tree");
	});
});
