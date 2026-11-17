/**
 * Tests for Visual Explanation Engine — Agent Tool & ChatStore Persistence (Phase 6)
 */

import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { chatStore } from "../src/store/chats.ts";
import { jobStore } from "../src/store/jobs.ts";
import { createVisualExplanationTool } from "../src/agent/tools/visual-explanation.ts";
import { createTeacherTools, createProberTools } from "../src/agent/tools.ts";
import type { VisualArtifact } from "../src/core/contracts/visual-explanation.ts";

const SAMPLE_DECLARATIVE_SVG = JSON.stringify({
	schema: "learnharness.visual.svg.v1",
	viewBox: { width: 200, height: 100 },
	steps: [
		{
			id: "s1",
			label: "Step 1",
			elements: [{ type: "rect", x: 0, y: 0, width: 200, height: 100, fill: "blue" }],
		},
		{
			id: "s2",
			label: "Step 2",
			elements: [{ type: "rect", x: 0, y: 0, width: 200, height: 100, fill: "cyan" }],
		},
	],
});

const UPDATED_DECLARATIVE_SVG = JSON.stringify({
	schema: "learnharness.visual.svg.v1",
	viewBox: { width: 200, height: 100 },
	steps: [
		{
			id: "s1",
			label: "Step 1 Updated",
			elements: [{ type: "rect", x: 0, y: 0, width: 200, height: 100, fill: "green" }],
		},
	],
});

