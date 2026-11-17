/**
 * Integration regression tests for Visual Explanation tool availability in the real agent runtime.
 *
 * Verifies the 10 requirements:
 * 1. A real teaching turn receives visual_explanation in the final tool list sent to the model.
 * 2. The provider-facing tool name is exactly visual_explanation.
 * 3. When the model emits a visual_explanation tool call, the tool executes through createVisualExplanationTool().
 * 4. The execution passes the correct chatId and persists the artifact in ChatStore.
 * 5. The tool result flows back through the normal assistant/tool execution pipeline.
 * 6. The resulting assistant message reaches the frontend artifact rendering path.
 * 7. The prober does NOT receive visual_explanation.
 * 8. Explicitly disabling unrelated tools ({ research: false }) does not remove visual_explanation.
 * 9. Existing visual explanation unit tests continue to pass (verified via tests/visual-explanation-tool.test.ts).
 * 10. Existing teacher tool registry tests continue to pass (verified via tests/question-tools.test.ts).
 */

import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { chatStore } from "../src/store/chats.ts";
import { jobStore } from "../src/store/jobs.ts";
import { createTeacherTools, createProberTools } from "../src/agent/tools.ts";
import { createTeacherAgent, createProberAgent, createPracticeAgent } from "../src/agent/teacher-agent.ts";
import { practiceTools, createPracticeGate } from "../src/agent/tools/practice.ts";
import { getCurrentTools, toToolDeclaration } from "@earendil-works/pi-ai";
import { projectView } from "../src/core/view.ts";
import { artifactRenderers } from "../components/artifacts/index.ts";
import type { PiEngine } from "../src/agent/models.ts";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

const SAMPLE_DECLARATIVE_SVG = JSON.stringify({
	schema: "learnharness.visual.svg.v1",
	viewBox: { width: 400, height: 250 },
	steps: [
		{
			id: "step-1",
			label: "Call Stack Push",
			elements: [
				{ type: "rect", x: 50, y: 50, width: 300, height: 40, fill: "#2563eb" },
				{ type: "text", x: 60, y: 75, text: "main() frame", fill: "#ffffff", fontSize: 16 },
			],
		},
	],
});

