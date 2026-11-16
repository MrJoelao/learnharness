import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, it } from "node:test";
import { parseHTML } from "linkedom";

import { parsePluginManifest } from "../src/core/plugins.ts";
import { preparePluginMode, PLUGIN_MODE_ICONS } from "../src/core/plugin-modes.ts";
import { parseWorkspaceId, parseWorkspaceRecord } from "../src/core/workspaces.ts";
import { validateVisualArtifact, validateDeclarativeSvgDocument } from "../src/core/visual-explanation-validator.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lh-phase7-examples-"));
after(() => fs.rmSync(root, { recursive: true, force: true }));

// ─── 1. Multi-Mode Example Plugin Validation ─────────────────────────────────

it("multi-mode example: manifest conforms to API v1 specification", () => {
	const manifestPath = path.resolve("examples/plugins/multi-mode/dist/manifest.json");
	const raw = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
	const manifest = parsePluginManifest(raw, "multi-mode", "0.7.0");

	assert.equal(manifest.apiVersion, 1);
	assert.equal(manifest.id, "multi-mode");
	assert.equal(manifest.name, "Multi Mode Example");
	assert.equal(manifest.main, "main.js");
	assert.equal(manifest.backend, "backend.cjs");
});

it("multi-mode example: backend registers two distinct modes with valid icons and categories", () => {
	const backendPath = path.resolve("examples/plugins/multi-mode/dist/backend.cjs");
	const backendModule = { exports: {} as any };
	const registeredModes: any[] = [];

	const context = {
		registerMode(definition: any) {
			registeredModes.push(preparePluginMode(definition, "multi-mode"));
		},
	};

	const code = fs.readFileSync(backendPath, "utf8");
	const fn = new Function("exports", "module", "require", code);
	fn(backendModule.exports, backendModule, () => {});
	backendModule.exports.activate(context);

	assert.equal(registeredModes.length, 2, "Plugin must register exactly 2 modes");

	const mode1 = registeredModes.find(m => m.metadata.id === "recall-lab")?.metadata;
	const mode2 = registeredModes.find(m => m.metadata.id === "tree-lab")?.metadata;

	assert.ok(mode1, "recall-lab mode must be registered");
	assert.ok(mode2, "tree-lab mode must be registered");

	// Stable and distinct IDs
	assert.notEqual(mode1.id, mode2.id);

	// Display fields & category
	assert.equal(mode1.name, "Recall Lab");
	assert.equal(mode1.category, "Practice");
	assert.ok(mode1.icon && PLUGIN_MODE_ICONS.includes(mode1.icon as any), `Icon '${mode1.icon}' must be a host-supported icon`);
	assert.deepEqual(mode1.tags, ["memory", "recall", "study"]);

	assert.equal(mode2.name, "Tree Lab");
	assert.equal(mode2.category, "Visual");
	assert.ok(mode2.icon && PLUGIN_MODE_ICONS.includes(mode2.icon as any), `Icon '${mode2.icon}' must be a host-supported icon`);
});

it("multi-mode example: independent instance initialization and isolated state", async () => {
	const backendPath = path.resolve("examples/plugins/multi-mode/dist/backend.cjs");
	const backendModule = { exports: {} as any };
	const registeredModes = new Map<string, any>();

	const context = {
		registerMode(definition: any) {
			const prepared = preparePluginMode(definition, "multi-mode");
			registeredModes.set(definition.id, prepared);
		},
	};

	const code = fs.readFileSync(backendPath, "utf8");
	const fn = new Function("exports", "module", "require", code);
	fn(backendModule.exports, backendModule, () => {});
	backendModule.exports.activate(context);

	const recallMode = registeredModes.get("recall-lab")!;

	// Launch Instance 1
	const ws1 = parseWorkspaceRecord({
		version: 1,
		id: parseWorkspaceId("workspace_11111111-1111-4000-8000-111111111111"),
		pluginId: "multi-mode",
		modeId: "recall-lab",
		title: "Recall Session 1",
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
	});
	const storage1 = new Map<string, any>();
	recallMode.initializeWorkspace({
		workspace: ws1,
		signal: new AbortController().signal,
		storage: {
			get: (k: string) => storage1.get(k),
			set: (k: string, v: any) => storage1.set(k, v),
			delete: (k: string) => storage1.delete(k),
		},
	});

	// Launch Instance 2
	const ws2 = parseWorkspaceRecord({
		version: 1,
		id: parseWorkspaceId("workspace_22222222-2222-4000-8000-222222222222"),
		pluginId: "multi-mode",
		modeId: "recall-lab",
		title: "Recall Session 2",
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
	});
	const storage2 = new Map<string, any>();
	recallMode.initializeWorkspace({
		workspace: ws2,
		signal: new AbortController().signal,
		storage: {
			get: (k: string) => storage2.get(k),
			set: (k: string, v: any) => storage2.set(k, v),
			delete: (k: string) => storage2.delete(k),
		},
	});

	assert.notEqual(ws1.id, ws2.id);
	assert.equal(storage1.get("example")?.createdFor, ws1.id);
	assert.equal(storage2.get("example")?.createdFor, ws2.id);
	assert.equal(storage1.get("example")?.count, 0);
	assert.equal(storage2.get("example")?.count, 0);

	// Modify storage1 only
	storage1.set("example", { ...storage1.get("example"), count: 5, notes: "Instance 1 notes" });

	assert.equal(storage1.get("example")?.count, 5);
	assert.equal(storage1.get("example")?.notes, "Instance 1 notes");
	assert.equal(storage2.get("example")?.count, 0, "Instance 2 must not be modified by Instance 1 changes");
	assert.equal(storage2.get("example")?.notes, "");
});

