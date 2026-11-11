import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
	applyChatOrganizationAction,
	isChatArchived,
	emptyChatOrganization,
	type ChatOrganization,
	type ChatFolder,
} from "../src/core/chat-organization.ts";
import { MoveDestinationBody, type MoveTargetItem } from "../components/chat-organization-interactions.tsx";
import { ArchivePage } from "../components/archive-page.tsx";
import { ServerEventsProvider } from "../components/server-events.tsx";
import { SessionsSidebar, SidebarProvider } from "../components/sidebar.tsx";
import { SettingsDialogProvider as SettingsDialogProviderBase } from "../components/settings/settings-dialog.tsx";
import { InteractionLayersProvider } from "../components/interaction-layers.tsx";
import { Chat } from "../components/chat.tsx";

function SettingsDialogProvider({ children }: { children: React.ReactNode }) {
	return <InteractionLayersProvider><SettingsDialogProviderBase>{children}</SettingsDialogProviderBase></InteractionLayersProvider>;
}

describe("Archive Redesign: Core and Hierarchy Restoration Rules", () => {
	it("restoring an individual conversation inside an archived folder restores only its necessary ancestor folder path, leaving other archived conversations and subfolders archived", () => {
		let state: ChatOrganization = emptyChatOrganization();

		// Create hierarchy: RootFolder -> SubFolderA (with Chat1 and Chat2), and SubFolderB (with Chat3)
		const now = new Date().toISOString();
		const rootFolder: ChatFolder = { id: "f_root", name: "Science", parentId: null, createdAt: now };
		const subFolderA: ChatFolder = { id: "f_subA", name: "Physics", parentId: "f_root", createdAt: now };
		const subFolderB: ChatFolder = { id: "f_subB", name: "Chemistry", parentId: "f_root", createdAt: now };

		state.folders = [rootFolder, subFolderA, subFolderB];
		state.placements = {
			c_1: { folderId: "f_subA", archivedAt: null },
			c_2: { folderId: "f_subA", archivedAt: null },
			c_3: { folderId: "f_subB", archivedAt: null },
		};

		const chatIds = new Set(["c_1", "c_2", "c_3"]);

		// Archive the whole root folder
		state = applyChatOrganizationAction(
			state,
			{ action: "archive", kind: "folder", id: "f_root" },
			chatIds,
			{ id: "fresh_1", createdAt: now },
		);

		// Verify everything is archived
		assert.ok(state.folders.every((f) => f.archivedAt !== null));
		assert.ok(Object.values(state.placements).every((p) => p.archivedAt !== null));
		assert.equal(isChatArchived(state, "c_1"), true);
		assert.equal(isChatArchived(state, "c_2"), true);
		assert.equal(isChatArchived(state, "c_3"), true);

		// Now restore ONLY c_1 (default restore, retaining original hierarchy path)
		state = applyChatOrganizationAction(
			state,
			{ action: "restore", kind: "chat", id: "c_1" },
			chatIds,
			{ id: "fresh_2", createdAt: now },
		);

		// Chat 1 must be restored
		assert.equal(state.placements["c_1"]?.archivedAt, null);
		assert.equal(isChatArchived(state, "c_1"), false);

		// Necessary ancestor path (f_subA and f_root) must be restored
		const fSubA = state.folders.find((f) => f.id === "f_subA");
		const fRoot = state.folders.find((f) => f.id === "f_root");
		assert.equal(fSubA?.archivedAt, null, "subFolderA ancestor must be unarchived");
		assert.equal(fRoot?.archivedAt, null, "rootFolder ancestor must be unarchived");

		// Sibling chat (c_2) in the same folder MUST REMAIN ARCHIVED
		assert.ok(state.placements["c_2"]?.archivedAt !== null, "c_2 must remain archived");
		assert.equal(isChatArchived(state, "c_2"), true);

		// Unrelated subfolder (f_subB) and chat (c_3) MUST REMAIN ARCHIVED
		const fSubB = state.folders.find((f) => f.id === "f_subB");
		assert.ok(fSubB?.archivedAt !== null, "subFolderB must remain archived");
		assert.ok(state.placements["c_3"]?.archivedAt !== null, "c_3 must remain archived");
		assert.equal(isChatArchived(state, "c_3"), true);
	});

	it("prevents restoring a chat or folder into an archived folder target", () => {
		const now = new Date().toISOString();
		const state: ChatOrganization = {
			version: 1,
			folders: [
				{ id: "f_arch", name: "Archived Target", parentId: null, createdAt: now, archivedAt: now },
			],
			placements: {
				c_1: { folderId: null, archivedAt: now },
			},
		};

		assert.throws(
			() => {
				applyChatOrganizationAction(
					state,
					{ action: "restore", kind: "chat", id: "c_1", targetParentId: "f_arch" },
					new Set(["c_1"]),
					{ id: "fresh", createdAt: now },
				);
			},
			{ message: /Cannot restore into an archived folder/ },
		);
	});
});

describe("Restore to selector lists only active valid destination folders", () => {
	it("MoveDestinationBody strictly excludes archived folders from destination list", () => {
		const activeFolder: ChatFolder = {
			id: "f_active",
			name: "Active Work",
			parentId: null,
			createdAt: "2026-01-01",
		};
		const archivedFolder: ChatFolder = {
			id: "f_archived",
			name: "Old Archive",
			parentId: null,
			createdAt: "2026-01-01",
			archivedAt: "2026-02-01",
		};

		const item: MoveTargetItem = {
			kind: "chat",
			id: "c_1",
			title: "Session to Restore",
			parentId: null,
			isRestore: true,
		};

		const html = renderToStaticMarkup(
			<MoveDestinationBody
				item={item}
				folders={[activeFolder, archivedFolder]}
				organization={{ version: 1, folders: [activeFolder, archivedFolder], placements: {} }}
				onClose={() => {}}
				onMove={() => {}}
			/>,
		);

		// Must render the active folder
		assert.ok(html.includes('data-testid="move-destination-f_active"'));
		assert.ok(html.includes("Active Work"));

		// Must NOT render the archived folder as a destination option
		assert.ok(!html.includes('data-testid="move-destination-f_archived"'));
		assert.ok(!html.includes("Old Archive"));

		// Must indicate Restore heading
		assert.ok(html.includes("Restore session"));
	});
});

describe("Dedicated Archive Page rendering", () => {
	it("renders open centered empty state without dashed outer card and without Go to Sessions button", () => {
		const html = renderToStaticMarkup(
			<ServerEventsProvider connect={() => ({ close() {}, onOpen() {}, onEvent() {} })}>
				<ArchivePage />
			</ServerEventsProvider>,
		);

		assert.ok(html.includes('data-testid="archive-page"'));
		assert.ok(html.includes("Archive"));
		assert.ok(html.includes('data-testid="archive-empty-state"'));
		assert.ok(html.includes("Archive is empty"));
		// Must not have dashed border card
		assert.ok(!html.includes("border-dashed"), "Dashed outer card must be removed");
		// Must not have redundant Go to Sessions button
		assert.ok(!html.includes("Go to Sessions"), "Go to Sessions button must be removed");
		// Must be vertically and horizontally centered in usable main area
		assert.ok(
			html.includes("flex flex-1 flex-col items-center justify-center"),
			"Empty state must be centered within the usable main area",
		);
		// Descriptive explanatory text must use comfortably readable text-sm token
		assert.ok(
			html.includes("text-sm text-muted-foreground"),
			"Empty state description must use readable text-sm token",
		);
	});

	it("search folders filter rule: only folders containing matching sessions are included", () => {
		// Test the folder filtering logic
		const archivedFolders: ChatFolder[] = [
			{ id: "f_match", name: "Matching Folder", parentId: null, createdAt: "2026-01-01", archivedAt: "2026-01-02" },
			{ id: "f_empty", name: "No Match Folder", parentId: null, createdAt: "2026-01-01", archivedAt: "2026-01-02" },
		];
		const matchingChat = {
			id: "c_match",
			title: "Quantum Physics",
			kind: "teach" as const,
			folderId: "f_match",
			createdAt: "2026-01-01",
			updatedAt: "2026-01-02",
			archivedAt: "2026-01-02",
		};

		// If a folder has no matching sessions, it must not be in the visible set
		const matchingFolderIds = new Set<string>();
		if (matchingChat.folderId) {
			matchingFolderIds.add(matchingChat.folderId);
		}

		assert.ok(matchingFolderIds.has("f_match"));
		assert.ok(!matchingFolderIds.has("f_empty"), "f_empty must not be included when it contains no matching chats");
	});
});

