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

const SVG_SOURCE = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">
  <rect width="100" height="50" fill="#2563eb"/>
  <text x="10" y="30" fill="#ffffff">Step 0</text>
</svg>
`.trim();

describe("Visual Explanation Panel & Lifecycle (Fixes C, D, F)", () => {
	it("ensures exactly ONE visual view is active when expanded (Fix C: No duplicate views, zero iframes)", async () => {
		const artifact: VisualArtifact = {
			version: 1,
			id: "svg-sim-1",
			title: "SVG Memory Simulator",
			renderer: "svg",
			source: SVG_SOURCE,
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

		// Initially inline: exactly 0 iframes, 0 panel dialogs, 0 placeholders, 1 visual view
		let iframes = dom.document.querySelectorAll("iframe");
		assert.equal(iframes.length, 0, "No iframe must ever be rendered for visual artifacts");
		assert.equal(dom.document.querySelectorAll('[role="dialog"]').length, 0);
		assert.equal(
			dom.document.querySelectorAll('[data-testid="visual-inline-expanded-placeholder"]').length,
			0,
		);
		assert.equal(
			dom.document.querySelectorAll('[data-testid="visual-explanation-svg-container"]').length,
			1,
			"Initially exactly one inline visual view rendered",
		);

		// Click expand button to open panel
		const expandBtn = dom.document.querySelector<HTMLButtonElement>(
			'[data-testid="visual-expand-button"]',
		);
		assert.ok(expandBtn, "Expand button must exist");

		await act(async () => {
			expandBtn.click();
		});

		// When expanded: dialog exists, placeholder exists inline, STILL 0 iframes and 1 visual view!
		assert.equal(dom.document.querySelectorAll('[role="dialog"]').length, 1);
		assert.equal(
			dom.document.querySelectorAll('[data-testid="visual-inline-expanded-placeholder"]').length,
			1,
			"Inline area must display placeholder, not an active duplicate view",
		);

		iframes = dom.document.querySelectorAll("iframe");
		assert.equal(iframes.length, 0, "INVARIANT: Zero iframes in DOM");
		assert.equal(
			dom.document.querySelectorAll('[data-testid="visual-explanation-svg-container"]').length,
			1,
			"INVARIANT: Exactly one active visual view must be active in DOM, never duplicate simulations",
		);

		// Close panel via close button
		const closeBtn = dom.document.querySelector<HTMLButtonElement>(
			'[data-testid="visual-panel-close-button"]',
		);
		assert.ok(closeBtn, "Close button must exist in panel");

		await act(async () => {
			closeBtn.click();
		});

		// Returned to inline: dialog gone, placeholder gone, still 1 visual view, 0 iframes
		assert.equal(dom.document.querySelectorAll('[role="dialog"]').length, 0);
		assert.equal(
			dom.document.querySelectorAll('[data-testid="visual-inline-expanded-placeholder"]').length,
			0,
		);
		assert.equal(
			dom.document.querySelectorAll('[data-testid="visual-explanation-svg-container"]').length,
			1,
			"Inline visual view remains active after closing panel",
		);
		assert.equal(dom.document.querySelectorAll("iframe").length, 0);

		await act(async () => {
			root.unmount();
		});
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

		await act(async () => {
			root.unmount();
		});
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

		const dom = parseHTML("<!doctype html><html><body><div id='root'></div><button id='outside-btn'>Outside</button></body></html>");
		const origFocus = dom.window.HTMLElement.prototype.focus;
		dom.window.HTMLElement.prototype.focus = function () {
			Object.defineProperty(dom.document, "activeElement", { value: this, writable: true, configurable: true });
			origFocus?.call(this);
		};

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
		assert.equal(dom.document.activeElement, expandBtn);

		await act(async () => {
			expandBtn.click();
		});

		// Modal dialog is open with aria attributes
		const dialog = dom.document.querySelector<HTMLDivElement>('[role="dialog"]');
		assert.ok(dialog, "Dialog must be open");
		assert.equal(dialog.getAttribute("aria-modal"), "true");
		assert.equal(dialog.getAttribute("aria-label"), "Accessibility Focus Test");

		// Find focusable elements in dialog
		const focusables = Array.from(
			dialog.querySelectorAll<HTMLElement>(
				'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
			),
		);
		assert.ok(focusables.length >= 2, "Must have at least 2 focusable elements in panel (close button & download)");
		const firstFocusable = focusables[0];
		const lastFocusable = focusables[focusables.length - 1];
		assert.ok(firstFocusable && lastFocusable, "Both first and last focusable elements must exist");

		// Verify initial focus entered dialog
		assert.equal(dom.document.activeElement, firstFocusable, "Initial focus must be placed on first interactive element");

		// Test Tab wrap-around: when on last focusable and user presses Tab, wraps to first focusable
		lastFocusable.focus();
		assert.equal(dom.document.activeElement, lastFocusable);

		await act(async () => {
			const tabEvent = new dom.window.Event("keydown", { bubbles: true, cancelable: true });
			Object.defineProperty(tabEvent, "key", { value: "Tab" });
			Object.defineProperty(tabEvent, "shiftKey", { value: false });
			dom.window.dispatchEvent(tabEvent);
		});
		assert.equal(dom.document.activeElement, firstFocusable, "Tab on last element must wrap around to first element");

		// Test Shift+Tab wrap-around: when on first focusable and user presses Shift+Tab, wraps to last focusable
		firstFocusable.focus();
		assert.equal(dom.document.activeElement, firstFocusable);

		await act(async () => {
			const shiftTabEvent = new dom.window.Event("keydown", { bubbles: true, cancelable: true });
			Object.defineProperty(shiftTabEvent, "key", { value: "Tab" });
			Object.defineProperty(shiftTabEvent, "shiftKey", { value: true });
			dom.window.dispatchEvent(shiftTabEvent);
		});
		assert.equal(dom.document.activeElement, lastFocusable, "Shift+Tab on first element must wrap around to last element");

		// Test outside focus trap: focusing outside dialog triggers onFocusIn returning focus to dialog
		const outsideBtn = dom.document.querySelector<HTMLButtonElement>("#outside-btn");
		assert.ok(outsideBtn);
		await act(async () => {
			const focusInEvent = new dom.window.Event("focusin", { bubbles: true });
			Object.defineProperty(focusInEvent, "target", { value: outsideBtn });
			dom.document.dispatchEvent(focusInEvent);
		});
		assert.equal(dom.document.activeElement, firstFocusable, "Outside focus attempt must be trapped back to dialog");

		// Press Escape on window
		await act(async () => {
			const escEvent = new dom.window.Event("keydown", { bubbles: true });
			Object.defineProperty(escEvent, "key", { value: "Escape" });
			dom.window.dispatchEvent(escEvent);
		});

		// Dialog closed
		assert.equal(
			dom.document.querySelectorAll('[role="dialog"]').length,
			0,
			"Escape key must close dialog",
		);

		// Wait for focus restoration timeout
		await new Promise((r) => setTimeout(r, 60));
		assert.equal(dom.document.activeElement, expandBtn, "Focus must be restored to expand button after closing dialog");

		await act(async () => {
			root.unmount();
		});
	});
});
