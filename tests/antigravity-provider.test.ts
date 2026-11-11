import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import * as cortexkit from "@cortexkit/antigravity-auth-core";

const require = createRequire(import.meta.url);
const { createProvider, MODEL_IDS, PROVIDER_ID, startCallbackServer } = require("../src/agent/antigravity-provider.cjs") as { createProvider: (sdk: Record<string, unknown>, core: Record<string, unknown>) => any; MODEL_IDS: string[]; PROVIDER_ID: string; startCallbackServer: (state: string, complete: (code: string, state: string) => unknown, signal: AbortSignal, port?: number) => Promise<{ wait(): Promise<unknown>; port: number; close(): void }> };
async function collect(source: AsyncIterable<any>) { const events = []; for await (const event of source) events.push(event); return events; }
const EXPECTED_MODELS = [
	"antigravity-gemini-3.8-flash",
	"antigravity-gemini-3.5-flash",
	"antigravity-gemini-4-argon",
	"antigravity-claude-sonnet-5-5",
	"antigravity-claude-opus-5-5",
	"antigravity-gpt-oss-120b-medium",
];

function fixture() {
	const requests: Array<{ url: string; init: RequestInit }> = [];
	const resolvedModels: string[] = [];
	const oauthResult = { type: "success", access: "access-fixture", refresh: "refresh-fixture|project-fixture", expires: 10_000, email: "learner@example.test" };
	const definitions = Object.fromEntries(EXPECTED_MODELS.map((id) => [id, {
		name: id,
		limit: { context: 1000, output: 100 },
		modalities: { input: ["text", "image", "pdf"], output: ["text"] },
		reasoning: true,
		...(id === "antigravity-gpt-oss-120b-medium" ? {} : { variants: { low: { thinkingLevel: "low" }, medium: { thinkingLevel: "medium" }, high: { thinkingLevel: "high" } } }),
	}]));
	const core: Record<string, any> = {
		ANTIGRAVITY_ENDPOINT: "https://daily-cloudcode-pa.googleapis.com",
		ANTIGRAVITY_LOAD_ENDPOINTS: ["https://daily-cloudcode-pa.googleapis.com"],
		getPublicModelDefinitions: () => definitions,
		authorizeAntigravity: async () => ({ url: "https://accounts.google.com/o/oauth2/v2/auth?state=STATE" }),
		exchangeAntigravity: async () => oauthResult,
		fetchAvailableModels: async () => ({ models: Object.fromEntries(EXPECTED_MODELS.map((id) => [id.replace(/^antigravity-/, ""), { modelName: id.replace(/^antigravity-/, "") }])) }),
		parseRefreshParts: (refresh: string) => ({ refreshToken: refresh.split("|")[0], projectId: refresh.split("|")[1] }),
		formatRefreshParts: ({ refreshToken, projectId }: { refreshToken: string; projectId?: string }) => `${refreshToken}|${projectId ?? ""}`,
		refreshAntigravityToken: async () => ({ access: "rotated-access", refresh: "rotated-refresh", expires: 20_000 }),
		toGeminiSchema: (schema: unknown) => schema,
		resolveAntigravityModel: (model: string) => { resolvedModels.push(model); return cortexkit.resolveAntigravityModel(model); },
		AgyRequestSessionStore: class { beginRequest() { return { session: { conversationId: "conversation-fixture", trajectoryId: "trajectory-fixture" }, timestamp: 1 }; } completeExecution() {} },
		buildAgyAgentRequestMetadata: () => ({ labels: { app: "learnharness" }, sessionId: "session-fixture", requestId: "request-fixture" }),
		orderAgyRequestPayloadInPlace: () => {},
		ensureProjectContext: async () => ({ effectiveProjectId: "project-fixture" }),
		buildAntigravityHarnessUserAgent: () => "fixture-agent",
	};
	const sdk: Record<string, any> = {
		getCurrentSystemPrompt: () => "Tutor system prompt",
		getCurrentTools: () => [],
		createAssistantMessageEventStream,
		calculateCost: () => {},
	};
	const provider = createProvider(sdk, core);
	return { provider, core, requests, resolvedModels };
}

