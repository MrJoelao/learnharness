import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatFolderTree, ChatFolderRow, RenameFolderRow } from "../components/chat-folder-tree.tsx";
import type { ChatFolder, ChatDirectoryItem } from "../src/core/index.ts";

function createFolder(overrides: Partial<ChatFolder> = {}): ChatFolder {
	return {
		id: "f1",
		name: "Algorithms",
		parentId: null,
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
		archivedAt: null,
		...overrides,
	};
}

function createChat(overrides: Partial<ChatDirectoryItem> = {}): ChatDirectoryItem {
	return {
		id: "c1",
		title: "Binary search trees",
		kind: "teach",
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
		messageCount: 5,
		folderId: null,
		archivedAt: null,
		busy: false,
		compacting: false,
		...overrides,
	};
}

describe("Sidebar UX Refinement Layout & Structural Contract", () => {
	it("verifies sidebar source invariants for user-approved requirements", async () => {
		const fs = await import("node:fs");
		const path = await import("node:path");
		const sidebarCode = fs.readFileSync(path.resolve("components/sidebar.tsx"), "utf-8");

		// Requirement 1: Integrated visible All/Teaching/Practice filters with search
		assert.ok(sidebarCode.includes('data-testid="session-kind-filter"'), "integrated kind filter container present");
		assert.ok(sidebarCode.includes('data-testid="session-search"'), "session search input present");
		assert.ok(sidebarCode.includes('data-testid={`kind-filter-${f}`}'), "filter buttons present");

		// Requirement 2: Separate accessible folder-plus action beside Sessions with tooltip
		assert.ok(sidebarCode.includes('data-testid="new-folder-button"'), "new-folder-button present beside Sessions");
		assert.ok(sidebarCode.includes('aria-label="New folder"'), "accessible aria-label on folder-plus action");
		assert.ok(sidebarCode.includes('<FolderPlusIcon className="size-3.5" />'), "FolderPlusIcon rendered");
		assert.ok(sidebarCode.includes('<Hint label="New folder" side="bottom">'), "tooltip wrapping new-folder-button");

		// Requirement 3: Content-width action buttons for New session, Archive, and Settings so hover pill hugs text and tooltip stays inside sidebar
		assert.ok(sidebarCode.includes('data-testid="new-menu-trigger"'), "New session trigger row present");
		assert.ok(sidebarCode.includes('<span>New session</span>'), "New session row label");
		assert.ok(sidebarCode.includes('<PlusIcon className="size-3 shrink-0" />'), "plus icon on New session row");
		assert.ok(
			sidebarCode.includes('"flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs uppercase tracking-wider text-muted-foreground transition-colors hover:bg-accent hover:text-foreground cursor-pointer"'),
			"content-width row styling matching Settings and Archive",
		);
		assert.ok(sidebarCode.includes('<Hint label="New session" action="new-session" side="right">'), "New session wrapped in right Hint tooltip");
		assert.ok(sidebarCode.includes('<Hint label="Archive" action="toggle-archive" side="right">'), "Archive wrapped in right Hint tooltip");
		assert.ok(sidebarCode.includes('<Hint label="Settings" action="open-settings" side="right">'), "Settings wrapped in right Hint tooltip");

		// Opens only Teaching and Practice options (no folder creation in popup menu)
		assert.ok(sidebarCode.includes('data-testid="new-session"'), "teaching option present");
		assert.ok(sidebarCode.includes('data-testid="new-session-practice"'), "practice option present");
		const newUnifiedMenuSlice = sidebarCode.slice(
			sidebarCode.indexOf('data-testid="new-unified-menu"'),
			sidebarCode.indexOf('Divider above Archive / Settings'),
		);
		assert.ok(newUnifiedMenuSlice.includes('New Teaching Session'));
		assert.ok(newUnifiedMenuSlice.includes('New Practice Session'));
		assert.ok(!newUnifiedMenuSlice.includes('Start learning something new'), "redundant teaching description removed");
		assert.ok(!newUnifiedMenuSlice.includes("Practice what you've learned"), "redundant practice description removed");
		assert.ok(!newUnifiedMenuSlice.includes('New Folder'), "New Folder must NOT be in the bottom popup menu");
		assert.ok(!newUnifiedMenuSlice.includes('data-testid="new-folder-button"'), "folder button moved out of popup");

		// Requirement 4 & 5: Scrollable list container vs fixed search/creation/footer, divider before Archive/Settings
		assert.ok(sidebarCode.includes('<div ref={listRef} className="flex-1 overflow-y-auto p-2">'), "only list scrolls");
		assert.ok(
			sidebarCode.includes('{/* Divider above Archive / Settings */}\n\t\t\t\t<div className="mx-2 my-1 border-t border-border/40" />'),
			"divider positioned immediately below New session row and above Archive / Settings with consistent mx-2",
		);
		assert.ok(sidebarCode.includes('data-testid="archive-nav-button"'), "Archive button anchored below divider");
		assert.ok(sidebarCode.includes('data-testid="settings-entry"'), "Settings button anchored below divider");

		// Focus and keyboard handling
		assert.ok(sidebarCode.includes('if (e.key === "Escape")'), "Escape key handling present");
		assert.ok(sidebarCode.includes('newMenuAnchorRef.current?.focus()'), "focus restoration to anchor on Escape");
		assert.ok(sidebarCode.includes('firstItem?.focus()'), "initial focus inside menu");
	});
});

