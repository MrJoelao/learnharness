import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import { PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime.js";

import { ChatFolderTree } from "../components/chat-folder-tree.tsx";
import { SessionsSidebar, SidebarProvider } from "../components/sidebar.tsx";
import { SettingsDialogProvider } from "../components/settings/settings-dialog.tsx";
import { InteractionLayersProvider } from "../components/interaction-layers.tsx";
import { ServerEventsProvider } from "../components/server-events.tsx";
import { WorkspaceRow, RenameWorkspaceRow } from "../components/workspace-row.tsx";
import type { ChatDirectoryItem, WorkspaceDirectoryEntry } from "../src/core/index.ts";

const sampleChat: ChatDirectoryItem = {
	id: "chat-alpha",
	title: "Computer Networks Lecture",
	kind: "teach",
	createdAt: "2026-11-01T10:00:00Z",
	updatedAt: "2026-11-01T10:00:00Z",
	folderId: null,
	archivedAt: null,
};

const sampleWorkspace: WorkspaceDirectoryEntry = {
	kind: "workspace",
	id: "workspace-beta",
	title: "TCP/IP Packet Simulator",
	pluginId: "network-tools",
	modeId: "tcp-simulator",
	createdAt: "2026-11-01T11:00:00Z",
	updatedAt: "2026-11-01T11:00:00Z",
	folderId: null,
	archivedAt: null,
	availability: "available",
};

const samplePracticeChat: ChatDirectoryItem = {
	id: "chat-practice",
	title: "Practice Exercises",
	kind: "practice",
	createdAt: "2026-11-01T10:15:00Z",
	updatedAt: "2026-11-01T10:15:00Z",
	folderId: null,
	archivedAt: null,
};

class MockIntersectionObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
}

