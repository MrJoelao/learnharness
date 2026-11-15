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

	it("renders all button actions (play, pause, reset, step-forward, step-backward, custom)", async () => {
		const artifact: VisualArtifact = {
			version: 1,
			id: "btn-actions-test",
			title: "Button Actions Test",
			renderer: "svg",
			source: MOCK_SVG,
			presentation: "inline",
			initialState: { step: 0, clickCount: 0 },
			controls: [
				{ type: "button", id: "btn-play", label: "Play", action: "play" },
				{ type: "button", id: "btn-pause", label: "Pause", action: "pause" },
				{ type: "button", id: "btn-reset", label: "Reset", action: "reset" },
				{ type: "button", id: "btn-fwd", label: "Next", action: "step-forward" },
				{ type: "button", id: "btn-back", label: "Prev", action: "step-backward" },
				{ type: "button", id: "btn-custom", label: "Trigger", action: "custom" },
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

		const customBtn = dom.document.querySelector('[data-testid="visual-control-button-btn-custom"]');
		assert.ok(customBtn, "Custom button must be rendered");
		assert.equal(customBtn.getAttribute("data-action"), "custom");
	});

	it("preserves compatible user state across artifact updates without resetting learner input (Fix B)", () => {
		const previousState = {
			step: 2,
			sliderParam: 45,
			toggleParam: true,
			selectParam: "mode-b",
			unrelatedField: "keep-me",
		};

		const updatedArtifact: VisualArtifact = {
			version: 1,
			id: "test-compat-id",
			title: "Updated Schema",
			renderer: "svg",
			source: MOCK_SVG,
			presentation: "inline",
			initialState: { step: 0, sliderParam: 10, newParam: "fresh" },
			controls: [
				{ type: "slider", id: "sliderParam", label: "Slider", min: 0, max: 100, value: 10 },
				{ type: "toggle", id: "toggleParam", label: "Toggle", value: false },
				{
					type: "select",
					id: "selectParam",
					label: "Select",
					options: [
						{ label: "A", value: "mode-a" },
						{ label: "B", value: "mode-b" },
					],
					value: "mode-a",
				},
			],
		};

		const preserved = preserveCompatibleState(previousState, updatedArtifact, 3);

		// Step preserved
		assert.equal(preserved.step, 2, "Learner's step position must be preserved");

		// Slider value preserved
		assert.equal(preserved.sliderParam, 45, "Learner's slider value must be preserved");

		// Toggle state preserved
		assert.equal(preserved.toggleParam, true, "Learner's toggle state must be preserved");

		// Select state preserved
		assert.equal(preserved.selectParam, "mode-b", "Learner's select state must be preserved");

		// New schema values populated
		assert.equal(preserved.newParam, "fresh", "New initialState values must be included");
	});

	it("clamps out-of-range state when updated schema contracts", () => {
		const previousState = {
			step: 10,
			sliderParam: 150,
			selectParam: "obsolete-mode",
		};

		const restrictedArtifact: VisualArtifact = {
			version: 1,
			id: "test-restrict-id",
			title: "Restricted Schema",
			renderer: "svg",
			source: MOCK_SVG,
			presentation: "inline",
			initialState: { step: 0, sliderParam: 5 },
			controls: [
				{ type: "slider", id: "sliderParam", label: "Slider", min: 0, max: 50, value: 5 },
				{
					type: "select",
					id: "selectParam",
					label: "Select",
					options: [{ label: "Valid Only", value: "valid-only" }],
					value: "valid-only",
				},
			],
		};

		const clamped = preserveCompatibleState(previousState, restrictedArtifact, 4);

		// Step clamped to new maxSteps (4)
		assert.equal(clamped.step, 4, "Step must be clamped to new maxSteps");

		// Slider clamped to max (50)
		assert.equal(clamped.sliderParam, 50, "Slider must be clamped to new max");

		// Incompatible select resets to schema default
		assert.equal(
			clamped.selectParam,
			undefined,
			"Incompatible option should not preserve invalid string",
		);
	});

	it("renders an in-place update notice instead of duplicate visualization when action is update (Fix B)", async () => {
		const baseArtifact: VisualArtifact = {
			version: 1,
			id: "pipeline-lifecycle",
			title: "Pipeline Simulation v1",
			renderer: "svg",
			source: MOCK_SVG,
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

	it("verifies behavioral state transitions for slider, toggle, select and buttons (Fix E)", async () => {
		const artifact: VisualArtifact = {
			version: 1,
			id: "interactive-behavior-test",
			title: "Behavioral Interactive Test",
			renderer: "svg",
			source: MOCK_SVG,
			presentation: "inline",
			initialState: {
				step: 0,
				volume: 20,
				grid: false,
				mode: "compact",
				customCount: 0,
			},
			controls: [
				{ type: "slider", id: "volume", label: "Volume", min: 0, max: 100, value: 20 },
				{ type: "toggle", id: "grid", label: "Show Grid", value: false },
				{
					type: "select",
					id: "mode",
					label: "Display Mode",
					value: "compact",
					options: [
						{ value: "compact", label: "Compact" },
						{ value: "detailed", label: "Detailed" },
					],
				},
				{ type: "button", id: "btn-custom", label: "Counter", action: "custom" },
			],
		};

		const dom = parseHTML("<!doctype html><html><body><div id='root'></div></body></html>");
		const globals = {
			window: dom.window,
			document: dom.document,
			HTMLElement: dom.window.HTMLElement,
			HTMLButtonElement: dom.window.HTMLButtonElement,
			HTMLInputElement: dom.window.HTMLInputElement,
			HTMLSelectElement: dom.window.HTMLSelectElement,
			IS_REACT_ACT_ENVIRONMENT: true,
		};
		Object.assign(globalThis, globals);

		const { createRoot } = await import("react-dom/client");
		const root = createRoot(dom.document.querySelector("#root")!);

		await act(async () => {
			root.render(<VisualExplanationInstance artifact={artifact} />);
		});

		// 1. Slider behavioral test: change slider value to 75
		const sliderInput = dom.document.querySelector<HTMLInputElement>('[data-testid="visual-control-slider-volume"]');
		assert.ok(sliderInput, "Slider input must exist");

		const getSvgContent = () => {
			const img = dom.document.querySelector('[data-testid="visual-explanation-svg-container"] img');
			return decodeURIComponent(img?.getAttribute("src") || "");
		};

		function triggerChangeEvent(el: HTMLElement, eventObj: unknown) {
			const reactKey = Object.keys(el).find((k) => k.startsWith("__reactProps"));
			if (reactKey && (el as Record<string, any>)[reactKey]?.onChange) {
				(el as Record<string, any>)[reactKey].onChange(eventObj);
			} else {
				el.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
			}
		}

		await act(async () => {
			sliderInput.value = "75";
			triggerChangeEvent(sliderInput, { target: { value: "75" } });
		});

		// Verify slider UI and SVG updated with new CSS variable
		assert.ok(getSvgContent().includes("--ctrl-volume: 75;"), "SVG must reflect new slider value in CSS variable");

		// 2. Toggle behavioral test: toggle grid checkbox on
		const toggleInput = dom.document.querySelector<HTMLInputElement>('[data-testid="visual-control-toggle-grid"]');
		assert.ok(toggleInput, "Toggle checkbox must exist");

		await act(async () => {
			toggleInput.checked = true;
			triggerChangeEvent(toggleInput, { target: { checked: true } });
		});

		assert.ok(getSvgContent().includes("--ctrl-grid: 1;"), "SVG must reflect toggle enabled in CSS variable");
		assert.ok(getSvgContent().includes('[data-toggle="grid"] { display: inline; }'), "Toggle inline rule must be active");

		// 3. Select behavioral test: change select option to "detailed"
		const selectEl = dom.document.querySelector<HTMLSelectElement>('[data-testid="visual-control-select-mode"]');
		assert.ok(selectEl, "Select element must exist");

		await act(async () => {
			triggerChangeEvent(selectEl, { target: { value: "detailed" } });
		});

		assert.ok(getSvgContent().includes("--ctrl-mode: detailed;"), "SVG must reflect select value in CSS variable");
		assert.ok(getSvgContent().includes('[data-select-mode="detailed"] { display: inline; }'), "Select display rule active");

		// 4. Button behavioral test: click step-forward button
		const stepFwdBtn = dom.document.querySelector<HTMLButtonElement>('[data-testid="visual-control-step-forward"]');
		assert.ok(stepFwdBtn);
		await act(async () => {
			stepFwdBtn.click();
		});

		let indicator = dom.document.querySelector('[data-testid="visual-step-indicator"]');
		assert.ok(indicator?.textContent?.includes("Step 1 / 1"), "Step must increment to 1");

		// Click step-backward button
		const stepBackBtn = dom.document.querySelector<HTMLButtonElement>('[data-testid="visual-control-step-backward"]');
		assert.ok(stepBackBtn);
		await act(async () => {
			stepBackBtn.click();
		});
		indicator = dom.document.querySelector('[data-testid="visual-step-indicator"]');
		assert.ok(indicator?.textContent?.includes("Step 0 / 1"), "Step must decrement to 0");

		// Click custom button: increments custom counter safely and deterministically
		const customBtn = dom.document.querySelector<HTMLButtonElement>('[data-testid="visual-control-button-btn-custom"]');
		assert.ok(customBtn);
		await act(async () => {
			customBtn.click();
		});
		assert.ok(getSvgContent().includes("--ctrl-btn-custom: 1;"), "Custom button action must update state deterministically");
	});

	it("manages registry lifecycle, Strict Mode, and unmount cleanup without leaks (Fix C)", async () => {
		clearVisualArtifactRegistry();
		assert.equal(getVisualArtifactRegistrySize(), 0, "Registry must start empty");

		const artifact: VisualArtifact = {
			version: 1,
			id: "lifecycle-card-id",
			title: "Lifecycle Card",
			renderer: "svg",
			source: MOCK_SVG,
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
			title: "Reactive Switch Sim V1 (SVG)",
			renderer: "svg",
			source: MOCK_SVG,
			presentation: "inline",
			initialState: { step: 0, speed: 50 },
			controls: [{ type: "slider", id: "speed", label: "Speed", min: 0, max: 100, value: 50 }],
		};

		const svgArtifactV2: VisualArtifact = {
			...svgArtifactV1,
			title: "Reactive Switch Sim V2 (SVG Updated)",
			source: '<svg xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="40"/></svg>',
		};

		const htmlArtifactV3: VisualArtifact = {
			version: 1,
			id: "reactive-switch-sim",
			title: "Reactive Switch Sim V3 (Switched to HTML)",
			renderer: "html",
			source: '<div id="html-content">Dynamic Canvas Sim</div>',
			presentation: "inline",
			initialState: { step: 0, speed: 50 },
		};

		const svgArtifactV4: VisualArtifact = {
			version: 1,
			id: "reactive-switch-sim",
			title: "Reactive Switch Sim V4 (Switched back to SVG)",
			renderer: "svg",
			source: '<svg xmlns="http://www.w3.org/2000/svg"><rect width="80" height="80"/></svg>',
			presentation: "inline",
		};

		const dom = parseHTML("<!doctype html><html><body><div id='root'></div></body></html>");
		const globals = {
			window: dom.window,
			document: dom.document,
			HTMLElement: dom.window.HTMLElement,
			HTMLButtonElement: dom.window.HTMLButtonElement,
			HTMLIFrameElement: dom.window.HTMLIFrameElement,
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
		assert.equal(titleEl?.textContent, "Reactive Switch Sim V1 (SVG)");
		const getCardSvg = () => {
			const img = dom.document.querySelector('[data-testid="visual-explanation-svg-container"] img');
			return decodeURIComponent(img?.getAttribute("src") || "");
		};

		assert.ok(dom.document.querySelector('[data-testid="visual-explanation-svg-container"]'), "SVG container must be mounted");
		assert.equal(dom.document.querySelectorAll("iframe").length, 0);

		// 2. In-place reactive update SVG -> SVG (V1 -> V2)
		await act(async () => {
			registerVisualArtifact(svgArtifactV2);
		});

		titleEl = dom.document.querySelector('[data-testid="visual-explanation-card"] h4');
		assert.equal(titleEl?.textContent, "Reactive Switch Sim V2 (SVG Updated)", "Title must reactively update in-place");
		assert.ok(getCardSvg().includes("<circle"), "SVG source must reflect V2 circle in-place");

		// 3. In-place reactive update SVG -> HTML (V2 -> V3)
		await act(async () => {
			registerVisualArtifact(htmlArtifactV3);
		});

		titleEl = dom.document.querySelector('[data-testid="visual-explanation-card"] h4');
		assert.equal(titleEl?.textContent, "Reactive Switch Sim V3 (Switched to HTML)");
		assert.equal(dom.document.querySelectorAll('[data-testid="visual-explanation-svg-container"]').length, 0);
		let iframes = dom.document.querySelectorAll("iframe");
		assert.equal(iframes.length, 1, "Must reactively transition to single sandboxed iframe");

		// 4. In-place reactive update HTML -> SVG (V3 -> V4)
		await act(async () => {
			registerVisualArtifact(svgArtifactV4);
		});

		titleEl = dom.document.querySelector('[data-testid="visual-explanation-card"] h4');
		assert.equal(titleEl?.textContent, "Reactive Switch Sim V4 (Switched back to SVG)");
		assert.equal(dom.document.querySelectorAll("iframe").length, 0, "Iframe must be removed when switching back to SVG");
		assert.ok(getCardSvg().includes("<rect"), "SVG source must reflect V4 rect in-place");

		// 5. Rapid consecutive updates: test sequence
		await act(async () => {
			registerVisualArtifact({ ...svgArtifactV4, title: "Rapid Update 1" });
			registerVisualArtifact({ ...svgArtifactV4, title: "Rapid Update 2" });
			registerVisualArtifact({ ...svgArtifactV4, title: "Rapid Update Final" });
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
			initialState: { step: 0, speed: 10 },
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
			initialState: { step: 0, speed: 20 },
		};
		assert.notEqual(sigBase, computeArtifactSignature(diffState), "Signature must differ when initialState changes");

		// Modified renderer
		const diffRenderer: VisualArtifact = {
			...base,
			renderer: "html",
		};
		assert.notEqual(sigBase, computeArtifactSignature(diffRenderer), "Signature must differ when renderer changes");
	});

	it("reactively updates mounted card in-place when source changes with identical length or controls change (Phase 6.3)", async () => {
		clearVisualArtifactRegistry();

		const initialArtifact: VisualArtifact = {
			version: 1,
			id: "in-place-adversarial-id",
			title: "Unchanged Title",
			renderer: "svg",
			source: '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="red" width="20"/></svg>',
			presentation: "inline",
			controls: [{ type: "button", id: "btn-start", label: "Start", action: "play" }],
		};

		// Same id, same version, same title, EXACT SAME source length (68 chars), different SVG fill
		const updatedArtifactSameLen: VisualArtifact = {
			version: 1,
			id: "in-place-adversarial-id",
			title: "Unchanged Title",
			renderer: "svg",
			source: '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="blu" width="20"/></svg>',
			presentation: "inline",
			controls: [{ type: "button", id: "btn-start", label: "Start", action: "play" }],
		};
		assert.equal(initialArtifact.source.length, updatedArtifactSameLen.source.length, "Source lengths must be identical for adversarial test");

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

		const getImgSrc = () => {
			const img = dom.document.querySelector('[data-testid="visual-explanation-svg-container"] img');
			return decodeURIComponent(img?.getAttribute("src") || "");
		};

		assert.ok(getImgSrc().includes('fill="red"'), "Initial card must render red rect");
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
		assert.ok(getImgSrc().includes('fill="blu"'), "Mounted card must reactively update to blue rect even with same source length");
		assert.ok(!getImgSrc().includes('fill="red"'), "Old source must no longer be present");

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
