/**
 * TOPIC ASSIGN — LLM-based semantic topic classifier (2026-11-12).
 *
 * Given all proposition nodes in the graph, calls a cheap LLM to group them
 * into named topics by semantic proximity, unifying chats, exercises, and
 * imported materials into macroscopic domain clusters.
 * The result is written to topics.json via the TopicOrganizationStore;
 * nodes in user-overridden topics are skipped.
 *
 * Uses runSubagent (the shared runner) with a single-turn prompt and no tools
 * — a pure classification task. Engine is injected by the caller (same BYOK
 * pattern as extraction/auditor). Falls back gracefully when no model is set.
 *
 * The function is fire-and-forget safe: on any failure it logs and returns
 * null — the existing topics.json is left untouched.
 */

import path from "node:path";
import type { GraphNode } from "../../core/contracts.ts";
import type {
	TopicOrganizationStore,
	ChatStore,
	ChatOrganizationStore,
	SourceOrganizationStore,
	GraphStore,
} from "../../core/ports.ts";
import type { TopicSettings } from "../../core/settings.ts";
import type { PiEngine } from "../models.ts";
import { runSubagent } from "./pi-run.ts";
import {
	nodesToClassify,
	applyTopicAssignments,
} from "../../core/topic-organization.ts";

export interface TopicAssignDeps {
	topicStore: TopicOrganizationStore;
	/** The cheap-slot engine (same as extractor/auditor). undefined = skip. */
	engine: PiEngine | undefined;
	chatStore?: ChatStore;
	chatOrganizationStore?: ChatOrganizationStore;
	sourceOrganizationStore?: SourceOrganizationStore;
	graphStore?: GraphStore;
	topicSettings?: TopicSettings;
}

/** How many nodes to classify in one LLM call before chunking.
 *  At ~100 chars per node entry with metadata, 150 nodes ≈ 15K chars — well within context. */
const NODES_PER_CHUNK = 150;

interface SessionInfo {
	subject?: string;
	title: string;
}

function buildStudyContext(
	nodes: readonly GraphNode[],
	deps: TopicAssignDeps,
): {
	contextPrompt: string;
	nodeMetadata: Map<string, { subject?: string; source?: string }>;
} {
	const chatOrg = deps.chatOrganizationStore?.read();
	const sourceOrg = deps.sourceOrganizationStore?.read();
	const chatStore = deps.chatStore;
	const graphStore = deps.graphStore;

	const chatFolderMap = new Map<string, string>();
	if (chatOrg) {
		for (const f of chatOrg.folders) {
			chatFolderMap.set(f.id, f.name);
		}
	}
	const sourceFolderMap = new Map<string, string>();
	if (sourceOrg) {
		for (const f of sourceOrg.folders) {
			sourceFolderMap.set(f.id, f.name);
		}
	}

	const sessionInfoMap = new Map<string, SessionInfo>();

	if (chatStore) {
		for (const summary of chatStore.listChats()) {
			const chat = chatStore.getChat(summary.id);
			const title = chat?.title || summary.title || summary.id;
			const placement = chatOrg?.placements[summary.id];
			const folderName = placement?.folderId ? chatFolderMap.get(placement.folderId) : undefined;
			sessionInfoMap.set(summary.id, { subject: folderName, title });
		}
	}

	if (graphStore) {
		const sources = graphStore.readSources();
		for (const src of sources) {
			const placement = sourceOrg?.placements[src.id];
			const title = placement?.name || path.basename(src.filePath);
			const folderName = placement?.folderId ? sourceFolderMap.get(placement.folderId) : undefined;
			sessionInfoMap.set(src.id, { subject: folderName, title });
		}
	}

	// Group sessions & sources by folder
	const folderItems = new Map<string, Set<string>>();
	for (const info of sessionInfoMap.values()) {
		const folder = info.subject || "General / Unfiled";
		if (!folderItems.has(folder)) {
			folderItems.set(folder, new Set());
		}
		folderItems.get(folder)!.add(info.title);
	}

	const contextLines: string[] = [];
	if (folderItems.size > 0) {
		contextLines.push("STUDY CONTEXT (Subject folders and materials):");
		for (const [folder, items] of folderItems.entries()) {
			contextLines.push(`- Course/Folder "${folder}": ${[...items].map((i) => `"${i}"`).join(", ")}`);
		}
		contextLines.push("");
	}

	// Map each node to its subject and source
	const nodeMetadata = new Map<string, { subject?: string; source?: string }>();
	for (const n of nodes) {
		const subjects = new Set<string>();
		const sources = new Set<string>();
		for (const pt of n.provenance ?? []) {
			const info = sessionInfoMap.get(pt.chatId);
			if (info) {
				if (info.subject) subjects.add(info.subject);
				sources.add(info.title);
			}
		}
		nodeMetadata.set(n.id, {
			subject: subjects.size > 0 ? [...subjects].join(", ") : undefined,
			source: sources.size > 0 ? [...sources].join(", ") : undefined,
		});
	}

	return {
		contextPrompt: contextLines.join("\n"),
		nodeMetadata,
	};
}

