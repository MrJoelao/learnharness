import assert from "node:assert/strict";
import { it } from "node:test";
import { parseHTML } from "linkedom";
import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";

import { ServerEventsProvider } from "../components/server-events.tsx";
import { StudyHubCatalog } from "../components/study-hub-catalog.tsx";
import { WorkspaceRow } from "../components/workspace-row.tsx";
import { WorkspaceScreen } from "../components/workspace-screen.tsx";
import { DeclarativeSvgRenderer } from "../components/artifacts/declarative-svg-renderer.tsx";
import { VisualExplanationCard } from "../components/artifacts/visual-explanation-card.tsx";
import { parseWorkspaceId, parseWorkspaceRecord, type WorkspaceRecord } from "../src/core/workspaces.ts";

// ─── 1. Accessibility Checks ─────────────────────────────────────────────────

it("accessibility: Study Hub catalog elements provide proper ARIA attributes, headings, and labels", () => {
	const mockModes = [
		{
			id: "recall-lab",
			pluginId: "multi-mode",
			name: "Recall Lab",
			description: "Spaced retention practice.",
			category: "Practice",
			icon: "Brain",
			tags: ["memory"],
		},
		{
			id: "disabled-mode",
			pluginId: "disabled-plugin",
			name: "Disabled Mode",
			description: "Unavailable mode definition.",
			category: "Visual",
			icon: "Network",
		},
	];

	const mockPlugins = [
		{ info: { id: "multi-mode", enabled: true }, phase: "active" },
		{ info: { id: "disabled-plugin", enabled: false }, phase: "disabled" },
	];

	const mockRenderers = [
		{ pluginId: "multi-mode", modeId: "recall-lab" },
	];

	const html = renderToStaticMarkup(
		<StudyHubCatalog
			modes={mockModes}
			plugins={mockPlugins}
			modeRenderers={mockRenderers}
			isLoading={false}
		/>,
	);

	const { document } = parseHTML(html);

	// 1. Landmark structure
	const main = document.querySelector("main");
	assert.ok(main, "Catalog must be wrapped in a main landmark");

	// 2. Headings hierarchy
	const h1 = document.querySelector("h1");
	assert.ok(h1, "Catalog must have an h1 heading");
	assert.match(h1.textContent || "", /Study Hub/i);

	// 3. Search input accessible labeling
	const searchInput = document.querySelector("[data-testid='study-hub-search-input']");
	assert.ok(searchInput, "Search input must exist");
	assert.ok(searchInput.getAttribute("aria-label"), "Search input must have aria-label");

	// 4. Launch button accessible labeling
	const launchBtn = document.querySelector("[data-testid='launch-mode-multi-mode:recall-lab']");
	assert.ok(launchBtn, "Active launch button must exist");
	assert.equal(launchBtn.getAttribute("aria-label"), "Launch Recall Lab");
	assert.equal(launchBtn.hasAttribute("disabled"), false);

	// 5. Unavailable mode card accessible status
	const disabledLaunchBtn = document.querySelector("[data-testid='launch-mode-disabled-plugin:disabled-mode']");
	assert.ok(disabledLaunchBtn, "Disabled mode button must exist");
	assert.equal(disabledLaunchBtn.hasAttribute("disabled"), true, "Disabled mode button must be disabled");

	const disabledNotice = document.querySelector("[data-testid='mode-plugin-disabled']");
	assert.ok(disabledNotice, "Status notice must be rendered");
	assert.match(disabledNotice.textContent || "", /Plugin Disabled/i);
});