describe("Visual Explanation Agent Tool", () => {
	const createdChatIds: string[] = [];

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

	it("creates a new visual artifact and persists it in ChatStore with host-generated ID", async () => {
		const chatId = createTestChat();
		const tool = createVisualExplanationTool({ chatId, chatStore });

		// Even if model passes an id, host must generate the ID
		const result = await tool.execute("call_1", {
			action: "create",
			id: "model-chosen-id",
			title: "Stack Frame Layout",
			summary: "Shows call stack growth",
			renderer: "svg",
			source: SAMPLE_DECLARATIVE_SVG,
			presentation: "inline",
			initialState: { step: 0 },
			controls: [
				{ type: "button", id: "btn-next", label: "Push Frame", action: "step-forward" },
			],
			accessibility: {
				description: "Stack grows downwards.",
			},
		});

		assert.equal(result.isError, undefined);
		const details = result.details as { ok: boolean; action: string; chatId: string; artifact: VisualArtifact };
		assert.equal(details.ok, true);
		assert.equal(details.action, "create");
		assert.equal(details.chatId, chatId);
		// Host ID generated, model ID ignored
		assert.ok(details.artifact.id.startsWith("vis-"), "Host must generate vis- prefixed ID");
		assert.notEqual(details.artifact.id, "model-chosen-id", "Model ID must not be used on create");
		assert.equal(details.artifact.title, "Stack Frame Layout");

		// Verify stored in ChatStore under host generated ID
		const stored = chatStore.getVisualArtifact(chatId, details.artifact.id);
		assert.ok(stored);
		assert.equal(stored?.id, details.artifact.id);
		assert.equal(stored?.presentation, "inline");
	});

	it("refuses updating a non-existent artifact ID", async () => {
		const chatId = createTestChat();
		const tool = createVisualExplanationTool({ chatId, chatStore });

		const res = await tool.execute("call_1", {
			action: "update",
			id: "unknown-artifact",
			source: UPDATED_DECLARATIVE_SVG,
		});

		assert.equal(res.isError, true);
		const problems = (res.details as { problems?: string[] })?.problems ?? [];
		assert.ok(problems.some((p) => p.includes("not found")));
	});

	it("successfully updates an existing artifact while preserving its identity", async () => {
		const chatId = createTestChat();
		const tool = createVisualExplanationTool({ chatId, chatStore });

		// Initial creation
		const createRes = await tool.execute("call_1", {
			action: "create",
			title: "Instruction Pipeline",
			summary: "5-stage RISC pipeline",
			renderer: "svg",
			source: SAMPLE_DECLARATIVE_SVG,
			presentation: "inline",
			initialState: { step: 0 },
		});
		assert.equal(createRes.isError, undefined);
		const createdId = (createRes.details as { artifact: VisualArtifact }).artifact.id;

		// Follow-up update
		const updateRes = await tool.execute("call_2", {
			action: "update",
			id: createdId,
			title: "Instruction Pipeline (With Forwarding)",
			source: UPDATED_DECLARATIVE_SVG,
			presentation: "panel",
			initialState: { step: 0 },
		});

		assert.equal(updateRes.isError, undefined);
		const details = updateRes.details as { ok: boolean; action: string; artifact: VisualArtifact };
		assert.equal(details.ok, true);
		assert.equal(details.action, "update");
		assert.equal(details.artifact.id, createdId);
		assert.equal(details.artifact.title, "Instruction Pipeline (With Forwarding)");
		assert.equal(details.artifact.presentation, "panel");

		// Verify on ChatStore
		const stored = chatStore.getVisualArtifact(chatId, createdId);
		assert.equal(stored?.title, "Instruction Pipeline (With Forwarding)");
		assert.equal(stored?.presentation, "panel");
	});

	it("preserves the last known good artifact if an update fails validation", async () => {
		const chatId = createTestChat();
		const tool = createVisualExplanationTool({ chatId, chatStore });

		// Create valid initial artifact
		const createRes = await tool.execute("call_1", {
			action: "create",
			title: "Reliable Graph",
			renderer: "svg",
			source: SAMPLE_DECLARATIVE_SVG,
		});
		const createdId = (createRes.details as { artifact: VisualArtifact }).artifact.id;

		// Attempt an invalid update (e.g. raw SVG XML or script injection)
		const invalidUpdate = await tool.execute("call_2", {
			action: "update",
			id: createdId,
			source: "<svg><script>evil()</script></svg>",
		});

		assert.equal(invalidUpdate.isError, true);
		const problems = (invalidUpdate.details as { problems?: string[] })?.problems ?? [];
		assert.ok(problems.some((p) => p.includes("Update validation failed")));

		// Invariant verified: last valid version is preserved intact!
		const stored = chatStore.getVisualArtifact(chatId, createdId);
		assert.ok(stored);
		assert.equal(stored?.title, "Reliable Graph");
	});

	it("does not modify unrelated artifacts during an update", async () => {
		const chatId = createTestChat();
		const tool = createVisualExplanationTool({ chatId, chatStore });

		// Create artifact A
		const resA = await tool.execute("call_1", {
			action: "create",
			title: "Artifact A",
			renderer: "svg",
			source: SAMPLE_DECLARATIVE_SVG,
		});
		const idA = (resA.details as { artifact: VisualArtifact }).artifact.id;

		// Create artifact B
		const resB = await tool.execute("call_2", {
			action: "create",
			title: "Artifact B",
			renderer: "svg",
			source: SAMPLE_DECLARATIVE_SVG,
		});
		const idB = (resB.details as { artifact: VisualArtifact }).artifact.id;

		// Update artifact A only
		await tool.execute("call_3", {
			action: "update",
			id: idA,
			title: "Artifact A Updated",
			source: UPDATED_DECLARATIVE_SVG,
		});

		// Artifact B must remain untouched
		const storedB = chatStore.getVisualArtifact(chatId, idB);
		assert.equal(storedB?.title, "Artifact B");

		// Artifact A is updated
		const storedA = chatStore.getVisualArtifact(chatId, idA);
		assert.equal(storedA?.title, "Artifact A Updated");
	});

	it("BUG P1: rejects raw SVG XML and HTML on create and update", async () => {
		const chatId = createTestChat();
		const tool = createVisualExplanationTool({ chatId, chatStore });

		// Raw SVG XML on create -> rejected
		const rawSvgRes = await tool.execute("call_raw", {
			action: "create",
			title: "Raw SVG",
			source: '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40"/></svg>',
		});
		assert.equal(rawSvgRes.isError, true);
		const rawSvgProblems = (rawSvgRes.details as { problems?: string[] })?.problems ?? [];
		assert.ok(rawSvgProblems.some((p) => p.includes("Raw SVG XML is not permitted")));

		// HTML renderer on create -> rejected
		const htmlRendererRes = await tool.execute("call_html_renderer", {
			action: "create",
			title: "HTML Visual",
			// @ts-expect-error Testing invalid renderer input
			renderer: "html",
			source: "<div>Hello</div>",
		});
		assert.equal(htmlRendererRes.isError, true);

		// HTML source on create -> rejected
		const htmlSourceRes = await tool.execute("call_html_source", {
			action: "create",
			title: "HTML Visual 2",
			source: "<html><body>Not SVG</body></html>",
		});
		assert.equal(htmlSourceRes.isError, true);

		// Create a valid artifact first
		const validCreate = await tool.execute("call_valid", {
			action: "create",
			title: "Valid Artifact",
			source: SAMPLE_DECLARATIVE_SVG,
		});
		const validId = (validCreate.details as { artifact: VisualArtifact }).artifact.id;

		// HTML update -> rejected
		const htmlUpdate = await tool.execute("call_html_up", {
			action: "update",
			id: validId,
			source: "<p>HTML update</p>",
		});
		assert.equal(htmlUpdate.isError, true);

		// Original artifact preserved intact
		const stored = chatStore.getVisualArtifact(chatId, validId);
		assert.equal(stored?.title, "Valid Artifact");
	});

	it("BUG P1: rejects cross-chat updates and isolates artifacts between chats", async () => {
		const chatA = createTestChat();
		const chatB = createTestChat();

		const toolA = createVisualExplanationTool({ chatId: chatA, chatStore });
		const toolB = createVisualExplanationTool({ chatId: chatB, chatStore });

		// Create artifact in Chat A
		const resA = await toolA.execute("call_a", {
			action: "create",
			title: "Chat A Artifact",
			source: SAMPLE_DECLARATIVE_SVG,
		});
		const idA = (resA.details as { artifact: VisualArtifact }).artifact.id;

		// Attempt to update Chat A artifact from Chat B -> must fail
		const hijackRes = await toolB.execute("call_hijack", {
			action: "update",
			id: idA,
			title: "Hijacked",
		});
		assert.equal(hijackRes.isError, true);
		const problems = (hijackRes.details as { problems?: string[] })?.problems ?? [];
		assert.ok(problems.some((p) => p.includes("not found")));

		// Chat A artifact unmodified
		const storedA = chatStore.getVisualArtifact(chatA, idA);
		assert.equal(storedA?.title, "Chat A Artifact");
	});

	it("BUG P2: enforces button-only controls and control count limits", async () => {
		const chatId = createTestChat();
		const tool = createVisualExplanationTool({ chatId, chatStore });

		// 8 button controls: accepted
		const eightControls = Array.from({ length: 8 }, (_, i) => ({
			type: "button" as const,
			id: `btn-${i}`,
			label: `Action ${i}`,
			action: "step-forward" as const,
		}));

		const validControlsRes = await tool.execute("call_8_ctrls", {
			action: "create",
			title: "8 Controls Visual",
			source: SAMPLE_DECLARATIVE_SVG,
			controls: eightControls,
		});
		assert.equal(validControlsRes.isError, undefined);

		// 9 button controls: rejected
		const nineControls = Array.from({ length: 9 }, (_, i) => ({
			type: "button" as const,
			id: `btn-${i}`,
			label: `Action ${i}`,
			action: "step-forward" as const,
		}));

		const invalidControlsRes = await tool.execute("call_9_ctrls", {
			action: "create",
			title: "9 Controls Visual",
			source: SAMPLE_DECLARATIVE_SVG,
			controls: nineControls,
		});
		assert.equal(invalidControlsRes.isError, true);

		// Non-button controls (slider, toggle, select) -> rejected
		const sliderRes = await tool.execute("call_slider", {
			action: "create",
			title: "Slider Visual",
			source: SAMPLE_DECLARATIVE_SVG,
			// @ts-expect-error Testing invalid control type
			controls: [{ type: "slider", id: "speed", label: "Speed", min: 1, max: 10, value: 5 }],
		});
		assert.equal(sliderRes.isError, true);
	});

	it("BUG P2: validates initialState.step against declarative steps count", async () => {
		const chatId = createTestChat();
		const tool = createVisualExplanationTool({ chatId, chatStore });

		// Step out of bounds (step 99 when there are only 2 steps: indices 0 and 1) -> rejected
		const outOfBoundsRes = await tool.execute("call_oob", {
			action: "create",
			title: "Out of Bounds Step",
			source: SAMPLE_DECLARATIVE_SVG,
			initialState: { step: 99 },
		});
		assert.equal(outOfBoundsRes.isError, true);
		const oobProblems = (outOfBoundsRes.details as { problems?: string[] })?.problems ?? [];
		assert.ok(oobProblems.some((p) => p.includes("initialState.step (99) exceeds maximum step index (1)")));

		// Negative step -> rejected
		const negativeStepRes = await tool.execute("call_neg", {
			action: "create",
			title: "Negative Step",
			source: SAMPLE_DECLARATIVE_SVG,
			initialState: { step: -1 },
		});
		assert.equal(negativeStepRes.isError, true);
		const negProblems = (negativeStepRes.details as { problems?: string[] })?.problems ?? [];
		assert.ok(negProblems.some((p) => p.includes("cannot be negative")));

		// Valid step (step: 1) -> accepted
		const validStepRes = await tool.execute("call_valid_step", {
			action: "create",
			title: "Valid Step",
			source: SAMPLE_DECLARATIVE_SVG,
			initialState: { step: 1 },
		});
		assert.equal(validStepRes.isError, undefined);
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

	it("is wired into createProberTools registry and matches createTeacherTools", () => {
		const chatId = createTestChat();
		const proberTools = createProberTools({
			chatId,
			chatStore,
			jobStore,
			spawn: () => {},
			deliver: () => {},
		});
		const teacherTools = createTeacherTools({
			chatId,
			chatStore,
			jobStore,
			spawn: () => {},
		});

		assert.ok(proberTools.visual_explanation, "createProberTools must contain visual_explanation");
		assert.ok(teacherTools.visual_explanation, "createTeacherTools must contain visual_explanation");
		assert.equal(proberTools.visual_explanation!.name, "visual_explanation");
		assert.equal(proberTools.visual_explanation!.name, teacherTools.visual_explanation!.name);
		assert.deepEqual(proberTools.visual_explanation!.parameters, teacherTools.visual_explanation!.parameters);
	});
});