test("Antigravity provider registers the six requested models, capabilities, thinking levels and OAuth callback state", async () => {
	const { provider, core } = fixture();
	assert.equal(provider.id, PROVIDER_ID);
	assert.deepEqual(provider.getModels().map((model: { id: string }) => model.id), EXPECTED_MODELS);
	for (const model of provider.getModels()) assert.ok(model.input.includes("image"), `${model.id} can be selected in Vision`);
	for (const model of provider.getModels().filter((entry: { id: string }) => entry.id !== "antigravity-gpt-oss-120b-medium")) {
		assert.deepEqual(getSupportedThinkingLevels(model), ["off", "low", "medium", "high"]);
	}
	const gptOss = provider.getModels().find((model: { id: string }) => model.id === "antigravity-gpt-oss-120b-medium");
	assert.deepEqual(getSupportedThinkingLevels(gptOss), ["medium"]);
	const credential = await provider.auth.oauth.login({
		signal: new AbortController().signal,
		notify: () => {},
		prompt: async () => "http://localhost:51121/oauth-callback?code=code-fixture&state=STATE",
	});
	assert.equal(credential.access, "access-fixture");
	assert.equal(credential.refresh, "refresh-fixture|project-fixture");
	assert.deepEqual(credential.availableModelIds, EXPECTED_MODELS);
	assert.deepEqual(await provider.auth.oauth.refresh(credential, new AbortController().signal), { ...credential, access: "rotated-access", refresh: "rotated-refresh|project-fixture", expires: 20_000 });
	let exchangeCalls = 0;
	core.exchangeAntigravity = async () => { exchangeCalls++; return { type: "success" }; };
	await assert.rejects(provider.auth.oauth.login({ signal: new AbortController().signal, notify: () => {}, prompt: async () => "http://localhost:51121/oauth-callback?code=bad&state=OTHER" }), /state/i);
	assert.equal(exchangeCalls, 0);
});

test("Antigravity filters the picker to exact account catalog models without substituting routes", () => {
	const { provider, core } = fixture();
	core.fetchAvailableModels = async () => ({ models: { "gemini-3.8-flash": { modelName: "gemini-3.8-flash" }, "gemini-3.7-flash": { modelName: "gemini-3.7-flash" } } });
	const visible = provider.filterModels(provider.getModels(), { availableModelIds: ["antigravity-gemini-3.8-flash"] });
	assert.deepEqual(visible.map((model: { id: string }) => model.id), ["antigravity-gemini-3.8-flash"]);
	assert.deepEqual(provider.filterModels(provider.getModels(), { availableModelIds: [] }), []);
	assert.equal(core.resolveAntigravityModel("antigravity-gemini-3.8-flash-medium").actualModel, "gemini-3.8-flash-medium");
});

test("Antigravity OAuth stores only the model names returned by the connected account", async () => {
	const { provider, core } = fixture();
	core.fetchAvailableModels = async () => ({ models: { "gemini-3.8-flash": { modelName: "gemini-3.8-flash" }, "gemini-3.7-flash": { modelName: "gemini-3.7-flash" } } });
	const credential = await provider.auth.oauth.login({ signal: new AbortController().signal, notify: () => {}, prompt: async () => "http://localhost:51121/oauth-callback?code=code-fixture&state=STATE" });
	assert.deepEqual(credential.availableModelIds, ["antigravity-gemini-3.8-flash"]);
	assert.deepEqual(provider.filterModels(provider.getModels(), credential).map((model: { id: string }) => model.id), ["antigravity-gemini-3.8-flash"]);
});

test("Antigravity local callback validates OAuth state and completes the browser response", async () => {
	const callback = await startCallbackServer("state-fixture", async (code, state) => ({ code, state }), new AbortController().signal, 0);
	try {
		const wrongState = await fetch(`http://127.0.0.1:${callback.port}/oauth-callback?code=bad&state=wrong`);
		assert.equal(wrongState.status, 400);
		const response = await fetch(`http://127.0.0.1:${callback.port}/oauth-callback?code=good&state=state-fixture`);
		assert.equal(response.status, 200);
		assert.match(await response.text(), /Sign-in complete/);
		assert.deepEqual(await callback.wait(), { code: "good", state: "state-fixture" });
	} finally { callback.close(); }
});

