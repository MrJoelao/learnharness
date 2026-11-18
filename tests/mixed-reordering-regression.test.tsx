import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import { PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime.js";

import { ChatFolderTree } from "../components/chat-folder-tree.tsx";
import { SessionsSidebar, SidebarProvider } from "../components/sidebar.tsx";
import { SettingsDialogProvider } from "../components/settings/settings-dialog.tsx";
import { InteractionLayersProvider } from "../components/interaction-layers.tsx";
import { ServerEventsProvider } from "../components/server-events.tsx";
import { CHAT_DRAG_TYPE } from "../components/chat-organization-interactions.tsx";
import {
	parseOrganizationAction,
	applyOrganizationAction,
	emptyOrganizationV2,
	chatKey,
	workspaceKey,
	type OrganizationV2,
	type SiblingEntry,
} from "../src/core/organization.ts";
import type { ChatFolder, ChatDirectoryItem, WorkspaceDirectoryEntry } from "../src/core/index.ts";

const folderF1: ChatFolder = {
	id: "f1",
	name: "Mixed Study Folder",
	parentId: null,
	createdAt: "2026-11-01T00:00:00Z",
	order: 0,
};

const folderF2: ChatFolder = {
	id: "f2",
	name: "Other Folder",
	parentId: null,
	createdAt: "2026-11-01T00:00:00Z",
	order: 1,
};

const chatA: ChatDirectoryItem = {
	id: "chat-a",
	title: "Chat A (Algorithms)",
	kind: "teach",
	createdAt: "2026-11-01T10:00:00Z",
	updatedAt: "2026-11-01T10:00:00Z",
	folderId: "f1",
	order: 0,
};

const workspaceB: WorkspaceDirectoryEntry = {
	kind: "workspace",
	id: "workspace-b",
	title: "Workspace B (Lab)",
	pluginId: "study-plugin",
	modeId: "study-mode",
	createdAt: "2026-11-01T11:00:00Z",
	updatedAt: "2026-11-01T11:00:00Z",
	folderId: "f1",
	order: 1,
	archivedAt: null,
	availability: "available",
};

const chatC: ChatDirectoryItem = {
	id: "chat-c",
	title: "Chat C (Practice)",
	kind: "practice",
	createdAt: "2026-11-01T12:00:00Z",
	updatedAt: "2026-11-01T12:00:00Z",
	folderId: "f1",
	order: 2,
};

const chatOther: ChatDirectoryItem = {
	id: "chat-other",
	title: "Chat in Folder 2",
	kind: "teach",
	createdAt: "2026-11-01T13:00:00Z",
	updatedAt: "2026-11-01T13:00:00Z",
	folderId: "f2",
	order: 5,
};

class MockIntersectionObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
}