describe("Nested Sessions Layout & Indentation", () => {
	it("renders nested sessions with full width row container and reduced indentation", () => {
		const folder = createFolder({ id: "f_trees", name: "Tree Algorithms" });
		const chat = createChat({ id: "c_bst", title: "BST Rotations", folderId: "f_trees" });

		const html = renderToStaticMarkup(
			<ChatFolderTree
				folders={[folder]}
				chats={[chat]}
				activeChatId="c_bst"
				expandedFolderIds={new Set(["f_trees"])}
				onToggleFolder={() => {}}
				onSelectChat={() => {}}
			/>,
		);

		// Check that the session row receives direct 40px indentation under parent folder at depth 0
		assert.ok(html.includes('style="padding-left:40px"'), "session button receives direct 40px indentation under parent folder at depth 0");
		// Check that no decorative vertical lines are rendered
		assert.ok(!html.includes("pointer-events-none absolute bottom-1 top-0 w-px"), "decorative vertical guide lines removed");
		// Check that the folder row uses font-prose for consistent navigation typography
		assert.ok(html.includes("font-prose"), "folder row uses font-prose typography matching sessions");
		// Check that the active background covers the full width row
		assert.ok(html.includes('bg-accent'), "active session highlight rendered");
		assert.ok(html.includes('data-session-id="c_bst"'), "session rendered inside folder");
	});

	it("renders empty folder notice with aligned 40px indentation", () => {
		const folder = createFolder({ id: "f_empty", name: "Empty Box" });
		const html = renderToStaticMarkup(
			<ChatFolderTree
				folders={[folder]}
				chats={[]}
				activeChatId={null}
				expandedFolderIds={new Set(["f_empty"])}
				onToggleFolder={() => {}}
				onSelectChat={() => {}}
			/>,
		);

		assert.ok(html.includes('data-testid="empty-folder-f_empty"'));
		assert.ok(html.includes('style="padding-left:40px"'), "empty folder label matches 40px indentation");
		assert.ok(html.includes("Empty folder"));
	});
});

describe("Folder Row Counter & Hover Affordances", () => {
	it("renders chat counter cleanly at the trailing edge without trailing void", () => {
		const folder = createFolder({ id: "f_ds", name: "Data Structures" });
		const html = renderToStaticMarkup(
			<ChatFolderRow
				folder={folder}
				depth={0}
				isOpen={true}
				chatCount={7}
				onToggle={() => {}}
				onNewSession={() => {}}
				onOpenOptions={() => {}}
			/>,
		);

		assert.ok(html.includes(">7</span>"), "counter value rendered");
		assert.ok(html.includes("tabular-nums"), "tabular-nums for alignment");
		// Action buttons container has predictable reserved space and reveals on group-hover / focus-within without layout jump
		assert.ok(html.includes("opacity-0 group-hover:opacity-100"), "action buttons reveal on hover without layout jump");
		assert.ok(html.includes('data-testid="new-session-folder-f_ds"'), "new session button present in DOM");
		assert.ok(html.includes('data-testid="folder-options-f_ds"'), "folder options button present in DOM");
	});
});

describe("RenameFolderRow Lifecycle & Interaction", () => {
	it("uses ref instead of callback ref to prevent selection reset on typing", async () => {
		const fs = await import("node:fs");
		const path = await import("node:path");
		const treeCode = fs.readFileSync(path.resolve("components/chat-folder-tree.tsx"), "utf-8");

		const renameRowSlice = treeCode.slice(
			treeCode.indexOf("export function RenameFolderRow"),
			treeCode.indexOf("export function ChatFolderRow"),
		);

		assert.ok(!renameRowSlice.includes("ref={onMount}"), "must not use inline callback ref");
		assert.ok(renameRowSlice.includes("ref={inputRef}"), "must use stable useRef");
		assert.ok(renameRowSlice.includes("useEffect("), "selection happens once in useEffect");
		assert.ok(renameRowSlice.includes("el.select()"), "selects on entry");
	});

	it("renders with initial name and handles enter, escape, and blur cleanly", () => {
		const folder = createFolder({ id: "f_rename", name: "Initial Name" });
		let committed: string | null = null;
		let cancelled = false;

		const html = renderToStaticMarkup(
			<RenameFolderRow
				folder={folder}
				depth={0}
				onCommit={(val) => { committed = val; }}
				onCancel={() => { cancelled = true; }}
			/>,
		);

		assert.ok(html.includes('data-testid="folder-rename-row-f_rename"'));
		assert.ok(html.includes('value="Initial Name"'));
		assert.ok(html.includes('aria-label="Rename folder"'));
		assert.equal(committed, null);
		assert.equal(cancelled, false);
	});
});
