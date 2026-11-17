/**
 * Acceptance Tests for Declarative Controls & Artifact Lifecycle (Phase 6.1 — Fixes A & B)
 */

import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseHTML } from "linkedom";
import {
	VisualExplanationCard,
	VisualExplanationInstance,
	applyStateToSvg,
	clearVisualArtifactRegistry,
	computeArtifactSignature,
	getVisualArtifactRegistrySize,
	preserveCompatibleState,
	registerVisualArtifact,
	subscribeVisualArtifact,
} from "../components/artifacts/visual-explanation-card.tsx";
import type { VisualArtifact } from "../src/core/contracts/visual-explanation.ts";

const MOCK_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">
  <g data-step="0"><text x="10" y="20">Init</text></g>
  <g data-step="1"><text x="10" y="20">Step 1</text></g>
  <g data-toggle="grid"><line x1="0" y1="50" x2="200" y2="50"/></g>
  <g data-select-mode="compact"><rect width="50" height="20"/></g>
  <g data-select-mode="detailed"><rect width="100" height="40"/></g>
</svg>
`.trim();

const MOCK_DECLARATIVE_JSON = JSON.stringify({
	schema: "learnharness.visual.svg.v1",
	viewBox: { width: 200, height: 100 },
	steps: [
		{
			id: "s0",
			label: "Step 0",
			elements: [
				{ type: "rect", x: 0, y: 0, width: 50, height: 20, fill: "#2563eb" },
				{ type: "text", x: 10, y: 20, text: "Init", fill: "#ffffff" },
			],
		},
		{
			id: "s1",
			label: "Step 1",
			elements: [
				{ type: "rect", x: 0, y: 0, width: 100, height: 40, fill: "#16a34a" },
				{ type: "text", x: 10, y: 20, text: "Step 1", fill: "#ffffff" },
			],
		},
	],
});

describe("Visual Explanation Declarative Controls (Fix A)", () => {
	it("binds slider, toggle, and select state to SVG styles and CSS variables", () => {
		const stateValues = {
			step: 1,
			quantum: 6,
			grid: true,
			mode: "detailed",
		};

		const enhancedSvg = applyStateToSvg(MOCK_SVG, 1, stateValues);

		// CSS Variables injected
		assert.ok(enhancedSvg.includes("--ctrl-quantum: 6;"), "Must include --ctrl-quantum");
		assert.ok(enhancedSvg.includes("--param-quantum: 6;"), "Must include --param-quantum");
		assert.ok(enhancedSvg.includes("--ctrl-grid: 1;"), "Must include --ctrl-grid");

		// Toggle display rules injected
		assert.ok(enhancedSvg.includes('[data-toggle="grid"] { display: inline; }'), "Must show grid toggle");
		assert.ok(enhancedSvg.includes('[data-toggle-not="grid"] { display: none; }'), "Must hide inverted grid");

		// Select display rules injected
		assert.ok(
			enhancedSvg.includes('[data-select-mode="detailed"] { display: inline; }'),
			"Must show detailed select mode",
		);
		assert.ok(
			enhancedSvg.includes('[data-select-mode]:not([data-select-mode="detailed"]) { display: none; }'),
			"Must hide non-selected modes",
		);

		// Step rules injected
		assert.ok(enhancedSvg.includes('[data-step="1"] { opacity: 1;'), "Must highlight active step");
	});

	it("renders all supported button actions (play, pause, reset, step-forward, step-backward)", async () => {
		const artifact: VisualArtifact = {
			version: 1,
			id: "btn-actions-test",
			title: "Button Actions Test",
			renderer: "svg",
			source: MOCK_DECLARATIVE_JSON,
			presentation: "inline",
			initialState: { step: 0, clickCount: 0 },
			controls: [
				{ type: "button", id: "btn-play", label: "Play", action: "play" },
				{ type: "button", id: "btn-pause", label: "Pause", action: "pause" },
				{ type: "button", id: "btn-reset", label: "Reset", action: "reset" },
				{ type: "button", id: "btn-fwd", label: "Next", action: "step-forward" },
				{ type: "button", id: "btn-back", label: "Prev", action: "step-backward" },
			],
		};

		const dom = parseHTML("<!doctype html><html><body><div id='root'></div></body></html>");
		const globals = {
			window: dom.window,
			document: dom.document,
			HTMLElement: dom.window.HTMLElement,
			HTMLButtonElement: dom.window.HTMLButtonElement,
			IS_REACT_ACT_ENVIRONMENT: true,
		};
		Object.assign(globalThis, globals);

		const { createRoot } = await import("react-dom/client");
		const root = createRoot(dom.document.querySelector("#root")!);

		await act(async () => {
			root.render(<VisualExplanationInstance artifact={artifact} />);
		});

		// Verify every button control is rendered with proper testid and action
		const playBtn = dom.document.querySelector('[data-testid="visual-control-button-btn-play"]');
		assert.ok(playBtn, "Play button must be rendered");
		assert.equal(playBtn.getAttribute("data-action"), "play");

		const pauseBtn = dom.document.querySelector('[data-testid="visual-control-button-btn-pause"]');
		assert.ok(pauseBtn, "Pause button must be rendered");
		assert.equal(pauseBtn.getAttribute("data-action"), "pause");

		const resetBtn = dom.document.querySelector('[data-testid="visual-control-button-btn-reset"]');
		assert.ok(resetBtn, "Reset button must be rendered");
		assert.equal(resetBtn.getAttribute("data-action"), "reset");

		const fwdBtn = dom.document.querySelector('[data-testid="visual-control-button-btn-fwd"]');
		assert.ok(fwdBtn, "Step forward button must be rendered");
		assert.equal(fwdBtn.getAttribute("data-action"), "step-forward");

		const backBtn = dom.document.querySelector('[data-testid="visual-control-button-btn-back"]');
		assert.ok(backBtn, "Step backward button must be rendered");
		assert.equal(backBtn.getAttribute("data-action"), "step-backward");
	});

	it("preserves compatible user state across artifact updates without resetting learner input (Fix B)", () => {
		const previousState = {
			step: 2,
			sliderParam: 45,
			toggleParam: true,
			unrelatedField: "keep-me",
		};

		const updatedArtifact: VisualArtifact = {
			version: 1,
			id: "test-compat-id",
			title: "Updated Schema",
			renderer: "svg",
			source: MOCK_DECLARATIVE_JSON,
			presentation: "inline",
			initialState: { step: 0, newParam: "fresh" },
			controls: [
				{ type: "button", id: "btn-next", label: "Next", action: "step-forward" },
				{ type: "button", id: "btn-prev", label: "Prev", action: "step-backward" },
			],
		};

		const preserved = preserveCompatibleState(previousState, updatedArtifact, 3);

		// Step preserved
		assert.equal(preserved.step, 2, "Learner's step position must be preserved");

		// New schema values populated
		assert.equal(preserved.newParam, "fresh", "New initialState values must be included");
	});

	it("clamps out-of-range state when updated schema contracts", () => {
		const previousState = {
			step: 10,
		};

		const restrictedArtifact: VisualArtifact = {
			version: 1,
			id: "test-restrict-id",
			title: "Restricted Schema",
			renderer: "svg",
			source: MOCK_DECLARATIVE_JSON,
			presentation: "inline",
			initialState: { step: 0 },
			controls: [
				{ type: "button", id: "btn-reset", label: "Reset", action: "reset" },
			],
		};

		const clamped = preserveCompatibleState(previousState, restrictedArtifact, 4);

		// Step clamped to new maxSteps (4)
		assert.equal(clamped.step, 4, "Step must be clamped to new maxSteps");
	});

	it("renders an in-place update notice instead of duplicate visualization when action is update (Fix B)", async () => {
		const baseArtifact: VisualArtifact = {
			version: 1,
			id: "pipeline-lifecycle",
			title: "Pipeline Simulation v1",
			renderer: "svg",
			source: MOCK_DECLARATIVE_JSON,
			presentation: "inline",
		};

		const updatedArtifact: VisualArtifact = {
			...baseArtifact,
			title: "Pipeline Simulation v2 (Hazards Highlighted)",
		};

		const dom = parseHTML("<!doctype html><html><body><div id='root'></div></body></html>");
		const globals = {
			window: dom.window,
			document: dom.document,
			HTMLElement: dom.window.HTMLElement,
			HTMLButtonElement: dom.window.HTMLButtonElement,
			IS_REACT_ACT_ENVIRONMENT: true,
		};
		Object.assign(globalThis, globals);

		const { createRoot } = await import("react-dom/client");
		const root = createRoot(dom.document.querySelector("#root")!);

		// Render create tool part
		await act(async () => {
			root.render(
				<div>
					<VisualExplanationCard
						part={{
							type: "tool-visual_explanation",
							state: "output-available",
							toolCallId: "call_create",
							output: { ok: true, action: "create", artifact: baseArtifact },
						}}
					/>
					<VisualExplanationCard
						part={{
							type: "tool-visual_explanation",
							state: "output-available",
							toolCallId: "call_update",
							output: { ok: true, action: "update", artifact: updatedArtifact },
						}}
					/>
				</div>,
			);
		});

		// The update part must render an update notice, NOT a second independent SVG container
		const updateNotice = dom.document.querySelector('[data-testid="visual-explanation-update-notice"]');
		assert.ok(updateNotice, "Update notice must be rendered for action: update");
		assert.ok(updateNotice.textContent?.includes("Pipeline Simulation v2"));

		// There should only be ONE full visual explanation card instance rendered
		const cards = dom.document.querySelectorAll('[data-testid="visual-explanation-card"]');
		assert.equal(cards.length, 1, "Only one full visual card must exist; update is in-place");
	});

	it("sanitizes dynamic control values to prevent CSS injection (Fix B)", () => {
		// Test values with quotes, semicolons, brackets, and url/expression keywords
		const maliciousValues = {
			"safe-id": 'blue"; } body { background: red; } /*',
			"url-attempt": 'url(https://evil.com/leak.png)',
			"expr-attempt": 'expression(alert(1))',
			"brace-attempt": '10px; fill: red;',
			"valid-mode": 'dark',
		};

		const enhanced = applyStateToSvg(MOCK_SVG, 0, maliciousValues);

		// Assert that control injection tokens (; { } url expression) are neutralized
		assert.ok(!enhanced.includes("background: red"), "Must not allow CSS rule breakout");
		assert.ok(!enhanced.includes("https://evil.com"), "Must not allow injected URLs");
		assert.ok(!enhanced.includes("expression("), "Must not allow expression execution");

		// Valid values must still be included
		assert.ok(enhanced.includes("--ctrl-valid-mode: dark;"));
		assert.ok(enhanced.includes('[data-select-valid-mode="dark"]'));
	});

	it("verifies behavioral state transitions for deterministic button controls (Fix E)", async () => {
		const artifact: VisualArtifact = {
			version: 1,
			id: "interactive-behavior-test",
			title: "Behavioral Interactive Test",
			renderer: "svg",
			source: MOCK_DECLARATIVE_JSON,
			presentation: "inline",
			initialState: {
				step: 0,
			},
			controls: [
				{ type: "button", id: "btn-step-fwd", label: "Step Forward", action: "step-forward" },
				{ type: "button", id: "btn-step-back", label: "Step Backward", action: "step-backward" },
				{ type: "button", id: "btn-reset", label: "Reset", action: "reset" },
			],
		};

		const dom = parseHTML("<!doctype html><html><body><div id='root'></div></body></html>");
		const globals = {
			window: dom.window,
			document: dom.document,
			HTMLElement: dom.window.HTMLElement,
			HTMLButtonElement: dom.window.HTMLButtonElement,
			IS_REACT_ACT_ENVIRONMENT: true,
		};
		Object.assign(globalThis, globals);

		const { createRoot } = await import("react-dom/client");
		const root = createRoot(dom.document.querySelector("#root")!);

		await act(async () => {
			root.render(<VisualExplanationInstance artifact={artifact} />);
		});

		// 1. Verify no slider, toggle, or select controls exist
		assert.equal(dom.document.querySelectorAll('input[type="range"]').length, 0, "No slider controls must exist");
		assert.equal(dom.document.querySelectorAll('input[type="checkbox"]').length, 0, "No toggle controls must exist");
		assert.equal(dom.document.querySelectorAll("select").length, 0, "No select controls must exist");

		// 2. Custom button behavioral test: click custom step-forward button
		const customStepFwd = dom.document.querySelector<HTMLButtonElement>('[data-testid="visual-control-button-btn-step-fwd"]');
		assert.ok(customStepFwd, "Custom step forward button must exist");
		await act(async () => {
			customStepFwd.click();
		});

		let indicator = dom.document.querySelector('[data-testid="visual-step-indicator"]');
		assert.ok(indicator?.textContent?.includes("Step 1 / 1"), "Step must increment to 1");

		// 3. Custom button behavioral test: click custom step-backward button
		const customStepBack = dom.document.querySelector<HTMLButtonElement>('[data-testid="visual-control-button-btn-step-back"]');
		assert.ok(customStepBack, "Custom step backward button must exist");
		await act(async () => {
			customStepBack.click();
		});

		indicator = dom.document.querySelector('[data-testid="visual-step-indicator"]');
		assert.ok(indicator?.textContent?.includes("Step 0 / 1"), "Step must decrement to 0");

		// 4. Standard toolbar step-forward button
		const toolbarStepFwd = dom.document.querySelector<HTMLButtonElement>('[data-testid="visual-control-step-forward"]');
		assert.ok(toolbarStepFwd);
		await act(async () => {
			toolbarStepFwd.click();
		});
		indicator = dom.document.querySelector('[data-testid="visual-step-indicator"]');
		assert.ok(indicator?.textContent?.includes("Step 1 / 1"), "Toolbar step-forward increments step");

		// 5. Custom reset button
		const resetBtn = dom.document.querySelector<HTMLButtonElement>('[data-testid="visual-control-button-btn-reset"]');
		assert.ok(resetBtn);
		await act(async () => {
			resetBtn.click();
		});
		indicator = dom.document.querySelector('[data-testid="visual-step-indicator"]');
		assert.ok(indicator?.textContent?.includes("Step 0 / 1"), "Step must reset to 0");

		await act(async () => {
			root.unmount();
		});
	});

	it("manages registry lifecycle, Strict Mode, and unmount cleanup without leaks (Fix C)", async () => {
		clearVisualArtifactRegistry();
		assert.equal(getVisualArtifactRegistrySize(), 0, "Registry must start empty");

		const artifact: VisualArtifact = {
			version: 1,
			id: "lifecycle-card-id",
			title: "Lifecycle Card",
			renderer: "svg",
			source: MOCK_DECLARATIVE_JSON,
			presentation: "inline",
		};

		const dom = parseHTML("<!doctype html><html><body><div id='root'></div></body></html>");
		const globals = {
			window: dom.window,
			document: dom.document,
			HTMLElement: dom.window.HTMLElement,
			HTMLButtonElement: dom.window.HTMLButtonElement,
			IS_REACT_ACT_ENVIRONMENT: true,
		};
		Object.assign(globalThis, globals);

		const { createRoot } = await import("react-dom/client");
		const root = createRoot(dom.document.querySelector("#root")!);

		// Mount inside React.StrictMode
		await act(async () => {
			root.render(
				<React.StrictMode>
					<VisualExplanationInstance artifact={artifact} />
				</React.StrictMode>,
			);
		});

		assert.equal(getVisualArtifactRegistrySize(), 1, "Registry must hold exactly one entry for mounted artifact");

		// Unmount the component completely
		await act(async () => {
			root.unmount();
		});

		// Entry must be cleaned up after all listeners unmount
		assert.equal(getVisualArtifactRegistrySize(), 0, "Registry entry must be removed after component unmounts");
	});

	it("reactively updates mounted cards in-place across SVG/HTML transitions and rapid updates (Fix F)", async () => {
		clearVisualArtifactRegistry();

		const svgArtifactV1: VisualArtifact = {
			version: 1,
			id: "reactive-switch-sim",
			title: "Reactive Sim V1 (SVG)",
			renderer: "svg",
			source: JSON.stringify({
				schema: "learnharness.visual.svg.v1",
				viewBox: { width: 100, height: 100 },
				steps: [{ id: "s1", label: "S1", elements: [{ type: "rect", x: 10, y: 10, width: 80, height: 40, fill: "#2563eb" }] }],
			}),
			presentation: "inline",
			initialState: { step: 0 },
			controls: [{ type: "button", id: "btn-play", label: "Play", action: "play" }],
		};

		const svgArtifactV2: VisualArtifact = {
			...svgArtifactV1,
			title: "Reactive Sim V2 (SVG Updated)",
			source: JSON.stringify({
				schema: "learnharness.visual.svg.v1",
				viewBox: { width: 100, height: 100 },
				steps: [{ id: "s1", label: "S1", elements: [{ type: "circle", cx: 50, cy: 50, r: 40, fill: "#16a34a" }] }],
			}),
		};

		const svgArtifactV3: VisualArtifact = {
			...svgArtifactV1,
			title: "Reactive Sim V3 (SVG Line)",
			source: JSON.stringify({
				schema: "learnharness.visual.svg.v1",
				viewBox: { width: 100, height: 100 },
				steps: [{ id: "s1", label: "S1", elements: [{ type: "line", x1: 0, y1: 0, x2: 100, y2: 100, stroke: "#dc2626" }] }],
			}),
		};

		const dom = parseHTML("<!doctype html><html><body><div id='root'></div></body></html>");
		const globals = {
			window: dom.window,
			document: dom.document,
			HTMLElement: dom.window.HTMLElement,
			HTMLButtonElement: dom.window.HTMLButtonElement,
			IS_REACT_ACT_ENVIRONMENT: true,
		};
		Object.assign(globalThis, globals);

		const { createRoot } = await import("react-dom/client");
		const root = createRoot(dom.document.querySelector("#root")!);

		// 1. Mount Card initially with SVG v1
		await act(async () => {
			root.render(
				<VisualExplanationCard
					part={{
						type: "tool-visual_explanation",
						state: "output-available",
						toolCallId: "call_init",
						output: { ok: true, action: "create", artifact: svgArtifactV1 },
					}}
				/>,
			);
		});

		let titleEl = dom.document.querySelector('[data-testid="visual-explanation-card"] h4');
		assert.equal(titleEl?.textContent, "Reactive Sim V1 (SVG)");
		const getCardSvg = () => {
			const container = dom.document.querySelector('[data-testid="visual-explanation-declarative-container"]');
			return container?.innerHTML || "";
		};

		assert.ok(dom.document.querySelector('[data-testid="visual-explanation-declarative-container"]'), "Declarative container must be mounted");
		assert.equal(dom.document.querySelectorAll("iframe").length, 0);

		// 2. In-place reactive update SVG -> SVG (V1 -> V2)
		await act(async () => {
			registerVisualArtifact(svgArtifactV2);
		});

		titleEl = dom.document.querySelector('[data-testid="visual-explanation-card"] h4');
		assert.equal(titleEl?.textContent, "Reactive Sim V2 (SVG Updated)", "Title must reactively update in-place");
		assert.ok(getCardSvg().includes("<circle"), "SVG source must reflect V2 circle in-place");
		assert.equal(dom.document.querySelectorAll("iframe").length, 0, "Zero iframes throughout updates");

		// 3. In-place reactive update V2 -> V3
		await act(async () => {
			registerVisualArtifact(svgArtifactV3);
		});

		titleEl = dom.document.querySelector('[data-testid="visual-explanation-card"] h4');
		assert.equal(titleEl?.textContent, "Reactive Sim V3 (SVG Line)");
		assert.ok(getCardSvg().includes("<line"), "SVG source must reflect V3 line in-place");
		assert.equal(dom.document.querySelectorAll("iframe").length, 0);

		// 4. Rapid consecutive updates: test sequence
		await act(async () => {
			registerVisualArtifact({ ...svgArtifactV3, title: "Rapid Update 1" });
			registerVisualArtifact({ ...svgArtifactV3, title: "Rapid Update 2" });
			registerVisualArtifact({ ...svgArtifactV3, title: "Rapid Update Final" });
		});

		titleEl = dom.document.querySelector('[data-testid="visual-explanation-card"] h4');
		assert.equal(titleEl?.textContent, "Rapid Update Final", "Rapid consecutive updates must resolve to final state consistently");

		// Cleanup
		await act(async () => {
			root.unmount();
		});
		assert.equal(getVisualArtifactRegistrySize(), 0, "Registry must be clean after unmounting reactive test");
	});

	it("computeArtifactSignature captures full relevant content (Phase 6.3)", () => {
		const base: VisualArtifact = {
			version: 1,
			id: "sig-test-artifact",
			title: "Signature Test",
			renderer: "svg",
			source: '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="red"/></svg>',
			presentation: "inline",
			controls: [{ type: "button", id: "b1", label: "Button 1", action: "play" }],
			initialState: { step: 0 },
		};

		const sigBase = computeArtifactSignature(base);

		// Same length source, different content (e.g. fill="red" vs fill="blu")
		const sameLengthDiffContent: VisualArtifact = {
			...base,
			source: '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="blu"/></svg>',
		};
		assert.equal(base.source.length, sameLengthDiffContent.source.length);
		const sigSameLen = computeArtifactSignature(sameLengthDiffContent);
		assert.notEqual(sigBase, sigSameLen, "Signature must differ when source content differs despite same length");

		// Modified controls
		const diffControls: VisualArtifact = {
			...base,
			controls: [
				{ type: "button", id: "b1", label: "Button 1", action: "play" },
				{ type: "button", id: "b2", label: "Button 2", action: "pause" },
			],
		};
		assert.notEqual(sigBase, computeArtifactSignature(diffControls), "Signature must differ when controls change");

		// Modified initialState
		const diffState: VisualArtifact = {
			...base,
			initialState: { step: 1 },
		};
		assert.notEqual(sigBase, computeArtifactSignature(diffState), "Signature must differ when initialState changes");

		// Modified presentation
		const diffPresentation: VisualArtifact = {
			...base,
			presentation: "panel",
		};
		assert.notEqual(sigBase, computeArtifactSignature(diffPresentation), "Signature must differ when presentation changes");
	});

	it("Phase 6.4: computeArtifactSignature uses structured serialization to eliminate delimiter collisions (Section 3.3)", () => {
		// Old legacy concatenation logic for comparison:
		const legacyComputeSignature = (artifact: VisualArtifact) => [
			artifact.id,
			artifact.version,
			artifact.renderer,
			artifact.presentation ?? "auto",
			artifact.title,
			artifact.summary ?? "",
			artifact.source,
			JSON.stringify(artifact.controls ?? []),
			JSON.stringify(artifact.initialState ?? {}),
			JSON.stringify(artifact.accessibility ?? {}),
		].join("::");

		// Artifact 1 has title with delimiter "Sim::Part2" and summary "Overview"
		const artifact1: VisualArtifact = {
			version: 1,
			id: "sig-collision-test",
			title: "Sim::Part2",
			summary: "Overview",
			renderer: "svg",
			source: '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>',
			presentation: "inline",
			controls: [{ type: "button", id: "btn", label: "Go", action: "play" }],
			initialState: { step: 0 },
			accessibility: { description: "Accessible sim" },
		};

		// Artifact 2 has title "Sim" and summary "Part2::Overview"
		const artifact2: VisualArtifact = {
			...artifact1,
			title: "Sim",
			summary: "Part2::Overview",
		};

		// 1. Demonstrate the legacy concatenation collision flaw:
		const legacySig1 = legacyComputeSignature(artifact1);
		const legacySig2 = legacyComputeSignature(artifact2);
		assert.equal(legacySig1, legacySig2, "Legacy concatenation flaw: distinct artifacts produced identical signature");

		// 2. Demonstrate that the new structured serialization properly distinguishes them:
		const newSig1 = computeArtifactSignature(artifact1);
		const newSig2 = computeArtifactSignature(artifact2);
		assert.notEqual(newSig1, newSig2, "New structured signature must produce distinct signatures despite delimiter overlap");

		// 3. Verify identical artifacts produce identical signature:
		const artifact1Clone: VisualArtifact = JSON.parse(JSON.stringify(artifact1));
		assert.equal(computeArtifactSignature(artifact1), computeArtifactSignature(artifact1Clone), "Identical artifacts must produce the exact same signature");

		// 4. Verify modifications to all critical fields continue to be detected:
		assert.notEqual(
			computeArtifactSignature(artifact1),
			computeArtifactSignature({ ...artifact1, source: '<svg xmlns="http://www.w3.org/2000/svg"><circle/></svg>' }),
			"Source modification must be detected",
		);

		assert.notEqual(
			computeArtifactSignature(artifact1),
			computeArtifactSignature({ ...artifact1, controls: [] }),
			"Controls modification must be detected",
		);

		assert.notEqual(
			computeArtifactSignature(artifact1),
			computeArtifactSignature({ ...artifact1, initialState: { step: 1 } }),
			"InitialState modification must be detected",
		);

		assert.notEqual(
			computeArtifactSignature(artifact1),
			computeArtifactSignature({ ...artifact1, presentation: "panel" }),
			"Presentation modification must be detected",
		);

		assert.notEqual(
			computeArtifactSignature(artifact1),
			computeArtifactSignature({ ...artifact1, accessibility: { description: "Updated accessible description" } }),
			"Accessibility modification must be detected",
		);
	});

	it("reactively updates mounted card in-place when source changes with identical length or controls change (Phase 6.3)", async () => {
		clearVisualArtifactRegistry();

		const initialDoc = {
			schema: "learnharness.visual.svg.v1" as const,
			viewBox: { width: 100, height: 100 },
			steps: [{ id: "s1", label: "S1", elements: [{ type: "rect" as const, x: 0, y: 0, width: 20, height: 20, fill: "red" }] }],
		};
		const initialJson = JSON.stringify(initialDoc);

		const initialArtifact: VisualArtifact = {
			version: 1,
			id: "in-place-adversarial-id",
			title: "Unchanged Title",
			renderer: "svg",
			source: initialJson,
			presentation: "inline",
			controls: [{ type: "button", id: "btn-start", label: "Start", action: "play" }],
		};

		// Same id, same version, same title, EXACT SAME source length, different SVG fill
		const updatedDocSameLen = {
			schema: "learnharness.visual.svg.v1" as const,
			viewBox: { width: 100, height: 100 },
			steps: [{ id: "s1", label: "S1", elements: [{ type: "rect" as const, x: 0, y: 0, width: 20, height: 20, fill: "blu" }] }],
		};
		const updatedJsonSameLen = JSON.stringify(updatedDocSameLen);
		assert.equal(initialJson.length, updatedJsonSameLen.length, "Source lengths must be identical for adversarial test");

		const updatedArtifactSameLen: VisualArtifact = {
			version: 1,
			id: "in-place-adversarial-id",
			title: "Unchanged Title",
			renderer: "svg",
			source: updatedJsonSameLen,
			presentation: "inline",
			controls: [{ type: "button", id: "btn-start", label: "Start", action: "play" }],
		};

		const dom = parseHTML("<!doctype html><html><body><div id='root'></div></body></html>");
		const globals = {
			window: dom.window,
			document: dom.document,
			HTMLElement: dom.window.HTMLElement,
			HTMLButtonElement: dom.window.HTMLButtonElement,
			IS_REACT_ACT_ENVIRONMENT: true,
		};
		Object.assign(globalThis, globals);

		const { createRoot } = await import("react-dom/client");
		const root = createRoot(dom.document.querySelector("#root")!);

		// 1. Mount initial card
		await act(async () => {
			root.render(
				<div id="container">
					<VisualExplanationCard
						part={{
							type: "tool-visual_explanation",
							state: "output-available",
							toolCallId: "call_init",
							output: { ok: true, action: "create", artifact: initialArtifact },
						}}
					/>
				</div>,
			);
		});

		const getCardContent = () => {
			const container = dom.document.querySelector('[data-testid="visual-explanation-declarative-container"]');
			return container?.innerHTML || "";
		};

		assert.ok(getCardContent().includes('fill="red"'), "Initial card must render red rect");
		assert.equal(dom.document.querySelectorAll('[data-testid="visual-control-button-btn-start"]').length, 1);

		// 2. Render update notice with same length but different SVG fill
		await act(async () => {
			root.render(
				<div id="container">
					<VisualExplanationCard
						part={{
							type: "tool-visual_explanation",
							state: "output-available",
							toolCallId: "call_init",
							output: { ok: true, action: "create", artifact: initialArtifact },
						}}
					/>
					<VisualExplanationCard
						part={{
							type: "tool-visual_explanation",
							state: "output-available",
							toolCallId: "call_update_same_len",
							output: { ok: true, action: "update", artifact: updatedArtifactSameLen },
						}}
					/>
				</div>,
			);
		});

		// Must reflect in-place update in the mounted viewer
		assert.ok(getCardContent().includes('fill="blu"'), "Mounted card must reactively update to blue rect even with same source length");
		assert.ok(!getCardContent().includes('fill="red"'), "Old source must no longer be present");

		// 3. Render update notice with modified controls (adding a pause button)
		const updatedArtifactWithControls: VisualArtifact = {
			...updatedArtifactSameLen,
			controls: [
				{ type: "button", id: "btn-start", label: "Start", action: "play" },
				{ type: "button", id: "btn-stop", label: "Stop", action: "pause" },
			],
		};

		await act(async () => {
			root.render(
				<div id="container">
					<VisualExplanationCard
						part={{
							type: "tool-visual_explanation",
							state: "output-available",
							toolCallId: "call_init",
							output: { ok: true, action: "create", artifact: initialArtifact },
						}}
					/>
					<VisualExplanationCard
						part={{
							type: "tool-visual_explanation",
							state: "output-available",
							toolCallId: "call_update_ctrls",
							output: { ok: true, action: "update", artifact: updatedArtifactWithControls },
						}}
					/>
				</div>,
			);
		});

		assert.ok(dom.document.querySelector('[data-testid="visual-control-button-btn-stop"]'), "Mounted card must reactively display newly added control");

		// Cleanup
		await act(async () => {
			root.unmount();
		});
		assert.equal(getVisualArtifactRegistrySize(), 0, "Registry must be clean after unmounting");
	});
});