function setupDom() {
	const dom = parseHTML("<html><head></head><body><div id='root'></div></body></html>");
	const original = {
		window: (globalThis as Record<string, unknown>).window,
		self: (globalThis as Record<string, unknown>).self,
		document: (globalThis as Record<string, unknown>).document,
		HTMLElement: (globalThis as Record<string, unknown>).HTMLElement,
		Element: (globalThis as Record<string, unknown>).Element,
		Node: (globalThis as Record<string, unknown>).Node,
		IS_REACT_ACT_ENVIRONMENT: (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT,
		localStorage: (globalThis as Record<string, unknown>).localStorage,
		IntersectionObserver: (globalThis as Record<string, unknown>).IntersectionObserver,
		requestIdleCallback: (globalThis as Record<string, unknown>).requestIdleCallback,
		cancelIdleCallback: (globalThis as Record<string, unknown>).cancelIdleCallback,
		requestAnimationFrame: (globalThis as Record<string, unknown>).requestAnimationFrame,
		cancelAnimationFrame: (globalThis as Record<string, unknown>).cancelAnimationFrame,
	};

	const mockLocalStorage = {
		getItem: () => null,
		setItem: () => {},
		removeItem: () => {},
	};

	dom.window.localStorage = mockLocalStorage as any;
	dom.window.requestAnimationFrame = ((cb: (time: number) => void) => setTimeout(() => cb(Date.now()), 0)) as any;
	dom.window.cancelAnimationFrame = ((id: any) => clearTimeout(id)) as any;
	dom.window.requestIdleCallback = ((cb: any) => setTimeout(cb, 0)) as any;
	dom.window.cancelIdleCallback = ((id: any) => clearTimeout(id)) as any;

	Object.assign(globalThis, {
		window: dom.window,
		self: dom.window,
		document: dom.window.document,
		HTMLElement: dom.window.HTMLElement,
		Element: dom.window.Element,
		Node: dom.window.Node,
		IS_REACT_ACT_ENVIRONMENT: true,
		localStorage: mockLocalStorage,
		IntersectionObserver: MockIntersectionObserver,
		requestIdleCallback: dom.window.requestIdleCallback,
		cancelIdleCallback: dom.window.cancelIdleCallback,
		requestAnimationFrame: dom.window.requestAnimationFrame,
		cancelAnimationFrame: dom.window.cancelAnimationFrame,
	});

	return {
		dom,
		restore: () => {
			Object.assign(globalThis, original);
		},
	};
}

describe("RUN 5.1: Mixed Chat/Workspace Reordering Regression Suite", () => {
	it("1 & 2. Drag & Drop on interleaved [chat A, workspace B, chat C] emits typed entries preserving kind", async () => {
		const { dom, restore } = setupDom();

		try {
			let capturedParentId: string | null = null;
			let capturedKind: string | null = null;
			let capturedIds: string[] = [];
			let capturedEntries: SiblingEntry[] | undefined = undefined;

			const root = createRoot(dom.window.document.getElementById("root")!);

			await act(async () => {
				root.render(
					<ChatFolderTree
						folders={[folderF1]}
						items={[chatA, workspaceB, chatC]}
						chats={[chatA, chatC]}
						activeChatId={null}
						activeWorkspaceId={null}
						expandedFolderIds={new Set(["f1"])}
						onToggleFolder={() => {}}
						onSelectChat={() => {}}
						onSelectWorkspace={() => {}}
						onReorderSiblings={(parentId, kind, ids, entries) => {
							capturedParentId = parentId;
							capturedKind = kind;
							capturedIds = ids;
							capturedEntries = entries;
						}}
					/>,
				);
			});

			// Find target chat-a row container
			const chatAContainer = dom.window.document.querySelector('[data-chat-drag-row="chat-a"]') as HTMLElement;
			assert.ok(chatAContainer, "Chat A container must exist");

			// Mock getBoundingClientRect on target
			chatAContainer.getBoundingClientRect = () =>
				({ top: 100, bottom: 132, height: 32, left: 0, right: 200, width: 200, x: 0, y: 100 } as DOMRect);

			// 1. Drag chat-c and drop before chat-a:
			const dragData: Record<string, string> = {
				[CHAT_DRAG_TYPE]: JSON.stringify({ kind: "chat", id: "chat-c", parentId: "f1" }),
			};
			const mockDataTransfer = {
				types: [CHAT_DRAG_TYPE],
				getData: (type: string) => dragData[type] ?? "",
				setData: () => {},
				dropEffect: "move",
				effectAllowed: "move",
			};

			// Drag over the top half of chat A (offsetY = 5 < 32 / 2 -> position: 'before')
			await act(async () => {
				const dragOverEvent = new dom.window.CustomEvent("dragover", { bubbles: true });
				Object.assign(dragOverEvent, {
					clientY: 105,
					dataTransfer: mockDataTransfer,
					preventDefault: () => {},
					stopPropagation: () => {},
				});
				chatAContainer.dispatchEvent(dragOverEvent);
			});

			// Drop chat-c
			await act(async () => {
				const dropEvent = new dom.window.CustomEvent("drop", { bubbles: true });
				Object.assign(dropEvent, {
					dataTransfer: mockDataTransfer,
					preventDefault: () => {},
					stopPropagation: () => {},
				});
				chatAContainer.dispatchEvent(dropEvent);
			});

			assert.equal(capturedParentId, "f1", "Parent must be f1");
			assert.equal(capturedKind, "chat", "Payload kind was chat");
			assert.deepEqual(capturedIds, ["chat-c", "chat-a", "workspace-b"], "Ids must be in new sequence [C, A, B]");
			assert.ok(capturedEntries, "Typed entries must be passed");
			assert.deepEqual(
				capturedEntries,
				[
					{ kind: "chat", id: "chat-c" },
					{ kind: "chat", id: "chat-a" },
					{ kind: "workspace", id: "workspace-b" },
				],
				"Entries must preserve exact typed kinds for all items",
			);

			// 2. Now drag workspace-b and drop before chat-c (offsetY = 5)
			const dragWsData: Record<string, string> = {
				[CHAT_DRAG_TYPE]: JSON.stringify({ kind: "workspace", id: "workspace-b", parentId: "f1" }),
			};
			const mockWsDataTransfer = {
				types: [CHAT_DRAG_TYPE],
				getData: (type: string) => dragWsData[type] ?? "",
				setData: () => {},
				dropEffect: "move",
				effectAllowed: "move",
			};

			await act(async () => {
				const dragOverEvent = new dom.window.CustomEvent("dragover", { bubbles: true });
				Object.assign(dragOverEvent, {
					clientY: 105,
					dataTransfer: mockWsDataTransfer,
					preventDefault: () => {},
					stopPropagation: () => {},
				});
				chatAContainer.dispatchEvent(dragOverEvent);
			});

			await act(async () => {
				const dropEvent = new dom.window.CustomEvent("drop", { bubbles: true });
				Object.assign(dropEvent, {
					dataTransfer: mockWsDataTransfer,
					preventDefault: () => {},
					stopPropagation: () => {},
				});
				chatAContainer.dispatchEvent(dropEvent);
			});

			assert.equal(capturedKind, "workspace");
			assert.deepEqual(
				capturedEntries,
				[
					{ kind: "workspace", id: "workspace-b" },
					{ kind: "chat", id: "chat-a" },
					{ kind: "chat", id: "chat-c" },
				],
				"Workspace kind must be preserved when workspace is dragged",
			);

			await act(async () => {
				root.unmount();
			});
		} finally {
			restore();
		}
	});

	it("3. Sidebar onReorderSiblings sends reorder-mixed-siblings to /api/directory with typed payload", async () => {
		const { dom, restore } = setupDom();
		const originalFetch = globalThis.fetch;

		try {
			const fetchCalls: Array<{ url: string; method: string; body: any }> = [];
			globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
				const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
				const method = init?.method ?? "GET";
				const body = init?.body ? JSON.parse(init.body as string) : undefined;
				fetchCalls.push({ url, method, body });

				if (method === "GET") {
					return {
						ok: true,
						status: 200,
						json: async () => ({
							organization: { version: 2, folders: [folderF1], placements: {} },
							folders: [folderF1],
							items: [chatA, workspaceB, chatC],
						}),
					} as Response;
				}

				return {
					ok: true,
					status: 200,
					json: async () => ({ ok: true }),
				} as Response;
			}) as typeof fetch;

			const root = createRoot(dom.window.document.getElementById("root")!);

			await act(async () => {
				root.render(
					<AppRouterContext.Provider value={{ push: () => {}, replace: () => {}, refresh: () => {} } as any}>
						<PathnameContext.Provider value="/">
							<ServerEventsProvider connect={() => ({ close() {}, onOpen() {}, onEvent() {} })}>
								<InteractionLayersProvider>
									<SettingsDialogProvider>
										<SidebarProvider>
											<SessionsSidebar
												initialFolders={[folderF1]}
												initialChats={[chatA, workspaceB, chatC]}
												initialExpandedFolderIds={new Set(["f1"])}
											/>
										</SidebarProvider>
									</SettingsDialogProvider>
								</InteractionLayersProvider>
							</ServerEventsProvider>
						</PathnameContext.Provider>
					</AppRouterContext.Provider>,
				);
			});

			// Trigger drop on chat-a
			const chatAContainer = dom.window.document.querySelector('[data-chat-drag-row="chat-a"]') as HTMLElement;
			assert.ok(chatAContainer, "Chat A drag container must render in the sidebar");

			chatAContainer.getBoundingClientRect = () =>
				({ top: 100, bottom: 132, height: 32, left: 0, right: 200, width: 200, x: 0, y: 100 } as DOMRect);

			const dragData: Record<string, string> = {
				[CHAT_DRAG_TYPE]: JSON.stringify({ kind: "chat", id: "chat-c", parentId: "f1" }),
			};
			const mockDataTransfer = {
				types: [CHAT_DRAG_TYPE],
				getData: (type: string) => dragData[type] ?? "",
				setData: () => {},
				dropEffect: "move",
				effectAllowed: "move",
			};

			await act(async () => {
				const dragOverEvent = new dom.window.CustomEvent("dragover", { bubbles: true });
				Object.assign(dragOverEvent, {
					clientY: 105,
					dataTransfer: mockDataTransfer,
					preventDefault: () => {},
					stopPropagation: () => {},
				});
				chatAContainer.dispatchEvent(dragOverEvent);
			});

			await act(async () => {
				const dropEvent = new dom.window.CustomEvent("drop", { bubbles: true });
				Object.assign(dropEvent, {
					dataTransfer: mockDataTransfer,
					preventDefault: () => {},
					stopPropagation: () => {},
				});
				chatAContainer.dispatchEvent(dropEvent);
			});

			// Find POST call for reordering
			const reorderCall = fetchCalls.find(
				(c) => c.body?.action === "reorder-mixed-siblings" || c.body?.action === "reorder-siblings",
			);
			assert.ok(reorderCall, "Reorder action must be dispatched via fetch");
			assert.equal(reorderCall.url, "/api/directory", "Must target /api/directory");
			assert.equal(reorderCall.method, "POST");
			assert.equal(reorderCall.body.action, "reorder-mixed-siblings");
			assert.equal(reorderCall.body.parentId, "f1");
			assert.deepEqual(reorderCall.body.entries, [
				{ kind: "chat", id: "chat-c" },
				{ kind: "chat", id: "chat-a" },
				{ kind: "workspace", id: "workspace-b" },
			]);

			await act(async () => {
				root.unmount();
			});
		} finally {
			restore();
			globalThis.fetch = originalFetch;
		}
	});

	it("4. Backend applyOrganizationAction updates orders of chat and workspace according to received sequence", () => {
		const org: OrganizationV2 = {
			...emptyOrganizationV2(),
			folders: [folderF1],
			placements: {
				[chatKey("chat-a")]: { folderId: "f1", order: 0 },
				[workspaceKey("workspace-b")]: { folderId: "f1", order: 1 },
				[chatKey("chat-c")]: { folderId: "f1", order: 2 },
			},
		};

		const knownKeys = new Set([
			chatKey("chat-a"),
			workspaceKey("workspace-b"),
			chatKey("chat-c"),
		]);

		const action = parseOrganizationAction({
			action: "reorder-mixed-siblings",
			parentId: "f1",
			entries: [
				{ kind: "chat", id: "chat-c" },
				{ kind: "workspace", id: "workspace-b" },
				{ kind: "chat", id: "chat-a" },
			],
		});

		const next = applyOrganizationAction(org, action, knownKeys, { id: "f_fresh", createdAt: "" });

		assert.equal(next.placements[chatKey("chat-c")]?.order, 0, "chat-c is first (order 0)");
		assert.equal(next.placements[workspaceKey("workspace-b")]?.order, 1, "workspace-b is second (order 1)");
		assert.equal(next.placements[chatKey("chat-a")]?.order, 2, "chat-a is third (order 2)");
	});

	it("5. Reordering does not modify placements of items belonging to another folder", () => {
		const org: OrganizationV2 = {
			...emptyOrganizationV2(),
			folders: [folderF1, folderF2],
			placements: {
				[chatKey("chat-a")]: { folderId: "f1", order: 0 },
				[workspaceKey("workspace-b")]: { folderId: "f1", order: 1 },
				[chatKey("chat-c")]: { folderId: "f1", order: 2 },
				[chatKey("chat-other")]: { folderId: "f2", order: 5 },
				[workspaceKey("workspace-root")]: { folderId: null, order: 8 },
			},
		};

		const knownKeys = new Set([
			chatKey("chat-a"),
			workspaceKey("workspace-b"),
			chatKey("chat-c"),
			chatKey("chat-other"),
			workspaceKey("workspace-root"),
		]);

		const action = parseOrganizationAction({
			action: "reorder-mixed-siblings",
			parentId: "f1",
			entries: [
				{ kind: "chat", id: "chat-c" },
				{ kind: "chat", id: "chat-a" },
				{ kind: "workspace", id: "workspace-b" },
			],
		});

		const next = applyOrganizationAction(org, action, knownKeys, { id: "f_fresh", createdAt: "" });

		assert.equal(next.placements[chatKey("chat-other")]?.folderId, "f2", "chat-other folderId remains f2");
		assert.equal(next.placements[chatKey("chat-other")]?.order, 5, "chat-other order remains 5");
		assert.equal(next.placements[workspaceKey("workspace-root")]?.folderId, null, "workspace-root folderId remains null");
		assert.equal(next.placements[workspaceKey("workspace-root")]?.order, 8, "workspace-root order remains 8");
	});

	it("6. Folder-only reordering continues to function via reorder-siblings without entries", () => {
		const org: OrganizationV2 = {
			...emptyOrganizationV2(),
			folders: [
				{ ...folderF1, order: 0 },
				{ ...folderF2, order: 1 },
			],
			placements: {},
		};

		const action = parseOrganizationAction({
			action: "reorder-siblings",
			parentId: null,
			kind: "folder",
			ids: ["f2", "f1"],
		});

		const next = applyOrganizationAction(org, action, new Set(), { id: "f_fresh", createdAt: "" });

		const f2 = next.folders.find((f) => f.id === "f2");
		const f1 = next.folders.find((f) => f.id === "f1");
		assert.equal(f2?.order, 0, "Folder f2 reordered to 0");
		assert.equal(f1?.order, 1, "Folder f1 reordered to 1");
	});

	it("7. Chat-only reordering continues to work passing through the new typed path and /api/directory", () => {
		const org: OrganizationV2 = {
			...emptyOrganizationV2(),
			folders: [folderF1],
			placements: {
				[chatKey("chat-a")]: { folderId: "f1", order: 0 },
				[chatKey("chat-c")]: { folderId: "f1", order: 1 },
			},
		};

		const knownKeys = new Set([chatKey("chat-a"), chatKey("chat-c")]);

		const action = parseOrganizationAction({
			action: "reorder-mixed-siblings",
			parentId: "f1",
			entries: [
				{ kind: "chat", id: "chat-c" },
				{ kind: "chat", id: "chat-a" },
			],
		});

		const next = applyOrganizationAction(org, action, knownKeys, { id: "f_fresh", createdAt: "" });

		assert.equal(next.placements[chatKey("chat-c")]?.order, 0, "chat-c reordered to 0");
		assert.equal(next.placements[chatKey("chat-a")]?.order, 1, "chat-a reordered to 1");
	});
});

