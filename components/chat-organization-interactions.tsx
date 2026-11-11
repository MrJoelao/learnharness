"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
	FolderIcon,
	FolderOpenIcon,
	XIcon,
	Undo2Icon,
	AlertCircleIcon,
	CheckCircle2Icon,
} from "lucide-react";
import {
	canMoveChatFolder,
	chatPlacementOf,
	type ChatDirectoryItem,
	type ChatFolder,
	type ChatOrganization,
	type ChatOrganizationAction,
} from "@/src/core";
import { useBackdropDismiss } from "@/components/backdrop-dismiss";
import { cn } from "@/lib/utils";

export const CHAT_DRAG_TYPE = "application/x-learnharness-chat";

export interface DraggedItemPayload {
	kind: "chat" | "folder";
	id: string;
	parentId: string | null;
}

export type DropPosition = "inside" | "before" | "after" | "root";

export interface DropTargetState {
	id: string;
	kind: "folder" | "chat" | "root";
	position: DropPosition;
}

export interface OrganizationFeedback {
	type: "success" | "error";
	message: string;
	onUndo?: () => void;
}

export interface MoveTargetItem {
	kind: "chat" | "folder";
	id: string;
	title: string;
	parentId: string | null;
	isRestore?: boolean;
}

/** Pure: calculate whether cursor position means before, inside, or after. */
export function calculateDropPosition(
	offsetY: number,
	height: number,
	kind: "folder" | "chat",
): "before" | "after" | "inside" {
	if (kind === "folder") {
		if (offsetY < height * 0.25) return "before";
		if (offsetY > height * 0.75) return "after";
		return "inside";
	}
	return offsetY < height * 0.5 ? "before" : "after";
}

/**
 * Pure: compute inverse undo action for reversible operations.
 * Returns null for non-reversible operations like permanent deletions.
 */