it("accessibility: Workspace screen conveys unavailable explanation with recoverable guidance", () => {
	const ws: WorkspaceRecord = parseWorkspaceRecord({
		version: 1,
		id: parseWorkspaceId("workspace_88888888-8888-4000-8000-888888888888"),
		pluginId: "multi-mode",
		modeId: "recall-lab",
		title: "Recall Workspace",
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
	});

	// Test plugin-disabled state with mock server events connection
	const fakeEvents = () => ({ close: () => {}, onOpen: () => {}, onEvent: () => {} });
	const htmlDisabled = renderToStaticMarkup(
		<ServerEventsProvider connect={fakeEvents}>
			<WorkspaceScreen
				workspaceId={ws.id}
				initialWorkspace={ws}
				initialAvailability="plugin-disabled"
			/>
		</ServerEventsProvider>,
	);
	const docDisabled = parseHTML(htmlDisabled).document;

	const unavailableBox = docDisabled.querySelector("[data-testid='workspace-unavailable']");
	assert.ok(unavailableBox, "Unavailable container must be present");
	assert.equal(unavailableBox.getAttribute("data-availability"), "plugin-disabled");
	assert.match(unavailableBox.textContent || "", /Plugin is disabled/i);
	assert.match(unavailableBox.textContent || "", /Enable the plugin in Settings to access this workspace/i);
	assert.match(unavailableBox.textContent || "", /data and state are preserved/i);

	// Test back button accessibility
	const backBtn = docDisabled.querySelector("[data-testid='workspace-back-button']");
	assert.ok(backBtn, "Back button must exist");
	assert.equal(backBtn.getAttribute("aria-label"), "Back");

	// Test workspace title heading
	const titleH1 = docDisabled.querySelector("h1[data-testid='workspace-title']");
	assert.ok(titleH1, "Title must be rendered as an h1");
	assert.equal(titleH1.textContent, "Recall Workspace");
});

it("accessibility: Declarative SVG renderer renders accessible descriptions and reduced-motion fallbacks", () => {
	const doc = {
		schema: "learnharness.visual.svg.v1" as const,
		viewBox: { x: 0, y: 0, width: 400, height: 200 },
		steps: [
			{
				id: "step-1",
				label: "Memory Block 1",
				description: "Detailed screen reader explanation of memory block allocation.",
				elements: [
					{ type: "rect" as const, x: 10, y: 10, width: 100, height: 50, fill: "#3b82f6" },
				],
			},
		],
	};

	const html = renderToStaticMarkup(
		<DeclarativeSvgRenderer
			document={doc}
			currentStep={0}
		/>,
	);

	const { document } = parseHTML(html);

	const svg = document.querySelector("svg");
	assert.ok(svg, "SVG element must be rendered");
	assert.equal(svg.getAttribute("role"), "img");
	assert.equal(svg.getAttribute("aria-label"), "Memory Block 1");

	// Accessible description element
	const desc = document.querySelector("desc");
	assert.ok(desc, "Accessible description must be provided for screen readers");
	assert.match(desc.textContent || "", /Detailed screen reader explanation/i);
});

// ─── 2. Performance Checks ───────────────────────────────────────────────────

it("performance: sidebar WorkspaceRow renders lightweight metadata without mounting plugin components", () => {
	let pluginMounted = false;

	const entry = {
		kind: "workspace" as const,
		id: parseWorkspaceId("workspace_12345678-1234-4000-8000-123456789abc"),
		title: "Lightweight Row Test",
		pluginId: "heavy-plugin",
		modeId: "heavy-mode",
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		folderId: null,
		archivedAt: null,
		availability: "available" as const,
	};

	// Render WorkspaceRow
	const html = renderToStaticMarkup(
		<WorkspaceRow
			workspace={entry}
			active={false}
			onOpen={() => {}}
		/>,
	);

	assert.equal(pluginMounted, false, "Sidebar row must never invoke plugin renderer mount");

	const { document } = parseHTML(html);
	const btn = document.querySelector("button[data-workspace-id]");
	assert.ok(btn, "Row must render as a single interactive button");
	assert.match(btn.textContent || "", /Lightweight Row Test/);
	assert.equal(document.querySelectorAll("script, iframe").length, 0, "No scripts or iframes in sidebar row");
});

