/**
 * TOPIC CLUSTERING — semantic cross-session grouping (2026-11-12).
 *
 * Birth-session clustering (session-clusters.ts) groups nodes by which chat
 * created them: useful for provenance but blind to meaning. Two sessions about
 * "derivatives" produce two separate clusters even though the nodes overlap.
 *
 * This module introduces TOPIC ORGANIZATION: a flat list of named topics,
 * each owning a set of proposition node IDs. Topics are assigned by an LLM
 * classifier (src/agent/subagents/topic-assign.ts) that sees all nodes and
 * groups them by semantic proximity across all sessions. Users can rename,
 * merge, or move nodes to override the automatic assignment.
 *
 * DESIGN PRINCIPLES
 * - Separate from graph ledgers: topics are PRESENTATION METADATA, not part
 *   of the extraction pipeline. Same pattern as source-organization.json and
 *   chat-organization.json (read-modify-write JSON, not append-only JSONL).
 * - Override-safe: nodes whose topic carries overriddenAt !== null are skipped
 *   by the auto-assign pass — the user's decision is preserved across runs.
 * - Fallback-safe: when no topics exist yet, graphSnapshot falls back to
 *   birth-session clustering so the graph works out-of-the-box.
 * - Full-graph pass: the classifier always considers ALL live nodes, including
 *   those already assigned, so it can re-balance on first run and after
 *   deletions. Nodes in overridden topics are excluded from re-classification.
 *
 * Browser-safe pure logic (no node builtins, no fs).
 */

/** A named semantic topic grouping a set of proposition nodes. */
export interface GraphTopic {
	/** "tp_" + 8 hex chars (store-assigned). */
	id: string;
	/** Human-readable label: "Derivatives", "Bayesian inference", etc.
	 *  Set by the LLM or edited by the user. */
	label: string;
	/** Proposition node IDs belonging to this topic. Sorted for determinism.
	 *  Implication nodes (arg_…) are never assigned to topics — only
	 *  propositions (n_…), mirroring the birth-session partition rule. */
	members: string[];
	/** null = fully auto-assigned; ISO string = user edited the topic label
	 *  or members after the last auto run. The auto-assign pass skips the
	 *  MEMBERS of a topic whose overriddenAt is set, but will still auto-
	 *  assign newly created nodes that aren't yet in any topic. */
	overriddenAt: string | null;
	createdAt: string;
	updatedAt: string;
}

/** The full topic organization state (data/graph/topics.json). */
export interface TopicOrganization {
	version: 1;
	/** All named topics. Order is display order on the graph. */
	topics: GraphTopic[];
	/** Node IDs explicitly removed from all topics by the user (not to be
	 *  re-auto-assigned). The LLM still suggests a topic; the user has to
	 *  manually put them back or leave them in unassigned. */
	unassigned: string[];
	/** ISO timestamp of the last successful LLM topic-assign run.
	 *  null when no auto-assign has ever run. */
	lastAutoRunAt: string | null;
}

export const emptyTopicOrganization = (): TopicOrganization => ({
	version: 1,
	topics: [],
	unassigned: [],
	lastAutoRunAt: null,
});

/** Sanitize an unknown value from disk into a valid TopicOrganization. */
export function parseTopicOrganization(raw: unknown): TopicOrganization {
	if (typeof raw !== "object" || raw === null) return emptyTopicOrganization();
	const r = raw as Record<string, unknown>;
	if (r["version"] !== 1) return emptyTopicOrganization();

	const topics: GraphTopic[] = [];
	if (Array.isArray(r["topics"])) {
		for (const t of r["topics"]) {
			if (typeof t !== "object" || t === null) continue;
			const topic = t as Record<string, unknown>;
			if (typeof topic["id"] !== "string" || !topic["id"].startsWith("tp_")) continue;
			if (typeof topic["label"] !== "string") continue;
			topics.push({
				id: topic["id"],
				label: topic["label"],
				members: Array.isArray(topic["members"])
					? (topic["members"] as unknown[]).filter((m): m is string => typeof m === "string")
					: [],
				overriddenAt: typeof topic["overriddenAt"] === "string" ? topic["overriddenAt"] : null,
				createdAt: typeof topic["createdAt"] === "string" ? topic["createdAt"] : new Date().toISOString(),
				updatedAt: typeof topic["updatedAt"] === "string" ? topic["updatedAt"] : new Date().toISOString(),
			});
		}
	}

	const unassigned: string[] = Array.isArray(r["unassigned"])
		? (r["unassigned"] as unknown[]).filter((m): m is string => typeof m === "string")
		: [];

	return {
		version: 1,
		topics,
		unassigned,
		lastAutoRunAt: typeof r["lastAutoRunAt"] === "string" ? r["lastAutoRunAt"] : null,
	};
}

/** All node IDs that are currently in a topic (including overridden ones). */
export function assignedNodeIds(org: TopicOrganization): Set<string> {
	const ids = new Set<string>();
	for (const topic of org.topics) {
		for (const id of topic.members) ids.add(id);
	}
	return ids;
}

/** Node IDs that should be passed to the LLM for (re-)assignment:
 *  all proposition nodes that are NOT in an overridden topic and NOT
 *  explicitly unassigned by the user. */
export function nodesToClassify(
	org: TopicOrganization,
	allPropositionIds: ReadonlySet<string>,
): string[] {
	// IDs locked by user override (belong to a topic with overriddenAt set)
	const locked = new Set<string>();
	for (const topic of org.topics) {
		if (topic.overriddenAt !== null) {
			for (const id of topic.members) locked.add(id);
		}
	}
	// User-explicit unassigned
	const explicitlyUnassigned = new Set(org.unassigned);

	return [...allPropositionIds].filter(
		(id) => !locked.has(id) && !explicitlyUnassigned.has(id),
	);
}