export function computeUndoAction(
	action: ChatOrganizationAction,
	previousState: {
		organization: ChatOrganization;
		chats: ChatDirectoryItem[];
	},
): { undoAction: ChatOrganizationAction; description: string } | null {
	switch (action.action) {
		case "move": {
			if (action.kind === "folder") {
				const folder = previousState.organization.folders.find((f) => f.id === action.id);
				if (!folder) return null;
				const oldParentId = folder.parentId;
				const oldOrder = folder.order;
				return {
					undoAction: {
						action: "move",
						kind: "folder",
						id: action.id,
						parentId: oldParentId,
						...(oldOrder !== undefined ? { targetOrder: oldOrder } : {}),
					},
					description: `Moved folder "${folder.name}"`,
				};
			}
			const chat = previousState.chats.find((c) => c.id === action.id);
			const placement = chatPlacementOf(previousState.organization, action.id);
			const oldParentId = chat?.folderId ?? placement?.folderId ?? null;
			const oldOrder = chat?.order ?? placement?.order;
			return {
				undoAction: {
					action: "move",
					kind: "chat",
					id: action.id,
					parentId: oldParentId,
					...(oldOrder !== undefined ? { targetOrder: oldOrder } : {}),
				},
				description: `Moved session "${chat?.title ?? action.id}"`,
			};
		}
		case "reorder-siblings": {
			const siblings =
				action.kind === "folder"
					? previousState.organization.folders.filter((f) => f.parentId === action.parentId)
					: previousState.chats.filter((c) => c.folderId === action.parentId);
			const oldIds = siblings.map((s) => s.id);
			return {
				undoAction: {
					action: "reorder-siblings",
					parentId: action.parentId,
					kind: action.kind,
					ids: oldIds,
				},
				description: `Reordered ${action.kind}s`,
			};
		}
		case "reorder": {
			if (action.kind === "folder") {
				const folder = previousState.organization.folders.find((f) => f.id === action.id);
				if (!folder) return null;
				return {
					undoAction: {
						action: "reorder",
						kind: "folder",
						id: action.id,
						targetOrder: folder.order ?? 0,
					},
					description: `Reordered folder "${folder.name}"`,
				};
			}
			const chat = previousState.chats.find((c) => c.id === action.id);
			return {
				undoAction: {
					action: "reorder",
					kind: "chat",
					id: action.id,
					targetOrder: chat?.order ?? 0,
				},
				description: `Reordered session "${chat?.title ?? action.id}"`,
			};
		}
		case "archive": {
			if (action.kind === "folder") {
				const folder = previousState.organization.folders.find((f) => f.id === action.id);
				const oldParentId = folder?.parentId ?? null;
				return {
					undoAction: {
						action: "restore",
						kind: "folder",
						id: action.id,
						targetParentId: oldParentId,
					},
					description: `Archived folder "${folder?.name ?? action.id}"`,
				};
			}
			const chat = previousState.chats.find((c) => c.id === action.id);
			const placement = chatPlacementOf(previousState.organization, action.id);
			const oldParentId = chat?.folderId ?? placement?.folderId ?? null;
			return {
				undoAction: {
					action: "restore",
					kind: "chat",
					id: action.id,
					targetParentId: oldParentId,
				},
				description: `Archived session "${chat?.title ?? action.id}"`,
			};
		}
		case "restore": {
			if (action.kind === "folder") {
				const folder = previousState.organization.folders.find((f) => f.id === action.id);
				if (!folder || (action.targetParentId !== undefined && action.targetParentId !== folder.parentId)) return null;
				return {
					undoAction: {
						action: "archive",
						kind: "folder",
						id: action.id,
					},
					description: `Restored folder "${folder?.name ?? action.id}"`,
				};
			}
			const chat = previousState.chats.find((c) => c.id === action.id);
			const placement = chatPlacementOf(previousState.organization, action.id);
			const originalParentId = chat?.folderId ?? placement?.folderId ?? null;
			if (action.targetParentId !== undefined && action.targetParentId !== originalParentId) return null;
			if (originalParentId !== null && !previousState.organization.folders.some((f) => f.id === originalParentId)) return null;
			return {
				undoAction: {
					action: "archive",
					kind: "chat",
					id: action.id,
				},
				description: `Restored session "${chat?.title ?? action.id}"`,
			};
		}
		case "rename-folder": {
			const folder = previousState.organization.folders.find((f) => f.id === action.id);
			if (!folder) return null;
			return {
				undoAction: {
					action: "rename-folder",
					id: action.id,
					name: folder.name,
				},
				description: `Renamed folder to "${action.name}"`,
			};
		}
		case "delete-folder":
		default:
			// Permanent deletions cannot be undone!
			return null;
	}
}

/** Pure: helper to generate sibling move actions for keyboard/touch Move Up and Move Down. */
export function getSiblingMoveAction(
	kind: "chat" | "folder",
	id: string,
	direction: "up" | "down",
	organization: ChatOrganization,
	chats: ChatDirectoryItem[],
): ChatOrganizationAction | null {
	if (kind === "folder") {
		const target = organization.folders.find((f) => f.id === id);
		if (!target) return null;
		const parentId = target.parentId;
		const siblings = organization.folders
			.filter((f) => f.parentId === parentId)
			.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
		const idx = siblings.findIndex((f) => f.id === id);
		if (idx === -1) return null;
		const targetIdx = direction === "up" ? idx - 1 : idx + 1;
		if (targetIdx < 0 || targetIdx >= siblings.length) return null;

		const ids = siblings.map((s) => s.id);
		const temp = ids[idx]!;
		ids[idx] = ids[targetIdx]!;
		ids[targetIdx] = temp;
		return {
			action: "reorder-siblings",
			parentId,
			kind: "folder",
			ids,
		};
	}

	const targetChat = chats.find((c) => c.id === id);
	if (!targetChat) return null;
	const parentId = targetChat.folderId;
	const siblings = chats
		.filter((c) => c.folderId === parentId)
		.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
	const idx = siblings.findIndex((c) => c.id === id);
	if (idx === -1) return null;
	const targetIdx = direction === "up" ? idx - 1 : idx + 1;
	if (targetIdx < 0 || targetIdx >= siblings.length) return null;

	const ids = siblings.map((s) => s.id);
	const temp = ids[idx]!;
	ids[idx] = ids[targetIdx]!;
	ids[targetIdx] = temp;
	return {
		action: "reorder-siblings",
		parentId,
		kind: "chat",
		ids,
	};
}

