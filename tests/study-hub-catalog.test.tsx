import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";

import { StudyHubCatalog, getModeIcon, getModeKey } from "../components/study-hub-catalog.tsx";
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

	it("2. Populated catalog displays all registered modes with composite key testids", () => {
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

		// Check mode cards with composite key testids
		const pagingKey = getModeKey("os-simulators", "paging-lab");
		const tcpKey = getModeKey("network-tools", "tcp-simulator");
		const treeKey = getModeKey("algo-tools", "tree-viz");

		assert.ok(html.includes(`data-testid="study-hub-mode-card-${pagingKey}"`), "Paging lab card rendered with composite key");
		assert.ok(html.includes("Memory &amp; Paging Lab") || html.includes("Memory & Paging Lab"), "Mode name displayed");
		assert.ok(html.includes("Interactive virtual memory and multi-level page table simulator."), "Description displayed");
		assert.ok(html.includes("Operating Systems"), "Category displayed");
		assert.ok(html.includes("os-simulators"), "Plugin identity displayed");
		assert.ok(html.includes("#memory"), "Tag rendered");
		assert.ok(html.includes("intermediate"), "Difficulty badge rendered");
		assert.ok(html.includes("simulation"), "Activity type rendered");

		// Launch buttons with composite key testids
		assert.ok(html.includes(`data-testid="launch-mode-${pagingKey}"`), "Launch button for paging lab");
		assert.ok(html.includes(`data-testid="launch-mode-${tcpKey}"`), "Launch button for tcp simulator");
		assert.ok(html.includes(`data-testid="launch-mode-${treeKey}"`), "Launch button for tree viz");
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
		assert.ok(!html.includes('data-testid="study-hub-error"'), "Error notice not rendered when catalog is cleanly empty");
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
		assert.ok(!html.includes('data-testid="study-hub-empty"'), "Empty catalog state must not be rendered when in error state");
	});

	function typeIntoInput(input: HTMLInputElement, value: string) {
		const reactKey = Object.keys(input).find((k) => k.startsWith("__reactProps"));
		if (reactKey && (input as any)[reactKey]?.onChange) {
			(input as any)[reactKey].onChange({ target: { value } });
		}
	}

	function clickElement(el: HTMLElement) {
		const reactKey = Object.keys(el).find((k) => k.startsWith("__reactProps"));
		if (reactKey && (el as any)[reactKey]?.onClick) {
			(el as any)[reactKey].onClick({ preventDefault() {} });
		} else {
			el.click();
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
		assert.ok(dom.document.querySelector('[data-testid="study-hub-mode-card-os-simulators:paging-lab"]'));
		assert.ok(dom.document.querySelector('[data-testid="study-hub-mode-card-network-tools:tcp-simulator"]'));
		assert.ok(dom.document.querySelector('[data-testid="study-hub-mode-card-algo-tools:tree-viz"]'));

		const searchInput = dom.document.querySelector('[data-testid="study-hub-search-input"]') as HTMLInputElement;
		assert.ok(searchInput, "Search input exists");

		// Filter by "tcp"
		await act(async () => {
			typeIntoInput(searchInput, "tcp");
		});

		// Only tcp-simulator should be visible
		assert.ok(!dom.document.querySelector('[data-testid="study-hub-mode-card-os-simulators:paging-lab"]'), "Paging lab hidden");
		assert.ok(dom.document.querySelector('[data-testid="study-hub-mode-card-network-tools:tcp-simulator"]'), "TCP simulator visible");
		assert.ok(!dom.document.querySelector('[data-testid="study-hub-mode-card-algo-tools:tree-viz"]'), "Tree viz hidden");

		// Clear search button should appear
		const clearBtn = dom.document.querySelector('[data-testid="study-hub-clear-search"]') as HTMLButtonElement;
		assert.ok(clearBtn, "Clear search button exists");

		await act(async () => {
			clearBtn.click();
		});

		// All 3 cards restored
		assert.ok(dom.document.querySelector('[data-testid="study-hub-mode-card-os-simulators:paging-lab"]'), "Paging lab restored");
		assert.ok(dom.document.querySelector('[data-testid="study-hub-mode-card-network-tools:tcp-simulator"]'), "TCP simulator restored");
		assert.ok(dom.document.querySelector('[data-testid="study-hub-mode-card-algo-tools:tree-viz"]'), "Tree viz restored");
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
		assert.ok(!dom.document.querySelector('[data-testid="study-hub-mode-card-os-simulators:paging-lab"]'));
		assert.ok(!dom.document.querySelector('[data-testid="study-hub-mode-card-network-tools:tcp-simulator"]'));
		assert.ok(dom.document.querySelector('[data-testid="study-hub-mode-card-algo-tools:tree-viz"]'));

		// Click "All" category
		const allCategoryBtn = dom.document.querySelector('[data-testid="filter-category-all"]') as HTMLButtonElement;
		assert.ok(allCategoryBtn, "All category button exists");

		await act(async () => {
			allCategoryBtn.click();
		});

		// All 3 cards visible again
		assert.ok(dom.document.querySelector('[data-testid="study-hub-mode-card-os-simulators:paging-lab"]'));
		assert.ok(dom.document.querySelector('[data-testid="study-hub-mode-card-network-tools:tcp-simulator"]'));
		assert.ok(dom.document.querySelector('[data-testid="study-hub-mode-card-algo-tools:tree-viz"]'));
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

		// TCP simulator does NOT have renderer
		assert.ok(html.includes('data-testid="mode-renderer-unavailable"'), "Renderer unavailable badge rendered");
	});

	it("10. Disabled plugin disables launch button and displays 'Plugin Disabled' badge", withDom(async (dom) => {
		const pluginsWithDisabled = [
			{ info: { id: "os-simulators", enabled: false }, phase: "disabled" },
			{ info: { id: "network-tools", enabled: true }, phase: "active" },
			{ info: { id: "algo-tools", enabled: true }, phase: "active" },
		];

		const root = createRoot(dom.document.getElementById("root")!);
		await act(async () => {
			root.render(
				<StudyHubCatalog
					modes={sampleModes}
					modeRenderers={sampleRenderers}
					plugins={pluginsWithDisabled}
					isLoading={false}
				/>,
			);
		});

		assert.ok(dom.document.querySelector('[data-testid="mode-plugin-disabled"]'), "Plugin disabled badge rendered");
		const disabledLaunchBtn = dom.document.querySelector('[data-testid="launch-mode-os-simulators:paging-lab"]') as HTMLButtonElement;
		assert.ok(disabledLaunchBtn, "Launch button exists");
		assert.equal(disabledLaunchBtn.disabled, true, "Launch button must be disabled when plugin is disabled");

		const enabledLaunchBtn = dom.document.querySelector('[data-testid="launch-mode-network-tools:tcp-simulator"]') as HTMLButtonElement;
		assert.ok(enabledLaunchBtn);
		assert.equal(enabledLaunchBtn.disabled, false, "Enabled plugin mode launch button remains enabled");
	}));

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

		const launchPagingBtn = dom.document.querySelector('[data-testid="launch-mode-os-simulators:paging-lab"]') as HTMLButtonElement;
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

		const launchTreeBtn = dom.document.querySelector('[data-testid="launch-mode-algo-tools:tree-viz"]') as HTMLButtonElement;
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
		let workspaceCreated = false;

		// Initial catalog has paging-lab
		await act(async () => {
			root.render(
				<StudyHubCatalog
					modes={sampleModes}
					modeRenderers={sampleRenderers}
					plugins={samplePlugins}
					isLoading={false}
					onLaunch={() => {
						workspaceCreated = true;
					}}
				/>,
			);
		});

		const launchPagingBtn = dom.document.querySelector('[data-testid="launch-mode-os-simulators:paging-lab"]') as HTMLButtonElement;
		assert.ok(launchPagingBtn, "Paging lab launch button initially present");
		const reactKey = Object.keys(launchPagingBtn).find((k) => k.startsWith("__reactProps"))!;
		const launchHandler = (launchPagingBtn as any)[reactKey]?.onClick;

		// Now simulate catalog changing where paging-lab was removed/unregistered via immutable props update
		const modesWithoutPaging = sampleModes.filter((m) => m.id !== "paging-lab");

		await act(async () => {
			root.render(
				<StudyHubCatalog
					modes={modesWithoutPaging}
					modeRenderers={sampleRenderers}
					plugins={samplePlugins}
					isLoading={false}
					onLaunch={() => {
						workspaceCreated = true;
					}}
				/>,
			);
		});

		// Paging lab card is no longer present in DOM
		assert.equal(dom.document.querySelector('[data-testid="study-hub-mode-card-os-simulators:paging-lab"]'), null);

		// If a launch was attempted using previously held reference, it must refuse and not create a workspace
		await act(async () => {
			launchHandler({ preventDefault() {} });
		});

		assert.equal(workspaceCreated, false, "Must not create a workspace when mode is no longer available");
		const errorNotice = dom.document.querySelector('[data-testid="study-hub-launch-error"]');
		assert.ok(errorNotice, "Clear launch error notice rendered");
		assert.ok(errorNotice.textContent?.includes("no longer available"), "Error message explains mode is no longer available");
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

		const launchTcpBtn = dom.document.querySelector('[data-testid="launch-mode-network-tools:tcp-simulator"]') as HTMLButtonElement;
		assert.ok(launchTcpBtn);
		assert.equal(launchTcpBtn.disabled, true, "Launch button is disabled when renderer is missing");

		// Even if manually invoked via click, it should not proceed
		await act(async () => {
			launchTcpBtn.click();
		});

		// Verify Renderer Unavailable notice exists on card
		assert.ok(dom.document.querySelector('[data-testid="mode-renderer-unavailable"]'));
	}));

	// =========================================================================
	// CORREZIONE 1: IDENTITÀ UNIVOCA DELLE MODALITÀ (pluginId + modeId)
	// =========================================================================
	it("16. Composite mode identity: two plugins with identical modeId render independently without collision", withDom(async (dom) => {
		const root = createRoot(dom.document.getElementById("root")!);
		const collisionModes: PluginModeMetadata[] = [
			{
				pluginId: "plugin-alpha",
				id: "quiz",
				name: "Quiz Alpha",
				description: "Alpha version of interactive quiz",
				category: "Testing",
			},
			{
				pluginId: "plugin-beta",
				id: "quiz",
				name: "Quiz Beta",
				description: "Beta version of interactive quiz",
				category: "Testing",
			},
		];

		const collisionRenderers = [
			{ pluginId: "plugin-alpha", modeId: "quiz" },
			{ pluginId: "plugin-beta", modeId: "quiz" },
		];

		const collisionPlugins = [
			{ info: { id: "plugin-alpha", enabled: true }, phase: "active" },
			{ info: { id: "plugin-beta", enabled: true }, phase: "active" },
		];

		let finishLaunchAlpha: (() => void) | null = null;
		const launchAlphaPromise = new Promise<void>((resolve) => {
			finishLaunchAlpha = resolve;
		});

		await act(async () => {
			root.render(
				<StudyHubCatalog
					modes={collisionModes}
					modeRenderers={collisionRenderers}
					plugins={collisionPlugins}
					isLoading={false}
					onLaunch={async (mode) => {
						if (mode.pluginId === "plugin-alpha") {
							await launchAlphaPromise;
						}
					}}
				/>,
			);
		});

		// 1. Both cards are rendered
		const cardAlpha = dom.document.querySelector('[data-testid="study-hub-mode-card-plugin-alpha:quiz"]');
		const cardBeta = dom.document.querySelector('[data-testid="study-hub-mode-card-plugin-beta:quiz"]');
		assert.ok(cardAlpha, "Card for plugin-alpha:quiz rendered");
		assert.ok(cardBeta, "Card for plugin-beta:quiz rendered");

		// 2. Both cards have distinct test identifiers
		assert.notEqual(
			cardAlpha.getAttribute("data-testid"),
			cardBeta.getAttribute("data-testid"),
			"Test identifiers are distinct"
		);

		const launchAlphaBtn = dom.document.querySelector('[data-testid="launch-mode-plugin-alpha:quiz"]') as HTMLButtonElement;
		const launchBetaBtn = dom.document.querySelector('[data-testid="launch-mode-plugin-beta:quiz"]') as HTMLButtonElement;
		assert.ok(launchAlphaBtn, "Launch button for alpha quiz exists");
		assert.ok(launchBetaBtn, "Launch button for beta quiz exists");
		assert.equal(launchAlphaBtn.disabled, false);
		assert.equal(launchBetaBtn.disabled, false);

		// 3. Start launching plugin-alpha / quiz (in flight)
		act(() => {
			launchAlphaBtn.click();
		});

		// 4. Only plugin-alpha / quiz shows loading state and is disabled
		assert.ok(launchAlphaBtn.textContent?.includes("Launching..."), "Alpha button displays launching state");
		assert.equal(launchAlphaBtn.disabled, true, "Alpha button is disabled while launching");

		// 5. plugin-beta / quiz is NOT disabled and does NOT show loading state
		assert.ok(!launchBetaBtn.textContent?.includes("Launching..."), "Beta button does not show launching state");
		assert.equal(launchBetaBtn.disabled, false, "Beta button remains enabled and unhindered");

		// 6. Complete the launch and verify state restoration
		await act(async () => {
			finishLaunchAlpha!();
		});

		assert.ok(!launchAlphaBtn.textContent?.includes("Launching..."), "Alpha button restored after launch");
		assert.equal(launchAlphaBtn.disabled, false, "Alpha button re-enabled");
		assert.equal(launchBetaBtn.disabled, false, "Beta button remains enabled");
	}));

	// =========================================================================
	// CORREZIONE 2: TEST REALISTICO CREAZIONE WORKSPACE TRAMITE MANAGER MOCKATO
	// =========================================================================
	it("17. Realistic workspace creation: exercises manager.createWorkspace() and router navigation for consecutive distinct instances", withDom(async (dom) => {
		const root = createRoot(dom.document.getElementById("root")!);
		const createCalls: Array<{ pluginId: string; modeId: string }> = [];
		const pushedUrls: string[] = [];
		let workspaceSeq = 1;

		const mockRouter = {
			push: (url: string) => {
				pushedUrls.push(url);
			},
		};

		const mockManager = {
			getModeRenderer: (pluginId: string, modeId: string) => ({ pluginId, modeId }),
			createWorkspace: async (pluginId: string, modeId: string) => {
				createCalls.push({ pluginId, modeId });
				const id = workspaceSeq === 1 ? "workspace-001" : "workspace-002";
				workspaceSeq++;
				return {
					version: 1 as const,
					id: id as any,
					pluginId,
					modeId,
					title: `Workspace ${id}`,
					createdAt: "2026-11-15T10:00:00.000Z",
					updatedAt: "2026-11-15T10:00:00.000Z",
					state: "ready" as const,
				};
			},
		};

		await act(async () => {
			root.render(
				<StudyHubCatalog
					modes={sampleModes}
					modeRenderers={sampleRenderers}
					plugins={samplePlugins}
					manager={mockManager}
					router={mockRouter}
					isLoading={false}
				/>,
			);
		});

		const launchBtn = dom.document.querySelector('[data-testid="launch-mode-os-simulators:paging-lab"]') as HTMLButtonElement;
		assert.ok(launchBtn, "Launch button for os-simulators:paging-lab exists");

		// 1. First launch operation
		await act(async () => {
			launchBtn.click();
		});

		// Verify first call
		assert.equal(createCalls.length, 1, "manager.createWorkspace called once");
		assert.deepEqual(createCalls[0], { pluginId: "os-simulators", modeId: "paging-lab" });
		assert.equal(pushedUrls.length, 1, "router.push called once");
		assert.equal(pushedUrls[0], "/workspaces/workspace-001");

		// 2. Second launch operation on the same mode
		await act(async () => {
			launchBtn.click();
		});

		// Verify second call and distinct workspace ID
		assert.equal(createCalls.length, 2, "manager.createWorkspace called exactly twice");
		assert.deepEqual(createCalls[1], { pluginId: "os-simulators", modeId: "paging-lab" });
		assert.equal(pushedUrls.length, 2, "router.push called twice");
		assert.equal(pushedUrls[1], "/workspaces/workspace-002");

		// Verify distinct IDs and no workspace reuse
		assert.notEqual(pushedUrls[0], pushedUrls[1], "Consecutive launches navigate to distinct workspace IDs");
		assert.equal(pushedUrls[0], "/workspaces/workspace-001");
		assert.equal(pushedUrls[1], "/workspaces/workspace-002");
	}));

	it("18. Removed mode between rendering and launch attempt: refuses launch, does not invoke manager.createWorkspace, and displays error notice", withDom(async (dom) => {
		const root = createRoot(dom.document.getElementById("root")!);
		let managerCallCount = 0;

		const mockManager = {
			getModeRenderer: (pluginId: string, modeId: string) => ({ pluginId, modeId }),
			createWorkspace: async (pluginId: string, modeId: string) => {
				managerCallCount++;
				return {
					version: 1 as const,
					id: "workspace-unexpected" as any,
					pluginId,
					modeId,
					title: "Unexpected",
					createdAt: "2026-11-15T10:00:00.000Z",
					updatedAt: "2026-11-15T10:00:00.000Z",
					state: "ready" as const,
				};
			},
		};

		// Initial render with liveModes array
		const liveModes = [...sampleModes];

		await act(async () => {
			root.render(
				<StudyHubCatalog
					modes={liveModes}
					modeRenderers={sampleRenderers}
					plugins={samplePlugins}
					manager={mockManager}
					isLoading={false}
				/>,
			);
		});

		const launchPagingBtn = dom.document.querySelector('[data-testid="launch-mode-os-simulators:paging-lab"]') as HTMLButtonElement;
		assert.ok(launchPagingBtn, "Button rendered in initial catalog");
		const reactKey = Object.keys(launchPagingBtn).find((k) => k.startsWith("__reactProps"))!;
		const launchHandler = (launchPagingBtn as any)[reactKey]?.onClick;

		// Catalog receives an immutable props update where paging-lab is removed
		const updatedModes = sampleModes.filter((m) => m.id !== "paging-lab");
		await act(async () => {
			root.render(
				<StudyHubCatalog
					modes={updatedModes}
					modeRenderers={sampleRenderers}
					plugins={samplePlugins}
					manager={mockManager}
					isLoading={false}
				/>,
			);
		});

		// Now attempt to launch the removed mode
		await act(async () => {
			launchHandler({ preventDefault() {} });
		});

		// Verify manager.createWorkspace was NEVER invoked
		assert.equal(managerCallCount, 0, "manager.createWorkspace must not be called for an unavailable mode");

		// Verify appropriate error message is displayed
		const errorNotice = dom.document.querySelector('[data-testid="study-hub-launch-error"]');
		assert.ok(errorNotice, "Launch error notice displayed");
		assert.ok(
			errorNotice.textContent?.includes("no longer available"),
			"Explains mode is no longer available"
		);
	}));

	it("19. Concurrent launches: launching both modes maintains independent loading states when one finishes before the other", withDom(async (dom) => {
		const root = createRoot(dom.document.getElementById("root")!);

		const collisionModes = [
			{
				id: "quiz",
				pluginId: "plugin-alpha",
				name: "Quiz Alpha",
				description: "Alpha version of quiz",
				icon: "help-circle",
				category: "quiz",
				difficulty: "beginner" as const,
			},
			{
				id: "quiz",
				pluginId: "plugin-beta",
				name: "Quiz Beta",
				description: "Beta version of quiz",
				icon: "help-circle",
				category: "quiz",
				difficulty: "intermediate" as const,
			},
		];

		const collisionRenderers = [
			{ pluginId: "plugin-alpha", modeId: "quiz" },
			{ pluginId: "plugin-beta", modeId: "quiz" },
		];

		const collisionPlugins = [
			{ info: { id: "plugin-alpha", enabled: true }, phase: "active" },
			{ info: { id: "plugin-beta", enabled: true }, phase: "active" },
		];

		let finishAlpha: (() => void) | null = null;
		const alphaPromise = new Promise<void>((resolve) => {
			finishAlpha = resolve;
		});

		let finishBeta: (() => void) | null = null;
		const betaPromise = new Promise<void>((resolve) => {
			finishBeta = resolve;
		});

		await act(async () => {
			root.render(
				<StudyHubCatalog
					modes={collisionModes}
					modeRenderers={collisionRenderers}
					plugins={collisionPlugins}
					isLoading={false}
					onLaunch={async (mode) => {
						if (mode.pluginId === "plugin-alpha") {
							await alphaPromise;
						} else if (mode.pluginId === "plugin-beta") {
							await betaPromise;
						}
					}}
				/>,
			);
		});

		const launchAlphaBtn = dom.document.querySelector('[data-testid="launch-mode-plugin-alpha:quiz"]') as HTMLButtonElement;
		const launchBetaBtn = dom.document.querySelector('[data-testid="launch-mode-plugin-beta:quiz"]') as HTMLButtonElement;
		assert.ok(launchAlphaBtn, "Alpha launch button exists");
		assert.ok(launchBetaBtn, "Beta launch button exists");

		// 1. Launch both modes concurrently
		act(() => {
			launchAlphaBtn.click();
		});
		act(() => {
			launchBetaBtn.click();
		});

		// 2. Both modes show launching state and are disabled
		assert.ok(launchAlphaBtn.textContent?.includes("Launching..."), "Alpha displays launching state");
		assert.equal(launchAlphaBtn.disabled, true, "Alpha is disabled");
		assert.ok(launchBetaBtn.textContent?.includes("Launching..."), "Beta displays launching state");
		assert.equal(launchBetaBtn.disabled, true, "Beta is disabled");

		// 3. Complete alpha while beta is still in flight
		await act(async () => {
			finishAlpha!();
		});

		// 4. Alpha is restored, but beta STILL shows launching spinner and remains disabled
		assert.ok(!launchAlphaBtn.textContent?.includes("Launching..."), "Alpha button restored after completion");
		assert.equal(launchAlphaBtn.disabled, false, "Alpha button re-enabled");
		assert.ok(launchBetaBtn.textContent?.includes("Launching..."), "Beta button still displays launching state while in flight");
		assert.equal(launchBetaBtn.disabled, true, "Beta button remains disabled while in flight");

		// 5. Complete beta and verify restoration
		await act(async () => {
			finishBeta!();
		});

		assert.ok(!launchBetaBtn.textContent?.includes("Launching..."), "Beta button restored after completion");
		assert.equal(launchBetaBtn.disabled, false, "Beta button re-enabled");
	}));

	it("20. Refresh failure: handles error gracefully, leaves interface unblocked, and allows subsequent retry", withDom(async (dom) => {
		const root = createRoot(dom.document.getElementById("root")!);
		let refreshAttempts = 0;

		await act(async () => {
			root.render(
				<StudyHubCatalog
					modes={sampleModes}
					modeRenderers={sampleRenderers}
					plugins={samplePlugins}
					isLoading={false}
					onRetry={async () => {
						refreshAttempts++;
						if (refreshAttempts === 1) {
							throw new Error("Network timeout during catalog refresh");
						}
					}}
				/>,
			);
		});

		const refreshBtn = dom.document.querySelector('[data-testid="study-hub-refresh-button"]') as HTMLButtonElement;
		assert.ok(refreshBtn, "Refresh button rendered");
		assert.equal(refreshBtn.disabled, false, "Initially enabled");

		// 1. First attempt fails
		await act(async () => {
			refreshBtn.click();
		});

		assert.equal(refreshAttempts, 1);
		// Interface is NOT stuck and button is usable again
		assert.equal(refreshBtn.disabled, false, "Refresh button re-enabled after failure");

		// 2. Second attempt succeeds
		await act(async () => {
			refreshBtn.click();
		});

		assert.equal(refreshAttempts, 2);
		assert.equal(refreshBtn.disabled, false, "Refresh button re-enabled after success");
	}));

	it("21. Filters: difficulty filtering, category + difficulty combination, reset, and no-results message", withDom(async (dom) => {
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

		// 1. Test difficulty filter: click "beginner"
		const beginnerBtn = dom.document.querySelector('[data-testid="filter-difficulty-beginner"]') as HTMLButtonElement;
		assert.ok(beginnerBtn, "Beginner difficulty button exists");

		await act(async () => {
			beginnerBtn.click();
		});

		// Only tree-viz is beginner
		assert.ok(dom.document.querySelector('[data-testid="study-hub-mode-card-algo-tools:tree-viz"]'));
		assert.ok(!dom.document.querySelector('[data-testid="study-hub-mode-card-os-simulators:paging-lab"]'));
		assert.ok(!dom.document.querySelector('[data-testid="study-hub-mode-card-network-tools:tcp-simulator"]'));

		// 2. Combination between category and difficulty: category "Networking" + difficulty "beginner"
		// (tcp-simulator is advanced, so Networking + beginner has 0 matching modes)
		const networkingBtn = dom.document.querySelector('[data-testid="filter-category-networking"]') as HTMLButtonElement;
		assert.ok(networkingBtn, "Networking category button exists");

		await act(async () => {
			networkingBtn.click();
		});

		// 0 modes match: must show no-results message and hide grid and empty catalog
		assert.ok(dom.document.querySelector('[data-testid="study-hub-no-results"]'), "No-results state rendered for combination");
		assert.ok(!dom.document.querySelector('[data-testid="study-hub-grid"]'), "Grid not rendered");
		assert.ok(!dom.document.querySelector('[data-testid="study-hub-empty"]'), "Empty catalog state not rendered");

		// 3. Reset filters via "Reset Filters" button in no-results view
		const resetBtn = dom.document.querySelector('[data-testid="study-hub-reset-search"]') as HTMLButtonElement;
		assert.ok(resetBtn, "Reset Filters button exists");

		await act(async () => {
			resetBtn.click();
		});

		// All 3 modes are restored
		assert.ok(dom.document.querySelector('[data-testid="study-hub-grid"]'), "Grid restored after reset");
		assert.ok(dom.document.querySelector('[data-testid="study-hub-mode-card-os-simulators:paging-lab"]'));
		assert.ok(dom.document.querySelector('[data-testid="study-hub-mode-card-network-tools:tcp-simulator"]'));
		assert.ok(dom.document.querySelector('[data-testid="study-hub-mode-card-algo-tools:tree-viz"]'));
	}));
});
