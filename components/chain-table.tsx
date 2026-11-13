"use client";

/**
 * THE CHAIN TABLE (chains overlay; owner refinements round 2, 2026-09-29):
 * every reasoning chain of the graph in one FULL-BLEED surface — the blur
 * + translucent background IS the surface, no inner card. The top bar is
 * THE shared TopBar (standardization ruling: one element, every surface —
 * h-15, lh-drag with carve-outs, select-none, sidebar reopen, traffic-
 * light gutter; born from this overlay's hand-rolled bar breaking every
 * rule at once). The overlay (z-40) covers home's floating header while
 * open, so the TopBar's own SidebarToggle is the reopen path.
 *
 * HIERARCHY (three levels, one click each): CLUSTER (the birth session —
 * a chat or a notes file; a chain lives where its CONCLUSION was born,
 * owner ruling) → REASONING CHAIN → PROPOSITION STATEMENTS. Expanding a
 * chain reveals its members' statement text directly — names live in the
 * chain line, never twice; a singleton reveals its one statement in one
 * click. Everything starts collapsed. PROMINENT indentation carries the
 * structure (owner ruling: chains deep under folders, statements deeper)
 * — the ONLY lines are the horizontal separators between cluster groups
 * (vertical column hairlines removed with them, owner ruling: "anything
 * else is better without them").
 *
 * THE CHAIN LINE: every proposition name is a faint-outlined CHIP
 * with the LOGIC as the connectives (owner rulings, 2026-09-30):
 * premises join with the LaTeX LAND (∧) and the conclusion separates
 * by the LaTeX IMPLICATION (⟹) — `A ∧ B ⟹ C`, never the misleading
 * `A → B → C`. The glyphs are REAL KaTeX renders (components/
 * latex-glyph.tsx — the app's math engine, never SVGs), PROMINENT in
 * the theme foreground (white), not dim gray. A lonely chip (no
 * premises) carries no glyph — it reads as a standalone proposition;
 * "(no premises)" survives only as the row's aria-label.
 *
 * SORTING: all three columns sortable (owner ruling — "consistency is
 * key"): Name (A→Z), Props (largest-first), Created (newest-first);
 * click toggles asc/desc; a SMALL chevron marks the active header. Sort
 * orders cluster rows AND chains within.
 *
 * SELECTION never shifts layout (owner ruling): a floating bottom bar —
 * the Google-Photos pattern — appears only when something is selected,
 * showing the agents' ACTUAL input (chainsForSelection over the flat
 * node-id selection: a premise without its conclusion counts as the
 * singleton it becomes) + Clear. DELETE (owner,
 * 2026-09-29 night: "this is really the view deletion should be done
 * in") rides the same bar FENCED at the right end — divider + the
 * destructive red pair — and opens the SAME full-death confirm dialog
 * the canvas uses (multi-selections list their names + the unioned
 * impact); this ends the overlay's read-only stance: it is the graph's
 * MANAGEMENT surface now. The fuzzy
 * search (names, aliases, statements) filters chains grouped +
 * auto-expanded under their clusters (non-matching clusters hide; the
 * collapsed view returns on clear).
 *
 * Read-only toward the graph.
 */

import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
	ChevronDownIcon,
	ChevronUpIcon,
	BookIcon,
	BookOpenIcon,
	FolderIcon,
	FolderPlusIcon,
	FolderTreeIcon,
	Trash2Icon,
	ListTreeIcon,
	RefreshCwIcon,
	SettingsIcon,
	PlusIcon,
	SearchIcon,
	XIcon,
	ArrowRightIcon,
} from "lucide-react";
import { chainsForSelection, chainSourceDirectory, folderEntryCheck, toggleSourceEntries, formatChainLine, fuzzyScore, sourceFileLabel } from "@/src/core";
import type { GraphChain, GraphNode, SourceDirectory, SourceEntry, SourceFolder, SourceEntrySelection } from "@/src/core";
import type { TopicOrganization, TopicAction } from "@/src/core";
import { useSettingsDialog } from "@/components/settings/settings-dialog";
import { cn } from "@/lib/utils";
import { EditableSourceName, SourceDragRow, sourceNameMatches, SourceFolderTree, type OrganizationChange } from "./source-folder-tree";
import { chainRow, useChainNavigation } from "./chain-navigation";
import { useServerEvent, useServerResync } from "./server-events";
import { TopBar } from "@/components/top-bar";
import { InteractionLayerOwner, useInteractionLayer } from "./interaction-layers";
import { DeleteSourceDialog } from "@/components/delete-source-dialog";
import { LatexGlyph } from "@/components/latex-glyph";
import { ToolContentResponse } from "@/components/ai-elements/message";
import { TreeCell, TreeCheckbox, TreeDisclosure, TreeGuide, TreeHeader, TreeSelectionSpacer, TreeSeparator, treeBranchLayout, treeColumnLayout, treeRowLayout } from "./tree-presentation";
import { OrganizationFeedbackToast, type OrganizationFeedback } from "./chat-organization-interactions";

interface TopicPreviewResponse {
	cancelled?: boolean;
	base: TopicOrganization;
	proposed: TopicOrganization;
	propositions: { id: string; name: string }[];
	reviewBeforeApply: boolean;
}

function topicLabelForNode(organization: TopicOrganization, nodeId: string): string {
	return organization.topics.find((topic) => topic.members.includes(nodeId))?.label ?? "Unassigned";
}

function changedPropositions(preview: TopicPreviewResponse): TopicPreviewResponse["propositions"] {
	return preview.propositions.filter((node) =>
		topicLabelForNode(preview.base, node.id) !== topicLabelForNode(preview.proposed, node.id),
	);
}

/** The sortable columns (owner ruling: all three — consistency). */
export type ChainSortCol = "name" | "props" | "created";
export interface ChainSort {
	col: ChainSortCol;
	/** 1 = ascending (A→Z, oldest-first, smallest-first), -1 = descending. */
	dir: 1 | -1;
}

/** A cluster's chains share the conclusion's birth (owner ruling). This
 *  record is assembled per render from the visible chains. */
interface ClusterGroup {
	key: string;
	birth: string | null;
	label: string | null;
	kind: "chat" | "notes" | null;
	chains: ReturnType<typeof chainsForSelection>;
	nodeIds: string[];
	newestCreatedAt: string;
	rawTopicId?: string;
}

/** The table's pure body — exported for SSR pins (the render-suite
 *  discipline). All state (query, sort, selection, expansion) arrives
 *  via props; the overlay wrapper below owns it. */
