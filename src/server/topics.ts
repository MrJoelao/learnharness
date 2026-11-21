import { stores } from "./stores.ts";
import {
	applyTopicAction,
	type TopicAction,
	type TopicOrganization,
} from "../core/topic-organization.ts";
import { getGraph } from "../core/graph.ts";
import { settleGraphLayout } from "../core/layout-settle.ts";
import { resolveRoleSpec, resolveSettings } from "../core/settings-resolution.ts";
import {
	ModelsNotConfiguredError,
	ProviderKeyMissingError,
} from "../core/settings.ts";
import { emit } from "../core/events.ts";
import { runTopicAssign } from "../agent/subagents/topic-assign.ts";
import { piEngineForSpec } from "../agent/models.ts";

export function getTopicOrganization(): TopicOrganization {
	return stores.topicOrganizationStore.read();
}

export function applyTopicActionAndSettle(action: TopicAction): TopicOrganization {
	const now = new Date().toISOString();
	const current = stores.topicOrganizationStore.read();
	const next = applyTopicAction(current, action, now);
	stores.topicOrganizationStore.write(next);

	settleGraphLayout(stores.graphStore, {
		topicStore: stores.topicOrganizationStore,
		resetAnchors: false,
	});

	emit("topics-changed", {});
	emit("sources-changed", {});
	return next;
}

export async function refreshGraphTopics(): Promise<
	{ topics: number; message?: string } | { error: string; status: number; code?: string }
> {
	const graph = getGraph(stores.graphStore);
	if (graph.nodes.length === 0) {
		return { topics: 0, message: "Graph is empty" };
	}

	const settings = stores.settingsStore.readSettings();
	const resolved = resolveSettings(settings);
	const spec = resolveRoleSpec("extractor", settings);
	if (!spec) {
		return {
			error: "No model configured. Set your model slots in Settings → Models.",
			status: 503,
		};
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
			return {
				error: "Topic assign failed — check server logs.",
				status: 500,
			};
		}

		settleGraphLayout(stores.graphStore, {
			topicStore: stores.topicOrganizationStore,
			resetAnchors: true,
		});

		emit("topics-changed", {});
		emit("sources-changed", {});
		return { topics: count };
	} catch (err) {
		if (err instanceof ModelsNotConfiguredError) {
			return {
				error: "Models not configured.",
				code: "models_not_configured",
				status: 503,
			};
		}
		if (err instanceof ProviderKeyMissingError) {
			return {
				error: "Provider key missing.",
				code: "provider_key_missing",
				status: 503,
			};
		}
		console.error("[topics/refresh] unexpected error:", err);
		return {
			error: "Unexpected error. Check server logs.",
			status: 500,
		};
	}
}
