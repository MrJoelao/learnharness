import assert from "node:assert/strict";
import { it } from "node:test";
import { PluginFrontendManager } from "../components/plugin-manager.ts";
import { preparePluginMode } from "../src/core/plugin-modes.ts";
import type { PluginFrontendModule, PluginInfo, PluginWorkspaceRendererContext } from "../src/core/plugins.ts";
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

it("PluginFrontendManager reflects workspace metadata updates to renderer without remount", async () => {
	const dom = parseHTML("<html><body><div id='mount-dyn'></div></body></html>");
	const previousDocument = (globalThis as Record<string, unknown>).document;
	(globalThis as Record<string, unknown>).document = dom.document;

	let currentWorkspace = {
		version: 1 as const,
		id: parseWorkspaceId("workspace_00000000-0000-4000-8000-000000000020"),
		pluginId: "modes",
		modeId: "lab",
		title: "Titolo Iniziale",
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
	};

	let rendererMountCount = 0;
	const signals: AbortSignal[] = [];
	const contexts: PluginWorkspaceRendererContext[] = [];

	const frontend: PluginFrontendModule = {
		activate(context) {
			context.registerModeRenderer("modes", "lab", {
				mount(_container, workspaceContext) {
					rendererMountCount++;
					signals.push(workspaceContext.signal);
					contexts.push(workspaceContext);
				},
			});
		},
	};

	const manager = new PluginFrontendManager({
		fetch: async (input) => {
			const url = String(input);
			if (url.endsWith("/api/plugins/modes")) return Response.json({ modes: [mode] });
			if (url.endsWith("/api/plugins")) return Response.json({ plugins: [info], directory: "/plugins" });
			return Response.json({});
		},
		importModule: async () => frontend,
		pathname: () => "/",
		navigate() {},
	});

	await manager.reload();
	for (let i = 0; i < 8; i++) await Promise.resolve();

	const container = dom.document.getElementById("mount-dyn") as unknown as HTMLElement;
	const onError = (error: string) => { throw new Error(error); };

	// 1. Mount with getter supplier (as used in workspace-screen.tsx)
	const close = manager.mountWorkspace(() => currentWorkspace, container, onError);
	for (let i = 0; i < 8; i++) await Promise.resolve();

	assert.equal(rendererMountCount, 1);
	const ctx = contexts[0]!;
	const sig = signals[0]!;
	assert.equal(ctx.workspace.title, "Titolo Iniziale");
	assert.equal(sig.aborted, false);

	// 2. Update via supplier
	currentWorkspace = {
		...currentWorkspace,
		title: "Titolo Da Supplier",
		updatedAt: "2026-01-01T00:01:00.000Z",
	};
	assert.equal(ctx.workspace.title, "Titolo Da Supplier");
	assert.equal(rendererMountCount, 1);
	assert.equal(sig.aborted, false);

	// 3. Update via manager.updateWorkspace()
	const updatedRecord = {
		...currentWorkspace,
		title: "Titolo Da Manager Update",
		updatedAt: "2026-01-01T00:02:00.000Z",
	};
	currentWorkspace = updatedRecord;
	manager.updateWorkspace(updatedRecord);

	assert.equal(ctx.workspace.title, "Titolo Da Manager Update");
	assert.equal(rendererMountCount, 1);
	assert.equal(sig.aborted, false);

	// 4. Cleanup on close
	close();
	assert.equal(sig.aborted, true);
	await manager.dispose();

	if (previousDocument === undefined) delete (globalThis as Record<string, unknown>).document;
	else (globalThis as Record<string, unknown>).document = previousDocument;
});