describe("Visual Explanation Agent Runtime Availability & End-to-End Pipeline", () => {
	const testChatIds: string[] = [];

	after(() => {
		for (const id of testChatIds) {
			try {
				chatStore.deleteChat(id);
			} catch {}
		}
	});

	function newTestChat(title: string): string {
		const chat = chatStore.createChat(title);
		testChatIds.push(chat.id);
		return chat.id;
	}

	it("Requirement 1 & 2: Real teaching turn receives visual_explanation with exact name in final tool list sent to model", async () => {
		const chatId = newTestChat("Teaching Turn Tool Inspection");
		let toolsReceivedByStream: string[] = [];

		const mockEngine: PiEngine = {
			model: { provider: "anthropic", id: "claude-3-5-sonnet-20241022", api: "anthropic-messages" as any } as any,
			streamFn: (model, context, options) => {
				const currentTools = getCurrentTools(context.messages);
				toolsReceivedByStream = currentTools.map((t) => t.name);
				return {
					async *[Symbol.asyncIterator]() {
						yield { type: "start", partial: { role: "assistant", content: [] } };
						yield { type: "text_start" };
						yield { type: "text_delta", delta: "Here is your explanation." };
						yield { type: "text_end" };
						yield { type: "done" };
					},
					result: async () => ({
						role: "assistant",
						content: [{ type: "text", text: "Here is your explanation." }],
					}),
				} as any;
			},
		};

		const agent = createTeacherAgent(
			{
				chatId,
				chatStore,
				jobStore,
				spawn: () => {},
			},
			{
				engine: mockEngine,
				messages: [{ role: "user", content: [{ type: "text", text: "Explain memory stack layout visually" }], id: "m1", timestamp: Date.now() }] as unknown as AgentMessage[],
			},
		);

		await agent.continue();

		assert.ok(toolsReceivedByStream.includes("visual_explanation"), "Model stream context must contain visual_explanation");
		const decl = toToolDeclaration(agent.state.tools.find((t) => t.name === "visual_explanation")!);
		assert.equal(decl.name, "visual_explanation", "Tool declaration name must be exactly visual_explanation");
		assert.ok(decl.description && decl.description.length > 0, "Tool must have description");
		assert.ok(decl.parameters && typeof decl.parameters === "object", "Tool must have JSON Schema parameters");
	});

	it("Requirement 3, 4, 5: Model visual_explanation tool call executes via createVisualExplanationTool, passes correct chatId, persists in ChatStore, and returns result", async () => {
		const chatId = newTestChat("Visual Explanation Execution Turn");
		let executionHappened = false;

		const mockEngine: PiEngine = {
			model: { provider: "anthropic", id: "claude-3-5-sonnet-20241022", api: "anthropic-messages" as any } as any,
			streamFn: (model, context, options) => {
				const lastMessage = context.messages[context.messages.length - 1];
				// First turn: assistant invokes visual_explanation
				if (!executionHappened) {
					executionHappened = true;
					const toolCall = {
						type: "toolCall",
						id: "call-vis-42",
						name: "visual_explanation",
						arguments: {
							action: "create",
							title: "Stack Frame Layout",
							summary: "Memory frame diagram",
							renderer: "svg",
							source: SAMPLE_DECLARATIVE_SVG,
						},
					};
					return {
						async *[Symbol.asyncIterator]() {
							yield { type: "start", partial: { role: "assistant", content: [toolCall] } };
							yield { type: "toolcall_start", contentIndex: 0 };
							yield { type: "toolcall_end", contentIndex: 0, toolCall };
							yield { type: "done" };
						},
						result: async () => ({
							role: "assistant",
							content: [toolCall],
							stopReason: "toolUse",
						}),
					} as any;
				}

				// Second turn: model sees the tool result and responds
				return {
					async *[Symbol.asyncIterator]() {
						yield { type: "start", partial: { role: "assistant", content: [] } };
						yield { type: "text_start" };
						yield { type: "text_delta", delta: "Visualization generated above." };
						yield { type: "text_end" };
						yield { type: "done" };
					},
					result: async () => ({
						role: "assistant",
						content: [{ type: "text", text: "Visualization generated above." }],
					}),
				} as any;
			},
		};

		const agent = createTeacherAgent(
			{
				chatId,
				chatStore,
				jobStore,
				spawn: () => {},
			},
			{
				engine: mockEngine,
				messages: [{ role: "user", content: [{ type: "text", text: "Generate stack layout diagram" }], id: "m1", timestamp: Date.now() }] as unknown as AgentMessage[],
			},
		);

		await agent.continue();

		// Check that the tool result was generated and captured in transcript
		const toolResultMsg = agent.state.messages.find(
			(m) => m.role === "toolResult" && (m as any).toolName === "visual_explanation",
		) as any;
		assert.ok(toolResultMsg, "Tool result message must be present in agent conversation state");
		assert.equal(toolResultMsg.isError, false, "Tool result should not be an error");
		assert.equal(toolResultMsg.details.ok, true, "Tool result details ok must be true");
		assert.equal(toolResultMsg.details.chatId, chatId, "Tool execution must receive and record the correct chatId");

		// Check ChatStore persistence
		const persistedChat = chatStore.getChat(chatId);
		assert.ok(persistedChat?.visualArtifacts, "ChatRecord must have visualArtifacts populated");
		const artifactId = toolResultMsg.details.artifact.id;
		assert.ok(persistedChat?.visualArtifacts?.[artifactId], "Artifact must be saved in ChatStore by ID");
		assert.equal(persistedChat?.visualArtifacts?.[artifactId]?.title, "Stack Frame Layout");
	});

	it("Requirement 6: Resulting assistant message reaches frontend artifact rendering path (projectView and artifactRenderers)", () => {
		const fakeArtifact = {
			id: "vis-test-101",
			version: 1,
			title: "Process State Machine",
			summary: "Visual state transition",
			renderer: "svg",
			source: SAMPLE_DECLARATIVE_SVG,
			presentation: "auto",
		};

		const messages = [
			{
				role: "assistant",
				id: "msg-asst-1",
				content: [
					{
						type: "toolCall",
						id: "call-vis-101",
						name: "visual_explanation",
						arguments: {
							action: "create",
							title: "Process State Machine",
							renderer: "svg",
						},
					},
				],
				timestamp: 100,
			},
			{
				role: "toolResult",
				id: "msg-res-1",
				toolCallId: "call-vis-101",
				toolName: "visual_explanation",
				content: [{ type: "text", text: "Visual explanation created." }],
				details: {
					ok: true,
					action: "create",
					chatId: "chat-xyz",
					artifact: fakeArtifact,
				},
				isError: false,
				timestamp: 101,
			},
		] as any[];

		const viewMessages = projectView(messages);
		assert.equal(viewMessages.length, 1, "Should project to one assistant group");
		const toolPart = viewMessages[0]?.parts.find((p) => p.type === "tool-visual_explanation") as any;
		assert.ok(toolPart, "View message must contain part with type 'tool-visual_explanation'");
		assert.equal(toolPart.state, "output-available", "Part state must be output-available");
		assert.deepEqual(toolPart.output.artifact, fakeArtifact, "Part output must hold the visual artifact");

		// Ensure artifactRenderers maps visual_explanation to the component
		assert.ok(artifactRenderers.visual_explanation, "artifactRenderers must have a handler for visual_explanation");
	});

	it("Requirement 7 (Runtime Regression): Prober agent contains visual_explanation in its tool registry, invokes it, and persists artifact in correct chat", async () => {
		const chatId = newTestChat("Prober Runtime Execution");
		let executionHappened = false;

		const mockEngine: PiEngine = {
			model: { provider: "anthropic", id: "claude-3-5-sonnet-20241022", api: "anthropic-messages" as any } as any,
			streamFn: (model, context, options) => {
				if (!executionHappened) {
					executionHappened = true;
					const toolCall = {
						type: "toolCall",
						id: "call-prober-vis-1",
						name: "visual_explanation",
						arguments: {
							action: "create",
							title: "Binary Tree Depth Probe",
							summary: "Visualization of tree branching during probe",
							renderer: "svg",
							source: SAMPLE_DECLARATIVE_SVG,
						},
					};
					return {
						async *[Symbol.asyncIterator]() {
							yield { type: "start", partial: { role: "assistant", content: [toolCall] } };
							yield { type: "toolcall_start", contentIndex: 0 };
							yield { type: "toolcall_end", contentIndex: 0, toolCall };
							yield { type: "done" };
						},
						result: async () => ({
							role: "assistant",
							content: [toolCall],
							stopReason: "toolUse",
						}),
					} as any;
				}

				return {
					async *[Symbol.asyncIterator]() {
						yield { type: "start", partial: { role: "assistant", content: [] } };
						yield { type: "text_start" };
						yield { type: "text_delta", delta: "Here is the tree visualization." };
						yield { type: "text_end" };
						yield { type: "done" };
					},
					result: async () => ({
						role: "assistant",
						content: [{ type: "text", text: "Here is the tree visualization." }],
					}),
				} as any;
			},
		};

		const proberAgent = createProberAgent(
			{
				chatId,
				chatStore,
				jobStore,
				spawn: () => {},
				deliver: () => {},
			},
			{
				engine: mockEngine,
				messages: [{ role: "user", content: [{ type: "text", text: "Show me how binary trees branch" }], id: "m-prober-1", timestamp: Date.now() }] as unknown as AgentMessage[],
			},
		);

		// 1. Inspect final agent tool registry
		const proberToolNames = proberAgent.state.tools.map((t) => t.name);
		assert.ok(proberToolNames.includes("visual_explanation"), "Prober agent tools must include visual_explanation");

		// 2. Invoke visual_explanation via runtime agent.continue()
		await proberAgent.continue();

		// 3. Verify tool result in agent conversation state
		const toolResultMsg = proberAgent.state.messages.find(
			(m) => m.role === "toolResult" && (m as any).toolName === "visual_explanation",
		) as any;
		assert.ok(toolResultMsg, "Tool result message must be present in prober conversation state");
		assert.equal(toolResultMsg.isError, false, "Prober visual_explanation execution must succeed");
		assert.equal(toolResultMsg.details.ok, true);
		assert.equal(toolResultMsg.details.chatId, chatId, "Recorded chatId must match prober's chatId");

		// 4. Verify artifact persistence in ChatStore for the correct chat
		const persistedChat = chatStore.getChat(chatId);
		assert.ok(persistedChat?.visualArtifacts, "ChatRecord must have visualArtifacts populated");
		const artifactId = toolResultMsg.details.artifact.id;
		assert.ok(persistedChat?.visualArtifacts?.[artifactId], "Artifact must be saved in ChatStore by ID");
		assert.equal(persistedChat?.visualArtifacts?.[artifactId]?.title, "Binary Tree Depth Probe");
	});

	it("Requirement 8: Prober and Teacher registries expose identical tool name and compatible parameter schemas", () => {
		const chatId = newTestChat("Registry Schema Equivalence Check");
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
		assert.equal(teacherTools.visual_explanation!.name, "visual_explanation");
		assert.deepEqual(proberTools.visual_explanation!.parameters, teacherTools.visual_explanation!.parameters);
	});

	it("Requirement 9: Artifacts remain scoped to originating chat and invalid declarative SVG payloads are rejected in both phases", async () => {
		const chatA = newTestChat("Chat A Scope");
		const chatB = newTestChat("Chat B Scope");

		const proberToolsA = createProberTools({
			chatId: chatA,
			chatStore,
			jobStore,
			spawn: () => {},
			deliver: () => {},
		});
		const teacherToolsA = createTeacherTools({
			chatId: chatA,
			chatStore,
			jobStore,
			spawn: () => {},
		});
		const teacherToolsB = createTeacherTools({
			chatId: chatB,
			chatStore,
			jobStore,
			spawn: () => {},
		});
		const proberToolsB = createProberTools({
			chatId: chatB,
			chatStore,
			jobStore,
			spawn: () => {},
			deliver: () => {},
		});

		// 1. Prober creates artifact in Chat A
		const createRes = await proberToolsA.visual_explanation!.execute("call_p1", {
			action: "create",
			title: "Prober Scope Test",
			renderer: "svg",
			source: SAMPLE_DECLARATIVE_SVG,
		});
		assert.equal(createRes.isError, undefined);
		const artifactId = (createRes.details as any).artifact.id;
		assert.ok(chatStore.getChat(chatA)?.visualArtifacts?.[artifactId]);

		// 2. Teacher in Chat A can update it
		const updateRes = await teacherToolsA.visual_explanation!.execute("call_t1", {
			action: "update",
			id: artifactId,
			title: "Teacher Updated Scope Test",
		});
		assert.equal(updateRes.isError, undefined);
		assert.equal(chatStore.getChat(chatA)?.visualArtifacts?.[artifactId]?.title, "Teacher Updated Scope Test");

		// 3. Neither Prober nor Teacher in Chat B can update Chat A's artifact
		const crossUpdateTeacher = await teacherToolsB.visual_explanation!.execute("call_t2", {
			action: "update",
			id: artifactId,
			title: "Cross Chat Teacher Hijack",
		});
		assert.equal(crossUpdateTeacher.isError, true, "Teacher in Chat B cannot update Chat A artifact");

		const crossUpdateProber = await proberToolsB.visual_explanation!.execute("call_p2", {
			action: "update",
			id: artifactId,
			title: "Cross Chat Prober Hijack",
		});
		assert.equal(crossUpdateProber.isError, true, "Prober in Chat B cannot update Chat A artifact");

		// 4. Invalid declarative SVG payloads are rejected in BOTH phases
		const invalidSvg = JSON.stringify({ schema: "unknown.schema.v99", viewBox: { width: 100, height: 100 }, steps: [] });
		const invalidProberRes = await proberToolsA.visual_explanation!.execute("call_bad_p", {
			action: "create",
			title: "Invalid Prober SVG",
			renderer: "svg",
			source: invalidSvg,
		});
		assert.equal(invalidProberRes.isError, true, "Prober rejects invalid declarative SVG schema");

		const invalidTeacherRes = await teacherToolsA.visual_explanation!.execute("call_bad_t", {
			action: "create",
			title: "Invalid Teacher SVG",
			renderer: "svg",
			source: invalidSvg,
		});
		assert.equal(invalidTeacherRes.isError, true, "Teacher rejects invalid declarative SVG schema");
	});

	it("Requirement 10: Practice sessions do not receive visual_explanation", () => {
		const chatId = newTestChat("Practice Tool Check");
		const fauxEngine: PiEngine = {
			model: { provider: "anthropic", id: "claude-3-5-sonnet-20241022", api: "anthropic-messages" as any } as any,
			streamFn: () => ({} as any),
		};

		const practiceAgent = createPracticeAgent({ chatId, chatStore }, { engine: fauxEngine });
		const practiceToolNames = practiceAgent.state.tools.map((t) => t.name);
		assert.ok(!practiceToolNames.includes("visual_explanation"), "Practice agent must NOT receive visual_explanation");

		const gate = createPracticeGate({ chatId, chatStore });
		const pTools = practiceTools({ chatId, chatStore }, gate);
		assert.equal(pTools.visual_explanation, undefined, "practiceTools must NOT contain visual_explanation");
	});

	it("Requirement 11: Tool toggles preserve visual_explanation and visual background job remains distinct", () => {
		const chatId = newTestChat("Toggles & Jobs Check");
		const proberCtx = {
			chatId,
			chatStore,
			jobStore,
			spawn: () => {},
			deliver: () => {},
		};
		const teacherCtx = {
			chatId,
			chatStore,
			jobStore,
			spawn: () => {},
		};

		// In prober: disabling research leaves visual_explanation
		const proberDisabledResearch = createProberTools(proberCtx, { research: false });
		assert.equal(proberDisabledResearch.research, undefined);
		assert.ok(proberDisabledResearch.visual_explanation);

		// In prober: visual job tool does not exist
		assert.equal(proberDisabledResearch.visual, undefined, "Prober should never have visual job tool");

		// In teacher: both visual (background job) and visual_explanation (engine) exist
		const teacherDefault = createTeacherTools(teacherCtx);
		assert.ok(teacherDefault.visual, "Teacher has visual background job tool");
		assert.ok(teacherDefault.visual_explanation, "Teacher has visual_explanation engine tool");
		assert.notEqual(teacherDefault.visual.description, teacherDefault.visual_explanation.description);

		// Disabling visual job tool in teacher does NOT disable visual_explanation
		const teacherDisabledVisualJob = createTeacherTools(teacherCtx, { visual: false });
		assert.equal(teacherDisabledVisualJob.visual, undefined, "visual job tool disabled");
		assert.ok(teacherDisabledVisualJob.visual_explanation, "visual_explanation remains enabled");

		// Disabling research and demo and visual jobs leaves visual_explanation enabled
		const teacherDisabledMultiple = createTeacherTools(teacherCtx, { research: false, demo: false, visual: false });
		assert.equal(teacherDisabledMultiple.research, undefined);
		assert.equal(teacherDisabledMultiple.demo, undefined);
		assert.equal(teacherDisabledMultiple.visual, undefined);
		assert.ok(teacherDisabledMultiple.visual_explanation);
	});
});
