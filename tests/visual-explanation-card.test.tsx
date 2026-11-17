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

const TEST_DECLARATIVE_DOC = {
	schema: "learnharness.visual.svg.v1" as const,
	viewBox: { x: 0, y: 0, width: 300, height: 150 },
	steps: [
		{
			id: "s0",
			label: "Step 0",
			elements: [
				{ type: "rect" as const, x: 0, y: 0, width: 100, height: 40, fill: "#2563eb" },
				{ type: "text" as const, x: 10, y: 20, text: "Step 0", fill: "#ffffff" },
			],
		},
		{
			id: "s1",
			label: "Step 1",
			elements: [
				{ type: "rect" as const, x: 0, y: 0, width: 100, height: 40, fill: "#16a34a" },
				{ type: "text" as const, x: 10, y: 20, text: "Step 1", fill: "#ffffff" },
			],
		},
		{
			id: "s2",
			label: "Step 2",
			elements: [
				{ type: "rect" as const, x: 0, y: 0, width: 100, height: 40, fill: "#dc2626" },
				{ type: "text" as const, x: 10, y: 20, text: "Step 2", fill: "#ffffff" },
			],
		},
	],
};
const TEST_DECLARATIVE_JSON = JSON.stringify(TEST_DECLARATIVE_DOC);

