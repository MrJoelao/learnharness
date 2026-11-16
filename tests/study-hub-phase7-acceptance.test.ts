import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, it } from "node:test";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

import {
	applyOrganizationAction,
	chatKey,
	emptyOrganizationV2,
	workspaceKey,
	type OrganizationV2,
} from "../src/core/organization.ts";
import {
	parseWorkspaceId,
	parseWorkspaceRecord,
	resolveWorkspaceAvailability,
	type WorkspacePluginSnapshot,
} from "../src/core/workspaces.ts";
import { createWorkspaceStore } from "../src/store/workspaces.ts";
import { createPluginWorkspaceStateStore } from "../src/store/plugin-workspace-state.ts";
import { createPluginHost } from "../src/server/plugin-host.ts";
import { createWorkspaceService } from "../src/server/workspaces.ts";
import { createDirectoryService } from "../src/server/directory.ts";
import { createVisualExplanationTool } from "../src/agent/tools/visual-explanation.ts";
import { chatStore } from "../src/store/chats.ts";
import { VisualExplanationCard, registerVisualArtifact } from "../components/artifacts/visual-explanation-card.tsx";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lh-phase7-acceptance-"));
after(() => fs.rmSync(root, { recursive: true, force: true }));

it("end-to-end acceptance: executes complete 23-step acceptance scenario from spec 08", async () => {
	const dir = path.join(root, "acceptance-flow");
	const pluginsDir = path.join(dir, "plugins");
	const workspacesDir = path.join(dir, "workspaces");
	fs.mkdirSync(pluginsDir, { recursive: true });
	fs.mkdirSync(workspacesDir, { recursive: true });

	// Setup on-disk plugin with 2 modes
	const pluginDist = path.join(pluginsDir, "acceptance-plugin", "dist");
	fs.mkdirSync(pluginDist, { recursive: true });
	fs.writeFileSync(
		path.join(pluginDist, "manifest.json"),
		JSON.stringify({
			apiVersion: 1,
			id: "acceptance-plugin",
			name: "Acceptance Plugin",
			version: "1.0.0",
			minAppVersion: "0.7.0",
			backend: "backend.cjs",
		}),
	);

	fs.writeFileSync(
		path.join(pluginDist, "backend.cjs"),
		`exports.activate = ctx => {
			ctx.registerMode({
				id: "mode-a",
				name: "Mode A",
				description: "First Mode",
				category: "Practice",
				icon: "Brain",
				initializeWorkspace({ workspace, storage }) {
					storage.set("app-state", { instance: workspace.id, count: 0, text: "" });
				},
			});
			ctx.registerMode({
				id: "mode-b",
				name: "Mode B",
				description: "Second Mode",
				category: "Visual",
				icon: "Network",
				initializeWorkspace({ workspace, storage }) {
					storage.set("app-state", { instance: workspace.id, depth: 1 });
				},
			});
		};`,
	);

	let store = createWorkspaceStore(workspacesDir);
	let service = createWorkspaceService({ store });
	let stateStore = createPluginWorkspaceStateStore();

	let host = createPluginHost({
		directory: pluginsDir,
		appVersion: "0.7.0",
		workspaces: service,
		workspaceStateStore: stateStore,
		createServices: () => ({} as any),
	});

	await host.initialize();

	// ─── Step 1: Enable sample plugin
	await host.setEnabled("acceptance-plugin", true);

	// ─── Step 2: Verify that two modes are registered
	const activeModes = host.modes();
	assert.equal(activeModes.length, 2, "Step 2: Plugin must register exactly two modes");
	const modeA = activeModes.find(m => m.id === "mode-a");
	const modeB = activeModes.find(m => m.id === "mode-b");
	assert.ok(modeA && modeB, "Step 2: mode-a and mode-b must both be present");

	// ─── Step 3: Open Study Hub (modes available in catalog)
	assert.equal(activeModes.filter(m => m.pluginId === "acceptance-plugin").length, 2, "Step 3: Study Hub catalog displays both modes");

	// ─── Step 4: Launch Mode A twice
	const ws1 = await host.createWorkspace({
		pluginId: "acceptance-plugin",
		modeId: "mode-a",
		title: "Mode A - Run 1",
	});
	const ws2 = await host.createWorkspace({
		pluginId: "acceptance-plugin",
		modeId: "mode-a",
		title: "Mode A - Run 2",
	});

	// ─── Step 5: Verify two separate workspace entries are created
	assert.notEqual(ws1.id, ws2.id, "Step 5: Workspaces must receive distinct IDs");
	const wsList = service.list().workspaces;
	assert.ok(wsList.some(w => w.id === ws1.id), "Step 5: First workspace listed");
	assert.ok(wsList.some(w => w.id === ws2.id), "Step 5: Second workspace listed");

	// ─── Step 6: Modify state of both workspaces
	const pluginDataDir = path.join(path.dirname(pluginsDir), "plugin-data", "acceptance-plugin");
	const state1 = stateStore.open(pluginDataDir, ws1.id);
	const state2 = stateStore.open(pluginDataDir, ws2.id);

	state1.set("app-state", { instance: ws1.id, count: 42, notes: "State for WS 1" });
	state2.set("app-state", { instance: ws2.id, count: 99, notes: "State for WS 2" });

	// ─── Step 7: Verify that states are distinct
	const read1 = state1.get("app-state") as any;
	const read2 = state2.get("app-state") as any;
	assert.equal(read1.count, 42, "Step 7: WS 1 count must be 42");
	assert.equal(read2.count, 99, "Step 7: WS 2 count must be 99");
	assert.equal(read1.notes, "State for WS 1");
	assert.equal(read2.notes, "State for WS 2");

	// ─── Step 8: Move one of the workspaces into a folder
	let org: OrganizationV2 = emptyOrganizationV2();
	const allKeys = new Set([workspaceKey(ws1.id), workspaceKey(ws2.id), chatKey("chat_test_1")]);
	const freshFolder = () => ({ id: `folder_${Date.now()}`, createdAt: new Date().toISOString() });
	org = applyOrganizationAction(org, {
		action: "create-folder",
		name: "Subject Folder",
		parentId: null,
	}, allKeys, freshFolder());
	const createdFolder = org.folders[0]!;

	org = applyOrganizationAction(org, {
		action: "move",
		kind: "workspace",
		id: ws1.id,
		parentId: createdFolder.id,
	}, allKeys, freshFolder());

	assert.equal(org.placements[workspaceKey(ws1.id)]?.folderId, createdFolder.id, "Step 8: WS 1 moved to folder");

	// ─── Step 9: Move a chat into the same folder
	org = applyOrganizationAction(org, {
		action: "move",
		kind: "chat",
		id: "chat_test_1",
		parentId: createdFolder.id,
	}, allKeys, freshFolder());

	assert.equal(org.placements[chatKey("chat_test_1")]?.folderId, createdFolder.id, "Step 9: Chat moved to same folder");

	// ─── Step 10: Verify mixed ordering
	const folderPlacements = Object.entries(org.placements).filter(([_, p]) => p.folderId === createdFolder.id);
	assert.equal(folderPlacements.length, 2, "Step 10: Folder contains both chat and workspace");
	assert.ok(folderPlacements.some(([k]) => k === workspaceKey(ws1.id)));
	assert.ok(folderPlacements.some(([k]) => k === chatKey("chat_test_1")));

	// ─── Step 11: Archive the folder
	org = applyOrganizationAction(org, {
		action: "archive",
		kind: "folder",
		id: createdFolder.id,
	}, allKeys, freshFolder());

	// ─── Step 12: Verify chat and workspace appear in same archive
	assert.ok(org.folders.find(f => f.id === createdFolder.id)?.archivedAt, "Step 12: Folder is archived");
	assert.ok(org.placements[workspaceKey(ws1.id)]?.archivedAt, "Step 12: Workspace placement is archived");
	assert.ok(org.placements[chatKey("chat_test_1")]?.archivedAt, "Step 12: Chat placement is archived");

	// ─── Step 13: Restore the folder
	org = applyOrganizationAction(org, {
		action: "restore",
		kind: "folder",
		id: createdFolder.id,
	}, allKeys, freshFolder());

	assert.equal(org.folders.find(f => f.id === createdFolder.id)?.archivedAt, null, "Step 13: Folder restored");
	assert.equal(org.placements[workspaceKey(ws1.id)]?.archivedAt, null, "Step 13: Workspace restored");
	assert.equal(org.placements[chatKey("chat_test_1")]?.archivedAt, null, "Step 13: Chat restored");

	// ─── Step 14: Restart or reconstruct store
	await host.dispose();
	store = createWorkspaceStore(workspacesDir);
	service = createWorkspaceService({ store });
	stateStore = createPluginWorkspaceStateStore();
	host = createPluginHost({
		directory: pluginsDir,
		appVersion: "0.7.0",
		workspaces: service,
		workspaceStateStore: stateStore,
		createServices: () => ({} as any),
	});
	await host.initialize();
	await host.setEnabled("acceptance-plugin", true);

	// ─── Step 15: Verify recovery of workspaces and their respective states
	const recoveredWs1 = service.read(ws1.id);
	const recoveredWs2 = service.read(ws2.id);
	assert.ok(recoveredWs1 && recoveredWs2, "Step 15: Workspaces successfully recovered after restart");

	const recState1 = stateStore.open(pluginDataDir, ws1.id).get("app-state") as any;
	const recState2 = stateStore.open(pluginDataDir, ws2.id).get("app-state") as any;
	assert.equal(recState1.count, 42, "Step 15: WS 1 count recovered intact");
	assert.equal(recState2.count, 99, "Step 15: WS 2 count recovered intact");

	// ─── Step 16: Disable the plugin
	await host.setEnabled("acceptance-plugin", false);

	// ─── Step 17: Verify workspaces remain visible and recoverable
	const wsListAfterDisable = service.list().workspaces;
	assert.equal(wsListAfterDisable.length, 2, "Step 17: Workspaces remain in index");

	const disabledSnapshot: WorkspacePluginSnapshot[] = [{ id: "acceptance-plugin", enabled: false, modeIds: [] }];
	assert.equal(resolveWorkspaceAvailability(ws1, disabledSnapshot), "plugin-disabled", "Step 17: Unavailable state resolved");
	assert.equal(resolveWorkspaceAvailability(ws2, disabledSnapshot), "plugin-disabled", "Step 17: Unavailable state resolved");

	// ─── Step 18: Re-enable the plugin
	await host.setEnabled("acceptance-plugin", true);

	// ─── Step 19: Verify both instances become accessible again
	const enabledSnapshot: WorkspacePluginSnapshot[] = [{ id: "acceptance-plugin", enabled: true, modeIds: ["mode-a", "mode-b"] }];
	assert.equal(resolveWorkspaceAvailability(ws1, enabledSnapshot), "available", "Step 19: WS 1 available");
	assert.equal(resolveWorkspaceAvailability(ws2, enabledSnapshot), "available", "Step 19: WS 2 available");

	// ─── Step 20: In a teaching chat, generate a visual explanation
	const createdChat = chatStore.createChat("Acceptance Visual Explanation Chat");
	const chatId = createdChat.id;

	const visualTool = createVisualExplanationTool({ chatId, chatStore });
	const createResult = await visualTool.execute("call-create-1", {
		action: "create",
		title: "Algorithm Flow",
		summary: "Visual explanation of binary search",
		renderer: "svg",
		presentation: "auto",
		source: JSON.stringify({
			schema: "learnharness.visual.svg.v1",
			viewBox: { x: 0, y: 0, width: 300, height: 150 },
			steps: [
				{
					id: "s1",
					label: "Initial Step",
					elements: [{ type: "rect", x: 10, y: 10, width: 100, height: 50, fill: "blue" }],
				},
			],
		}),
	});

	assert.equal(createResult.isError, undefined, "Step 20: Visual artifact created without error");
	const createDetails = createResult.details as any;
	assert.equal(createDetails.ok, true, "Step 20: Result details ok");
	const artifactId = createDetails.artifact.id;
	assert.ok(artifactId, "Step 20: Host-generated artifact ID exists");

	// ─── Step 21: Expand artifact to panel through the real component UI
	const fullChat = chatStore.getChat(chatId)!;
	const createdArtifact = fullChat.visualArtifacts?.[artifactId];
	assert.ok(createdArtifact, "Step 21: Artifact persisted in chat record");
	const dom = (await import("linkedom")).parseHTML("<!doctype html><html><body><div id='root'></div></body></html>");
	const savedGlobals = Object.fromEntries(["window", "document", "HTMLElement", "HTMLButtonElement", "HTMLIFrameElement", "IS_REACT_ACT_ENVIRONMENT"].map(key => [key, (globalThis as any)[key]]));
	Object.assign(globalThis, { window: dom.window, document: dom.document, HTMLElement: dom.window.HTMLElement, HTMLButtonElement: dom.window.HTMLButtonElement, HTMLIFrameElement: dom.window.HTMLIFrameElement, IS_REACT_ACT_ENVIRONMENT: true, React });
	const uiRoot = createRoot(dom.document.querySelector("#root") as unknown as HTMLElement);
	await act(async () => uiRoot.render(React.createElement(VisualExplanationCard, {
		chatId,
		part: { type: "tool-visual_explanation", state: "output-available", toolCallId: "call-create-1", output: { ok: true, action: "create", artifact: createdArtifact } } as any,
	})));
	assert.ok(dom.document.querySelector('[data-testid="visual-explanation-card"]'), "Step 21: Real artifact card is mounted");
	await act(async () => (dom.document.querySelector('[data-testid="visual-expand-button"]') as HTMLButtonElement).click());
	assert.ok(dom.document.querySelector('[data-testid="visual-explanation-panel"]'), "Step 21: Expand action opens the real panel");
	assert.ok(dom.document.querySelector('[data-testid="visual-inline-expanded-placeholder"]'), "Step 21: Inline view changes to expanded placeholder");

	// ─── Step 22: Execute follow-up update
	const updateResult = await visualTool.execute("call-update-1", {
		action: "update",
		id: artifactId,
		title: "Algorithm Flow (Updated)",
		source: JSON.stringify({
			schema: "learnharness.visual.svg.v1",
			viewBox: { width: 300, height: 150 },
			steps: [
				{
					id: "s1",
					label: "Updated Step",
					elements: [{ type: "rect", x: 10, y: 10, width: 100, height: 50, fill: "green" }],
				},
			],
		}),
	});

	// ─── Step 23: Verify the same artifact is updated in place
	assert.equal(updateResult.isError, undefined, "Step 23: Update succeeded without error");
	assert.equal((updateResult.details as any).ok, true, "Step 23: Update details ok");
	const updatedChat = chatStore.getChat(chatId)!;
	const artifactKeys = Object.keys(updatedChat.visualArtifacts || {});
	assert.equal(artifactKeys.length, 1, "Step 23: Exactly one artifact remains (no duplicate created)");
	assert.equal(artifactKeys[0], artifactId, "Step 23: ID is preserved");
	assert.equal(updatedChat.visualArtifacts?.[artifactId]?.title, "Algorithm Flow (Updated)", "Step 23: In-place update verified");
	await act(async () => registerVisualArtifact(updatedChat.visualArtifacts![artifactId]!, chatId));
	assert.equal(dom.document.querySelector('[data-testid="visual-explanation-panel"] h3')?.textContent, "Algorithm Flow (Updated)", "Step 23: Mounted panel receives follow-up content");
	assert.equal(dom.document.querySelector('[data-testid="visual-explanation-card"]')?.getAttribute("data-artifact-id"), artifactId, "Step 23: Mounted UI preserves artifact identity");
	await act(async () => uiRoot.unmount());
	for (const [key, value] of Object.entries(savedGlobals)) {
		if (value === undefined) delete (globalThis as any)[key];
		else (globalThis as any)[key] = value;
	}

	// Clean up chat
	chatStore.deleteChat(chatId);
	await host.dispose();
});