test("Antigravity routes each catalog model at its selected thinking level and sends user images", async () => {
	const { provider, resolvedModels } = fixture();
	let payload: any;
	const image = { type: "image", mimeType: "image/png", data: "aGVsbG8=" };
	const response = new Response('data: {"response":{"candidates":[{"content":{"role":"model","parts":[{"text":"Seen."}]},"finishReason":"STOP"}]}}\n\n', { status: 200 });
	const model = provider.getModels().find((entry: { id: string }) => entry.id === "antigravity-claude-sonnet-5-5");
	await collect(provider.streamSimple(model, {
		messages: [{ role: "user", content: [{ type: "text", text: "Describe this." }, image], timestamp: 1 }],
	}, {
		apiKey: "private-access-token",
		reasoning: "high",
		fetch: async (_url: string, init: RequestInit) => {
			payload = JSON.parse(String(init.body));
			return response;
		},
	}));
	assert.deepEqual(resolvedModels, ["antigravity-claude-sonnet-5-5-high"]);
	assert.equal(payload.model, "claude-sonnet-5-5-high");
	assert.deepEqual(payload.request.contents[0].parts, [
		{ text: "Describe this." },
		{ inlineData: { mimeType: "image/png", data: "aGVsbG8=" } },
	]);
});

test("GPT-OSS keeps its catalogued medium route without appending a duplicate thinking suffix", async () => {
	const { provider, resolvedModels } = fixture();
	const model = provider.getModels().find((entry: { id: string }) => entry.id === "antigravity-gpt-oss-120b-medium");
	const response = new Response('data: {"response":{"candidates":[{"content":{"role":"model","parts":[{"text":"Ready."}]},"finishReason":"STOP"}]}}\n\n', { status: 200 });
	let payload: any;
	await collect(provider.streamSimple(model, { messages: [{ role: "user", content: "Go", timestamp: 1 }] }, {
		apiKey: "private-access-token", reasoning: "medium", fetch: async (_url: string, init: RequestInit) => { payload = JSON.parse(String(init.body)); return response; },
	}));
	assert.deepEqual(resolvedModels, ["antigravity-gpt-oss-120b-medium"]);
	assert.equal(payload.model, "gpt-oss-120b-medium");
});

test("Antigravity drops provider signatures when replaying another Antigravity model's transcript", async () => {
	const { provider } = fixture();
	let payload: any;
	const response = new Response('data: {"response":{"candidates":[{"content":{"role":"model","parts":[{"text":"Continued."}]},"finishReason":"STOP"}]}}\n\n', { status: 200 });
	const currentModel = provider.getModels().find((entry: { id: string }) => entry.id === "antigravity-gemini-3.8-flash");
	await collect(provider.streamSimple(currentModel, { messages: [
		{ role: "assistant", provider: PROVIDER_ID, model: "antigravity-claude-sonnet-5-5", content: [
			{ type: "thinking", thinking: "Prior reasoning", thinkingSignature: "opaque-signature" },
			{ type: "text", text: "Prior answer", textSignature: "opaque-text-signature" },
		], timestamp: 1 },
		{ role: "user", content: "Continue", timestamp: 2 },
	] }, {
		apiKey: "private-access-token",
		fetch: async (_url: string, init: RequestInit) => { payload = JSON.parse(String(init.body)); return response; },
	}));
	assert.deepEqual(payload.request.contents[0], { role: "model", parts: [{ text: "Prior reasoning" }, { text: "Prior answer" }] });
});