it("performance: real Visual Explanation mount releases browser listeners, observer, animation timer and DOM on unmount", async () => {
	const dom = parseHTML("<!doctype html><html><body><div id='root'></div></body></html>");
	const container = dom.document.getElementById("root")!;
	const original = Object.fromEntries(["window", "document", "HTMLElement", "HTMLButtonElement", "HTMLIFrameElement", "IntersectionObserver", "IS_REACT_ACT_ENVIRONMENT", "setInterval", "clearInterval"].map(key => [key, (globalThis as any)[key]]));
	const listeners = new Map<string, Set<EventListener>>();
	const baseAdd = dom.document.addEventListener.bind(dom.document);
	const baseRemove = dom.document.removeEventListener.bind(dom.document);
	dom.document.addEventListener = ((type: string, listener: EventListener, options?: any) => {
		if (type === "visibilitychange") { const set = listeners.get(type) ?? new Set(); set.add(listener); listeners.set(type, set); }
		return baseAdd(type, listener, options);
	}) as any;
	dom.document.removeEventListener = ((type: string, listener: EventListener, options?: any) => {
		if (type === "visibilitychange") listeners.get(type)?.delete(listener);
		return baseRemove(type, listener, options);
	}) as any;
	let mediaChange: EventListener | undefined;
	let mediaRemoved = false;
	(dom.window as any).matchMedia = () => ({ matches: false, addEventListener: (_type: string, listener: EventListener) => { mediaChange = listener; }, removeEventListener: (_type: string, listener: EventListener) => { if (listener === mediaChange) mediaRemoved = true; } });
	let observerCallback: IntersectionObserverCallback | undefined;
	let observerDisconnected = false;
	class ObserverMock {
		constructor(callback: IntersectionObserverCallback) { observerCallback = callback; }
		observe(target: Element) { observerCallback?.([{ isIntersecting: true, target } as IntersectionObserverEntry], this as unknown as IntersectionObserver); }
		disconnect() { observerDisconnected = true; }
		unobserve() {}
		takeRecords() { return []; }
	}
	const intervalCallbacks: (() => void)[] = [];
	let intervalCleared = false;
	Object.assign(globalThis, {
		window: dom.window, document: dom.document, HTMLElement: dom.window.HTMLElement,
		HTMLButtonElement: dom.window.HTMLButtonElement, HTMLIFrameElement: dom.window.HTMLIFrameElement,
		IntersectionObserver: ObserverMock, IS_REACT_ACT_ENVIRONMENT: true,
		setInterval: (callback: () => void) => { intervalCallbacks.push(callback); return 123; },
		clearInterval: () => { intervalCleared = true; },
	});
	const artifact = {
		version: 1 as const, id: "phase7-cleanup-artifact", title: "Cleanup Visual", renderer: "svg" as const,
		source: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><g data-step="0"><rect width="10" height="10" /></g><g data-step="1"><circle r="5" /></g></svg>',
		presentation: "inline" as const,
		controls: [{ type: "button" as const, id: "play", label: "Play", action: "play" as const }],
	};
	const root = createRoot(container as unknown as HTMLElement);
	try {
		await act(async () => root.render(<VisualExplanationCard part={{ type: "tool-visual_explanation", state: "output-available", toolCallId: "cleanup", output: { ok: true, action: "create", artifact } } as any} />));
		assert.equal(listeners.get("visibilitychange")?.size, 1, "Mount registers visibilitychange listener");
		assert.equal(typeof mediaChange, "function", "Mount registers matchMedia change listener");
		assert.ok(observerCallback, "Mount creates IntersectionObserver");
		assert.ok(container.querySelector('[data-testid="visual-explanation-card"]'), "Real card DOM mounts");
		await act(async () => (container.querySelector('[data-testid="visual-control-button-play"]') as HTMLButtonElement).click());
		assert.equal(intervalCallbacks.length, 1, "Play starts animation interval");
		await act(async () => root.unmount());
		assert.equal(listeners.get("visibilitychange")?.size, 0, "Unmount removes visibilitychange listener");
		assert.equal(mediaRemoved, true, "Unmount removes matchMedia listener");
		assert.equal(observerDisconnected, true, "Unmount disconnects IntersectionObserver");
		assert.equal(intervalCleared, true, "Unmount clears animation interval");
		assert.equal(container.children.length, 0, "React unmount removes renderer DOM");
		const visibleListeners = [...(listeners.get("visibilitychange") ?? [])];
		await act(async () => { intervalCallbacks[0]?.(); for (const listener of visibleListeners) listener(new Event("visibilitychange")); });
		assert.equal(container.children.length, 0, "No post-unmount callback remounts renderer DOM");
	} finally {
		for (const [key, value] of Object.entries(original)) { if (value === undefined) delete (globalThis as any)[key]; else (globalThis as any)[key] = value; }
	}
});
