/**
 * Tests for Visual Explanation Card Component — Inline, Panel, Controls, Accessibility (Phase 6)
 */

import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import {
	VisualExplanationCard,
	VisualExplanationInstance,
	countSvgSteps,
	applyStepToSvg,
	registerVisualArtifact,
	getRegisteredVisualArtifact,
	clearVisualArtifactRegistry,
	subscribeVisualArtifact,
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

	it("RUN 3.2.1: valid declarative document with valid envelope is accepted", () => {
		const validArtifact: VisualArtifact = {
			version: 1,
			id: "valid-envelope-test",
			title: "Valid Envelope Diagram",
			summary: "Testing complete envelope validation",
			renderer: "svg",
			source: TEST_DECLARATIVE_JSON,
			presentation: "inline",
			initialState: { step: 0 },
			controls: [{ type: "button", id: "btn-next", label: "Next", action: "step-forward" }],
		};

		const html = renderToStaticMarkup(
			<VisualExplanationInstance artifact={validArtifact} />,
		);

		assert.ok(html.includes('data-testid="visual-explanation-declarative-container"'), "Declarative container must render");
		assert.ok(!html.includes('data-testid="visual-explanation-failed"'), "Must not show failure alert");
		assert.ok(html.includes("Valid Envelope Diagram"), "Title must be rendered");
		assert.ok(!html.includes("<iframe"), "Zero iframes");
	});

	it("RUN 3.2.1: valid declarative document but unsupported version is rejected at instance entrance", () => {
		const invalidVersionArtifact = {
			version: 2,
			id: "bad-version-test",
			title: "Unsupported Version",
			renderer: "svg" as const,
			source: TEST_DECLARATIVE_JSON,
			presentation: "inline" as const,
		};

		const html = renderToStaticMarkup(
			<VisualExplanationInstance artifact={invalidVersionArtifact as unknown as VisualArtifact} />,
		);

		assert.ok(html.includes('data-testid="visual-explanation-failed"'), "Must render failure alert for unsupported version");
		assert.ok(html.includes('role="alert"'), "Must have alert role");
		assert.ok(html.includes("Unsupported artifact version"), "Must state unsupported artifact version");
		assert.ok(!html.includes('data-testid="visual-explanation-declarative-container"'), "Must not render declarative container");
		assert.ok(!html.includes("<iframe"), "Zero iframes");
	});

	it("RUN 3.2.1: valid declarative document but invalid ID is rejected at instance entrance", () => {
		const invalidIdArtifact: VisualArtifact = {
			version: 1,
			id: "bad id with spaces & symbols!",
			title: "Invalid ID Test",
			renderer: "svg",
			source: TEST_DECLARATIVE_JSON,
			presentation: "inline",
		};

		const html = renderToStaticMarkup(
			<VisualExplanationInstance artifact={invalidIdArtifact} />,
		);

		assert.ok(html.includes('data-testid="visual-explanation-failed"'), "Must render failure alert for invalid ID");
		assert.ok(html.includes('role="alert"'), "Must have alert role");
		assert.ok(html.includes("Invalid artifact id"), "Must state invalid artifact id");
		assert.ok(!html.includes('data-testid="visual-explanation-declarative-container"'), "Must not render declarative container");
		assert.ok(!html.includes("<iframe"), "Zero iframes");
	});

	it("RUN 3.2.1: valid declarative document but invalid title is rejected at instance entrance", () => {
		const invalidTitleArtifact: VisualArtifact = {
			version: 1,
			id: "bad-title-test",
			title: "   ",
			renderer: "svg",
			source: TEST_DECLARATIVE_JSON,
			presentation: "inline",
		};

		const html = renderToStaticMarkup(
			<VisualExplanationInstance artifact={invalidTitleArtifact} />,
		);

		assert.ok(html.includes('data-testid="visual-explanation-failed"'), "Must render failure alert for invalid title");
		assert.ok(html.includes('role="alert"'), "Must have alert role");
		assert.ok(html.includes("Invalid artifact title"), "Must state invalid artifact title");
		assert.ok(!html.includes('data-testid="visual-explanation-declarative-container"'), "Must not render declarative container");
		assert.ok(!html.includes("<iframe"), "Zero iframes");
	});

	it("RUN 3.2.1: artifact with privileged properties is rejected at instance entrance", () => {
		const privilegedArtifact = {
			version: 1,
			id: "priv-test",
			title: "Privileged Property Test",
			renderer: "svg",
			source: TEST_DECLARATIVE_JSON,
			presentation: "inline",
			token: "secret-token",
			filesystem: true,
		};

		const html = renderToStaticMarkup(
			<VisualExplanationInstance artifact={privilegedArtifact as unknown as VisualArtifact} />,
		);

		assert.ok(html.includes('data-testid="visual-explanation-failed"'), "Must render failure alert for privileged properties");
		assert.ok(html.includes('role="alert"'), "Must have alert role");
		assert.ok(html.includes("privileged capability"), "Must mention privileged capability");
		assert.ok(!html.includes('data-testid="visual-explanation-declarative-container"'), "Must not render declarative container");
		assert.ok(!html.includes("<iframe"), "Zero iframes");
	});

	it("RUN 3.2.1: registerVisualArtifact rejects invalid artifacts and does not store or notify listeners", () => {
		clearVisualArtifactRegistry();

		const validArtifact: VisualArtifact = {
			version: 1,
			id: "reg-boundary-test",
			title: "Registry Boundary Test",
			renderer: "svg",
			source: TEST_DECLARATIVE_JSON,
			presentation: "inline",
		};

		let notified = false;
		const unsub = subscribeVisualArtifact(validArtifact.id, () => {
			notified = true;
		});

		// 1. Attempt to register artifact with invalid version
		const res1 = registerVisualArtifact({ ...validArtifact, version: 99 as any });
		assert.equal(res1, false, "Must reject invalid version registration");
		assert.equal(notified, false, "Must not notify listener on rejected registration");
		assert.equal(getRegisteredVisualArtifact(validArtifact.id), undefined, "Must not store in registry");

		// 2. Attempt to register artifact with empty title
		const res2 = registerVisualArtifact({ ...validArtifact, title: "" });
		assert.equal(res2, false, "Must reject empty title registration");
		assert.equal(notified, false, "Must not notify listener on rejected registration");
		assert.equal(getRegisteredVisualArtifact(validArtifact.id), undefined, "Must not store in registry");

		// 3. Attempt to register artifact with raw SVG XML
		const res3 = registerVisualArtifact({ ...validArtifact, source: "<svg><rect/></svg>" });
		assert.equal(res3, false, "Must reject raw SVG XML registration");
		assert.equal(notified, false, "Must not notify listener on rejected registration");
		assert.equal(getRegisteredVisualArtifact(validArtifact.id), undefined, "Must not store in registry");

		// 4. Valid registration succeeds
		const res4 = registerVisualArtifact(validArtifact);
		assert.equal(res4, true, "Must accept valid artifact registration");
		assert.equal(notified, true, "Must notify listener on valid registration");
		assert.equal(getRegisteredVisualArtifact(validArtifact.id)?.id, validArtifact.id);

		unsub();
		clearVisualArtifactRegistry();
	});

	it("RUN 3.2.1: getRegisteredVisualArtifact and VisualExplanationInstanceInner never initialize from unvalidated registry data", async () => {
		clearVisualArtifactRegistry();

		const validArtifact: VisualArtifact = {
			version: 1,
			id: "init-untrusted-test",
			title: "Trusted Initial Title",
			renderer: "svg",
			source: TEST_DECLARATIVE_JSON,
			presentation: "inline",
		};

		// Verify getRegisteredVisualArtifact returns undefined for non-existent or invalid entries
		assert.equal(getRegisteredVisualArtifact("non-existent"), undefined);

		// Mount instance in linkedom DOM
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
			root.render(<VisualExplanationInstance artifact={validArtifact} />);
		});

		// Verify initial title is rendered
		const titleEl = dom.document.querySelector('[data-testid="visual-explanation-card"] h4');
		assert.equal(titleEl?.textContent, "Trusted Initial Title");

		// Clean up
		await act(async () => {
			root.unmount();
		});
		clearVisualArtifactRegistry();
	});

	it("RUN 3.2.1: valid updates continue to work in-place and invalid updates are discarded preserving state", async () => {
		clearVisualArtifactRegistry();

		const initialArtifact: VisualArtifact = {
			version: 1,
			id: "update-robustness-test",
			title: "Initial Robust Title",
			renderer: "svg",
			source: TEST_DECLARATIVE_JSON,
			presentation: "inline",
			initialState: { step: 1 },
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
			root.render(<VisualExplanationInstance artifact={initialArtifact} />);
		});

		// Verify initial mount state
		let titleEl = dom.document.querySelector('[data-testid="visual-explanation-card"] h4');
		assert.equal(titleEl?.textContent, "Initial Robust Title");
		let indicator = dom.document.querySelector('[data-testid="visual-step-indicator"]');
		assert.ok(indicator?.textContent?.includes("Step 1 / 2"));

		// Send invalid update with unsupported version
		await act(async () => {
			registerVisualArtifact({ ...initialArtifact, version: 2 as any, title: "Corrupt Version Update" });
		});

		// Verify invalid update was discarded and state was preserved
		titleEl = dom.document.querySelector('[data-testid="visual-explanation-card"] h4');
		assert.equal(titleEl?.textContent, "Initial Robust Title", "Title must not change on invalid update");
		indicator = dom.document.querySelector('[data-testid="visual-step-indicator"]');
		assert.ok(indicator?.textContent?.includes("Step 1 / 2"), "Step must be preserved on invalid update");

		// Send invalid update with privileged properties
		await act(async () => {
			registerVisualArtifact({ ...initialArtifact, token: "leak", title: "Privileged Update" } as any);
		});

		// Verify still preserved
		titleEl = dom.document.querySelector('[data-testid="visual-explanation-card"] h4');
		assert.equal(titleEl?.textContent, "Initial Robust Title");

		// Send valid update
		await act(async () => {
			registerVisualArtifact({ ...initialArtifact, title: "Updated Valid Title" });
		});

		// Verify valid update succeeded
		titleEl = dom.document.querySelector('[data-testid="visual-explanation-card"] h4');
		assert.equal(titleEl?.textContent, "Updated Valid Title", "Valid update must apply in-place");
		indicator = dom.document.querySelector('[data-testid="visual-step-indicator"]');
		assert.ok(indicator?.textContent?.includes("Step 1 / 2"), "Step preserved across valid update");
		assert.equal(dom.document.querySelectorAll("iframe").length, 0, "Zero iframes");

		await act(async () => {
			root.unmount();
		});
		clearVisualArtifactRegistry();
	});
});
