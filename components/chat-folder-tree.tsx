"use client";

import { useMemo, useState, useRef, useEffect, type ReactNode } from "react";
import {
	ArchiveIcon,
	ArrowLeftIcon,
	ChevronRightIcon,
	FolderIcon,
	FolderOpenIcon,
	MoreVerticalIcon,
	PlusIcon,
	RotateCcwIcon,
} from "lucide-react";
import {
	canMoveChatFolder,
	fuzzyScore,
	type ChatDirectoryItem,
	type ChatFolder,
	type ChatOrganization,
} from "@/src/core";
import { SessionRow, RenameRow } from "@/components/sidebar";
import { cn } from "@/lib/utils";
import {
	CHAT_DRAG_TYPE,
	calculateDropPosition,
	setChatDragGhost,
	type DraggedItemPayload,
	type DropPosition,
	type DropTargetState,
} from "@/components/chat-organization-interactions";

export interface ChatFolderTreeProps {
	folders: ChatFolder[];
	chats: ChatDirectoryItem[];
	activeChatId: string | null;
	kbdChatId?: string | null;
	expandedFolderIds: ReadonlySet<string>;
	onToggleFolder: (folderId: string) => void;
	onSelectChat: (chatId: string) => void;
	onContextMenuChat?: (e: React.MouseEvent<HTMLButtonElement>, chat: ChatDirectoryItem) => void;
	onNewSessionInFolder?: (folderId: string) => void;
	onFolderContextMenu?: (e: React.MouseEvent<HTMLElement>, folder: ChatFolder) => void;
	selectedFolderId?: string | null;
	onSelectFolder?: (folderId: string | null) => void;
	renamingId?: string | null;
	onCommitRename?: (id: string, next: string) => void;
	onCancelRename?: () => void;
	organization?: ChatOrganization | null;
	renamingFolderId?: string | null;
	onCommitFolderRename?: (id: string, next: string) => void;
	onCancelFolderRename?: () => void;
	onMoveItem?: (
		kind: "chat" | "folder",
		id: string,
		targetParentId: string | null,
		targetOrder?: number,
	) => void;
	onReorderSiblings?: (
		parentId: string | null,
		kind: "chat" | "folder",
		ids: string[],
	) => void;
	isSearchActive?: boolean;
	searchQuery?: string;
	unorganizedExpanded?: boolean;
	onToggleUnorganized?: () => void;
	emptyMessage?: string;
}

/** Check if a folder or any of its descendant folders contains matching chats. */
export function folderHasMatchingChat(
	folderId: string,
	folders: ChatFolder[],
	chats: ChatDirectoryItem[],
	query: string,
): boolean {
	const q = query.trim();
	if (!q) return true;
	// Direct chats
	if (chats.some((c) => c.folderId === folderId && fuzzyScore(q, c.title) !== null)) {
		return true;
	}
	// Child folders
	const childFolders = folders.filter((f) => f.parentId === folderId);
	return childFolders.some((child) => folderHasMatchingChat(child.id, folders, chats, q));
}

/** Compute total active chats inside a folder and its descendant subfolders. */
export function getFolderChatCount(
	folderId: string,
	folders: ChatFolder[],
	chats: ChatDirectoryItem[],
): number {
	const direct = chats.filter((c) => c.folderId === folderId).length;
	const childFolders = folders.filter((f) => f.parentId === folderId);
	return direct + childFolders.reduce((acc, f) => acc + getFolderChatCount(f.id, folders, chats), 0);
}

/** Collect all ancestor folder IDs for a folder. */
export function getAncestorFolderIds(folderId: string, folders: ChatFolder[]): Set<string> {
	const ancestors = new Set<string>();
	let current = folders.find((f) => f.id === folderId)?.parentId ?? null;
	const seen = new Set<string>();
	while (current !== null && !seen.has(current)) {
		seen.add(current);
		ancestors.add(current);
		current = folders.find((f) => f.id === current)?.parentId ?? null;
	}
	return ancestors;
}

/** Find all ancestor folder IDs for a chat's placement. */
export function getChatFolderChain(chatFolderId: string | null, folders: ChatFolder[]): Set<string> {
	if (!chatFolderId) return new Set();
	const chain = getAncestorFolderIds(chatFolderId, folders);
	chain.add(chatFolderId);
	return chain;
}

/** Returns the human-readable folder path string (e.g. "SO Lab / Assembly") for a chat's folderId. */
export function getFolderPathString(folderId: string | null, folders: ChatFolder[]): string | null {
	if (!folderId) return null;
	const parts: string[] = [];
	let current: string | null = folderId;
	const seen = new Set<string>();
	while (current !== null && !seen.has(current)) {
		seen.add(current);
		const folder = folders.find((f) => f.id === current);
		if (!folder) break;
		parts.unshift(folder.name);
		current = folder.parentId;
	}
	return parts.length > 0 ? parts.join(" / ") : null;
}

