import assert from "node:assert/strict";
import { it } from "node:test";
import { PluginFrontendManager } from "../components/plugin-manager.ts";
import { preparePluginMode } from "../src/core/plugin-modes.ts";
import type { PluginFrontendModule, PluginInfo } from "../src/core/plugins.ts";

const mode = { pluginId: "modes", id: "lab", name: "Lab", description: "A workspace", category: "Practice" };
const info: PluginInfo = { id: "modes", origin: "community", enabled: true, status: "active", revision: "r1", manifest: { apiVersion: 1, id: "modes", name: "Modes", version: "1.0.0", minAppVersion: "0.3.7", main: "main.js" } };

it("validates and detaches backend mode metadata", () => {
	const definition = { id: "lab", name: " Lab ", description: "A workspace", category: "Practice", tags: ["Recall"], initializeWorkspace() {} };
	const parsed = preparePluginMode(definition, "modes");
	assert.equal(parsed.metadata.name, "Lab");
	assert.deepEqual(parsed.metadata.tags, ["Recall"]);
	const invalidDefinitions: unknown[] = [
		{ ...definition, id: "../bad" },
		{ ...definition, description: "" },
		{ ...definition, tags: ["same", "SAME"] },
		{ ...definition, config: {} },
		{ ...definition, initializeWorkspace: undefined },
	];
	for (const value of invalidDefinitions) assert.throws(() => preparePluginMode(value as never, "modes"));
});

it("resolves only explicit frontend renderers declared by the backend", async () => {
	let mounts = 0;
	const frontend: PluginFrontendModule = { activate(context) {
		context.registerModeRenderer("modes", "lab", { mount() { mounts++; } });
	} };
	const manager = new PluginFrontendManager({
		fetch: async url => String(url).endsWith("/api/plugins/modes") ? Response.json({ modes: [mode] }) : Response.json({ plugins: [info], directory: "/plugins" }),
		importModule: async () => frontend, pathname: () => "/", navigate() {},
	});
	await manager.reload();
	for (let i = 0; i < 8; i++) await Promise.resolve();
	assert.equal(manager.getSnapshot().modeRenderers?.length, 1);
	assert.ok(manager.getModeRenderer("modes", "lab"));
	assert.equal(mounts, 0);
	await manager.dispose();
});

it("legacy v1 frontend activation needs no mode registration", async () => {
	const frontend: PluginFrontendModule = { activate(context) { context.registerView({ id: "old", name: "Old API", mount() {} }); } };
	const manager = new PluginFrontendManager({ fetch: async () => Response.json({ plugins: [info], directory: "/plugins" }), importModule: async () => frontend, pathname: () => "/", navigate() {} });
	manager.reconcile([info]);
	for (let i = 0; i < 8; i++) await Promise.resolve();
	assert.equal(manager.getSnapshot().plugins[0]?.phase, "active");
	assert.equal(manager.getSnapshot().plugins[0]?.views[0]?.id, "old");
	await manager.dispose();
});
