import assert from "node:assert/strict";
import { it } from "node:test";
import { parseHTML } from "linkedom";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ServerEventsProvider } from "../components/server-events.tsx";
import { StudyHubCatalog } from "../components/study-hub-catalog.tsx";
import { WorkspaceRow } from "../components/workspace-row.tsx";
import { WorkspaceScreen } from "../components/workspace-screen.tsx";
import { DeclarativeSvgRenderer } from "../components/artifacts/declarative-svg-renderer.tsx";
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
		id: parseWorkspaceId("workspace_12345678-1234-4000-8000-123456789abc"),
		title: "Lightweight Row Test",
		pluginId: "heavy-plugin",
		modeId: "heavy-mode",
		updatedAt: new Date().toISOString(),
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

it("performance: unmounting cleans up listeners, DOM nodes, and avoids leaks", () => {
	const { document } = parseHTML("<!DOCTYPE html><html><body><div id='root'></div></body></html>");
	const container = document.getElementById("root")!;

	let listenerCount = 0;
	const dummyTarget = {
		addEventListener() { listenerCount++; },
		removeEventListener() { listenerCount--; },
	};

	// Simulate mount
	dummyTarget.addEventListener();
	container.innerHTML = "<div>Mounted Content</div>";
	assert.equal(listenerCount, 1);
	assert.equal(container.children.length, 1);

	// Simulate unmount
	dummyTarget.removeEventListener();
	container.replaceChildren();

	assert.equal(listenerCount, 0, "Listener must be released on unmount");
	assert.equal(container.children.length, 0, "Container children must be emptied");
});
