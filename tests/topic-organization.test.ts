import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	emptyTopicOrganization,
	parseTopicOrganization,
	nodesToClassify,
	applyTopicAssignments,
	applyTopicAction,
	type TopicOrganization,
} from "../src/core/topic-organization.ts";
import { attachImpToTopicClusters } from "../src/core/session-clusters.ts";
import { graphSnapshot } from "../src/core/graph.ts";
import type { GraphChain, GraphNode } from "../src/core/contracts.ts";
import type { ChatStore, GraphStore, TopicOrganizationStore } from "../src/core/ports.ts";

describe("topic-organization", () => {
	it("parseTopicOrganization handles corrupt or empty input safely", () => {
		assert.deepEqual(parseTopicOrganization(null), emptyTopicOrganization());
		assert.deepEqual(parseTopicOrganization({ version: 2 }), emptyTopicOrganization());
		assert.deepEqual(parseTopicOrganization("garbage"), emptyTopicOrganization());

		const valid = {
			version: 1,
			topics: [
				{
					id: "tp_12345678",
					label: "Derivatives",
					members: ["n_1", "n_2"],
					overriddenAt: null,
					createdAt: "2026-11-12T00:00:00.000Z",
					updatedAt: "2026-11-12T00:00:00.000Z",
				},
			],
			unassigned: ["n_3"],
			lastAutoRunAt: "2026-11-12T00:00:00.000Z",
		};
		const parsed = parseTopicOrganization(valid);
		assert.equal(parsed.topics.length, 1);
		assert.equal(parsed.topics[0]?.id, "tp_12345678");
		assert.equal(parsed.topics[0]?.label, "Derivatives");
		assert.deepEqual(parsed.unassigned, ["n_3"]);
	});

	it("nodesToClassify excludes overridden members and explicitly unassigned nodes", () => {
		const org: TopicOrganization = {
			version: 1,
			topics: [
				{
					id: "tp_1",
					label: "Derivatives",
					members: ["n_1", "n_2"],
					overriddenAt: "2026-11-12T10:00:00.000Z", // locked!
					createdAt: "2026-11-12T10:00:00.000Z",
					updatedAt: "2026-11-12T10:00:00.000Z",
				},
				{
					id: "tp_2",
					label: "Integrals",
					members: ["n_3"],
					overriddenAt: null, // auto-assigned
					createdAt: "2026-11-12T10:00:00.000Z",
					updatedAt: "2026-11-12T10:00:00.000Z",
				},
			],
			unassigned: ["n_4"],
			lastAutoRunAt: null,
		};
		const allIds = new Set(["n_1", "n_2", "n_3", "n_4", "n_5"]);
		const toClassify = nodesToClassify(org, allIds);
		// n_1 and n_2 are in overridden tp_1 -> excluded
		// n_4 is in unassigned -> excluded
		// n_3 is in auto topic -> included for re-evaluation
		// n_5 is new -> included
		assert.deepEqual(toClassify.sort(), ["n_3", "n_5"]);
	});

	it("applyTopicAssignments merges into existing topics and creates new ones without modifying overridden topics", () => {
		const now = "2026-11-12T12:00:00.000Z";
		const org: TopicOrganization = {
			version: 1,
			topics: [
				{
					id: "tp_locked",
					label: "User Custom Topic",
					members: ["n_1"],
					overriddenAt: "2026-11-12T10:00:00.000Z",
					createdAt: "2026-11-12T10:00:00.000Z",
					updatedAt: "2026-11-12T10:00:00.000Z",
				},
				{
					id: "tp_auto",
					label: "Linear Algebra",
					members: ["n_2"],
					overriddenAt: null,
					createdAt: "2026-11-12T10:00:00.000Z",
					updatedAt: "2026-11-12T10:00:00.000Z",
				},
			],
			unassigned: ["n_un"],
			lastAutoRunAt: null,
		};

		const assignments = {
			n_1: "Linear Algebra", // LLM tried to reassign locked n_1 -> must be ignored!
			n_2: "Linear Algebra", // matches existing
			n_3: "linear algebra", // matches existing case-insensitively
			n_4: "Calculus", // new topic
		};

		const updated = applyTopicAssignments(org, assignments, now);
		assert.equal(updated.lastAutoRunAt, now);
		// Overridden topic untouched
		const locked = updated.topics.find((t) => t.id === "tp_locked");
		assert.ok(locked);
		assert.deepEqual(locked?.members, ["n_1"]);

		// Linear algebra topic has n_2 and n_3
		const la = updated.topics.find((t) => t.label.toLowerCase() === "linear algebra");
		assert.ok(la);
		assert.deepEqual(la?.members, ["n_2", "n_3"]);

		// New Calculus topic created for n_4
		const calc = updated.topics.find((t) => t.label === "Calculus");
		assert.ok(calc);
		assert.deepEqual(calc?.members, ["n_4"]);
	});

	it("applyTopicAction supports rename, move, merge, create, and delete", () => {
		const now = "2026-11-12T12:00:00.000Z";
		let org: TopicOrganization = {
			version: 1,
			topics: [
				{
					id: "tp_1",
					label: "Math",
					members: ["n_1", "n_2"],
					overriddenAt: null,
					createdAt: now,
					updatedAt: now,
				},
				{
					id: "tp_2",
					label: "Physics",
					members: ["n_3"],
					overriddenAt: null,
					createdAt: now,
					updatedAt: now,
				},
			],
			unassigned: [],
			lastAutoRunAt: null,
		};

		// 1. Rename
		org = applyTopicAction(org, { action: "rename-topic", id: "tp_1", label: "Mathematics" }, now);
		assert.equal(org.topics.find((t) => t.id === "tp_1")?.label, "Mathematics");
		assert.equal(org.topics.find((t) => t.id === "tp_1")?.overriddenAt, now);

		// 2. Move node n_2 to tp_2
		org = applyTopicAction(org, { action: "move-node", nodeId: "n_2", toTopicId: "tp_2" }, now);
		assert.deepEqual(org.topics.find((t) => t.id === "tp_1")?.members, ["n_1"]);
		assert.deepEqual(org.topics.find((t) => t.id === "tp_2")?.members, ["n_2", "n_3"]);

		// 3. Move node n_1 to unassigned (toTopicId = null)
		org = applyTopicAction(org, { action: "move-node", nodeId: "n_1", toTopicId: null }, now);
		assert.deepEqual(org.topics.find((t) => t.id === "tp_1")?.members, []);
		assert.deepEqual(org.unassigned, ["n_1"]);

		// 4. Create topic
		org = applyTopicAction(org, { action: "create-topic", label: "Geometry", nodeIds: ["n_1"] }, now);
		const geom = org.topics.find((t) => t.label === "Geometry");
		assert.ok(geom);
		assert.deepEqual(geom?.members, ["n_1"]);
		assert.deepEqual(org.unassigned, []);

		// 5. Merge tp_2 into Geometry
		org = applyTopicAction(org, { action: "merge-topics", sourceId: "tp_2", targetId: geom!.id }, now);
		assert.equal(org.topics.find((t) => t.id === "tp_2"), undefined);
		const mergedGeom = org.topics.find((t) => t.id === geom!.id);
		assert.deepEqual(mergedGeom?.members, ["n_1", "n_2", "n_3"]);

		// 6. Delete topic
		org = applyTopicAction(org, { action: "delete-topic", id: geom!.id }, now);
		assert.equal(org.topics.find((t) => t.id === geom!.id), undefined);
		assert.deepEqual(org.unassigned.sort(), ["n_1", "n_2", "n_3"]);
	});

	it("attachImpToTopicClusters assigns implication chains by majority among premise topics", () => {
		const clusters = [
			{ id: "tp_1", members: ["n_1", "n_2"] },
			{ id: "tp_2", members: ["n_3"] },
		];
		const nodes: Pick<GraphNode, "id">[] = [{ id: "n_1" }, { id: "n_2" }, { id: "n_3" }, { id: "n_4" }];
		const chains: Pick<GraphChain, "id" | "premises" | "conclusion">[] = [
			{
				id: "arg_c1",
				premises: ["n_1", "n_2"], // both from tp_1
				conclusion: "n_4",
			},
		];

		attachImpToTopicClusters(clusters, nodes, chains);
		assert.deepEqual(clusters.find((c) => c.id === "tp_1")?.members, ["arg_c1", "n_1", "n_2"]);
	});

	it("graphSnapshot uses TopicOrganization when topics exist, falls back to birthSessionPartition when empty", () => {
		const nodes: GraphNode[] = [
			{
				id: "n_1",
				name: "Prop 1",
				statement: "Prop 1 stmt",
				aliases: [],
				createdAt: "2026-11-12T00:00:00.000Z",
				provenance: [{ chatId: "chat_a", messageId: "m1" }],
			},
			{
				id: "n_2",
				name: "Prop 2",
				statement: "Prop 2 stmt",
				aliases: [],
				createdAt: "2026-11-12T00:00:00.000Z",
				provenance: [{ chatId: "chat_b", messageId: "m1" }],
			},
			{
				id: "n_3",
				name: "Prop 3",
				statement: "Prop 3 stmt",
				aliases: [],
				createdAt: "2026-11-12T00:00:00.000Z",
				provenance: [{ chatId: "chat_b", messageId: "m2" }],
			},
		];

		const fakeGraphStore = {
			readNodes: () => nodes,
			readChains: () => [],
			readPositions: () => ({}),
			readSources: () => [],
			readCheckpoints: () => [],
			readCoverage: () => [],
			writePositions: () => {},
		} as unknown as GraphStore;

		const fakeChatStore = {
			listChats: () => [],
			getChat: () => undefined,
		} as unknown as ChatStore;

		// 1. Without topics (empty store): falls back to birth sessions
		const emptyTopicStore: TopicOrganizationStore = {
			read: () => emptyTopicOrganization(),
			write: () => {},
		};
		const snap1 = graphSnapshot({
			chatStore: fakeChatStore,
			graphStore: fakeGraphStore,
			topicOrganizationStore: emptyTopicStore,
		});
		// chat_b has 2 nodes, chat_a has 1. With MIN_CLUSTER_SIZE = 3, neither forms a cluster
		assert.equal(snap1.clusters.length, 0);

		// 2. With topics grouping all 3 nodes together across chat_a and chat_b!
		const populatedTopicStore: TopicOrganizationStore = {
			read: () => ({
				version: 1,
				topics: [
					{
						id: "tp_math",
						label: "Mathematics",
						members: ["n_1", "n_2", "n_3"], // cross-session grouping >= 3 nodes!
						overriddenAt: null,
						createdAt: "2026-11-12T00:00:00.000Z",
						updatedAt: "2026-11-12T00:00:00.000Z",
					},
				],
				unassigned: [],
				lastAutoRunAt: "2026-11-12T00:00:00.000Z",
			}),
			write: () => {},
		};

		const snap2 = graphSnapshot({
			chatStore: fakeChatStore,
			graphStore: fakeGraphStore,
			topicOrganizationStore: populatedTopicStore,
		});
		assert.equal(snap2.clusters.length, 1);
		assert.equal(snap2.clusters[0]?.id, "tp_math");
		assert.equal(snap2.clusters[0]?.label, "Mathematics");
		assert.deepEqual(snap2.clusters[0]?.members, ["n_1", "n_2", "n_3"]);
	});

	it("parseAssignmentJson parses clean JSON, fenced markdown JSON, and extracts object substrings", async () => {
		const { parseAssignmentJson } = await import("../src/agent/subagents/topic-assign.ts");

		// 1. Clean JSON
		assert.deepEqual(
			parseAssignmentJson('{"n_1": "Trees", "n_2": "Graphs"}'),
			{ n_1: "Trees", n_2: "Graphs" },
		);

		// 2. Fenced markdown ```json ... ```
		assert.deepEqual(
			parseAssignmentJson('```json\n{"n_1": "Trees", "n_2": "Graphs"}\n```'),
			{ n_1: "Trees", n_2: "Graphs" },
		);

		// 3. Text with markdown fence and trailing text
		assert.deepEqual(
			parseAssignmentJson('Here is the result:\n```json\n{"n_1": "B-Trees"}\n```\nHope this helps!'),
			{ n_1: "B-Trees" },
		);

		// 4. Filters out invalid keys (e.g. non-proposition IDs)
		assert.deepEqual(
			parseAssignmentJson('{"n_1": "Valid", "arg_1": "Invalid", "other": "Invalid"}'),
			{ n_1: "Valid" },
		);
	});

	it("runTopicAssign handles undefined engine and empty nodes safely", async () => {
		const { runTopicAssign } = await import("../src/agent/subagents/topic-assign.ts");

		const emptyTopicStore: TopicOrganizationStore = {
			read: () => emptyTopicOrganization(),
			write: () => {},
		};

		// 1. Undefined engine returns null
		const res1 = await runTopicAssign([{ id: "n_1", name: "P1", statement: "S1", aliases: [], createdAt: "", provenance: [] }], {
			topicStore: emptyTopicStore,
			engine: undefined,
		});
		assert.equal(res1, null);

		// 2. Empty nodes returns 0
		const res2 = await runTopicAssign([], {
			topicStore: emptyTopicStore,
			engine: {} as any,
		});
		assert.equal(res2, 0);

		// 3. Honors topicSettings (granularity, unification, customPrompt) without error
		const res3 = await runTopicAssign([], {
			topicStore: emptyTopicStore,
			engine: {} as any,
			topicSettings: {
				granularity: "fine",
				unification: "strict",
				customPrompt: "Always group by textbook chapters",
			},
		});
		assert.equal(res3, 0);
	});
});
