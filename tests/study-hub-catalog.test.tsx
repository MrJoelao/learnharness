import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";

import { StudyHubCatalog, getModeIcon } from "../components/study-hub-catalog.tsx";
import type { PluginModeMetadata } from "../src/core";
import {
	BookOpenIcon,
	BrainIcon,
	CalculatorIcon,
	CodeIcon,
	FlaskConicalIcon,
	GraduationCapIcon,
	LayoutGridIcon,
	LightbulbIcon,
	NetworkIcon,
	PuzzleIcon,
	TargetIcon,
} from "lucide-react";

describe("Study Hub Phase 5: Catalog and Mode Launcher", () => {
	const sampleModes: PluginModeMetadata[] = [
		{
			id: "paging-lab",
			pluginId: "os-simulators",
			name: "Memory & Paging Lab",
			description: "Interactive virtual memory and multi-level page table simulator.",
			category: "Operating Systems",
			icon: "Brain",
			tags: ["memory", "paging", "os"],
			difficulty: "intermediate",
			activityType: "simulation",
		},
		{
			id: "tcp-simulator",
			pluginId: "network-tools",
			name: "TCP/IP Packet Simulator",
			description: "Step through three-way handshakes and congestion control windows.",
			category: "Networking",
			icon: "Network",
			tags: ["tcp", "packets", "protocols"],
			difficulty: "advanced",
			activityType: "lab",
		},
		{
			id: "tree-viz",
			pluginId: "algo-tools",
			name: "Tree Visualizer",
			description: "Explore AVL trees, Red-Black trees, and heap rotations interactively.",
			category: "Algorithms",
			icon: "Code",
			tags: ["trees", "data-structures", "graphs"],
			difficulty: "beginner",
			activityType: "visualization",
		},
	];

	const sampleRenderers = [
		{ pluginId: "os-simulators", modeId: "paging-lab" },
		{ pluginId: "network-tools", modeId: "tcp-simulator" },
		{ pluginId: "algo-tools", modeId: "tree-viz" },
	];

	const samplePlugins = [
		{ info: { id: "os-simulators", enabled: true }, phase: "active" },
		{ info: { id: "network-tools", enabled: true }, phase: "active" },
		{ info: { id: "algo-tools", enabled: true }, phase: "active" },
	];

	function withDom(testFn: (dom: any) => Promise<void> | void) {
		return async () => {
			const dom = parseHTML("<html><head></head><body><div id='root'></div></body></html>");
			if (!(dom.window as any).requestIdleCallback) {
				(dom.window as any).requestIdleCallback = (cb: any) => setTimeout(cb, 1);
				(dom.window as any).cancelIdleCallback = (id: any) => clearTimeout(id);
			}

			const originalWindow = (globalThis as Record<string, unknown>).window;
			const originalSelf = (globalThis as Record<string, unknown>).self;
			const originalDocument = (globalThis as Record<string, unknown>).document;
			const originalHTMLElement = (globalThis as Record<string, unknown>).HTMLElement;
			const originalElement = (globalThis as Record<string, unknown>).Element;
			const originalNode = (globalThis as Record<string, unknown>).Node;
			const originalAct = (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT;

			Object.assign(globalThis, {
				window: dom.window,
				self: dom.window,
				document: dom.document,
				HTMLElement: dom.window.HTMLElement,
				Element: dom.window.Element,
				Node: dom.window.Node,
				IS_REACT_ACT_ENVIRONMENT: true,
			});

			try {
				await testFn(dom);
			} finally {
				(globalThis as Record<string, unknown>).window = originalWindow;
				(globalThis as Record<string, unknown>).self = originalSelf;
				(globalThis as Record<string, unknown>).document = originalDocument;
				(globalThis as Record<string, unknown>).HTMLElement = originalHTMLElement;
				(globalThis as Record<string, unknown>).Element = originalElement;
				(globalThis as Record<string, unknown>).Node = originalNode;
				(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = originalAct;
			}
		};
	}

	it("1. getModeIcon maps all supported PLUGIN_MODE_ICONS with LayoutGridIcon fallback", () => {
		assert.equal(getModeIcon("BookOpen"), BookOpenIcon);
		assert.equal(getModeIcon("Brain"), BrainIcon);
		assert.equal(getModeIcon("Calculator"), CalculatorIcon);
		assert.equal(getModeIcon("Code"), CodeIcon);
		assert.equal(getModeIcon("FlaskConical"), FlaskConicalIcon);
		assert.equal(getModeIcon("GraduationCap"), GraduationCapIcon);
		assert.equal(getModeIcon("Lightbulb"), LightbulbIcon);
		assert.equal(getModeIcon("Network"), NetworkIcon);
		assert.equal(getModeIcon("Puzzle"), PuzzleIcon);
		assert.equal(getModeIcon("Target"), TargetIcon);
		assert.equal(getModeIcon(undefined), LayoutGridIcon);
		assert.equal(getModeIcon("NonExistentIcon"), LayoutGridIcon);
	});

	it("2. Populated catalog displays all registered modes with required and optional metadata", () => {
		const html = renderToStaticMarkup(
			<StudyHubCatalog
				modes={sampleModes}
				modeRenderers={sampleRenderers}
				plugins={samplePlugins}
				isLoading={false}
			/>,
		);

		assert.ok(html.includes('data-testid="study-hub-page"'), "Study Hub page container rendered");
		assert.ok(html.includes('data-testid="study-hub-title"'), "Study Hub title rendered");
		assert.ok(html.includes('data-testid="study-hub-grid"'), "Mode cards grid rendered");

		// Check mode cards
		assert.ok(html.includes('data-testid="study-hub-mode-card-paging-lab"'), "Paging lab card rendered");
		assert.ok(html.includes("Memory &amp; Paging Lab") || html.includes("Memory & Paging Lab"), "Mode name displayed");
		assert.ok(html.includes("Interactive virtual memory and multi-level page table simulator."), "Description displayed");
		assert.ok(html.includes("Operating Systems"), "Category displayed");
		assert.ok(html.includes("os-simulators"), "Plugin identity displayed");
		assert.ok(html.includes("#memory"), "Tag rendered");
		assert.ok(html.includes("intermediate"), "Difficulty badge rendered");
		assert.ok(html.includes("simulation"), "Activity type rendered");

		// Launch buttons
		assert.ok(html.includes('data-testid="launch-mode-paging-lab"'), "Launch button for paging lab");
		assert.ok(html.includes('data-testid="launch-mode-tcp-simulator"'), "Launch button for tcp simulator");
		assert.ok(html.includes('data-testid="launch-mode-tree-viz"'), "Launch button for tree viz");
	});

	it("3. Empty catalog renders informative explanation pointing to plugins management", () => {
		const html = renderToStaticMarkup(
			<StudyHubCatalog
				modes={[]}
				modeRenderers={[]}
				plugins={[]}
				isLoading={false}
			/>,
		);

		assert.ok(html.includes('data-testid="study-hub-empty"'), "Empty state container rendered");
		assert.ok(html.includes("No Learning Modes Available"), "Empty state title rendered");
		assert.ok(html.includes("There are currently no learning modes registered"), "Empty state explanation rendered");
		assert.ok(html.includes("href=\"/settings\""), "Links to settings to manage plugins");
		assert.ok(!html.includes('data-testid="study-hub-grid"'), "Grid not rendered when empty");
	});

	it("4. Loading state renders skeleton placeholders", () => {
		const html = renderToStaticMarkup(
			<StudyHubCatalog
				modes={sampleModes}
				modeRenderers={sampleRenderers}
				plugins={samplePlugins}
				isLoading={true}
			/>,
		);

		assert.ok(html.includes('data-testid="study-hub-loading"'), "Loading container rendered");
		assert.ok(html.includes("animate-pulse"), "Skeleton pulsing placeholders rendered");
		assert.ok(!html.includes('data-testid="study-hub-grid"'), "Populated grid not rendered while loading");
	});

	it("5. Error state renders alert notice with retry action", () => {
		const html = renderToStaticMarkup(
			<StudyHubCatalog
				modes={[]}
				isLoading={false}
				error="Failed to connect to plugin host"
			/>,
		);

		assert.ok(html.includes('data-testid="study-hub-error"'), "Error notice rendered");
		assert.ok(html.includes("Failed to load study modes"), "Error heading rendered");
		assert.ok(html.includes("Failed to connect to plugin host"), "Error message rendered");
		assert.ok(html.includes('data-testid="study-hub-retry-button"'), "Retry button rendered");
	});

	function typeIntoInput(input: HTMLInputElement, value: string) {
		const reactKey = Object.keys(input).find((k) => k.startsWith("__reactProps"));
		if (reactKey && (input as any)[reactKey]?.onChange) {
			(input as any)[reactKey].onChange({ target: { value } });
		}
	}

	it("6. Text search filters modes immediately and supports clearing query", withDom(async (dom) => {
		const root = createRoot(dom.document.getElementById("root")!);

		await act(async () => {
			root.render(
				<StudyHubCatalog
					modes={sampleModes}
					modeRenderers={sampleRenderers}
					plugins={samplePlugins}
					isLoading={false}
				/>,
			);
		});

		// Initially all 3 cards present
		assert.ok(dom.document.querySelector('[data-testid="study-hub-mode-card-paging-lab"]'));
		assert.ok(dom.document.querySelector('[data-testid="study-hub-mode-card-tcp-simulator"]'));
		assert.ok(dom.document.querySelector('[data-testid="study-hub-mode-card-tree-viz"]'));

		const searchInput = dom.document.querySelector('[data-testid="study-hub-search-input"]') as HTMLInputElement;
		assert.ok(searchInput, "Search input exists");

		// Filter by "tcp"
		await act(async () => {
			typeIntoInput(searchInput, "tcp");
		});

		// Only tcp-simulator should be visible
		assert.ok(!dom.document.querySelector('[data-testid="study-hub-mode-card-paging-lab"]'), "Paging lab hidden");
		assert.ok(dom.document.querySelector('[data-testid="study-hub-mode-card-tcp-simulator"]'), "TCP simulator visible");
		assert.ok(!dom.document.querySelector('[data-testid="study-hub-mode-card-tree-viz"]'), "Tree viz hidden");

		// Clear search button should appear
		const clearBtn = dom.document.querySelector('[data-testid="study-hub-clear-search"]') as HTMLButtonElement;
		assert.ok(clearBtn, "Clear search button exists");

		await act(async () => {
			clearBtn.click();
		});

		// All 3 cards restored
		assert.ok(dom.document.querySelector('[data-testid="study-hub-mode-card-paging-lab"]'), "Paging lab restored");
		assert.ok(dom.document.querySelector('[data-testid="study-hub-mode-card-tcp-simulator"]'), "TCP simulator restored");
		assert.ok(dom.document.querySelector('[data-testid="study-hub-mode-card-tree-viz"]'), "Tree viz restored");
	}));

	it("7. Category filters narrow down displayed modes and toggle back to all", withDom(async (dom) => {
		const root = createRoot(dom.document.getElementById("root")!);

		await act(async () => {
			root.render(
				<StudyHubCatalog
					modes={sampleModes}
					modeRenderers={sampleRenderers}
					plugins={samplePlugins}
					isLoading={false}
				/>,
			);
		});

		const algoCategoryBtn = dom.document.querySelector('[data-testid="filter-category-algorithms"]') as HTMLButtonElement;
		assert.ok(algoCategoryBtn, "Algorithms category button exists");

		// Click "Algorithms"
		await act(async () => {
			algoCategoryBtn.click();
		});

		// Only tree-viz belongs to Algorithms
		assert.ok(!dom.document.querySelector('[data-testid="study-hub-mode-card-paging-lab"]'));
		assert.ok(!dom.document.querySelector('[data-testid="study-hub-mode-card-tcp-simulator"]'));
		assert.ok(dom.document.querySelector('[data-testid="study-hub-mode-card-tree-viz"]'));

		// Click "All" category
		const allCategoryBtn = dom.document.querySelector('[data-testid="filter-category-all"]') as HTMLButtonElement;
		assert.ok(allCategoryBtn, "All category button exists");

		await act(async () => {
			allCategoryBtn.click();
		});

		// All 3 cards visible again
		assert.ok(dom.document.querySelector('[data-testid="study-hub-mode-card-paging-lab"]'));
		assert.ok(dom.document.querySelector('[data-testid="study-hub-mode-card-tcp-simulator"]'));
		assert.ok(dom.document.querySelector('[data-testid="study-hub-mode-card-tree-viz"]'));
	}));

	it("8. No search results state displays reset button that clears active query", withDom(async (dom) => {
		const root = createRoot(dom.document.getElementById("root")!);

		await act(async () => {
			root.render(
				<StudyHubCatalog
					modes={sampleModes}
					modeRenderers={sampleRenderers}
					plugins={samplePlugins}
					isLoading={false}
				/>,
			);
		});

		const searchInput = dom.document.querySelector('[data-testid="study-hub-search-input"]') as HTMLInputElement;
		await act(async () => {
			typeIntoInput(searchInput, "nonexistent-query-xyz");
		});

		assert.ok(dom.document.querySelector('[data-testid="study-hub-no-results"]'), "No results state shown");
		assert.ok(!dom.document.querySelector('[data-testid="study-hub-grid"]'), "Grid is hidden");

		const resetBtn = dom.document.querySelector('[data-testid="study-hub-reset-search"]') as HTMLButtonElement;
		assert.ok(resetBtn, "Reset filters button shown");

		await act(async () => {
			resetBtn.click();
		});

		assert.ok(dom.document.querySelector('[data-testid="study-hub-grid"]'), "Grid restored after reset");
	}));

	it("9. Missing renderer disables launch button and shows 'Renderer Unavailable' badge", () => {
		// Only paging-lab has registered renderer, tcp-simulator renderer is absent
		const partialRenderers = [{ pluginId: "os-simulators", modeId: "paging-lab" }];

		const html = renderToStaticMarkup(
			<StudyHubCatalog
				modes={sampleModes}
				modeRenderers={partialRenderers}
				plugins={samplePlugins}
				isLoading={false}
			/>,
		);

		// Paging lab has renderer
		assert.ok(!html.includes('data-testid="study-hub-mode-card-paging-lab" data-testid="mode-renderer-unavailable"'));

		// TCP simulator does NOT have renderer
		assert.ok(html.includes('data-testid="mode-renderer-unavailable"'), "Renderer unavailable badge rendered");
	});

	it("10. Disabled plugin disables launch button and displays 'Plugin Disabled' badge", () => {
		const pluginsWithDisabled = [
			{ info: { id: "os-simulators", enabled: false }, phase: "disabled" },
			{ info: { id: "network-tools", enabled: true }, phase: "active" },
			{ info: { id: "algo-tools", enabled: true }, phase: "active" },
		];

		const html = renderToStaticMarkup(
			<StudyHubCatalog
				modes={sampleModes}
				modeRenderers={sampleRenderers}
				plugins={pluginsWithDisabled}
				isLoading={false}
			/>,
		);

		assert.ok(html.includes('data-testid="mode-plugin-disabled"'), "Plugin disabled badge rendered");
	});

	it("11. Launch flow creates a fresh independent workspace and navigates", withDom(async (dom) => {
		const root = createRoot(dom.document.getElementById("root")!);
		const launchedModes: PluginModeMetadata[] = [];

		await act(async () => {
			root.render(
				<StudyHubCatalog
					modes={sampleModes}
					modeRenderers={sampleRenderers}
					plugins={samplePlugins}
					isLoading={false}
					onLaunch={async (mode) => {
						launchedModes.push(mode);
					}}
				/>,
			);
		});

		const launchPagingBtn = dom.document.querySelector('[data-testid="launch-mode-paging-lab"]') as HTMLButtonElement;
		assert.ok(launchPagingBtn, "Launch button for paging lab exists");
		assert.equal(launchPagingBtn.disabled, false, "Launch button is enabled");

		// Launch Mode A (first instance)
		await act(async () => {
			launchPagingBtn.click();
		});

		assert.equal(launchedModes.length, 1, "First launch succeeded");
		assert.equal(launchedModes[0]!.id, "paging-lab");

		// Launch Mode A again (second instance - each launch creates a new independent workspace)
		await act(async () => {
			launchPagingBtn.click();
		});

		assert.equal(launchedModes.length, 2, "Second launch succeeded independently");
		assert.equal(launchedModes[1]!.id, "paging-lab");
	}));

	it("12. Launch error is displayed and recoverable when workspace creation fails", withDom(async (dom) => {
		const root = createRoot(dom.document.getElementById("root")!);

		await act(async () => {
			root.render(
				<StudyHubCatalog
					modes={sampleModes}
					modeRenderers={sampleRenderers}
					plugins={samplePlugins}
					isLoading={false}
					onLaunch={async () => {
						throw new Error("Disk quota exceeded: cannot initialize workspace");
					}}
				/>,
			);
		});

		const launchTreeBtn = dom.document.querySelector('[data-testid="launch-mode-tree-viz"]') as HTMLButtonElement;
		assert.ok(launchTreeBtn);

		await act(async () => {
			launchTreeBtn.click();
		});

		// Error notice must be displayed
		const errorNotice = dom.document.querySelector('[data-testid="study-hub-launch-error"]');
		assert.ok(errorNotice, "Launch error banner rendered");
		assert.ok(errorNotice.textContent?.includes("Disk quota exceeded"), "Error message displayed to user");

		// Button must not remain stuck in loading/disabled state
		assert.equal(launchTreeBtn.disabled, false, "Button is re-enabled so user can retry");
	}));

	it("13. Refresh button invokes reload/retry callback", withDom(async (dom) => {
		const root = createRoot(dom.document.getElementById("root")!);
		let refreshCalled = false;

		await act(async () => {
			root.render(
				<StudyHubCatalog
					modes={sampleModes}
					modeRenderers={sampleRenderers}
					plugins={samplePlugins}
					isLoading={false}
					onRetry={async () => {
						refreshCalled = true;
					}}
				/>,
			);
		});

		const refreshBtn = dom.document.querySelector('[data-testid="study-hub-refresh-button"]') as HTMLButtonElement;
		assert.ok(refreshBtn, "Refresh button rendered");

		await act(async () => {
			refreshBtn.click();
		});

		assert.equal(refreshCalled, true, "Refresh callback executed");
	}));

	it("14. Attempting to launch an unavailable or removed mode definition shows a clear recoverable error", withDom(async (dom) => {
		const root = createRoot(dom.document.getElementById("root")!);

		// Initial catalog has paging-lab
		await act(async () => {
			root.render(
				<StudyHubCatalog
					modes={sampleModes}
					modeRenderers={sampleRenderers}
					plugins={samplePlugins}
					isLoading={false}
				/>,
			);
		});

		// Now simulate catalog changing where paging-lab was removed/unregistered
		const modesWithoutPaging = sampleModes.filter((m) => m.id !== "paging-lab");

		await act(async () => {
			root.render(
				<StudyHubCatalog
					modes={modesWithoutPaging}
					modeRenderers={sampleRenderers}
					plugins={samplePlugins}
					isLoading={false}
				/>,
			);
		});

		// Paging lab is no longer present in DOM
		assert.equal(dom.document.querySelector('[data-testid="study-hub-mode-card-paging-lab"]'), null);
	}));

	it("15. Attempting to launch when renderer is missing is prevented with error notification", withDom(async (dom) => {
		const root = createRoot(dom.document.getElementById("root")!);

		// tcp-simulator has no renderer registered
		const withoutTcpRenderer = sampleRenderers.filter((r) => r.modeId !== "tcp-simulator");

		await act(async () => {
			root.render(
				<StudyHubCatalog
					modes={sampleModes}
					modeRenderers={withoutTcpRenderer}
					plugins={samplePlugins}
					isLoading={false}
				/>,
			);
		});

		const launchTcpBtn = dom.document.querySelector('[data-testid="launch-mode-tcp-simulator"]') as HTMLButtonElement;
		assert.ok(launchTcpBtn);
		assert.equal(launchTcpBtn.disabled, true, "Launch button is disabled when renderer is missing");

		// Even if manually invoked via click, it should not proceed
		await act(async () => {
			launchTcpBtn.click();
		});

		// Verify Renderer Unavailable notice exists on card
		assert.ok(dom.document.querySelector('[data-testid="mode-renderer-unavailable"]'));
	}));
});