/** Apply a fresh LLM assignment result into the existing TopicOrganization.
 *  Returns a NEW state (pure, no mutation).
 *
 *  assignments: nodeId → topicLabel (the LLM's answer)
 *  - Nodes that map to an existing topic label (case-insensitive trimmed match)
 *    are added to that topic.
 *  - Nodes that map to a NEW label mint a new GraphTopic.
 *  - Nodes missing from assignments or mapping to "" are left as-is in their
 *    current auto-assigned topic (or become unassigned if they had none).
 *  Overridden topics are NEVER modified. */
export function applyTopicAssignments(
	org: TopicOrganization,
	assignments: Record<string, string>,
	now: string,
): TopicOrganization {
	// Keep overridden topics exactly as-is
	const overridden = org.topics.filter((t) => t.overriddenAt !== null);
	const overriddenMemberIds = new Set(overridden.flatMap((t) => t.members));

	// Build a label → topic map for the auto (non-overridden) topics
	const autoTopics = new Map<string, GraphTopic>(
		org.topics
			.filter((t) => t.overriddenAt === null)
			.map((t) => [t.label.trim().toLowerCase(), { ...t, members: [] }]),
	);

	// Place nodes into topics
	for (const [nodeId, rawLabel] of Object.entries(assignments)) {
		if (overriddenMemberIds.has(nodeId)) continue; // respect override
		const label = rawLabel.trim();
		if (!label) continue;
		const key = label.toLowerCase();
		if (!autoTopics.has(key)) {
			// Mint a new topic
			autoTopics.set(key, {
				id: `tp_${Math.random().toString(16).slice(2, 10)}`,
				label,
				members: [],
				overriddenAt: null,
				createdAt: now,
				updatedAt: now,
			});
		}
		autoTopics.get(key)!.members.push(nodeId);
	}

	// Sort members in every auto topic
	const autoList: GraphTopic[] = [...autoTopics.values()]
		.filter((t) => t.members.length > 0)
		.map((t) => ({ ...t, members: [...t.members].sort(), updatedAt: now }));

	return {
		version: 1,
		topics: [...overridden, ...autoList],
		unassigned: org.unassigned, // user-explicit unassigned list is never cleared by auto runs
		lastAutoRunAt: now,
	};
}

/** Actions the user can take on the topic organization (API shape). */
export type TopicAction =
	| { action: "rename-topic"; id: string; label: string }
	| { action: "move-node"; nodeId: string; toTopicId: string | null } // null = unassign
	| { action: "merge-topics"; sourceId: string; targetId: string }
	| { action: "create-topic"; label: string; nodeIds: string[] }
	| { action: "delete-topic" ; id: string }; // members become unassigned

/** Apply a single user action to the topic organization.
 *  Returns a new state; sets overriddenAt on changed topics. */
export function applyTopicAction(
	org: TopicOrganization,
	action: TopicAction,
	now: string,
): TopicOrganization {
	let topics = org.topics.map((t) => ({ ...t, members: [...t.members] }));
	let unassigned = [...org.unassigned];

	switch (action.action) {
		case "rename-topic": {
			topics = topics.map((t) =>
				t.id === action.id
					? { ...t, label: action.label, overriddenAt: now, updatedAt: now }
					: t,
			);
			break;
		}
		case "move-node": {
			// Remove from all current topics
			topics = topics.map((t) => ({
				...t,
				members: t.members.filter((m) => m !== action.nodeId),
				...(t.members.includes(action.nodeId) ? { overriddenAt: now, updatedAt: now } : {}),
			}));
			unassigned = unassigned.filter((id) => id !== action.nodeId);
			if (action.toTopicId === null) {
				unassigned.push(action.nodeId);
			} else {
				topics = topics.map((t) =>
					t.id === action.toTopicId
						? { ...t, members: [...t.members, action.nodeId].sort(), overriddenAt: now, updatedAt: now }
						: t,
				);
			}
			break;
		}
		case "merge-topics": {
			const source = topics.find((t) => t.id === action.sourceId);
			if (!source) break;
			topics = topics
				.filter((t) => t.id !== action.sourceId)
				.map((t) =>
					t.id === action.targetId
						? {
								...t,
								members: [...new Set([...t.members, ...source.members])].sort(),
								overriddenAt: now,
								updatedAt: now,
						  }
						: t,
				);
			break;
		}
		case "create-topic": {
			// Remove nodeIds from existing topics
			const movedIds = new Set(action.nodeIds);
			topics = topics.map((t) => ({
				...t,
				members: t.members.filter((m) => !movedIds.has(m)),
				...(t.members.some((m) => movedIds.has(m)) ? { overriddenAt: now, updatedAt: now } : {}),
			}));
			unassigned = unassigned.filter((id) => !movedIds.has(id));
			topics.push({
				id: `tp_${Math.random().toString(16).slice(2, 10)}`,
				label: action.label,
				members: [...action.nodeIds].sort(),
				overriddenAt: now, // user-created = overridden from birth
				createdAt: now,
				updatedAt: now,
			});
			break;
		}
		case "delete-topic": {
			const topic = topics.find((t) => t.id === action.id);
			if (topic) unassigned.push(...topic.members.filter((id) => !unassigned.includes(id)));
			topics = topics.filter((t) => t.id !== action.id);
			break;
		}
	}

	return { ...org, topics, unassigned, lastAutoRunAt: org.lastAutoRunAt };
}
