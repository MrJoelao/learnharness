/**
 * Tests for Visual Explanation Engine — Agent Tool & ChatStore Persistence (Phase 6)
 */

import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import * as fs from "node:fs";
import { PATHS } from "../config.ts";
import { chatStore } from "../src/store/chats.ts";
import { jobStore } from "../src/store/jobs.ts";
import { createVisualExplanationTool } from "../src/agent/tools/visual-explanation.ts";
import { createTeacherTools } from "../src/agent/tools.ts";
import type { VisualArtifact } from "../src/core/contracts/visual-explanation.ts";

const SAMPLE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><rect width="200" height="100" fill="blue"/></svg>';
const UPDATED_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><rect width="200" height="100" fill="green"/></svg>';

describe("Visual Explanation Agent Tool", () => {
	const createdChatIds: string[] = [];

	beforeEach(() => {
		// Clean test chat creation
	});

	after(() => {
		for (const id of createdChatIds) {
			try {
				chatStore.deleteChat(id);
			} catch {}
		}
	});

	function createTestChat(): string {
		const chat = chatStore.createChat("Visual Tool Test");
		createdChatIds.push(chat.id);
		return chat.id;
	}

	it("creates a new visual artifact and persists it in ChatStore", async () => {
		const chatId = createTestChat();
		const tool = createVisualExplanationTool({ chatId, chatStore });

		const result = await tool.execute("call_1", {
			action: "create",
			id: "stack-visual",
			title: "Stack Frame Layout",
			summary: "Shows call stack growth",
			renderer: "svg",
			source: SAMPLE_SVG,
			presentation: "inline",
			initialState: { step: 0, depth: 1 },
			controls: [
				{ type: "button", id: "btn-next", label: "Push Frame", action: "step-forward" },
			],
			accessibility: {
				description: "Stack grows downwards.",
			},
		});

		assert.equal(result.isError, undefined);
		const details = result.details as { ok: boolean; action: string; artifact: VisualArtifact };
		assert.equal(details.ok, true);
		assert.equal(details.action, "create");
		assert.equal(details.artifact.id, "stack-visual");
		assert.equal(details.artifact.title, "Stack Frame Layout");

		// Verify stored in ChatStore
		const stored = chatStore.getVisualArtifact(chatId, "stack-visual");
		assert.ok(stored);
		assert.equal(stored?.id, "stack-visual");
		assert.equal(stored?.source, SAMPLE_SVG);
		assert.equal(stored?.presentation, "inline");
	});

	it("refuses duplicate artifact creation with the same ID", async () => {
		const chatId = createTestChat();
		const tool = createVisualExplanationTool({ chatId, chatStore });

		// First creation succeeds
		const first = await tool.execute("call_1", {
			action: "create",
			id: "heap-visual",
			title: "Heap Allocation",
			renderer: "svg",
			source: SAMPLE_SVG,
		});
		assert.equal(first.isError, undefined);

		// Second creation with same ID is rejected
		const second = await tool.execute("call_2", {
			action: "create",
			id: "heap-visual",
			title: "Heap Allocation Duplicate",
			renderer: "svg",
			source: UPDATED_SVG,
		});

		assert.equal(second.isError, true);
		const problems = (second.details as { problems?: string[] })?.problems ?? [];
		assert.ok(problems.some((p) => p.includes("already exists")));

		// The original artifact is preserved
		const stored = chatStore.getVisualArtifact(chatId, "heap-visual");
		assert.equal(stored?.source, SAMPLE_SVG);
	});

	it("refuses updating a non-existent artifact ID", async () => {
		const chatId = createTestChat();
		const tool = createVisualExplanationTool({ chatId, chatStore });

		const res = await tool.execute("call_1", {
			action: "update",
			id: "unknown-artifact",
			source: UPDATED_SVG,
		});

		assert.equal(res.isError, true);
		const problems = (res.details as { problems?: string[] })?.problems ?? [];
		assert.ok(problems.some((p) => p.includes("not found")));
	});

	it("successfully updates an existing artifact while preserving its identity", async () => {
		const chatId = createTestChat();
		const tool = createVisualExplanationTool({ chatId, chatStore });

		// Initial creation
		await tool.execute("call_1", {
			action: "create",
			id: "pipeline-1",
			title: "Instruction Pipeline",
			summary: "5-stage RISC pipeline",
			renderer: "svg",
			source: SAMPLE_SVG,
			presentation: "inline",
			initialState: { stage: "IF" },
		});

		// Follow-up update
		const updateRes = await tool.execute("call_2", {
			action: "update",
			id: "pipeline-1",
			title: "Instruction Pipeline (With Forwarding)",
			source: UPDATED_SVG,
			presentation: "panel",
			initialState: { stage: "EX", forwarded: true },
		});

		assert.equal(updateRes.isError, undefined);
		const details = updateRes.details as { ok: boolean; action: string; artifact: VisualArtifact };
		assert.equal(details.ok, true);
		assert.equal(details.action, "update");
		assert.equal(details.artifact.id, "pipeline-1");
		assert.equal(details.artifact.title, "Instruction Pipeline (With Forwarding)");
		assert.equal(details.artifact.presentation, "panel");
		assert.equal(details.artifact.source, UPDATED_SVG);
		assert.deepEqual(details.artifact.initialState, { stage: "EX", forwarded: true });

		// Verify on ChatStore
		const stored = chatStore.getVisualArtifact(chatId, "pipeline-1");
		assert.equal(stored?.title, "Instruction Pipeline (With Forwarding)");
		assert.equal(stored?.source, UPDATED_SVG);
		assert.equal(stored?.presentation, "panel");
	});

	it("preserves the last known good artifact if an update fails validation", async () => {
		const chatId = createTestChat();
		const tool = createVisualExplanationTool({ chatId, chatStore });

		// Create valid initial artifact
		await tool.execute("call_1", {
			action: "create",
			id: "reliable-artifact",
			title: "Reliable Graph",
			renderer: "svg",
			source: SAMPLE_SVG,
		});

		// Attempt an invalid update (e.g. dangerous script injection)
		const invalidUpdate = await tool.execute("call_2", {
			action: "update",
			id: "reliable-artifact",
			source: '<svg><script>evil()</script></svg>',
		});

		assert.equal(invalidUpdate.isError, true);
		const problems = (invalidUpdate.details as { problems?: string[] })?.problems ?? [];
		assert.ok(problems.some((p) => p.includes("Update validation failed")));

		// Invariant verified: last valid version is preserved intact!
		const stored = chatStore.getVisualArtifact(chatId, "reliable-artifact");
		assert.ok(stored);
		assert.equal(stored?.source, SAMPLE_SVG);
		assert.equal(stored?.title, "Reliable Graph");
	});

	it("does not modify unrelated artifacts during an update", async () => {
		const chatId = createTestChat();
		const tool = createVisualExplanationTool({ chatId, chatStore });

		// Create artifact A
		await tool.execute("call_1", {
			action: "create",
			id: "artifact-a",
			title: "Artifact A",
			renderer: "svg",
			source: SAMPLE_SVG,
		});

		// Create artifact B
		await tool.execute("call_2", {
			action: "create",
			id: "artifact-b",
			title: "Artifact B",
			renderer: "svg",
			source: SAMPLE_SVG,
		});

		// Update artifact A only
		await tool.execute("call_3", {
			action: "update",
			id: "artifact-a",
			title: "Artifact A Updated",
			source: UPDATED_SVG,
		});

		// Artifact B must remain untouched
		const storedB = chatStore.getVisualArtifact(chatId, "artifact-b");
		assert.equal(storedB?.title, "Artifact B");
		assert.equal(storedB?.source, SAMPLE_SVG);

		// Artifact A is updated
		const storedA = chatStore.getVisualArtifact(chatId, "artifact-a");
		assert.equal(storedA?.title, "Artifact A Updated");
		assert.equal(storedA?.source, UPDATED_SVG);
	});

	it("is wired into createTeacherTools registry", () => {
		const chatId = createTestChat();
		const tools = createTeacherTools({
			chatId,
			chatStore,
			jobStore,
			spawn: () => {},
		});

		assert.ok(tools.visual_explanation);
		assert.equal(tools.visual_explanation.name, "visual_explanation");
	});
});
