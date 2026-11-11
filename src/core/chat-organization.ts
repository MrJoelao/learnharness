import type { ChatKind } from "./contracts/chat.ts";

/**
 * Chat organization is presentation metadata, separate from ChatRecord and graph files.
 * Moving or archiving chats/folders only updates metadata and never reads/writes
 * conversation transcripts or graph ledgers.
 */
export interface ChatFolder {
	id: string;
	name: string;
	parentId: string | null;
	createdAt: string;
	updatedAt?: string;
	archivedAt?: string | null;
	order?: number;
}

export interface ChatPlacement {
	folderId: string | null;
	archivedAt?: string | null;
	order?: number;
}

export interface ChatOrganization {
	version: 1;
	folders: ChatFolder[];
	placements: Record<string, ChatPlacement>;
}

export interface ChatDirectoryItem {
	id: string;
	title: string;
	kind?: ChatKind;
	createdAt: string;
	updatedAt: string;
	folderId: string | null;
	order?: number;
	archivedAt?: string | null;
	messageCount?: number;
	busy?: boolean;
	compacting?: boolean;
	pendingQuestion?: boolean;
	pendingProblem?: boolean;
}

export interface ChatDirectory {
	organization: ChatOrganization;
	chats: ChatDirectoryItem[];
}

export interface ArchivedChatDirectory {
	folders: ChatFolder[];
	chats: ChatDirectoryItem[];
}

export type ChatOrganizationAction =
	| { action: "create-folder"; name: string; parentId: string | null; order?: number }
	| { action: "rename-folder"; id: string; name: string }
	| { action: "delete-folder"; id: string }
	| { action: "move"; kind: "chat" | "folder"; id: string; parentId: string | null; targetOrder?: number }
	| { action: "reorder"; kind: "chat" | "folder"; id: string; targetOrder?: number; targetIndex?: number }
	| { action: "reorder-siblings"; parentId: string | null; kind: "chat" | "folder"; ids: string[] }
	| { action: "archive"; kind: "chat" | "folder"; id: string }
	| { action: "restore"; kind: "chat" | "folder"; id: string; targetParentId?: string | null };

export const emptyChatOrganization = (): ChatOrganization => ({
	version: 1,
	folders: [],
	placements: {},
});

export const chatPlacementOf = (state: ChatOrganization, id: string): ChatPlacement | undefined =>
	Object.hasOwn(state.placements, id) ? state.placements[id] : undefined;

export function chatFolderIsEmpty(
	state: ChatOrganization,
	id: string,
	chatIds: ReadonlySet<string>,
): boolean {
	const hasChildFolder = state.folders.some((f) => f.parentId === id);
	if (hasChildFolder) return false;

	// Check both active and known placed chats
	const hasPlacedChat = [...chatIds].some((chatId) => chatPlacementOf(state, chatId)?.folderId === id);
	if (hasPlacedChat) return false;

	// Also check any recorded placement pointing to this folder
	const hasRecordedPlacement = Object.values(state.placements).some((p) => p.folderId === id);
	if (hasRecordedPlacement) return false;

	return true;
}

/** Check if moving folder `id` into `parentId` is valid (no cycles, no moving into descendants). */
export function canMoveChatFolder(
	state: ChatOrganization,
	id: string,
	parentId: string | null,
): boolean {
	const seen = new Set<string>([id]);
	for (let next = parentId; next !== null;) {
		if (seen.has(next)) return false;
		seen.add(next);
		const folder = state.folders.find((f) => f.id === next);
		if (!folder) return false;
		next = folder.parentId;
	}
	return true;
}

/** Collect all descendant folder IDs of a folder (including the folder itself if inclusive). */
export function getFolderDescendantIds(
	state: ChatOrganization,
	folderId: string,
	inclusive = false,
): Set<string> {
	const result = new Set<string>();
	if (inclusive) result.add(folderId);

	const queue = [folderId];
	while (queue.length > 0) {
		const current = queue.shift()!;
		for (const f of state.folders) {
			if (f.parentId === current && !result.has(f.id)) {
				result.add(f.id);
				queue.push(f.id);
			}
		}
	}
	return result;
}

