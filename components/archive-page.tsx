"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { TopBar } from "@/components/top-bar";
import { MenuShell } from "@/components/menu-shell";
import { DeleteSessionDialog } from "@/components/delete-session-dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { fuzzyScore } from "@/src/core";
import { timeAgo } from "@/components/sidebar";
import { useServerEvent, useServerResync } from "@/components/server-events";
import type {
	ChatFolder,
	ChatDirectoryItem,
	ChatOrganization,
	ChatOrganizationAction,
} from "@/src/core";
import {
	MoveDestinationDialog,
	DeleteFolderDialog,
	OrganizationFeedbackToast,
	computeUndoAction,
	type MoveTargetItem,
	type OrganizationFeedback,
} from "@/components/chat-organization-interactions";
import {
	getChatFolderChain,
	getFolderChatCount,
	getFolderPathString,
} from "@/components/chat-folder-tree";
import {
	ArchiveIcon,
	ChevronRightIcon,
	FolderIcon,
	FolderOpenIcon,
	MoreVerticalIcon,
	RotateCcwIcon,
	SearchIcon,
	XIcon,
	DumbbellIcon,
	GraduationCapIcon,
} from "lucide-react";

function useSafeRouter() {
	try {
		return useRouter();
	} catch {
		return {
			push: (url: string) => {
				if (typeof window !== "undefined") window.location.href = url;
			},
			back: () => {
				if (typeof window !== "undefined") window.history.back();
			},
			forward: () => {
				if (typeof window !== "undefined") window.history.forward();
			},
			refresh: () => {},
			replace: (url: string) => {
				if (typeof window !== "undefined") window.location.replace(url);
			},
			prefetch: () => {},
		};
	}
}

function useSafeSearchParams() {
	try {
		const sp = useSearchParams();
		if (sp) return sp;
	} catch {
		// fallback
	}
	if (typeof window !== "undefined" && window.location?.search !== undefined) {
		return new URLSearchParams(window.location.search);
	}
	return null;
}