describe("P2: Directory and Archive UX Consistency Suite", () => {
	it("folder counters and aria-labels describe total of chats and workspaces without declaring sessions-only", async () => {
		const { renderToStaticMarkup } = await import("react-dom/server");
		const { ChatFolderRow } = await import("../components/chat-folder-tree.tsx");

		// Folder with 3 items (mixed)
		const html = renderToStaticMarkup(
			<ChatFolderRow
				folder={folderF1}
				depth={0}
				isOpen={true}
				chatCount={3}
				onToggle={() => {}}
			/>,
		);

		assert.ok(html.includes('data-testid="folder-count-f1"'));
		assert.ok(html.includes('aria-label="3 items"'), "aria-label must describe items, not sessions");
		assert.ok(!html.includes("3 sessions"), "aria-label must not declare session-only count");
	});

	it("Archive page empty states use neutral items language", async () => {
		const { renderToStaticMarkup } = await import("react-dom/server");
		const { ArchivePage } = await import("../components/archive-page.tsx");

		// 1. Global empty archive
		const htmlEmpty = renderToStaticMarkup(
			<ServerEventsProvider connect={() => ({ close() {}, onOpen() {}, onEvent() {} })}>
				<ArchivePage initialFolders={[]} initialChats={[]} />
			</ServerEventsProvider>,
		);

		assert.ok(htmlEmpty.includes("Archive is empty"));
		assert.ok(htmlEmpty.includes("Items and folders you archive will appear here."), "Empty state explains items and folders");
		assert.ok(!htmlEmpty.includes("Sessions and folders you archive"), "Does not say sessions and folders");

		// 2. Search no results
		const htmlNoSearch = renderToStaticMarkup(
			<ServerEventsProvider connect={() => ({ close() {}, onOpen() {}, onEvent() {} })}>
				<ArchivePage
					initialFolders={[folderF1]}
					initialChats={[chatA]}
					initialSearchQuery="nonexistent"
				/>
			</ServerEventsProvider>,
		);
		assert.ok(htmlNoSearch.includes("No archived items match search"));
		assert.ok(!htmlNoSearch.includes("No archived sessions match search"));

		// 3. Filter no results (when filter matches nothing)
		const htmlNoFilter = renderToStaticMarkup(
			<ServerEventsProvider connect={() => ({ close() {}, onOpen() {}, onEvent() {} })}>
				<ArchivePage
					initialFolders={[]}
					initialChats={[{ ...chatA, kind: "teach", folderId: null }]}
					initialKindFilter="practice"
				/>
			</ServerEventsProvider>,
		);
		// Note: kindFilter !== "all" with no matching chats
		// When no practice items match
		assert.ok(
			htmlNoFilter.includes("No archived items match filter") ||
			htmlNoFilter.includes("No archived items match search"),
			"Uses neutral items language in no results state",
		);
	});

	it("Archive page TopBar and folder counters display items count and include workspaces", async () => {
		const { renderToStaticMarkup } = await import("react-dom/server");
		const { ArchivePage } = await import("../components/archive-page.tsx");

		const archivedFolder: ChatFolder = {
			id: "f_arch",
			name: "Archived Project",
			parentId: null,
			createdAt: "2026-11-01T00:00:00Z",
			archivedAt: "2026-11-02T00:00:00Z",
		};

		const archChat: ChatDirectoryItem = {
			id: "c_arch",
			title: "Archived Chat",
			kind: "teach",
			createdAt: "2026-11-01T00:00:00Z",
			updatedAt: "2026-11-01T00:00:00Z",
			folderId: "f_arch",
			archivedAt: "2026-11-02T00:00:00Z",
		};

		const archWorkspace: WorkspaceDirectoryEntry = {
			kind: "workspace",
			id: "ws_arch",
			title: "Archived Workspace",
			pluginId: "study",
			modeId: "lab",
			createdAt: "2026-11-01T00:00:00Z",
			updatedAt: "2026-11-01T00:00:00Z",
			folderId: "f_arch",
			archivedAt: "2026-11-02T00:00:00Z",
			availability: "available",
		};

		const html = renderToStaticMarkup(
			<ServerEventsProvider connect={() => ({ close() {}, onOpen() {}, onEvent() {} })}>
				<ArchivePage
					initialFolders={[archivedFolder]}
					initialItems={[archChat, archWorkspace]}
				/>
			</ServerEventsProvider>,
		);

		// TopBar count includes both chat and workspace: (2 items)
		assert.ok(html.includes("(2 items)"), "TopBar count must show 2 items");

		// Compact folder row shows 2 items
		assert.ok(html.includes("2 items"), "Folder row shows 2 items count");

		// Section header distinguishes mixed content
		assert.ok(html.includes("Archived Items"), "Section header shows Archived Items when workspaces are present");
	});

	it("Archive page child conversations heading uses neutral Items when workspace is present, Sessions when only sessions", async () => {
		const { renderToStaticMarkup } = await import("react-dom/server");
		const { ArchivePage } = await import("../components/archive-page.tsx");

		const originalWindow = (globalThis as Record<string, unknown>).window;
		try {
			(globalThis as Record<string, unknown>).window = {
				location: { pathname: "/archive", search: "?folder=f_arch" },
				addEventListener: () => {},
				removeEventListener: () => {},
			};

			const archivedFolder: ChatFolder = {
				id: "f_arch",
				name: "Archived Project",
				parentId: null,
				createdAt: "2026-11-01T00:00:00Z",
				archivedAt: "2026-11-02T00:00:00Z",
			};

			const childFolder: ChatFolder = {
				id: "f_child",
				name: "Subproject",
				parentId: "f_arch",
				createdAt: "2026-11-01T00:00:00Z",
				archivedAt: "2026-11-02T00:00:00Z",
			};

			const archChat: ChatDirectoryItem = {
				id: "c_arch",
				title: "Archived Chat",
				kind: "teach",
				createdAt: "2026-11-01T00:00:00Z",
				updatedAt: "2026-11-01T00:00:00Z",
				folderId: "f_arch",
				archivedAt: "2026-11-02T00:00:00Z",
			};

			const archWorkspace: WorkspaceDirectoryEntry = {
				kind: "workspace",
				id: "ws_arch",
				title: "Archived Workspace",
				pluginId: "study",
				modeId: "lab",
				createdAt: "2026-11-01T00:00:00Z",
				updatedAt: "2026-11-01T00:00:00Z",
				folderId: "f_arch",
				archivedAt: "2026-11-02T00:00:00Z",
				availability: "available",
			};

			// Case 1: Mixed (chat + workspace) inside folder view
			const htmlMixed = renderToStaticMarkup(
				<ServerEventsProvider connect={() => ({ close() {}, onOpen() {}, onEvent() {} })}>
					<ArchivePage
						initialFolders={[archivedFolder, childFolder]}
						initialItems={[archChat, archWorkspace]}
					/>
				</ServerEventsProvider>,
			);

			assert.ok(htmlMixed.includes("Items (2)"), "Heading shows Items (2) when both chats and workspaces exist");

			// Case 2: Only sessions inside folder view
			const htmlSessionsOnly = renderToStaticMarkup(
				<ServerEventsProvider connect={() => ({ close() {}, onOpen() {}, onEvent() {} })}>
					<ArchivePage
						initialFolders={[archivedFolder, childFolder]}
						initialChats={[archChat]}
					/>
				</ServerEventsProvider>,
			);

			assert.ok(htmlSessionsOnly.includes("Sessions (1)"), "Heading shows Sessions (1) when only chats exist");
		} finally {
			(globalThis as Record<string, unknown>).window = originalWindow;
		}
	});
});
