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
import { createTeacherAgent, createProberAgent } from "../src/agent/teacher-agent.ts";
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

	it("Requirement 7: The prober does NOT receive visual_explanation", () => {
		const chatId = newTestChat("Prober Tool Check");
		const proberTools = createProberTools({
			chatId,
			chatStore,
			jobStore,
			spawn: () => {},
			deliver: () => {},
		});

		assert.equal(proberTools.visual_explanation, undefined, "createProberTools must not contain visual_explanation");

		const fauxEngine: PiEngine = {
			model: { provider: "anthropic", id: "claude-3-5-sonnet-20241022", api: "anthropic-messages" as any } as any,
			streamFn: () => ({} as any),
		};

		const proberAgent = createProberAgent(
			{
				chatId,
				chatStore,
				jobStore,
				spawn: () => {},
				deliver: () => {},
			},
			{ engine: fauxEngine },
		);

		const proberToolNames = proberAgent.state.tools.map((t) => t.name);
		assert.ok(!proberToolNames.includes("visual_explanation"), "Prober agent tools must not include visual_explanation");
	});

	it("Requirement 8: Explicitly disabling unrelated tools ({ research: false }) does not remove visual_explanation", () => {
		const chatId = newTestChat("Teacher Toggles Check");
		const ctx = {
			chatId,
			chatStore,
			jobStore,
			spawn: () => {},
		};

		const toolsWithResearchDisabled = createTeacherTools(ctx, { research: false });
		assert.equal(toolsWithResearchDisabled.research, undefined, "research should be removed when toggled false");
		assert.ok(toolsWithResearchDisabled.visual_explanation, "visual_explanation must remain enabled when research is disabled");
		assert.equal(toolsWithResearchDisabled.visual_explanation.name, "visual_explanation");

		const toolsWithMultipleToggles = createTeacherTools(ctx, { research: false, demo: false, visual: false });
		assert.ok(toolsWithMultipleToggles.visual_explanation, "visual_explanation must survive toggles of other job tools");
	});
});