/** Helper: create drag preview pill (mirrors SourceDragRow). */
export function setChatDragGhost(
	event: React.DragEvent,
	label: string,
	iconSvg?: SVGElement | null,
): void {
	if (typeof document === "undefined") return;
	const preview = document.createElement("div");
	preview.dataset.chatDragPreview = "";
	preview.className =
		"pointer-events-none fixed z-50 flex w-max max-w-72 items-center gap-1.5 rounded-md border border-border/70 bg-card px-2.5 py-1.5 text-xs font-medium text-foreground shadow-lg";
	preview.style.left = `${event.clientX - 12}px`;
	preview.style.top = `${event.clientY - 12}px`;
	if (iconSvg) {
		preview.appendChild(iconSvg.cloneNode(true));
	}
	const text = document.createElement("span");
	text.className = "truncate";
	text.textContent = label;
	preview.appendChild(text);
	document.body.appendChild(preview);
	event.dataTransfer.setDragImage(preview, 12, 12);
	requestAnimationFrame(() => preview.remove());
}

/** Pure body for MoveDestinationDialog, exported for SSR pins. */
export function MoveDestinationBody({
	item,
	folders,
	organization,
	onClose,
	onMove,
}: {
	item: MoveTargetItem;
	folders: ChatFolder[];
	organization: ChatOrganization | null;
	onClose: () => void;
	onMove: (targetParentId: string | null) => void;
}) {
	// Destination selector must list only active valid destination folders (never archived)
	const activeFolders = folders.filter((f) => !f.archivedAt);

	const getFolderDepth = (folderId: string): number => {
		let depth = 0;
		let current = activeFolders.find((f) => f.id === folderId)?.parentId ?? null;
		const seen = new Set<string>();
		while (current !== null && !seen.has(current)) {
			seen.add(current);
			depth++;
			current = activeFolders.find((f) => f.id === current)?.parentId ?? null;
		}
		return depth;
	};

	const sortedFolders = [...activeFolders].sort((a, b) => {
		const depthA = getFolderDepth(a.id);
		const depthB = getFolderDepth(b.id);
		if (depthA !== depthB) return depthA - depthB;
		return a.name.localeCompare(b.name);
	});

	const isCurrentParent = (folderId: string | null): boolean => !item.isRestore && item.parentId === folderId;

	const isValidDestination = (folderId: string | null): boolean => {
		if (!item.isRestore && folderId === item.parentId) return false;
		if (item.kind !== "folder") return true;
		if (folderId === null) return true;
		if (!organization) return true;
		return canMoveChatFolder(organization, item.id, folderId);
	};

	return (
		<div
			role="dialog"
			aria-modal="true"
			aria-label={`${item.isRestore ? "Restore" : "Move"} ${item.kind === "folder" ? "folder" : "session"}`}
			data-testid="move-destination-dialog"
			onClick={(e) => e.stopPropagation()}
			className="w-[28rem] max-w-[calc(100vw-2rem)] rounded-xl border bg-card p-5 shadow-xl"
		>
			<h2 className="text-sm font-semibold text-foreground">
				{item.isRestore ? "Restore" : "Move"} {item.kind === "folder" ? "folder" : "session"}
			</h2>
			<p className="mt-1 truncate font-mono text-xs text-muted-foreground">
				{item.title}
			</p>

			<div
				data-testid="move-destination-list"
				className="mt-4 max-h-60 overflow-y-auto rounded-lg border border-border/60 p-1 flex flex-col gap-0.5"
			>
				{/* Root destination option */}
				<button
					type="button"
					data-testid="move-destination-root"
					disabled={isCurrentParent(null)}
					onClick={() => onMove(null)}
					className={cn(
						"flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs text-left transition-colors",
						isCurrentParent(null)
							? "opacity-50 cursor-not-allowed text-muted-foreground"
							: "hover:bg-accent text-foreground cursor-pointer",
					)}
				>
					<span className="flex size-4 items-center justify-center text-muted-foreground">
						<FolderIcon className="size-3.5" />
					</span>
					<span className="font-medium">
						{item.kind === "folder" ? "Top level (Root)" : "Unorganized (Root)"}
					</span>
					{isCurrentParent(null) && (
						<span className="ml-auto text-[10px] text-muted-foreground/70">
							(current)
						</span>
					)}
				</button>

				{/* Folder destinations */}
				{sortedFolders.map((folder) => {
					const depth = getFolderDepth(folder.id);
					const valid = isValidDestination(folder.id);
					const current = isCurrentParent(folder.id);

					return (
						<button
							key={folder.id}
							type="button"
							data-testid={`move-destination-${folder.id}`}
							disabled={!valid || current}
							onClick={() => onMove(folder.id)}
							style={{ paddingLeft: `${10 + depth * 14}px` }}
							className={cn(
								"flex items-center gap-2 rounded-md py-1.5 pr-2.5 text-xs text-left transition-colors",
								!valid || current
									? "opacity-40 cursor-not-allowed text-muted-foreground"
									: "hover:bg-accent text-foreground cursor-pointer",
							)}
						>
							<span className="flex size-4 items-center justify-center text-muted-foreground">
								<FolderOpenIcon className="size-3.5" />
							</span>
							<span className="min-w-0 flex-1 truncate font-medium">
								{folder.name}
							</span>
							{current && (
								<span className="text-[10px] text-muted-foreground/70">
									(current)
								</span>
							)}
							{!valid && !current && (
								<span className="text-[10px] text-destructive/70">
									(invalid)
								</span>
							)}
						</button>
					);
				})}
			</div>

			<div className="mt-4 flex justify-end gap-2">
				<button
					type="button"
					data-testid="move-cancel"
					onClick={onClose}
					className="rounded-sm px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
				>
					Cancel
				</button>
			</div>
		</div>
	);
}