export function ArchivePage({
	initialLoading = false,
	initialFolders,
	initialChats,
	initialActiveFolders,
	initialSearchQuery,
	initialKindFilter,
}: {
	initialLoading?: boolean;
	initialFolders?: ChatFolder[];
	initialChats?: ChatDirectoryItem[];
	initialActiveFolders?: ChatFolder[];
	initialSearchQuery?: string;
	initialKindFilter?: "all" | "teach" | "practice";
} = {}) {
	const router = useSafeRouter();
	const searchParams = useSafeSearchParams();

	const [archivedFolders, setArchivedFolders] = useState<ChatFolder[]>(initialFolders ?? []);
	const [archivedChats, setArchivedChats] = useState<ChatDirectoryItem[]>(initialChats ?? []);
	const [activeFolders, setActiveFolders] = useState<ChatFolder[]>(initialActiveFolders ?? []);
	const [organization, setOrganization] = useState<ChatOrganization | null>(null);
	const [loading, setLoading] = useState(initialLoading);

	const initialQ = useMemo(() => {
		if (initialSearchQuery !== undefined) return initialSearchQuery;
		if (searchParams) return searchParams.get("q") ?? "";
		if (typeof window !== "undefined") {
			return new URLSearchParams(window.location.search).get("q") ?? "";
		}
		return "";
	}, [initialSearchQuery, searchParams]);

	const initialKind = useMemo(() => {
		if (initialKindFilter) return initialKindFilter;
		const k =
			searchParams?.get("kind") ??
			(typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("kind") : null);
		if (k === "teach" || k === "practice") return k;
		return "all" as const;
	}, [initialKindFilter, searchParams]);

	const [searchQuery, setSearchQuery] = useState(initialQ);
	const [kindFilter, setKindFilter] = useState<"all" | "teach" | "practice">(initialKind);

	// Dialog & menu state
	const [movingTarget, setMovingTarget] = useState<MoveTargetItem | null>(null);
	const [deletingChat, setDeletingChat] = useState<Pick<ChatDirectoryItem, "id" | "title"> | null>(null);
	const [deletingFolder, setDeletingFolder] = useState<ChatFolder | null>(null);
	const [feedback, setFeedback] = useState<OrganizationFeedback | null>(null);

	const [ctxChatId, setCtxChatId] = useState<string | null>(null);
	const ctxChatAnchorRef = useRef<HTMLElement | null>(null);
	const [ctxFolderId, setCtxFolderId] = useState<string | null>(null);
	const ctxFolderAnchorRef = useRef<HTMLElement | null>(null);

	const searchInputRef = useRef<HTMLInputElement>(null);

	const refreshInFlightRef = useRef(false);
	const refresh = useCallback(async () => {
		if (refreshInFlightRef.current) return;
		refreshInFlightRef.current = true;
		try {
			const [archRes, orgRes] = await Promise.all([
				fetch("/api/chats/organization?archived=true", { cache: "no-store" }),
				fetch("/api/chats/organization", { cache: "no-store" }),
			]);

			if (archRes.ok) {
				const data = (await archRes.json()) as {
					folders: ChatFolder[];
					chats: ChatDirectoryItem[];
					activeFolders?: ChatFolder[];
				};
				setArchivedFolders(data.folders);
				setArchivedChats(data.chats);
				if (data.activeFolders) {
					setActiveFolders(data.activeFolders);
				}
			}

			if (orgRes.ok) {
				const orgData = (await orgRes.json()) as { organization: ChatOrganization };
				setOrganization(orgData.organization);
				if (!activeFolders.length && orgData.organization.folders) {
					setActiveFolders(orgData.organization.folders.filter((f) => !f.archivedAt));
				}
			}
		} catch (err) {
			console.error("Failed to load archive data:", err);
		} finally {
			setLoading(false);
			refreshInFlightRef.current = false;
		}
	}, [activeFolders.length]);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	const [, setLocationKey] = useState(0);
	useEffect(() => {
		const onPopState = () => setLocationKey((k) => k + 1);
		window.addEventListener("popstate", onPopState);
		return () => window.removeEventListener("popstate", onPopState);
	}, []);

	// Selection represented by /archive default, ?view=unorganized, ?folder=<id>
	const currentFolderId = useMemo(() => {
		if (searchParams) return searchParams.get("folder");
		if (typeof window !== "undefined") {
			return new URLSearchParams(window.location.search).get("folder");
		}
		return null;
	}, [searchParams]);

	const currentView = useMemo(() => {
		if (searchParams) return searchParams.get("view");
		if (typeof window !== "undefined") {
			return new URLSearchParams(window.location.search).get("view");
		}
		return null;
	}, [searchParams]);

	const destination: "folder" | "unorganized" | "all" = currentFolderId
		? "folder"
		: currentView === "unorganized"
		? "unorganized"
		: "all";

	const selectedFolder = useMemo(() => {
		if (!currentFolderId) return null;
		return archivedFolders.find((f) => f.id === currentFolderId) ?? null;
	}, [currentFolderId, archivedFolders]);

	const ancestorFolders = useMemo(() => {
		if (!selectedFolder) return [];
		const ancestors: ChatFolder[] = [];
		let current = selectedFolder;
		const visited = new Set<string>([current.id]);
		while (current.parentId) {
			const parent = archivedFolders.find((f) => f.id === current.parentId);
			if (!parent || visited.has(parent.id)) break;
			visited.add(parent.id);
			ancestors.unshift(parent);
			current = parent;
		}
		return ancestors;
	}, [selectedFolder, archivedFolders]);

	const selectedFolderDescendantIds = useMemo(() => {
		if (!selectedFolder) return new Set<string>();
		const ids = new Set<string>([selectedFolder.id]);
		let added = true;
		while (added) {
			added = false;
			for (const f of archivedFolders) {
				if (f.parentId && ids.has(f.parentId) && !ids.has(f.id)) {
					ids.add(f.id);
					added = true;
				}
			}
		}
		return ids;
	}, [selectedFolder, archivedFolders]);

	useEffect(() => {
		const onSelectFolder = (e: Event) => {
			const { folderId } = (e as CustomEvent<{ folderId: string | null }>).detail ?? {};
			if (!folderId || folderId === "all") {
				router.push("/archive");
			} else if (folderId === "unorganized") {
				router.push("/archive?view=unorganized");
			} else {
				router.push(`/archive?folder=${folderId}`);
			}
		};
		window.addEventListener("lh:archive-select-folder", onSelectFolder);
		return () => window.removeEventListener("lh:archive-select-folder", onSelectFolder);
	}, [router]);

	useServerEvent("chat-organization-changed", () => void refresh());
	useServerEvent("chats-changed", () => void refresh());
	useServerResync(() => void refresh());

	const closeContextMenus = useCallback(() => {
		setCtxChatId(null);
		setCtxFolderId(null);
	}, []);

	const openChatContext = (e: React.MouseEvent<HTMLElement>, chat: ChatDirectoryItem) => {
		e.preventDefault();
		e.stopPropagation();
		closeContextMenus();
		ctxChatAnchorRef.current = e.currentTarget;
		setCtxChatId(chat.id);
	};

	const openFolderContext = (e: React.MouseEvent<HTMLElement>, folder: ChatFolder) => {
		e.preventDefault();
		e.stopPropagation();
		closeContextMenus();
		ctxFolderAnchorRef.current = e.currentTarget;
		setCtxFolderId(folder.id);
	};

	useEffect(() => {
		if (!ctxChatId && !ctxFolderId) return;
		const onPointerDown = (e: PointerEvent) => {
			const target = e.target as Node;
			if (target instanceof Element && target.closest("[data-lh-menu]")) return;
			if (ctxChatAnchorRef.current?.contains(target)) return;
			if (ctxFolderAnchorRef.current?.contains(target)) return;
			closeContextMenus();
		};
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.stopPropagation();
				closeContextMenus();
			}
		};
		document.addEventListener("pointerdown", onPointerDown);
		document.addEventListener("keydown", onKeyDown);
		return () => {
			document.removeEventListener("pointerdown", onPointerDown);
			document.removeEventListener("keydown", onKeyDown);
		};
	}, [ctxChatId, ctxFolderId, closeContextMenus]);

	const executeAction = useCallback(
		async (
			action: ChatOrganizationAction,
			priorState?: { organization: ChatOrganization; chats: ChatDirectoryItem[] },
		): Promise<boolean> => {
			let undoPayload: { undoAction: ChatOrganizationAction; description: string } | null = null;
			if (priorState) {
				undoPayload = computeUndoAction(action, priorState);
			}
			try {
				const res = await fetch("/api/chats/organization", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(action),
				});
				if (!res.ok) {
					const data = (await res.json().catch(() => ({}))) as { error?: string };
					const errMsg = data.error || `Action failed (${res.status})`;
					setFeedback({ type: "error", message: errMsg });
					return false;
				}
				void refresh();
				if (undoPayload) {
					setFeedback({
						type: "success",
						message: undoPayload.description,
						onUndo: () => {
							void executeAction(undoPayload!.undoAction);
						},
					});
				}
				return true;
			} catch (err) {
				console.error("Archive action failed:", err);
				setFeedback({ type: "error", message: "Network error. Try again." });
				return false;
			}
		},
		[refresh],
	);

	const handleRestoreChat = useCallback(
		(chatId: string) => {
			const prior = organization ? { organization, chats: archivedChats } : undefined;
			void executeAction({ action: "restore", kind: "chat", id: chatId }, prior);
		},
		[organization, archivedChats, executeAction],
	);

	const handleRestoreFolder = useCallback(
		(folderId: string) => {
			const prior = organization ? { organization, chats: archivedChats } : undefined;
			void executeAction({ action: "restore", kind: "folder", id: folderId }, prior);
		},
		[organization, archivedChats, executeAction],
	);

	const handleDestinationMove = useCallback(
		(destinationParentId: string | null) => {
			if (!movingTarget) return;
			const { kind, id } = movingTarget;
			setMovingTarget(null);
			const prior = organization ? { organization, chats: archivedChats } : undefined;
			void executeAction(
				{
					action: "restore",
					kind,
					id,
					targetParentId: destinationParentId,
				},
				prior,
			);
		},
		[movingTarget, organization, archivedChats, executeAction],
	);

	// Scope chats according to current destination
	const scopedChats = useMemo(() => {
		if (destination === "unorganized") {
			return archivedChats.filter((c) => !c.folderId);
		}
		if (destination === "folder") {
			if (!selectedFolder) return [];
			return archivedChats.filter((c) => c.folderId && selectedFolderDescendantIds.has(c.folderId));
		}
		// "all"
		return archivedChats;
	}, [destination, selectedFolder, selectedFolderDescendantIds, archivedChats]);

	// Filtering: kind and search query on scoped chats
	const filteredChats = useMemo(() => {
		let list = scopedChats;

		// Kind filter
		if (kindFilter !== "all") {
			list = list.filter((c) => (c.kind ?? "teach") === kindFilter);
		}

		// Search filter
		const q = searchQuery.trim();
		if (!q) return list;

		return list
			.map((c) => ({ c, score: fuzzyScore(q, c.title) }))
			.filter((r): r is { c: ChatDirectoryItem; score: number } => r.score !== null)
			.sort((a, b) => b.score - a.score)
			.map((r) => r.c);
	}, [scopedChats, kindFilter, searchQuery]);

	// Filtered folders that contain matching chats (and their ancestor folders)
	const foldersWithMatchingSessions = useMemo(() => {
		const set = new Set<string>();

		for (const c of filteredChats) {
			if (c.folderId) {
				set.add(c.folderId);
				const chain = getChatFolderChain(c.folderId, archivedFolders);
				for (const ancId of chain) set.add(ancId);
			}
		}

		return set;
	}, [archivedFolders, filteredChats]);

	const isSearchActive = searchQuery.trim() !== "";

	const isFolderMatching = useCallback(
		(folder: ChatFolder): boolean => {
			const q = searchQuery.trim();
			const hasMatchingName = isSearchActive && fuzzyScore(q, folder.name) !== null;
			const hasMatchingSessions = foldersWithMatchingSessions.has(folder.id);

			if (kindFilter !== "all") {
				// Teaching/Practice filters apply to session results in current scope and
				// should exclude folders that have no matching sessions when filters are active,
				// while matching folder names may still return relevant folder rows.
				return hasMatchingName || hasMatchingSessions;
			}

			if (isSearchActive) {
				// Global search to search both archived sessions and relevant folder names
				return hasMatchingName || hasMatchingSessions;
			}

			return true;
		},
		[searchQuery, isSearchActive, foldersWithMatchingSessions, kindFilter],
	);

	const allKnownFolders = useMemo(() => {
		const map = new Map<string, ChatFolder>();
		for (const f of activeFolders) map.set(f.id, f);
		for (const f of archivedFolders) map.set(f.id, f);
		return Array.from(map.values());
	}, [activeFolders, archivedFolders]);

	// All Archived destination: compact flat entity rows for all matching archived folders
	const visibleArchivedFolders = useMemo(() => {
		return archivedFolders.filter((f) => isFolderMatching(f));
	}, [archivedFolders, isFolderMatching]);

	const sortedArchivedFolders = useMemo(() => {
		const q = searchQuery.trim();
		if (!q || !isSearchActive) return visibleArchivedFolders;
		return [...visibleArchivedFolders].sort((a, b) => {
			const scoreA = fuzzyScore(q, a.name) ?? -1;
			const scoreB = fuzzyScore(q, b.name) ?? -1;
			if (scoreB !== scoreA) return scoreB - scoreA;
			return a.name.localeCompare(b.name);
		});
	}, [visibleArchivedFolders, searchQuery, isSearchActive]);

	// For Folder view: child/descendant folders within selected folder, keeping selected folder itself out
	const visibleChildFolders = useMemo(() => {
		if (!selectedFolder) return [];
		if (isSearchActive) {
			// Folder-scoped search searches archived chats and archived descendant folder names
			// within selected folder, and keeps the selected folder itself out of results
			return archivedFolders.filter(
				(f) => f.id !== selectedFolder.id && selectedFolderDescendantIds.has(f.id) && isFolderMatching(f),
			);
		}
		return archivedFolders.filter(
			(f) => f.parentId === selectedFolder.id && isFolderMatching(f),
		);
	}, [selectedFolder, isSearchActive, archivedFolders, selectedFolderDescendantIds, isFolderMatching]);

	const sortedChildFolders = useMemo(() => {
		const q = searchQuery.trim();
		if (!q || !isSearchActive) return visibleChildFolders;
		return [...visibleChildFolders].sort((a, b) => {
			const scoreA = fuzzyScore(q, a.name) ?? -1;
			const scoreB = fuzzyScore(q, b.name) ?? -1;
			if (scoreB !== scoreA) return scoreB - scoreA;
			return a.name.localeCompare(b.name);
		});
	}, [visibleChildFolders, searchQuery, isSearchActive]);

	const visibleFolderChats = useMemo(() => {
		if (!selectedFolder) return [];
		if (isSearchActive) {
			return filteredChats;
		}
		return filteredChats.filter((c) => c.folderId === selectedFolder.id);
	}, [selectedFolder, isSearchActive, filteredChats]);

	const visibleFoldersCount = useMemo(() => {
		if (destination === "all") return sortedArchivedFolders.length;
		if (destination === "folder") return sortedChildFolders.length;
		return 0;
	}, [destination, sortedArchivedFolders.length, sortedChildFolders.length]);

	const visibleChatsCount = useMemo(() => {
		if (destination === "all") return filteredChats.length;
		if (destination === "folder") return visibleFolderChats.length;
		if (destination === "unorganized") return filteredChats.length;
		return 0;
	}, [destination, filteredChats.length, visibleFolderChats.length]);

	const totalArchivedCount = archivedChats.length + archivedFolders.length;
	const isArchiveEmpty = !loading && totalArchivedCount === 0;

	// Empty result logic accounts for matching folders as well as chats
	const isSearchEmpty =
		!loading &&
		!isArchiveEmpty &&
		isSearchActive &&
		visibleChatsCount === 0 &&
		visibleFoldersCount === 0;

	const isFilterEmpty =
		!loading &&
		!isArchiveEmpty &&
		!isSearchActive &&
		kindFilter !== "all" &&
		visibleChatsCount === 0 &&
		visibleFoldersCount === 0;

	const renderFolderRow = (folder: ChatFolder): ReactNode => {
		const count = getFolderChatCount(folder.id, archivedFolders, archivedChats);
		const originPath = folder.parentId ? getFolderPathString(folder.parentId, allKnownFolders) : null;

		return (
			<div
				key={folder.id}
				data-testid={`archive-folder-${folder.id}`}
				className="group flex w-full items-center gap-3 rounded-lg border border-border/50 bg-card/60 px-3 py-2.5 transition-colors hover:bg-accent/40 cursor-pointer"
				onClick={() => router.push(`/archive?folder=${folder.id}`)}
				onContextMenu={(e) => openFolderContext(e, folder)}
			>
				<span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted/40 text-muted-foreground group-hover:text-foreground">
					<FolderIcon className="size-4" />
				</span>

				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2">
						<Link
							href={`/archive?folder=${folder.id}`}
							onClick={(e) => e.stopPropagation()}
							className="truncate text-xs font-semibold text-foreground hover:underline"
						>
							{folder.name}
						</Link>
						<span className="text-[11px] tabular-nums text-muted-foreground/75 px-1.5 py-0.5 rounded bg-muted/40">
							{count} {count === 1 ? "session" : "sessions"}
						</span>
					</div>
					{(Boolean(folder.archivedAt) || originPath) && (
						<div className="flex items-center gap-2 text-[10px] text-muted-foreground/70">
							{Boolean(folder.archivedAt) && <span>Archived {timeAgo(folder.archivedAt!)}</span>}
							{Boolean(folder.archivedAt) && originPath && <span>·</span>}
							{originPath && <span className="truncate font-mono">In: {originPath}</span>}
						</div>
					)}
				</div>

				<div className="flex items-center gap-1 shrink-0">
					<button
						type="button"
						data-testid={`archive-folder-options-${folder.id}`}
						aria-label={`Options for archived folder ${folder.name}`}
						onClick={(e) => {
							e.stopPropagation();
							openFolderContext(e, folder);
						}}
						className="flex size-7 shrink-0 items-center justify-center rounded-md border border-transparent text-muted-foreground hover:border-border/60 hover:bg-accent hover:text-foreground cursor-pointer"
					>
						<MoreVerticalIcon className="size-4" />
					</button>

					<Link
						href={`/archive?folder=${folder.id}`}
						aria-label={`Open folder ${folder.name}`}
						onClick={(e) => e.stopPropagation()}
						className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer"
					>
						<ChevronRightIcon className="size-4 text-muted-foreground/60 group-hover:text-foreground" />
					</Link>
				</div>
			</div>
		);
	};

	const renderChatRow = (chat: ChatDirectoryItem, depth = 0): ReactNode => {
		const isPractice = chat.kind === "practice";
		const folderPath = getFolderPathString(chat.folderId, allKnownFolders);

		let chatHref = `/chat/${chat.id}?from=archive`;
		if (currentFolderId) {
			chatHref += `&folder=${encodeURIComponent(currentFolderId)}`;
		} else if (currentView === "unorganized") {
			chatHref += `&view=unorganized`;
		}

		return (
			<div
				key={chat.id}
				data-testid={`archive-chat-${chat.id}`}
				className="group flex w-full items-center gap-2 rounded-md border border-border/40 bg-card px-3 py-2 text-left transition-colors hover:bg-accent/50 cursor-pointer"
				style={{ paddingLeft: `${12 + depth * 16}px` }}
				onClick={() => router.push(chatHref)}
				onContextMenu={(e) => openChatContext(e, chat)}
			>
				<span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground/80">
					{isPractice ? <DumbbellIcon className="size-3.5" /> : <GraduationCapIcon className="size-3.5" />}
				</span>

				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2">
						<span className="truncate text-xs font-medium text-foreground">
							{chat.title}
						</span>
						{isPractice && (
							<span className="rounded bg-muted px-1.5 py-0.2 text-[9px] font-mono uppercase tracking-wider text-muted-foreground">
								Practice
							</span>
						)}
					</div>
					<div className="flex items-center gap-2 text-[10px] text-muted-foreground/70">
						<span>Updated {timeAgo(chat.updatedAt)}</span>
						{folderPath && (
							<>
								<span>·</span>
								<span className="truncate font-mono">In: {folderPath}</span>
							</>
						)}
					</div>
				</div>

				<button
					type="button"
					data-testid={`archive-chat-options-${chat.id}`}
					aria-label={`Options for archived session ${chat.title}`}
					onClick={(e) => {
						e.stopPropagation();
						openChatContext(e, chat);
					}}
					className="flex size-7 shrink-0 items-center justify-center rounded-md border border-transparent text-muted-foreground hover:border-border/60 hover:bg-accent hover:text-foreground cursor-pointer"
				>
					<MoreVerticalIcon className="size-4" />
				</button>
			</div>
		);
	};

	return (
		<main data-testid="archive-page" className="flex h-dvh flex-col bg-background">
			{/* Top Bar with real hierarchy breadcrumbs */}
			<TopBar>
				{destination === "all" ? (
					<div className="flex items-center gap-2 min-w-0">
						<h1 className="font-title text-3xl tracking-tight text-foreground">Archive</h1>
						{!loading && (
							<span className="text-xs font-mono text-muted-foreground/80 tabular-nums">
								({archivedChats.length} {archivedChats.length === 1 ? "session" : "sessions"})
							</span>
						)}
					</div>
				) : destination === "unorganized" ? (
					<nav aria-label="Breadcrumb" data-testid="archive-breadcrumbs" className="flex items-center gap-2 text-sm min-w-0">
						<Link
							href="/archive"
							className="font-title text-2xl tracking-tight text-muted-foreground hover:text-foreground transition-colors shrink-0"
						>
							Archive
						</Link>
						<ChevronRightIcon className="size-4 text-muted-foreground/60 shrink-0" />
						<span className="font-title text-2xl tracking-tight text-foreground truncate">
							Unorganized
						</span>
						{!loading && (
							<span className="text-xs font-mono text-muted-foreground/80 tabular-nums ml-1 shrink-0">
								({scopedChats.length} {scopedChats.length === 1 ? "session" : "sessions"})
							</span>
						)}
					</nav>
				) : selectedFolder ? (
					<nav aria-label="Breadcrumb" data-testid="archive-breadcrumbs" className="flex items-center gap-2 text-sm min-w-0">
						<Link
							href="/archive"
							className="font-title text-2xl tracking-tight text-muted-foreground hover:text-foreground transition-colors shrink-0"
						>
							Archive
						</Link>
						{ancestorFolders.map((anc) => (
							<span key={anc.id} className="flex items-center gap-2 shrink-0">
								<ChevronRightIcon className="size-4 text-muted-foreground/60 shrink-0" />
								<Link
									href={`/archive?folder=${anc.id}`}
									className="font-title text-2xl tracking-tight text-muted-foreground hover:text-foreground transition-colors truncate max-w-[180px]"
								>
									{anc.name}
								</Link>
							</span>
						))}
						<ChevronRightIcon className="size-4 text-muted-foreground/60 shrink-0" />
						<span className="font-title text-2xl tracking-tight text-foreground truncate max-w-[220px]">
							{selectedFolder.name}
						</span>
					</nav>
				) : (
					<nav aria-label="Breadcrumb" data-testid="archive-breadcrumbs" className="flex items-center gap-2 text-sm min-w-0">
						<Link
							href="/archive"
							className="font-title text-2xl tracking-tight text-muted-foreground hover:text-foreground transition-colors shrink-0"
						>
							Archive
						</Link>
						<ChevronRightIcon className="size-4 text-muted-foreground/60 shrink-0" />
						<span className="font-title text-2xl tracking-tight text-foreground truncate">
							Folder Not Found
						</span>
					</nav>
				)}
			</TopBar>

			{/* Main Scrollable Area */}
			<div className={cn("flex-1 overflow-y-auto px-6 py-6 max-w-5xl w-full mx-auto", isArchiveEmpty && "flex flex-col")}>
				{/* Search & Filter Toolbar */}
				{!isArchiveEmpty && (
					<div className="mb-6 flex flex-col gap-3 rounded-xl border border-border bg-card p-3 shadow-xs">
						<div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
							{/* Archived Search Bar */}
							<div className="relative flex-1">
								<Input
									ref={searchInputRef}
									data-testid="archive-search"
									value={searchQuery}
									onChange={(e) => setSearchQuery(e.target.value)}
									placeholder={
										destination === "folder" && selectedFolder
											? `Search in ${selectedFolder.name}…`
											: destination === "unorganized"
											? "Search unorganized sessions…"
											: "Search archived sessions…"
									}
									aria-label="Search archived sessions"
									className="h-8 w-full rounded-md border-border/70 bg-background pl-8 pr-8 text-xs placeholder:text-muted-foreground/60"
								/>
								<SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/70" />
								{searchQuery && (
									<button
										type="button"
										onClick={() => {
											setSearchQuery("");
											searchInputRef.current?.focus();
										}}
										className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground/60 hover:text-foreground cursor-pointer"
										aria-label="Clear search"
									>
										<XIcon className="size-3.5" />
									</button>
								)}
							</div>

							{/* Type Filter Buttons */}
							<div
								data-testid="archive-kind-filter"
								role="radiogroup"
								aria-label="Filter archived sessions by kind"
								className="flex h-7 items-center gap-0.5 rounded-full border border-border/70 bg-card/70 p-0.5 shadow-xs backdrop-blur"
							>
								{(["all", "teach", "practice"] as const).map((k) => (
									<button
										key={k}
										type="button"
										role="radio"
										aria-checked={kindFilter === k}
										data-testid={`kind-filter-${k}`}
										onClick={() => setKindFilter(k)}
										className={cn(
											"h-full rounded-full px-2.5 text-[10px] font-medium uppercase tracking-wider transition-colors cursor-pointer flex items-center justify-center focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none",
											kindFilter === k
												? "bg-accent text-foreground font-semibold shadow-xs"
												: "text-muted-foreground hover:text-foreground hover:bg-muted/30",
										)}
									>
										{k === "all" ? "All" : k === "teach" ? "Teaching" : "Practice"}
									</button>
								))}
							</div>
						</div>
					</div>
				)}

				{/* Loading State */}
				{loading && (
					<div className="py-12 text-center text-xs text-muted-foreground animate-pulse">
						Loading archive…
					</div>
				)}

				{/* Empty State: 0 total archived items (open centered layout, no dashed card, no Go to Sessions button) */}
				{isArchiveEmpty && (
					<div
						data-testid="archive-empty-state"
						className="flex flex-1 flex-col items-center justify-center text-center"
					>
						<div className="flex size-12 items-center justify-center rounded-full bg-muted/40 text-muted-foreground mb-4">
							<ArchiveIcon className="size-6" />
						</div>
						<h2 className="text-base font-semibold text-foreground">Archive is empty</h2>
						<p className="mt-1.5 max-w-md text-sm text-muted-foreground leading-relaxed">
							Sessions and folders you archive will appear here. Viewing archived sessions is always read-only, and you can restore them at any time.
						</p>
					</div>
				)}

				{/* Search No Results State */}
				{isSearchEmpty && (
					<div
						data-testid="archive-no-results"
						className="flex flex-col items-center justify-center rounded-2xl border border-border/60 bg-muted/10 p-10 text-center"
					>
						<div className="flex size-10 items-center justify-center rounded-full bg-muted/30 text-muted-foreground mb-3">
							<SearchIcon className="size-5" />
						</div>
						<h2 className="text-sm font-semibold text-foreground">No archived sessions match search</h2>
						<p className="mt-1 text-xs text-muted-foreground">
							No archived sessions matched &ldquo;{searchQuery.trim()}&rdquo;.
						</p>
						<div className="mt-4 flex items-center gap-2">
							<button
								type="button"
								data-testid="archive-clear-search"
								onClick={() => {
									setSearchQuery("");
									searchInputRef.current?.focus();
								}}
								className="rounded-md border border-border bg-card px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-accent cursor-pointer"
							>
								Clear search
							</button>
							{kindFilter !== "all" && (
								<button
									type="button"
									data-testid="archive-clear-filters"
									onClick={() => {
										setSearchQuery("");
										setKindFilter("all");
										searchInputRef.current?.focus();
									}}
									className="rounded-md border border-border/70 bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground cursor-pointer"
								>
									Clear all
								</button>
							)}
						</div>
					</div>
				)}

				{/* Filter No Results State */}
				{isFilterEmpty && (
					<div
						data-testid="archive-no-results"
						className="flex flex-col items-center justify-center rounded-2xl border border-border/60 bg-muted/10 p-10 text-center"
					>
						<div className="flex size-10 items-center justify-center rounded-full bg-muted/30 text-muted-foreground mb-3">
							<SearchIcon className="size-5" />
						</div>
						<h2 className="text-sm font-semibold text-foreground">No archived sessions match filter</h2>
						<p className="mt-1 text-xs text-muted-foreground">
							No archived sessions found with the selected filter criteria.
						</p>
						<button
							type="button"
							data-testid="archive-clear-filters"
							onClick={() => {
								setKindFilter("all");
							}}
							className="mt-4 rounded-md border border-border bg-card px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-accent cursor-pointer"
						>
							Clear filters
						</button>
					</div>
				)}

				{/* Content List: Scoped to selected destination */}
				{!loading && !isArchiveEmpty && !isSearchEmpty && !isFilterEmpty && (
					<>
						{/* Destination 1: All Archived */}
						{destination === "all" && (
							<div className="space-y-4">
								{/* Archived folders as compact entity rows (flat, one row per folder with origin metadata) */}
								{sortedArchivedFolders.length > 0 && (
									<div data-testid="archive-folders-section" className="space-y-1.5">
										{sortedArchivedFolders.map((f) => renderFolderRow(f))}
									</div>
								)}

								{/* Flat list of all archived sessions (including sessions within archived folders) */}
								{filteredChats.length > 0 && (
									<div data-testid="archive-sessions-section" className="space-y-2 pt-2">
										{sortedArchivedFolders.length > 0 && (
											<div className="flex items-center gap-2 px-1 pb-1">
												<span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">
													Archived Sessions
												</span>
												<span className="text-[10px] text-muted-foreground/60 tabular-nums">
													({filteredChats.length})
												</span>
											</div>
										)}
										<div data-testid="archive-unorganized-section" className="space-y-1.5">
											{filteredChats.map((c) => renderChatRow(c, 0))}
										</div>
									</div>
								)}
							</div>
						)}

						{/* Destination 2: Unorganized */}
						{destination === "unorganized" && (
							<div className="space-y-4">
								{filteredChats.length > 0 ? (
									<div data-testid="archive-unorganized-list" className="space-y-1.5">
										{filteredChats.map((c) => renderChatRow(c, 0))}
									</div>
								) : (
									<div
										data-testid="archive-unorganized-empty"
										className="py-12 text-center text-xs text-muted-foreground select-none"
									>
										No unorganized archived sessions.
									</div>
								)}
							</div>
						)}

						{/* Destination 3: Folder View */}
						{destination === "folder" && (
							selectedFolder ? (
								<div data-testid={`archive-folder-view-${selectedFolder.id}`} className="space-y-4">
									{/* Folder Header with Action Affordances */}
									<div
										data-testid="archive-folder-header"
										className="flex items-center justify-between pb-3 border-b border-border/50"
									>
										<div className="flex items-center gap-2.5 min-w-0">
											<span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted/40 text-muted-foreground">
												<FolderOpenIcon className="size-4" />
											</span>
											<div className="min-w-0">
												<h2 className="text-base font-semibold text-foreground truncate">{selectedFolder.name}</h2>
												<span className="text-xs text-muted-foreground/80 tabular-nums">
													{getFolderChatCount(selectedFolder.id, archivedFolders, archivedChats)} {getFolderChatCount(selectedFolder.id, archivedFolders, archivedChats) === 1 ? "session" : "sessions"}
												</span>
											</div>
										</div>

										<div className="flex items-center gap-2 shrink-0">
											<button
												type="button"
												data-testid={`restore-folder-${selectedFolder.id}`}
												aria-label={`Restore folder ${selectedFolder.name}`}
												onClick={() => handleRestoreFolder(selectedFolder.id)}
												className="flex items-center gap-1.5 rounded-md border border-border/70 bg-card px-2.5 py-1 text-xs text-muted-foreground transition-all hover:bg-accent hover:text-foreground hover:border-border cursor-pointer shadow-2xs"
											>
												<RotateCcwIcon className="size-3.5" />
												<span>Restore folder</span>
											</button>
											<button
												type="button"
												data-testid={`archive-folder-options-${selectedFolder.id}`}
												aria-label={`Options for archived folder ${selectedFolder.name}`}
												onClick={(e) => openFolderContext(e, selectedFolder)}
												className="flex size-7 items-center justify-center rounded-md border border-border/70 text-muted-foreground transition-all hover:border-border hover:bg-accent hover:text-foreground cursor-pointer shadow-2xs"
											>
												<MoreVerticalIcon className="size-4" />
											</button>
										</div>
									</div>

									{/* Child/Descendant Folders: Navigable Nested Folders */}
									{sortedChildFolders.length > 0 && (
										<div data-testid="archive-nested-folders" className="space-y-2">
											<div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80 px-1">
												Nested Folders ({sortedChildFolders.length})
											</div>
											<div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
												{sortedChildFolders.map((child) => {
													const count = getFolderChatCount(child.id, archivedFolders, archivedChats);
													const childOriginPath = child.parentId !== selectedFolder.id ? getFolderPathString(child.parentId, allKnownFolders) : null;
													return (
														<div
															key={child.id}
															data-testid={`archive-nested-folder-${child.id}`}
															className="group flex items-center justify-between gap-2 rounded-lg border border-border/50 bg-card/60 p-2.5 transition-colors hover:bg-accent/40"
														>
															<Link
																href={`/archive?folder=${child.id}`}
																className="flex items-center gap-2.5 min-w-0 flex-1 cursor-pointer"
															>
																<span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground">
																	<FolderIcon className="size-4" />
																</span>
																<div className="min-w-0 flex-1">
																	<div className="flex items-center gap-2">
																		<span className="text-xs font-semibold text-foreground truncate">{child.name}</span>
																		<span className="text-[11px] tabular-nums text-muted-foreground/75 px-1.5 py-0.5 rounded bg-muted/40">
																			{count}
																		</span>
																	</div>
																	{childOriginPath && (
																		<div className="text-[10px] text-muted-foreground/70 font-mono truncate">
																			In: {childOriginPath}
																		</div>
																	)}
																</div>
															</Link>
															<div className="flex items-center gap-1 shrink-0">
																<button
																	type="button"
																	data-testid={`archive-folder-options-${child.id}`}
																	aria-label={`Options for archived folder ${child.name}`}
																	onClick={(e) => {
																		e.stopPropagation();
																		openFolderContext(e, child);
																	}}
																	className="flex size-6 items-center justify-center rounded border border-transparent text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer"
																>
																	<MoreVerticalIcon className="size-3.5" />
																</button>
																<Link
																	href={`/archive?folder=${child.id}`}
																	aria-label={`Open folder ${child.name}`}
																	className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
																>
																	<ChevronRightIcon className="size-3.5" />
																</Link>
															</div>
														</div>
													);
												})}
											</div>
										</div>
									)}

									{/* Child Conversations */}
									{visibleFolderChats.length > 0 && (
										<div data-testid="archive-folder-chats" className="space-y-1.5">
											{sortedChildFolders.length > 0 && (
												<div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80 px-1 pt-1">
													Sessions ({visibleFolderChats.length})
												</div>
											)}
											{visibleFolderChats.map((c) => renderChatRow(c, 0))}
										</div>
									)}

									{/* Empty folder (no child folders and no child chats) */}
									{sortedChildFolders.length === 0 && visibleFolderChats.length === 0 && (
										<div
											data-testid="archive-empty-folder"
											className="py-12 text-center text-xs text-muted-foreground select-none"
										>
											This folder is empty.
										</div>
									)}
								</div>
							) : (
								<div data-testid="archive-folder-not-found" className="py-12 text-center">
									<h2 className="text-sm font-semibold text-foreground">Folder not found</h2>
									<p className="mt-1 text-xs text-muted-foreground">
										The requested archived folder does not exist or has been restored.
									</p>
									<div className="mt-4">
										<Link
											href="/archive"
											className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-accent cursor-pointer"
										>
											View All Archived
										</Link>
									</div>
								</div>
							)
						)}
					</>
				)}
			</div>

			{/* Context Menu for Chats */}
			{ctxChatId !== null && (
				<MenuShell
					anchorRef={ctxChatAnchorRef}
					testid="archive-chat-context-menu"
					preferredSide="down"
					menuClass="flex w-52 flex-col gap-0.5 rounded-xl border bg-card p-2 text-xs shadow-xl"
				>
					<button
						type="button"
						data-testid="ctx-restore-chat"
						onClick={() => {
							const id = ctxChatId;
							closeContextMenus();
							handleRestoreChat(id);
						}}
						className="flex items-center rounded-lg px-2.5 py-1.5 text-left text-foreground transition-colors hover:bg-accent cursor-pointer"
					>
						Restore session
					</button>
					<button
						type="button"
						data-testid="ctx-restore-to-chat"
						onClick={() => {
							const target = archivedChats.find((c) => c.id === ctxChatId);
							if (target) {
								setMovingTarget({
									kind: "chat",
									id: target.id,
									title: target.title,
									parentId: null,
									isRestore: true,
								});
							}
							closeContextMenus();
						}}
						className="flex items-center rounded-lg px-2.5 py-1.5 text-left text-foreground transition-colors hover:bg-accent cursor-pointer"
					>
						Restore to…
					</button>
					<button
						type="button"
						data-testid="ctx-delete-chat"
						onClick={() => {
							const target = archivedChats.find((c) => c.id === ctxChatId);
							if (target) setDeletingChat(target);
							closeContextMenus();
						}}
						className="flex items-center rounded-lg px-2.5 py-1.5 text-left text-muted-foreground/80 transition-colors hover:bg-accent hover:text-foreground cursor-pointer"
					>
						Delete…
					</button>
				</MenuShell>
			)}

			{/* Context Menu for Folders */}
			{ctxFolderId !== null && (
				<MenuShell
					anchorRef={ctxFolderAnchorRef}
					testid="archive-folder-context-menu"
					preferredSide="down"
					menuClass="flex w-52 flex-col gap-0.5 rounded-xl border bg-card p-2 text-xs shadow-xl"
				>
					<button
						type="button"
						data-testid="ctx-restore-folder"
						onClick={() => {
							const id = ctxFolderId;
							closeContextMenus();
							handleRestoreFolder(id);
						}}
						className="flex items-center rounded-lg px-2.5 py-1.5 text-left text-foreground transition-colors hover:bg-accent cursor-pointer"
					>
						Restore folder
					</button>
					<button
						type="button"
						data-testid="ctx-restore-to-folder"
						onClick={() => {
							const target = archivedFolders.find((f) => f.id === ctxFolderId);
							if (target) {
								setMovingTarget({
									kind: "folder",
									id: target.id,
									title: target.name,
									parentId: null,
									isRestore: true,
								});
							}
							closeContextMenus();
						}}
						className="flex items-center rounded-lg px-2.5 py-1.5 text-left text-foreground transition-colors hover:bg-accent cursor-pointer"
					>
						Restore to…
					</button>
					<button
						type="button"
						data-testid="ctx-delete-folder"
						onClick={() => {
							const target = archivedFolders.find((f) => f.id === ctxFolderId);
							if (target) setDeletingFolder(target);
							closeContextMenus();
						}}
						className="flex items-center rounded-lg px-2.5 py-1.5 text-left text-muted-foreground/80 transition-colors hover:bg-accent hover:text-foreground cursor-pointer"
					>
						Delete folder…
					</button>
				</MenuShell>
			)}

			{/* Move/Restore Destination Dialog (ONLY active folders listed) */}
			<MoveDestinationDialog
				item={movingTarget}
				folders={activeFolders}
				organization={organization}
				onClose={() => setMovingTarget(null)}
				onMove={handleDestinationMove}
			/>

			{/* Delete Session Dialog */}
			<DeleteSessionDialog
				chat={deletingChat}
				onClose={() => setDeletingChat(null)}
				onDeleted={(id) => {
					setDeletingChat(null);
					setArchivedChats((prev) => prev.filter((c) => c.id !== id));
				}}
			/>

			{/* Delete Folder Dialog */}
			<DeleteFolderDialog
				folder={deletingFolder}
				onClose={() => setDeletingFolder(null)}
				onConfirm={() => {
					if (!deletingFolder) return;
					const fId = deletingFolder.id;
					setDeletingFolder(null);
					void executeAction({ action: "delete-folder", id: fId });
				}}
			/>

			{/* Organization Feedback Toast with Undo */}
			<OrganizationFeedbackToast
				feedback={feedback}
				onDismiss={() => setFeedback(null)}
			/>
		</main>
	);
}
