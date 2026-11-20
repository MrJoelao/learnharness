import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseHTML } from "linkedom";
import { renderToStaticMarkup } from "react-dom/server";
import { ServerEventsProvider } from "../components/server-events.tsx";
import { SessionsSidebar, SidebarProvider } from "../components/sidebar.tsx";
import { NotesChip, NotesPanel } from "../components/notes-panel.tsx";
import { NotesController, NotesProvider } from "../components/notes-state.tsx";
import {
	_resetGeneralSettingsForTest,
	_setGeneralSettingsForTest,
	useGeneralSettings,
} from "../components/settings/general-settings.ts";
import { SettingsDialogBody } from "../components/settings/settings-dialog.tsx";
import { parseGeneralSettingsBody } from "../src/server/settings-body.ts";
import { resolveSettings, FACTORY_SETTINGS, CURRENT_SETTINGS_VERSION } from "../src/core/index.ts";

function memoryStorage() {
	const store = new Map<string, string>();
	return { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
}

describe("Feature toggles: Study Hub and Notes", () => {
	it("GeneralSettings defaults to studyHub: true, notes: true in FACTORY_SETTINGS and resolveSettings", () => {
		assert.equal(FACTORY_SETTINGS.general.studyHub, true);
		assert.equal(FACTORY_SETTINGS.general.notes, true);
		assert.equal(FACTORY_SETTINGS.general.autoUpdate, true);

		const resolved = resolveSettings(null);
		assert.equal(resolved.general.studyHub, true);
		assert.equal(resolved.general.notes, true);

		const resolvedDisabled = resolveSettings({
			version: CURRENT_SETTINGS_VERSION,
			general: { autoUpdate: false, studyHub: false, notes: false },
		});
		assert.equal(resolvedDisabled.general.studyHub, false);
		assert.equal(resolvedDisabled.general.notes, false);
	});

	it("parseGeneralSettingsBody validates boolean studyHub and notes correctly", () => {
		const parsed = parseGeneralSettingsBody({
			autoUpdate: true,
			studyHub: false,
			notes: false,
		});
		assert.equal(parsed.ok, true);
		if (parsed.ok) {
			assert.equal(parsed.settings.studyHub, false);
			assert.equal(parsed.settings.notes, false);
		}

		const invalidStudyHub = parseGeneralSettingsBody({ studyHub: "invalid" });
		assert.equal(invalidStudyHub.ok, false);

		const invalidNotes = parseGeneralSettingsBody({ notes: 123 });
		assert.equal(invalidNotes.ok, false);
	});

	it("Sidebar: renders study-hub-nav-button when studyHub is true, and hides it when studyHub is false", () => {
		_resetGeneralSettingsForTest();
		let html = renderToStaticMarkup(
			<ServerEventsProvider>
				<SidebarProvider>
					<SessionsSidebar />
				</SidebarProvider>
			</ServerEventsProvider>,
		);
		assert.ok(html.includes('data-testid="study-hub-nav-button"'), "study-hub button visible when enabled");

		_setGeneralSettingsForTest({ autoUpdate: true, studyHub: false, notes: true });
		html = renderToStaticMarkup(
			<ServerEventsProvider>
				<SidebarProvider>
					<SessionsSidebar />
				</SidebarProvider>
			</ServerEventsProvider>,
		);
		assert.ok(!html.includes('data-testid="study-hub-nav-button"'), "study-hub button hidden when disabled");
		_resetGeneralSettingsForTest();
	});

	it("Notes: renders NotesChip and NotesPanel when notes is true, and hides them when notes is false", () => {
		_resetGeneralSettingsForTest();
		const c = new NotesController("c1", "", { storage: memoryStorage() });
		let html = renderToStaticMarkup(
			<NotesProvider controller={c}>
				<NotesChip />
				<NotesPanel />
			</NotesProvider>,
		);
		assert.ok(html.includes('data-testid="notes-chip"'), "notes chip rendered when enabled");
		assert.ok(html.includes('data-testid="notes-panel"'), "notes panel rendered when enabled");

		_setGeneralSettingsForTest({ autoUpdate: true, studyHub: true, notes: false });
		html = renderToStaticMarkup(
			<NotesProvider controller={c}>
				<NotesChip />
				<NotesPanel />
			</NotesProvider>,
		);
		assert.equal(html, "", "nothing rendered when notes disabled");
		_resetGeneralSettingsForTest();
	});

	it("SettingsDialog contains toggle rows for Study Hub and Notes in General section source", async () => {
		const fs = await import("node:fs");
		const path = await import("node:path");
		const code = fs.readFileSync(path.resolve("components/settings/settings-dialog.tsx"), "utf-8");

		assert.ok(code.includes('label="Study Hub"'), "Study Hub toggle row label present");
		assert.ok(code.includes('label="Notes"'), "Notes toggle row label present");
		assert.ok(code.includes('hint="Show Study Hub in the sidebar and navigation"'), "Study Hub description present");
		assert.ok(code.includes('hint="Show the session notes panel in chat"'), "Notes description present");
		assert.ok(code.includes('void write("general", { ...record.general, studyHub: on })'), "write updates studyHub");
		assert.ok(code.includes('void write("general", { ...record.general, notes: on })'), "write updates notes");
	});
});