/**
 * Move Destination Dialog: accessible modal for choosing a destination folder
 * or the root / unorganized level. Disables/excludes invalid folder targets.
 */
export function MoveDestinationDialog({
	item,
	folders,
	organization,
	onClose,
	onMove,
}: {
	item: MoveTargetItem | null;
	folders: ChatFolder[];
	organization: ChatOrganization | null;
	onClose: () => void;
	onMove: (targetParentId: string | null) => void;
}) {
	const backdropDismiss = useBackdropDismiss(onClose);

	useEffect(() => {
		if (!item) return;
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault();
				e.stopPropagation();
				onClose();
			}
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [item, onClose]);

	if (!item) return null;

	if (typeof document === "undefined") {
		return (
			<MoveDestinationBody
				item={item}
				folders={folders}
				organization={organization}
				onClose={onClose}
				onMove={onMove}
			/>
		);
	}

	return createPortal(
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-background/80"
			{...backdropDismiss}
		>
			<MoveDestinationBody
				item={item}
				folders={folders}
				organization={organization}
				onClose={onClose}
				onMove={onMove}
			/>
		</div>,
		document.body,
	);
}

/** Pure body for DeleteFolderDialog, exported for SSR pins. */
export function DeleteFolderBody({
	folder,
	onClose,
	onConfirm,
}: {
	folder: ChatFolder;
	onClose: () => void;
	onConfirm: () => void;
}) {
	return (
		<div
			role="dialog"
			aria-modal="true"
			aria-label="Delete folder"
			data-testid="delete-folder-dialog"
			onClick={(e) => e.stopPropagation()}
			className="w-[28rem] max-w-[calc(100vw-2rem)] rounded-xl border bg-card p-5 shadow-xl"
		>
			<h2 className="text-sm font-semibold text-destructive">Delete folder?</h2>
			<div className="mt-1.5">
				<code
					data-testid="folder-name-code"
					className="font-mono text-sm text-foreground"
				>
					{folder.name}
				</code>
			</div>
			<p className="mt-2 text-sm text-muted-foreground">
				This permanently deletes this empty folder. This cannot be undone.
			</p>

			<div className="mt-4 flex justify-end gap-2">
				<button
					type="button"
					data-testid="delete-folder-cancel"
					onClick={onClose}
					className="rounded-sm px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
				>
					Cancel
				</button>
				<button
					type="button"
					data-testid="delete-folder-confirm"
					onClick={onConfirm}
					className="rounded-sm border border-destructive/50 bg-destructive/10 px-3 py-1.5 text-xs text-destructive transition-colors hover:bg-destructive/20"
				>
					Delete
				</button>
			</div>
		</div>
	);
}

