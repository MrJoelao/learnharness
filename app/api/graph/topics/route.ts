/**
 * GET  /api/graph/topics — the full TopicOrganization state
 * POST /api/graph/topics — apply a TopicAction (user override: rename,
 *                          move-node, merge-topics, create-topic, delete-topic)
 */
import { applyTopicAction, emit, type TopicAction } from "@/src/core";
import { settleGraphLayout, stores } from "@/src/server";

export const dynamic = "force-dynamic";

export async function GET() {
	return Response.json(stores.topicOrganizationStore.read());
}

export async function POST(req: Request) {
	let body: unknown;
	try {
		body = await req.json();
	} catch {
		return Response.json({ error: "invalid JSON" }, { status: 400 });
	}

	if (typeof body !== "object" || body === null || !("action" in body)) {
		return Response.json({ error: "missing action" }, { status: 400 });
	}

	const action = body as TopicAction;
	const validActions = ["rename-topic", "move-node", "merge-topics", "create-topic", "delete-topic"];
	if (!validActions.includes(action.action)) {
		return Response.json({ error: "unknown action" }, { status: 400 });
	}

	const now = new Date().toISOString();
	const current = stores.topicOrganizationStore.read();
	const next = applyTopicAction(current, action, now);
	stores.topicOrganizationStore.write(next);

	// Re-settle graph layout with updated topic assignments (preserving existing anchors)
	settleGraphLayout(stores.graphStore, {
		topicStore: stores.topicOrganizationStore,
		resetAnchors: false,
	});

	emit("topics-changed", {});
	emit("sources-changed", {});
	return Response.json(next);
}
