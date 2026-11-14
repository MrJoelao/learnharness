import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { it } from "node:test";
import { parseWorkspaceId } from "../src/core/workspaces.ts";
import { createPluginWorkspaceState } from "../src/store/plugin-workspace-state.ts";

it("stores bounded plugin JSON independently per workspace and validates keys", () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-workspace-state-"));
	try {
		const first = createPluginWorkspaceState(root, parseWorkspaceId("workspace_00000000-0000-4000-8000-000000000001"));
		const second = createPluginWorkspaceState(root, parseWorkspaceId("workspace_00000000-0000-4000-8000-000000000002"));
		assert.equal(first.get("state"), undefined);
		first.set("state", { count: 3 });
		assert.deepEqual(first.get("state"), { count: 3 });
		assert.equal(second.get("state"), undefined);
		first.delete("state");
		assert.equal(first.get("state"), undefined);
		assert.throws(() => first.get("../outside"), /Invalid workspace state key/);
		assert.throws(() => first.set("huge", "x".repeat(1_048_577)), /1 MiB/);
	} finally { fs.rmSync(root, { recursive: true, force: true }); }
});

it("refuses a symlinked workspace state parent", () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-workspace-state-link-"));
	const outside = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-workspace-state-outside-"));
	try {
		fs.symlinkSync(outside, path.join(root, "workspaces"), "dir");
		const store = createPluginWorkspaceState(root, parseWorkspaceId("workspace_00000000-0000-4000-8000-000000000003"));
		assert.throws(() => store.set("key", "value"), /Unsafe workspace state parent/);
		assert.deepEqual(fs.readdirSync(outside), []);
	} finally { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); }
});