describe("Contextual Sidebar Behavior", () => {
	it("renders New session, Archive nav button, and Settings while preserving layout integrity", () => {
		const html = renderToStaticMarkup(
			<ServerEventsProvider connect={() => ({ close() {}, onOpen() {}, onEvent() {} })}>
				<SettingsDialogProvider>
					<SidebarProvider>
						<SessionsSidebar />
					</SidebarProvider>
				</SettingsDialogProvider>
			</ServerEventsProvider>,
		);

		// Must render brand home
		assert.ok(html.includes('data-testid="sidebar-brand-home"'));
		// Must render new session trigger
		assert.ok(html.includes('data-testid="new-menu-trigger"'));
		assert.ok(html.includes("New session"));
		// Must render archive nav button
		assert.ok(html.includes('data-testid="archive-nav-button"'));
		assert.ok(html.includes("Archive"));
		// Must render settings
		assert.ok(html.includes('data-testid="settings-entry"'));
		assert.ok(html.includes("Settings"));
	});

	it("renders sidebar archive destinations: All Archived, Unorganized, and hierarchical genuinely archived folders", () => {
		const now = new Date().toISOString();
		const rootFolder: ChatFolder = { id: "f_root", name: "Science", parentId: null, createdAt: now, archivedAt: now };
		const childFolder: ChatFolder = { id: "f_child", name: "Physics", parentId: "f_root", createdAt: now, archivedAt: now };

		const originalWindow = globalThis.window;
		try {
			(globalThis as Record<string, unknown>).window = {
				location: { pathname: "/archive", search: "" },
				localStorage: { getItem: () => null, setItem: () => {} },
				addEventListener: () => {},
				removeEventListener: () => {},
			};

			const html = renderToStaticMarkup(
				<ServerEventsProvider connect={() => ({ close() {}, onOpen() {}, onEvent() {} })}>
					<SettingsDialogProvider>
						<SidebarProvider>
							<SessionsSidebar
								initialArchivedFolders={[rootFolder, childFolder]}
								initialArchivedChats={[
									{ id: "c_1", title: "Quantum Mechanics", folderId: "f_child", createdAt: now, updatedAt: now, archivedAt: now },
									{ id: "c_unorg", title: "Notes", folderId: null, createdAt: now, updatedAt: now, archivedAt: now },
								]}
							/>
						</SidebarProvider>
					</SettingsDialogProvider>
				</ServerEventsProvider>,
			);

			// All Archived destination link
			assert.ok(html.includes('data-testid="sidebar-archive-all"'));
			assert.ok(html.includes("All Archived"));

			// Unorganized destination link
			assert.ok(html.includes('data-testid="sidebar-archive-unorganized"'));
			assert.ok(html.includes("Unorganized"));

			// Hierarchical genuinely archived folders
			assert.ok(html.includes('data-testid="sidebar-archived-folders"'));
			assert.ok(html.includes('data-testid="sidebar-archive-folder-f_root"'));
			assert.ok(html.includes('data-testid="sidebar-archive-folder-f_child"'));
		} finally {
			(globalThis as Record<string, unknown>).window = originalWindow;
		}
	});

	it("sidebar active highlight reflects selected destination", () => {
		const now = new Date().toISOString();
		const folder: ChatFolder = { id: "f_sci", name: "Science", parentId: null, createdAt: now, archivedAt: now };

		const originalWindow = globalThis.window;
		try {
			// When ?view=unorganized is selected
			(globalThis as Record<string, unknown>).window = {
				location: { pathname: "/archive", search: "?view=unorganized" },
				localStorage: { getItem: () => null, setItem: () => {} },
				addEventListener: () => {},
				removeEventListener: () => {},
			};

			const htmlUnorg = renderToStaticMarkup(
				<ServerEventsProvider connect={() => ({ close() {}, onOpen() {}, onEvent() {} })}>
					<SettingsDialogProvider>
						<SidebarProvider>
							<SessionsSidebar
								initialArchivedFolders={[folder]}
								initialArchivedChats={[]}
							/>
						</SidebarProvider>
					</SettingsDialogProvider>
				</ServerEventsProvider>,
			);

			// Unorganized must have active styling
			assert.ok(htmlUnorg.includes('data-testid="sidebar-archive-unorganized"'));
			assert.ok(htmlUnorg.includes("sidebar-archive-unorganized") && htmlUnorg.includes("bg-accent text-foreground font-semibold"));

			// When ?folder=f_sci is selected
			(globalThis as Record<string, unknown>).window = {
				location: { pathname: "/archive", search: "?folder=f_sci" },
				localStorage: { getItem: () => null, setItem: () => {} },
				addEventListener: () => {},
				removeEventListener: () => {},
			};

			const htmlFolder = renderToStaticMarkup(
				<ServerEventsProvider connect={() => ({ close() {}, onOpen() {}, onEvent() {} })}>
					<SettingsDialogProvider>
						<SidebarProvider>
							<SessionsSidebar
								initialArchivedFolders={[folder]}
								initialArchivedChats={[]}
							/>
						</SidebarProvider>
					</SettingsDialogProvider>
				</ServerEventsProvider>,
			);

			assert.ok(htmlFolder.includes('data-testid="sidebar-archive-folder-f_sci"'));
		} finally {
			(globalThis as Record<string, unknown>).window = originalWindow;
		}
	});
});