/** Indentation metrics for outline list alignment (following Apple Finder & Carbon design guidelines).
 *  Base left padding is 8px.
 *  Each deeper depth adds 16px.
 *  Sessions inside a folder start offset by 32px from the folder's base indentation,
 *  aligning the session title cleanly under the folder title and avoiding the
 *  paradox where child sessions appeared to the left of parent folder text.
 */
export const TREE_BASE_INDENT = 8;
export const TREE_INDENT_PER_LEVEL = 16;
export const TREE_CHAT_OFFSET = 32;

export function folderPaddingLeft(depth: number): number {
	return TREE_BASE_INDENT + depth * TREE_INDENT_PER_LEVEL;
}

export function chatPaddingLeft(depth: number): number {
	return TREE_BASE_INDENT + depth * TREE_INDENT_PER_LEVEL + TREE_CHAT_OFFSET;
}

/** Inline folder rename row (mirrors RenameRow). */
export function RenameFolderRow({
	folder,
	depth,
	onCommit,
	onCancel,
}: {
	folder: ChatFolder;
	depth: number;
	onCommit: (next: string) => void;
	onCancel: () => void;
}) {
	const [draft, setDraft] = useState(folder.name);
	const inputRef = useRef<HTMLInputElement | null>(null);
	const committedRef = useRef(false);
	const cancelledRef = useRef(false);

	useEffect(() => {
		const el = inputRef.current;
		if (el) {
			el.focus();
			el.select();
		}
	}, []);

	const handleCommit = () => {
		if (committedRef.current || cancelledRef.current) return;
		committedRef.current = true;
		const trimmed = draft.trim();
		if (!trimmed || trimmed === folder.name) {
			onCancel();
		} else {
			onCommit(trimmed);
		}
	};

	const handleCancel = () => {
		if (committedRef.current || cancelledRef.current) return;
		cancelledRef.current = true;
		onCancel();
	};

	return (
		<div
			data-testid={`folder-rename-row-${folder.id}`}
			className="relative mb-0.5 flex w-full items-center rounded-lg bg-accent/40 py-1.5 pr-2"
			style={{ paddingLeft: `${folderPaddingLeft(depth)}px` }}
		>
			{/* Spacer matching the chevron button footprint (size-4 = 16px) + gap-1 (4px) + folder icon (16px) */}
			<div className="flex items-center gap-1 shrink-0" aria-hidden="true">
				<span className="size-4 shrink-0" />
				<span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
					<FolderIcon className="size-3.5" />
				</span>
			</div>
			<input
				ref={inputRef}
				value={draft}
				spellCheck={false}
				onChange={(e) => setDraft(e.target.value)}
				onBlur={handleCommit}
				onKeyDown={(e) => {
					if (e.key === "Enter") {
						e.preventDefault();
						handleCommit();
					}
					if (e.key === "Escape") {
						e.stopPropagation();
						handleCancel();
					}
				}}
				aria-label="Rename folder"
				data-testid={`folder-rename-input-${folder.id}`}
				className="lh-input w-full min-w-0 truncate border-0 border-b border-border bg-transparent px-0 font-prose text-sm font-medium leading-snug text-foreground outline-none ml-1.5"
			/>
		</div>
	);
}