/** Reject unsupported/corrupt data rather than overwrite organization on a write. */
export function parseChatOrganization(raw: unknown): ChatOrganization {
	const fail = (reason?: string): never => {
		throw new Error(
			`Could not read chat organization. Its data is invalid or newer than this app.${reason ? ` (${reason})` : ""}`,
		);
	};
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail("not an object");
	const r = raw as Partial<ChatOrganization>;
	if (
		r.version !== 1 ||
		!Array.isArray(r.folders) ||
		!r.placements ||
		typeof r.placements !== "object" ||
		Array.isArray(r.placements)
	) {
		return fail("invalid version or structure");
	}

	const ids = new Set<string>();
	for (const f of r.folders) {
		if (
			!f ||
			typeof f.id !== "string" ||
			!f.id ||
			ids.has(f.id) ||
			typeof f.name !== "string" ||
			!f.name.trim() ||
			(f.parentId !== null && typeof f.parentId !== "string") ||
			typeof f.createdAt !== "string" ||
			(f.updatedAt !== undefined && typeof f.updatedAt !== "string") ||
			(f.archivedAt !== undefined && f.archivedAt !== null && typeof f.archivedAt !== "string") ||
			(f.order !== undefined && typeof f.order !== "number")
		) {
			return fail("invalid folder entry");
		}
		ids.add(f.id);
	}

	const state = r as ChatOrganization;
	for (const f of state.folders) {
		if (f.parentId !== null && !ids.has(f.parentId)) return fail(`missing parent folder ${f.parentId}`);
		if (!canMoveChatFolder(state, f.id, f.parentId)) return fail(`folder cycle detected on ${f.id}`);
	}

	for (const [id, p] of Object.entries(state.placements)) {
		if (
			!id ||
			!p ||
			typeof p !== "object" ||
			(p.folderId !== null && (typeof p.folderId !== "string" || !p.folderId)) ||
			(p.archivedAt !== undefined && p.archivedAt !== null && typeof p.archivedAt !== "string") ||
			(p.order !== undefined && typeof p.order !== "number")
		) {
			return fail("invalid placement");
		}
	}

	return state;
}

export function parseChatOrganizationAction(raw: unknown): ChatOrganizationAction {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		throw new Error("Invalid chat organization action.");
	}
	const r = raw as Record<string, unknown>;
	const id = () => {
		if (typeof r.id !== "string" || !r.id.trim()) {
			throw new Error("A chat or folder ID is required.");
		}
		return r.id.trim();
	};
	const name = () => {
		if (typeof r.name !== "string" || !r.name.trim()) {
			throw new Error("Name must be a non-empty string.");
		}
		return r.name.trim();
	};
	const parent = () => {
		if (r.parentId !== null && typeof r.parentId !== "string") {
			throw new Error("Invalid parent folder.");
		}
		return r.parentId;
	};

	switch (r.action) {
		case "create-folder": {
			const order = typeof r.order === "number" && !Number.isNaN(r.order) ? r.order : undefined;
			return { action: "create-folder", name: name(), parentId: parent(), ...(order !== undefined ? { order } : {}) };
		}
		case "rename-folder":
			return { action: "rename-folder", id: id(), name: name() };
		case "delete-folder":
			return { action: "delete-folder", id: id() };
		case "move": {
			if (r.kind !== "chat" && r.kind !== "folder") {
				throw new Error("Invalid move kind: expected 'chat' or 'folder'.");
			}
			const targetOrder = typeof r.targetOrder === "number" && !Number.isNaN(r.targetOrder) ? r.targetOrder : undefined;
			return { action: "move", kind: r.kind, id: id(), parentId: parent(), ...(targetOrder !== undefined ? { targetOrder } : {}) };
		}
		case "reorder": {
			if (r.kind !== "chat" && r.kind !== "folder") {
				throw new Error("Invalid reorder kind: expected 'chat' or 'folder'.");
			}
			// Support array of ids: reorder-siblings
			if (Array.isArray(r.ids)) {
				const ids = r.ids.map((item) => {
					if (typeof item !== "string" || !item.trim()) throw new Error("Invalid ID in ids list.");
					return item.trim();
				});
				return { action: "reorder-siblings", parentId: parent(), kind: r.kind, ids };
			}
			const targetOrder = typeof r.targetOrder === "number" && !Number.isNaN(r.targetOrder)
				? r.targetOrder
				: typeof r.order === "number" && !Number.isNaN(r.order)
					? r.order
					: undefined;
			const targetIndex = typeof r.targetIndex === "number" && !Number.isNaN(r.targetIndex) ? r.targetIndex : undefined;
			return {
				action: "reorder",
				kind: r.kind,
				id: id(),
				...(targetOrder !== undefined ? { targetOrder } : {}),
				...(targetIndex !== undefined ? { targetIndex } : {}),
			};
		}
		case "reorder-siblings": {
			if (r.kind !== "chat" && r.kind !== "folder") {
				throw new Error("Invalid reorder kind: expected 'chat' or 'folder'.");
			}
			if (!Array.isArray(r.ids) || !r.ids.every((x) => typeof x === "string" && x.trim())) {
				throw new Error("ids must be an array of non-empty strings.");
			}
			return { action: "reorder-siblings", parentId: parent(), kind: r.kind, ids: r.ids.map((x) => x.trim()) };
		}
		case "archive": {
			if (r.kind !== "chat" && r.kind !== "folder") {
				throw new Error("Invalid archive kind: expected 'chat' or 'folder'.");
			}
			return { action: "archive", kind: r.kind, id: id() };
		}
		case "restore": {
			if (r.kind !== "chat" && r.kind !== "folder") {
				throw new Error("Invalid restore kind: expected 'chat' or 'folder'.");
			}
			if (Object.hasOwn(r, "targetParentId") && r.targetParentId !== null && typeof r.targetParentId !== "string") {
				throw new Error("Invalid destination folder.");
			}
			const targetParentId = Object.hasOwn(r, "targetParentId") ? r.targetParentId as string | null : undefined;
			return { action: "restore", kind: r.kind, id: id(), ...(targetParentId !== undefined ? { targetParentId } : {}) };
		}
		default:
			throw new Error(`Unknown chat organization action: ${String(r.action)}`);
	}
}