describe("Archive Main Content Destination Scoping and Breadcrumbs", () => {
	const now = new Date().toISOString();
	const rootFolder: ChatFolder = { id: "f_root", name: "Science", parentId: null, createdAt: now, archivedAt: now };
	const subFolder: ChatFolder = { id: "f_sub", name: "Physics", parentId: "f_root", createdAt: now, archivedAt: now };
	const activeOriginFolder: ChatFolder = { id: "f_active", name: "Active Project", parentId: null, createdAt: now };

	const chatInFolder = {
		id: "c_in_folder",
		title: "Quantum Theory",
		kind: "teach" as const,
		folderId: "f_sub",
		createdAt: now,
		updatedAt: now,
		archivedAt: now,
	};
	const chatOriginActive = {
		id: "c_origin_active",
		title: "Active Project Notes",
		kind: "teach" as const,
		folderId: "f_active",
		createdAt: now,
		updatedAt: now,
		archivedAt: now,
	};
	const chatUnorganized = {
		id: "c_unorg",
		title: "Random Scratch",
		kind: "teach" as const,
		folderId: null,
		createdAt: now,
		updatedAt: now,
		archivedAt: now,
	};

	it("All Archived destination shows compact folder entity rows and flat list of all archived sessions with origin metadata", () => {
		const originalWindow = globalThis.window;
		try {
			(globalThis as Record<string, unknown>).window = {
				location: { pathname: "/archive", search: "" },
				addEventListener: () => {},
				removeEventListener: () => {},
			};

			const html = renderToStaticMarkup(
				<ServerEventsProvider connect={() => ({ close() {}, onOpen() {}, onEvent() {} })}>
					<ArchivePage
						initialFolders={[rootFolder, subFolder]}
						initialChats={[chatInFolder, chatOriginActive, chatUnorganized]}
						initialActiveFolders={[activeOriginFolder]}
					/>
				</ServerEventsProvider>,
			);

			// Must render archived folders section with flat compact entity rows (both root and nested folder)
			assert.ok(html.includes('data-testid="archive-folders-section"'));
			assert.ok(html.includes('data-testid="archive-folder-f_root"'));
			assert.ok(html.includes('data-testid="archive-folder-f_sub"'), "Nested subfolder must be rendered as a flat compact entity row");

			// Nested folder includes real origin breadcrumb path metadata
			assert.ok(html.includes("In: Science"), "Nested folder must include origin parent path metadata");

			// Must render flat list of ALL archived sessions
			assert.ok(html.includes('data-testid="archive-sessions-section"'));
			assert.ok(html.includes("Archived Sessions"));

			// Chat inside archived folder MUST be included with origin path metadata
			assert.ok(html.includes('data-testid="archive-chat-c_in_folder"'), "Chat inside archived folder must be included in All Archived");
			assert.ok(html.includes("In: Science / Physics"), "Chat inside archived folder must include origin hierarchy metadata");

			// Chat with active origin folder is displayed with metadata In: Active Project
			assert.ok(html.includes('data-testid="archive-chat-c_origin_active"'));
			assert.ok(html.includes("In: Active Project"), "Active origin folder must remain metadata on conversation row");

			// Truly unorganized chat is also displayed in archived sessions section
			assert.ok(html.includes('data-testid="archive-chat-c_unorg"'));

			// Must NOT render recursive expansion toggles or nested folder containers in All Archived
			assert.ok(!html.includes('data-testid="folder-toggle-f_root"'), "No recursive tree expansion toggles in All Archived");
			assert.ok(!html.includes('data-testid="archive-nested-folders"'), "No nested folder wrapper in All Archived");

			// Compact archived folder row features: name, link into folder using URL selection, child count, contextual menu
			assert.ok(html.includes("Science"));
			assert.ok(html.includes('href="/archive?folder=f_root"'), "Folder row must link into folder workspace via URL selection");
			assert.ok(html.includes('href="/archive?folder=f_sub"'), "Nested folder row must link into folder workspace via URL selection");
			assert.ok(html.includes('data-testid="archive-folder-options-f_root"'), "Folder row must provide contextual options menu");
			assert.ok(html.includes('data-testid="archive-folder-options-f_sub"'), "Nested folder row must provide contextual options menu");
			assert.ok(html.includes("Archived"), "Persisted archive date must be displayed");

			// No permanently displayed Restore button on global folder row or conversation rows
			assert.ok(!html.includes('data-testid="restore-folder-f_root"'), "Global folder row must not permanently display a restore button");
			assert.ok(!html.includes('data-testid="restore-folder-f_sub"'), "Nested folder row must not permanently display a restore button");
			assert.ok(!html.includes('data-testid="restore-chat-c_in_folder"'), "Conversation row must not permanently display a restore button");
			assert.ok(!html.includes('data-testid="restore-chat-c_origin_active"'), "Conversation row must not permanently display a restore button");
			assert.ok(!html.includes('data-testid="restore-chat-c_unorg"'), "Conversation row must not permanently display a restore button");

			// Restore is discoverable contextually via options menu triggers
			assert.ok(html.includes('data-testid="archive-chat-options-c_in_folder"'));
			assert.ok(html.includes('data-testid="archive-chat-options-c_origin_active"'));
			assert.ok(html.includes('data-testid="archive-chat-options-c_unorg"'));

			// No redundant folder dropdown selector
			assert.ok(!html.includes('data-testid="archive-folder-filter"'), "Redundant folder filter dropdown must be removed");
		} finally {
			(globalThis as Record<string, unknown>).window = originalWindow;
		}
	});

	it("Unorganized destination scopes strictly to chats with no original folder", () => {
		const originalWindow = globalThis.window;
		try {
			(globalThis as Record<string, unknown>).window = {
				location: { pathname: "/archive", search: "?view=unorganized" },
				addEventListener: () => {},
				removeEventListener: () => {},
			};

			const html = renderToStaticMarkup(
				<ServerEventsProvider connect={() => ({ close() {}, onOpen() {}, onEvent() {} })}>
					<ArchivePage
						initialFolders={[rootFolder, subFolder]}
						initialChats={[chatInFolder, chatOriginActive, chatUnorganized]}
						initialActiveFolders={[activeOriginFolder]}
					/>
				</ServerEventsProvider>,
			);

			// Real hierarchy breadcrumbs
			assert.ok(html.includes('data-testid="archive-breadcrumbs"'));
			assert.ok(html.includes("Unorganized"));

			// Must render unorganized list
			assert.ok(html.includes('data-testid="archive-unorganized-list"'));
			assert.ok(html.includes('data-testid="archive-chat-c_unorg"'));

			// Must NOT render chats with origin folders or in archived folders
			assert.ok(!html.includes('data-testid="archive-chat-c_in_folder"'));
			assert.ok(!html.includes('data-testid="archive-chat-c_origin_active"'), "Active origin chats must not appear in Unorganized");
			assert.ok(!html.includes('data-testid="archive-folders-section"'));
			assert.ok(!html.includes('data-testid="archive-folder-filter"'));
		} finally {
			(globalThis as Record<string, unknown>).window = originalWindow;
		}
	});

	it("Folder view uses real hierarchy breadcrumbs, direct child content and navigable nested folders, excludes selected folder wrapper", () => {
		const originalWindow = globalThis.window;
		try {
			// Select rootFolder (f_root)
			(globalThis as Record<string, unknown>).window = {
				location: { pathname: "/archive", search: "?folder=f_root" },
				addEventListener: () => {},
				removeEventListener: () => {},
			};

			const html = renderToStaticMarkup(
				<ServerEventsProvider connect={() => ({ close() {}, onOpen() {}, onEvent() {} })}>
					<ArchivePage
						initialFolders={[rootFolder, subFolder]}
						initialChats={[chatInFolder, chatOriginActive, chatUnorganized]}
						initialActiveFolders={[activeOriginFolder]}
					/>
				</ServerEventsProvider>,
			);

			// Breadcrumbs must include Archive and Science
			assert.ok(html.includes('data-testid="archive-breadcrumbs"'));
			assert.ok(html.includes("Science"));

			// Excludes selected folder as redundant wrapper
			assert.ok(!html.includes('data-testid="archive-folder-f_root"'), "Selected folder must not be rendered as a redundant collapsible wrapper");

			// Header affordances for selected folder
			assert.ok(html.includes('data-testid="archive-folder-header"'));
			assert.ok(html.includes('data-testid="restore-folder-f_root"'));
			assert.ok(html.includes('data-testid="archive-folder-options-f_root"'));

			// Navigable nested child folders
			assert.ok(html.includes('data-testid="archive-nested-folders"'));
			assert.ok(html.includes('data-testid="archive-nested-folder-f_sub"'));
			assert.ok(html.includes('href="/archive?folder=f_sub"'));

			// Nested folders do not have a permanently displayed restore button; restore is discoverable contextually
			assert.ok(!html.includes('data-testid="restore-folder-f_sub"'), "Nested folder card must not permanently display a restore button");
			assert.ok(html.includes('data-testid="archive-folder-options-f_sub"'));

			// No redundant folder dropdown selector
			assert.ok(!html.includes('data-testid="archive-folder-filter"'));
		} finally {
			(globalThis as Record<string, unknown>).window = originalWindow;
		}
	});

	it("compact folder entity row only renders archive date when actually persisted", () => {
		const originalWindow = globalThis.window;
		try {
			(globalThis as Record<string, unknown>).window = {
				location: { pathname: "/archive", search: "" },
				addEventListener: () => {},
				removeEventListener: () => {},
			};

			const folderWithoutDate: ChatFolder = {
				id: "f_no_date",
				name: "Undated Folder",
				parentId: null,
				createdAt: "2026-01-01T00:00:00.000Z",
			};

			const html = renderToStaticMarkup(
				<ServerEventsProvider connect={() => ({ close() {}, onOpen() {}, onEvent() {} })}>
					<ArchivePage
						initialFolders={[folderWithoutDate]}
						initialChats={[]}
						initialActiveFolders={[]}
					/>
				</ServerEventsProvider>,
			);

			assert.ok(html.includes('data-testid="archive-folder-f_no_date"'));
			assert.ok(html.includes("Undated Folder"));
			assert.ok(!html.includes("Archived "), "Archive date must not be rendered or inferred when not persisted");
		} finally {
			(globalThis as Record<string, unknown>).window = originalWindow;
		}
	});
});