/** One accessible folder row with expand/collapse, icon, name, count, and actions. */
export function ChatFolderRow({
	folder,
	depth,
	isOpen,
	chatCount,
	selected,
	onToggle,
	onSelect,
	onNewSession,
	onContextMenu,
	onOpenOptions,
	draggable = true,
	onDragStart,
	onDragEnd,
	onDragOver,
	onDragLeave,
	onDrop,
	dropIndicator,
}: {
	folder: ChatFolder;
	depth: number;
	isOpen: boolean;
	chatCount: number;
	selected?: boolean;
	onToggle: () => void;
	onSelect?: () => void;
	onNewSession?: () => void;
	onContextMenu?: (e: React.MouseEvent<HTMLDivElement>) => void;
	onOpenOptions?: (e: React.MouseEvent<HTMLButtonElement>) => void;
	draggable?: boolean;
	onDragStart?: (e: React.DragEvent<HTMLDivElement>) => void;
	onDragEnd?: (e: React.DragEvent<HTMLDivElement>) => void;
	onDragOver?: (e: React.DragEvent<HTMLDivElement>) => void;
	onDragLeave?: (e: React.DragEvent<HTMLDivElement>) => void;
	onDrop?: (e: React.DragEvent<HTMLDivElement>) => void;
	dropIndicator?: DropPosition | null;
}) {
	return (
		<div
			tabIndex={0}
			data-testid={`folder-row-${folder.id}`}
			data-folder-id={folder.id}
			data-drop-inside={dropIndicator === "inside" ? "true" : undefined}
			data-drop-target={dropIndicator ?? undefined}
			draggable={draggable}
			onDragStart={onDragStart}
			onDragEnd={onDragEnd}
			onDragOver={onDragOver}
			onDragLeave={onDragLeave}
			onDrop={onDrop}
			onContextMenu={onContextMenu}
			onClick={onSelect}
			onKeyDown={(e) => {
				if (e.key === "ArrowRight") {
					if (!isOpen) {
						e.preventDefault();
						onToggle();
					}
				} else if (e.key === "ArrowLeft") {
					if (isOpen) {
						e.preventDefault();
						onToggle();
					}
				} else if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					onSelect?.();
				}
			}}
			className={cn(
				"group relative mb-0.5 flex w-full items-center rounded-lg py-1.5 pr-2 transition-colors cursor-pointer select-none text-muted-foreground hover:text-foreground hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
				selected && "bg-muted/20 ring-1 ring-border/50 text-foreground",
				isOpen && !selected && "text-foreground",
				dropIndicator === "inside" && "ring-2 ring-primary/80 bg-accent shadow-sm text-foreground",
				dropIndicator === "before" && "border-t-2 border-primary pt-1 pb-1.5",
				dropIndicator === "after" && "border-b-2 border-primary pt-1.5 pb-1",
			)}
			style={{ paddingLeft: `${folderPaddingLeft(depth)}px` }}
		>
			<div className="flex items-center gap-1 shrink-0">
				<button
					type="button"
					aria-expanded={isOpen}
					aria-label={`${isOpen ? "Collapse" : "Expand"} folder ${folder.name}`}
					data-testid={`folder-toggle-${folder.id}`}
					onClick={(e) => {
						e.stopPropagation();
						onToggle();
					}}
					className="flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground/70 transition-transform hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
				>
					<ChevronRightIcon className={cn("size-3.5 transition-transform duration-150", isOpen && "rotate-90")} />
				</button>

				<span
					data-testid={`folder-icon-${folder.id}`}
					className="flex size-4 shrink-0 items-center justify-center text-muted-foreground"
					aria-hidden="true"
				>
					{isOpen ? <FolderOpenIcon className="size-3.5 text-primary/70" /> : <FolderIcon className="size-3.5" />}
				</span>
			</div>

			<span className="min-w-0 flex-1 truncate font-prose text-sm font-medium leading-snug text-foreground ml-1.5">
				{folder.name}
			</span>

			<div className="flex items-center gap-1 shrink-0 ml-auto pl-1">
				<span
					data-testid={`folder-count-${folder.id}`}
					aria-label={`${chatCount} ${chatCount === 1 ? "session" : "sessions"}`}
					className="text-[10px] tabular-nums font-mono text-muted-foreground/60 shrink-0 select-none"
				>
					{chatCount}
				</span>

				{(onNewSession || onOpenOptions) && (
					<div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
						{onNewSession && (
							<button
								type="button"
								data-testid={`new-session-folder-${folder.id}`}
								aria-label={`New session in ${folder.name}`}
								onClick={(e) => {
									e.stopPropagation();
									onNewSession();
								}}
								className="flex size-4 items-center justify-center rounded text-muted-foreground/70 transition-colors hover:bg-accent-foreground/10 hover:text-foreground cursor-pointer"
							>
								<PlusIcon className="size-3" />
							</button>
						)}

						{onOpenOptions && (
							<button
								type="button"
								data-testid={`folder-options-${folder.id}`}
								aria-label={`Options for folder ${folder.name}`}
								onClick={(e) => {
									e.stopPropagation();
									onOpenOptions(e);
								}}
								className="flex size-4 items-center justify-center rounded text-muted-foreground/70 transition-colors hover:bg-accent-foreground/10 hover:text-foreground cursor-pointer"
							>
								<MoreVerticalIcon className="size-3" />
							</button>
						)}
					</div>
				)}
			</div>
		</div>
	);
}

/** Animated collapsible wrapper for smooth folder expansion and collapsing */
export function CollapsibleFolderContent({
	open,
	children,
}: {
	open: boolean;
	children: ReactNode;
}) {
	const [rendered, setRendered] = useState(open);
	const [animating, setAnimating] = useState(open);

	useEffect(() => {
		if (open) {
			setRendered(true);
			let raf2: number | undefined;
			const raf1 = requestAnimationFrame(() => {
				raf2 = requestAnimationFrame(() => {
					setAnimating(true);
				});
			});
			return () => {
				cancelAnimationFrame(raf1);
				if (raf2 !== undefined) cancelAnimationFrame(raf2);
			};
		} else {
			setAnimating(false);
			const timer = setTimeout(() => {
				setRendered(false);
			}, 180);
			return () => clearTimeout(timer);
		}
	}, [open]);

	if (!rendered && !open) return null;

	return (
		<div
			className={cn(
				"overflow-hidden transition-all duration-180",
				animating && open ? "lh-folder-expand" : "lh-folder-collapse",
			)}
		>
			<div className="lh-folder-inner relative">
				{children}
			</div>
		</div>
	);
}

