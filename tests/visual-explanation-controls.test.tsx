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
});
