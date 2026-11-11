import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { bindingForAction, formatBinding } from "../src/core/keyboard.ts";
import { NotesChip } from "../components/notes-panel.tsx";
import { SourcesChip } from "../components/sources-panel.tsx";
import { CoverageRingGlyph } from "../components/extraction-coverage.tsx";
import { PhaseChip } from "../components/phase-divider.tsx";
import { StatsBar } from "../components/stats-bar.tsx";
import { NotesController, NotesProvider } from "../components/notes-state.tsx";
import { InteractionLayersProvider } from "../components/interaction-layers.tsx";

function memoryStorage() {
	const store = new Map<string, string>();
	return { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
}

function documentFor(node: React.ReactNode) {
	return parseHTML(`<html><body>${renderToStaticMarkup(node)}</body></html>`).document;
}

describe("UX Audit: Keyboard Shortcuts Integrity", () => {
	it("sessions-search is registered to mod+shift+f and formats properly", () => {
		const binding = bindingForAction("sessions-search");
		assert.equal(binding, "mod+shift+f");
		const label = formatBinding(binding);
		assert.ok(label.includes("F"));
		assert.doesNotMatch(label, /^(\^|Ctrl\+|⌘)K$/);
	});

	it("open-model-picker is registered to mod+k", () => {
		const binding = bindingForAction("open-model-picker");
		assert.equal(binding, "mod+k");
		const label = formatBinding(binding);
		assert.ok(label.includes("K"));
	});
});

describe("UX Audit: Action Controls & Toggle Semantics", () => {
	it("NotesChip has role and visual styling for active state matching SourcesChip language", () => {
		const closed = new NotesController("c1", "", { storage: memoryStorage() });
		const closedDoc = documentFor(
			<NotesProvider controller={closed}><NotesChip /></NotesProvider>,
		);
		const closedButton = closedDoc.body.querySelector('[data-testid="notes-chip"]') as HTMLButtonElement;
		assert.ok(closedButton);
		assert.equal(closedButton.getAttribute("aria-pressed"), "false");
		assert.doesNotMatch(closedButton.className, /border-primary/);

		const open = new NotesController("c1", "", { storage: memoryStorage() });
		open.setOpen(true);
		const openDoc = documentFor(
			<NotesProvider controller={open}><NotesChip /></NotesProvider>,
		);
		const openButton = openDoc.body.querySelector('[data-testid="notes-chip"]') as HTMLButtonElement;
		assert.ok(openButton);
		assert.equal(openButton.getAttribute("aria-pressed"), "true");
		assert.match(openButton.className, /border-border/);
		assert.match(openButton.className, /bg-accent/);
		assert.match(openButton.className, /h-7/);
		assert.match(openButton.className, /rounded-full/);
	});

	it("SourcesChip renders standardized h-7 rounded-full capsule control", () => {
		const doc = documentFor(<SourcesChip chatId="chat_test_1" />);
		const button = doc.body.querySelector('[data-testid="sources-chip"]') as HTMLButtonElement;
		assert.ok(button);
		assert.equal(button.getAttribute("aria-haspopup"), "dialog");
		assert.match(button.className, /h-7/);
		assert.match(button.className, /rounded-full/);
		assert.match(button.className, /px-2\.5/);
	});
});

describe("UX Audit: Phase & Coverage Indicators", () => {
	it("PhaseChip carries descriptive title and aria-label", () => {
		const doc = documentFor(<PhaseChip phase="teach" />);
		const chip = doc.body.querySelector('[data-testid="phase-chip"]')!;
		assert.ok(chip);
		assert.equal(chip.getAttribute("title"), "Session phase: Teaching");
		assert.equal(chip.getAttribute("aria-label"), "Session phase: Teaching");
		assert.match(chip.textContent ?? "", /Teaching/);
	});

	it("CoverageRingGlyph renders without runtime error and carries accessibility", () => {
		const doc = documentFor(<CoverageRingGlyph fill={0.5} running={false} />);
		const svg = doc.body.querySelector("svg")!;
		assert.ok(svg);
		assert.equal(svg.getAttribute("aria-hidden"), "true");
	});
});

describe("UX Audit: StatsBar and Model Control Grouping", () => {
	it("renders unified model control with both model and thinking buttons", () => {
		const doc = documentFor(<InteractionLayersProvider><StatsBar turns={[]} chatId="chat_test_1" /></InteractionLayersProvider>);
		const modelControl = doc.body.querySelector('[data-testid="model-control"]')!;
		assert.ok(modelControl);
		assert.match(modelControl.className, /rounded-full/);
		assert.match(modelControl.className, /border-border/);

		const modelBtn = modelControl.querySelector('[data-testid="stats-model"]')!;
		assert.ok(modelBtn);

		const thinkingBtn = modelControl.querySelector('[data-testid="stats-thinking"]')!;
		assert.ok(thinkingBtn);

		const summaryBtn = doc.body.querySelector('[data-testid="stats-summary"]')!;
		assert.ok(summaryBtn);
		assert.equal(summaryBtn.getAttribute("aria-haspopup"), "dialog");
		assert.equal(summaryBtn.getAttribute("aria-label"), "Session stats: context and cost");
	});
});

describe("UX Audit: Folder Tree View & Hierarchy", () => {
	it("expanded folder has no persistent background, preserving distinct visual state for active session", async () => {
		const { ChatFolderRow } = await import("../components/chat-folder-tree.tsx");
		const folder = {
			id: "f_alg",
			name: "alg. dati",
			parentId: null,
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
			archivedAt: null,
		};
		const doc = documentFor(
			<ChatFolderRow
				folder={folder}
				depth={0}
				isOpen={true}
				chatCount={3}
				selected={false}
				onToggle={() => {}}
			/>,
		);
		const row = doc.body.querySelector('[data-testid="folder-row-f_alg"]') as HTMLDivElement;
		assert.ok(row);
		// An open unselected folder must NOT have bg-accent, bg-muted, or persistent solid fill
		assert.doesNotMatch(row.className, /\bbg-accent\b/);
		assert.doesNotMatch(row.className, /\bbg-muted\/40\b/);
	});

	it("child sessions are indented properly under parent folder without leftward inversion", async () => {
		const { folderPaddingLeft, chatPaddingLeft } = await import("../components/chat-folder-tree.tsx");
		// Verify mathematical grid properties:
		// 1. Child session offset is strictly positive
		assert.ok(chatPaddingLeft(0) > folderPaddingLeft(0));
		// 2. Child session starts at 40px, cleanly under/right of folder icon (28-44px) and aligned with text (50px)
		assert.equal(folderPaddingLeft(0), 8);
		assert.equal(chatPaddingLeft(0), 40);
		// 3. Constant step per level
		assert.equal(folderPaddingLeft(1) - folderPaddingLeft(0), 16);
		assert.equal(chatPaddingLeft(1) - chatPaddingLeft(0), 16);
	});

	it("folder name uses font-prose matching session title typography", async () => {
		const { ChatFolderRow } = await import("../components/chat-folder-tree.tsx");
		const folder = {
			id: "f_trees",
			name: "Binary Trees",
			parentId: null,
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
			archivedAt: null,
		};
		const doc = documentFor(
			<ChatFolderRow
				folder={folder}
				depth={0}
				isOpen={false}
				chatCount={2}
				onToggle={() => {}}
			/>,
		);
		const folderTitle = doc.body.querySelector("span.font-prose");
		assert.ok(folderTitle, "folder name must carry font-prose");
		assert.match(folderTitle.textContent ?? "", /Binary Trees/);
	});
});

describe("UX Audit: Minimal Selection, Destructive Actions & Mode Switch", () => {
	it("active SessionRow uses clean minimal bg-accent without AI-like left border or shadow", async () => {
		const { SessionRow } = await import("../components/sidebar.tsx");
		const chat = {
			id: "c_active",
			title: "Algorithms Review",
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
			messageCount: 5,
			folderId: null,
		};
		const doc = documentFor(<SessionRow chat={chat} active={true} onOpen={() => {}} />);
		const button = doc.body.querySelector('[data-session-id="c_active"]') as HTMLButtonElement;
		assert.ok(button);
		assert.match(button.className, /bg-accent/);
		assert.doesNotMatch(button.className, /border-l-2/);
		assert.doesNotMatch(button.className, /border-primary/);
		assert.doesNotMatch(button.className, /shadow-xs/);
	});

	it("delete actions in sidebar context menus use text-destructive styling", async () => {
		const fs = await import("node:fs");
		const path = await import("node:path");
		const sidebarCode = fs.readFileSync(path.resolve("components/sidebar.tsx"), "utf-8");
		assert.ok(
			sidebarCode.includes('data-testid="ctx-delete"'),
			"ctx-delete button present",
		);
		const ctxDeleteSlice = sidebarCode.slice(
			sidebarCode.indexOf('data-testid="ctx-delete"'),
			sidebarCode.indexOf('data-testid="ctx-delete"') + 300,
		);
		assert.ok(ctxDeleteSlice.includes("text-destructive"), "ctx-delete must have text-destructive class");
	});

	it("home mode switch matches curvature and height of dock capsule controls (Dictate, ModelControl)", async () => {
		const fs = await import("node:fs");
		const path = await import("node:path");
		const homeCode = fs.readFileSync(path.resolve("components/home.tsx"), "utf-8");
		assert.ok(homeCode.includes('data-testid="home-mode-switch"'));
		const switchIdx = homeCode.indexOf('data-testid="home-mode-switch"');
		const switchSlice = homeCode.slice(Math.max(0, switchIdx - 200), switchIdx + 800);
		assert.ok(switchSlice.includes("rounded-full"), "home-mode-switch container uses rounded-full");
		assert.ok(switchSlice.includes("h-7"), "home-mode-switch container uses h-7");
		assert.ok(switchSlice.includes("rounded-full px-2.5"), "home-mode-switch items use rounded-full");
	});

	it("graph-view search node input has single border without nested input borders", async () => {
		const fs = await import("node:fs");
		const path = await import("node:path");
		const graphCode = fs.readFileSync(path.resolve("components/graph-view.tsx"), "utf-8");
		assert.ok(graphCode.includes('placeholder="Search nodes…"'));
		const searchIdx = graphCode.indexOf('placeholder="Search nodes…"');
		const searchSlice = graphCode.slice(Math.max(0, searchIdx - 200), searchIdx + 400);
		// Input must be bg-transparent without border
		assert.ok(searchSlice.includes("bg-transparent"), "search input must have bg-transparent");
		assert.ok(!searchSlice.includes("border bg-background"), "search input must not have duplicate border");
	});

	it("study-range-switch in study-time-overlay uses standardized capsule pill styling", async () => {
		const fs = await import("node:fs");
		const path = await import("node:path");
		const studyCode = fs.readFileSync(path.resolve("components/study-time-overlay.tsx"), "utf-8");
		assert.ok(studyCode.includes('data-testid="study-range-switch"'));
		const rangeIdx = studyCode.indexOf('data-testid="study-range-switch"');
		const rangeSlice = studyCode.slice(Math.max(0, rangeIdx - 50), rangeIdx + 700);
		assert.ok(rangeSlice.includes("rounded-full"), "study-range container must be rounded-full");
		assert.ok(rangeSlice.includes("rounded-full px-2.5"), "study-range items must be rounded-full");
	});

	it("sidebar session-kind-filter matches capsule pill styling of other selectors", async () => {
		const fs = await import("node:fs");
		const path = await import("node:path");
		const sidebarCode = fs.readFileSync(path.resolve("components/sidebar.tsx"), "utf-8");
		assert.ok(sidebarCode.includes('data-testid="session-kind-filter"'));
		const filterIdx = sidebarCode.indexOf('data-testid="session-kind-filter"');
		const filterSlice = sidebarCode.slice(Math.max(0, filterIdx - 200), filterIdx + 700);
		assert.ok(filterSlice.includes("rounded-full"), "session-kind-filter container uses rounded-full");
		assert.ok(filterSlice.includes("h-7"), "session-kind-filter container uses h-7");
		assert.ok(filterSlice.includes("rounded-full px-1.5"), "session-kind-filter items use rounded-full");
	});

	it("folder tree uses CollapsibleFolderContent with accordion animation classes", async () => {
		const { CollapsibleFolderContent } = await import("../components/chat-folder-tree.tsx");
		const openDoc = documentFor(
			<CollapsibleFolderContent open={true}>
				<div data-testid="test-child">Folder content</div>
			</CollapsibleFolderContent>,
		);
		const openWrapper = openDoc.body.firstElementChild as HTMLElement;
		assert.ok(openWrapper);
		assert.match(openWrapper.className, /lh-folder-expand/);
		assert.match(openWrapper.className, /duration-180/);
		assert.ok(openDoc.body.querySelector('[data-testid="test-child"]'));

		const closedDoc = documentFor(
			<CollapsibleFolderContent open={false}>
				<div data-testid="test-child">Folder content</div>
			</CollapsibleFolderContent>,
		);
		// When statically closed, children are not rendered
		assert.equal(closedDoc.body.querySelector('[data-testid="test-child"]'), null);
	});
});