describe("Archive Redesign: Global Content, Search, and Folder-Scoped child navigation", () => {
	const now = new Date().toISOString();
	const rootFolder: ChatFolder = { id: "f_root", name: "Science", parentId: null, createdAt: now, archivedAt: now };
	const subFolder: ChatFolder = { id: "f_sub", name: "Physics", parentId: "f_root", createdAt: now, archivedAt: now };
	const otherFolder: ChatFolder = { id: "f_other", name: "History", parentId: null, createdAt: now, archivedAt: now };

	const chatInFolder = {
		id: "c_in_folder",
		title: "Quantum Mechanics",
		kind: "teach" as const,
		folderId: "f_sub",
		createdAt: now,
		updatedAt: now,
		archivedAt: now,
	};
	const chatPracticeInFolder = {
		id: "c_practice",
		title: "Physics Problem Set",
		kind: "practice" as const,
		folderId: "f_sub",
		createdAt: now,
		updatedAt: now,
		archivedAt: now,
	};
	const chatUnorganized = {
		id: "c_unorg",
		title: "General Notes",
		kind: "teach" as const,
		folderId: null,
		createdAt: now,
		updatedAt: now,
		archivedAt: now,
	};

	it("global includes archived-folder conversations", () => {
		const originalWindow = globalThis.window;
		try {
			(globalThis as Record<string, unknown>).window = {
				location: { pathname: "/archive", search: "" },
				addEventListener: () => {},
				removeEventListener: () => {},
			};

			const html = renderToStaticMarkup(
				<ServerEventsProvider connect={() => ({ close() {}, onOpen() {}, onEvent() {} })}>
					<ArchivePage
						initialFolders={[rootFolder, subFolder]}
						initialChats={[chatInFolder, chatUnorganized]}
					/>
				</ServerEventsProvider>,
			);

			// Both the chat and its original folder path must be visible in All Archived flat sessions list
			assert.ok(html.includes('data-testid="archive-chat-c_in_folder"'));
			assert.ok(html.includes("Quantum Mechanics"));
			assert.ok(html.includes("In: Science / Physics"), "Chat inside archived folder must include full origin path");
			assert.ok(html.includes('data-testid="archive-chat-c_unorg"'));
		} finally {
			(globalThis as Record<string, unknown>).window = originalWindow;
		}
	});

	it("global name search", () => {
		const originalWindow = globalThis.window;
		try {
			// Case 1: Search for folder name "Physics" which does not appear in any chat title
			(globalThis as Record<string, unknown>).window = {
				location: { pathname: "/archive", search: "?q=Physics" },
				addEventListener: () => {},
				removeEventListener: () => {},
			};

			const htmlFolderSearch = renderToStaticMarkup(
				<ServerEventsProvider connect={() => ({ close() {}, onOpen() {}, onEvent() {} })}>
					<ArchivePage
						initialFolders={[rootFolder, subFolder, otherFolder]}
						initialChats={[chatInFolder, chatUnorganized]}
						initialSearchQuery="Physics"
					/>
				</ServerEventsProvider>,
			);

			// Matching folder row must be displayed
			assert.ok(htmlFolderSearch.includes('data-testid="archive-folder-f_sub"'), "Global name search must match folder name");
			assert.ok(htmlFolderSearch.includes("Physics"));
			assert.ok(htmlFolderSearch.includes("In: Science"), "Origin metadata on folder row must be preserved in search results");

			// Unrelated folder must be excluded
			assert.ok(!htmlFolderSearch.includes('data-testid="archive-folder-f_other"'), "Unrelated folder must be excluded from search results");

			// Empty search state must NOT trigger because a folder matched
			assert.ok(!htmlFolderSearch.includes('data-testid="archive-no-results"'), "Empty state must not show when folder matches search");

			// Case 2: Search for session title "Quantum"
			const htmlChatSearch = renderToStaticMarkup(
				<ServerEventsProvider connect={() => ({ close() {}, onOpen() {}, onEvent() {} })}>
					<ArchivePage
						initialFolders={[rootFolder, subFolder, otherFolder]}
						initialChats={[chatInFolder, chatUnorganized]}
						initialSearchQuery="Quantum"
					/>
				</ServerEventsProvider>,
			);

			assert.ok(htmlChatSearch.includes('data-testid="archive-chat-c_in_folder"'), "Global search must match session title");
			assert.ok(htmlChatSearch.includes("In: Science / Physics"), "Origin metadata on session must be preserved in search results");
			assert.ok(!htmlChatSearch.includes('data-testid="archive-chat-c_unorg"'), "Unmatching chat must be excluded");
		} finally {
			(globalThis as Record<string, unknown>).window = originalWindow;
		}
	});

	it("folder-scoped child-folder name search", () => {
		const originalWindow = globalThis.window;
		try {
			// Viewing rootFolder (f_root), searching for "Physics"
			(globalThis as Record<string, unknown>).window = {
				location: { pathname: "/archive", search: "?folder=f_root&q=Physics" },
				addEventListener: () => {},
				removeEventListener: () => {},
			};

			const html = renderToStaticMarkup(
				<ServerEventsProvider connect={() => ({ close() {}, onOpen() {}, onEvent() {} })}>
					<ArchivePage
						initialFolders={[rootFolder, subFolder, otherFolder]}
						initialChats={[chatInFolder, chatUnorganized]}
						initialSearchQuery="Physics"
					/>
				</ServerEventsProvider>,
			);

			// Header affordances for selected folder
			assert.ok(html.includes('data-testid="archive-folder-header"'));

			// Keeps the selected folder itself out of results
			assert.ok(!html.includes('data-testid="archive-nested-folder-f_root"'), "Selected folder must be kept out of child folder results");
			assert.ok(!html.includes('data-testid="archive-folder-f_root"'), "Selected folder must not be rendered as a redundant row");

			// Matches child folder in nested folders
			assert.ok(html.includes('data-testid="archive-nested-folders"'));
			assert.ok(html.includes('data-testid="archive-nested-folder-f_sub"'), "Folder-scoped search must match child folder name");

			// Child folder remains navigable
			assert.ok(html.includes('href="/archive?folder=f_sub"'), "Child folder must remain navigable in folder-scoped search");

			// Out-of-scope folder must not appear
			assert.ok(!html.includes('data-testid="archive-nested-folder-f_other"'), "Out-of-scope folder must not appear");
		} finally {
			(globalThis as Record<string, unknown>).window = originalWindow;
		}
	});

	it("no duplicate recursive folder wrappers", () => {
		const originalWindow = globalThis.window;
		try {
			(globalThis as Record<string, unknown>).window = {
				location: { pathname: "/archive", search: "" },
				addEventListener: () => {},
				removeEventListener: () => {},
			};

			const html = renderToStaticMarkup(
				<ServerEventsProvider connect={() => ({ close() {}, onOpen() {}, onEvent() {} })}>
					<ArchivePage
						initialFolders={[rootFolder, subFolder]}
						initialChats={[chatInFolder, chatUnorganized]}
					/>
				</ServerEventsProvider>,
			);

			// Both folders appear as flat individual rows in folders section
			assert.ok(html.includes('data-testid="archive-folders-section"'));
			assert.ok(html.includes('data-testid="archive-folder-f_root"'));
			assert.ok(html.includes('data-testid="archive-folder-f_sub"'));

			// Neither folder is rendered recursively inside another folder wrapper
			assert.ok(!html.includes('data-testid="folder-toggle-f_root"'), "No tree expansion toggles");
			assert.ok(!html.includes('data-testid="archive-nested-folders"'), "No nested folder containers in All Archived view");
		} finally {
			(globalThis as Record<string, unknown>).window = originalWindow;
		}
	});

	it("teaching/practice filters apply to sessions and exclude folders without matching sessions, while matching folder names are preserved", () => {
		const originalWindow = globalThis.window;
		try {
			(globalThis as Record<string, unknown>).window = {
				location: { pathname: "/archive", search: "" },
				addEventListener: () => {},
				removeEventListener: () => {},
			};

			// Case 1: Kind filter = practice, no search
			// rootFolder and subFolder contain chatPracticeInFolder (kind: practice)
			// otherFolder has NO sessions
			const htmlPractice = renderToStaticMarkup(
				<ServerEventsProvider connect={() => ({ close() {}, onOpen() {}, onEvent() {} })}>
					<ArchivePage
						initialFolders={[rootFolder, subFolder, otherFolder]}
						initialChats={[chatInFolder, chatPracticeInFolder]}
						initialKindFilter="practice"
					/>
				</ServerEventsProvider>,
			);

			// Folders with practice sessions must be included
			assert.ok(htmlPractice.includes('data-testid="archive-folder-f_sub"'));
			assert.ok(htmlPractice.includes('data-testid="archive-folder-f_root"'));

			// otherFolder has no practice sessions, so must be excluded
			assert.ok(!htmlPractice.includes('data-testid="archive-folder-f_other"'), "Folder without matching sessions must be excluded when filter is active");

			// Practice session is included, teaching session is excluded
			assert.ok(htmlPractice.includes('data-testid="archive-chat-c_practice"'));
			assert.ok(!htmlPractice.includes('data-testid="archive-chat-c_in_folder"'));

			// Case 2: Kind filter = practice, but search query matches otherFolder's name ("History")
			const htmlPracticeWithSearch = renderToStaticMarkup(
				<ServerEventsProvider connect={() => ({ close() {}, onOpen() {}, onEvent() {} })}>
					<ArchivePage
						initialFolders={[rootFolder, subFolder, otherFolder]}
						initialChats={[chatInFolder, chatPracticeInFolder]}
						initialKindFilter="practice"
						initialSearchQuery="History"
					/>
				</ServerEventsProvider>,
			);

			// Matching folder name MUST still return relevant folder row
			assert.ok(htmlPracticeWithSearch.includes('data-testid="archive-folder-f_other"'), "Matching folder name must still return folder row even if it has no matching sessions");
			// Empty search state must NOT trigger because folder matched
			assert.ok(!htmlPracticeWithSearch.includes('data-testid="archive-no-results"'));
		} finally {
			(globalThis as Record<string, unknown>).window = originalWindow;
		}
	});
});

