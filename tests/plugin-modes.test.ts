import assert from "node:assert/strict";
import { it } from "node:test";
import { PluginFrontendManager } from "../components/plugin-manager.ts";
import { preparePluginMode } from "../src/core/plugin-modes.ts";
import type { PluginFrontendModule, PluginInfo } from "../src/core/plugins.ts";
import { parseWorkspaceId } from "../src/core/workspaces.ts";
import { parseHTML } from "linkedom";

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
		{ ...definition, icon: "https://example.com/a.svg" },
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

it("updates renderer metadata on rename and restores persisted state on remount", async () => {
	const dom = parseHTML("<html><body><div id='mount'></div></body></html>");
	const previousDocument = (globalThis as Record<string, unknown>).document;
	(globalThis as Record<string, unknown>).document = dom.document;
	const workspace = { version: 1 as const, id: parseWorkspaceId("workspace_00000000-0000-4000-8000-000000000010"), pluginId: "modes", modeId: "lab", title: "Lab", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
	const data = new Map<string, unknown>();
	const contexts: import("../src/core/plugins.ts").PluginWorkspaceRendererContext[] = [];
	const frontend: PluginFrontendModule = { activate(context) { context.registerModeRenderer("modes", "lab", { mount(_container, workspaceContext) { contexts.push(workspaceContext); } }); } };
	const manager = new PluginFrontendManager({ fetch: async (input, init) => {
		const url = String(input);
		if (url.endsWith("/api/plugins/modes")) return Response.json({ modes: [mode] });
		if (url.endsWith("/api/plugins")) return Response.json({ plugins: [info], directory: "/plugins" });
		if (url.endsWith(`/api/workspaces/${workspace.id}`) && init?.method === "PUT") return Response.json({ workspace: { ...workspace, title: "Renamed", updatedAt: "2026-01-01T00:01:00.000Z" } });
		if (init?.method === "PUT") { data.set(url, JSON.parse(String(init.body)).value); return Response.json({ found: true }); }
		if (init?.method === "DELETE") { data.delete(url); return Response.json({ found: false }); }
		return Response.json({ found: data.has(url), value: data.get(url) });
	}, importModule: async () => frontend, pathname: () => "/", navigate() {} });
	await manager.reload(); for (let i = 0; i < 8; i++) await Promise.resolve();
	const container = dom.document.getElementById("mount") as unknown as HTMLElement;
	const onError = (error: string) => { throw new Error(error); };
	const firstClose = manager.mountWorkspace(workspace, container, onError);
	for (let i = 0; i < 8; i++) await Promise.resolve();
	await contexts[0]!.storage.set("draft", { text: "saved" });
	await contexts[0]!.setTitle("Renamed");
	assert.equal(contexts[0]!.workspace.title, "Renamed");
	firstClose();
	const secondClose = manager.mountWorkspace(workspace, container, onError);
	for (let i = 0; i < 8; i++) await Promise.resolve();
	assert.deepEqual(await contexts[1]!.storage.get("draft"), { text: "saved" });
	secondClose(); await manager.dispose();
	if (previousDocument === undefined) delete (globalThis as Record<string, unknown>).document;
	else (globalThis as Record<string, unknown>).document = previousDocument;
});