test("Antigravity streaming maps system/tools, emits text and usage, and does not retry", async () => {
	const { provider } = fixture();
	let payload: any;
	let fetches = 0;
	const response = new Response('data: {"response":{"candidates":[{"content":{"role":"model","parts":[{"text":"Tutored."}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":8,"candidatesTokenCount":2}}}\n\n', { status: 200, headers: { "content-type": "text/event-stream" } });
	const events = await collect(provider.streamSimple(provider.getModels()[0], {
		systemPrompt: "Tutor system prompt", tools: [{ name: "quiz", description: "Ask learner", parameters: { type: "object", properties: {} } }],
		messages: [{ role: "user", content: "Teach me" , timestamp: 1 }],
	}, {
		apiKey: "private-access-token",
		reasoning: "high",
		fetch: async (url: string, init: RequestInit) => { fetches++; assert.equal(url, "https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse"); requestsPush(url, init); return response; },
		onPayload: (value: unknown) => { payload = value; return undefined; },
	}));
	function requestsPush(url: string, init: RequestInit) { assert.match(url, /cloudcode-pa/); assert.equal(init.method, "POST"); }
	assert.equal(fetches, 1);
	assert.equal(payload.model, "gemini-3.8-flash-high");
	assert.equal(payload.project, "project-fixture");
	assert.equal(payload.request.systemInstruction.parts[0].text, "Tutor system prompt");
	assert.equal(payload.request.tools[0].functionDeclarations[0].name, "quiz");
	const result = events.find((event) => event.type === "done")?.message;
	assert.ok(result);
	assert.ok(events.some((event) => event.type === "text_delta" && event.delta === "Tutored."));
	assert.equal(result.content[0].text, "Tutored.");
	assert.equal(result.usage.input, 8);
	assert.equal(result.usage.output, 2);
});

test("Antigravity streaming reports 429 as an error without retry or fallback", async () => {
	const { provider } = fixture();
	let fetches = 0;
	const events = await collect(provider.streamSimple(provider.getModels()[0], { messages: [{ role: "user", content: "Teach me", timestamp: 1 }] }, {
		apiKey: "private-access-token", fetch: async () => { fetches++; return new Response("", { status: 429 }); },
	}));
	assert.equal(fetches, 1);
	const result = events.find((event) => event.type === "error")?.error;
	assert.ok(result);
	assert.equal(result.stopReason, "error");
	assert.match(result.errorMessage ?? "", /429/);
	assert.equal(result.content.length, 0);
});

test("Antigravity preserves tool call IDs and thought signatures when replaying a tool result", async () => {
	const { provider } = fixture();
	let payload: any;
	const body = 'data: {"response":{"candidates":[{"content":{"role":"model","parts":[{"functionCall":{"name":"quiz","args":{"question":"Why?"},"id":"call-fixture"},"thoughtSignature":"signature-fixture"}]},"finishReason":"STOP"}]}}\n\n';
	const events = await collect(provider.streamSimple(provider.getModels()[0], {
		messages: [
			{ role: "user", content: "Teach me", timestamp: 1 },
			{ role: "assistant", provider: PROVIDER_ID, model: EXPECTED_MODELS[0], content: [{ type: "toolCall", id: "prior-call", name: "quiz", arguments: { question: "Why?" }, thoughtSignature: "prior-signature" }], timestamp: 2 },
			{ role: "toolResult", toolCallId: "prior-call", toolName: "quiz", content: [
				{ type: "text", text: "Learner answer" },
				{ type: "image", mimeType: "image/png", data: "aGVsbG8=" },
			], timestamp: 3 },
		],
	}, { apiKey: "private-access-token", fetch: async () => new Response(body, { status: 200 }), onPayload: (value: unknown) => { payload = value; } }));
	const call = events.find((event) => event.type === "toolcall_end")?.toolCall;
	assert.equal(call?.id, "call-fixture");
	assert.equal(call?.thoughtSignature, "signature-fixture");
	const modelTurn = payload.request.contents.find((item: any) => item.role === "model" && item.parts.some((part: any) => part.functionCall));
	assert.equal(modelTurn.parts[0].functionCall.id, "prior-call");
	assert.equal(modelTurn.parts[0].thoughtSignature, "prior-signature");
	const replay = payload.request.contents.find((item: any) => item.parts.some((part: any) => part.functionResponse));
	assert.equal(replay.role, "model");
	assert.equal(replay.parts[0].functionResponse.id, "prior-call");
	assert.equal(replay.parts[0].functionResponse.response.output, "Learner answer");
	assert.deepEqual(replay.parts[0].functionResponse.parts, [{ inlineData: { mimeType: "image/png", data: "aGVsbG8=" } }]);
});