/**
 * Delete Folder Dialog: explicit confirmation dialog for empty folders.
 * Does not offer undo (permanent deletion rule).
 */
export function DeleteFolderDialog({
	folder,
	onClose,
	onConfirm,
}: {
	folder: ChatFolder | null;
	onClose: () => void;
	onConfirm: () => void;
}) {
	const backdropDismiss = useBackdropDismiss(onClose);

	useEffect(() => {
		if (!folder) return;
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault();
				e.stopPropagation();
				onClose();
			}
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [folder, onClose]);

	if (!folder) return null;

	if (typeof document === "undefined") {
		return <DeleteFolderBody folder={folder} onClose={onClose} onConfirm={onConfirm} />;
	}

	return createPortal(
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-background/80"
			{...backdropDismiss}
		>
			<DeleteFolderBody folder={folder} onClose={onClose} onConfirm={onConfirm} />
		</div>,
		document.body,
	);
}

/**
 * Toast / Status notification banner with optional Undo action.
 */
export function OrganizationFeedbackToast({
	feedback,
	onDismiss,
}: {
	feedback: OrganizationFeedback | null;
	onDismiss: () => void;
}) {
	if (!feedback) return null;

	return (
		<div
			role={feedback.type === "error" ? "alert" : "status"}
			data-testid="organization-feedback"
			className={cn(
				"mx-3 mb-2 flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs shadow-md transition-all",
				feedback.type === "error"
					? "border-destructive/50 bg-destructive/10 text-destructive"
					: "border-border/70 bg-card text-foreground",
			)}
		>
			<div className="flex items-center gap-1.5 min-w-0 flex-1">
				{feedback.type === "error" ? (
					<AlertCircleIcon className="size-3.5 shrink-0 text-destructive" />
				) : (
					<CheckCircle2Icon className="size-3.5 shrink-0 text-emerald-500" />
				)}
				<span className="truncate">{feedback.message}</span>
			</div>
			{feedback.onUndo && (
				<button
					type="button"
					data-testid="undo-action-button"
					onClick={() => {
						feedback.onUndo?.();
						onDismiss();
					}}
					className="flex items-center gap-1 shrink-0 font-medium text-primary hover:underline underline-offset-2 transition-colors cursor-pointer"
				>
					<Undo2Icon className="size-3" />
					Undo
				</button>
			)}
			<button
				type="button"
				data-testid="dismiss-feedback-button"
				aria-label="Dismiss notification"
				onClick={onDismiss}
				className="shrink-0 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
			>
				<XIcon className="size-3" />
			</button>
		</div>
	);
}