/** Compute next sibling order for a parent folder. */
function nextSiblingOrder(
	state: ChatOrganization,
	parentId: string | null,
	kind: "folder" | "chat",
): number {
	if (kind === "folder") {
		const siblings = state.folders.filter((f) => f.parentId === parentId);
		const max = siblings.reduce((acc, f) => Math.max(acc, f.order ?? 0), -1);
		return max + 1;
	}
	const siblings = Object.values(state.placements).filter((p) => p.folderId === parentId);
	const max = siblings.reduce((acc, p) => Math.max(acc, p.order ?? 0), -1);
	return max + 1;
}

/**
 * Apply validated chat organization action to the state.
 * Returns a new cloned state with changes applied.
 */
export function applyChatOrganizationAction(
	state: ChatOrganization,
	action: ChatOrganizationAction,
	chatIds: ReadonlySet<string>,
	newFolder: { id: string; createdAt: string },
): ChatOrganization {
	const next = structuredClone(state);

	if ("parentId" in action && action.parentId !== null) {
		const parentFolder = next.folders.find((f) => f.id === action.parentId);
		if (!parentFolder) throw new Error("Parent folder no longer exists.");
		if (parentFolder.archivedAt && action.action !== "reorder-siblings") {
			throw new Error("Cannot add or move items into an archived folder.");
		}
	}

	if (action.action === "create-folder") {
		const order = action.order ?? nextSiblingOrder(next, action.parentId, "folder");
		next.folders.push({
			...newFolder,
			name: action.name,
			parentId: action.parentId,
			order,
		});
		return next;
	}

	if (action.action === "rename-folder") {
		const folder = next.folders.find((f) => f.id === action.id);
		if (!folder) throw new Error("Folder no longer exists.");
		folder.name = action.name;
		folder.updatedAt = new Date().toISOString();
		return next;
	}

	if (action.action === "delete-folder") {
		const folder = next.folders.find((f) => f.id === action.id);
		if (!folder) throw new Error("Folder no longer exists.");
		if (!chatFolderIsEmpty(next, action.id, chatIds)) {
			throw new Error("Only empty folders can be removed. Move their entries out first.");
		}
		next.folders = next.folders.filter((f) => f.id !== action.id);
		return next;
	}

	if (action.action === "move") {
		if (action.kind === "folder") {
			const folder = next.folders.find((f) => f.id === action.id);
			if (!folder) throw new Error("Folder no longer exists.");
			if (!canMoveChatFolder(next, action.id, action.parentId)) {
				throw new Error("A folder cannot be moved into itself or its descendants.");
			}
			folder.parentId = action.parentId;
			if (action.targetOrder !== undefined) {
				folder.order = action.targetOrder;
			}
			folder.updatedAt = new Date().toISOString();
			return next;
		}

		// kind === "chat"
		if (!chatIds.has(action.id) && !Object.hasOwn(next.placements, action.id)) {
			throw new Error("Chat no longer exists.");
		}
		const existing = chatPlacementOf(next, action.id);
		const order = action.targetOrder ?? existing?.order ?? nextSiblingOrder(next, action.parentId, "chat");
		next.placements = {
			...next.placements,
			[action.id]: {
				...existing,
				folderId: action.parentId,
				order,
			},
		};
		return next;
	}

	if (action.action === "reorder") {
		const targetOrder = action.targetOrder ?? action.targetIndex ?? 0;
		if (action.kind === "folder") {
			const folder = next.folders.find((f) => f.id === action.id);
			if (!folder) throw new Error("Folder no longer exists.");
			folder.order = targetOrder;
			folder.updatedAt = new Date().toISOString();
			return next;
		}

		// kind === "chat"
		if (!chatIds.has(action.id) && !Object.hasOwn(next.placements, action.id)) {
			throw new Error("Chat no longer exists.");
		}
		const existing = chatPlacementOf(next, action.id);
		next.placements = {
			...next.placements,
			[action.id]: {
				...existing,
				folderId: existing?.folderId ?? null,
				order: targetOrder,
			},
		};
		return next;
	}

	if (action.action === "reorder-siblings") {
		const idSet = new Set(action.ids);
		if (action.kind === "folder") {
			action.ids.forEach((folderId, index) => {
				const folder = next.folders.find((f) => f.id === folderId);
				if (folder && folder.parentId === action.parentId) {
					folder.order = index;
					folder.updatedAt = new Date().toISOString();
				}
			});
			return next;
		}

		// kind === "chat"
		action.ids.forEach((chatId, index) => {
			if (chatIds.has(chatId) || Object.hasOwn(next.placements, chatId)) {
				const existing = chatPlacementOf(next, chatId);
				// Reordering is scoped to the requested sibling group. A stale
				// undo must not move a chat that was moved elsewhere meanwhile.
				if ((existing?.folderId ?? null) !== action.parentId) return;
				next.placements[chatId] = {
					...existing,
					folderId: existing?.folderId ?? null,
					order: index,
				};
			}
		});
		return next;
	}

	if (action.action === "archive") {
		const now = new Date().toISOString();
		if (action.kind === "chat") {
			if (!chatIds.has(action.id) && !Object.hasOwn(next.placements, action.id)) {
				throw new Error("Chat no longer exists.");
			}
			const existing = chatPlacementOf(next, action.id);
			next.placements = {
				...next.placements,
				[action.id]: {
					...existing,
					folderId: existing?.folderId ?? null,
					archivedAt: now,
				},
			};
			return next;
		}

		// kind === "folder": archive the whole folder subtree!
		const targetFolder = next.folders.find((f) => f.id === action.id);
		if (!targetFolder) throw new Error("Folder no longer exists.");

		const descendantFolderIds = getFolderDescendantIds(next, action.id, true);

		// Archive folders
		for (const folder of next.folders) {
			if (descendantFolderIds.has(folder.id)) {
				folder.archivedAt = now;
				folder.updatedAt = now;
			}
		}

		// Archive chats in these folders
		for (const chatId of chatIds) {
			const p = chatPlacementOf(next, chatId);
			if (p && p.folderId && descendantFolderIds.has(p.folderId)) {
				next.placements[chatId] = {
					...p,
					archivedAt: now,
				};
			}
		}
		// Also archive any placements for known chats
		for (const [chatId, p] of Object.entries(next.placements)) {
			if (p.folderId && descendantFolderIds.has(p.folderId)) {
				next.placements[chatId] = {
					...p,
					archivedAt: now,
				};
			}
		}

		return next;
	}

	if (action.action === "restore") {
		if (action.kind === "chat") {
			if (!chatIds.has(action.id) && !Object.hasOwn(next.placements, action.id)) {
				throw new Error("Chat no longer exists.");
			}
			const existing = chatPlacementOf(next, action.id);
			let targetFolderId: string | null = null;

			if (action.targetParentId !== undefined) {
				if (action.targetParentId === null) {
					targetFolderId = null;
				} else {
					const destFolder = next.folders.find((f) => f.id === action.targetParentId);
					if (!destFolder) throw new Error("Destination folder no longer exists.");
					if (destFolder.archivedAt) throw new Error("Cannot restore into an archived folder.");
					targetFolderId = destFolder.id;
				}
			} else {
				// Default restore: retain hierarchy where possible
				const originalFolderId = existing?.folderId ?? null;
				if (originalFolderId === null) {
					targetFolderId = null;
				} else {
					const originalFolder = next.folders.find((f) => f.id === originalFolderId);
					if (!originalFolder) {
						// Original folder no longer exists at restore time: restore to Unorganized!
						targetFolderId = null;
					} else {
						targetFolderId = originalFolder.id;
						// Retain hierarchy: if parent folder is archived, unarchive it and ancestors
						if (originalFolder.archivedAt) {
							unarchiveFolderChain(next, originalFolder.id);
						}
					}
				}
			}

			next.placements = {
				...next.placements,
				[action.id]: {
					...existing,
					folderId: targetFolderId,
					archivedAt: null,
				},
			};
			return next;
		}

		// kind === "folder"
		const folder = next.folders.find((f) => f.id === action.id);
		if (!folder) throw new Error("Folder no longer exists.");

		// If restoring to targetParentId
		if (action.targetParentId !== undefined) {
			if (action.targetParentId === null) {
				folder.parentId = null;
			} else {
				const dest = next.folders.find((f) => f.id === action.targetParentId);
				if (!dest) throw new Error("Destination folder no longer exists.");
				if (!canMoveChatFolder(next, folder.id, dest.id)) {
					throw new Error("A folder cannot be restored into itself or its descendants.");
				}
				if (dest.archivedAt) throw new Error("Cannot restore into an archived folder.");
				folder.parentId = dest.id;
			}
		} else if (folder.parentId !== null) {
			// Check if parent folder still exists
			const parentFolder = next.folders.find((f) => f.id === folder.parentId);
			if (!parentFolder) {
				// Original parent folder no longer exists: restore to root
				folder.parentId = null;
			} else if (parentFolder.archivedAt) {
				// Unarchive parent hierarchy to retain tree structure
				unarchiveFolderChain(next, parentFolder.id);
			}
		}

		// Unarchive the folder and all its descendant folders
		const descendantFolderIds = getFolderDescendantIds(next, folder.id, true);
		for (const f of next.folders) {
			if (descendantFolderIds.has(f.id)) {
				f.archivedAt = null;
				f.updatedAt = new Date().toISOString();
			}
		}

		// Also unarchive chats that belong to this folder or its descendant subfolders
		for (const [chatId, p] of Object.entries(next.placements)) {
			if (p.folderId && descendantFolderIds.has(p.folderId) && p.archivedAt) {
				next.placements[chatId] = {
					...p,
					archivedAt: null,
				};
			}
		}

		return next;
	}

	return next;
}

/** Recursively unarchive a folder and all its ancestor folders. */
function unarchiveFolderChain(state: ChatOrganization, folderId: string): void {
	let current: string | null = folderId;
	const seen = new Set<string>();
	while (current !== null && !seen.has(current)) {
		seen.add(current);
		const folder = state.folders.find((f) => f.id === current);
		if (!folder) break;
		folder.archivedAt = null;
		folder.updatedAt = new Date().toISOString();
		current = folder.parentId;
	}
}

/** Determine whether a chat is archived, either explicitly or via an archived parent folder. */
export function isChatArchived(state: ChatOrganization, chatId: string): boolean {
	const p = chatPlacementOf(state, chatId);
	if (p?.archivedAt) return true;
	if (p?.folderId) {
		const folder = state.folders.find((f) => f.id === p.folderId);
		if (folder?.archivedAt) return true;
	}
	return false;
}