describe("Visual Explanation Card Component", () => {
	it("renders an inline SVG visual explanation card with title, summary and controls", () => {
		const artifact: VisualArtifact = {
			version: 1,
			id: "sched-rr",
			title: "Round Robin Scheduling",
			summary: "Quantum = 4ms round robin simulation",
			renderer: "svg",
			source: TEST_DECLARATIVE_JSON,
			presentation: "inline",
			initialState: { step: 0, maxSteps: 2 },
			controls: [
				{ type: "button", id: "btn-step", label: "Next", action: "step-forward" },
				{ type: "button", id: "btn-prev", label: "Back", action: "step-backward" },
				{ type: "button", id: "btn-rst", label: "Restart", action: "reset" },
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
		assert.ok(html.includes('data-testid="visual-control-button-btn-step"'), "Custom button must render");
		assert.ok(!html.includes('type="range"'), "Slider control must not exist in MVP v1");
		assert.ok(!html.includes('type="checkbox"'), "Toggle control must not exist in MVP v1");
		assert.ok(html.includes("A timeline diagram showing processes cycling"), "Accessibility description must render");
	});

	it("renders expanded panel modal when presentation is 'panel' or expanded", () => {
		const artifact: VisualArtifact = {
			version: 1,
			id: "mem-panel",
			title: "Memory Mapping Panel",
			summary: "Full screen virtual memory inspect",
			renderer: "svg",
			source: TEST_DECLARATIVE_JSON,
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

	it("rejects HTML visual artifacts and never renders an iframe", () => {
		const htmlArtifact = {
			version: 1,
			id: "html-sim",
			title: "Cache Coherence State Machine",
			renderer: "html",
			source: "<div class='cache-state'>MESI Protocol: Invalid -&gt; Shared</div>",
			presentation: "inline",
		};

		const html = renderToStaticMarkup(
			<VisualExplanationCard
				part={{
					type: "tool-visual_explanation",
					state: "output-available",
					toolCallId: "call_html_1",
					output: { ok: true, artifact: htmlArtifact as unknown as VisualArtifact },
				}}
			/>,
		);

		assert.ok(html.includes('data-testid="visual-explanation-failed"'), "HTML renderer must trigger failure alert");
		assert.ok(!html.includes("<iframe"), "No iframe must ever be rendered for visual explanations");
		assert.ok(html.includes("Visual explanation unavailable"), "Must inform that visual explanation is unavailable");
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
			source: TEST_DECLARATIVE_JSON,
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

	it("strictly rejects raw SVG XML through VisualExplanationCard and renders error alert", () => {
		const rawSvgArtifact = {
			version: 1,
			id: "raw-svg-sched",
			title: "Raw SVG Diagram",
			renderer: "svg",
			source: TEST_SVG,
			presentation: "inline",
		};

		const html = renderToStaticMarkup(
			<VisualExplanationCard
				part={{
					type: "tool-visual_explanation",
					state: "output-available",
					toolCallId: "call_raw_svg",
					output: { ok: true, artifact: rawSvgArtifact as unknown as VisualArtifact },
				}}
			/>,
		);

		assert.ok(html.includes('data-testid="visual-explanation-failed"'), "Must render failed alert");
		assert.ok(html.includes("Raw SVG XML is not permitted"), "Error must state raw SVG XML is not permitted");
		assert.ok(!html.includes("<iframe"), "No iframe must be rendered");
	});

	it("renders download button for SVG artifacts and verifies no iframe is created", () => {
		const artifact: VisualArtifact = {
			version: 1,
			id: "download-test",
			title: "Memory Flow Diagram",
			renderer: "svg",
			source: TEST_DECLARATIVE_JSON,
			presentation: "inline",
		};

		const html = renderToStaticMarkup(
			<VisualExplanationInstance artifact={artifact} initialExpanded={false} />,
		);

		assert.ok(html.includes('data-testid="visual-download-button"'), "Download button must render");
		assert.ok(html.includes('aria-label="Download visual artifact"'), "Download button must have aria-label");
		assert.ok(!html.includes("<iframe"), "No iframe present");
	});

	it("RUN 3.2: VisualExplanationInstance boundary rejects raw SVG XML and renders error alert without mounting SvgImage or iframe", () => {
		const rawSvgArtifact: VisualArtifact = {
			version: 1,
			id: "direct-raw-svg",
			title: "Direct Raw SVG Test",
			renderer: "svg",
			source: TEST_SVG,
			presentation: "inline",
		};

		const html = renderToStaticMarkup(
			<VisualExplanationInstance artifact={rawSvgArtifact} />,
		);

		assert.ok(html.includes('data-testid="visual-explanation-failed"'), "Must render failure alert");
		assert.ok(html.includes('role="alert"'), "Must have alert role");
		assert.ok(html.includes("Visual explanation unavailable"), "Must announce visual explanation unavailable");
		assert.ok(!html.includes('data-testid="visual-explanation-declarative-container"'), "Must not render declarative container");
		assert.ok(!html.includes('data-testid="visual-explanation-svg-container"'), "Must not render svg container");
		assert.ok(!html.includes("<iframe"), "Must never render iframe");
	});

	it("RUN 3.2: VisualExplanationInstance boundary rejects malformed JSON source", () => {
		const malformedArtifact: VisualArtifact = {
			version: 1,
			id: "direct-malformed-json",
			title: "Malformed JSON Test",
			renderer: "svg",
			source: "{ schema: 'learnharness.visual.svg.v1', invalidJson: ",
			presentation: "inline",
		};

		const html = renderToStaticMarkup(
			<VisualExplanationInstance artifact={malformedArtifact} />,
		);

		assert.ok(html.includes('data-testid="visual-explanation-failed"'), "Must render failure alert for malformed JSON");
		assert.ok(html.includes('role="alert"'), "Must have alert role");
		assert.ok(!html.includes("<iframe"), "Must never render iframe");
	});

	it("RUN 3.2: VisualExplanationInstance renders declarative container and zero iframes in inline and expanded modes", () => {
		const validArtifact: VisualArtifact = {
			version: 1,
			id: "decl-render-test",
			title: "Declarative Render Test",
			renderer: "svg",
			source: TEST_DECLARATIVE_JSON,
			presentation: "inline",
		};

		const inlineHtml = renderToStaticMarkup(
			<VisualExplanationInstance artifact={validArtifact} initialExpanded={false} />,
		);
		assert.ok(inlineHtml.includes('data-testid="visual-explanation-declarative-container"'), "Declarative container must render inline");
		assert.ok(!inlineHtml.includes("<iframe"), "Zero iframes inline");

		const panelHtml = renderToStaticMarkup(
			<VisualExplanationInstance artifact={validArtifact} initialExpanded={true} />,
		);
		assert.ok(panelHtml.includes('data-testid="visual-explanation-panel"'), "Panel modal must render");
		assert.ok(panelHtml.includes('data-testid="visual-explanation-declarative-container"'), "Declarative container must render in panel");
		assert.ok(!panelHtml.includes("<iframe"), "Zero iframes in panel");
	});
});
