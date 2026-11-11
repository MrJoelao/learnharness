"use strict";

/*
 * LearnHarness adapter for the MIT-licensed CortexKit Antigravity core.
 * The core supplies OAuth, project resolution, request metadata, schema
 * normalization and the low-level transport. This adapter owns only the
 * LearnHarness/pi-ai provider boundary and Gemini transcript/SSE mapping.
 *
 * Google explicitly prohibits third-party Antigravity access. This adapter
 * is an unofficial integration and is not officially supported by Google.
 */

const MODEL_IDS = [
		"antigravity-gemini-3.8-flash",
		"antigravity-gemini-3.5-flash",
		"antigravity-gemini-4-argon",
		"antigravity-claude-sonnet-5-5",
		"antigravity-claude-opus-5-5",
		"antigravity-gpt-oss-120b-medium",
	];
const GPT_OSS_MODEL_ID = "antigravity-gpt-oss-120b-medium";
const PROVIDER_ID = "google-antigravity";
const API = "google-generative-ai";
const crypto = require("node:crypto");
const http = require("node:http");
const CALLBACK_PORT = 51121;
const CALLBACK_PATH = "/oauth-callback";
let requestSessions;

function callbackPage(response, status, message) {
	response.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'", "x-content-type-options": "nosniff" });
	response.end(`<!doctype html><html><head><meta charset="utf-8"><title>LearnHarness sign-in</title></head><body><p>${message}</p></body></html>`);
}

async function startCallbackServer(state, complete, signal, port = CALLBACK_PORT) {
	if (signal?.aborted) throw new Error("Sign-in cancelled.");
	let resolveWait, rejectWait, settled = false, claimed = false;
	const wait = new Promise((resolve, reject) => { resolveWait = resolve; rejectWait = reject; });
	wait.catch(() => {});
	const finish = (error, value) => {
		if (settled) return;
		settled = true;
		signal?.removeEventListener("abort", onAbort);
		if (error) rejectWait(error); else resolveWait(value);
	};
	const onAbort = () => finish(new Error("Sign-in cancelled."));
	const server = http.createServer((request, response) => {
		const url = new URL(request.url ?? "/", "http://localhost");
		if (request.method !== "GET" || url.pathname !== CALLBACK_PATH) { callbackPage(response, 404, "Callback route not found."); return; }
		if (url.searchParams.get("state") !== state) { callbackPage(response, 400, "Sign-in state did not match. Return to LearnHarness and retry."); return; }
		if (claimed || settled) { callbackPage(response, 409, "This sign-in has already been handled. Return to LearnHarness."); return; }
		const providerError = url.searchParams.get("error");
		if (providerError) { callbackPage(response, 400, "Google sign-in was cancelled or denied. Return to LearnHarness."); finish(new Error("Google sign-in was denied or cancelled.")); return; }
		const code = url.searchParams.get("code");
		if (!code) { callbackPage(response, 400, "The callback did not contain an authorization code. Return to LearnHarness."); return; }
		claimed = true;
		void complete(code, state).then((credential) => {
			callbackPage(response, 200, "Sign-in complete. Return to LearnHarness.");
			finish(undefined, credential);
		}, () => {
			callbackPage(response, 502, "LearnHarness could not complete sign-in. Return to the app and retry.");
			finish(new Error("Google Antigravity sign-in could not be completed."));
		});
	});
	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(port, "127.0.0.1", () => { server.off("error", reject); resolve(); });
	}).catch((error) => { server.close(); throw error; });
	signal?.addEventListener("abort", onAbort, { once: true });
	if (signal?.aborted) onAbort();
	return {
		wait: () => wait,
		port: server.address()?.port,
		close() { finish(new Error("Sign-in callback closed.")); server.close(); },
	};
}