/** The nested chat folder tree presentation. */
export function ChatFolderTree({
	folders,
	chats,
	activeChatId,
	kbdChatId,
	expandedFolderIds,
	onToggleFolder,
	onSelectChat,
	onContextMenuChat,
	onNewSessionInFolder,
	onFolderContextMenu,
	selectedFolderId,
	onSelectFolder,
	renamingId,
	onCommitRename,
	onCancelRename,
	organization,
	renamingFolderId,
	onCommitFolderRename,
	onCancelFolderRename,
	onMoveItem,
	onReorderSiblings,
	isSearchActive = false,
	searchQuery = "",
	unorganizedExpanded = true,
	onToggleUnorganized,
	emptyMessage = "No sessions match.",
}: ChatFolderTreeProps) {
	const isSearch = isSearchActive && searchQuery.trim() !== "";
	// Drag and drop state
	const [draggedItem, setDraggedItem] = useState<DraggedItemPayload | null>(null);
	const [dropTarget, setDropTarget] = useState<DropTargetState | null>(null);

	// Filter & sort folders and chats
	const topFolders = useMemo(() => {
		const roots = folders.filter((f) => f.parentId === null);
		return [...roots].sort((a, b) => {
			if (a.order !== undefined && b.order !== undefined) return a.order - b.order;
			if (a.order !== undefined) return -1;
			if (b.order !== undefined) return 1;
			return a.name.localeCompare(b.name);
		});
	}, [folders]);

	const unorganizedChats = useMemo(() => {
		return chats.filter((c) => c.folderId === null);
	}, [chats]);

	// Drag event handlers
	const handleDragStart = (
		e: React.DragEvent,
		kind: "chat" | "folder",
		id: string,
		parentId: string | null,
		title: string,
	) => {
		const payload: DraggedItemPayload = { kind, id, parentId };
		setDraggedItem(payload);
		e.dataTransfer.setData(CHAT_DRAG_TYPE, JSON.stringify(payload));
		e.dataTransfer.effectAllowed = "move";
		const svgIcon = (e.currentTarget as HTMLElement).querySelector("svg");
		setChatDragGhost(e, title, svgIcon);
	};

	const handleDragEnd = () => {
		setDraggedItem(null);
		setDropTarget(null);
	};

	const handleFolderDragOver = (
		e: React.DragEvent<HTMLDivElement>,
		folder: ChatFolder,
	) => {
		if (!e.dataTransfer.types.includes(CHAT_DRAG_TYPE)) return;
		e.preventDefault();
		e.stopPropagation();

		const rect = e.currentTarget.getBoundingClientRect();
		const offsetY = e.clientY - rect.top;
		const pos = calculateDropPosition(offsetY, rect.height, "folder");

		if (draggedItem?.kind === "folder") {
			// Check cycle / descendant prevention
			const targetParent = pos === "inside" ? folder.id : folder.parentId;
			const valid = organization
				? canMoveChatFolder(organization, draggedItem.id, targetParent)
				: folder.id !== draggedItem.id;

			if (!valid) {
				e.dataTransfer.dropEffect = "none";
				setDropTarget(null);
				return;
			}
		}

		e.dataTransfer.dropEffect = "move";
		setDropTarget({ id: folder.id, kind: "folder", position: pos });
	};

	const handleFolderDrop = (
		e: React.DragEvent<HTMLDivElement>,
		folder: ChatFolder,
	) => {
		const raw = e.dataTransfer.getData(CHAT_DRAG_TYPE);
		if (!raw) return;
		e.preventDefault();
		e.stopPropagation();

		let payload: DraggedItemPayload;
		try {
			payload = JSON.parse(raw) as DraggedItemPayload;
		} catch {
			return;
		}

		const target = dropTarget;
		setDropTarget(null);
		setDraggedItem(null);

		if (!target || target.id !== folder.id) return;

		if (target.position === "inside") {
			// Move inside folder
			if (payload.kind === "folder") {
				if (organization && !canMoveChatFolder(organization, payload.id, folder.id)) return;
			}
			onMoveItem?.(payload.kind, payload.id, folder.id);
			return;
		}

		// Reorder before or after folder among siblings
		const parentId = folder.parentId;
		if (payload.kind === "folder") {
			if (organization && !canMoveChatFolder(organization, payload.id, parentId)) return;

			const siblings = folders
				.filter((f) => f.parentId === parentId)
				.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

			const remainingIds = siblings.map((s) => s.id).filter((id) => id !== payload.id);
			const targetIdx = remainingIds.indexOf(folder.id);
			const insertIdx = target.position === "before" ? targetIdx : targetIdx + 1;
			const newIds = [
				...remainingIds.slice(0, insertIdx),
				payload.id,
				...remainingIds.slice(insertIdx),
			];

			if (payload.parentId === parentId) {
				onReorderSiblings?.(parentId, "folder", newIds);
			} else {
				onMoveItem?.("folder", payload.id, parentId, insertIdx);
			}
		} else {
			// Chat dropped before/after a folder -> place chat inside that folder
			onMoveItem?.("chat", payload.id, folder.id);
		}
	};

	const handleChatDragOver = (
		e: React.DragEvent<HTMLDivElement>,
		chat: ChatDirectoryItem,
	) => {
		if (!e.dataTransfer.types.includes(CHAT_DRAG_TYPE)) return;
		e.preventDefault();
		e.stopPropagation();

		// Folders cannot be dropped onto chats
		if (draggedItem?.kind === "folder") {
			e.dataTransfer.dropEffect = "none";
			setDropTarget(null);
			return;
		}

		const rect = e.currentTarget.getBoundingClientRect();
		const offsetY = e.clientY - rect.top;
		const pos = calculateDropPosition(offsetY, rect.height, "chat");

		e.dataTransfer.dropEffect = "move";
		setDropTarget({ id: chat.id, kind: "chat", position: pos });
	};

	const handleChatDrop = (
		e: React.DragEvent<HTMLDivElement>,
		chat: ChatDirectoryItem,
	) => {
		const raw = e.dataTransfer.getData(CHAT_DRAG_TYPE);
		if (!raw) return;
		e.preventDefault();
		e.stopPropagation();

		let payload: DraggedItemPayload;
		try {
			payload = JSON.parse(raw) as DraggedItemPayload;
		} catch {
			return;
		}

		if (payload.kind !== "chat") return;
		const target = dropTarget;
		setDropTarget(null);
		setDraggedItem(null);

		if (!target || target.id !== chat.id) return;

		const parentId = chat.folderId;
		const siblings = chats
			.filter((c) => c.folderId === parentId)
			.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

		const remainingIds = siblings.map((s) => s.id).filter((id) => id !== payload.id);
		const targetIdx = remainingIds.indexOf(chat.id);
		const insertIdx = target.position === "before" ? targetIdx : targetIdx + 1;
		const newIds = [
			...remainingIds.slice(0, insertIdx),
			payload.id,
			...remainingIds.slice(insertIdx),
		];

		if (payload.parentId === parentId) {
			onReorderSiblings?.(parentId, "chat", newIds);
		} else {
			onMoveItem?.("chat", payload.id, parentId, insertIdx);
		}
	};

	const handleRootDragOver = (e: React.DragEvent<HTMLDivElement>) => {
		if (!e.dataTransfer.types.includes(CHAT_DRAG_TYPE)) return;
		e.preventDefault();
		e.stopPropagation();
		e.dataTransfer.dropEffect = "move";
		setDropTarget({ id: "root", kind: "root", position: "root" });
	};

	const handleRootDrop = (e: React.DragEvent<HTMLDivElement>) => {
		const raw = e.dataTransfer.getData(CHAT_DRAG_TYPE);
		if (!raw) return;
		e.preventDefault();
		e.stopPropagation();

		let payload: DraggedItemPayload;
		try {
			payload = JSON.parse(raw) as DraggedItemPayload;
		} catch {
			return;
		}

		setDropTarget(null);
		setDraggedItem(null);
		onMoveItem?.(payload.kind, payload.id, null);
	};

	const renderFolderContent = (folder: ChatFolder, depth: number): ReactNode => {
		const isSearch = isSearchActive && searchQuery.trim() !== "";
		const hasMatches = isSearch ? folderHasMatchingChat(folder.id, folders, chats, searchQuery) : true;
		if (isSearch && !hasMatches) {
			return null;
		}

		// When searching, folders with matches are automatically displayed as open
		const open = isSearch ? hasMatches : expandedFolderIds.has(folder.id);
		const count = getFolderChatCount(folder.id, folders, chats);

		// Child folders
		const childFolders = folders
			.filter((f) => f.parentId === folder.id)
			.sort((a, b) => {
				if (a.order !== undefined && b.order !== undefined) return a.order - b.order;
				if (a.order !== undefined) return -1;
				if (b.order !== undefined) return 1;
				return a.name.localeCompare(b.name);
			});

		// Child chats
		const childChats = chats.filter((c) => c.folderId === folder.id);
		const isSelected = selectedFolderId === folder.id;
		const isFolderDrop = dropTarget?.id === folder.id;

		return (
			<div
				key={folder.id}
				data-testid={`folder-container-${folder.id}`}
				className={cn("relative", depth === 0 && "mb-1 last:mb-0")}
			>
				{renamingFolderId === folder.id ? (
					<RenameFolderRow
						folder={folder}
						depth={depth}
						onCommit={(next) => onCommitFolderRename?.(folder.id, next)}
						onCancel={() => onCancelFolderRename?.()}
					/>
				) : (
					<ChatFolderRow
						folder={folder}
						depth={depth}
						isOpen={open}
						chatCount={count}
						selected={isSelected}
						dropIndicator={isFolderDrop ? dropTarget.position : null}
						onToggle={() => onToggleFolder(folder.id)}
						onSelect={() => onSelectFolder?.(isSelected ? null : folder.id)}
						onNewSession={onNewSessionInFolder ? () => onNewSessionInFolder(folder.id) : undefined}
						onContextMenu={onFolderContextMenu ? (e) => onFolderContextMenu(e, folder) : undefined}
						onOpenOptions={onFolderContextMenu ? (e) => onFolderContextMenu(e, folder) : undefined}
						onDragStart={(e) => handleDragStart(e, "folder", folder.id, folder.parentId, folder.name)}
						onDragEnd={handleDragEnd}
						onDragOver={(e) => handleFolderDragOver(e, folder)}
						onDragLeave={(e) => {
							if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
							if (dropTarget?.id === folder.id) setDropTarget(null);
						}}
						onDrop={(e) => handleFolderDrop(e, folder)}
					/>
				)}

				<CollapsibleFolderContent open={open}>
					<div className="relative">
						{childFolders.map((child) => renderFolderContent(child, depth + 1))}

						{childChats.map((c) => {
							const isChatDrop = dropTarget?.id === c.id;
							return renamingId === c.id ? (
								<div key={c.id} className="w-full">
									<RenameRow
										chat={c}
										style={{ paddingLeft: `${chatPaddingLeft(depth)}px` }}
										onCommit={(next) => onCommitRename?.(c.id, next)}
										onCancel={() => onCancelRename?.()}
									/>
								</div>
							) : (
								<div
									key={c.id}
									data-chat-drag-row={c.id}
									data-drop-position={isChatDrop ? dropTarget.position : undefined}
									draggable={true}
									onDragStart={(e) => handleDragStart(e, "chat", c.id, c.folderId, c.title)}
									onDragEnd={handleDragEnd}
									onDragOver={(e) => handleChatDragOver(e, c)}
									onDragLeave={(e) => {
										if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
										if (dropTarget?.id === c.id) setDropTarget(null);
									}}
									onDrop={(e) => handleChatDrop(e, c)}
									className={cn(
										"w-full",
										isChatDrop && dropTarget.position === "before" && "border-t-2 border-primary -mt-0.5",
										isChatDrop && dropTarget.position === "after" && "border-b-2 border-primary -mb-0.5",
									)}
								>
									<SessionRow
										chat={c}
										active={activeChatId === c.id}
										kbdSelected={kbdChatId === c.id}
										onOpen={() => onSelectChat(c.id)}
										onContextMenu={onContextMenuChat ? (e) => onContextMenuChat(e, c) : undefined}
										folderPath={isSearch ? getFolderPathString(c.folderId, folders) : undefined}
										style={{ paddingLeft: `${chatPaddingLeft(depth)}px` }}
									/>
								</div>
							);
						})}

						{!isSearch && childFolders.length === 0 && childChats.length === 0 && (
							<div
								data-testid={`empty-folder-${folder.id}`}
								style={{ paddingLeft: `${chatPaddingLeft(depth)}px` }}
								className="py-1 text-[11px] italic text-muted-foreground/60 select-none"
							>
								Empty folder
							</div>
						)}
					</div>
				</CollapsibleFolderContent>
			</div>
		);
	};

	const totalActiveChats = chats.length;
	if (totalActiveChats === 0 && topFolders.length === 0) {
		return <div className="px-3 py-4 text-xs text-muted-foreground">{emptyMessage}</div>;
	}

	return (
		<div className="flex flex-col gap-0.5">
			{/* Top-level folders */}
			{topFolders.map((f) => renderFolderContent(f, 0))}

			{/* Unorganized section for root-level chats (legacy / unplaced) */}
			{unorganizedChats.length > 0 && (
				<div data-testid="unorganized-section" className="mt-1">
					<div
						data-testid="unorganized-header"
						className="flex items-center justify-between px-2 py-1 text-xs text-muted-foreground"
					>
						<button
							type="button"
							aria-expanded={unorganizedExpanded}
							aria-label={`${unorganizedExpanded ? "Collapse" : "Expand"} Unorganized`}
							onClick={onToggleUnorganized}
							className="flex items-center gap-1 font-medium text-muted-foreground/80 hover:text-foreground"
						>
							<ChevronRightIcon
								className={cn(
									"size-3 transition-transform duration-150",
									unorganizedExpanded && "rotate-90",
								)}
							/>
							<span>Unorganized</span>
						</button>
						<span className="text-[10px] tabular-nums text-muted-foreground/60">
							{unorganizedChats.length}
						</span>
					</div>

					{unorganizedExpanded &&
						unorganizedChats.map((c) => {
							const isChatDrop = dropTarget?.id === c.id;
							return renamingId === c.id ? (
								<RenameRow
									key={c.id}
									chat={c}
									onCommit={(next) => onCommitRename?.(c.id, next)}
									onCancel={() => onCancelRename?.()}
								/>
							) : (
								<div
									key={c.id}
									data-chat-drag-row={c.id}
									data-drop-position={isChatDrop ? dropTarget.position : undefined}
									draggable={true}
									onDragStart={(e) => handleDragStart(e, "chat", c.id, c.folderId, c.title)}
									onDragEnd={handleDragEnd}
									onDragOver={(e) => handleChatDragOver(e, c)}
									onDragLeave={(e) => {
										if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
										if (dropTarget?.id === c.id) setDropTarget(null);
									}}
									onDrop={(e) => handleChatDrop(e, c)}
									className={cn(
										isChatDrop && dropTarget.position === "before" && "border-t-2 border-primary -mt-0.5",
										isChatDrop && dropTarget.position === "after" && "border-b-2 border-primary -mb-0.5",
									)}
								>
									<SessionRow
										chat={c}
										active={activeChatId === c.id}
										kbdSelected={kbdChatId === c.id}
										onOpen={() => onSelectChat(c.id)}
										onContextMenu={onContextMenuChat ? (e) => onContextMenuChat(e, c) : undefined}
										folderPath={isSearch ? getFolderPathString(c.folderId, folders) : undefined}
									/>
								</div>
							);
						})}
				</div>
			)}

			{/* Root drop zone affordance */}
			{onMoveItem && !isSearch && (
				<div
					data-testid="chat-root-drop"
					aria-label="Move outside folders"
					data-drop-active={dropTarget?.id === "root"}
					onDragOver={handleRootDragOver}
					onDragLeave={() => {
						if (dropTarget?.id === "root") setDropTarget(null);
					}}
					onDrop={handleRootDrop}
					className={cn(
						"transition-all",
						draggedItem !== null || dropTarget?.id === "root"
							? "mt-2 min-h-9 flex items-center justify-center rounded-md border-2 border-dashed border-border/80 bg-accent/20 px-3 py-2 text-center text-[11px] text-muted-foreground"
							: "h-0 min-h-0 border-0 p-0 m-0 overflow-hidden opacity-0 pointer-events-none",
						dropTarget?.id === "root" && "border-primary/90 bg-accent/40 text-foreground font-medium",
					)}
				>
					{(draggedItem !== null || dropTarget?.id === "root") && (
						<span>Move outside folders (top level)</span>
					)}
				</div>
			)}
		</div>
	);
}