it("PluginFrontendManager.reload() preserves mode renderers and mounted workspaces during temporary mode fetch failure", async () => {
	const dom = parseHTML("<html><body><div id='mount-reload'></div></body></html>");
	const previousDocument = (globalThis as Record<string, unknown>).document;
	(globalThis as Record<string, unknown>).document = dom.document;

	let modesApiFails = false;
	let unmounted = false;
	let signalAborted = false;

	const frontend: PluginFrontendModule = {
		activate(context) {
			context.registerModeRenderer("modes", "lab", {
				mount(_container, wsContext) {
					wsContext.signal.addEventListener("abort", () => {
						signalAborted = true;
					});
					return () => {
						unmounted = true;
					};
				},
			});
		},
	};

	const manager = new PluginFrontendManager({
		fetch: async (input) => {
			const url = String(input);
			if (url.endsWith("/api/plugins/modes")) {
				if (modesApiFails) {
					return new Response(JSON.stringify({ error: "Network error fetching modes" }), { status: 500, headers: { "content-type": "application/json" } });
				}
				return Response.json({ modes: [mode] });
			}
			if (url.endsWith("/api/plugins")) {
				return Response.json({ plugins: [info], directory: "/plugins" });
			}
			return Response.json({});
		},
		importModule: async () => frontend,
		pathname: () => "/",
		navigate() {},
	});

	// 1-3. Load plugin, register mode & renderer, valid response
	await manager.reload();
	for (let i = 0; i < 8; i++) await Promise.resolve();

	// 4. Verify renderer is registered
	assert.equal(manager.getSnapshot().modeRenderers?.length, 1);
	assert.ok(manager.getModeRenderer("modes", "lab"));

	// Mount a workspace instance to verify mount survival
	const workspace = {
		version: 1 as const,
		id: parseWorkspaceId("workspace_00000000-0000-4000-8000-000000000030"),
		pluginId: "modes",
		modeId: "lab",
		title: "Lab Test",
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
	};
	const container = dom.document.getElementById("mount-reload") as unknown as HTMLElement;
	const closeMount = manager.mountWorkspace(workspace, container, (err) => { throw new Error(err); });
	for (let i = 0; i < 8; i++) await Promise.resolve();

	assert.equal(unmounted, false);
	assert.equal(signalAborted, false);

	// 5. Simulate HTTP or network error during subsequent reload
	modesApiFails = true;

	// 6. Execute reload()
	await manager.reload();
	for (let i = 0; i < 8; i++) await Promise.resolve();

	// 7. Verify renderer is still registered
	assert.ok(manager.getModeRenderer("modes", "lab"), "Mode renderer must remain registered despite temporary modes API failure");
	assert.equal(manager.getSnapshot().modeRenderers?.length, 1);
	assert.equal(manager.getSnapshot().modes?.length, 1, "Snapshot modes retains last valid state");
	assert.ok(manager.getSnapshot().error?.includes("Network error fetching modes"), "Error is published to snapshot");

	// 8. Verify workspace was NOT unmounted
	assert.equal(unmounted, false, "Mounted workspace must not be unmounted on temporary modes API error");
	assert.equal(signalAborted, false, "Signal must not be aborted");

	// 9. Restore correct API response
	modesApiFails = false;

	// 10. Execute reload() again
	await manager.reload();
	for (let i = 0; i < 8; i++) await Promise.resolve();

	// 11. Verify renderer continues to be available
	assert.ok(manager.getModeRenderer("modes", "lab"), "Mode renderer continues to be available after recovery");
	assert.equal(manager.getSnapshot().modeRenderers?.length, 1);
	assert.equal(unmounted, false, "Workspace still mounted");
	assert.equal(signalAborted, false);
	assert.equal(manager.getSnapshot().error, undefined, "Error cleared after successful reload");

	closeMount();
	await manager.dispose();

	if (previousDocument === undefined) delete (globalThis as Record<string, unknown>).document;
	else (globalThis as Record<string, unknown>).document = previousDocument;
});

it("PluginFrontendManager.reload() prunes mode renderers and unmounts workspace when backend returns empty modes list", async () => {
	const dom = parseHTML("<html><body><div id='mount-empty'></div></body></html>");
	const previousDocument = (globalThis as Record<string, unknown>).document;
	(globalThis as Record<string, unknown>).document = dom.document;

	let emptyModes = false;
	let unmounted = false;
	let signalAborted = false;

	const frontend: PluginFrontendModule = {
		activate(context) {
			context.registerModeRenderer("modes", "lab", {
				mount(_container, wsContext) {
					wsContext.signal.addEventListener("abort", () => {
						signalAborted = true;
					});
					return () => {
						unmounted = true;
					};
				},
			});
		},
	};

	const manager = new PluginFrontendManager({
		fetch: async (input) => {
			const url = String(input);
			if (url.endsWith("/api/plugins/modes")) {
				if (emptyModes) {
					return Response.json({ modes: [] });
				}
				return Response.json({ modes: [mode] });
			}
			if (url.endsWith("/api/plugins")) {
				return Response.json({ plugins: [info], directory: "/plugins" });
			}
			return Response.json({});
		},
		importModule: async () => frontend,
		pathname: () => "/",
		navigate() {},
	});

	// 1. Initial valid load
	await manager.reload();
	for (let i = 0; i < 8; i++) await Promise.resolve();

	assert.ok(manager.getModeRenderer("modes", "lab"));

	const workspace = {
		version: 1 as const,
		id: parseWorkspaceId("workspace_00000000-0000-4000-8000-000000000040"),
		pluginId: "modes",
		modeId: "lab",
		title: "Lab Test",
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
	};
	const container = dom.document.getElementById("mount-empty") as unknown as HTMLElement;
	manager.mountWorkspace(workspace, container, () => {});
	for (let i = 0; i < 8; i++) await Promise.resolve();

	assert.equal(unmounted, false);

	// 2. Subsequent valid response with modes: []
	emptyModes = true;
	await manager.reload();
	for (let i = 0; i < 8; i++) await Promise.resolve();

	// 3. Verify renderer was pruned and workspace was unmounted
	assert.equal(manager.getModeRenderer("modes", "lab"), undefined, "Renderer must be removed when mode is unregistered");
	assert.equal(manager.getSnapshot().modeRenderers?.length, 0);
	assert.equal(manager.getSnapshot().modes?.length, 0);
	assert.equal(unmounted, true, "Mounted workspace must be unmounted when mode is removed");
	assert.equal(signalAborted, true, "Signal must be aborted");

	await manager.dispose();

	if (previousDocument === undefined) delete (globalThis as Record<string, unknown>).document;
	else (globalThis as Record<string, unknown>).document = previousDocument;
});

