import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";
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
import { PluginsContext } from "../components/plugins.tsx";
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

	it("8. WorkspaceScreen back navigation correctly prioritizes in-app history over external referrer", () => {
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

			// Scenario B (Audit Fix): External referrer BUT user navigated inside app (history.state.idx > 0) -> MUST allow back!
			(globalThis as Record<string, unknown>).window = {
				location: { origin: "http://localhost:3000" },
				history: { state: { idx: 1 }, length: 2, back() {}, forward() {} },
			};
			(globalThis as Record<string, unknown>).document = {
				referrer: "https://external-search.com/results",
			};
			assert.equal(canNavigateBack(), true, "External referrer with in-app history (idx > 0) must allow navigating back inside SPA");

			// Scenario C: External referrer WITHOUT in-app history (direct entry point from outside) -> MUST block back!
			(globalThis as Record<string, unknown>).window = {
				location: { origin: "http://localhost:3000" },
				history: { state: { idx: 0 }, length: 1, back() {}, forward() {} },
			};
			(globalThis as Record<string, unknown>).document = {
				referrer: "https://external-search.com/results",
			};
			assert.equal(canNavigateBack(), false, "External referrer without in-app history must block back navigation to avoid external redirect");

			// Scenario D: Direct URL opening in a fresh tab (no in-app history, empty referrer)
			(globalThis as Record<string, unknown>).window = {
				location: { origin: "http://localhost:3000" },
				history: { state: { idx: 0 }, length: 1, back() {}, forward() {} },
			};
			(globalThis as Record<string, unknown>).document = {
				referrer: "",
			};
			assert.equal(canNavigateBack(), false, "Direct URL opening must fall back to /");

			// Scenario E: Same-origin referrer with history.length > 1 fallback when idx is missing
			(globalThis as Record<string, unknown>).window = {
				location: { origin: "http://localhost:3000" },
				history: { state: null, length: 2, back() {}, forward() {} },
			};
			(globalThis as Record<string, unknown>).document = {
				referrer: "http://localhost:3000/archive",
			};
			assert.equal(canNavigateBack(), true, "Same-origin referrer with history must allow back even if idx is null");
		} finally {
			(globalThis as Record<string, unknown>).window = originalWindow;
			(globalThis as Record<string, unknown>).document = originalDocument;
		}
	});

	it("9. Moving workspace between folders: MoveDestinationBody selection interaction and computeUndoAction", async () => {
		const dom = parseHTML("<html><head></head><body><div id='root'></div></body></html>");
		const originalWindow = (globalThis as Record<string, unknown>).window;
		const originalDocument = (globalThis as Record<string, unknown>).document;
		const originalHTMLElement = (globalThis as Record<string, unknown>).HTMLElement;
		const originalElement = (globalThis as Record<string, unknown>).Element;
		const originalNode = (globalThis as Record<string, unknown>).Node;
		const originalAct = (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT;

		Object.assign(globalThis, {
			window: dom.window,
			document: dom.document,
			HTMLElement: dom.window.HTMLElement,
			Element: dom.window.Element,
			Node: dom.window.Node,
			IS_REACT_ACT_ENVIRONMENT: true,
		});

		try {
			let chosenDestination: string | null = "unset";
			const root = createRoot(dom.document.getElementById("root")!);

			await act(async () => {
				root.render(
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
			});

			// Verify interactive click on destination folder invokes onMove with folder ID
			const f1Btn = dom.document.querySelector<HTMLButtonElement>('[data-testid="move-destination-f1"]');
			assert.ok(f1Btn, "Folder f1 button rendered");
			await act(async () => {
				f1Btn.click();
			});
			assert.equal(chosenDestination, "f1", "Selecting folder f1 invokes onMove('f1')");

			// Verify interactive click on root destination invokes onMove with null
			const rootBtn = dom.document.querySelector<HTMLButtonElement>('[data-testid="move-destination-root"]');
			assert.ok(rootBtn, "Root button rendered");
			await act(async () => {
				rootBtn.click();
			});
			assert.equal(chosenDestination, null, "Selecting Root invokes onMove(null)");

			await act(async () => {
				root.unmount();
			});

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
		} finally {
			(globalThis as Record<string, unknown>).window = originalWindow;
			(globalThis as Record<string, unknown>).document = originalDocument;
			(globalThis as Record<string, unknown>).HTMLElement = originalHTMLElement;
			(globalThis as Record<string, unknown>).Element = originalElement;
			(globalThis as Record<string, unknown>).Node = originalNode;
			(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = originalAct;
		}
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

	it("12. Restoring workspace into a different folder: destination selection passes targetParentId", async () => {
		const dom = parseHTML("<html><head></head><body><div id='root'></div></body></html>");
		const originalWindow = (globalThis as Record<string, unknown>).window;
		const originalDocument = (globalThis as Record<string, unknown>).document;
		const originalHTMLElement = (globalThis as Record<string, unknown>).HTMLElement;
		const originalElement = (globalThis as Record<string, unknown>).Element;
		const originalNode = (globalThis as Record<string, unknown>).Node;
		const originalAct = (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT;

		Object.assign(globalThis, {
			window: dom.window,
			document: dom.document,
			HTMLElement: dom.window.HTMLElement,
			Element: dom.window.Element,
			Node: dom.window.Node,
			IS_REACT_ACT_ENVIRONMENT: true,
		});

		try {
			let chosenFolder: string | null = null;
			const root = createRoot(dom.document.getElementById("root")!);

			await act(async () => {
				root.render(
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
			});

			const f2Btn = dom.document.querySelector<HTMLButtonElement>('[data-testid="move-destination-f2"]');
			assert.ok(f2Btn, "Folder f2 button rendered in restore dialog");
			await act(async () => {
				f2Btn.click();
			});
			assert.equal(chosenFolder, "f2", "Clicking destination folder in restore dialog invokes onMove with 'f2'");

			// Verify that the restore action constructed with this destination passes targetParentId
			const restoreAction: import("../src/core").ChatOrganizationAction = {
				action: "restore",
				kind: "workspace",
				id: "workspace-1",
				targetParentId: chosenFolder,
			};
			assert.equal(restoreAction.targetParentId, "f2", "Restore action targetParentId reflects user selection");

			await act(async () => {
				root.unmount();
			});
		} finally {
			(globalThis as Record<string, unknown>).window = originalWindow;
			(globalThis as Record<string, unknown>).document = originalDocument;
			(globalThis as Record<string, unknown>).HTMLElement = originalHTMLElement;
			(globalThis as Record<string, unknown>).Element = originalElement;
			(globalThis as Record<string, unknown>).Node = originalNode;
			(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = originalAct;
		}
	});

	it("13. Workspace deletion dialog confirms permanent removal and invokes deletion action", async () => {
		const dom = parseHTML("<html><head></head><body><div id='root'></div></body></html>");
		const originalWindow = (globalThis as Record<string, unknown>).window;
		const originalDocument = (globalThis as Record<string, unknown>).document;
		const originalHTMLElement = (globalThis as Record<string, unknown>).HTMLElement;
		const originalElement = (globalThis as Record<string, unknown>).Element;
		const originalNode = (globalThis as Record<string, unknown>).Node;
		const originalAct = (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT;

		Object.assign(globalThis, {
			window: dom.window,
			document: dom.document,
			HTMLElement: dom.window.HTMLElement,
			Element: dom.window.Element,
			Node: dom.window.Node,
			IS_REACT_ACT_ENVIRONMENT: true,
		});

		try {
			let deleteInvoked = false;
			const root = createRoot(dom.document.getElementById("root")!);

			await act(async () => {
				root.render(
					<DeleteWorkspaceBody
						workspace={sampleWorkspace1}
						busy={false}
						failure={null}
						onClose={() => {}}
						onRun={() => {
							deleteInvoked = true;
						}}
					/>,
				);
			});

			const buttons = Array.from(dom.document.querySelectorAll<HTMLButtonElement>("button"));
			const deleteBtn = buttons.find((b) => b.textContent?.trim() === "Delete");
			assert.ok(deleteBtn, "Delete button rendered");

			await act(async () => {
				deleteBtn.click();
			});

			assert.equal(deleteInvoked, true, "Clicking Delete confirms and invokes onRun callback");

			await act(async () => {
				root.unmount();
			});
		} finally {
			(globalThis as Record<string, unknown>).window = originalWindow;
			(globalThis as Record<string, unknown>).document = originalDocument;
			(globalThis as Record<string, unknown>).HTMLElement = originalHTMLElement;
			(globalThis as Record<string, unknown>).Element = originalElement;
			(globalThis as Record<string, unknown>).Node = originalNode;
			(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = originalAct;
		}
	});

	it("14. Sidebar registers and executes workspaces-changed server event to trigger refresh", async () => {
		const dom = parseHTML("<html><head></head><body><div id='root'></div></body></html>");
		const originalWindow = (globalThis as Record<string, unknown>).window;
		const originalSelf = (globalThis as Record<string, unknown>).self;
		const originalDocument = (globalThis as Record<string, unknown>).document;
		const originalHTMLElement = (globalThis as Record<string, unknown>).HTMLElement;
		const originalElement = (globalThis as Record<string, unknown>).Element;
		const originalNode = (globalThis as Record<string, unknown>).Node;
		const originalAct = (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT;
		const originalFetch = globalThis.fetch;
		const originalLocalStorage = (globalThis as Record<string, unknown>).localStorage;
		const originalRIC = (globalThis as Record<string, unknown>).requestIdleCallback;
		const originalCIC = (globalThis as Record<string, unknown>).cancelIdleCallback;
		const originalIO = (globalThis as Record<string, unknown>).IntersectionObserver;

		let workspacesCallback: ((data: string) => void) | null = null;
		let fetchCalls: string[] = [];

		class MockIntersectionObserver {
			observe() {}
			unobserve() {}
			disconnect() {}
		}

		Object.assign(globalThis, {
			window: dom.window,
			self: dom.window,
			document: dom.document,
			HTMLElement: dom.window.HTMLElement,
			Element: dom.window.Element,
			Node: dom.window.Node,
			IS_REACT_ACT_ENVIRONMENT: true,
			localStorage: { getItem: () => null, setItem() {} },
			requestIdleCallback: (cb: () => void) => setTimeout(cb, 0),
			cancelIdleCallback: (id: NodeJS.Timeout) => clearTimeout(id),
			IntersectionObserver: MockIntersectionObserver,
			fetch: async (input: RequestInfo | URL) => {
				const url = String(input);
				fetchCalls.push(url);
				if (url.includes("/api/chats/organization")) {
					return Response.json({ version: 2, folders: sampleFolders, placements: {} });
				}
				if (url.includes("/api/directory")) {
					return Response.json({ items: [sampleRootWorkspace] });
				}
				if (url.includes("/api/chats")) {
					return Response.json({ chats: [] });
				}
				return Response.json({});
			},
		});

		try {
			const root = createRoot(dom.document.getElementById("root")!);

			await act(async () => {
				root.render(
					<InteractionLayersProvider>
						<SettingsDialogProviderBase>
							<SidebarProvider>
								<ServerEventsProvider
									connect={() => ({
										close() {},
										onOpen() {},
										onEvent(name, cb) {
											if (name === "workspaces-changed") {
												workspacesCallback = cb;
											}
										},
									})}
								>
									<SessionsSidebar initialChats={[sampleRootWorkspace]} initialFolders={sampleFolders} />
								</ServerEventsProvider>
							</SidebarProvider>
						</SettingsDialogProviderBase>
					</InteractionLayersProvider>,
				);
			});

			assert.ok(workspacesCallback !== null, "Sidebar must register a listener for 'workspaces-changed'");

			// Reset recorded fetches to specifically test the event execution
			fetchCalls = [];

			// Dispatch the workspaces-changed event to the registered listener
			await act(async () => {
				workspacesCallback!("{}");
				// scheduleEventRefresh has a 250ms debounce
				await new Promise((resolve) => setTimeout(resolve, 350));
			});

			// Verify that the callback executed and triggered a refresh fetch
			assert.ok(
				fetchCalls.some((url) => url.includes("/api/directory") || url.includes("/api/chats")),
				`Event dispatch must execute refresh; fetches recorded: ${JSON.stringify(fetchCalls)}`,
			);

			await act(async () => {
				root.unmount();
			});
		} finally {
			globalThis.fetch = originalFetch;
			(globalThis as Record<string, unknown>).window = originalWindow;
			(globalThis as Record<string, unknown>).self = originalSelf;
			(globalThis as Record<string, unknown>).document = originalDocument;
			(globalThis as Record<string, unknown>).HTMLElement = originalHTMLElement;
			(globalThis as Record<string, unknown>).Element = originalElement;
			(globalThis as Record<string, unknown>).Node = originalNode;
			(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = originalAct;
			(globalThis as Record<string, unknown>).localStorage = originalLocalStorage;
			(globalThis as Record<string, unknown>).requestIdleCallback = originalRIC;
			(globalThis as Record<string, unknown>).cancelIdleCallback = originalCIC;
			(globalThis as Record<string, unknown>).IntersectionObserver = originalIO;
		}
	});

	it("15. Sidebar routes workspace organization actions to /api/directory and legacy chat actions to /api/chats/organization", async () => {
		const dom = parseHTML("<html><head></head><body><div id='root'></div></body></html>");
		const originalWindow = (globalThis as Record<string, unknown>).window;
		const originalSelf = (globalThis as Record<string, unknown>).self;
		const originalDocument = (globalThis as Record<string, unknown>).document;
		const originalHTMLElement = (globalThis as Record<string, unknown>).HTMLElement;
		const originalElement = (globalThis as Record<string, unknown>).Element;
		const originalNode = (globalThis as Record<string, unknown>).Node;
		const originalAct = (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT;
		const originalFetch = globalThis.fetch;
		const originalLocalStorage = (globalThis as Record<string, unknown>).localStorage;
		const originalRIC = (globalThis as Record<string, unknown>).requestIdleCallback;
		const originalRAF = (globalThis as Record<string, unknown>).requestAnimationFrame;
		const originalCAF = (globalThis as Record<string, unknown>).cancelAnimationFrame;
		const originalCustomEvent = (globalThis as Record<string, unknown>).CustomEvent;
		const originalEvent = (globalThis as Record<string, unknown>).Event;

		const postCalls: { url: string; body: any }[] = [];
		let mockDirectoryStatus = 200;

		class MockIntersectionObserver {
			observe() {}
			unobserve() {}
			disconnect() {}
		}

		try {
			Object.defineProperty(Event.prototype, "eventPhase", { writable: true, configurable: true, value: 0 });
		} catch {}

		Object.assign(globalThis, {
			window: dom.window,
			self: dom.window,
			document: dom.document,
			HTMLElement: dom.window.HTMLElement,
			Element: dom.window.Element,
			Node: dom.window.Node,
			CustomEvent: dom.window.CustomEvent,
			Event: dom.window.Event,
			IS_REACT_ACT_ENVIRONMENT: true,
			localStorage: { getItem: () => null, setItem() {} },
			requestIdleCallback: (cb: () => void) => setTimeout(cb, 0),
			cancelIdleCallback: (id: NodeJS.Timeout) => clearTimeout(id),
			requestAnimationFrame: (cb: () => void) => setTimeout(cb, 0),
			cancelAnimationFrame: (id: NodeJS.Timeout) => clearTimeout(id),
			IntersectionObserver: MockIntersectionObserver,
			fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
				const url = String(input);
				const method = init?.method ?? "GET";
				if (method === "POST") {
					const body = init?.body ? JSON.parse(String(init.body)) : null;
					postCalls.push({ url, body });
					if (url.includes("/api/directory")) {
						if (mockDirectoryStatus !== 200) {
							return new Response(JSON.stringify({ error: "Directory operation failed" }), { status: mockDirectoryStatus });
						}
						return Response.json({
							organization: { version: 2, folders: sampleFolders, placements: {} },
							folders: sampleFolders,
							items: [sampleRootWorkspace],
						});
					}
					return Response.json({
						organization: { version: 1, folders: sampleFolders, chats: {} },
						chats: [sampleRootChat],
					});
				}
				if (url.includes("/api/directory?archived=true")) {
					return Response.json({ archivedFolders: [], items: [] });
				}
				if (url.includes("/api/directory")) {
					return Response.json({
						organization: { version: 2, folders: sampleFolders, placements: {} },
						folders: sampleFolders,
						items: [sampleRootWorkspace, sampleRootChat],
					});
				}
				if (url.includes("/api/chats/organization")) {
					return Response.json({ version: 1, folders: sampleFolders, chats: {} });
				}
				if (url.includes("/api/chats")) {
					return Response.json({ chats: [sampleRootChat] });
				}
				return Response.json({});
			},
		});

		try {
			const container = dom.document.getElementById("root")!;
			const root = createRoot(container as unknown as HTMLElement);

			await act(async () => {
				root.render(
					<InteractionLayersProvider>
						<SettingsDialogProviderBase>
							<SidebarProvider>
								<ServerEventsProvider
									connect={() => ({
										close() {},
										onOpen() {},
										onEvent() {},
									})}
								>
									<SessionsSidebar
										initialChats={[sampleRootWorkspace, sampleRootChat]}
										initialFolders={sampleFolders}
									/>
								</ServerEventsProvider>
							</SidebarProvider>
						</SettingsDialogProviderBase>
					</InteractionLayersProvider>,
				);
			});

			// 1. Right-click workspace row to open context menu and archive
			const wsBtn = container.querySelector('[data-testid="workspace-row"]');
			assert.ok(wsBtn, "Workspace row button should be present");

			await act(async () => {
				const event = new dom.window.Event("contextmenu", { bubbles: true, cancelable: true });
				wsBtn.dispatchEvent(event);
			});

			// Find ctx-archive button in context menu portal on dom.document.body
			const archiveBtn = dom.document.querySelector('[data-testid="ctx-archive"]') as HTMLElement | null;
			assert.ok(archiveBtn, "Context menu archive button should be present");

			postCalls.length = 0;
			await act(async () => {
				archiveBtn.click();
			});

			// Verify workspace archive called /api/directory, NOT /api/chats/organization
			assert.equal(postCalls.length, 1, "Exactly one POST call should be made");
			assert.ok(postCalls[0]!.url.includes("/api/directory"), `Workspace archive must target /api/directory, got ${postCalls[0]!.url}`);
			assert.equal(postCalls[0]!.body.action, "archive");
			assert.equal(postCalls[0]!.body.kind, "workspace");
			assert.equal(postCalls[0]!.body.id, sampleRootWorkspace.id);

			// 2. Right-click chat row to open context menu and archive
			const chatBtn = container.querySelector('[data-testid="session-row"]');
			assert.ok(chatBtn, "Chat row button should be present");

			await act(async () => {
				const event = new dom.window.Event("contextmenu", { bubbles: true, cancelable: true });
				chatBtn.dispatchEvent(event);
			});

			const chatArchiveBtn = dom.document.querySelector('[data-testid="ctx-archive"]') as HTMLElement | null;
			assert.ok(chatArchiveBtn, "Chat context menu archive button should be present");

			postCalls.length = 0;
			await act(async () => {
				chatArchiveBtn.click();
			});

			// Verify legacy chat archive called /api/chats/organization
			assert.equal(postCalls.length, 1, "Exactly one POST call should be made for chat");
			assert.ok(postCalls[0]!.url.includes("/api/chats/organization"), `Chat archive must target /api/chats/organization, got ${postCalls[0]!.url}`);
			assert.equal(postCalls[0]!.body.action, "archive");
			assert.equal(postCalls[0]!.body.kind, "chat");
			assert.equal(postCalls[0]!.body.id, sampleRootChat.id);

			// 3. Error handling: simulate API error from /api/directory
			mockDirectoryStatus = 400;
			await act(async () => {
				const event = new dom.window.Event("contextmenu", { bubbles: true, cancelable: true });
				wsBtn.dispatchEvent(event);
			});

			const wsArchiveFailBtn = dom.document.querySelector('[data-testid="ctx-archive"]') as HTMLElement | null;
			assert.ok(wsArchiveFailBtn);

			postCalls.length = 0;
			await act(async () => {
				wsArchiveFailBtn.click();
			});

			// Error does not crash the UI
			assert.equal(postCalls.length, 1);
			assert.ok(container.querySelector("aside"), "Sidebar must remain intact after error");

			await act(async () => {
				root.unmount();
			});
		} finally {
			globalThis.fetch = originalFetch;
			(globalThis as Record<string, unknown>).window = originalWindow;
			(globalThis as Record<string, unknown>).self = originalSelf;
			(globalThis as Record<string, unknown>).document = originalDocument;
			(globalThis as Record<string, unknown>).HTMLElement = originalHTMLElement;
			(globalThis as Record<string, unknown>).Element = originalElement;
			(globalThis as Record<string, unknown>).Node = originalNode;
			(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = originalAct;
			(globalThis as Record<string, unknown>).localStorage = originalLocalStorage;
			(globalThis as Record<string, unknown>).requestIdleCallback = originalRIC;
			(globalThis as Record<string, unknown>).requestAnimationFrame = originalRAF;
			(globalThis as Record<string, unknown>).cancelAnimationFrame = originalCAF;
			(globalThis as Record<string, unknown>).CustomEvent = originalCustomEvent;
			(globalThis as Record<string, unknown>).Event = originalEvent;
		}
	});

	it("16. WorkspaceScreen renderer lifecycle: mounts workspace, does not remount on unrelated snapshot updates, mounts on workspace change, cleans up on unmount without active AbortControllers", async () => {
		const dom = parseHTML("<html><head></head><body><div id='root'></div></body></html>");
		const originalWindow = (globalThis as Record<string, unknown>).window;
		const originalSelf = (globalThis as Record<string, unknown>).self;
		const originalDocument = (globalThis as Record<string, unknown>).document;
		const originalHTMLElement = (globalThis as Record<string, unknown>).HTMLElement;
		const originalElement = (globalThis as Record<string, unknown>).Element;
		const originalNode = (globalThis as Record<string, unknown>).Node;
		const originalAct = (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT;
		const originalFetch = globalThis.fetch;
		const originalRAF = (globalThis as Record<string, unknown>).requestAnimationFrame;
		const originalCAF = (globalThis as Record<string, unknown>).cancelAnimationFrame;

		Object.assign(globalThis, {
			window: dom.window,
			self: dom.window,
			document: dom.document,
			HTMLElement: dom.window.HTMLElement,
			Element: dom.window.Element,
			Node: dom.window.Node,
			IS_REACT_ACT_ENVIRONMENT: true,
			requestAnimationFrame: (cb: () => void) => setTimeout(cb, 0),
			cancelAnimationFrame: (id: NodeJS.Timeout) => clearTimeout(id),
			fetch: async () => Response.json({}),
		});

		try {
			const workspaceA: WorkspaceRecord = {
				version: 1,
				id: "workspace_00000000-0000-4000-8000-0000000000a1" as WorkspaceId,
				pluginId: "test-plugin",
				modeId: "mode-1",
				title: "Workspace Alpha",
				createdAt: "2026-11-01T10:00:00Z",
				updatedAt: "2026-11-01T10:05:00Z",
			};

			const workspaceB: WorkspaceRecord = {
				version: 1,
				id: "workspace_00000000-0000-4000-8000-0000000000b2" as WorkspaceId,
				pluginId: "test-plugin",
				modeId: "mode-1",
				title: "Workspace Beta",
				createdAt: "2026-11-01T10:00:00Z",
				updatedAt: "2026-11-01T10:05:00Z",
			};

			let mountCount = 0;
			let unmountCount = 0;
			const controllers: AbortController[] = [];

			const renderer1 = {
				mount: () => {},
			};

			const reg1 = Object.freeze({
				pluginId: "test-plugin",
				modeId: "mode-1",
				renderer: renderer1,
			});

			const mockManager: any = {
				mountWorkspace: (ws: WorkspaceRecord, container: HTMLElement) => {
					mountCount++;
					const ctrl = new AbortController();
					controllers.push(ctrl);
					let active = true;
					return () => {
						if (active) {
							active = false;
							unmountCount++;
							ctrl.abort();
						}
					};
				},
			};

			function Harness({
				workspace,
				modeRenderers,
				plugins,
			}: {
				workspace: WorkspaceRecord;
				modeRenderers: any[];
				plugins: any[];
			}) {
				const snapshot: any = {
					plugins,
					modeRenderers,
					codeBlocks: [],
					toolRenderers: [],
					directory: "",
					conflicts: [],
					loading: false,
					refreshing: false,
				};
				const mockConnect = () => ({
					close: () => {},
					onOpen: () => {},
					onEvent: () => {},
				});
				return (
					<ServerEventsProvider connect={mockConnect}>
						<PluginsContext.Provider value={{ manager: mockManager, snapshot, uiStore: null }}>
							<WorkspaceScreen
								workspaceId={workspace.id}
								initialWorkspace={workspace}
								initialAvailability="available"
							/>
						</PluginsContext.Provider>
					</ServerEventsProvider>
				);
			}

			const container = dom.document.getElementById("root")!;
			const root = createRoot(container as unknown as HTMLElement);

			// 1. Initial mount of workspaceA
			await act(async () => {
				root.render(
					<Harness
						workspace={workspaceA}
						modeRenderers={[reg1]}
						plugins={[{ id: "test-plugin", enabled: true }]}
					/>,
				);
			});

			assert.equal(mountCount, 1, "Workspace A should be mounted once");
			assert.equal(unmountCount, 0, "No unmount should have occurred yet");
			assert.equal(controllers.length, 1);
			assert.equal(controllers[0]!.signal.aborted, false, "Controller signal should be active");

			// 2. Unrelated snapshot update (e.g. other plugin changes or manager refreshes)
			await act(async () => {
				root.render(
					<Harness
						workspace={workspaceA}
						modeRenderers={[reg1]} // SAME renderer registration reference
						plugins={[
							{ id: "test-plugin", enabled: true },
							{ id: "unrelated-plugin", enabled: true, phase: "active" }, // unrelated change
						]}
					/>,
				);
			});

			// CRITICAL: Unrelated snapshot update MUST NOT trigger remount
			assert.equal(mountCount, 1, "Mount count must remain 1 after unrelated snapshot update");
			assert.equal(unmountCount, 0, "Unmount count must remain 0 after unrelated snapshot update");
			assert.equal(controllers[0]!.signal.aborted, false, "Initial controller must remain active");

			// 3. Workspace change: navigating to workspaceB
			await act(async () => {
				root.render(
					<Harness
						workspace={workspaceB}
						modeRenderers={[reg1]}
						plugins={[{ id: "test-plugin", enabled: true }]}
					/>,
				);
			});

			assert.equal(mountCount, 2, "Workspace B must be mounted");
			assert.equal(unmountCount, 1, "Workspace A must be unmounted");
			assert.equal(controllers[0]!.signal.aborted, true, "Workspace A controller must be aborted");
			assert.equal(controllers[1]!.signal.aborted, false, "Workspace B controller must be active");

			// 4. Actual renderer change: new renderer registered
			const renderer2 = { mount: () => {} };
			const reg2 = Object.freeze({
				pluginId: "test-plugin",
				modeId: "mode-1",
				renderer: renderer2,
			});

			await act(async () => {
				root.render(
					<Harness
						workspace={workspaceB}
						modeRenderers={[reg2]} // Changed renderer registration
						plugins={[{ id: "test-plugin", enabled: true }]}
					/>,
				);
			});

			assert.equal(mountCount, 3, "New renderer must be mounted");
			assert.equal(unmountCount, 2, "Previous renderer must be unmounted");
			assert.equal(controllers[1]!.signal.aborted, true, "Previous renderer controller must be aborted");
			assert.equal(controllers[2]!.signal.aborted, false, "New renderer controller must be active");

			// 5. Complete unmount
			await act(async () => {
				root.unmount();
			});

			assert.equal(unmountCount, 3, "All mounts must be unmounted on component tear-down");
			for (const ctrl of controllers) {
				assert.equal(ctrl.signal.aborted, true, "Every controller signal must be aborted after unmount");
			}
		} finally {
			globalThis.fetch = originalFetch;
			(globalThis as Record<string, unknown>).window = originalWindow;
			(globalThis as Record<string, unknown>).self = originalSelf;
			(globalThis as Record<string, unknown>).document = originalDocument;
			(globalThis as Record<string, unknown>).HTMLElement = originalHTMLElement;
			(globalThis as Record<string, unknown>).Element = originalElement;
			(globalThis as Record<string, unknown>).Node = originalNode;
			(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = originalAct;
			(globalThis as Record<string, unknown>).requestAnimationFrame = originalRAF;
			(globalThis as Record<string, unknown>).cancelAnimationFrame = originalCAF;
		}
	});
});