it("multi-mode example: frontend renderer interactive state modification and DOM updates", async () => {
	const { document } = parseHTML("<!DOCTYPE html><html><body><div id='container'></div></body></html>");
	const container = document.getElementById("container")!;
	const prevDocument = (globalThis as any).document;
	(globalThis as any).document = document;

	try {
		// Load frontend module
		const mainPath = path.resolve("examples/plugins/multi-mode/dist/main.js");
		const mod = await import(mainPath);

		const renderers = new Map<string, any>();
		const frontendContext = {
			manifest: { id: "multi-mode" },
			registerModeRenderer(pluginId: string, modeId: string, renderer: any) {
				renderers.set(`${pluginId}:${modeId}`, renderer);
				return () => renderers.delete(`${pluginId}:${modeId}`);
			},
		};

		mod.activate(frontendContext);

		assert.ok(renderers.has("multi-mode:recall-lab"), "recall-lab renderer registered");
		assert.ok(renderers.has("multi-mode:tree-lab"), "tree-lab renderer registered");

		const recallRenderer = renderers.get("multi-mode:recall-lab")!;

		const ws = parseWorkspaceRecord({
			version: 1,
			id: parseWorkspaceId("workspace_33333333-3333-4000-8000-333333333333"),
			pluginId: "multi-mode",
			modeId: "recall-lab",
			title: "Interactive Workspace",
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		});

		const persisted = new Map<string, any>([
			["example", { createdFor: ws.id, count: 2, notes: "Initial reflection", lastUpdated: "2026-11-16T10:00:00Z" }],
		]);

		const storage = {
			async get(k: string) { return persisted.get(k); },
			async set(k: string, v: any) { persisted.set(k, v); },
			async delete(k: string) { persisted.delete(k); },
		};

		const unmount = await recallRenderer.mount(container, {
			workspace: ws,
			storage,
			signal: new AbortController().signal,
			setTitle: async () => {},
		});

		// Verify initial DOM rendering
		const counterVal = container.querySelector("[data-testid='counter-value']");
		assert.ok(counterVal, "Counter element must be rendered");
		assert.equal(counterVal.textContent, "2");

		const notesInput = container.querySelector("[data-testid='notes-input']") as HTMLTextAreaElement;
		assert.ok(notesInput, "Notes textarea must be rendered");
		assert.equal(notesInput.value, "Initial reflection");

		// Click increment button
		const incBtn = container.querySelector("[data-testid='increment-btn']") as HTMLButtonElement;
		assert.ok(incBtn, "Increment button must exist");
		incBtn.click();

		// Immediate DOM update
		assert.equal(counterVal.textContent, "3", "DOM must update immediately on click");

		// Verify storage persistence
		assert.equal(persisted.get("example")?.count, 3, "Storage must be updated with count = 3");

		// Click reset button
		const resetBtn = container.querySelector("[data-testid='reset-btn']") as HTMLButtonElement;
		resetBtn.click();
		assert.equal(counterVal.textContent, "0", "DOM must update to 0 on reset");
		assert.equal(persisted.get("example")?.count, 0, "Storage must be updated with count = 0");

		// Test unmount cleanup
		unmount();
		assert.equal(container.children.length, 0, "Unmount must clear container children");
	} finally {
		if (prevDocument) {
			(globalThis as any).document = prevDocument;
		} else {
			delete (globalThis as any).document;
		}
	}
});

// ─── 2. Visual Artifact Example Validation ───────────────────────────────────

it("visual artifact example: conforms strictly to learnharness.visual.svg.v1 declarative format", () => {
	const examplePath = path.resolve("examples/visual-explanation/binary-search.json");
	assert.ok(fs.existsSync(examplePath), "examples/visual-explanation/binary-search.json must exist");

	const raw = JSON.parse(fs.readFileSync(examplePath, "utf8"));

	// 1. Validate envelope with strictDeclarative rule
	const res = validateVisualArtifact(raw, { strictDeclarative: true });
	assert.equal(res.valid, true, `Validation failed: ${res.problems.join("; ")}`);
	assert.ok(res.sanitized);

	const artifact = res.sanitized!;
	assert.equal(artifact.version, 1);
	assert.equal(artifact.renderer, "svg");
	assert.equal(artifact.accessibility?.reducedMotionFallback, true);
	assert.ok(artifact.controls && artifact.controls.length >= 2);

	// Controls must only be buttons with allowlisted actions
	for (const ctrl of artifact.controls) {
		assert.equal(ctrl.type, "button");
		assert.ok(["play", "pause", "reset", "step-forward", "step-backward"].includes(ctrl.action as any));
	}

	// 2. Validate declarative SVG document schema
	const parsedSource = JSON.parse(artifact.source);
	const docRes = validateDeclarativeSvgDocument(parsedSource);
	assert.equal(docRes.valid, true, `Declarative SVG validation failed: ${docRes.problems.join("; ")}`);
	assert.ok(docRes.document);

	const doc = docRes.document!;
	assert.equal(doc.schema, "learnharness.visual.svg.v1");
	assert.deepEqual(doc.viewBox, { x: 0, y: 0, width: 640, height: 260 });
	assert.equal(doc.steps.length, 2);

	// Step 1 check
	assert.match(doc.steps[0]!.description ?? "", /Step 1/i);
	assert.ok(doc.steps[0]!.elements.length >= 5);
	assert.ok(doc.steps[0]!.elements.every(e => ["rect", "circle", "ellipse", "line", "polyline", "polygon", "text"].includes(e.type)));

	// Step 2 check
	assert.match(doc.steps[1]!.description ?? "", /Step 2/i);
	assert.ok(doc.steps[1]!.elements.length >= 5);
});