function availableModelsFromCatalog(models, core) {
	const names = new Set();
	for (const [key, entry] of Object.entries(models ?? {})) {
		for (const value of [key, entry?.modelName]) {
			if (typeof value !== "string") continue;
			const normalized = value.toLowerCase().replace(/^models\//, "");
			names.add(normalized);
		}
	}
	return MODEL_IDS.filter((id) => {
		const aliases = new Set([id.replace(/^antigravity-/, "").toLowerCase()]);
		for (const tier of ["low", "medium", "high"]) {
			try {
				const route = core.resolveAntigravityModel(`${id}-${tier}`).actualModel;
				aliases.add(route.toLowerCase());
				aliases.add(route.toLowerCase().replace(/-(?:extra-low|low|medium|high)$/, ""));
			} catch { /* model has no tiered route */ }
		}
		// Add fallback mappings for Claude models to handle version differences
		if (id.includes("claude-sonnet-5-5")) {
			aliases.add("claude-sonnet-4-6");
			aliases.add("claude-sonnet-4-6-medium");
		}
		if (id.includes("claude-opus-5-5")) {
			aliases.add("claude-opus-4-6-thinking");
		}
		return [...aliases].some((alias) => names.has(alias));
	});
}

async function fetchAccountModelIds(core, access, refresh) {
	const auth = { type: "oauth", access, refresh, expires: Date.now() + 60_000 };
	const project = await core.ensureProjectContext(auth);
	if (!project.effectiveProjectId) throw new Error("Google Antigravity did not provide a usable project context.");
	const catalog = await core.fetchAvailableModels({ accessToken: access, projectId: project.effectiveProjectId, endpoints: core.ANTIGRAVITY_LOAD_ENDPOINTS });
	return availableModelsFromCatalog(catalog.models, core);
}

function text(value) {
	return typeof value === "string" ? value.replace(/[\uD800-\uDFFF]/gu, "\uFFFD") : "";
}

function toParts(content) {
	const parts = [];
	for (const item of Array.isArray(content) ? content : []) {
		if (item?.type === "text" && item.text) parts.push({ text: text(item.text) });
		else if (item?.type === "image") {
			if (typeof item.data !== "string" || !/^image\/(?:png|jpe?g|webp|gif|heic|heif)$/i.test(item.mimeType ?? "")) {
				throw new Error("Antigravity image input has an unsupported format.");
			}
			parts.push({ inlineData: { mimeType: item.mimeType, data: item.data } });
		}
	}
	return parts;
}

function buildRequest(context, core, requestModelId) {
	const contents = [];
	const calls = new Map();
	for (const message of context.messages ?? []) {
		if (message?.role !== "assistant") continue;
		for (const block of message.content ?? []) if (block.type === "toolCall") calls.set(block.id, message.provider === PROVIDER_ID && MODEL_IDS.includes(message.model));
	}
	for (const message of context.messages ?? []) {
		if (!message) continue;
		if (message.role === "system") continue;
		if (message.role === "user") {
			const parts = typeof message.content === "string" ? (message.content.trim() ? [{ text: text(message.content) }] : []) : toParts(message.content);
			if (parts.length) contents.push({ role: "user", parts });
		} else if (message.role === "assistant") {
			const parts = [];
			const sameModel = message.provider === PROVIDER_ID && message.model === requestModelId;
			for (const block of message.content ?? []) {
				if (block.type === "thinking" && block.thinking) parts.push({ text: text(block.thinking), ...(sameModel ? { thought: true, ...(block.thinkingSignature ? { thoughtSignature: block.thinkingSignature } : {}) } : {}) });
				else if (block.type === "text" && block.text.trim()) parts.push({ text: text(block.text), ...(sameModel && block.textSignature ? { thoughtSignature: block.textSignature } : {}) });
				else if (block.type === "toolCall") parts.push({ functionCall: { name: block.name, args: block.arguments ?? {}, id: block.id }, ...(sameModel && block.thoughtSignature ? { thoughtSignature: block.thoughtSignature } : {}) });
			}
			if (parts.length) contents.push({ role: "model", parts });
		} else if (message.role === "toolResult") {
			const resultParts = toParts(message.content);
			const images = resultParts.filter((part) => part.inlineData);
			const output = (message.content ?? []).filter((part) => part.type === "text").map((part) => text(part.text)).join("\n");
			const response = message.isError ? { error: output || "Error" } : { output: output || (images.length ? "(see attached image)" : "") };
			const part = { functionResponse: { name: message.toolName, response, ...(images.length ? { parts: images } : {}), id: message.toolCallId } };
			const role = calls.get(message.toolCallId) ? "model" : "user";
			const last = contents.at(-1);
			if (last?.role === role && last.parts.every((entry) => entry.functionResponse)) last.parts.push(part);
			else contents.push({ role, parts: [part] });
		}
	}
	const request = { contents };
	const hasSystemMessages = (context.messages ?? []).some((message) => message?.role === "system");
	const system = hasSystemMessages && typeof sdkSystemPrompt === "function" ? sdkSystemPrompt(context.messages ?? []) : context.systemPrompt || (context.messages ?? []).filter((m) => m?.role === "system").map((m) => typeof m.content === "string" ? m.content : "").filter(Boolean).join("\n");
	if (system.trim()) request.systemInstruction = { parts: [{ text: text(system) }] };
	const tools = hasSystemMessages && typeof sdkTools === "function" ? sdkTools(context.messages ?? []) : context.tools ?? [];
	if (tools.length) request.tools = [{ functionDeclarations: tools.map((tool) => ({ name: tool.name, description: tool.description, parameters: core.toGeminiSchema(tool.parameters) })) }];
	return request;
}

let sdkSystemPrompt;
let sdkTools;

function createProvider(sdk, core, options = {}) {
	const models = core.getPublicModelDefinitions();
	const providerModels = MODEL_IDS.map((id) => {
		const publicModel = models[id];
		if (!publicModel) throw new Error(`CortexKit catalog does not contain ${id}`);
		const thinkingLevelMap = id === GPT_OSS_MODEL_ID
			? { off: null, minimal: null, low: null, medium: "medium", high: null, xhigh: null, max: null }
			: { minimal: null, low: "low", medium: "medium", high: "high", xhigh: null, max: null };
		return {
			id, name: publicModel.name, api: API, provider: PROVIDER_ID,
			baseUrl: core.ANTIGRAVITY_ENDPOINT,
			reasoning: publicModel.reasoning,
			input: [...publicModel.modalities.input],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: publicModel.limit.context, maxTokens: publicModel.limit.output,
			thinkingLevelMap,
		};
	});
	sdkSystemPrompt = sdk.getCurrentSystemPrompt;
	sdkTools = sdk.getCurrentTools;
	requestSessions ??= new core.AgyRequestSessionStore("learnharness");
	const oauth = {
		name: "Google Antigravity", isSubscription: true,
		async login(interaction) {
			const authorization = await core.authorizeAntigravity();
			const state = new URL(authorization.url).searchParams.get("state") ?? "";
			if (!state) throw new Error("OAuth authorization is missing its state.");
			const complete = async (code, callbackState) => {
				if (callbackState !== state) throw new Error("OAuth state did not match this sign-in attempt.");
				const result = await core.exchangeAntigravity(code, state, { signal: interaction.signal });
				if (result.type !== "success") throw new Error("Google Antigravity sign-in could not be completed.");
				let availableModelIds;
				try { availableModelIds = await fetchAccountModelIds(core, result.access, result.refresh); } catch { /* a catalog outage must not invalidate a successful sign-in */ }
				return { type: "oauth", access: result.access, refresh: result.refresh, expires: result.expires, ...(availableModelIds ? { availableModelIds } : {}), ...(result.email ? { email: result.email } : {}), ...(result.label ? { label: result.label } : {}) };
			};
			let callback;
			try { callback = await startCallbackServer(state, complete, interaction.signal); }
			catch { /* port unavailable: keep the explicit manual URL/code entry path */ }
			interaction.notify({ type: "auth_url", url: authorization.url, instructions: callback ? "Complete Google sign-in; LearnHarness will receive the local callback." : "Complete Google sign-in, then paste the callback URL or code." });
			const manualAbort = new AbortController();
			const manual = interaction.prompt({ type: "manual_code", message: callback ? "If the browser cannot return to LearnHarness, paste the callback URL or authorization code:" : "Paste the full Google Antigravity callback URL or authorization code:", placeholder: "http://localhost:51121/oauth-callback?code=…&state=…", signal: manualAbort.signal }).then((input) => ({ kind: "manual", input }), (error) => ({ kind: "manual-error", error }));
			try {
				const winner = callback ? await Promise.race([callback.wait().then((credential) => ({ kind: "callback", credential })), manual]) : await manual;
				if (winner.kind === "callback") return winner.credential;
				if (winner.kind === "manual-error") throw winner.error;
				const input = winner.input.trim();
				let code = input, callbackState = state;
				try {
					const parsed = new URL(input);
					if (parsed.searchParams.get("error")) throw new Error("Google sign-in was denied or cancelled.");
					code = parsed.searchParams.get("code") ?? input;
					callbackState = parsed.searchParams.get("state") ?? "";
					if (callbackState !== state) throw new Error("OAuth state did not match this sign-in attempt.");
				} catch (error) { if (error instanceof TypeError) { /* raw code uses the state from this authorization attempt */ } else throw error; }
				if (!code || !callbackState) throw new Error("OAuth callback is missing its code or state.");
				return await complete(code, callbackState);
			} finally { manualAbort.abort(); callback?.close(); }
		},
		async refresh(credential, signal) {
			signal?.throwIfAborted();
			const parts = core.parseRefreshParts(credential.refresh);
			const result = await core.refreshAntigravityToken(parts.refreshToken);
			signal?.throwIfAborted();
			const refresh = core.formatRefreshParts({ refreshToken: result.refresh, projectId: parts.projectId, managedProjectId: parts.managedProjectId });
			let availableModelIds = credential.availableModelIds;
			try { availableModelIds = await fetchAccountModelIds(core, result.access, refresh); } catch { /* preserve the last confirmed account catalog on transient discovery failures */ }
			return { ...credential, access: result.access, refresh, expires: result.expires, availableModelIds };
		},
		async toAuth(credential) {
			return { apiKey: credential.access, baseUrl: core.ANTIGRAVITY_ENDPOINT };
		},
	};
	return {
		id: PROVIDER_ID, name: "Google Antigravity", api: API,
		baseUrl: core.ANTIGRAVITY_ENDPOINT, auth: options.authEnabled === false ? { apiKey: { name: "Google Antigravity subscription connection", resolve: async () => undefined } } : { oauth }, getModels: () => providerModels,
		filterModels: (models, credential) => Array.isArray(credential?.availableModelIds) ? models.filter((model) => credential.availableModelIds.includes(model.id)) : models,
		fetchAvailableModelIds: (credential) => fetchAccountModelIds(core, credential.access, credential.refresh),
		streamSimple(requestModel, context, options = {}) {
			const stream = sdk.createAssistantMessageEventStream();
			void (async () => {
				const output = { role: "assistant", content: [], api: API, provider: PROVIDER_ID, model: requestModel.id, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop", timestamp: Date.now() };
				stream.push({ type: "start", partial: output });
				let response, projectId = "";
				try {
					if (!options.apiKey) throw new Error("Google Antigravity is not connected.");
					if (Object.keys(options.headers ?? {}).some((key) => ["authorization", "x-api-key", "api-key", "host"].includes(key.toLowerCase()))) throw new Error("Authorization override forbidden.");
					const tier = ["low", "medium", "high"].includes(options.reasoning) ? options.reasoning : "medium";
					const requestedModel = requestModel.id === GPT_OSS_MODEL_ID ? requestModel.id : `${requestModel.id}-${tier}`;
					const resolution = core.resolveAntigravityModel(requestedModel);
					const request = buildRequest(context, core, requestModel.id);
					const generationConfig = { ...(typeof options.maxTokens === "number" ? { maxOutputTokens: options.maxTokens } : {}) };
					if (resolution.thinkingBudget !== undefined) generationConfig.thinkingConfig = { includeThoughts: true, thinkingBudget: resolution.thinkingBudget };
					if (Object.keys(generationConfig).length) request.generationConfig = generationConfig;
					const sessionKey = options.sessionId ?? `message:${context.messages?.find((message) => message.role !== "system")?.timestamp ?? Date.now()}`;
					const scope = requestSessions.beginRequest(sessionKey);
					const metadata = core.buildAgyAgentRequestMetadata(scope.session, request, resolution.actualModel, Date.now(), { stepCountMode: "cli" });
					request.labels = metadata.labels; request.sessionId = metadata.sessionId; core.orderAgyRequestPayloadInPlace(request);
					const auth = { type: "oauth", refresh: "", access: options.apiKey, expires: Date.now() + 60_000 };
					const project = await core.ensureProjectContext(auth);
					if (!project.effectiveProjectId) throw new Error("Google Antigravity did not provide a usable project context.");
					projectId = project.effectiveProjectId;
					const payload = { project: project.effectiveProjectId, requestId: metadata.requestId, request, model: resolution.actualModel, userAgent: "antigravity", requestType: "agent" };
					const finalPayload = await options.onPayload?.(payload, requestModel) ?? payload;
					const url = `${core.ANTIGRAVITY_ENDPOINT}/v1internal:streamGenerateContent?alt=sse`;
					const fetchImpl = options.fetch ?? globalThis.fetch;
					response = await fetchImpl(url, { method: "POST", signal: options.signal, headers: { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json", "User-Agent": core.buildAntigravityHarnessUserAgent(), ...(options.headers ?? {}) }, body: JSON.stringify(finalPayload) });
					if (!response.ok) throw new Error(`Antigravity returned HTTP ${response.status}${response.status === 429 ? " (usage limit)" : ""}.`);
					if (!response.body) throw new Error("Antigravity returned an empty stream.");
					const reader = response.body.getReader(), decoder = new TextDecoder();
					let buffer = "", textIndex = -1, thinkingIndex = -1, terminal = false, pendingSignature;
					const content = output.content;
					const close = (kind) => {
						const index = kind === "text" ? textIndex : thinkingIndex; if (index < 0) return;
						const block = content[index]; stream.push({ type: `${kind}_end`, contentIndex: index, [kind === "text" ? "content" : "content"]: kind === "text" ? block.text : block.thinking, partial: output });
						if (kind === "text") textIndex = -1; else thinkingIndex = -1;
					};
					const parseFrame = (frame) => {
						for (const line of frame.split("\n")) {
							if (!line.startsWith("data:")) continue; const raw = line.slice(5).trim(); if (!raw || raw === "[DONE]") continue;
							let parsed; try { parsed = JSON.parse(raw); } catch { continue; }
							const chunk = parsed.response ?? parsed; if (chunk.error) throw new Error(`Antigravity stream error (${chunk.error.status ?? chunk.error.code ?? "provider error"}).`);
							const candidate = chunk.candidates?.[0];
							for (const part of candidate?.content?.parts ?? []) {
								if (part.thought && !part.text && part.thoughtSignature) { pendingSignature = part.thoughtSignature; continue; }
								if (part.functionCall) { close("text"); close("thinking"); const call = { type: "toolCall", id: part.functionCall.id ?? `call_${crypto.randomUUID()}`, name: part.functionCall.name ?? "", arguments: part.functionCall.args ?? {}, ...((part.thoughtSignature ?? pendingSignature) ? { thoughtSignature: part.thoughtSignature ?? pendingSignature } : {}) }; pendingSignature = undefined; content.push(call); output.stopReason = "toolUse"; stream.push({ type: "toolcall_start", contentIndex: content.length - 1, partial: output }); stream.push({ type: "toolcall_end", contentIndex: content.length - 1, toolCall: call, partial: output }); continue; }
								if (typeof part.text !== "string" || !part.text) continue;
								const kind = part.thought ? "thinking" : "text"; close(kind === "text" ? "thinking" : "text");
								let index = kind === "text" ? textIndex : thinkingIndex;
								if (index < 0) { const signature = part.thoughtSignature ?? pendingSignature; pendingSignature = undefined; content.push(kind === "text" ? { type: "text", text: "", ...(signature ? { textSignature: signature } : {}) } : { type: "thinking", thinking: "", ...(signature ? { thinkingSignature: signature } : {}) }); index = content.length - 1; if (kind === "text") textIndex = index; else thinkingIndex = index; stream.push({ type: `${kind}_start`, contentIndex: index, partial: output }); }
								const block = content[index]; if (kind === "text") block.text += part.text; else block.thinking += part.text;
								stream.push({ type: `${kind}_delta`, contentIndex: index, delta: part.text, partial: output });
							}
							const usage = chunk.usageMetadata; if (usage) { const cacheRead = usage.cachedContentTokenCount ?? output.usage.cacheRead, prompt = usage.promptTokenCount ?? output.usage.input + output.usage.cacheRead; output.usage.input = Math.max(0, prompt - cacheRead); output.usage.cacheRead = cacheRead; output.usage.output = (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0); output.usage.totalTokens = output.usage.input + output.usage.output + cacheRead; sdk.calculateCost(requestModel, output.usage); }
							if (candidate?.finishReason) { close("text"); close("thinking"); if (output.stopReason !== "toolUse") output.stopReason = candidate.finishReason === "MAX_TOKENS" ? "length" : "stop"; terminal = true; }
						}
					};
					try {
						while (true) { const { done, value } = await reader.read(); if (done) { buffer += decoder.decode().replace(/\r\n/g, "\n"); break; } buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n"); let boundary; while ((boundary = buffer.indexOf("\n\n")) >= 0) { parseFrame(buffer.slice(0, boundary)); buffer = buffer.slice(boundary + 2); } }
						if (buffer.trim()) parseFrame(buffer);
					} finally { reader.releaseLock(); }
					if (options.signal?.aborted) throw new Error("Request aborted.");
					if (!terminal || !content.length) throw new Error("Antigravity stream ended without a complete response.");
					stream.push({ type: "done", reason: output.stopReason, message: output });
					if (output.stopReason === "stop" || output.stopReason === "length") requestSessions.completeExecution(sessionKey);
				} catch (error) {
					await response?.body?.cancel().catch(() => {});
					output.stopReason = options.signal?.aborted ? "aborted" : "error";
					output.errorMessage = String(error?.message ?? "Provider request failed.").replace(options.apiKey ?? "\0", "[redacted]").replace(projectId || "\0", "[redacted project]");
					stream.push({ type: "error", reason: output.stopReason, error: output });
				} finally { stream.end(); }
			})();
			return stream;
		},
	};
}

module.exports = { createProvider, MODEL_IDS, PROVIDER_ID, API, startCallbackServer };
