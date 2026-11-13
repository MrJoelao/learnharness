/**
 * Manual CLI trigger for topic organization:
 *   npx tsx scripts/organize-topics.ts
 *
 * If LH_DATA_DIR is not set in the environment, auto-detects the Electron
 * data directory at ~/.config/LearnHarness/data when present.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

if (!process.env.LH_DATA_DIR) {
	const electronUserData = path.join(os.homedir(), ".config", "LearnHarness", "data");
	if (fs.existsSync(path.join(electronUserData, "graph", "nodes.jsonl"))) {
		process.env.LH_DATA_DIR = electronUserData;
		console.log(`[organize-topics] Using Electron user data: ${electronUserData}`);
	}
}

async function main() {
	const { stores } = await import("../src/server/stores.ts");
	const { getGraph } = await import("../src/core/graph.ts");
	const { runTopicAssign } = await import("../src/agent/subagents/topic-assign.ts");
	const { settleGraphLayout } = await import("../src/core/layout-settle.ts");
	const { resolveRoleSpec, resolveSettings } = await import("../src/core/settings-resolution.ts");
	const { piEngineForSpec } = await import("../src/agent/models.ts");

	const graph = getGraph(stores.graphStore);
	const propositions = graph.nodes.filter((n) => n.id.startsWith("n_"));
	console.log(`Found ${graph.nodes.length} nodes in graph (${propositions.length} proposition nodes).`);

	if (propositions.length === 0) {
		console.log("Graph has no proposition nodes to organize.");
		return;
	}

	const settings = stores.settingsStore.readSettings();
	const resolved = resolveSettings(settings);
	const spec = resolveRoleSpec("extractor", settings);
	if (!spec) {
		console.error("No extractor model configured. Please configure your models in Settings.");
		process.exit(1);
	}

	console.log(`Using extractor model: ${spec.id} (${spec.provider})`);
	let engine;
	try {
		engine = piEngineForSpec(spec, true);
	} catch (err) {
		console.error(
			"\nFailed to create AI engine:",
			err instanceof Error ? err.message : err,
		);
		if (spec.provider.includes("subscription")) {
			console.log(
				"\nNote: Native subscription models require running inside the desktop app.",
				"\nPlease launch LearnHarness and click 'Auto-organize' in the Topics toolbar or use the API.",
			);
		}
		process.exit(1);
	}

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
		console.error("Topic assignment failed. Check console output above.");
		process.exit(1);
	}

	// Re-settle graph layout
	settleGraphLayout(stores.graphStore, {
		topicStore: stores.topicOrganizationStore,
		resetAnchors: true,
	});

	const org = stores.topicOrganizationStore.read();
	console.log(`\nSuccess! ${count} topics written to topics.json:`);
	for (const t of org.topics) {
		console.log(`- ${t.label} (${t.members.length} nodes)`);
	}
	if (org.unassigned.length > 0) {
		console.log(`- Unassigned: ${org.unassigned.length} nodes`);
	}
}

main().catch(console.error);
