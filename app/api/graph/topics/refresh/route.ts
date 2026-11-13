/**
 * POST /api/graph/topics/refresh — trigger the LLM topic-assign pass.
 *
 * Runs synchronously (waits for the LLM to finish) since the UI shows a
 * loading spinner during the call. For large graphs with many chunks this
 * could take 10–30s, which is acceptable for a user-initiated action.
 *
 * Returns { topics: number } on success, or { error } on failure.
 */
import { stores } from "@/src/server/stores";
import { getGraph } from "@/src/core/graph";
import { runTopicAssign } from "@/src/agent/subagents/topic-assign";
import { settleGraphLayout } from "@/src/core/layout-settle";
import { resolveRoleSpec, resolveSettings } from "@/src/core/settings-resolution";
import { piEngineForSpec } from "@/src/agent/models";
import { ROLE_SLOT } from "@/src/core/settings";
import { emit } from "@/src/core/events";
import { ModelsNotConfiguredError, ProviderKeyMissingError } from "@/src/core/settings";

export const dynamic = "force-dynamic";

export async function POST() {
	// Read all proposition nodes from the graph
	const graph = getGraph(stores.graphStore);
	if (graph.nodes.length === 0) {
		return Response.json({ topics: 0, message: "Graph is empty" });
	}

	// Resolve the cheap engine (extractor slot — same as auditor)
	const settings = stores.settingsStore.readSettings();
	const resolved = resolveSettings(settings);
	const spec = resolveRoleSpec("extractor", settings);
	if (!spec) {
		return Response.json(
			{ error: "No model configured. Set your model slots in Settings → Models." },
			{ status: 503 },
		);
	}
	const engine = piEngineForSpec(spec, true);

	try {
		const count = await runTopicAssign(graph.nodes, {
			topicStore: stores.topicOrganizationStore,
			engine,
			chatStore: stores.chatStore,
			chatOrganizationStore: stores.chatOrganizationStore,
			sourceOrganizationStore: stores.sourceOrganizationStore,
			graphStore: stores.graphStore,
			topicSettings: resolved.graph.topics,
		});

		if (count === null) {
			return Response.json({ error: "Topic assign failed — check server logs." }, { status: 500 });
		}

		// Re-settle graph layout so nodes physically pull into their topic clusters in 2D space
		settleGraphLayout(stores.graphStore, {
			topicStore: stores.topicOrganizationStore,
			resetAnchors: true,
		});

		emit("topics-changed", {});
		emit("sources-changed", {});
		return Response.json({ topics: count });
	} catch (err) {
		if (err instanceof ModelsNotConfiguredError) {
			return Response.json({ error: "Models not configured.", code: "models_not_configured" }, { status: 503 });
		}
		if (err instanceof ProviderKeyMissingError) {
			return Response.json({ error: "Provider key missing.", code: "provider_key_missing" }, { status: 503 });
		}
		console.error("[topics/refresh] unexpected error:", err);
		return Response.json({ error: "Unexpected error. Check server logs." }, { status: 500 });
	}
}
