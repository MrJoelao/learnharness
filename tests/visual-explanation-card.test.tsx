/**
 * Tests for Visual Explanation Card Component — Inline, Panel, Controls, Accessibility (Phase 6)
 */

import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
	VisualExplanationCard,
	VisualExplanationInstance,
	countSvgSteps,
	applyStepToSvg,
} from "../components/artifacts/visual-explanation-card.tsx";
import { ToolPartRenderer } from "../components/plugin-renderers.tsx";
import type { VisualArtifact } from "../src/core/contracts/visual-explanation.ts";
import type { LhViewPart } from "../src/core/view.ts";

const TEST_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 150">
  <g data-step="0"><rect width="100" height="40" fill="#blue"/><text x="10" y="20">Step 0</text></g>
  <g data-step="1"><rect width="100" height="40" fill="#green"/><text x="10" y="20">Step 1</text></g>
  <g data-step="2"><rect width="100" height="40" fill="#red"/><text x="10" y="20">Step 2</text></g>
</svg>
`.trim();

describe("Visual Explanation Card Component", () => {
	it("renders an inline SVG visual explanation card with title, summary and controls", () => {
		const artifact: VisualArtifact = {
			version: 1,
			id: "sched-rr",
			title: "Round Robin Scheduling",
			summary: "Quantum = 4ms round robin simulation",
			renderer: "svg",
			source: TEST_SVG,
			presentation: "inline",
			initialState: { step: 0, maxSteps: 2 },
			controls: [
				{ type: "button", id: "btn-step", label: "Next", action: "step-forward" },
				{ type: "slider", id: "quantum", label: "Quantum", min: 1, max: 10, value: 4 },
				{ type: "toggle", id: "preempt", label: "Preemption", value: true },
			],
			accessibility: {
				description: "A timeline diagram showing processes cycling through CPU burst slices.",
				reducedMotionFallback: true,
			},
		};

		const html = renderToStaticMarkup(
			<VisualExplanationCard
				part={{
					type: "tool-visual_explanation",
					state: "output-available",
					toolCallId: "call_visual_1",
					output: { ok: true, artifact },
				}}
			/>,
		);

		assert.ok(html.includes("Round Robin Scheduling"), "Title must render");
		assert.ok(html.includes("Quantum = 4ms round robin simulation"), "Summary must render");
		assert.ok(html.includes('data-testid="visual-explanation-card"'), "Container must render");
		assert.ok(html.includes('data-artifact-id="sched-rr"'), "Artifact ID attribute must render");
		assert.ok(html.includes('aria-label="Step forward"'), "Step forward button must render");
		assert.ok(html.includes('aria-label="Step backward"'), "Step backward button must render");
		assert.ok(html.includes('aria-label="Reset visualization"'), "Reset button must render");
		assert.ok(html.includes('aria-label="Expand visual to panel"'), "Expand button must render");
		assert.ok(html.includes('type="range"'), "Slider control must render");
		assert.ok(html.includes('type="checkbox"'), "Toggle control must render");
		assert.ok(html.includes("A timeline diagram showing processes cycling"), "Accessibility description must render");
	});

	it("renders expanded panel modal when presentation is 'panel' or expanded", () => {
		const artifact: VisualArtifact = {
			version: 1,
			id: "mem-panel",
			title: "Memory Mapping Panel",
			summary: "Full screen virtual memory inspect",
			renderer: "svg",
			source: TEST_SVG,
			presentation: "panel",
		};

		const html = renderToStaticMarkup(
			<VisualExplanationInstance artifact={artifact} initialExpanded={true} />,
		);

		assert.ok(html.includes('data-testid="visual-explanation-panel"'), "Panel modal must render");
		assert.ok(html.includes('role="dialog"'), "Modal must have dialog role");
		assert.ok(html.includes('aria-modal="true"'), "Modal must have aria-modal=true");
		assert.ok(html.includes('aria-label="Close panel"'), "Close button must render");
	});

	it("renders a sandboxed iframe when renderer is 'html'", () => {
		const artifact: VisualArtifact = {
			version: 1,
			id: "html-sim",
			title: "Cache Coherence State Machine",
			renderer: "html",
			source: "<div class='cache-state'>MESI Protocol: Invalid -&gt; Shared</div>",
			presentation: "inline",
		};

		const html = renderToStaticMarkup(
			<VisualExplanationInstance artifact={artifact} initialExpanded={false} />,
		);

		assert.ok(html.includes("<iframe"), "Must render iframe for HTML renderer");
		assert.ok(html.includes('sandbox="allow-scripts"'), "Iframe must be sandboxed");
		assert.ok(!html.includes("allow-same-origin"), "Iframe must NOT have allow-same-origin");
		assert.ok(html.includes("Content-Security-Policy"), "CSP header must be present in srcdoc");
	});

	it("renders graceful error alert for malformed or failed artifacts without breaking", () => {
		const html = renderToStaticMarkup(
			<VisualExplanationCard
				part={{
					type: "tool-visual_explanation",
					state: "output-error",
					toolCallId: "call_failed_1",
					output: { ok: false },
				}}
			/>,
		);

		assert.ok(html.includes('data-testid="visual-explanation-failed"'), "Failed card must render");
		assert.ok(html.includes('role="alert"'), "Failure must have alert role");
		assert.ok(html.includes("Visual explanation unavailable"), "Must indicate visual explanation unavailable");
	});

	it("correctly extracts maxSteps and applies step-based visibility styles to SVG", () => {
		assert.equal(countSvgSteps(TEST_SVG), 2);
		assert.equal(countSvgSteps("<svg><rect/></svg>"), 0);

		const steppedSvg = applyStepToSvg(TEST_SVG, 1);
		assert.ok(steppedSvg.includes('[data-step="1"]'), "Must target active step in CSS");
		assert.ok(steppedSvg.includes('[data-step]:not([data-step="1"])'), "Must fade inactive steps in CSS");
	});

	it("integrates seamlessly into ToolPartRenderer via artifactRenderers", () => {
		const artifact: VisualArtifact = {
			version: 1,
			id: "integration-test",
			title: "Tree Balancing",
			renderer: "svg",
			source: TEST_SVG,
			presentation: "inline",
		};

		const part: LhViewPart = {
			type: "tool-visual_explanation",
			state: "output-available",
			toolCallId: "call_tree_1",
			output: { ok: true, artifact },
		};

		const html = renderToStaticMarkup(<ToolPartRenderer part={part} />);
		assert.ok(html.includes("Tree Balancing"), "ToolPartRenderer must render VisualExplanationCard");
		assert.ok(html.includes('data-testid="visual-explanation-card"'), "VisualExplanationCard test ID present");
	});
});
