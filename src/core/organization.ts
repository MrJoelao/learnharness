/**
 * Organization v2 — shared directory for chats and workspaces.
 *
 * Key design decisions:
 * - Item placement keys are typed: "chat:<id>" or "workspace:<id>".
 * - Folders are type-agnostic; item type lives in the placement key.
 * - ChatOrganization v1 is migrated lazily on first write.
 * - This module contains only pure logic (no fs, no network).
 */

import type { ChatFolder } from "./chat-organization.ts";

// ─── Item identity ───────────────────────────────────────────────────────────

export type ChatItemKey = `chat:${string}`;
export type WorkspaceItemKey = `workspace:${string}`;
export type ItemKey = ChatItemKey | WorkspaceItemKey;

export function chatKey(id: string): ChatItemKey {
	if (!id) throw new Error("Chat ID must be non-empty.");
	return `chat:${id}`;
}

export function workspaceKey(id: string): WorkspaceItemKey {
	if (!id) throw new Error("Workspace ID must be non-empty.");
	return `workspace:${id}`;
}

/**
 * Parse a raw string as an ItemKey.
 * Returns the typed key or null if the string is not a valid ItemKey.
 */
export function parseItemKey(raw: string): ItemKey | null {
	if (typeof raw !== "string") return null;
	if (raw.startsWith("chat:") && raw.length > 5) return raw as ChatItemKey;
	if (raw.startsWith("workspace:") && raw.length > 10) return raw as WorkspaceItemKey;
	return null;
}

export function itemKeyKind(key: ItemKey): "chat" | "workspace" {
	return key.startsWith("chat:") ? "chat" : "workspace";
}

export function itemKeyId(key: ItemKey): string {
	return key.startsWith("chat:") ? key.slice(5) : key.slice(10);
}

// ─── Schema ──────────────────────────────────────────────────────────────────

export interface ItemPlacement {
	folderId: string | null;
	archivedAt?: string | null;
	order?: number;
}

/**
 * Organization v2 schema.
 * placements keys are ItemKey strings ("chat:<id>" | "workspace:<id>").
 * Folders are identical to ChatFolder in v1.
 */
export interface OrganizationV2 {
	version: 2;
	folders: ChatFolder[];
	placements: Record<string, ItemPlacement>;
}

export const emptyOrganizationV2 = (): OrganizationV2 => ({
	version: 2,
	folders: [],
	placements: {},
});

// ─── Action types ─────────────────────────────────────────────────────────────

export type OrganizationItemKind = "chat" | "workspace" | "folder";

export type OrganizationAction =
	| { action: "create-folder"; name: string; parentId: string | null; order?: number }
	| { action: "rename-folder"; id: string; name: string }
	| { action: "delete-folder"; id: string }
	| {
			action: "move";
			kind: "chat" | "workspace" | "folder";
			id: string;
			parentId: string | null;
			targetOrder?: number;
	  }
	| {
			action: "reorder";
			kind: "chat" | "workspace" | "folder";
			id: string;
			targetOrder?: number;
			targetIndex?: number;
	  }
	| {
			action: "reorder-siblings";
			parentId: string | null;
			kind: "chat" | "workspace" | "folder";
			ids: string[];
	  }
	| { action: "archive"; kind: "chat" | "workspace" | "folder"; id: string }
	| {
			action: "restore";
			kind: "chat" | "workspace" | "folder";
			id: string;
			targetParentId?: string | null;
	  };

// ─── Parsing and validation ───────────────────────────────────────────────────

