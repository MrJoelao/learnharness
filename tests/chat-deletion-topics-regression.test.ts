import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pruneDeadNodesFromTopics, type TopicOrganization } from "../src/core/topic-organization.ts";
import { stores } from "../src/server/stores.ts";
import { deleteChatSession } from "../src/server/chats.ts";
import { mergeFindings } from "../src/core/graph.ts";

describe("chat deletion with topic organization regression ($tdd)", () => {
	it("pruneDeadNodesFromTopics removes dead node IDs from topic members and unassigned", () => {
		const org: TopicOrganization = {
			version: 1,
			topics: [
				{
					id: "tp_shared",
					label: "Shared Topic",
					members: ["n_dead_1", "n_live_2"],
					overriddenAt: null,
					createdAt: "2026-11-12T00:00:00.000Z",
					updatedAt: "2026-11-12T00:00:00.000Z",
				},
				{
					id: "tp_all_dead_auto",
					label: "Dead Auto Topic",
					members: ["n_dead_3"],
					overriddenAt: null,
					createdAt: "2026-11-12T00:00:00.000Z",
					updatedAt: "2026-11-12T00:00:00.000Z",
				},
				{
					id: "tp_overridden_empty",
					label: "User Created Topic",
					members: ["n_dead_4"],
					overriddenAt: "2026-11-12T10:00:00.000Z",
					createdAt: "2026-11-12T00:00:00.000Z",
					updatedAt: "2026-11-12T00:00:00.000Z",
				},
			],
			unassigned: ["n_dead_5", "n_live_6"],
			lastAutoRunAt: "2026-11-12T00:00:00.000Z",
		};

		const liveNodeIds = new Set(["n_live_2", "n_live_6"]);
		const pruned = pruneDeadNodesFromTopics(org, liveNodeIds);

		const shared = pruned.topics.find((t) => t.id === "tp_shared");
		assert.ok(shared);
		assert.deepEqual(shared.members, ["n_live_2"]);

		assert.equal(pruned.topics.some((t) => t.id === "tp_all_dead_auto"), false);

		const userTopic = pruned.topics.find((t) => t.id === "tp_overridden_empty");
		assert.ok(userTopic);
		assert.deepEqual(userTopic.members, []);

		assert.deepEqual(pruned.unassigned, ["n_live_6"]);
	});

	it("deleteChatSession with delete-nodes cleans up dead nodes from topicOrganizationStore", async () => {
		const chatA = stores.chatStore.createChat("Topic Chat A");
		const chatB = stores.chatStore.createChat("Topic Chat B");

		const findingsA = {
			propositions: [
				{ id: "p1", name: "Prop A1", statement: "Prop A1 statement", aliases: [] },
				{ id: "p2", name: "Prop A2", statement: "Prop A2 statement", aliases: [] },
			],
			chains: [],
		};
		const findingsB = {
			propositions: [
				{ id: "p3", name: "Prop B1", statement: "Prop B1 statement", aliases: [] },
			],
			chains: [],
		};

		const graphDeps = {
			chatStore: stores.chatStore,
			graphStore: stores.graphStore,
			topicOrganizationStore: stores.topicOrganizationStore,
			sourceOrganizationStore: stores.sourceOrganizationStore,
		};

		mergeFindings(chatA.id, findingsA, { links: [] }, graphDeps, { foldedAt: chatA.updatedAt });
		mergeFindings(chatB.id, findingsB, { links: [] }, graphDeps, { foldedAt: chatB.updatedAt });

		const nodesA = stores.graphStore.readNodes().filter((n) => n.provenance.some((pt) => pt.chatId === chatA.id));
		const nodesB = stores.graphStore.readNodes().filter((n) => n.provenance.some((pt) => pt.chatId === chatB.id));
		assert.equal(nodesA.length, 2);
		assert.equal(nodesB.length, 1);

		const a1Id = nodesA[0]!.id;
		const a2Id = nodesA[1]!.id;
		const b1Id = nodesB[0]!.id;

		stores.topicOrganizationStore.write({
			version: 1,
			topics: [
				{
					id: "tp_multi",
					label: "Multi Topic",
					members: [a1Id, b1Id],
					overriddenAt: null,
					createdAt: "2026-11-20T00:00:00.000Z",
					updatedAt: "2026-11-20T00:00:00.000Z",
				},
				{
					id: "tp_only_a",
					label: "Only A Topic",
					members: [a2Id],
					overriddenAt: null,
					createdAt: "2026-11-20T00:00:00.000Z",
					updatedAt: "2026-11-20T00:00:00.000Z",
				},
			],
			unassigned: [],
			lastAutoRunAt: "2026-11-20T00:00:00.000Z",
		});

		try {
			const outcome = await deleteChatSession(chatA.id, "delete-nodes");
			assert.equal(outcome.ok, true);

			const topicsAfter = stores.topicOrganizationStore.read();
			const multi = topicsAfter.topics.find((t) => t.id === "tp_multi");
			assert.ok(multi, "Multi topic should survive");
			assert.deepEqual(multi.members, [b1Id], "Dead node a1Id should be pruned, b1Id should remain");

			assert.equal(topicsAfter.topics.some((t) => t.id === "tp_only_a"), false, "Empty auto topic should be pruned");
		} finally {
			// Cleanup chat B
			await deleteChatSession(chatB.id, "delete-nodes");
		}
	});
});