export function ChainTableBody({
	nodes,
	chains: storedChains,
	sessions,
	fileSources,
	query,
	onQuery,
	sort,
	onSort,
	selection,
	expandedClusters,
	expandedChains,
	onToggleCluster,
	onToggleChain,
	onToggleNodes,
	onClear,
	onDelete,
	onClose,
	selectMode,
	onSelect,
	directory: fullDirectory,
	onOrganizationChange,
	selectedFolders = new Set<string>(),
	selectedSources = new Set<string>(),
	onToggleSource = () => {},
	onToggleFolder = () => {},
	keyboardActive = true,
	sourceInventoryPending = false,
	pickerChrome = false,
	topicOrg: propTopicOrg,
	initialGroupBy,
	initialCreatingTopic,
	onTopicOrganizationStart,
}: {
	initialCreatingTopic?: boolean;
	topicOrg?: TopicOrganization | null;
	initialGroupBy?: "sources" | "topics";
	sourceInventoryPending?: boolean;
	pickerChrome?: boolean;
	keyboardActive?: boolean;
	directory?: SourceDirectory;
	onOrganizationChange?: OrganizationChange;
	selectedFolders?: ReadonlySet<string>;
	selectedSources?: ReadonlySet<string>;
	onToggleSource?: (id: string, next: boolean) => void;
	onToggleFolder?: (id: string, next: boolean) => void;
	nodes: GraphNode[];
	chains: GraphChain[];
	sessions: Record<string, string>;
	fileSources: Record<string, string>;
	query: string;
	onQuery: (v: string) => void;
	sort: ChainSort;
	onSort: (col: ChainSortCol) => void;
	selection: ReadonlySet<string>;
	expandedClusters: ReadonlySet<string>;
	expandedChains: ReadonlySet<string>;
	onToggleCluster: (key: string) => void;
	onToggleChain: (id: string) => void;
	/** Selection is ALWAYS a flat node-id set — cluster, chain, and single
	 *  proposition checks all reduce to this. */
	onToggleNodes: (ids: string[], next: boolean) => void;
	onClear: () => void;
	/** Opens the full-death confirm dialog (owner, 2026-09-29 night). */
	onDelete: () => void;
	onClose: () => void;
	/** PRACTICE SELECT (2026-10-04): the floating bar's confirm becomes
	 *  "Practice these" — no delete fence; the caller owns what the
	 *  selection becomes. */
	selectMode?: boolean;
	onSelect?: () => void;
	onTopicOrganizationStart?: () => { operationId: string; finish: (error?: string) => void };
}) {
	const [creatingFolder, setCreatingFolder] = useState(false);
	const [creatingTopic, setCreatingTopic] = useState(initialCreatingTopic ?? false);
	const [refreshingTopics, setRefreshingTopics] = useState(false);
	const [topicStatusMsg, setTopicStatusMsg] = useState<string | null>(null);
	const [topicPreview, setTopicPreview] = useState<TopicPreviewResponse | null>(null);
	const [topicPreviewError, setTopicPreviewError] = useState<string | null>(null);
	const [topicFeedback, setTopicFeedback] = useState<OrganizationFeedback | null>(null);
	const { open: openSettings } = useSettingsDialog();

	const postTopicAction = async (action: TopicAction) => {
		try {
			const res = await fetch("/api/graph/topics", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(action),
			});
			if (res.ok) {
				const next = (await res.json()) as TopicOrganization;
				setFetchedTopicOrg(next);
			}
		} catch (err) {
			console.error("[topics] action failed:", err);
		}
	};

	const runAutoOrganize = async () => {
		const activity = onTopicOrganizationStart?.();
		setRefreshingTopics(true);
		setTopicPreview(null);
		setTopicPreviewError(null);
		setTopicFeedback(null);
		setTopicStatusMsg(null);
		let activityError: string | undefined;
		try {
			const res = await fetch("/api/graph/topics/refresh", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ action: "preview", operationId: activity?.operationId ?? crypto.randomUUID() }),
			});
			const data = await res.json() as TopicPreviewResponse & { error?: string };
			if (data.cancelled) {
				setTopicStatusMsg("Topic organization cancelled");
			} else if (!res.ok || data.error) {
				activityError = data.error || "Failed to organize topics";
				if (!activity) setTopicStatusMsg(activityError);
			} else if (changedPropositions(data).length > 0 && data.reviewBeforeApply) {
				setTopicPreview(data);
			} else if (changedPropositions(data).length > 0) {
				await applyGeneratedPreview(data);
			} else {
				setTopicStatusMsg("No topic titles changed");
			}
		} catch (err) {
			activityError = err instanceof Error ? err.message : "Error connecting to server";
			if (!activity) setTopicStatusMsg(activityError);
		} finally {
			setRefreshingTopics(false);
			activity?.finish(activityError);
		}
	};
	const undoTopicPreview = async (preview: TopicPreviewResponse) => {
		try {
			const res = await fetch("/api/graph/topics/refresh", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ action: "undo", expected: preview.proposed, restore: preview.base, propositionIds: preview.propositions.map((node) => node.id) }),
			});
			const data = await res.json() as { error?: string };
			if (!res.ok) throw new Error(data.error || "Could not undo topic organization.");
			setFetchedTopicOrg(preview.base);
			setTopicStatusMsg("Previous topic assignments restored");
		} catch (err) {
			setTopicFeedback({ type: "error", message: err instanceof Error ? err.message : "Could not undo topic organization." });
		}
	};
	const applyGeneratedPreview = async (preview: TopicPreviewResponse) => {
		setRefreshingTopics(true);
		setTopicPreviewError(null);
		try {
			const res = await fetch("/api/graph/topics/refresh", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ action: "apply", base: preview.base, proposed: preview.proposed, propositionIds: preview.propositions.map((node) => node.id) }),
			});
			const data = await res.json() as { topics?: number; error?: string };
			if (!res.ok) throw new Error(data.error || "Could not apply topic organization.");
			setFetchedTopicOrg(preview.proposed);
			setTopicPreview(null);
			setTopicStatusMsg(`Organized into ${data.topics ?? 0} topics`);
			setTopicFeedback({
				type: "success",
				message: `Auto-organized into ${data.topics ?? 0} topics`,
				onUndo: () => { void undoTopicPreview(preview); },
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : "Could not apply topic organization.";
			if (preview.reviewBeforeApply) setTopicPreviewError(message);
			else setTopicStatusMsg(message);
		} finally {
			setRefreshingTopics(false);
		}
	};
	const applyTopicPreview = () => {
		if (topicPreview) void applyGeneratedPreview(topicPreview);
	};
	const tableRef = useRef<HTMLDivElement>(null);
	const searchRef = useRef<HTMLInputElement>(null);
	const navigation = useChainNavigation(tableRef, searchRef, keyboardActive);
	// Searches still expand sources/folders by default, but explicit keyboard
	// or pointer collapses remain effective until the search changes.
	const [searchFolds, setSearchFolds] = useState({ query, ids: new Set<string>() });
	useEffect(() => { setSearchFolds({ query, ids: new Set() }); }, [query]);
	const foldedClusters = searchFolds.query === query ? searchFolds.ids : new Set<string>();
	const toggleCluster = (id: string) => {
		if (!query.trim()) { onToggleCluster(id); return; }
		setSearchFolds((previous) => {
			const ids = new Set(previous.query === query ? previous.ids : []);
			if (ids.has(id)) ids.delete(id); else ids.add(id);
			return { query, ids };
		});
	};
	const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
	const directory = useMemo(() => fullDirectory && chainSourceDirectory(fullDirectory), [fullDirectory]);
	const hiddenSourceIds = useMemo(() => new Set(fullDirectory?.sources.filter((s) => s.chatKind === "practice").map((s) => s.id)), [fullDirectory]);
	const sourceRecords = useMemo(() => new Map(directory?.sources.map((s) => [s.id, s])), [directory]);
	const matchesSource = useCallback((birth: string) => sourceNameMatches(directory, birth,
		sourceRecords.get(birth)?.label ?? sessions[birth] ?? (fileSources[birth] === undefined ? null : sourceFileLabel(fileSources[birth])), query),
	[directory, sourceRecords, sessions, fileSources, query]);
	const chains = useMemo(() => chainsForSelection(nodes, storedChains), [nodes, storedChains]);
	// Filter source groups, not global nodes: shared premises remain visible
	// in teaching/notes groups. Keep the graph-wide header and pick set intact.
	const sourceChains = useMemo(() => chains.filter((chain) =>
		!hiddenSourceIds.has(byId.get(chain.conclusion)?.provenance[0]?.chatId ?? "")), [chains, byId, hiddenSourceIds]);
	const searching = query.trim() !== "";
	const allSourceNodes = useMemo(() => {
		const membership = new Map<string, Set<string>>();
		for (const chain of sourceChains) {
			const birth = byId.get(chain.conclusion)?.provenance[0]?.chatId;
			if (!birth) continue;
			const members = membership.get(birth) ?? new Set<string>();
			for (const id of [...chain.premises, chain.conclusion]) members.add(id);
			membership.set(birth, members);
		}
		return membership;
	}, [sourceChains, byId]);

	// The fuzzy filter: a chain is visible when ANY member matches on
	// name, aliases, or statement; chains rank by best member score.
	const visibleChains = useMemo(() => {
		if (!searching) return sourceChains;
		const scored = sourceChains
			.map((chain) => {
				const birth = byId.get(chain.conclusion)?.provenance[0]?.chatId;
				let best: number | null = birth && matchesSource(birth) ? 0 : null;
				for (const id of [...chain.premises, chain.conclusion]) {
					const node = byId.get(id);
					if (!node) continue;
					const s = fuzzyScore(query, node.name, node.statement, ...node.aliases);
					if (s === null) continue;
					if (best === null || s > best) best = s;
				}
				return best === null ? null : { chain, best };
			})
			.filter((r): r is { chain: (typeof chains)[number]; best: number } => r !== null);
		return scored
			.sort((a, b) => b.best - a.best || (a.chain.id < b.chain.id ? -1 : 1))
			.map(({ chain }) => chain);
	}, [sourceChains, byId, query, searching, matchesSource]);

	// Group the visible chains by their CONCLUSION's birth (owner ruling).
	// Unlabeled births (provenance gone / never named) form one honest
	// muted group, sorted last under name-sort.
	const groups = useMemo(() => {
		// Session kinds must arrive before provenance-only source rows can render.
		if (sourceInventoryPending) return [];
		const map = new Map<string, ClusterGroup>();
		for (const source of directory?.sources ?? []) {
			if (searching && !matchesSource(source.id)) continue;
			map.set(source.id, { key: source.id, birth: source.id, label: source.label,
				kind: source.kind === "missing" ? null : source.kind, chains: [], nodeIds: [], newestCreatedAt: "" });
		}
		for (const chain of visibleChains) {
			const conclusion = byId.get(chain.conclusion);
			const birth = conclusion?.provenance[0]?.chatId ?? null;
			const key = birth ?? "\0unlabeled";
			let group = map.get(key);
			if (!group) {
				const label = birth === null ? null : (sourceRecords.get(birth)?.label ?? sessions[birth] ?? (fileSources[birth] === undefined ? null : sourceFileLabel(fileSources[birth])));
				const kind =
					birth === null ? null : sessions[birth] !== undefined ? "chat" : fileSources[birth] !== undefined ? "notes" : null;
				group = { key, birth, label, kind, chains: [], nodeIds: [], newestCreatedAt: "" };
				map.set(key, group);
			}
			group.chains.push(chain);
			for (const id of [...chain.premises, chain.conclusion]) {
				if (!group.nodeIds.includes(id)) group.nodeIds.push(id);
				const createdAt = byId.get(id)?.createdAt ?? "";
				if (createdAt > group.newestCreatedAt) group.newestCreatedAt = createdAt;
			}
		}
		const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
		const list = [...map.values()];
		// Existing graph groups retain their newest-member date. Inventory-only
		// rows fall back to record dates; a re-import must not redraft old dates.
		for (const group of list) if (!group.newestCreatedAt && group.birth) group.newestCreatedAt = sourceRecords.get(group.birth)?.createdAt ?? "";
		// Sort law (owner ruling: all three columns sortable — consistency):
		// the active column orders BOTH cluster rows and chains within; name
		// is the universal tiebreak (asc). Unlabeled clusters sort last under
		// name-sort (￿ sentinel).
		const nameKey = (g: ClusterGroup) => g.label ?? "\uffff";
		const cmpName = (a: ClusterGroup, b: ClusterGroup) => collator.compare(nameKey(a), nameKey(b)) * (sort.col === "name" ? sort.dir : 1);
		const cmpProps = (a: ClusterGroup, b: ClusterGroup) =>
			sort.dir === -1 ? b.nodeIds.length - a.nodeIds.length : a.nodeIds.length - b.nodeIds.length;
		const cmpCreated = (a: ClusterGroup, b: ClusterGroup) =>
			sort.dir === -1 ? b.newestCreatedAt.localeCompare(a.newestCreatedAt) : a.newestCreatedAt.localeCompare(b.newestCreatedAt);
		list.sort((a, b) =>
			sort.col === "created" ? cmpCreated(a, b) || cmpName(a, b) : sort.col === "props" ? cmpProps(a, b) || cmpName(a, b) : cmpName(a, b),
		);
		for (const group of list) {
			const chainName = (chain: (typeof chains)[number]) => byId.get(chain.conclusion)?.name ?? chain.conclusion;
			const chainSize = (chain: (typeof chains)[number]) => chain.premises.length + 1;
			const chainDate = (chain: (typeof chains)[number]) => byId.get(chain.conclusion)?.createdAt ?? "";
			const cName = (a: (typeof chains)[number], b: (typeof chains)[number]) => collator.compare(chainName(a), chainName(b)) * (sort.col === "name" ? sort.dir : 1);
			const cProps = (a: (typeof chains)[number], b: (typeof chains)[number]) =>
				sort.dir === -1 ? chainSize(b) - chainSize(a) : chainSize(a) - chainSize(b);
			const cDate = (a: (typeof chains)[number], b: (typeof chains)[number]) =>
				sort.dir === -1 ? chainDate(b).localeCompare(chainDate(a)) : chainDate(a).localeCompare(chainDate(b));
			group.chains.sort((a, b) =>
				sort.col === "created" ? cDate(a, b) || cName(a, b) : sort.col === "props" ? cProps(a, b) || cName(a, b) : cName(a, b),
			);
		}
		return list;
	}, [visibleChains, byId, sessions, fileSources, sort, directory, sourceRecords, searching, matchesSource, sourceInventoryPending]);

	// The derived shape under the floating bar (the agents' ACTUAL input).
	const derived = useMemo(() => {
		const selectedNodes = [...selection].map((id) => byId.get(id)).filter((n): n is GraphNode => n !== undefined);
		return chainsForSelection(selectedNodes, storedChains);
	}, [selection, byId, storedChains]);

	const [groupBy, setGroupBy] = useState<"sources" | "topics">(initialGroupBy ?? "sources");
	const [fetchedTopicOrg, setFetchedTopicOrg] = useState<TopicOrganization | null>(propTopicOrg ?? null);
	const topicOrg = fetchedTopicOrg ?? propTopicOrg;
	const changedTopicPropositions = useMemo(() => topicPreview ? changedPropositions(topicPreview) : [], [topicPreview]);

	useEffect(() => {
		if (propTopicOrg) setFetchedTopicOrg(propTopicOrg);
	}, [propTopicOrg]);

	useEffect(() => {
		if (!topicStatusMsg) return;
		const timer = setTimeout(() => setTopicStatusMsg(null), 4000);
		return () => clearTimeout(timer);
	}, [topicStatusMsg]);

	useEffect(() => {
		if (!topicFeedback) return;
		const timer = setTimeout(() => setTopicFeedback(null), 6000);
		return () => clearTimeout(timer);
	}, [topicFeedback]);

	useEffect(() => {
		if (groupBy === "topics" && !topicOrg) {
			void fetch("/api/graph/topics", { cache: "no-store" })
				.then((r) => (r.ok ? (r.json() as Promise<TopicOrganization>) : null))
				.then((data) => { if (data) setFetchedTopicOrg(data); })
				.catch(() => {});
		}
	}, [groupBy, topicOrg]);

	const { topicByNode, topicLabelById } = useMemo(() => {
		const byNode = new Map<string, string>();
		const labelById = new Map<string, string>();
		if (!topicOrg?.topics) return { topicByNode: byNode, topicLabelById: labelById };
		for (const t of topicOrg.topics) {
			labelById.set(t.id, t.label);
			for (const m of t.members) {
				byNode.set(m, t.id);
			}
		}
		return { topicByNode: byNode, topicLabelById: labelById };
	}, [topicOrg]);

	const chainTopicLabel = useCallback((chain: (typeof visibleChains)[number]) => {
		const tid = topicByNode.get(chain.conclusion);
		if (tid) return topicLabelById.get(tid) ?? null;
		for (const p of chain.premises) {
			const ptid = topicByNode.get(p);
			if (ptid) return topicLabelById.get(ptid) ?? null;
		}
		return null;
	}, [topicByNode, topicLabelById]);

	const chainSourceLabel = useCallback((chain: (typeof visibleChains)[number]) => {
		const conclusion = byId.get(chain.conclusion);
		const birth = conclusion?.provenance[0]?.chatId ?? null;
		if (!birth) return null;
		return sourceRecords.get(birth)?.label ?? sessions[birth] ?? (fileSources[birth] === undefined ? null : sourceFileLabel(fileSources[birth]));
	}, [byId, sourceRecords, sessions, fileSources]);

	const topicGroups = useMemo(() => {
		if (groupBy !== "topics") return [];
		const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
		const map = new Map<string, ClusterGroup>();

		for (const topic of topicOrg?.topics ?? []) {
			map.set(topic.id, {
				key: `topic-${topic.id}`,
				birth: null,
				label: topic.label,
				kind: null,
				chains: [],
				nodeIds: [...topic.members],
				newestCreatedAt: "",
				rawTopicId: topic.id,
			});
		}

		const unassigned: ClusterGroup = {
			key: "topic-unassigned",
			birth: null,
			label: "Unassigned",
			kind: null,
			chains: [],
			nodeIds: [],
			newestCreatedAt: "",
		};

		for (const chain of visibleChains) {
			const tid = topicByNode.get(chain.conclusion);
			let target = tid ? map.get(tid) : undefined;
			if (!target) {
				for (const p of chain.premises) {
					const ptid = topicByNode.get(p);
					if (ptid && map.has(ptid)) {
						target = map.get(ptid);
						break;
					}
				}
			}
			const group = target ?? unassigned;
			group.chains.push(chain);
			for (const id of [...chain.premises, chain.conclusion]) {
				if (!group.nodeIds.includes(id)) group.nodeIds.push(id);
				const createdAt = byId.get(id)?.createdAt ?? "";
				if (createdAt > group.newestCreatedAt) group.newestCreatedAt = createdAt;
			}
		}

		const list = [...map.values()].filter((g) => g.chains.length > 0 || g.nodeIds.length > 0);
		if (unassigned.chains.length > 0) list.push(unassigned);

		const nameKey = (g: ClusterGroup) => (g.key === "topic-unassigned" ? "\uffff" : (g.label ?? "\uffff"));
		const cmpName = (a: ClusterGroup, b: ClusterGroup) => collator.compare(nameKey(a), nameKey(b)) * (sort.col === "name" ? sort.dir : 1);
		const cmpProps = (a: ClusterGroup, b: ClusterGroup) =>
			sort.dir === -1 ? b.nodeIds.length - a.nodeIds.length : a.nodeIds.length - b.nodeIds.length;
		const cmpCreated = (a: ClusterGroup, b: ClusterGroup) =>
			sort.dir === -1 ? b.newestCreatedAt.localeCompare(a.newestCreatedAt) : a.newestCreatedAt.localeCompare(b.newestCreatedAt);

		list.sort((a, b) =>
			sort.col === "created" ? cmpCreated(a, b) || cmpName(a, b) : sort.col === "props" ? cmpProps(a, b) || cmpName(a, b) : cmpName(a, b),
		);

		for (const group of list) {
			const chainName = (chain: (typeof chains)[number]) => byId.get(chain.conclusion)?.name ?? chain.conclusion;
			const chainSize = (chain: (typeof chains)[number]) => chain.premises.length + 1;
			const chainDate = (chain: (typeof chains)[number]) => byId.get(chain.conclusion)?.createdAt ?? "";
			const cName = (a: (typeof chains)[number], b: (typeof chains)[number]) => collator.compare(chainName(a), chainName(b)) * (sort.col === "name" ? sort.dir : 1);
			const cProps = (a: (typeof chains)[number], b: (typeof chains)[number]) =>
				sort.dir === -1 ? chainSize(b) - chainSize(a) : chainSize(a) - chainSize(b);
			const cDate = (a: (typeof chains)[number], b: (typeof chains)[number]) =>
				sort.dir === -1 ? chainDate(b).localeCompare(chainDate(a)) : chainDate(a).localeCompare(chainDate(b));
			group.chains.sort((a, b) =>
				sort.col === "created" ? cDate(a, b) || cName(a, b) : sort.col === "props" ? cProps(a, b) || cName(a, b) : cName(a, b),
			);
		}

		return list;
	}, [groupBy, topicOrg, visibleChains, topicByNode, byId, sort]);

	const fullySelectedFolders = directory ? new Set([...selectedFolders].filter((id) => folderEntryCheck(directory, id, { sources: selectedSources, folders: selectedFolders }).checked)) : selectedFolders;
	const nameOf = (id: string) => byId.get(id)?.name ?? id;
	const dateOf = (id: string) => byId.get(id)?.createdAt.slice(0, 10) ?? "";
	const dirIcon = (col: ChainSortCol) =>
		sort.col !== col ? null : sort.dir === 1 ? <ChevronUpIcon className="size-3" /> : <ChevronDownIcon className="size-3" />;

	const renderChainItem = (
		chain: (typeof visibleChains)[number],
		groupKey: string,
		depth: number,
		mode: "sources" | "topics",
	) => {
		const memberIds = [...chain.premises, chain.conclusion];
		const chainOpen = expandedChains.has(chain.id);
		const selectedInChain = memberIds.filter((id) => selection.has(id)).length;
		const topicLabel = chainTopicLabel(chain);
		const sourceLabel = chainSourceLabel(chain);

		return (
			<div key={chain.id} data-testid={`chain-block-${chain.id}`} {...treeBranchLayout()}>
				{chainOpen && memberIds.length > 0 && (
					<TreeGuide selectionColumn depth={1} variant="compact" data-testid={`chain-thread-${chain.id}`} />
				)}
				<div
					{...chainRow(["chain", groupKey, chain.id], depth + 1, chainOpen)}
					data-testid={`chain-row-${chain.id}`}
					aria-label={formatChainLine(chain, Object.fromEntries([...byId.entries()].map(([id, n]) => [id, { name: n.name }]))) }
					{...treeRowLayout({ depth: 1, variant: "compact" })}
				>
					{selectMode ? (
						<RowCheckbox
							checked={selectedInChain === memberIds.length && memberIds.length > 0}
							indeterminate={selectedInChain > 0 && selectedInChain < memberIds.length}
							onToggle={(next) => onToggleNodes(memberIds, next)}
							testid={`chain-checkbox-${chain.id}`}
							label={`Select chain ${nameOf(chain.conclusion)}`}
						/>
					) : (
						<TreeSelectionSpacer />
					)}
					<Expander
						open={chainOpen}
						onClick={() => onToggleChain(chain.id)}
						testid={`chain-toggle-${chain.id}`}
						label={`Expand chain ${nameOf(chain.conclusion)}`}
					/>
					<span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-0.5 gap-y-1 text-[13px] leading-tight">
						{memberIds.map((id, i) => {
							const isConclusion = i === memberIds.length - 1;
							return (
								<span key={id} className="flex items-center">
									{i > 0 && (isConclusion ? (
										<LatexGlyph
											cmd="\implies"
											testid={`chain-implies-${chain.id}`}
											className="px-1.5 text-foreground"
										/>
									) : (
										<LatexGlyph
											cmd="\land"
											testid={`chain-and-${chain.id}-${i}`}
											className="px-1.5 text-foreground"
										/>
									))}
									<span
										data-testid={`prop-chip-${id}`}
										className="rounded border border-border/70 bg-muted/30 px-1.5 py-0.5"
									>
										{nameOf(id)}
									</span>
								</span>
							);
						})}
						{mode === "sources" && topicLabel && (
							<span
								data-testid={`chain-topic-badge-${chain.id}`}
								className="ml-2 inline-flex items-center rounded-sm border border-border/50 bg-muted/20 px-1.5 py-0.5 font-ui text-[10px] text-muted-foreground"
								title={`Topic: ${topicLabel}`}
							>
								{topicLabel}
							</span>
						)}
						{mode === "topics" && sourceLabel && (
							<span
								data-testid={`chain-source-badge-${chain.id}`}
								className="ml-2 inline-flex items-center rounded-sm border border-border/50 bg-muted/20 px-1.5 py-0.5 font-ui text-[10px] text-muted-foreground"
								title={`Source: ${sourceLabel}`}
							>
								{sourceLabel}
							</span>
						)}
					</span>
					<TreeCell widthClassName="w-14" align="right" className="text-xs tabular-nums text-muted-foreground">
						{memberIds.length}
					</TreeCell>
					<TreeCell widthClassName="w-20" align="right" className="text-xs tabular-nums text-muted-foreground">
						{dateOf(chain.conclusion)}
					</TreeCell>
				</div>

				{chainOpen &&
					memberIds.map((id) => {
						const node = byId.get(id);
						if (!node) return null;
						return (
							<div
								key={id}
								{...chainRow(["prop", groupKey, chain.id, id], depth + 2)}
								data-testid={`prop-row-${id}`}
								data-chain-statement
								{...treeRowLayout({ depth: 2, variant: "detail" })}
							>
								{selectMode ? (
									<RowCheckbox
										checked={selection.has(id)}
										onToggle={(next) => onToggleNodes([id], next)}
										testid={`prop-checkbox-${id}`}
										label={`Select node ${node.name}`}
									/>
								) : (
									<TreeSelectionSpacer />
								)}
								<ToolContentResponse mode="static" className="min-w-0 flex-1 text-muted-foreground [--font-prose:var(--font-ui)] [--lh-prose-size:var(--text-xs)] [--lh-prose-leading:1.625] [&_[data-streamdown=inline-code]]:[font-size:inherit] [&_[data-streamdown=inline-code]]:[color:inherit]">
									{node.statement}
								</ToolContentResponse>
								<TreeCell widthClassName="w-14" />
								<TreeCell widthClassName="w-20" />
							</div>
						);
					})}
			</div>
		);
	};

	return (
		<div ref={tableRef} tabIndex={-1} data-testid="chain-table" className="relative flex h-full min-h-0 flex-col outline-none [&_[data-chain-nav-active=true]]:bg-accent/50 [&_[data-chain-nav-row]]:outline-none [&_[data-chain-nav-row]]:scroll-mt-8 [&_[data-chain-nav-row]]:scroll-mb-16">
			{/* THE shared top bar (standardization ruling): drag mechanics,
			    sidebar reopen, traffic-light gutter — the same element as every
			    chat surface. NO TITLE (owner round 11, 2026-10-05): the serif
			    title register is RESERVED — it always names a session; the
			    chain table names nothing, so its bar carries counts + search +
			    close only. Search + close carve out with lh-no-drag (the mask
			    law: later in the DOM). */}
			<TopBar sidebarToggle={!pickerChrome}>
				<span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
					{refreshingTopics ? (
						<span className="inline-flex items-center gap-1.5 text-foreground">
							<RefreshCwIcon className="size-3 animate-spin" />
							<span>Organizing topics with AI…</span>
						</span>
					) : topicStatusMsg ? (
						<span className="inline-flex items-center gap-1.5 text-foreground">
							<span>{topicStatusMsg}</span>
						</span>
					) : (
						<>
							{chains.length} {chains.length === 1 ? "chain" : "chains"} · {nodes.length} {nodes.length === 1 ? "node" : "nodes"}
						</>
					)}
				</span>
				{onOrganizationChange && groupBy === "sources" && (
					<button
						type="button"
						aria-label="Add folder"
						data-testid="add-source-folder"
						onClick={() => setCreatingFolder(true)}
						className="lh-no-drag flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground cursor-pointer"
						title="Add folder"
					>
						<FolderPlusIcon className="size-4" />
					</button>
				)}
				{groupBy === "topics" && (
					<div className="flex items-center gap-0.5">
						<button
							type="button"
							aria-label="Add topic"
							data-testid="chains-add-topic"
							onClick={() => setCreatingTopic(true)}
							className="lh-no-drag flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground cursor-pointer"
							title="Add custom topic"
						>
							<PlusIcon className="size-4" />
						</button>
						<button
							type="button"
							aria-label="Auto-organize topics"
							data-testid="chains-auto-organize"
							disabled={refreshingTopics}
							onClick={() => void runAutoOrganize()}
							className="lh-no-drag flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground cursor-pointer disabled:opacity-40"
							title={refreshingTopics ? "Organizing topics…" : "Auto-organize topics"}
						>
							<RefreshCwIcon className={cn("size-4", refreshingTopics && "animate-spin text-foreground")} />
						</button>
						<button
							type="button"
							aria-label="Topic settings"
							data-testid="chains-topic-settings"
							onClick={() => openSettings("graph")}
							className="lh-no-drag flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground cursor-pointer"
							title="Topic organization settings"
						>
							<SettingsIcon className="size-4" />
						</button>
					</div>
				)}
				<div className="lh-no-drag flex items-center rounded-md border border-border/60 bg-muted/30 p-0.5 text-[11px] font-medium">
					<button
						type="button"
						data-testid="chains-group-by-sources"
						onClick={() => setGroupBy("sources")}
						className={cn(
							"flex items-center gap-1.5 rounded px-2 py-1 transition-colors cursor-pointer",
							groupBy === "sources"
								? "bg-background text-foreground shadow-xs font-semibold"
								: "text-muted-foreground hover:text-foreground"
						)}
						title="Group chains by file sources and folders"
					>
						<FolderTreeIcon className="size-3" />
						<span>Sources</span>
					</button>
					<button
						type="button"
						data-testid="chains-group-by-topics"
						onClick={() => setGroupBy("topics")}
						className={cn(
							"flex items-center gap-1.5 rounded px-2 py-1 transition-colors cursor-pointer",
							groupBy === "topics"
								? "bg-background text-foreground shadow-xs font-semibold"
								: "text-muted-foreground hover:text-foreground"
						)}
						title="Group chains by semantic topics"
					>
						<ListTreeIcon className="size-3" />
						<span>Topics</span>
					</button>
				</div>
				<div className="relative shrink-0">
					<SearchIcon className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
					<input
						ref={searchRef}
						value={query}
						data-testid="chain-table-search"
						onChange={(e) => onQuery(e.target.value)}
						placeholder="Search nodes…"
						aria-label="Search nodes"
						spellCheck={false}
						className="lh-no-drag h-8 w-56 rounded-lg border bg-background pl-8 pr-3 text-xs outline-none placeholder:text-muted-foreground focus:border-ring"
					/>
				</div>
			<button
					type="button"
					data-testid="chain-table-close"
					onClick={onClose}
					aria-label="Close chains"
					className="lh-no-drag flex size-8 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-card/80 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
				>
					<XIcon className="size-4" />
				</button>
			</TopBar>

			{/* The list: NO per-row lines (owner ruling) — the ONLY horizontal
			    separators sit between cluster groups; the ALIGNMENT STAIRCASE
			    carries the hierarchy (owner round 4, "double the indentation":
			    two-column steps — chains pl-12 aligned with the folder icon,
			    statements pl-21 where a chain icon would sit).
			    All three columns sort, small chevron on active. */}
			<div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
				{/* The TOP rule (owner round 5: the table is framed — a line under
			    the header, a line under the last group, lines between groups). */}
				<TreeHeader sticky>
					<button
						type="button"
						data-testid="sort-name"
						onClick={() => onSort("name")}
						aria-sort={sort.col === "name" ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
						{...treeColumnLayout({ grow: true, align: "left", className: "flex items-center gap-1 transition-colors hover:text-foreground" })}
					>
						Name {dirIcon("name")}
					</button>
					<button
						type="button"
						data-testid="sort-props"
						onClick={() => onSort("props")}
						aria-sort={sort.col === "props" ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
						{...treeColumnLayout({ widthClassName: "w-14", align: "right", className: "flex items-center justify-end gap-1 transition-colors hover:text-foreground" })}
					>
						Props {dirIcon("props")}
					</button>
					<button
						type="button"
						data-testid="sort-created"
						onClick={() => onSort("created")}
						aria-sort={sort.col === "created" ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
						{...treeColumnLayout({ widthClassName: "w-20", align: "right", className: "flex items-center justify-end gap-1 transition-colors hover:text-foreground" })}
					>
						Created {dirIcon("created")}
					</button>
				</TreeHeader>

				{creatingFolder && onOrganizationChange && <div className="flex items-center px-3 py-2" data-testid="new-folder-row">
					<EditableSourceName name="" initiallyEditing onCancel={() => setCreatingFolder(false)}
						onSave={async (name) => {
						const id = await onOrganizationChange({ action: "create-folder", name, parentId: null });
						onQuery(""); if (id) navigation.focusRow(["folder", id]); setCreatingFolder(false);
					}} />
				</div>}
				{creatingTopic && (
					<div
						data-testid="new-topic-row"
						{...treeRowLayout({ className: "border-b border-border/40 bg-muted/15" })}
					>
						<TreeSelectionSpacer />
						<div className="size-3.5 shrink-0" />
						<div className="flex h-5 w-3.5 shrink-0 items-center justify-center">
							<FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />
						</div>
						<EditableSourceName
							name=""
							placeholder="Topic name"
							initiallyEditing
							onCancel={() => setCreatingTopic(false)}
							onSave={async (label) => {
								await postTopicAction({ action: "create-topic", label, nodeIds: [] });
								setCreatingTopic(false);
							}}
						/>
						<TreeCell widthClassName="w-14" />
						<TreeCell widthClassName="w-20" />
					</div>
				)}
				{((groupBy === "sources" && groups.length === 0 && (directory?.organization.folders.length ?? 0) === 0) ||
					(groupBy === "topics" && topicGroups.length === 0 && searching)) && (
					<div data-testid="chain-table-nomatch" className="px-4 pt-3 text-xs text-muted-foreground">
						No matching chains.
					</div>
				)}
				{groupBy === "topics" && topicGroups.length === 0 && !searching && (
					<div data-testid="chain-table-topics-empty" className="flex flex-col items-center justify-center px-4 py-16 text-center">
						<ListTreeIcon className="size-8 text-muted-foreground/40 mb-3" />
						<p className="text-sm font-medium text-foreground mb-1">No topics yet</p>
						<p className="text-xs text-muted-foreground max-w-sm mb-4">
							Automatically group your reasoning chains into semantic topics, or create custom topics manually.
						</p>
						<div className="flex items-center gap-2">
							<button
								type="button"
								onClick={() => void runAutoOrganize()}
								disabled={refreshingTopics}
								className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border/70 bg-card/80 px-3 text-xs font-medium text-foreground shadow-xs transition-colors hover:bg-accent disabled:opacity-50 cursor-pointer"
							>
								<RefreshCwIcon className={cn("size-3.5 text-muted-foreground", refreshingTopics && "animate-spin text-foreground")} />
								<span>{refreshingTopics ? "Organizing…" : "Auto-organize topics"}</span>
							</button>
							<button
								type="button"
								onClick={() => setCreatingTopic(true)}
								className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border/60 bg-transparent px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground cursor-pointer"
							>
								<PlusIcon className="size-3.5" />
								<span>Add topic</span>
							</button>
						</div>
					</div>
				)}

				{groupBy === "sources" ? (
					<SourceFolderTree groups={groups} directory={directory} query={query} sort={sort} onAction={onOrganizationChange}
					sourceSelection={selectMode ? undefined : { sources: selectedSources, folders: selectedFolders }}
					expanded={expandedClusters} collapsedForSearch={foldedClusters} onToggleExpanded={toggleCluster} selection={selection} selectedFolders={selectedFolders}
					onToggleNodes={onToggleNodes} onToggleFolder={onToggleFolder} allowEmptySelection={!selectMode} allSourceNodes={allSourceNodes}
					renderSource={(group, depth) => {
					const open = searching ? !foldedClusters.has(group.key) : expandedClusters.has(group.key);
					const selectedCount = group.nodeIds.filter((id) => selection.has(id)).length;
					const empty = group.birth === null ? group.nodeIds.length === 0 : !allSourceNodes.get(group.birth)?.size;
					return (
						<div
							key={group.key}
							data-testid={`cluster-group-${group.key}`}
							// The horizontal rules (owner rulings, rounds 2 + 5): between
							// cluster groups AND under the last one — the table is framed
							// top (header) and bottom. Never on individual rows.
							{...treeBranchLayout({ depth, className: "border-b border-transparent", style: { marginLeft: depth * 36 } })}
						>
							{/* The TREE THREAD (owner rounds 5–6): a vertical guide at the
							    expander arrow's column (center 37px: pl-3 + checkbox 14 +
							    gap 4 + half the 14px expander), BRACKETED by checkbox
							    bottom edges — it starts at the cluster row's own checkbox
							    bottom (top-[23px], leaving the arrow's stroke a visible
							    gap, live-measured) and terminates exactly at the LAST
							    checkbox bottom (bottom-[8px] = 9px from the border box minus the 1px group rule, measured). */}
							{open && group.chains.length > 0 && (
								<TreeGuide selectionColumn depth={0} data-testid={`cluster-thread-${group.key}`} />
							)}
							{/* The cluster row: birth-session group header. */}
							<SourceDragRow {...chainRow(["source", group.key], depth, open)} kind="source" id={group.key} name={group.label ?? "unlabeled"} enabled={Boolean(onOrganizationChange && group.birth)} {...treeRowLayout()}>
								<RowCheckbox
									disabled={selectMode ? group.nodeIds.length === 0 : !directory?.sources.some((s) => s.id === group.birth)}
									checked={selectMode ? selectedCount === group.nodeIds.length && group.nodeIds.length > 0 : group.birth !== null && selectedSources.has(group.birth)}
									indeterminate={selectMode ? selectedCount > 0 && selectedCount < group.nodeIds.length : false}
									onToggle={(next) => { if (selectMode) onToggleNodes(group.nodeIds, next); else if (group.birth) onToggleSource(group.birth, next); }}
									testid={`cluster-checkbox-${group.key}`}
									label={selectMode ? `Select everything born in ${group.label ?? "unlabeled"}` : `Select source ${group.label ?? "unlabeled"}`}
								/>
								<Expander open={open} onClick={() => toggleCluster(group.key)} testid={`cluster-toggle-${group.key}`} label={`Expand cluster ${group.label ?? "unlabeled"}`} />
								<button type="button" data-source-icon data-testid={`source-icon-${group.key}`} aria-expanded={open} aria-label={`Expand source ${group.label ?? "unlabeled"}`}
									onClick={() => toggleCluster(group.key)} className={`flex h-5 w-3.5 shrink-0 items-center justify-center rounded ${empty ? "text-muted-foreground/60" : "text-muted-foreground"} transition-colors hover:bg-accent hover:text-foreground`}>
									{open ? <BookOpenIcon className="size-3.5 shrink-0" /> : <BookIcon className="size-3.5 shrink-0" />}
								</button>
								{onOrganizationChange && group.birth && group.kind !== null
									? <EditableSourceName name={group.label ?? ""} muted={empty} onSave={(name) => onOrganizationChange({ action: "rename-source", id: group.birth!, name })} />
									: <span className={`min-w-0 flex-1 truncate text-sm font-medium${empty ? " text-muted-foreground/60" : ""}`}>{group.label ?? <span className="text-muted-foreground/60">unlabeled</span>}</span>}
								{group.kind === "notes" && <span className="text-[11px] uppercase tracking-widest text-muted-foreground/60">notes</span>}
								<TreeCell widthClassName="w-14" align="right" className="text-xs tabular-nums text-muted-foreground">
									{group.nodeIds.length}
								</TreeCell>
								<TreeCell widthClassName="w-20" align="right" className="text-xs tabular-nums text-muted-foreground">
									{group.newestCreatedAt.slice(0, 10)}
								</TreeCell>
							</SourceDragRow>

							{/* The chain rows — clearly indented under the folder
							    (owner ruling); visible only when the cluster is open
							    (searching auto-expands). */}
							{open &&
								group.chains.map((chain) => renderChainItem(chain, group.key, depth, "sources"))}
							<TreeSeparator data-testid={`source-separator-${group.key}`} outside inset={depth === 0 ? 0 : 1} />
						</div>
					);
				}} />
				) : (
					topicGroups.map((group) => {
						const open = searching ? !foldedClusters.has(group.key) : expandedClusters.has(group.key);
						const selectedCount = group.nodeIds.filter((id) => selection.has(id)).length;
						return (
							<div
								key={group.key}
								data-testid={`cluster-group-${group.key}`}
								{...treeBranchLayout({ depth: 0, className: "border-b border-transparent" })}
							>
								{open && group.chains.length > 0 && (
									<TreeGuide selectionColumn depth={0} data-testid={`cluster-thread-${group.key}`} />
								)}
								<div {...chainRow(["source", group.key], 0, open)} {...treeRowLayout()}>
									<RowCheckbox
										disabled={group.nodeIds.length === 0}
										checked={selectedCount === group.nodeIds.length && group.nodeIds.length > 0}
										indeterminate={selectedCount > 0 && selectedCount < group.nodeIds.length}
										onToggle={(next) => onToggleNodes(group.nodeIds, next)}
										testid={`cluster-checkbox-${group.key}`}
										label={`Select topic ${group.label ?? "unlabeled"}`}
									/>
									<Expander open={open} onClick={() => toggleCluster(group.key)} testid={`cluster-toggle-${group.key}`} label={`Expand topic ${group.label ?? "unlabeled"}`} />
									<button type="button" data-source-icon data-testid={`source-icon-${group.key}`} aria-expanded={open} aria-label={`Expand topic ${group.label ?? "unlabeled"}`}
										onClick={() => toggleCluster(group.key)} className="flex h-5 w-3.5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
										<FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />
									</button>
									{group.rawTopicId ? (
										<div className="flex min-w-0 flex-1 items-center gap-1.5">
											<EditableSourceName
												name={group.label ?? ""}
												onSave={(label) => postTopicAction({ action: "rename-topic", id: group.rawTopicId!, label })}
											/>
											<button
												type="button"
												data-testid={`delete-topic-${group.rawTopicId}`}
												onClick={(e) => {
													e.stopPropagation();
													void postTopicAction({ action: "delete-topic", id: group.rawTopicId! });
												}}
												className="flex size-5 items-center justify-center rounded text-muted-foreground/60 hover:text-error hover:bg-error/10 cursor-pointer transition-colors"
												title="Delete topic"
											>
												<Trash2Icon className="size-3" />
											</button>
										</div>
									) : (
										<span className="min-w-0 flex-1 truncate text-sm font-medium">
											{group.label ?? <span className="text-muted-foreground/60">unlabeled</span>}
										</span>
									)}
									<TreeCell widthClassName="w-14" align="right" className="text-xs tabular-nums text-muted-foreground">
										{group.nodeIds.length}
									</TreeCell>
									<TreeCell widthClassName="w-20" align="right" className="text-xs tabular-nums text-muted-foreground">
										{group.newestCreatedAt ? group.newestCreatedAt.slice(0, 10) : ""}
									</TreeCell>
								</div>

								{open && group.chains.map((chain) => renderChainItem(chain, group.key, 0, "topics"))}
								<TreeSeparator data-testid={`source-separator-${group.key}`} outside inset={0} />
							</div>
						);
					})
				)}
			</div>

			{/* The floating selection bar (owner ruling: never shifts layout —
			    the Google-Photos pattern). Appears only when something is
			    selected; floats over the table's bottom edge. */}
			{(selectMode ? selection.size > 0 : selectedSources.size > 0 || fullySelectedFolders.size > 0) && (
				<div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center pb-4">
					<div
						data-testid="chain-selection-bar"
						className="pointer-events-auto flex items-center gap-3 rounded-full border bg-card py-2 pl-4 pr-2 shadow-lg"
					>
						<span data-testid="chain-selected-summary" className="text-xs font-medium">
							{selectMode ? <>{selection.size} {selection.size === 1 ? "node" : "nodes"} → {derived.length} {derived.length === 1 ? "chain" : "chains"}</>
								: <>{selectedSources.size} {selectedSources.size === 1 ? "source" : "sources"}{fullySelectedFolders.size > 0 && ` · ${fullySelectedFolders.size} ${fullySelectedFolders.size === 1 ? "folder" : "folders"}`}</>}
						</span>
						<button
							type="button"
							data-testid="chain-clear"
							onClick={onClear}
							className="rounded-full px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
						>
							Clear
						</button>
						{selectMode ? (
							<button
								type="button"
								data-testid="chain-practice-done"
								onClick={onSelect}
								aria-label={`Done picking — ${selection.size} ${selection.size === 1 ? "proposition" : "propositions"} selected`}
								className="flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/80"
							>
								Done
							</button>
						) : (
							<>
							{/* The danger fence (owner ruling): a divider quarantines
								    the destructive action at the bar's right end — the
								    safe actions and the kill switch never blend. The
								    full-death confirm dialog catches the misclick. */}
							<span data-testid="chain-danger-divider" aria-hidden="true" className="h-4 w-px bg-border/70" />
							<button
								type="button"
								data-testid="chain-delete"
								onClick={onDelete}
								aria-label="Delete selected sources and folders"
								className="flex items-center gap-1.5 rounded-full border border-destructive/50 bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/20"
							>
								<Trash2Icon aria-hidden="true" className="size-3.5" />
								Delete
							</button>
							</>
						)}
					</div>
				</div>
			)}
			{topicFeedback && (
				<div className="pointer-events-none absolute inset-x-0 bottom-2 z-20 flex justify-center">
					<div className="pointer-events-auto w-full max-w-xl">
						<OrganizationFeedbackToast feedback={topicFeedback} onDismiss={() => setTopicFeedback(null)} />
					</div>
				</div>
			)}
			{topicPreview && (
				<div className="absolute inset-0 z-30 flex items-center justify-center bg-background/70 p-3 backdrop-blur-sm sm:p-6">
					<section role="dialog" aria-modal="true" aria-labelledby="topic-preview-title" data-testid="topic-preview" className="flex h-full max-h-[54rem] w-full max-w-5xl flex-col overflow-hidden rounded-xl border bg-card shadow-2xl">
						<header className="shrink-0 border-b px-4 py-4 sm:px-6">
							<div className="flex items-start justify-between gap-4">
								<div className="min-w-0">
									<h2 id="topic-preview-title" className="text-base font-semibold">Review topic changes</h2>
									<p className="mt-1 text-xs text-muted-foreground">
										{changedTopicPropositions.length} {changedTopicPropositions.length === 1 ? "title changed" : "titles changed"}
									</p>
								</div>
								<button type="button" data-testid="topic-preview-cancel" onClick={() => setTopicPreview(null)} disabled={refreshingTopics} className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50" aria-label="Cancel topic preview">
									<XIcon className="size-4" />
								</button>
							</div>
							{topicPreviewError && <p role="alert" className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{topicPreviewError}</p>}
							<div className="mt-3 hidden grid-cols-[minmax(0,1fr)_minmax(10rem,0.8fr)] gap-3 px-1 text-xs text-muted-foreground sm:grid">
								<span>Proposition</span><span>Topic</span>
							</div>
						</header>
						<div className="min-h-0 flex-1 overflow-y-auto px-4 sm:px-6">
							{[...changedTopicPropositions].sort((a, b) => a.name.localeCompare(b.name)).map((node) => {
								const currentLabel = topicLabelForNode(topicPreview.base, node.id);
								const proposedLabel = topicLabelForNode(topicPreview.proposed, node.id);
								return (
								<div key={node.id} data-topic-preview-node={node.id} className="grid grid-cols-1 items-center gap-2 border-b border-border/60 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(10rem,0.8fr)] sm:gap-3">
										<div className="truncate text-sm font-medium" title={node.name}>{node.name}</div>
										<div className="flex min-w-0 items-center gap-2 text-xs">
											<span className="min-w-0 flex-1 truncate text-muted-foreground" title={currentLabel}>{currentLabel}</span>
											<ArrowRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
											<span className="min-w-0 flex-1 truncate font-medium text-foreground" title={proposedLabel}>{proposedLabel}</span>
										</div>
									</div>
								);
							})}
							{changedTopicPropositions.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No topic titles changed</p>}
						</div>
						<footer className="flex shrink-0 items-center justify-between gap-3 border-t px-4 py-3 sm:px-6">
							<p className="min-w-0 truncate text-xs text-muted-foreground">{changedTopicPropositions.length} {changedTopicPropositions.length === 1 ? "topic move" : "topic moves"}</p>
							<div className="flex shrink-0 items-center gap-2">
								<button type="button" onClick={() => setTopicPreview(null)} disabled={refreshingTopics} className="rounded-md px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50">Cancel</button>
								<button type="button" data-testid="topic-preview-apply" onClick={() => applyTopicPreview()} disabled={refreshingTopics || changedTopicPropositions.length === 0} className="rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50">{refreshingTopics ? "Applying…" : "Apply changes"}</button>
							</div>
						</footer>
					</section>
				</div>
			)}
		</div>
	);
}

/** The rotating chevron — collapsed points right, expanded rotates down
 *  (owner ruling: the affordance must read on every expandable row). */
function Expander({ open, onClick, testid, label }: { open: boolean; onClick: () => void; testid: string; label: string }) {
	return <TreeDisclosure open={open} onClick={onClick} data-testid={testid} aria-label={label} />;
}

/** The checkbox — checked/indeterminate (partial chains/clusters); DOM
 *  property set via ref (React does not expose `indeterminate`). */
function RowCheckbox({
	checked,
	disabled = false,
	indeterminate = false,
	onToggle,
	testid,
	label,
}: {
	checked: boolean;
	disabled?: boolean;
	indeterminate?: boolean;
	onToggle: (next: boolean) => void;
	testid: string;
	label: string;
}) {
	return (
		<TreeCheckbox disabled={disabled} checked={checked} indeterminate={indeterminate}
			data-testid={testid} aria-label={label} onChange={(e) => onToggle(e.target.checked)} />
	);
}

/** The graph view's overlay wrapper: owns query + sort + selection +
 *  expansion; mounts ABSOLUTE INSIDE the
 *  graph area, full-bleed (owner ruling: the translucent blurred surface
 *  IS the overlay — no inner card). Esc + the top-bar X dismiss (there
 *  is no backdrop margin to click anymore). Read-only toward the graph. */
export function ChainTableOverlay({
	open,
	nodes,
	chains: storedChains,
	sessions,
	fileSources,
	onClose,
	/** PRACTICE SELECT (owner vision, 2026-10-04): the selection is
	 *  PERSISTENT and caller-owned — when these props are present the
	 *  table is CONTROLLED (every check/clear/delete-prune reports up
	 *  immediately; the composer-side chip reflects it live). selectMode
	 *  only changes the floating bar: Done instead of the delete fence
	 *  (deleting while picking is a footgun). */
	selectMode,
	controlledSelection,
	onSelectionChange,
	keyboardActive = true,
	registerInteraction = true,
	pickerChrome = false,
	topicOrg,
	onTopicOrganizationStart,
}: {
	topicOrg?: TopicOrganization | null;
	onTopicOrganizationStart?: () => { operationId: string; finish: (error?: string) => void };
	open: boolean;
	/** Host knowledge picker has clearance, but no sidebar-reopen action. */
	pickerChrome?: boolean;
	/** A host knowledge picker registers once through its pane or modal shell. */
	registerInteraction?: boolean;
	/** Internal host ownership; ordinary practice keeps the existing default. */
	keyboardActive?: boolean;
	nodes: GraphNode[];
	chains: GraphChain[];
	sessions: Record<string, string>;
	fileSources: Record<string, string>;
	onClose: () => void;
	selectMode?: boolean;
	controlledSelection?: ReadonlySet<string>;
	onSelectionChange?: (next: ReadonlySet<string>) => void;
}) {
	const [query, setQuery] = useState("");
	const [sort, setSort] = useState<ChainSort>({ col: "name", dir: 1 });
	const [internalSelection, setInternalSelection] = useState<ReadonlySet<string>>(() => new Set());
	const [expandedClusters, setExpandedClusters] = useState<ReadonlySet<string>>(() => new Set());
	const [expandedChains, setExpandedChains] = useState<ReadonlySet<string>>(() => new Set());
	const [deletion, setDeletion] = useState<{ sources: SourceEntry[]; folders: SourceFolder[] } | null>(null);
	const deleteOpen = deletion !== null;

	const [directory, setDirectory] = useState<SourceDirectory>();
	const [directoryPending, setDirectoryPending] = useState(true);
	const visibleDirectory = useMemo(() => directory && chainSourceDirectory(directory), [directory]);
	const [directoryFailure, setDirectoryFailure] = useState("");
	const [entrySelection, setEntrySelection] = useState<SourceEntrySelection>(() => ({ sources: new Set(), folders: new Set() }));
	useEffect(() => {
		if (!visibleDirectory) return;
		setEntrySelection((previous) => {
			const sources = new Set([...previous.sources].filter((id) => visibleDirectory.sources.some((s) => s.id === id)));
			const folders = new Set([...previous.folders].filter((id) => visibleDirectory.organization.folders.some((f) => f.id === id)));
			return sources.size === previous.sources.size && folders.size === previous.folders.size ? previous : { sources, folders };
		});
	}, [visibleDirectory]);
	const requestVersion = useRef(0);
	const directoryOpening = useRef(0);
	const directoryRequest = useRef<AbortController | null>(null);
	const mutationTail = useRef<Promise<unknown>>(Promise.resolve());
	const readDirectory = useCallback(async () => {
		const version = ++requestVersion.current;
		directoryRequest.current?.abort();
		const request = new AbortController();
		directoryRequest.current = request;
		try {
			const response = await fetch("/api/graph/sources", { cache: "no-store", signal: request.signal });
			if (!response.ok) throw new Error("Could not read source organization.");
			const body = await response.json() as SourceDirectory;
			if (!request.signal.aborted && version === requestVersion.current) { setDirectory(body); setDirectoryPending(false); setDirectoryFailure(""); }
		} catch (error) { if (!request.signal.aborted && version === requestVersion.current) setDirectoryFailure(error instanceof Error ? error.message : String(error)); }
	}, []);
	useEffect(() => {
		if (open) void readDirectory();
		return () => {
			requestVersion.current++;
			directoryOpening.current++;
			directoryRequest.current?.abort();
			directoryRequest.current = null;
			// Keep cached organization, but require fresh source kinds on EACH opening.
			setDirectoryPending(true);
		};
	}, [open, readDirectory]);
	useServerEvent("sources-changed", () => { if (open) void readDirectory(); });
	useServerEvent("chats-changed", () => { if (open) void readDirectory(); });
	useServerResync(() => { if (open) void readDirectory(); });
	const changeOrganization: OrganizationChange = (action) => {
		const opening = directoryOpening.current;
		// Serialize this page's edits, and invalidate older notify-then-fetch reads.
		const operation = mutationTail.current.catch(() => {}).then(async () => {
			try {
				const response = await fetch("/api/graph/sources", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action) });
				const body = await response.json();
				if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "Could not save source organization.");
				if (opening === directoryOpening.current) {
					requestVersion.current++;
					setDirectory(body as SourceDirectory); setDirectoryPending(false); setDirectoryFailure("");
				}
				if (action.action === "rename-source") {
					const entry = (body as SourceDirectory).sources.find((s) => s.id === action.id);
					window.dispatchEvent(new CustomEvent(entry?.kind === "chat" ? "lh:chat-renamed" : "lh:source-renamed", { detail: { id: action.id, title: action.name } }));
				}
				return typeof body.createdFolderId === "string" ? body.createdFolderId : undefined;
			} catch (error) { setDirectoryFailure(error instanceof Error ? error.message : String(error)); throw error; }
		});
		mutationTail.current = operation;
		return operation;
	};
	const selectedSources = new Set([...entrySelection.sources].filter((id) => visibleDirectory?.sources.some((s) => s.id === id)));
	const selectedFolders = new Set([...entrySelection.folders].filter((id) => directory?.organization.folders.some((f) => f.id === id)));
	const fullySelectedFolders = new Set([...selectedFolders].filter((id) => visibleDirectory && folderEntryCheck(visibleDirectory, id, { sources: selectedSources, folders: selectedFolders }).checked));
	const toggleEntries = (kind: "source" | "folder", id: string, checked: boolean) => {
		if (visibleDirectory) setEntrySelection((previous) => toggleSourceEntries(visibleDirectory, previous, kind, id, checked));
	};

	// Controlled when the caller lifts the selection (the practice pick
	// set); internal (uncontrolled) otherwise — the delete flow's own.
	const selection = controlledSelection ?? internalSelection;
	const applySelection = (next: ReadonlySet<string>) => {
		if (onSelectionChange) onSelectionChange(next);
		else setInternalSelection(next);
	};

	const rootRef = useRef<HTMLDivElement>(null);
	const inheritedOwner = useContext(InteractionLayerOwner);
	const layer = useInteractionLayer({
		kind: "view", enabled: open && keyboardActive && registerInteraction, rootRef,
		onClose: () => { onClose(); return "closed"; },
	});

	if (!open) return null;

	const toggleNodes = (ids: string[], next: boolean) => {
		const s = new Set(selection);
		for (const id of ids) {
			if (next) s.add(id);
			else s.delete(id);
		}
		applySelection(s);
	};
	const toggleIn = (set: ReadonlySet<string>, id: string) => {
		const s = new Set(set);
		if (s.has(id)) s.delete(id);
		else s.add(id);
		return s;
	};

	return (
		<InteractionLayerOwner.Provider value={registerInteraction && keyboardActive ? layer.id : inheritedOwner}>
			<div
				ref={rootRef}
				data-testid="chain-table-overlay"
				className="absolute inset-0 z-40 flex flex-col bg-background/80 backdrop-blur-sm"
				style={registerInteraction ? { zIndex: 100 + layer.order } : undefined}
			>
				{directoryFailure && <p role="alert" className="px-3 py-1 text-xs text-error">{directoryFailure}</p>}
				<ChainTableBody
					topicOrg={topicOrg}
					onTopicOrganizationStart={onTopicOrganizationStart}
					pickerChrome={pickerChrome}
					keyboardActive={keyboardActive && !deleteOpen}
					directory={directory}
					onOrganizationChange={directory ? changeOrganization : undefined}
					selectedFolders={selectedFolders}
					selectedSources={selectedSources}
					onToggleSource={(id, next) => toggleEntries("source", id, next)}
					onToggleFolder={(id, next) => toggleEntries("folder", id, next)}
					sourceInventoryPending={directoryPending}
					nodes={nodes}
					chains={storedChains}
					sessions={sessions}
					fileSources={fileSources}
					query={query}
					onQuery={setQuery}
					sort={sort}
					onSort={(col) =>
						setSort((prev) =>
							prev.col === col
								? { col, dir: prev.dir === 1 ? -1 : 1 }
								: { col, dir: col === "name" ? 1 : -1 },
						)
					}
					selection={selection}
					expandedClusters={expandedClusters}
					expandedChains={expandedChains}
					onToggleCluster={(key) => setExpandedClusters((prev) => toggleIn(prev, key))}
					onToggleChain={(id) => setExpandedChains((prev) => toggleIn(prev, id))}
					onToggleNodes={toggleNodes}
					onClear={() => { if (selectMode) applySelection(new Set()); else setEntrySelection({ sources: new Set(), folders: new Set() }); }}
					onDelete={() => setDeletion({
						sources: directory?.sources.filter((s) => selectedSources.has(s.id)) ?? [],
						folders: directory?.organization.folders.filter((f) => fullySelectedFolders.has(f.id)) ?? [],
					})}
					onClose={onClose}
					selectMode={selectMode}
					onSelect={onClose}
				/>
			</div>
			{!selectMode && <DeleteSourceDialog open={deleteOpen}
				sources={deletion?.sources ?? []}
				folders={deletion?.folders ?? []}
				onClose={() => setDeletion(null)}
				onDelete={(deleteSessions) => {
					const opening = directoryOpening.current;
					const operation = mutationTail.current.catch(() => {}).then(async () => {
						let graphRevision: number | undefined;
						try {
							const response = await fetch("/api/graph/sources", { method: "DELETE", headers: { "Content-Type": "application/json" },
								body: JSON.stringify({ sourceIds: deletion?.sources.map((s) => s.id) ?? [], folderIds: deletion?.folders.map((f) => f.id) ?? [], deleteSessions }) });
							const body = await response.json();
							if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "Could not delete sources.");
							graphRevision = body.graphRevision;
							if (opening === directoryOpening.current) {
								requestVersion.current++; setDirectory(body as SourceDirectory); setDirectoryPending(false); setDirectoryFailure("");
							}
							setEntrySelection({ sources: new Set(), folders: new Set() });
						} finally {
							// A failed response can still follow partial disk writes.
							// Refresh graph content as well as the directory, in both home modes.
							void readDirectory();
							window.dispatchEvent(new CustomEvent("lh:graph-revision", { detail: { graphRevision } }));
						}
					});
					mutationTail.current = operation; return operation;
				}}
			/>}
		</InteractionLayerOwner.Provider>
	);
}
