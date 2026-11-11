import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import {
	SourcesChip,
	ReferencesChip,
	referenceLabel,
	documentKindBadge,
	urlDomain,
} from "../components/sources-panel.tsx";
import type { SessionReference, SourceDocumentRef } from "../src/core/contracts.ts";
import { BROWSER_NOTICE } from "../components/file-path-drop-zone.tsx";
import { InteractionLayersProvider } from "../components/interaction-layers.tsx";

function documentFor(node: React.ReactNode) {
	return parseHTML(`<html><body>${renderToStaticMarkup(node)}</body></html>`).document;
}

const SAMPLE_DOCS: SourceDocumentRef[] = [
	{ sourceId: "doc_1", name: "quantum_physics.pdf", path: "/data/graph/materials/doc_1.md" },
	{ sourceId: "doc_2", name: "syllabus.md", path: "/data/graph/materials/doc_2.md" },
];

const SAMPLE_REFS: SessionReference[] = [
	{ id: "ref_1", kind: "file", value: "/home/user/notes.txt", name: "Lecture Notes", addedAt: "2026-11-09T10:00:00.000Z" },
	{ id: "ref_2", kind: "url", value: "https://www.nature.com/articles/physics-quantum", addedAt: "2026-11-09T10:01:00.000Z" },
];

describe("Unified Sources Control: Labeling & Count Resolution", () => {
	it("renders compact Sources button with no count when total resources is 0", () => {
		const doc = documentFor(<SourcesChip chatId="chat_1" />);
		const chip = doc.body.querySelector('[data-testid="sources-chip"]')!;
		assert.ok(chip);
		assert.match(chip.textContent ?? "", /Sources/);
		assert.doesNotMatch(chip.textContent ?? "", /·/);
		assert.equal(chip.getAttribute("aria-expanded"), "false");
		assert.equal(chip.getAttribute("aria-haspopup"), "dialog");
		assert.equal(doc.body.querySelector('[data-testid="sources-panel"]'), null);
	});

	it("renders correct count with only session documents", () => {
		const singleDoc = documentFor(
			<SourcesChip chatId="chat_1" sourceDocuments={[SAMPLE_DOCS[0]!]} />,
		);
		const singleChip = singleDoc.body.querySelector('[data-testid="sources-chip"]')!;
		assert.match(singleChip.textContent ?? "", /Sources · 1/);

		const multiDocs = documentFor(
			<SourcesChip chatId="chat_1" sourceDocuments={SAMPLE_DOCS} />,
		);
		const multiChip = multiDocs.body.querySelector('[data-testid="sources-chip"]')!;
		assert.match(multiChip.textContent ?? "", /Sources · 2/);
	});

	it("renders correct count with only additional references", () => {
		const refsDoc = documentFor(
			<SourcesChip chatId="chat_1" initialReferences={SAMPLE_REFS} />,
		);
		const chip = refsDoc.body.querySelector('[data-testid="sources-chip"]')!;
		assert.match(chip.textContent ?? "", /Sources · 2/);
	});

	it("renders combined count representing both session documents and additional references", () => {
		const combined = documentFor(
			<SourcesChip
				chatId="chat_1"
				sourceDocuments={SAMPLE_DOCS}
				initialReferences={SAMPLE_REFS}
			/>,
		);
		const chip = combined.body.querySelector('[data-testid="sources-chip"]')!;
		assert.match(chip.textContent ?? "", /Sources · 4/);
	});

	it("supports backwards-compatible ReferencesChip alias", () => {
		const legacy = documentFor(
			<ReferencesChip chatId="chat_1" initialReferences={SAMPLE_REFS} />,
		);
		const chip = legacy.body.querySelector('[data-testid="references-chip"]')!;
		assert.ok(chip);
		assert.match(chip.textContent ?? "", /References · 2/);
	});
});

