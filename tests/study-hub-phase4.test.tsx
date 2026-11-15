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
import { WorkspaceScreen } from "../components/workspace-screen.tsx";
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
});