describe("LH-BUG-01: Keyboard navigation and workspace routing in Sidebar", () => {
	it("1. ChatFolderTree: workspace receives kbdSelected and renders data-testid='workspace-row-kbd' when kbdChatId matches", () => {
		// When kbdChatId matches sampleWorkspace.id:
		const html = renderToStaticMarkup(
			<ChatFolderTree
				folders={[]}
				items={[sampleChat, sampleWorkspace]}
				activeChatId={null}
				activeWorkspaceId={null}
				kbdChatId={sampleWorkspace.id}
				expandedFolderIds={new Set()}
				onToggleFolder={() => {}}
				onSelectChat={() => {}}
				onSelectWorkspace={() => {}}
			/>,
		);

		// The workspace row MUST receive kbdSelected and render with workspace-row-kbd
		assert.ok(
			html.includes('data-testid="workspace-row-kbd"'),
			"Workspace row should have data-testid='workspace-row-kbd' when kbdChatId matches its ID",
		);
		assert.ok(
			!html.includes('data-testid="session-row-kbd"'),
			"Chat row should not be keyboard-selected when workspace is selected",
		);

		// When kbdChatId matches sampleChat.id:
		const chatKbdHtml = renderToStaticMarkup(
			<ChatFolderTree
				folders={[]}
				items={[sampleChat, sampleWorkspace]}
				activeChatId={null}
				activeWorkspaceId={null}
				kbdChatId={sampleChat.id}
				expandedFolderIds={new Set()}
				onToggleFolder={() => {}}
				onSelectChat={() => {}}
				onSelectWorkspace={() => {}}
			/>,
		);

		assert.ok(
			chatKbdHtml.includes('data-testid="session-row-kbd"'),
			"Chat row should have data-testid='session-row-kbd' when kbdChatId matches its ID",
		);
		assert.ok(
			chatKbdHtml.includes('data-testid="workspace-row"'),
			"Workspace row should have standard data-testid='workspace-row' when not selected",
		);
	});

	it("2. Sidebar: ArrowDown navigates to workspace, triggers scrollIntoView on data-workspace-id, and Enter routes to /workspaces/[id]", async () => {
		const dom = parseHTML("<html><head></head><body><div id='root'></div></body></html>");
		const originalWindow = (globalThis as Record<string, unknown>).window;
		const originalSelf = (globalThis as Record<string, unknown>).self;
		const originalDocument = (globalThis as Record<string, unknown>).document;
		const originalHTMLElement = (globalThis as Record<string, unknown>).HTMLElement;
		const originalElement = (globalThis as Record<string, unknown>).Element;
		const originalNode = (globalThis as Record<string, unknown>).Node;
		const originalAct = (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT;
		const originalIO = (globalThis as Record<string, unknown>).IntersectionObserver;
		const originalRIC = (globalThis as Record<string, unknown>).requestIdleCallback;
		const originalCIC = (globalThis as Record<string, unknown>).cancelIdleCallback;

		const scrolledElements: Array<{ id: string; kind: "session" | "workspace"; block?: string }> = [];
		const proto = dom.window.HTMLElement.prototype;
		const originalScrollIntoView = proto.scrollIntoView;
		proto.scrollIntoView = function (opts?: any) {
			const sessionId = this.getAttribute("data-session-id");
			const workspaceId = this.getAttribute("data-workspace-id");
			if (sessionId) {
				scrolledElements.push({ id: sessionId, kind: "session", block: opts?.block });
			} else if (workspaceId) {
				scrolledElements.push({ id: workspaceId, kind: "workspace", block: opts?.block });
			}
		};

		let blurred = false;
		const originalBlur = proto.blur;
		proto.blur = function () {
			blurred = true;
			originalBlur?.call(this);
		};

		const pushedUrls: string[] = [];
		const mockRouter = {
			bfcacheId: "test",
			push: (url: string) => {
				pushedUrls.push(url);
			},
			replace: () => {},
			refresh: () => {},
			back: () => {},
			forward: () => {},
			prefetch: () => {},
		};

		Object.assign(globalThis, {
			window: dom.window,
			self: dom.window,
			document: dom.document,
			HTMLElement: dom.window.HTMLElement,
			Element: dom.window.Element,
			Node: dom.window.Node,
			IS_REACT_ACT_ENVIRONMENT: true,
			localStorage: { getItem: () => null, setItem() {} },
			IntersectionObserver: MockIntersectionObserver,
			requestIdleCallback: (cb: () => void) => setTimeout(cb, 0),
			cancelIdleCallback: (id: NodeJS.Timeout) => clearTimeout(id),
		});

		try {
			const root = createRoot(dom.document.getElementById("root")!);

			await act(async () => {
				root.render(
					<InteractionLayersProvider>
						<AppRouterContext.Provider value={mockRouter}>
							<PathnameContext.Provider value="/">
								<ServerEventsProvider connect={() => ({ close() {}, onOpen() {}, onEvent() {} })}>
									<SettingsDialogProvider>
										<SidebarProvider>
											<SessionsSidebar
												initialChats={[sampleChat, sampleWorkspace]}
												initialFolders={[]}
											/>
										</SidebarProvider>
									</SettingsDialogProvider>
								</ServerEventsProvider>
							</PathnameContext.Provider>
						</AppRouterContext.Provider>
					</InteractionLayersProvider>,
				);
			});

			const searchInput = dom.document.querySelector<HTMLInputElement>('input[placeholder="Search items…"]');
			assert.ok(searchInput, "Search items input should be rendered");

			// Step 1: Press ArrowDown to select first item (sampleChat)
			await act(async () => {
				const event = new dom.window.Event("keydown", { bubbles: true, cancelable: true });
				Object.assign(event, { key: "ArrowDown" });
				searchInput.dispatchEvent(event);
			});

			// Verify chat is scrolled into view
			assert.equal(scrolledElements.length, 1, "First ArrowDown should trigger scrollIntoView on first item");
			assert.equal(scrolledElements[0]?.id, sampleChat.id);
			assert.equal(scrolledElements[0]?.kind, "session");

			// Step 2: Press ArrowDown again to select second item (sampleWorkspace)
			await act(async () => {
				const event = new dom.window.Event("keydown", { bubbles: true, cancelable: true });
				Object.assign(event, { key: "ArrowDown" });
				searchInput.dispatchEvent(event);
			});

			// Verify workspace is scrolled into view via [data-workspace-id]
			assert.equal(scrolledElements.length, 2, "Second ArrowDown should trigger scrollIntoView on workspace item");
			assert.equal(scrolledElements[1]?.id, sampleWorkspace.id);
			assert.equal(scrolledElements[1]?.kind, "workspace");
			assert.equal(scrolledElements[1]?.block, "nearest");

			// Verify workspace row has kbdSelected visual testid
			const wsKbdRow = dom.document.querySelector('[data-testid="workspace-row-kbd"]');
			assert.ok(wsKbdRow, "Workspace row must have data-testid='workspace-row-kbd' when selected via keyboard");

			// Step 3: Press Enter while workspace is selected
			blurred = false;
			await act(async () => {
				const event = new dom.window.Event("keydown", { bubbles: true, cancelable: true });
				Object.assign(event, { key: "Enter" });
				searchInput.dispatchEvent(event);
			});

			// Verify workspace routing: MUST route to /workspaces/workspace-beta, NOT /chat/workspace-beta
			assert.equal(pushedUrls.length, 1, "Enter should invoke router.push once");
			assert.equal(
				pushedUrls[0],
				`/workspaces/${sampleWorkspace.id}`,
				"Enter on workspace must route to /workspaces/${id}",
			);
			assert.equal(blurred, true, "Search input should be blurred after Enter navigation");

			// Verify kbd selection is cleared after Enter
			const wsKbdRowAfter = dom.document.querySelector('[data-testid="workspace-row-kbd"]');
			assert.equal(wsKbdRowAfter, null, "Keyboard selection must be cleared after activation");

			await act(async () => {
				root.unmount();
			});
		} finally {
			proto.scrollIntoView = originalScrollIntoView;
			proto.blur = originalBlur;
			(globalThis as Record<string, unknown>).window = originalWindow;
			(globalThis as Record<string, unknown>).self = originalSelf;
			(globalThis as Record<string, unknown>).document = originalDocument;
			(globalThis as Record<string, unknown>).HTMLElement = originalHTMLElement;
			(globalThis as Record<string, unknown>).Element = originalElement;
			(globalThis as Record<string, unknown>).Node = originalNode;
			(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = originalAct;
			(globalThis as Record<string, unknown>).IntersectionObserver = originalIO;
			(globalThis as Record<string, unknown>).requestIdleCallback = originalRIC;
			(globalThis as Record<string, unknown>).cancelIdleCallback = originalCIC;
		}
	});

	it("3. Sidebar: Enter on a normal chat continues to route to /chat/[id]", async () => {
		const dom = parseHTML("<html><head></head><body><div id='root'></div></body></html>");
		const originalWindow = (globalThis as Record<string, unknown>).window;
		const originalSelf = (globalThis as Record<string, unknown>).self;
		const originalDocument = (globalThis as Record<string, unknown>).document;
		const originalHTMLElement = (globalThis as Record<string, unknown>).HTMLElement;
		const originalElement = (globalThis as Record<string, unknown>).Element;
		const originalNode = (globalThis as Record<string, unknown>).Node;
		const originalAct = (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT;
		const originalIO = (globalThis as Record<string, unknown>).IntersectionObserver;
		const originalRIC = (globalThis as Record<string, unknown>).requestIdleCallback;
		const originalCIC = (globalThis as Record<string, unknown>).cancelIdleCallback;

		const proto = dom.window.HTMLElement.prototype;
		const originalScrollIntoView = proto.scrollIntoView;
		proto.scrollIntoView = () => {};

		const pushedUrls: string[] = [];
		const mockRouter = {
			bfcacheId: "test",
			push: (url: string) => {
				pushedUrls.push(url);
			},
			replace: () => {},
			refresh: () => {},
			back: () => {},
			forward: () => {},
			prefetch: () => {},
		};

		Object.assign(globalThis, {
			window: dom.window,
			self: dom.window,
			document: dom.document,
			HTMLElement: dom.window.HTMLElement,
			Element: dom.window.Element,
			Node: dom.window.Node,
			IS_REACT_ACT_ENVIRONMENT: true,
			localStorage: { getItem: () => null, setItem() {} },
			IntersectionObserver: MockIntersectionObserver,
			requestIdleCallback: (cb: () => void) => setTimeout(cb, 0),
			cancelIdleCallback: (id: NodeJS.Timeout) => clearTimeout(id),
		});

		try {
			const root = createRoot(dom.document.getElementById("root")!);

			await act(async () => {
				root.render(
					<InteractionLayersProvider>
						<AppRouterContext.Provider value={mockRouter}>
							<PathnameContext.Provider value="/">
								<ServerEventsProvider connect={() => ({ close() {}, onOpen() {}, onEvent() {} })}>
									<SettingsDialogProvider>
										<SidebarProvider>
											<SessionsSidebar
												initialChats={[sampleChat, sampleWorkspace]}
												initialFolders={[]}
											/>
										</SidebarProvider>
									</SettingsDialogProvider>
								</ServerEventsProvider>
							</PathnameContext.Provider>
						</AppRouterContext.Provider>
					</InteractionLayersProvider>,
				);
			});

			const searchInput = dom.document.querySelector<HTMLInputElement>('input[placeholder="Search items…"]');
			assert.ok(searchInput, "Search items input should be rendered");

			// Press ArrowDown to select sampleChat
			await act(async () => {
				const event = new dom.window.Event("keydown", { bubbles: true, cancelable: true });
				Object.assign(event, { key: "ArrowDown" });
				searchInput.dispatchEvent(event);
			});

			// Verify chat has kbdSelected visual testid
			const chatKbdRow = dom.document.querySelector('[data-testid="session-row-kbd"]');
			assert.ok(chatKbdRow, "Chat row must have data-testid='session-row-kbd' when selected via keyboard");

			// Press Enter on chat
			await act(async () => {
				const event = new dom.window.Event("keydown", { bubbles: true, cancelable: true });
				Object.assign(event, { key: "Enter" });
				searchInput.dispatchEvent(event);
			});

			assert.equal(pushedUrls.length, 1, "Enter should invoke router.push once");
			assert.equal(
				pushedUrls[0],
				`/chat/${sampleChat.id}`,
				"Enter on chat must route to /chat/${id}",
			);

			await act(async () => {
				root.unmount();
			});
		} finally {
			proto.scrollIntoView = originalScrollIntoView;
			(globalThis as Record<string, unknown>).window = originalWindow;
			(globalThis as Record<string, unknown>).self = originalSelf;
			(globalThis as Record<string, unknown>).document = originalDocument;
			(globalThis as Record<string, unknown>).HTMLElement = originalHTMLElement;
			(globalThis as Record<string, unknown>).Element = originalElement;
			(globalThis as Record<string, unknown>).Node = originalNode;
			(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = originalAct;
			(globalThis as Record<string, unknown>).IntersectionObserver = originalIO;
			(globalThis as Record<string, unknown>).requestIdleCallback = originalRIC;
			(globalThis as Record<string, unknown>).cancelIdleCallback = originalCIC;
		}
	});

	it("4. Sidebar: ArrowUp from idle wraps around to last item (workspace) and activates it", async () => {
		const dom = parseHTML("<html><head></head><body><div id='root'></div></body></html>");
		const originalWindow = (globalThis as Record<string, unknown>).window;
		const originalSelf = (globalThis as Record<string, unknown>).self;
		const originalDocument = (globalThis as Record<string, unknown>).document;
		const originalHTMLElement = (globalThis as Record<string, unknown>).HTMLElement;
		const originalElement = (globalThis as Record<string, unknown>).Element;
		const originalNode = (globalThis as Record<string, unknown>).Node;
		const originalAct = (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT;
		const originalIO = (globalThis as Record<string, unknown>).IntersectionObserver;
		const originalRIC = (globalThis as Record<string, unknown>).requestIdleCallback;
		const originalCIC = (globalThis as Record<string, unknown>).cancelIdleCallback;

		const proto = dom.window.HTMLElement.prototype;
		const originalScrollIntoView = proto.scrollIntoView;
		let lastScrolledWorkspace: string | null = null;
		proto.scrollIntoView = function () {
			const wsId = this.getAttribute("data-workspace-id");
			if (wsId) lastScrolledWorkspace = wsId;
		};

		const pushedUrls: string[] = [];
		const mockRouter = {
			bfcacheId: "test",
			push: (url: string) => {
				pushedUrls.push(url);
			},
			replace: () => {},
			refresh: () => {},
			back: () => {},
			forward: () => {},
			prefetch: () => {},
		};

		Object.assign(globalThis, {
			window: dom.window,
			self: dom.window,
			document: dom.document,
			HTMLElement: dom.window.HTMLElement,
			Element: dom.window.Element,
			Node: dom.window.Node,
			IS_REACT_ACT_ENVIRONMENT: true,
			localStorage: { getItem: () => null, setItem() {} },
			IntersectionObserver: MockIntersectionObserver,
			requestIdleCallback: (cb: () => void) => setTimeout(cb, 0),
			cancelIdleCallback: (id: NodeJS.Timeout) => clearTimeout(id),
		});

		try {
			const root = createRoot(dom.document.getElementById("root")!);

			await act(async () => {
				root.render(
					<InteractionLayersProvider>
						<AppRouterContext.Provider value={mockRouter}>
							<PathnameContext.Provider value="/">
								<ServerEventsProvider connect={() => ({ close() {}, onOpen() {}, onEvent() {} })}>
									<SettingsDialogProvider>
										<SidebarProvider>
											<SessionsSidebar
												initialChats={[sampleChat, sampleWorkspace]}
												initialFolders={[]}
											/>
										</SidebarProvider>
									</SettingsDialogProvider>
								</ServerEventsProvider>
							</PathnameContext.Provider>
						</AppRouterContext.Provider>
					</InteractionLayersProvider>,
				);
			});

			const searchInput = dom.document.querySelector<HTMLInputElement>('input[placeholder="Search items…"]');
			assert.ok(searchInput, "Search items input should be rendered");

			// Press ArrowUp: when kbdIndex is null, dir is -1, so (n - 1) is selected (index 1 = sampleWorkspace)
			await act(async () => {
				const event = new dom.window.Event("keydown", { bubbles: true, cancelable: true });
				Object.assign(event, { key: "ArrowUp" });
				searchInput.dispatchEvent(event);
			});

			assert.equal(lastScrolledWorkspace, sampleWorkspace.id, "ArrowUp should scroll the last item (workspace) into view");
			const wsKbdRow = dom.document.querySelector('[data-testid="workspace-row-kbd"]');
			assert.ok(wsKbdRow, "Workspace row must have data-testid='workspace-row-kbd' via ArrowUp");

			// Press Enter
			await act(async () => {
				const event = new dom.window.Event("keydown", { bubbles: true, cancelable: true });
				Object.assign(event, { key: "Enter" });
				searchInput.dispatchEvent(event);
			});

			assert.equal(pushedUrls.length, 1);
			assert.equal(pushedUrls[0], `/workspaces/${sampleWorkspace.id}`);

			await act(async () => {
				root.unmount();
			});
		} finally {
			proto.scrollIntoView = originalScrollIntoView;
			(globalThis as Record<string, unknown>).window = originalWindow;
			(globalThis as Record<string, unknown>).self = originalSelf;
			(globalThis as Record<string, unknown>).document = originalDocument;
			(globalThis as Record<string, unknown>).HTMLElement = originalHTMLElement;
			(globalThis as Record<string, unknown>).Element = originalElement;
			(globalThis as Record<string, unknown>).Node = originalNode;
			(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = originalAct;
			(globalThis as Record<string, unknown>).IntersectionObserver = originalIO;
			(globalThis as Record<string, unknown>).requestIdleCallback = originalRIC;
			(globalThis as Record<string, unknown>).cancelIdleCallback = originalCIC;
		}
	});

	it("5. Sidebar: Direct Enter without arrow keys selects first shown item and routes workspace to /workspaces/[id]", async () => {
		const dom = parseHTML("<html><head></head><body><div id='root'></div></body></html>");
		const originalWindow = (globalThis as Record<string, unknown>).window;
		const originalSelf = (globalThis as Record<string, unknown>).self;
		const originalDocument = (globalThis as Record<string, unknown>).document;
		const originalHTMLElement = (globalThis as Record<string, unknown>).HTMLElement;
		const originalElement = (globalThis as Record<string, unknown>).Element;
		const originalNode = (globalThis as Record<string, unknown>).Node;
		const originalAct = (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT;
		const originalIO = (globalThis as Record<string, unknown>).IntersectionObserver;
		const originalRIC = (globalThis as Record<string, unknown>).requestIdleCallback;
		const originalCIC = (globalThis as Record<string, unknown>).cancelIdleCallback;

		const proto = dom.window.HTMLElement.prototype;
		const originalScrollIntoView = proto.scrollIntoView;
		proto.scrollIntoView = () => {};

		const pushedUrls: string[] = [];
		const mockRouter = {
			bfcacheId: "test",
			push: (url: string) => {
				pushedUrls.push(url);
			},
			replace: () => {},
			refresh: () => {},
			back: () => {},
			forward: () => {},
			prefetch: () => {},
		};

		Object.assign(globalThis, {
			window: dom.window,
			self: dom.window,
			document: dom.document,
			HTMLElement: dom.window.HTMLElement,
			Element: dom.window.Element,
			Node: dom.window.Node,
			IS_REACT_ACT_ENVIRONMENT: true,
			localStorage: { getItem: () => null, setItem() {} },
			IntersectionObserver: MockIntersectionObserver,
			requestIdleCallback: (cb: () => void) => setTimeout(cb, 0),
			cancelIdleCallback: (id: NodeJS.Timeout) => clearTimeout(id),
		});

		try {
			const root = createRoot(dom.document.getElementById("root")!);

			await act(async () => {
				root.render(
					<InteractionLayersProvider>
						<AppRouterContext.Provider value={mockRouter}>
							<PathnameContext.Provider value="/">
								<ServerEventsProvider connect={() => ({ close() {}, onOpen() {}, onEvent() {} })}>
									<SettingsDialogProvider>
										<SidebarProvider>
											{/* sampleWorkspace leads at index 0 */}
											<SessionsSidebar
												initialChats={[sampleWorkspace, sampleChat]}
												initialFolders={[]}
											/>
										</SidebarProvider>
									</SettingsDialogProvider>
								</ServerEventsProvider>
							</PathnameContext.Provider>
						</AppRouterContext.Provider>
					</InteractionLayersProvider>,
				);
			});

			const searchInput = dom.document.querySelector<HTMLInputElement>('input[placeholder="Search items…"]');
			assert.ok(searchInput, "Search items input should be rendered");

			// Press Enter directly without any arrow keys (kbdIndex is null -> falls back to index 0)
			await act(async () => {
				const event = new dom.window.Event("keydown", { bubbles: true, cancelable: true });
				Object.assign(event, { key: "Enter" });
				searchInput.dispatchEvent(event);
			});

			assert.equal(pushedUrls.length, 1);
			assert.equal(
				pushedUrls[0],
				`/workspaces/${sampleWorkspace.id}`,
				"Enter without arrow navigation must route top workspace item to /workspaces/[id]",
			);

			await act(async () => {
				root.unmount();
			});
		} finally {
			proto.scrollIntoView = originalScrollIntoView;
			(globalThis as Record<string, unknown>).window = originalWindow;
			(globalThis as Record<string, unknown>).self = originalSelf;
			(globalThis as Record<string, unknown>).document = originalDocument;
			(globalThis as Record<string, unknown>).HTMLElement = originalHTMLElement;
			(globalThis as Record<string, unknown>).Element = originalElement;
			(globalThis as Record<string, unknown>).Node = originalNode;
			(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = originalAct;
			(globalThis as Record<string, unknown>).IntersectionObserver = originalIO;
			(globalThis as Record<string, unknown>).requestIdleCallback = originalRIC;
			(globalThis as Record<string, unknown>).cancelIdleCallback = originalCIC;
		}
	});
});

describe("Sidebar Directory Terminology and Search/Filter Consistency", () => {
	it("verifies 'Items' header, placeholder 'Search items…', and accessibility via aria-label='Search items'", async () => {
		const dom = parseHTML("<html><head></head><body><div id='root'></div></body></html>");
		const originalWindow = globalThis.window;
		const originalSelf = globalThis.self;
		const originalDocument = globalThis.document;
		const originalHTMLElement = globalThis.HTMLElement;
		const originalElement = globalThis.Element;
		const originalNode = globalThis.Node;
		const originalAct = (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT;
		const originalIO = (globalThis as Record<string, unknown>).IntersectionObserver;
		const originalRIC = (globalThis as Record<string, unknown>).requestIdleCallback;
		const originalCIC = (globalThis as Record<string, unknown>).cancelIdleCallback;

		const mockRouter = {
			bfcacheId: "test",
			push: () => {},
			replace: () => {},
			refresh: () => {},
			back: () => {},
			forward: () => {},
			prefetch: () => {},
		};

		Object.assign(globalThis, {
			window: dom.window,
			self: dom.window,
			document: dom.document,
			HTMLElement: dom.window.HTMLElement,
			Element: dom.window.Element,
			Node: dom.window.Node,
			IS_REACT_ACT_ENVIRONMENT: true,
			localStorage: { getItem: () => null, setItem() {} },
			IntersectionObserver: MockIntersectionObserver,
			requestIdleCallback: (cb: () => void) => setTimeout(cb, 0),
			cancelIdleCallback: (id: NodeJS.Timeout) => clearTimeout(id),
		});

		try {
			const root = createRoot(dom.document.getElementById("root")!);

			await act(async () => {
				root.render(
					<InteractionLayersProvider>
						<AppRouterContext.Provider value={mockRouter}>
							<PathnameContext.Provider value="/">
								<ServerEventsProvider connect={() => ({ close() {}, onOpen() {}, onEvent() {} })}>
									<SettingsDialogProvider>
										<SidebarProvider>
											<SessionsSidebar
												initialChats={[sampleChat, sampleWorkspace]}
												initialFolders={[]}
											/>
										</SidebarProvider>
									</SettingsDialogProvider>
								</ServerEventsProvider>
							</PathnameContext.Provider>
						</AppRouterContext.Provider>
					</InteractionLayersProvider>,
				);
			});

			// 1. Verify "Items" header
			const headerSpan = Array.from(dom.document.querySelectorAll("span")).find(
				(el) => el.textContent?.trim() === "Items",
			);
			assert.ok(headerSpan, "Visible header must display 'Items'");

			// 2. Verify placeholder "Search items…"
			const searchInput = dom.document.querySelector<HTMLInputElement>('input[data-testid="session-search"]');
			assert.ok(searchInput, "Search input must exist");
			assert.equal(searchInput.getAttribute("placeholder"), "Search items…", "Placeholder must be 'Search items…'");

			// 3. Verify accessibility via aria-label="Search items"
			assert.equal(searchInput.getAttribute("aria-label"), "Search items", "aria-label must be 'Search items'");

			await act(async () => {
				root.unmount();
			});
		} finally {
			(globalThis as Record<string, unknown>).window = originalWindow;
			(globalThis as Record<string, unknown>).self = originalSelf;
			(globalThis as Record<string, unknown>).document = originalDocument;
			(globalThis as Record<string, unknown>).HTMLElement = originalHTMLElement;
			(globalThis as Record<string, unknown>).Element = originalElement;
			(globalThis as Record<string, unknown>).Node = originalNode;
			(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = originalAct;
			(globalThis as Record<string, unknown>).IntersectionObserver = originalIO;
			(globalThis as Record<string, unknown>).requestIdleCallback = originalRIC;
			(globalThis as Record<string, unknown>).cancelIdleCallback = originalCIC;
		}
	});

	it("search functions properly for both chats and workspaces", async () => {
		const dom = parseHTML("<html><head></head><body><div id='root'></div></body></html>");
		const originalWindow = globalThis.window;
		const originalSelf = globalThis.self;
		const originalDocument = globalThis.document;
		const originalHTMLElement = globalThis.HTMLElement;
		const originalElement = globalThis.Element;
		const originalNode = globalThis.Node;
		const originalAct = (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT;
		const originalIO = (globalThis as Record<string, unknown>).IntersectionObserver;
		const originalRIC = (globalThis as Record<string, unknown>).requestIdleCallback;
		const originalCIC = (globalThis as Record<string, unknown>).cancelIdleCallback;

		const mockRouter = {
			bfcacheId: "test",
			push: () => {},
			replace: () => {},
			refresh: () => {},
			back: () => {},
			forward: () => {},
			prefetch: () => {},
		};

		Object.assign(globalThis, {
			window: dom.window,
			self: dom.window,
			document: dom.document,
			HTMLElement: dom.window.HTMLElement,
			Element: dom.window.Element,
			Node: dom.window.Node,
			IS_REACT_ACT_ENVIRONMENT: true,
			localStorage: { getItem: () => null, setItem() {} },
			IntersectionObserver: MockIntersectionObserver,
			requestIdleCallback: (cb: () => void) => setTimeout(cb, 0),
			cancelIdleCallback: (id: NodeJS.Timeout) => clearTimeout(id),
		});

		try {
			const root = createRoot(dom.document.getElementById("root")!);

			await act(async () => {
				root.render(
					<InteractionLayersProvider>
						<AppRouterContext.Provider value={mockRouter}>
							<PathnameContext.Provider value="/">
								<ServerEventsProvider connect={() => ({ close() {}, onOpen() {}, onEvent() {} })}>
									<SettingsDialogProvider>
										<SidebarProvider>
											<SessionsSidebar
												initialChats={[sampleChat, sampleWorkspace]}
												initialFolders={[]}
											/>
										</SidebarProvider>
									</SettingsDialogProvider>
								</ServerEventsProvider>
							</PathnameContext.Provider>
						</AppRouterContext.Provider>
					</InteractionLayersProvider>,
				);
			});

			const searchInput = dom.document.querySelector<HTMLInputElement>('input[data-testid="session-search"]')!;
			assert.ok(searchInput);

			// Initially both chat and workspace are shown
			assert.ok(dom.document.querySelector(`[data-session-id="${sampleChat.id}"]`), "Chat must be visible initially");
			assert.ok(dom.document.querySelector(`[data-workspace-id="${sampleWorkspace.id}"]`), "Workspace must be visible initially");

			const changeInput = (val: string) => {
				const fiberKey = Object.keys(searchInput).find((k) => k.startsWith("__reactProps"));
				if (fiberKey && (searchInput as any)[fiberKey]?.onChange) {
					(searchInput as any)[fiberKey].onChange({ target: { value: val } });
				} else {
					Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(searchInput, val);
					searchInput.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
					searchInput.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
				}
			};

			// Search for chat specifically ("Networks")
			await act(async () => {
				changeInput("Networks");
			});

			assert.ok(dom.document.querySelector(`[data-session-id="${sampleChat.id}"]`), "Chat must be matched by query 'Networks'");
			assert.ok(!dom.document.querySelector(`[data-workspace-id="${sampleWorkspace.id}"]`), "Workspace must not match 'Networks'");

			// Search for workspace specifically ("Packet")
			await act(async () => {
				changeInput("Packet");
			});

			assert.ok(dom.document.querySelector(`[data-workspace-id="${sampleWorkspace.id}"]`), "Workspace must be matched by query 'Packet'");
			assert.ok(!dom.document.querySelector(`[data-session-id="${sampleChat.id}"]`), "Chat must not match 'Packet'");

			// Clear query
			await act(async () => {
				changeInput("");
			});

			assert.ok(dom.document.querySelector(`[data-session-id="${sampleChat.id}"]`), "Chat must be restored when query cleared");
			assert.ok(dom.document.querySelector(`[data-workspace-id="${sampleWorkspace.id}"]`), "Workspace must be restored when query cleared");

			await act(async () => {
				root.unmount();
			});
		} finally {
			(globalThis as Record<string, unknown>).window = originalWindow;
			(globalThis as Record<string, unknown>).self = originalSelf;
			(globalThis as Record<string, unknown>).document = originalDocument;
			(globalThis as Record<string, unknown>).HTMLElement = originalHTMLElement;
			(globalThis as Record<string, unknown>).Element = originalElement;
			(globalThis as Record<string, unknown>).Node = originalNode;
			(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = originalAct;
			(globalThis as Record<string, unknown>).IntersectionObserver = originalIO;
			(globalThis as Record<string, unknown>).requestIdleCallback = originalRIC;
			(globalThis as Record<string, unknown>).cancelIdleCallback = originalCIC;
		}
	});

	it("maintains Teaching/Practice filter behavior without regression", async () => {
		const dom = parseHTML("<html><head></head><body><div id='root'></div></body></html>");
		const originalWindow = globalThis.window;
		const originalSelf = globalThis.self;
		const originalDocument = globalThis.document;
		const originalHTMLElement = globalThis.HTMLElement;
		const originalElement = globalThis.Element;
		const originalNode = globalThis.Node;
		const originalAct = (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT;
		const originalIO = (globalThis as Record<string, unknown>).IntersectionObserver;
		const originalRIC = (globalThis as Record<string, unknown>).requestIdleCallback;
		const originalCIC = (globalThis as Record<string, unknown>).cancelIdleCallback;

		const mockRouter = {
			bfcacheId: "test",
			push: () => {},
			replace: () => {},
			refresh: () => {},
			back: () => {},
			forward: () => {},
			prefetch: () => {},
		};

		const localStore = new Map<string, string>();
		Object.assign(globalThis, {
			window: dom.window,
			self: dom.window,
			document: dom.document,
			HTMLElement: dom.window.HTMLElement,
			Element: dom.window.Element,
			Node: dom.window.Node,
			IS_REACT_ACT_ENVIRONMENT: true,
			localStorage: {
				getItem: (key: string) => localStore.get(key) ?? null,
				setItem: (key: string, val: string) => localStore.set(key, val),
			},
			IntersectionObserver: MockIntersectionObserver,
			requestIdleCallback: (cb: () => void) => setTimeout(cb, 0),
			cancelIdleCallback: (id: NodeJS.Timeout) => clearTimeout(id),
		});

		try {
			const root = createRoot(dom.document.getElementById("root")!);

			await act(async () => {
				root.render(
					<InteractionLayersProvider>
						<AppRouterContext.Provider value={mockRouter}>
							<PathnameContext.Provider value="/">
								<ServerEventsProvider connect={() => ({ close() {}, onOpen() {}, onEvent() {} })}>
									<SettingsDialogProvider>
										<SidebarProvider>
											<SessionsSidebar
												initialChats={[sampleChat, samplePracticeChat, sampleWorkspace]}
												initialFolders={[]}
											/>
										</SidebarProvider>
									</SettingsDialogProvider>
								</ServerEventsProvider>
							</PathnameContext.Provider>
						</AppRouterContext.Provider>
					</InteractionLayersProvider>,
				);
			});

			const teachBtn = dom.document.querySelector<HTMLButtonElement>('[data-testid="kind-filter-teach"]')!;
			const practiceBtn = dom.document.querySelector<HTMLButtonElement>('[data-testid="kind-filter-practice"]')!;
			const allBtn = dom.document.querySelector<HTMLButtonElement>('[data-testid="kind-filter-all"]')!;

			assert.ok(teachBtn);
			assert.ok(practiceBtn);
			assert.ok(allBtn);

			// All filter active: all 3 items present
			assert.ok(dom.document.querySelector(`[data-session-id="${sampleChat.id}"]`), "Teaching chat present in 'all'");
			assert.ok(dom.document.querySelector(`[data-session-id="${samplePracticeChat.id}"]`), "Practice chat present in 'all'");
			assert.ok(dom.document.querySelector(`[data-workspace-id="${sampleWorkspace.id}"]`), "Workspace present in 'all'");

			// Filter Teaching
			await act(async () => {
				teachBtn.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
			});

			assert.ok(dom.document.querySelector(`[data-session-id="${sampleChat.id}"]`), "Teaching chat present when filtered by teach");
			assert.ok(!dom.document.querySelector(`[data-session-id="${samplePracticeChat.id}"]`), "Practice chat excluded when filtered by teach");
			assert.ok(dom.document.querySelector(`[data-workspace-id="${sampleWorkspace.id}"]`), "Workspace remains present when filtered by teach");

			// Filter Practice
			await act(async () => {
				practiceBtn.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
			});

			assert.ok(!dom.document.querySelector(`[data-session-id="${sampleChat.id}"]`), "Teaching chat excluded when filtered by practice");
			assert.ok(dom.document.querySelector(`[data-session-id="${samplePracticeChat.id}"]`), "Practice chat present when filtered by practice");
			assert.ok(dom.document.querySelector(`[data-workspace-id="${sampleWorkspace.id}"]`), "Workspace remains present when filtered by practice");

			// Filter All again
			await act(async () => {
				allBtn.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
			});

			assert.ok(dom.document.querySelector(`[data-session-id="${sampleChat.id}"]`), "Teaching chat restored in 'all'");
			assert.ok(dom.document.querySelector(`[data-session-id="${samplePracticeChat.id}"]`), "Practice chat restored in 'all'");
			assert.ok(dom.document.querySelector(`[data-workspace-id="${sampleWorkspace.id}"]`), "Workspace restored in 'all'");

			await act(async () => {
				root.unmount();
			});
		} finally {
			(globalThis as Record<string, unknown>).window = originalWindow;
			(globalThis as Record<string, unknown>).self = originalSelf;
			(globalThis as Record<string, unknown>).document = originalDocument;
			(globalThis as Record<string, unknown>).HTMLElement = originalHTMLElement;
			(globalThis as Record<string, unknown>).Element = originalElement;
			(globalThis as Record<string, unknown>).Node = originalNode;
			(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = originalAct;
			(globalThis as Record<string, unknown>).IntersectionObserver = originalIO;
			(globalThis as Record<string, unknown>).requestIdleCallback = originalRIC;
			(globalThis as Record<string, unknown>).cancelIdleCallback = originalCIC;
		}
	});
});

describe("LH-WS-04: Workspace and Chat Rename Event Synchronization", () => {
	it("Sidebar: updates workspace title optimistically when lh:workspace-renamed is dispatched and preserves chat rename", async () => {
		const dom = parseHTML("<html><head></head><body><div id='root'></div></body></html>");
		const originalWindow = globalThis.window;
		const originalSelf = globalThis.self;
		const originalDocument = globalThis.document;
		const originalHTMLElement = globalThis.HTMLElement;
		const originalElement = globalThis.Element;
		const originalNode = globalThis.Node;
		const originalAct = (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT;
		const originalIO = (globalThis as Record<string, unknown>).IntersectionObserver;
		const originalRIC = (globalThis as Record<string, unknown>).requestIdleCallback;
		const originalCIC = (globalThis as Record<string, unknown>).cancelIdleCallback;

		const mockRouter = {
			bfcacheId: "test",
			push: () => {},
			replace: () => {},
			refresh: () => {},
			back: () => {},
			forward: () => {},
			prefetch: () => {},
		};

		Object.assign(globalThis, {
			window: dom.window,
			self: dom.window,
			document: dom.document,
			HTMLElement: dom.window.HTMLElement,
			Element: dom.window.Element,
			Node: dom.window.Node,
			IS_REACT_ACT_ENVIRONMENT: true,
			localStorage: { getItem: () => null, setItem() {} },
			IntersectionObserver: MockIntersectionObserver,
			requestIdleCallback: (cb: () => void) => setTimeout(cb, 0),
			cancelIdleCallback: (id: NodeJS.Timeout) => clearTimeout(id),
		});

		try {
			const root = createRoot(dom.document.getElementById("root")!);

			await act(async () => {
				root.render(
					<InteractionLayersProvider>
						<AppRouterContext.Provider value={mockRouter}>
							<PathnameContext.Provider value="/">
								<ServerEventsProvider connect={() => ({ close() {}, onOpen() {}, onEvent() {} })}>
									<SettingsDialogProvider>
										<SidebarProvider>
											<SessionsSidebar
												initialChats={[sampleChat, sampleWorkspace]}
												initialFolders={[]}
											/>
										</SidebarProvider>
									</SettingsDialogProvider>
								</ServerEventsProvider>
							</PathnameContext.Provider>
						</AppRouterContext.Provider>
					</InteractionLayersProvider>,
				);
			});

			// Verify initial titles
			const wsRow = dom.document.querySelector(`[data-workspace-id="${sampleWorkspace.id}"]`);
			assert.ok(wsRow, "Workspace row exists");
			assert.ok(wsRow.textContent?.includes("TCP/IP Packet Simulator"), "Initial workspace title rendered");

			// 1. Dispatch lh:workspace-renamed event
			await act(async () => {
				dom.window.dispatchEvent(
					new dom.window.CustomEvent("lh:workspace-renamed", {
						detail: { id: sampleWorkspace.id, title: "Updated Packet Simulator v2" },
					}),
				);
			});

			// Verify updated workspace title in sidebar
			assert.ok(wsRow.textContent?.includes("Updated Packet Simulator v2"), "Workspace title updated via lh:workspace-renamed");

			// 2. Dispatch lh:chat-renamed event on chat
			const chatRow = dom.document.querySelector(`[data-session-id="${sampleChat.id}"]`);
			assert.ok(chatRow, "Chat row exists");
			assert.ok(chatRow.textContent?.includes("Computer Networks Lecture"), "Initial chat title rendered");

			await act(async () => {
				dom.window.dispatchEvent(
					new dom.window.CustomEvent("lh:chat-renamed", {
						detail: { id: sampleChat.id, title: "Advanced Networks Lecture" },
					}),
				);
			});

			assert.ok(chatRow.textContent?.includes("Advanced Networks Lecture"), "Chat title updated via lh:chat-renamed");

			// 3. Backward compatibility: lh:chat-renamed targeting a workspace also updates the title
			await act(async () => {
				dom.window.dispatchEvent(
					new dom.window.CustomEvent("lh:chat-renamed", {
						detail: { id: sampleWorkspace.id, title: "Compat Packet Simulator v3" },
					}),
				);
			});
			assert.ok(wsRow.textContent?.includes("Compat Packet Simulator v3"), "Workspace title updated via backwards compatible lh:chat-renamed");

			await act(async () => {
				root.unmount();
			});
		} finally {
			(globalThis as Record<string, unknown>).window = originalWindow;
			(globalThis as Record<string, unknown>).self = originalSelf;
			(globalThis as Record<string, unknown>).document = originalDocument;
			(globalThis as Record<string, unknown>).HTMLElement = originalHTMLElement;
			(globalThis as Record<string, unknown>).Element = originalElement;
			(globalThis as Record<string, unknown>).Node = originalNode;
			(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = originalAct;
			(globalThis as Record<string, unknown>).IntersectionObserver = originalIO;
			(globalThis as Record<string, unknown>).requestIdleCallback = originalRIC;
			(globalThis as Record<string, unknown>).cancelIdleCallback = originalCIC;
		}
	});
});

describe("WorkspaceRow and RenameWorkspaceRow trailing icon layout", () => {
	it("renders workspace title at leading edge and BoxIcon in trailing metadata group before timestamp", () => {
		const html = renderToStaticMarkup(
			<WorkspaceRow
				workspace={sampleWorkspace}
				active={false}
				onOpen={() => {}}
			/>,
		);

		const { document } = parseHTML(html);
		const button = document.querySelector("button");
		assert.ok(button);

		// Title is the first item inside the row's inner flex container (leading edge)
		const innerFlex = button.querySelector(".h-5.items-center.justify-between");
		assert.ok(innerFlex, "Inner row flex container exists");

		const firstChild = innerFlex.firstElementChild;
		assert.ok(firstChild);
		assert.ok(firstChild.textContent?.includes("TCP/IP Packet Simulator"), "Workspace title must be at the leading edge");
		assert.equal(firstChild.querySelector("svg"), null, "Leading title must not contain BoxIcon");

		// Trailing metadata group contains BoxIcon and timestamp
		const trailingMeta = innerFlex.querySelector(".ml-auto");
		assert.ok(trailingMeta, "Trailing metadata container exists");

		const boxIcon = trailingMeta.querySelector("svg.lucide-box");
		assert.ok(boxIcon, "BoxIcon must be inside trailing metadata group");

		const timeSpan = trailingMeta.querySelector(".tabular-nums");
		assert.ok(timeSpan, "Timestamp exists in trailing metadata");

		// BoxIcon must appear immediately before timestamp in trailing metadata
		assert.equal(boxIcon.nextElementSibling, timeSpan, "BoxIcon must be immediately before the updated timestamp");
	});

	it("renders unavailable workspace with warning before BoxIcon in trailing metadata", () => {
		const unavailableWorkspace: WorkspaceDirectoryEntry = {
			...sampleWorkspace,
			availability: "plugin-disabled",
		};

		const html = renderToStaticMarkup(
			<WorkspaceRow
				workspace={unavailableWorkspace}
				active={false}
				onOpen={() => {}}
			/>,
		);

		const { document } = parseHTML(html);
		const trailingMeta = document.querySelector(".ml-auto");
		assert.ok(trailingMeta);

		const boxIcon = trailingMeta.querySelector("svg.lucide-box");
		assert.ok(boxIcon);

		const alertIcon = trailingMeta.querySelector("svg.lucide-triangle-alert, svg.lucide-alert-triangle");
		assert.ok(alertIcon, "Alert triangle warning must be in trailing metadata");
		assert.ok(trailingMeta.textContent?.includes("Unavailable: plugin-disabled"));
	});

	it("RenameWorkspaceRow: renders input at leading edge without leading BoxIcon and places BoxIcon before timestamp in trailing metadata", () => {
		const html = renderToStaticMarkup(
			<RenameWorkspaceRow
				workspace={{
					id: sampleWorkspace.id,
					title: sampleWorkspace.title,
					updatedAt: sampleWorkspace.updatedAt,
				}}
				onCommit={() => {}}
				onCancel={() => {}}
			/>,
		);

		const { document } = parseHTML(html);
		const renameRow = document.querySelector('[data-testid="workspace-rename-row"]');
		assert.ok(renameRow);

		const innerFlex = renameRow.querySelector(".h-5.items-center.justify-between");
		assert.ok(innerFlex);

		// First child is input, with no leading icon
		const firstChild = innerFlex.firstElementChild;
		assert.ok(firstChild);
		assert.equal(firstChild.tagName.toLowerCase(), "input", "Input must be at the leading edge");
		assert.equal(firstChild.getAttribute("data-testid"), "workspace-rename-input");

		// Trailing meta has BoxIcon immediately before timestamp
		const trailingMeta = innerFlex.querySelector(".ml-auto");
		assert.ok(trailingMeta);

		const boxIcon = trailingMeta.querySelector("svg.lucide-box");
		assert.ok(boxIcon, "BoxIcon must be in trailing metadata of rename row");

		const timeSpan = trailingMeta.querySelector(".tabular-nums");
		assert.ok(timeSpan);
		assert.equal(boxIcon.nextElementSibling, timeSpan, "BoxIcon must immediately precede timestamp in rename row");
	});
});