describe("Sources Helper Utilities", () => {
	it("referenceLabel prefers custom name, then short filename or url", () => {
		assert.equal(referenceLabel({ id: "1", kind: "file", value: "/a/b/c.pdf", name: "Custom Name", addedAt: "x" }), "Custom Name");
		assert.equal(referenceLabel({ id: "2", kind: "file", value: "/a/b/c.pdf", addedAt: "x" }), "c.pdf");
		assert.equal(referenceLabel({ id: "3", kind: "url", value: "https://example.com/paper", addedAt: "x" }), "https://example.com/paper");
	});

	it("documentKindBadge correctly classifies PDF, Markdown, and Text files", () => {
		assert.equal(documentKindBadge("lecture.pdf"), "PDF");
		assert.equal(documentKindBadge("READING.PDF"), "PDF");
		assert.equal(documentKindBadge("notes.md"), "Markdown");
		assert.equal(documentKindBadge("doc.markdown"), "Markdown");
		assert.equal(documentKindBadge("guide.txt"), "Text");
		assert.equal(documentKindBadge("archive.bin"), "Document");
	});

	it("urlDomain extracts clean hostname without www prefix", () => {
		assert.equal(urlDomain("https://www.nature.com/articles/123"), "nature.com");
		assert.equal(urlDomain("http://arxiv.org/abs/2103.00020"), "arxiv.org");
		assert.equal(urlDomain("not a valid url"), "");
	});
});