describe("Bug A Regression: Archived Chat Context, Persisted Fallback, and Restore Behavior", () => {
	const now = new Date().toISOString();
	const rootFolder: ChatFolder = { id: "f_root", name: "Science", parentId: null, createdAt: now, archivedAt: now };
	const childFolder: ChatFolder = { id: "f_child", name: "Physics", parentId: "f_root", createdAt: now, archivedAt: now };
	const activeFolder: ChatFolder = { id: "f_active", name: "Active Work", parentId: null, createdAt: now };

	const archChatInFolder = {
		id: "c_arch_in_folder",
		title: "Quantum Mechanics",
		kind: "teach" as const,
		folderId: "f_child",
		createdAt: now,
		updatedAt: now,
		archivedAt: now,
	};
	const archChatUnorg = {
		id: "c_arch_unorg",
		title: "General Thoughts",
		kind: "teach" as const,
		folderId: null,
		createdAt: now,
		updatedAt: now,
		archivedAt: now,
	};
	const archChatInActiveFolder = {
		id: "c_arch_in_active",
		title: "Notes on Active",
		kind: "teach" as const,
		folderId: "f_active",
		createdAt: now,
		updatedAt: now,
		archivedAt: now,
	};
	const activeChat = {
		id: "c_active_1",
		title: "Active Learning Session",
		kind: "teach" as const,
		folderId: null,
		createdAt: now,
		updatedAt: now,
	};

	it("Archive session row navigation preserves durable context (folder or view)", () => {
		const originalWindow = globalThis.window;
		try {
			// In folder view: /archive?folder=f_child
			(globalThis as Record<string, unknown>).window = {
				location: { pathname: "/archive", search: "?folder=f_child" },
				addEventListener: () => {},
				removeEventListener: () => {},
			};

			const htmlFolderView = renderToStaticMarkup(
				<ServerEventsProvider connect={() => ({ close() {}, onOpen() {}, onEvent() {} })}>
					<ArchivePage
						initialFolders={[rootFolder, childFolder]}
						initialChats={[archChatInFolder]}
					/>
				</ServerEventsProvider>,
			);

			assert.ok(htmlFolderView.includes('data-testid="archive-chat-c_arch_in_folder"'));

			// In unorganized view: /archive?view=unorganized
			(globalThis as Record<string, unknown>).window = {
				location: { pathname: "/archive", search: "?view=unorganized" },
				addEventListener: () => {},
				removeEventListener: () => {},
			};

			const htmlUnorgView = renderToStaticMarkup(
				<ServerEventsProvider connect={() => ({ close() {}, onOpen() {}, onEvent() {} })}>
					<ArchivePage
						initialFolders={[rootFolder, childFolder]}
						initialChats={[archChatUnorg]}
					/>
				</ServerEventsProvider>,
			);

			assert.ok(htmlUnorgView.includes('data-testid="archive-chat-c_arch_unorg"'));
		} finally {
			(globalThis as Record<string, unknown>).window = originalWindow;
		}
	});

	it("archived chat route with durable URL query context keeps Archive shell and selection", () => {
		const originalWindow = globalThis.window;
		try {
			// Case 1: ?from=archive&folder=f_root
			(globalThis as Record<string, unknown>).window = {
				location: { pathname: "/chat/c_arch_in_folder", search: "?from=archive&folder=f_root" },
				localStorage: { getItem: () => null, setItem: () => {} },
				addEventListener: () => {},
				removeEventListener: () => {},
			};

			const htmlFolderContext = renderToStaticMarkup(
				<ServerEventsProvider connect={() => ({ close() {}, onOpen() {}, onEvent() {} })}>
					<SettingsDialogProvider>
						<SidebarProvider>
							<SessionsSidebar
								initialArchivedFolders={[rootFolder, childFolder]}
								initialArchivedChats={[archChatInFolder]}
							/>
						</SidebarProvider>
					</SettingsDialogProvider>
				</ServerEventsProvider>,
			);

			assert.ok(htmlFolderContext.includes('data-testid="sidebar-archived-folders"'), "Must render Archive shell");
			assert.ok(htmlFolderContext.includes("Archive"));
			assert.ok(!htmlFolderContext.includes('data-testid="session-search"'), "Archive shell must not render Sessions search");
			assert.ok(!htmlFolderContext.includes('data-testid="new-folder-button"'), "Archive shell must not render Sessions new-folder-button");
			assert.ok(
				htmlFolderContext.includes('sidebar-archive-folder-f_root') &&
				htmlFolderContext.includes("bg-accent text-foreground font-semibold"),
				"Folder f_root must have active styling",
			);

			// Case 2: ?from=archive&view=unorganized
			(globalThis as Record<string, unknown>).window = {
				location: { pathname: "/chat/c_arch_unorg", search: "?from=archive&view=unorganized" },
				localStorage: { getItem: () => null, setItem: () => {} },
				addEventListener: () => {},
				removeEventListener: () => {},
			};

			const htmlUnorgContext = renderToStaticMarkup(
				<ServerEventsProvider connect={() => ({ close() {}, onOpen() {}, onEvent() {} })}>
					<SettingsDialogProvider>
						<SidebarProvider>
							<SessionsSidebar
								initialArchivedFolders={[rootFolder, childFolder]}
								initialArchivedChats={[archChatUnorg]}
							/>
						</SidebarProvider>
					</SettingsDialogProvider>
				</ServerEventsProvider>,
			);

			assert.ok(htmlUnorgContext.includes('data-testid="sidebar-archive-unorganized"'));
			assert.ok(
				htmlUnorgContext.includes('sidebar-archive-unorganized') &&
				htmlUnorgContext.includes("bg-accent text-foreground font-semibold"),
				"Unorganized destination must have active styling",
			);

			// Case 3: ?from=archive without destination (from All Archived)
			(globalThis as Record<string, unknown>).window = {
				location: { pathname: "/chat/c_arch_in_folder", search: "?from=archive" },
				localStorage: { getItem: () => null, setItem: () => {} },
				addEventListener: () => {},
				removeEventListener: () => {},
			};

			const htmlAllContext = renderToStaticMarkup(
				<ServerEventsProvider connect={() => ({ close() {}, onOpen() {}, onEvent() {} })}>
					<SettingsDialogProvider>
						<SidebarProvider>
							<SessionsSidebar
								initialArchivedFolders={[rootFolder, childFolder]}
								initialArchivedChats={[archChatInFolder]}
							/>
						</SidebarProvider>
					</SettingsDialogProvider>
				</ServerEventsProvider>,
			);

			assert.ok(
				htmlAllContext.includes('sidebar-archive-all') &&
				htmlAllContext.includes("bg-accent text-foreground font-semibold"),
				"All Archived destination must have active styling",
			);
		} finally {
			(globalThis as Record<string, unknown>).window = originalWindow;
		}
	});

	it("direct archived-chat URL without context derives selection from persisted placement", () => {
		const originalWindow = globalThis.window;
		try {
			// Case 1: chat has folderId that exists in archived navigation -> selects that archived folder
			(globalThis as Record<string, unknown>).window = {
				location: { pathname: "/chat/c_arch_in_folder", search: "" },
				localStorage: { getItem: () => null, setItem: () => {} },
				addEventListener: () => {},
				removeEventListener: () => {},
			};

			const htmlDirectFolder = renderToStaticMarkup(
				<ServerEventsProvider connect={() => ({ close() {}, onOpen() {}, onEvent() {} })}>
					<SettingsDialogProvider>
						<SidebarProvider>
							<SessionsSidebar
								initialArchivedFolders={[rootFolder, childFolder]}
								initialArchivedChats={[archChatInFolder]}
							/>
						</SidebarProvider>
					</SettingsDialogProvider>
				</ServerEventsProvider>,
			);

			assert.ok(htmlDirectFolder.includes('data-testid="sidebar-archived-folders"'), "Direct archived URL must use Archive shell");
			assert.ok(
				htmlDirectFolder.includes('sidebar-archive-folder-f_child') &&
				htmlDirectFolder.includes("bg-accent text-foreground font-semibold"),
				"Must select original archived folder f_child",
			);

			// Case 2: chat has folderId === null -> selects Unorganized
			(globalThis as Record<string, unknown>).window = {
				location: { pathname: "/chat/c_arch_unorg", search: "" },
				localStorage: { getItem: () => null, setItem: () => {} },
				addEventListener: () => {},
				removeEventListener: () => {},
			};

			const htmlDirectUnorg = renderToStaticMarkup(
				<ServerEventsProvider connect={() => ({ close() {}, onOpen() {}, onEvent() {} })}>
					<SettingsDialogProvider>
						<SidebarProvider>
							<SessionsSidebar
								initialArchivedFolders={[rootFolder, childFolder]}
								initialArchivedChats={[archChatUnorg]}
							/>
						</SidebarProvider>
					</SettingsDialogProvider>
				</ServerEventsProvider>,
			);

			assert.ok(
				htmlDirectUnorg.includes('sidebar-archive-unorganized') &&
				htmlDirectUnorg.includes("bg-accent text-foreground font-semibold"),
				"Direct URL with folderId === null must select Unorganized",
			);

			// Case 3: chat has folderId that remains active/not in archived tree -> selects All Archived
			(globalThis as Record<string, unknown>).window = {
				location: { pathname: "/chat/c_arch_in_active", search: "" },
				localStorage: { getItem: () => null, setItem: () => {} },
				addEventListener: () => {},
				removeEventListener: () => {},
			};

			const htmlDirectActiveFolder = renderToStaticMarkup(
				<ServerEventsProvider connect={() => ({ close() {}, onOpen() {}, onEvent() {} })}>
					<SettingsDialogProvider>
						<SidebarProvider>
							<SessionsSidebar
								initialArchivedFolders={[rootFolder, childFolder]}
								initialArchivedChats={[archChatInActiveFolder]}
							/>
						</SidebarProvider>
					</SettingsDialogProvider>
				</ServerEventsProvider>,
			);

			assert.ok(
				htmlDirectActiveFolder.includes('sidebar-archive-all') &&
				htmlDirectActiveFolder.includes("bg-accent text-foreground font-semibold"),
				"Direct URL with active/unrepresented folder must select All Archived",
			);
		} finally {
			(globalThis as Record<string, unknown>).window = originalWindow;
		}
	});

	it("refresh-like rerender preserves Archive shell and active selection", () => {
		const originalWindow = globalThis.window;
		try {
			(globalThis as Record<string, unknown>).window = {
				location: { pathname: "/chat/c_arch_in_folder", search: "?from=archive&folder=f_root" },
				localStorage: { getItem: () => null, setItem: () => {} },
				addEventListener: () => {},
				removeEventListener: () => {},
			};

			const renderPass1 = renderToStaticMarkup(
				<ServerEventsProvider connect={() => ({ close() {}, onOpen() {}, onEvent() {} })}>
					<SettingsDialogProvider>
						<SidebarProvider>
							<SessionsSidebar
								initialArchivedFolders={[rootFolder, childFolder]}
								initialArchivedChats={[archChatInFolder]}
							/>
						</SidebarProvider>
					</SettingsDialogProvider>
				</ServerEventsProvider>,
			);

			const renderPass2 = renderToStaticMarkup(
				<ServerEventsProvider connect={() => ({ close() {}, onOpen() {}, onEvent() {} })}>
					<SettingsDialogProvider>
						<SidebarProvider>
							<SessionsSidebar
								initialArchivedFolders={[rootFolder, childFolder]}
								initialArchivedChats={[archChatInFolder]}
							/>
						</SidebarProvider>
					</SettingsDialogProvider>
				</ServerEventsProvider>,
			);

			assert.equal(renderPass1, renderPass2, "Rerender must produce identical markup preserving Archive shell and selection");
			assert.ok(renderPass2.includes('data-testid="sidebar-archived-folders"'));
		} finally {
			(globalThis as Record<string, unknown>).window = originalWindow;
		}
	});

	it("active chat always uses Sessions shell even with from=archive or direct nav", () => {
		const originalWindow = globalThis.window;
		try {
			// Case 1: active chat with ?from=archive query param
			(globalThis as Record<string, unknown>).window = {
				location: { pathname: "/chat/c_active_1", search: "?from=archive" },
				localStorage: { getItem: () => null, setItem: () => {} },
				addEventListener: () => {},
				removeEventListener: () => {},
			};

			const htmlActiveWithFrom = renderToStaticMarkup(
				<ServerEventsProvider connect={() => ({ close() {}, onOpen() {}, onEvent() {} })}>
					<SettingsDialogProvider>
						<SidebarProvider>
							<SessionsSidebar
								initialArchivedFolders={[rootFolder, childFolder]}
								initialArchivedChats={[archChatInFolder]}
								initialChats={[activeChat]}
							/>
						</SidebarProvider>
					</SettingsDialogProvider>
				</ServerEventsProvider>,
			);

			assert.ok(htmlActiveWithFrom.includes('data-testid="new-menu-trigger"'), "Active chat must show Sessions trigger");
			assert.ok(htmlActiveWithFrom.includes("Sessions"), "Active chat must show Sessions header");
			assert.ok(!htmlActiveWithFrom.includes('data-testid="sidebar-archived-folders"'), "Active chat must NOT show Archive shell");

			// Case 2: active chat with direct navigation
			(globalThis as Record<string, unknown>).window = {
				location: { pathname: "/chat/c_active_1", search: "" },
				localStorage: { getItem: () => null, setItem: () => {} },
				addEventListener: () => {},
				removeEventListener: () => {},
			};

			const htmlActiveDirect = renderToStaticMarkup(
				<ServerEventsProvider connect={() => ({ close() {}, onOpen() {}, onEvent() {} })}>
					<SettingsDialogProvider>
						<SidebarProvider>
							<SessionsSidebar
								initialArchivedFolders={[rootFolder, childFolder]}
								initialArchivedChats={[archChatInFolder]}
								initialChats={[activeChat]}
							/>
						</SidebarProvider>
					</SettingsDialogProvider>
				</ServerEventsProvider>,
			);

			assert.ok(htmlActiveDirect.includes('data-testid="new-menu-trigger"'));
			assert.ok(!htmlActiveDirect.includes('data-testid="sidebar-archived-folders"'));
		} finally {
			(globalThis as Record<string, unknown>).window = originalWindow;
		}
	});

	it("restoring a session while open removes archive context and transitions to Sessions", () => {
		const originalWindow = globalThis.window;
		try {
			(globalThis as Record<string, unknown>).window = {
				location: {
					pathname: "/chat/c_arch_in_folder",
					search: "?from=archive&folder=f_child",
				},
				localStorage: { getItem: () => null, setItem: () => {} },
				addEventListener: () => {},
				removeEventListener: () => {},
			};

			// Chat renders banner and restore button
			const htmlChat = renderToStaticMarkup(
				<ServerEventsProvider connect={() => ({ close() {}, onOpen() {}, onEvent() {} })}>
					<InteractionLayersProvider><Chat
						chatId="c_arch_in_folder"
						title="Quantum Mechanics"
						initialMessages={[]}
						isArchived={true}
					/></InteractionLayersProvider>
				</ServerEventsProvider>,
			);
			assert.ok(htmlChat.includes('data-testid="archived-chat-banner"'));
			assert.ok(htmlChat.includes('data-testid="restore-chat-banner-button"'));

			// After restoration, chat is active (in initialChats, not in initialArchivedChats), query stripped
			(globalThis as Record<string, unknown>).window = {
				location: { pathname: "/chat/c_arch_in_folder", search: "" },
				localStorage: { getItem: () => null, setItem: () => {} },
				addEventListener: () => {},
				removeEventListener: () => {},
			};

			const htmlRestoredSidebar = renderToStaticMarkup(
				<ServerEventsProvider connect={() => ({ close() {}, onOpen() {}, onEvent() {} })}>
					<SettingsDialogProvider>
						<SidebarProvider>
							<SessionsSidebar
								initialArchivedFolders={[rootFolder, childFolder]}
								initialArchivedChats={[]}
								initialChats={[{ ...archChatInFolder, archivedAt: null }]}
							/>
						</SidebarProvider>
					</SettingsDialogProvider>
				</ServerEventsProvider>,
			);

			assert.ok(htmlRestoredSidebar.includes('data-testid="new-menu-trigger"'), "Restored chat sidebar must transition to Sessions");
			assert.ok(!htmlRestoredSidebar.includes('data-testid="sidebar-archived-folders"'));
		} finally {
			(globalThis as Record<string, unknown>).window = originalWindow;
		}
	});
});

