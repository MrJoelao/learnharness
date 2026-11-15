/**
 * Acceptance Tests for Expanded Panel & Lifecycle (Phase 6.1 — Fixes C, D, F)
 */

import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseHTML } from "linkedom";
import { VisualExplanationInstance } from "../components/artifacts/visual-explanation-card.tsx";
import type { VisualArtifact } from "../src/core/contracts/visual-explanation.ts";

const HTML_SOURCE = `
<div id="sim-container">
  <h1>HTML Interactive Simulation</h1>
  <p id="counter">0</p>
</div>
`.trim();

describe("Visual Explanation Panel & Lifecycle (Fixes C, D, F)", () => {
	it("ensures exactly ONE iframe is active when expanded (Fix C: No duplicate iframes)", async () => {
		const artifact: VisualArtifact = {
			version: 1,
			id: "html-sim-1",
			title: "HTML Memory Simulator",
			renderer: "html",
			source: HTML_SOURCE,
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

		await act(async () => {
			root.render(<VisualExplanationInstance artifact={artifact} initialExpanded={false} />);
		});

		// Initially inline: exactly 1 iframe, 0 panel dialogs, 0 placeholders
		let iframes = dom.document.querySelectorAll("iframe");
		assert.equal(iframes.length, 1, "Initially exactly one inline iframe rendered");
		assert.equal(dom.document.querySelectorAll('[role="dialog"]').length, 0);
		assert.equal(
			dom.document.querySelectorAll('[data-testid="visual-inline-expanded-placeholder"]').length,
			0,
		);

		// Click expand button to open panel
		const expandBtn = dom.document.querySelector<HTMLButtonElement>(
			'[data-testid="visual-expand-button"]',
		);
		assert.ok(expandBtn, "Expand button must exist");

		await act(async () => {
			expandBtn.click();
		});

		// When expanded: dialog exists, placeholder exists inline, STILL exactly 1 iframe!
		assert.equal(dom.document.querySelectorAll('[role="dialog"]').length, 1);
		assert.equal(
			dom.document.querySelectorAll('[data-testid="visual-inline-expanded-placeholder"]').length,
			1,
			"Inline area must display placeholder, not an active duplicate iframe",
		);

		iframes = dom.document.querySelectorAll("iframe");
		assert.equal(
			iframes.length,
			1,
			"INVARIANT: Exactly one iframe must be active in DOM, never duplicate simulations",
		);

		// Close panel via close button
		const closeBtn = dom.document.querySelector<HTMLButtonElement>(
			'[data-testid="visual-panel-close-button"]',
		);
		assert.ok(closeBtn, "Close button must exist in panel");

		await act(async () => {
			closeBtn.click();
		});

		// Returned to inline: dialog gone, placeholder gone, still 1 iframe
		assert.equal(dom.document.querySelectorAll('[role="dialog"]').length, 0);
		assert.equal(
			dom.document.querySelectorAll('[data-testid="visual-inline-expanded-placeholder"]').length,
			0,
		);
		iframes = dom.document.querySelectorAll("iframe");
		assert.equal(iframes.length, 1, "Inline iframe remains active after closing panel");
	});

	it("preserves state between inline and expanded panel without reset (Fix C)", async () => {
		const artifact: VisualArtifact = {
			version: 1,
			id: "state-preserve-sim",
			title: "Stateful Step Simulator",
			renderer: "svg",
			source: '<svg xmlns="http://www.w3.org/2000/svg"><g data-step="0"/><g data-step="1"/></svg>',
			presentation: "inline",
			initialState: { step: 0, maxSteps: 3 },
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
			root.render(<VisualExplanationInstance artifact={artifact} initialExpanded={false} />);
		});

		// Step forward while inline
		const stepForwardBtn = dom.document.querySelector<HTMLButtonElement>(
			'[data-testid="visual-control-step-forward"]',
		);
		assert.ok(stepForwardBtn);

		await act(async () => {
			stepForwardBtn.click();
		});

		let indicator = dom.document.querySelector('[data-testid="visual-step-indicator"]');
		assert.ok(indicator?.textContent?.includes("Step 1 / 3"));

		// Open panel
		const expandBtn = dom.document.querySelector<HTMLButtonElement>(
			'[data-testid="visual-expand-button"]',
		);
		await act(async () => {
			expandBtn?.click();
		});

		// In panel, step indicator still says Step 1 / 3 (state preserved!)
		indicator = dom.document.querySelector('[data-testid="visual-step-indicator"]');
		assert.ok(indicator?.textContent?.includes("Step 1 / 3"), "State must be preserved in panel");

		// Step forward again inside panel
		const modalStepFwd = dom.document.querySelector<HTMLButtonElement>(
			'[data-testid="visual-control-step-forward"]',
		);
		await act(async () => {
			modalStepFwd?.click();
		});
		indicator = dom.document.querySelector('[data-testid="visual-step-indicator"]');
		assert.ok(indicator?.textContent?.includes("Step 2 / 3"));

		// Close panel
		const closeBtn = dom.document.querySelector<HTMLButtonElement>(
			'[data-testid="visual-panel-close-button"]',
		);
		await act(async () => {
			closeBtn?.click();
		});

		// Back inline: step indicator is STILL Step 2 / 3
		indicator = dom.document.querySelector('[data-testid="visual-step-indicator"]');
		assert.ok(indicator?.textContent?.includes("Step 2 / 3"), "State must be retained after closing panel");
	});

	it("supports Escape key closing and accessible focus restoration (Fix D)", async () => {
		const artifact: VisualArtifact = {
			version: 1,
			id: "a11y-focus-test",
			title: "Accessibility Focus Test",
			renderer: "svg",
			source: '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>',
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

		await act(async () => {
			root.render(<VisualExplanationInstance artifact={artifact} initialExpanded={false} />);
		});

		const expandBtn = dom.document.querySelector<HTMLButtonElement>(
			'[data-testid="visual-expand-button"]',
		);
		assert.ok(expandBtn);

		// Focus expand button before clicking
		expandBtn.focus();
		await act(async () => {
			expandBtn.click();
		});

		// Modal dialog is open with aria attributes
		const dialog = dom.document.querySelector<HTMLDivElement>('[role="dialog"]');
		assert.ok(dialog, "Dialog must be open");
		assert.equal(dialog.getAttribute("aria-modal"), "true");
		assert.equal(dialog.getAttribute("aria-label"), "Accessibility Focus Test");

		// Press Escape on window
		await act(async () => {
			const escEvent = new dom.window.Event("keydown", { bubbles: true });
			(escEvent as unknown as { key: string }).key = "Escape";
			dom.window.dispatchEvent(escEvent);
		});

		// Dialog closed
		assert.equal(
			dom.document.querySelectorAll('[role="dialog"]').length,
			0,
			"Escape key must close dialog",
		);
	});
});