describe("Sources Panel: Interactive DOM & Semantic Structure", () => {
	let root: Root | null = null;
	let host: HTMLDivElement | null = null;
	const dom = parseHTML("<html><body></body></html>");
	const originalFetch = globalThis.fetch;
	const originalWindow = globalThis.window;
	const originalDoc = globalThis.document;

	beforeEach(() => {
		Object.assign(globalThis, {
			window: dom.window,
			document: dom.document,
			Element: dom.window.Element,
			HTMLElement: dom.window.HTMLElement,
			HTMLInputElement: dom.window.HTMLInputElement,
			CustomEvent: dom.window.CustomEvent,
			IS_REACT_ACT_ENVIRONMENT: true,
			requestAnimationFrame: (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 0),
			cancelAnimationFrame: (id: number) => clearTimeout(id),
		});
		Object.assign(dom.window, { innerWidth: 1280, innerHeight: 800 });
		dom.window.HTMLElement.prototype.scrollIntoView = () => {};
		host = dom.document.createElement("div") as unknown as HTMLDivElement;
		dom.document.body.appendChild(host as unknown as Node);
		root = createRoot(host);
	});

	afterEach(() => {
		if (root) {
			act(() => root!.unmount());
			root = null;
		}
		if (host) {
			host.remove();
			host = null;
		}
		globalThis.fetch = originalFetch;
		globalThis.window = originalWindow;
		globalThis.document = originalDoc;
	});

	it("opens panel on click and displays both distinct categories", async () => {
		await act(async () => {
			root!.render(
				<InteractionLayersProvider><SourcesChip
					chatId="chat_1"
					sourceDocuments={SAMPLE_DOCS}
					initialReferences={SAMPLE_REFS}
				/></InteractionLayersProvider>,
			);
		});

		const chip = dom.document.querySelector('[data-testid="sources-chip"]') as HTMLElement;
		assert.ok(chip);
		assert.equal(chip.getAttribute("aria-expanded"), "false");

		// Click to open panel
		await act(async () => {
			chip.click();
		});

		assert.equal(chip.getAttribute("aria-expanded"), "true");
		const panel = dom.document.querySelector('[data-testid="sources-panel"]');
		assert.ok(panel, "Sources panel must be open and rendered");

		// 1. SESSION DOCUMENTS section
		const docsSection = dom.document.querySelector('[data-testid="session-documents-section"]');
		assert.ok(docsSection, "Session documents section must be present");
		assert.match(docsSection.textContent ?? "", /Session Documents · 2/);
		assert.match(docsSection.textContent ?? "", /Read-only/);
		assert.match(docsSection.textContent ?? "", /Curriculum/);

		const doc1 = dom.document.querySelector('[data-testid="session-doc-doc_1"]');
		assert.ok(doc1);
		assert.match(doc1.textContent ?? "", /quantum_physics\.pdf/);
		// Redundant badge removed - filename extension and icon communicate the type
		assert.doesNotMatch(doc1.textContent ?? "", /\bPDF\b/);
		// Session documents must NOT have remove buttons
		assert.equal(doc1.querySelector("button"), null, "Session documents are read-only and must not have remove buttons");

		const doc2 = dom.document.querySelector('[data-testid="session-doc-doc_2"]');
		assert.ok(doc2);
		assert.match(doc2.textContent ?? "", /syllabus\.md/);
		assert.doesNotMatch(doc2.textContent ?? "", /\bMarkdown\b/);

		// 2. ADDITIONAL REFERENCES section
		const refsSection = dom.document.querySelector('[data-testid="additional-references-section"]');
		assert.ok(refsSection, "Additional references section must be present");

		const ref1 = dom.document.querySelector('[data-testid="reference-item-ref_1"]');
		assert.ok(ref1);
		assert.match(ref1.textContent ?? "", /Lecture Notes/);
		assert.ok(dom.document.querySelector('[data-testid="references-remove-ref_1"]'), "References must have a remove button");

		const ref2 = dom.document.querySelector('[data-testid="reference-item-ref_2"]');
		assert.ok(ref2);
		assert.match(ref2.textContent ?? "", /nature\.com/, "URL reference must display its domain");
		assert.ok(dom.document.querySelector('[data-testid="references-remove-ref_2"]'));
	});

	it("shows empty state when no sources or references exist", async () => {
		await act(async () => {
			root!.render(<InteractionLayersProvider><SourcesChip chatId="chat_empty" /></InteractionLayersProvider>);
		});

		const chip = dom.document.querySelector('[data-testid="sources-chip"]') as HTMLElement;
		await act(async () => {
			chip.click();
		});

		const emptyAll = dom.document.querySelector('[data-testid="sources-empty-all"]');
		assert.ok(emptyAll, "Total empty state must be shown when 0 resources exist");
		assert.match(emptyAll.textContent ?? "", /No sources attached/);

		// Add reference affordances must still be accessible
		assert.ok(dom.document.querySelector('[data-testid="references-add-file"]'));
		assert.ok(dom.document.querySelector('[data-testid="references-url-input"]'));
		assert.ok(dom.document.querySelector('[data-testid="references-add-url"]'));
	});

	it("surfaces browser notice when trying to pick local files in unsupported environment", async () => {
		(dom.window as unknown as Record<string, unknown>).lh = undefined; // No Electron bridge

		await act(async () => {
			root!.render(<InteractionLayersProvider><SourcesChip chatId="chat_1" /></InteractionLayersProvider>);
		});

		const chip = dom.document.querySelector('[data-testid="sources-chip"]') as HTMLElement;
		await act(async () => {
			chip.click();
		});

		const input = dom.document.querySelector('[data-testid="references-file-input"]') as HTMLInputElement;
		const fakeFile = new (dom.window as unknown as { File: typeof File }).File(["content"], "notes.txt");

		await act(async () => {
			Object.defineProperty(input, "files", { value: [fakeFile], configurable: true });
			const event = new dom.window.Event("change", { bubbles: true });
			input.dispatchEvent(event);
		});

		const error = dom.document.querySelector('[data-testid="references-error"]');
		assert.ok(error, "Error message must be displayed");
		assert.equal(error.textContent, BROWSER_NOTICE);
	});

	it("closes on Escape key and restores focus to the trigger button", async () => {
		await act(async () => {
			root!.render(<InteractionLayersProvider><SourcesChip chatId="chat_1" sourceDocuments={SAMPLE_DOCS} /></InteractionLayersProvider>);
		});

		const chip = dom.document.querySelector('[data-testid="sources-chip"]') as HTMLElement;
		let focusedElement: HTMLElement | null = null;
		chip.focus = () => { focusedElement = chip; };

		await act(async () => {
			chip.click();
		});

		assert.ok(dom.document.querySelector('[data-testid="sources-panel"]'));

		// Send Escape key event
		await act(async () => {
			const escEvent = Object.assign(new dom.window.Event("keydown", { bubbles: true }), {
				key: "Escape",
			});
			dom.document.dispatchEvent(escEvent);
		});

		assert.equal(dom.document.querySelector('[data-testid="sources-panel"]'), null, "Panel must be closed on Escape");
		assert.equal(focusedElement, chip, "Focus must be restored to the trigger button");
	});
});