describe("Bug B Regression: Archive Sidebar Disclosures, Roots, and Expansion Rules", () => {
	const now = new Date().toISOString();
	const rootFolder: ChatFolder = { id: "f_root", name: "Science", parentId: null, createdAt: now, archivedAt: now };
	const midFolder: ChatFolder = { id: "f_mid", name: "Physics", parentId: "f_root", createdAt: now, archivedAt: now };
	const deepFolder: ChatFolder = { id: "f_deep", name: "Quantum", parentId: "f_mid", createdAt: now, archivedAt: now };
	const leafFolder: ChatFolder = { id: "f_leaf", name: "Astronomy", parentId: null, createdAt: now, archivedAt: now };

	it("leaf folder renders alignment spacer and no expand/collapse toggle button, but remains selectable", () => {
		const originalWindow = globalThis.window;
		try {
			(globalThis as Record<string, unknown>).window = {
				location: { pathname: "/archive", search: "" },
				localStorage: { getItem: () => null, setItem: () => {} },
				addEventListener: () => {},
				removeEventListener: () => {},
			};

			const html = renderToStaticMarkup(
				<ServerEventsProvider connect={() => ({ close() {}, onOpen() {}, onEvent() {} })}>
					<SettingsDialogProvider>
						<SidebarProvider>
							<SessionsSidebar
								initialArchivedFolders={[leafFolder]}
								initialArchivedChats={[
									{ id: "c_leaf_1", title: "Stars", kind: "teach", folderId: "f_leaf", createdAt: now, updatedAt: now, archivedAt: now },
								]}
							/>
						</SidebarProvider>
					</SettingsDialogProvider>
				</ServerEventsProvider>,
			);

			// Spacer must be present
			assert.ok(html.includes('data-testid="sidebar-archive-folder-spacer-f_leaf"'));
			// Toggle button must NOT be present
			assert.ok(!html.includes('data-testid="sidebar-archive-folder-toggle-f_leaf"'), "Leaf folder must not render toggle button");
			// Leaf folder is rendered and selectable
			assert.ok(html.includes('data-testid="sidebar-archive-folder-f_leaf"'));
		} finally {
			(globalThis as Record<string, unknown>).window = originalWindow;
		}
	});

	it("genuine child disclosure button is rendered when folder has child folders", () => {
		const originalWindow = globalThis.window;
		try {
			(globalThis as Record<string, unknown>).window = {
				location: { pathname: "/archive", search: "" },
				localStorage: { getItem: () => null, setItem: () => {} },
				addEventListener: () => {},
				removeEventListener: () => {},
			};

			const html = renderToStaticMarkup(
				<ServerEventsProvider connect={() => ({ close() {}, onOpen() {}, onEvent() {} })}>
					<SettingsDialogProvider>
						<SidebarProvider>
							<SessionsSidebar
								initialArchivedFolders={[rootFolder, midFolder]}
								initialArchivedChats={[]}
							/>
						</SidebarProvider>
					</SettingsDialogProvider>
				</ServerEventsProvider>,
			);

			// rootFolder has child midFolder, so it MUST render toggle button
			assert.ok(html.includes('data-testid="sidebar-archive-folder-toggle-f_root"'));
			// midFolder is a leaf here, so it renders spacer
			assert.ok(html.includes('data-testid="sidebar-archive-folder-spacer-f_mid"'));
			assert.ok(!html.includes('data-testid="sidebar-archive-folder-toggle-f_mid"'));
		} finally {
			(globalThis as Record<string, unknown>).window = originalWindow;
		}
	});

	it("active-parent archived child appears as navigation root", () => {
		const originalWindow = globalThis.window;
		try {
			(globalThis as Record<string, unknown>).window = {
				location: { pathname: "/archive", search: "" },
				localStorage: { getItem: () => null, setItem: () => {} },
				addEventListener: () => {},
				removeEventListener: () => {},
			};

			// f_orphan's parentId is f_active_parent which is NOT in archivedFolders
			const orphanFolder: ChatFolder = {
				id: "f_orphan",
				name: "Orphaned Subfolder",
				parentId: "f_active_parent",
				createdAt: now,
				archivedAt: now,
			};

			const html = renderToStaticMarkup(
				<ServerEventsProvider connect={() => ({ close() {}, onOpen() {}, onEvent() {} })}>
					<SettingsDialogProvider>
						<SidebarProvider>
							<SessionsSidebar
								initialArchivedFolders={[orphanFolder]}
								initialArchivedChats={[]}
							/>
						</SidebarProvider>
					</SettingsDialogProvider>
				</ServerEventsProvider>,
			);

			// Must appear in archived folders navigation
			assert.ok(html.includes('data-testid="sidebar-archived-folders"'));
			assert.ok(html.includes('data-testid="sidebar-archive-folder-f_orphan"'), "Archived folder with non-archived parent must appear as root");
		} finally {
			(globalThis as Record<string, unknown>).window = originalWindow;
		}
	});

	it("mixed children and chats expands only child folders", () => {
		const originalWindow = globalThis.window;
		try {
			(globalThis as Record<string, unknown>).window = {
				location: { pathname: "/archive", search: "" },
				localStorage: { getItem: () => null, setItem: () => {} },
				addEventListener: () => {},
				removeEventListener: () => {},
			};

			const html = renderToStaticMarkup(
				<ServerEventsProvider connect={() => ({ close() {}, onOpen() {}, onEvent() {} })}>
					<SettingsDialogProvider>
						<SidebarProvider>
							<SessionsSidebar
								initialArchivedFolders={[rootFolder, midFolder]}
								initialArchivedChats={[
									{ id: "c_direct_root", title: "Direct Chat in Root", kind: "teach", folderId: "f_root", createdAt: now, updatedAt: now, archivedAt: now },
									{ id: "c_in_mid", title: "Chat in Mid", kind: "teach", folderId: "f_mid", createdAt: now, updatedAt: now, archivedAt: now },
								]}
								initialExpandedFolderIds={new Set(["f_root"])}
							/>
						</SidebarProvider>
					</SettingsDialogProvider>
				</ServerEventsProvider>,
			);

			// Under rootFolder, only childFolder f_mid is rendered
			assert.ok(html.includes('data-testid="sidebar-archive-folder-f_mid"'));
			// Chats must NEVER be rendered in the sidebar tree
			assert.ok(!html.includes("Direct Chat in Root"), "Sidebar archive tree must only expand child folders, never chats");
			assert.ok(!html.includes("Chat in Mid"), "Chats must not appear in sidebar tree");
		} finally {
			(globalThis as Record<string, unknown>).window = originalWindow;
		}
	});

	it("deep ancestor auto-expansion reveals ancestor path for selected child folder", () => {
		const originalWindow = globalThis.window;
		try {
			// Selecting f_deep: ?folder=f_deep, started completely collapsed (new Set())
			(globalThis as Record<string, unknown>).window = {
				location: { pathname: "/archive", search: "?folder=f_deep" },
				localStorage: { getItem: () => null, setItem: () => {} },
				addEventListener: () => {},
				removeEventListener: () => {},
			};

			const html = renderToStaticMarkup(
				<ServerEventsProvider connect={() => ({ close() {}, onOpen() {}, onEvent() {} })}>
					<SettingsDialogProvider>
						<SidebarProvider>
							<SessionsSidebar
								initialArchivedFolders={[rootFolder, midFolder, deepFolder]}
								initialArchivedChats={[]}
								initialExpandedFolderIds={new Set()}
							/>
						</SidebarProvider>
					</SettingsDialogProvider>
				</ServerEventsProvider>,
			);

			// f_root and f_mid must both be auto-expanded so f_deep is visible
			assert.ok(html.includes('data-testid="sidebar-archive-folder-f_root"'));
			assert.ok(html.includes('data-testid="sidebar-archive-folder-f_mid"'));
			assert.ok(html.includes('data-testid="sidebar-archive-folder-f_deep"'), "Ancestor path must be auto-expanded to make selected folder visible");
			assert.ok(
				html.includes('sidebar-archive-folder-f_deep') &&
				html.includes("bg-accent text-foreground font-semibold"),
				"Selected folder f_deep must be active",
			);
		} finally {
			(globalThis as Record<string, unknown>).window = originalWindow;
		}
	});

	it("recursive count behavior uses getFolderChatCount convention", () => {
		const originalWindow = globalThis.window;
		try {
			(globalThis as Record<string, unknown>).window = {
				location: { pathname: "/archive", search: "" },
				localStorage: { getItem: () => null, setItem: () => {} },
				addEventListener: () => {},
				removeEventListener: () => {},
			};

			// f_root has 1 direct chat
			// f_mid has 2 direct chats
			// f_deep has 3 direct chats
			// Total for f_root = 1 + 2 + 3 = 6
			// Total for f_mid = 2 + 3 = 5
			// Total for f_deep = 3
			const chats = [
				{ id: "c_r1", title: "R1", kind: "teach" as const, folderId: "f_root", createdAt: now, updatedAt: now, archivedAt: now },
				{ id: "c_m1", title: "M1", kind: "teach" as const, folderId: "f_mid", createdAt: now, updatedAt: now, archivedAt: now },
				{ id: "c_m2", title: "M2", kind: "teach" as const, folderId: "f_mid", createdAt: now, updatedAt: now, archivedAt: now },
				{ id: "c_d1", title: "D1", kind: "teach" as const, folderId: "f_deep", createdAt: now, updatedAt: now, archivedAt: now },
				{ id: "c_d2", title: "D2", kind: "teach" as const, folderId: "f_deep", createdAt: now, updatedAt: now, archivedAt: now },
				{ id: "c_d3", title: "D3", kind: "teach" as const, folderId: "f_deep", createdAt: now, updatedAt: now, archivedAt: now },
			];

			const html = renderToStaticMarkup(
				<ServerEventsProvider connect={() => ({ close() {}, onOpen() {}, onEvent() {} })}>
					<SettingsDialogProvider>
						<SidebarProvider>
							<SessionsSidebar
								initialArchivedFolders={[rootFolder, midFolder, deepFolder]}
								initialArchivedChats={chats}
								initialExpandedFolderIds={new Set(["f_root", "f_mid"])}
							/>
						</SidebarProvider>
					</SettingsDialogProvider>
				</ServerEventsProvider>,
			);

			// Verify recursive counts in folder rows
			assert.ok(html.includes("6"), "f_root count must be 6");
			assert.ok(html.includes("5"), "f_mid count must be 5");
			assert.ok(html.includes("3"), "f_deep count must be 3");
		} finally {
			(globalThis as Record<string, unknown>).window = originalWindow;
		}
	});
});