export function parseOrganizationV2(raw: unknown): OrganizationV2 {
	const fail = (reason?: string): never => {
		throw new Error(
			`Could not read organization. Its data is invalid or newer than this app.${reason ? ` (${reason})` : ""}`,
		);
	};
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail("not an object");
	const r = raw as Partial<OrganizationV2>;
	if (
		r.version !== 2 ||
		!Array.isArray(r.folders) ||
		!r.placements ||
		typeof r.placements !== "object" ||
		Array.isArray(r.placements)
	) {
		return fail("invalid version or structure");
	}

	const folderIds = new Set<string>();
	for (const f of r.folders) {
		if (
			!f ||
			typeof f.id !== "string" ||
			!f.id ||
			folderIds.has(f.id) ||
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
		folderIds.add(f.id);
	}

	// Validate folder references and cycles
	for (const f of r.folders) {
		if (f.parentId !== null && !folderIds.has(f.parentId)) {
			return fail(`missing parent folder ${f.parentId}`);
		}
	}
	// Cycle check using canMoveFolderV2
	for (const f of r.folders) {
		if (!canMoveFolderV2(r as OrganizationV2, f.id, f.parentId)) {
			return fail(`folder cycle detected on ${f.id}`);
		}
	}

	for (const [key, p] of Object.entries(r.placements)) {
		// All keys must be valid ItemKeys
		if (!key || parseItemKey(key) === null) {
			return fail(`invalid placement key: ${key}`);
		}
		if (
			!p ||
			typeof p !== "object" ||
			(p.folderId !== null && (typeof p.folderId !== "string" || !p.folderId)) ||
			(p.archivedAt !== undefined && p.archivedAt !== null && typeof p.archivedAt !== "string") ||
			(p.order !== undefined && typeof p.order !== "number")
		) {
			return fail("invalid placement");
		}
	}

	return r as OrganizationV2;
}

export function parseOrganizationAction(raw: unknown): OrganizationAction {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		throw new Error("Invalid organization action.");
	}
	const r = raw as Record<string, unknown>;

	const id = () => {
		if (typeof r.id !== "string" || !r.id.trim()) {
			throw new Error("An item or folder ID is required.");
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
		return r.parentId as string | null;
	};
	const itemKind = (context: string) => {
		if (r.kind !== "chat" && r.kind !== "workspace" && r.kind !== "folder") {
			throw new Error(`Invalid ${context} kind: expected 'chat', 'workspace', or 'folder'.`);
		}
		return r.kind as "chat" | "workspace" | "folder";
	};

	switch (r.action) {
		case "create-folder": {
			const order = typeof r.order === "number" && !Number.isNaN(r.order) ? r.order : undefined;
			return {
				action: "create-folder",
				name: name(),
				parentId: parent(),
				...(order !== undefined ? { order } : {}),
			};
		}
		case "rename-folder":
			return { action: "rename-folder", id: id(), name: name() };
		case "delete-folder":
			return { action: "delete-folder", id: id() };
		case "move": {
			const kind = itemKind("move");
			const targetOrder =
				typeof r.targetOrder === "number" && !Number.isNaN(r.targetOrder) ? r.targetOrder : undefined;
			return {
				action: "move",
				kind,
				id: id(),
				parentId: parent(),
				...(targetOrder !== undefined ? { targetOrder } : {}),
			};
		}
		case "reorder": {
			const kind = itemKind("reorder");
			// Support array of ids: reorder-siblings
			if (Array.isArray(r.ids)) {
				const ids = r.ids.map((item) => {
					if (typeof item !== "string" || !item.trim()) throw new Error("Invalid ID in ids list.");
					return item.trim();
				});
				return { action: "reorder-siblings", parentId: parent(), kind, ids };
			}
			const targetOrder =
				typeof r.targetOrder === "number" && !Number.isNaN(r.targetOrder)
					? r.targetOrder
					: typeof r.order === "number" && !Number.isNaN(r.order)
						? r.order
						: undefined;
			const targetIndex =
				typeof r.targetIndex === "number" && !Number.isNaN(r.targetIndex) ? r.targetIndex : undefined;
			return {
				action: "reorder",
				kind,
				id: id(),
				...(targetOrder !== undefined ? { targetOrder } : {}),
				...(targetIndex !== undefined ? { targetIndex } : {}),
			};
		}
		case "reorder-siblings": {
			const kind = itemKind("reorder");
			if (!Array.isArray(r.ids) || !r.ids.every((x) => typeof x === "string" && (x as string).trim())) {
				throw new Error("ids must be an array of non-empty strings.");
			}
			return {
				action: "reorder-siblings",
				parentId: parent(),
				kind,
				ids: (r.ids as string[]).map((x) => x.trim()),
			};
		}
		case "archive": {
			const kind = itemKind("archive");
			return { action: "archive", kind, id: id() };
		}
		case "restore": {
			const kind = itemKind("restore");
			if (
				Object.hasOwn(r, "targetParentId") &&
				r.targetParentId !== null &&
				typeof r.targetParentId !== "string"
			) {
				throw new Error("Invalid destination folder.");
			}
			const targetParentId = Object.hasOwn(r, "targetParentId")
				? (r.targetParentId as string | null)
				: undefined;
			return {
				action: "restore",
				kind,
				id: id(),
				...(targetParentId !== undefined ? { targetParentId } : {}),
			};
		}
		default:
			throw new Error(`Unknown organization action: ${String(r.action)}`);
	}
}

// ─── Migration v1 → v2 ───────────────────────────────────────────────────────

/**
 * Migrate a v1 ChatOrganization to OrganizationV2.
 * All existing placement keys get the "chat:" prefix.
 * Folders, hierarchy, ordering and archive timestamps are preserved verbatim.
 * Invalid v1 placement entries are skipped with a console warning.
 */
export function migrateV1toV2(v1: {
	version: 1;
	folders: ChatFolder[];
	placements: Record<string, unknown>;
}): OrganizationV2 {
	const placements: Record<string, ItemPlacement> = {};
	for (const [rawId, raw] of Object.entries(v1.placements)) {
		if (!rawId) continue;
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
			console.warn(`[organization] skipping corrupt v1 placement for key "${rawId}"`);
			continue;
		}
		const p = raw as Record<string, unknown>;
		const folderId =
			p.folderId === null
				? null
				: typeof p.folderId === "string" && p.folderId
					? p.folderId
					: null;
		const archivedAt =
			p.archivedAt === null
				? null
				: typeof p.archivedAt === "string"
					? p.archivedAt
					: undefined;
		const order = typeof p.order === "number" && !Number.isNaN(p.order) ? p.order : undefined;
		const key = chatKey(rawId);
		placements[key] = {
			folderId,
			...(archivedAt !== undefined ? { archivedAt } : {}),
			...(order !== undefined ? { order } : {}),
		};
	}
	return {
		version: 2,
		folders: v1.folders,
		placements,
	};
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function placementOf(state: OrganizationV2, key: ItemKey): ItemPlacement | undefined {
	return Object.hasOwn(state.placements, key) ? state.placements[key] : undefined;
}

export function canMoveFolderV2(
	state: { folders: ChatFolder[] },
	id: string,
	parentId: string | null,
): boolean {
	const seen = new Set<string>([id]);
	for (let next = parentId; next !== null; ) {
		if (seen.has(next)) return false;
		seen.add(next);
		const folder = state.folders.find((f) => f.id === next);
		if (!folder) return false;
		next = folder.parentId;
	}
	return true;
}

export function getFolderDescendantIdsV2(
	state: { folders: ChatFolder[] },
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

/**
 * A folder is empty only when it has no child folders AND no item placements
 * in it — regardless of item kind.
 */
export function folderIsEmpty(
	state: OrganizationV2,
	folderId: string,
	knownItemKeys: ReadonlySet<ItemKey>,
): boolean {
	const hasChildFolder = state.folders.some((f) => f.parentId === folderId);
	if (hasChildFolder) return false;

	for (const key of knownItemKeys) {
		if (placementOf(state, key)?.folderId === folderId) return false;
	}
	// Also check any recorded placements (covers orphan/legacy entries)
	const hasRecordedPlacement = Object.values(state.placements).some((p) => p.folderId === folderId);
	if (hasRecordedPlacement) return false;

	return true;
}

function nextSiblingOrderV2(
	state: OrganizationV2,
	parentId: string | null,
	kind: "folder" | "item",
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

function unarchiveFolderChainV2(state: OrganizationV2, folderId: string): void {
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

// ─── Apply action ─────────────────────────────────────────────────────────────

/**
 * Apply a validated OrganizationAction to the state.
 * Returns a new cloned state with the changes applied.
 *
 * @param itemKeys - Set of all known ItemKeys (chat + workspace), used to
 *   validate that an item exists before moving/archiving/restoring it.
 */
export function applyOrganizationAction(
	state: OrganizationV2,
	action: OrganizationAction,
	itemKeys: ReadonlySet<ItemKey>,
	newFolder: { id: string; createdAt: string },
): OrganizationV2 {
	const next = structuredClone(state);

	// Guard: target parent must exist and must not be archived (unless reorder-siblings)
	if ("parentId" in action && action.parentId !== null) {
		const parentFolder = next.folders.find((f) => f.id === action.parentId);
		if (!parentFolder) throw new Error("Parent folder no longer exists.");
		if (parentFolder.archivedAt && action.action !== "reorder-siblings") {
			throw new Error("Cannot add or move items into an archived folder.");
		}
	}

	// ── Folder actions ──────────────────────────────────────────────────────

	if (action.action === "create-folder") {
		const order = action.order ?? nextSiblingOrderV2(next, action.parentId, "folder");
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
		if (!folderIsEmpty(next, action.id, itemKeys)) {
			throw new Error("Cannot delete a folder that still contains items.");
		}
		next.folders = next.folders.filter((f) => f.id !== action.id);
		return next;
	}

	// ── Item + folder move/reorder ──────────────────────────────────────────

	if (action.action === "move") {
		if (action.kind === "folder") {
			const folder = next.folders.find((f) => f.id === action.id);
			if (!folder) throw new Error("Folder no longer exists.");
			if (!canMoveFolderV2(next, action.id, action.parentId)) {
				throw new Error("A folder cannot be moved into itself or its descendants.");
			}
			folder.parentId = action.parentId;
			if (action.targetOrder !== undefined) folder.order = action.targetOrder;
			folder.updatedAt = new Date().toISOString();
			return next;
		}

		// kind === "chat" | "workspace"
		const key = action.kind === "chat" ? chatKey(action.id) : workspaceKey(action.id);
		if (!itemKeys.has(key) && !Object.hasOwn(next.placements, key)) {
			throw new Error(`${action.kind === "chat" ? "Chat" : "Workspace"} no longer exists.`);
		}
		const existing = placementOf(next, key);
		const order =
			action.targetOrder ?? existing?.order ?? nextSiblingOrderV2(next, action.parentId, "item");
		next.placements = {
			...next.placements,
			[key]: { ...existing, folderId: action.parentId, order },
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
		const key = action.kind === "chat" ? chatKey(action.id) : workspaceKey(action.id);
		if (!itemKeys.has(key) && !Object.hasOwn(next.placements, key)) {
			throw new Error(`${action.kind === "chat" ? "Chat" : "Workspace"} no longer exists.`);
		}
		const existing = placementOf(next, key);
		next.placements = {
			...next.placements,
			[key]: { ...existing, folderId: existing?.folderId ?? null, order: targetOrder },
		};
		return next;
	}

	if (action.action === "reorder-siblings") {
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
		// kind === "chat" | "workspace"
		action.ids.forEach((rawId, index) => {
			const key = action.kind === "chat" ? chatKey(rawId) : workspaceKey(rawId);
			if (itemKeys.has(key) || Object.hasOwn(next.placements, key)) {
				const existing = placementOf(next, key);
				// Scoped to the requested sibling group only
				if ((existing?.folderId ?? null) !== action.parentId) return;
				next.placements[key] = {
					...existing,
					folderId: existing?.folderId ?? null,
					order: index,
				};
			}
		});
		return next;
	}

	// ── Archive ─────────────────────────────────────────────────────────────

	if (action.action === "archive") {
		const now = new Date().toISOString();

		if (action.kind === "chat" || action.kind === "workspace") {
			const key = action.kind === "chat" ? chatKey(action.id) : workspaceKey(action.id);
			if (!itemKeys.has(key) && !Object.hasOwn(next.placements, key)) {
				throw new Error(`${action.kind === "chat" ? "Chat" : "Workspace"} no longer exists.`);
			}
			const existing = placementOf(next, key);
			next.placements = {
				...next.placements,
				[key]: { ...existing, folderId: existing?.folderId ?? null, archivedAt: now },
			};
			return next;
		}

		// kind === "folder": archive the whole subtree
		const targetFolder = next.folders.find((f) => f.id === action.id);
		if (!targetFolder) throw new Error("Folder no longer exists.");
		const descendantFolderIds = getFolderDescendantIdsV2(next, action.id, true);

		for (const folder of next.folders) {
			if (descendantFolderIds.has(folder.id)) {
				folder.archivedAt = now;
				folder.updatedAt = now;
			}
		}
		// Archive all items in those folders (all kinds)
		for (const [key, p] of Object.entries(next.placements)) {
			if (p.folderId && descendantFolderIds.has(p.folderId)) {
				next.placements[key] = { ...p, archivedAt: now };
			}
		}
		return next;
	}

	// ── Restore ──────────────────────────────────────────────────────────────

	if (action.action === "restore") {
		if (action.kind === "chat" || action.kind === "workspace") {
			const key = action.kind === "chat" ? chatKey(action.id) : workspaceKey(action.id);
			if (!itemKeys.has(key) && !Object.hasOwn(next.placements, key)) {
				throw new Error(`${action.kind === "chat" ? "Chat" : "Workspace"} no longer exists.`);
			}
			const existing = placementOf(next, key);
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
				const originalFolderId = existing?.folderId ?? null;
				if (originalFolderId === null) {
					targetFolderId = null;
				} else {
					const originalFolder = next.folders.find((f) => f.id === originalFolderId);
					if (!originalFolder) {
						targetFolderId = null;
					} else {
						targetFolderId = originalFolder.id;
						if (originalFolder.archivedAt) {
							unarchiveFolderChainV2(next, originalFolder.id);
						}
					}
				}
			}

			next.placements = {
				...next.placements,
				[key]: { ...existing, folderId: targetFolderId, archivedAt: null },
			};
			return next;
		}

		// kind === "folder"
		const folder = next.folders.find((f) => f.id === action.id);
		if (!folder) throw new Error("Folder no longer exists.");

		if (action.targetParentId !== undefined) {
			if (action.targetParentId === null) {
				folder.parentId = null;
			} else {
				const dest = next.folders.find((f) => f.id === action.targetParentId);
				if (!dest) throw new Error("Destination folder no longer exists.");
				if (!canMoveFolderV2(next, folder.id, dest.id)) {
					throw new Error("A folder cannot be restored into itself or its descendants.");
				}
				if (dest.archivedAt) throw new Error("Cannot restore into an archived folder.");
				folder.parentId = dest.id;
			}
		} else if (folder.parentId !== null) {
			const parentFolder = next.folders.find((f) => f.id === folder.parentId);
			if (!parentFolder) {
				folder.parentId = null;
			} else if (parentFolder.archivedAt) {
				unarchiveFolderChainV2(next, parentFolder.id);
			}
		}

		const descendantFolderIds = getFolderDescendantIdsV2(next, folder.id, true);
		for (const f of next.folders) {
			if (descendantFolderIds.has(f.id)) {
				f.archivedAt = null;
				f.updatedAt = new Date().toISOString();
			}
		}
		// Unarchive all items in restored folders (all kinds)
		for (const [key, p] of Object.entries(next.placements)) {
			if (p.folderId && descendantFolderIds.has(p.folderId) && p.archivedAt) {
				next.placements[key] = { ...p, archivedAt: null };
			}
		}

		return next;
	}

	return next;
}

// ─── V1-compat wire format helpers ───────────────────────────────────────────

/**
 * Extract only chat placements from a v2 state and return them with bare IDs
 * (i.e., strip the "chat:" prefix) for backward compatibility with v1 consumers.
 */
export function chatPlacementsV1Compat(state: OrganizationV2): Record<string, ItemPlacement> {
	const result: Record<string, ItemPlacement> = {};
	for (const [key, p] of Object.entries(state.placements)) {
		if (key.startsWith("chat:") && key.length > 5) {
			result[key.slice(5)] = p;
		}
	}
	return result;
}

/**
 * Build a "v1-compat" ChatOrganization view from an OrganizationV2 state.
 * Used to keep /api/chats/organization returning the existing wire format.
 */
export function toV1CompatOrganization(state: OrganizationV2): {
	version: 1;
	folders: ChatFolder[];
	placements: Record<string, ItemPlacement>;
} {
	return {
		version: 1,
		folders: state.folders,
		placements: chatPlacementsV1Compat(state),
	};
}