/** The Archive browsing view: allows browsing archived folders and chats without restoring them. */
export function ArchiveView({
	folders,
	chats,
	activeChatId,
	onClose,
	onSelectChat,
	expandedFolderIds,
	onToggleFolder,
	onRestoreChat,
	onRestoreFolder,
	onContextMenuChat,
	onContextMenuFolder,
}: {
	folders: ChatFolder[];
	chats: ChatDirectoryItem[];
	activeChatId: string | null;
	onClose: () => void;
	onSelectChat: (chatId: string) => void;
	expandedFolderIds: ReadonlySet<string>;
	onToggleFolder: (folderId: string) => void;
	onRestoreChat?: (chatId: string) => void;
	onRestoreFolder?: (folderId: string) => void;
	onContextMenuChat?: (e: React.MouseEvent<HTMLButtonElement>, chat: ChatDirectoryItem) => void;
	onContextMenuFolder?: (e: React.MouseEvent<HTMLElement>, folder: ChatFolder) => void;
}) {
	const topFolders = useMemo(() => {
		return folders.filter((f) => f.parentId === null);
	}, [folders]);

	const unorganizedChats = useMemo(() => {
		return chats.filter((c) => c.folderId === null);
	}, [chats]);

	const renderArchiveFolder = (folder: ChatFolder, depth: number): ReactNode => {
		const open = expandedFolderIds.has(folder.id);
		const count = getFolderChatCount(folder.id, folders, chats);
		const childFolders = folders.filter((f) => f.parentId === folder.id);
		const childChats = chats.filter((c) => c.folderId === folder.id);

		return (
			<div key={folder.id} data-testid={`archive-folder-${folder.id}`} className="relative">
				<div
					className="group flex w-full items-center rounded-lg py-1.5 pr-2 transition-colors hover:bg-muted/30 cursor-pointer text-muted-foreground hover:text-foreground"
					style={{ paddingLeft: `${folderPaddingLeft(depth)}px` }}
					onClick={() => onToggleFolder(folder.id)}
					onContextMenu={onContextMenuFolder ? (e) => onContextMenuFolder(e, folder) : undefined}
				>
					<div className="flex items-center gap-1 shrink-0">
						<button
							type="button"
							aria-expanded={open}
							aria-label={`${open ? "Collapse" : "Expand"} folder ${folder.name}`}
							data-testid={`folder-toggle-${folder.id}`}
							onClick={(e) => {
								e.stopPropagation();
								onToggleFolder(folder.id);
							}}
							className="flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground/70 transition-transform hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
						>
							<ChevronRightIcon className={cn("size-3.5 transition-transform duration-150", open && "rotate-90")} />
						</button>

						<span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground/70">
							{open ? <FolderOpenIcon className="size-3.5" /> : <FolderIcon className="size-3.5" />}
						</span>
					</div>

					<span className="min-w-0 flex-1 truncate font-prose text-sm font-medium leading-snug text-muted-foreground/90 ml-1.5">
						{folder.name}
					</span>

					<span className="text-[10px] tabular-nums font-mono text-muted-foreground/60 shrink-0 select-none">{count}</span>

					{(onRestoreFolder || onContextMenuFolder) && (
						<div className="hidden group-hover:flex group-focus-within:flex items-center gap-1 shrink-0 ml-1">
							{onRestoreFolder && (
								<button
									type="button"
									data-testid={`restore-folder-${folder.id}`}
									aria-label={`Restore folder ${folder.name}`}
									onClick={(e) => {
										e.stopPropagation();
										onRestoreFolder(folder.id);
									}}
									className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground cursor-pointer"
								>
									<RotateCcwIcon className="size-3" />
									<span>Restore</span>
								</button>
							)}

							{onContextMenuFolder && (
								<button
									type="button"
									data-testid={`archive-folder-options-${folder.id}`}
									aria-label={`Options for archived folder ${folder.name}`}
									onClick={(e) => {
										e.stopPropagation();
										onContextMenuFolder(e, folder);
									}}
									className="flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground cursor-pointer"
								>
									<MoreVerticalIcon className="size-3" />
								</button>
							)}
						</div>
					)}
				</div>

				{open && (
					<div className="relative">
						{childFolders.map((child) => renderArchiveFolder(child, depth + 1))}
						{childChats.map((c) => (
							<div
								key={c.id}
								className="group relative flex items-center w-full"
							>
								<div className="flex-1 min-w-0">
									<SessionRow
										chat={c}
										active={activeChatId === c.id}
										onOpen={() => onSelectChat(c.id)}
										onContextMenu={onContextMenuChat ? (e) => onContextMenuChat(e, c) : undefined}
										folderPath={getFolderPathString(c.folderId, folders)}
										style={{ paddingLeft: `${chatPaddingLeft(depth)}px` }}
									/>
								</div>
								{onRestoreChat && (
									<button
										type="button"
										data-testid={`restore-chat-${c.id}`}
										aria-label={`Restore session ${c.title}`}
										onClick={(e) => {
											e.stopPropagation();
											onRestoreChat(c.id);
										}}
										className="absolute right-2 flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100 focus:opacity-100"
									>
										<RotateCcwIcon className="size-3" />
										<span>Restore</span>
									</button>
								)}
							</div>
						))}
						{childFolders.length === 0 && childChats.length === 0 && (
							<div
								data-testid={`empty-folder-${folder.id}`}
								style={{ paddingLeft: `${chatPaddingLeft(depth)}px` }}
								className="py-1 text-[11px] italic text-muted-foreground/50 select-none"
							>
								Empty folder
							</div>
						)}
					</div>
				)}
			</div>
		);
	};

	return (
		<div data-testid="archive-view" className="flex flex-col">
			{/* Archive Header */}
			<div className="flex items-center justify-between border-b border-border/40 pb-2 mb-2">
				<button
					type="button"
					data-testid="archive-back-button"
					aria-label="Back to active sessions"
					onClick={onClose}
					className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground cursor-pointer"
				>
					<ArrowLeftIcon className="size-3.5" />
					<span>Active sessions</span>
				</button>
				<span className="flex items-center gap-1 text-[11px] uppercase tracking-wider text-muted-foreground/70">
					<ArchiveIcon className="size-3" />
					Archive
				</span>
			</div>

			<div className="mb-2 rounded-md bg-muted/40 px-2.5 py-1.5 text-[11px] leading-relaxed text-muted-foreground">
				Browsing archived chats. Viewing does not restore them.
			</div>

			{folders.length === 0 && chats.length === 0 ? (
				<div className="py-4 text-center text-xs text-muted-foreground">No archived sessions.</div>
			) : (
				<div className="flex flex-col gap-0.5">
					{topFolders.map((f) => renderArchiveFolder(f, 0))}

					{unorganizedChats.length > 0 && (
						<div data-testid="unorganized-archive-section" className="mt-1">
							<div className="px-2 py-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
								Unorganized
							</div>
							{unorganizedChats.map((c) => (
								<div key={c.id} className="group relative flex items-center pr-2">
									<div className="flex-1 min-w-0">
										<SessionRow
											chat={c}
											active={activeChatId === c.id}
											onOpen={() => onSelectChat(c.id)}
											onContextMenu={onContextMenuChat ? (e) => onContextMenuChat(e, c) : undefined}
										/>
									</div>
									{onRestoreChat && (
										<button
											type="button"
											data-testid={`restore-chat-${c.id}`}
											aria-label={`Restore session ${c.title}`}
											onClick={(e) => {
												e.stopPropagation();
												onRestoreChat(c.id);
											}}
											className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100 focus:opacity-100"
										>
											<RotateCcwIcon className="size-3" />
											<span>Restore</span>
										</button>
									)}
								</div>
							))}
						</div>
					)}
				</div>
			)}
		</div>
	);
}