/** Run the topic-assign pass over all proposition nodes.
 *  Returns the number of topics written, or null on failure (models not
 *  configured, key missing, network error). */
export async function runTopicAssign(
	nodes: readonly GraphNode[],
	deps: TopicAssignDeps,
): Promise<number | null> {
	if (!deps.engine) {
		console.info("[topic-assign] skipped — no engine configured");
		return null;
	}

	// Only proposition nodes (n_…) — implication nodes (arg_…) are never clustered
	const propositions = nodes.filter((n) => n.id.startsWith("n_"));
	if (propositions.length === 0) return 0;

	const org = deps.topicStore.read();
	const allIds = new Set(propositions.map((n) => n.id));
	const toClassify = nodesToClassify(org, allIds);
	if (toClassify.length === 0) return org.topics.length;

	// Build a nodeId → node lookup
	const nodeMap = new Map(propositions.map((n) => [n.id, n]));

	// Collect context (folders, chats, materials)
	const studyContext = buildStudyContext(propositions, deps);

	// Collect existing topic labels for the LLM to prefer (avoid synonyms)
	const existingLabels = org.topics.map((t) => t.label);

	// Process in chunks so very large graphs don't blow the context window
	const allAssignments: Record<string, string> = {};
	const chunks: string[][] = [];
	for (let i = 0; i < toClassify.length; i += NODES_PER_CHUNK) {
		chunks.push(toClassify.slice(i, i + NODES_PER_CHUNK));
	}

	for (const [chunkIdx, chunk] of chunks.entries()) {
		const nodeLines = chunk
			.map((id) => {
				const n = nodeMap.get(id);
				if (!n) return null;
				const meta = studyContext.nodeMetadata.get(id);
				const payload: Record<string, unknown> = {
					id,
					name: n.name,
					statement: n.statement,
				};
				if (meta?.subject) payload.subject = meta.subject;
				if (meta?.source) payload.source = meta.source;
				return JSON.stringify(payload);
			})
			.filter(Boolean)
			.join("\n");

		const existingLabelsLine =
			existingLabels.length > 0
				? `\nExisting topic labels (reuse exact spelling when appropriate):\n${existingLabels.map((l) => `- ${l}`).join("\n")}\n`
				: "";

		const granularity = deps.topicSettings?.granularity ?? "broad";
		let granularityRule = "";
		if (granularity === "fine") {
			granularityRule = [
				`1. FINE-GRAINED GRANULARITY (Detailed micro-topics):`,
				`   - Create specific, focused topics for distinct sub-concepts, operations, or properties.`,
				`   - Aim for roughly 3–6 nodes per topic.`,
				`   - Prefer smaller, precise topic clusters (e.g. separate "B-Tree Properties", "B-Tree Insertion", "B-Tree Deletion").`,
			].join("\n");
		} else if (granularity === "balanced") {
			granularityRule = [
				`1. BALANCED GRANULARITY (Modular topics):`,
				`   - Group nodes into moderately sized modular topics.`,
				`   - Aim for roughly 6–12 nodes per topic.`,
				`   - Balance detail with conceptual cohesion (e.g. "Binary Search Trees", "Balanced Search Trees", "B-Trees").`,
			].join("\n");
		} else {
			granularityRule = [
				`1. MACROSCOPIC DOMAIN TOPICS (Breadth & Cohesion):`,
				`   - Group nodes into broad, meaningful course/domain topics covering major exam areas.`,
				`   - Aim for roughly 8–25 nodes per topic (depending on density across the course).`,
				`   - DO NOT create tiny micro-topics for specific sub-operations or properties (e.g. unify all B-tree concepts under "B-Alberi" / "B-Trees").`,
			].join("\n");
		}

		const unification = deps.topicSettings?.unification ?? "folder";
		let unificationRule = "";
		if (unification === "strict") {
			unificationRule = [
				`2. STRICT SESSION ISOLATION:`,
				`   - Keep nodes from different chats or slide decks in separate topics.`,
				`   - Do NOT merge nodes across different sessions or files even if they discuss related concepts.`,
			].join("\n");
		} else if (unification === "global") {
			unificationRule = [
				`2. GLOBAL CROSS-COURSE UNIFICATION:`,
				`   - Unify related concepts across all sessions and folders across the entire graph into shared topics whenever they discuss the same overarching domain.`,
			].join("\n");
		} else {
			unificationRule = [
				`2. CROSS-SESSION & CROSS-MATERIAL UNIFICATION WITHIN SUBJECT:`,
				`   - Nodes from different chats, exercises, and PDF slide decks that belong to the same subject folder (e.g. "alg. dati" or "SO. Lab.") and cover related concepts MUST be unified into the same macroscopic topic.`,
				`   - Do NOT create separate topics merely because nodes originated from different chats or slide decks within the same subject.`,
			].join("\n");
		}

		const customPrompt = deps.topicSettings?.customPrompt?.trim();
		const customPromptSection = customPrompt
			? `\nUSER CUSTOM DIRECTIVES (Must strictly follow):\n${customPrompt}\n`
			: "";

		const prompt = [
			`You are an expert academic knowledge organizer. Group the following proposition nodes into cohesive semantic topics.`,
			``,
			studyContext.contextPrompt,
			existingLabelsLine,
			`Nodes to classify (JSON, one per line):`,
			nodeLines,
			``,
			`Rules:`,
			granularityRule,
			unificationRule,
			`3. Assign EVERY node in the input list to exactly one topic label. The JSON output must contain an entry for each nodeId.`,
			`4. Topic labels must be concise, professional noun phrases (2–5 words), matching the primary language of the material (e.g. Italian if the nodes/courses are in Italian).`,
			`5. If a node fits an existing label listed above, use that EXACT label (identical spelling and capitalization).`,
			`6. Create a new label only when no existing label fits.`,
			`7. Reply with ONLY valid JSON: {"nodeId": "topic label", ...}. No explanation, no markdown code fences.`,
			customPromptSection,
		].filter(Boolean).join("\n");

		try {
			const result = await runSubagent([], {
				engine: deps.engine,
				systemPrompt: "You are a precise JSON-only responder. Never add explanations or markdown. Reply with valid JSON only.",
				prompt,
				maxTurns: 1,
				bypassWorkerRequestAdmission: true,
			});
			const parsed = parseAssignmentJson(result.text);
			Object.assign(allAssignments, parsed);
			console.info(`[topic-assign] chunk ${chunkIdx + 1}/${chunks.length}: ${Object.keys(parsed).length} nodes assigned`);
		} catch (err) {
			console.error(
				`[topic-assign] chunk ${chunkIdx + 1}/${chunks.length} failed:`,
				err instanceof Error ? err.message : err,
			);
			// Continue with remaining chunks; partial results are still useful
		}
	}

	if (Object.keys(allAssignments).length === 0) {
		console.warn("[topic-assign] no assignments returned from LLM");
		return null;
	}

	const now = new Date().toISOString();
	const nextOrg = applyTopicAssignments(org, allAssignments, now);
	deps.topicStore.write(nextOrg);
	console.info(
		`[topic-assign] done: ${nextOrg.topics.length} topics, ` +
		`${Object.keys(allAssignments).length}/${toClassify.length} nodes assigned`,
	);
	return nextOrg.topics.length;
}

/** Parse the LLM's JSON response, tolerating occasional markdown fences. */
export function parseAssignmentJson(text: string): Record<string, string> {
	// Strip optional ```json ... ``` fences
	const stripped = text.replace(/^```[a-z]*\n?/m, "").replace(/\n?```\s*$/m, "").trim();
	let parsed: unknown;
	try {
		parsed = JSON.parse(stripped);
	} catch {
		// Try to extract a JSON object from the text
		const match = stripped.match(/\{[\s\S]*\}/);
		if (!match) return {};
		try {
			parsed = JSON.parse(match[0]);
		} catch {
			return {};
		}
	}
	if (typeof parsed !== "object" || parsed === null) return {};
	const result: Record<string, string> = {};
	for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
		if (typeof k === "string" && k.startsWith("n_") && typeof v === "string" && v.trim()) {
			result[k] = v.trim();
		}
	}
	return result;
}
