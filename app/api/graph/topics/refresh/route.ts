/** Preview, apply, or undo an LLM topic organization pass. */
import { isDeepStrictEqual } from "node:util";
import { emit, parseTopicOrganization } from "@/src/core";
import {
	abortTopicOrganization,
	getGraph,
	ModelsNotConfiguredError,
	piEngineForSpec,
	previewTopicAssign,
	ProviderKeyMissingError,
	registerTopicOrganizationAbort,
	resolveRoleSpec,
	resolveSettings,
	settleGraphLayout,
	stores,
	unregisterTopicOrganizationAbort,
} from "@/src/server";

export const dynamic = "force-dynamic";

type TopicRefreshRequest =
	| { action: "preview"; operationId: string }
	| { action: "cancel"; operationId: string }
	| { action: "apply"; base: unknown; proposed: unknown; propositionIds: string[] }
	| { action: "undo"; expected: unknown; restore: unknown; propositionIds: string[] };

function parseRequest(value: unknown): TopicRefreshRequest | null {
	if (typeof value !== "object" || value === null || !("action" in value)) return null;
	const request = value as Record<string, unknown>;
	if ((request.action === "preview" || request.action === "cancel") && typeof request.operationId === "string" && /^[A-Za-z0-9:_-]{1,100}$/.test(request.operationId)) return { action: request.action, operationId: request.operationId };
	if (request.action === "apply" && "base" in request && "proposed" in request && Array.isArray(request.propositionIds) && request.propositionIds.every((id) => typeof id === "string"))
		return { action: "apply", base: request.base, proposed: request.proposed, propositionIds: request.propositionIds };
	if (request.action === "undo" && "expected" in request && "restore" in request && Array.isArray(request.propositionIds) && request.propositionIds.every((id) => typeof id === "string"))
		return { action: "undo", expected: request.expected, restore: request.restore, propositionIds: request.propositionIds };
	return null;
}

function settleAndAnnounce(resetAnchors: boolean) {
	settleGraphLayout(stores.graphStore, { topicStore: stores.topicOrganizationStore, resetAnchors });
	emit("topics-changed", {});
	emit("sources-changed", {});
}

export async function POST(req: Request) {
	let request: TopicRefreshRequest | null = null;
	try {
		request = parseRequest(await req.json());
	} catch {
		return Response.json({ error: "Invalid JSON." }, { status: 400 });
	}
	if (!request) return Response.json({ error: "Invalid topic organization action." }, { status: 400 });
	if (request.action === "cancel") {
		return abortTopicOrganization(request.operationId)
			? Response.json({ ok: true })
			: Response.json({ ok: false, reason: "not_running" }, { status: 409 });
	}

	if (request.action === "apply") {
		const base = parseTopicOrganization(request.base);
		const proposed = parseTopicOrganization(request.proposed);
		const currentGraphIds = getGraph(stores.graphStore).nodes.filter((node) => node.id.startsWith("n_")).map((node) => node.id).sort();
		if (!isDeepStrictEqual(currentGraphIds, [...request.propositionIds].sort()))
			return Response.json({ error: "The graph changed while the preview was open. Create a new preview before applying." }, { status: 409 });
		if (!isDeepStrictEqual(stores.topicOrganizationStore.read(), base))
			return Response.json({ error: "Topics changed while the preview was open. Create a new preview before applying." }, { status: 409 });
		stores.topicOrganizationStore.write(proposed);
		settleAndAnnounce(true);
		return Response.json({ topics: proposed.topics.length });
	}

	if (request.action === "undo") {
		const expected = parseTopicOrganization(request.expected);
		const restore = parseTopicOrganization(request.restore);
		const currentGraphIds = getGraph(stores.graphStore).nodes.filter((node) => node.id.startsWith("n_")).map((node) => node.id).sort();
		if (!isDeepStrictEqual(currentGraphIds, [...request.propositionIds].sort()))
			return Response.json({ error: "The graph changed after Auto-organize. The previous state was not restored." }, { status: 409 });
		if (!isDeepStrictEqual(stores.topicOrganizationStore.read(), expected))
			return Response.json({ error: "Topics changed after Auto-organize. The previous state was not restored." }, { status: 409 });
		stores.topicOrganizationStore.write(restore);
		settleAndAnnounce(true);
		return Response.json(restore);
	}

	const graph = getGraph(stores.graphStore);
	const base = stores.topicOrganizationStore.read();
	const settings = stores.settingsStore.readSettings();
	const resolved = resolveSettings(settings);
	if (graph.nodes.length === 0)
		return Response.json({ base, proposed: base, propositions: [], reviewBeforeApply: resolved.graph.topics.reviewBeforeApply });

	const spec = resolveRoleSpec("extractor", settings);
	if (!spec) {
		return Response.json(
			{ error: "No model configured. Set your model slots in Settings → Models." },
			{ status: 503 },
		);
	}

	const controller = new AbortController();
	registerTopicOrganizationAbort(request.operationId, controller);
	try {
		const preview = await previewTopicAssign(graph.nodes, {
			topicStore: stores.topicOrganizationStore,
			engine: piEngineForSpec(spec, true),
			chatStore: stores.chatStore,
			chatOrganizationStore: stores.chatOrganizationStore,
			sourceOrganizationStore: stores.sourceOrganizationStore,
			graphStore: stores.graphStore,
			topicSettings: resolved.graph.topics,
		}, { baseOrganization: base, abortSignal: controller.signal });

		if (!preview) return Response.json({ error: "Topic preview failed — check server logs." }, { status: 500 });
		return Response.json({
			base,
			proposed: preview.organization,
			propositions: graph.nodes.filter((node) => node.id.startsWith("n_")).map(({ id, name }) => ({ id, name })),
			reviewBeforeApply: resolved.graph.topics.reviewBeforeApply,
		});
	} catch (err) {
		if (controller.signal.aborted || (err instanceof Error && err.name === "AbortError"))
			return Response.json({ cancelled: true });
		if (err instanceof ModelsNotConfiguredError)
			return Response.json({ error: "Models not configured.", code: "models_not_configured" }, { status: 503 });
		if (err instanceof ProviderKeyMissingError)
			return Response.json({ error: "Provider key missing.", code: "provider_key_missing" }, { status: 503 });
		console.error("[topics/refresh] unexpected error:", err);
		return Response.json({ error: err instanceof Error ? err.message : "Unexpected topic organization error." }, { status: 500 });
	} finally {
		unregisterTopicOrganizationAbort(request.operationId);
	}
}
