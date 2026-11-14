/**
 * DirectoryService — aggregates chats and workspaces into a single shared
 * organizational tree.
 *
 * Uses:
 * - ChatStore for chat summaries
 * - WorkspaceStore for workspace records
 * - OrganizationV2Store for placement metadata
 * - An availability resolver, wired to the live plugin host by
 *   src/server/plugins.ts once the host has initialized
 *
 * Does NOT:
 * - Read the filesystem directly
 * - Access plugin internal state
 * - Duplicate chat or workspace persistence
 * - Become a second source of truth for chat/workspace records
 */

import { randomUUID } from "node:crypto";
import {
	applyOrganizationAction,
	chatKey,
	parseOrganizationAction,
	workspaceKey,
	type ItemKey,
	type OrganizationV2,
} from "../core/organization.ts";
import {
	type ArchivedSharedDirectory,
	type ChatDirectoryEntry,
	type DirectoryEntry,
	type SharedDirectory,
	type WorkspaceDirectoryEntry,
} from "../core/directory.ts";
import type { ChatStore, WorkspaceStore } from "../core/ports.ts";
import type { WorkspaceAvailability, WorkspaceRecord } from "../core/workspaces.ts";
import type { OrganizationV2Store } from "../store/chat-organization.ts";
import { stores } from "./stores.ts";

// ─── Port ─────────────────────────────────────────────────────────────────────

/** Resolve the availability of a workspace given the current plugin state. */
export type WorkspaceAvailabilityResolver = (workspace: WorkspaceRecord) => WorkspaceAvailability;

export interface DirectoryServiceDeps {
	chatStore: ChatStore;
	workspaceStore: WorkspaceStore;
	organizationStore: OrganizationV2Store;
	resolveAvailability: WorkspaceAvailabilityResolver;
}

export class DirectoryInputError extends Error {}

// ─── Service ─────────────────────────────────────────────────────────────────

export function createDirectoryService(deps: DirectoryServiceDeps) {
	const freshFolder = () => ({
		id: `folder_${randomUUID()}`,
		createdAt: new Date().toISOString(),
	});

	function readOrganization(): OrganizationV2 {
		// Parse failures propagate: a corrupt organization file is a hard
		// failure (the same strategy as every other store) and is never
		// silently rewritten from an empty state.
		return deps.organizationStore.read();
	}

	function buildItems(
		org: OrganizationV2,
		options?: { includeArchived?: boolean },
	): DirectoryEntry[] {
		const folderIds = new Set(org.folders.map((f) => f.id));
		const items: DirectoryEntry[] = [];

		// ── Chats ──────────────────────────────────────────────────────────
		const chatSummaries = deps.chatStore.listChats();
		for (const s of chatSummaries) {
			const key = chatKey(s.id);
			const placement = org.placements[key];
			const archivedAt = placement?.archivedAt ?? null;
			// Resolve folderId: archived items keep their folder (for the archive
			// view); active items only keep their folder if it still exists.
			const folderId = archivedAt
				? (placement?.folderId ?? null)
				: (placement?.folderId && folderIds.has(placement.folderId) ? placement.folderId : null);

			const entry: ChatDirectoryEntry = {
				kind: "chat",
				id: s.id,
				title: s.title,
				chatKind: s.kind,
				createdAt: s.createdAt,
				updatedAt: s.updatedAt,
				folderId,
				order: placement?.order,
				archivedAt,
				messageCount: s.messageCount,
				pendingQuestion: s.pendingQuestion,
				pendingProblem: s.pendingProblem,
			};
			items.push(entry);
		}

		// ── Workspaces ────────────────────────────────────────────────────
		const wsDir = deps.workspaceStore.list();
		for (const ws of wsDir.workspaces) {
			const key = workspaceKey(ws.id);
			const placement = org.placements[key];
			const archivedAt = placement?.archivedAt ?? null;
			const folderId = archivedAt
				? (placement?.folderId ?? null)
				: (placement?.folderId && folderIds.has(placement.folderId) ? placement.folderId : null);

			// Availability failures never remove the item (R7): a workspace
			// stays visible with a conservative fallback availability.
			let availability: WorkspaceAvailability;
			try {
				availability = deps.resolveAvailability(ws);
			} catch {
				availability = "plugin-missing";
			}

			const entry: WorkspaceDirectoryEntry = {
				kind: "workspace",
				id: ws.id,
				title: ws.title,
				pluginId: ws.pluginId,
				modeId: ws.modeId,
				createdAt: ws.createdAt,
				updatedAt: ws.updatedAt,
				folderId,
				order: placement?.order,
				archivedAt,
				availability,
			};
			items.push(entry);
		}
		// Missing workspace records (index points to a missing/invalid file):
		// excluded from items; WorkspaceStore.list() surfaces them as issues
		// and never throws (R7).

		// ── Sort ───────────────────────────────────────────────────────────
		items.sort((a, b) => {
			if (a.order !== undefined && b.order !== undefined) {
				if (a.order !== b.order) return a.order - b.order;
			} else if (a.order !== undefined) {
				return -1;
			} else if (b.order !== undefined) {
				return 1;
			}
			const byUpdated = b.updatedAt.localeCompare(a.updatedAt);
			if (byUpdated !== 0) return byUpdated;
			const byKind = a.kind.localeCompare(b.kind);
			if (byKind !== 0) return byKind;
			return a.id.localeCompare(b.id);
		});

		if (!options?.includeArchived) {
			return items.filter((item) => !item.archivedAt);
		}
		return items;
	}

	function read(options?: { includeArchived?: boolean }): SharedDirectory {
		const org = readOrganization();
		const items = buildItems(org, options);
		return { organization: org, folders: org.folders, items };
	}

	function readArchived(): ArchivedSharedDirectory {
		const org = readOrganization();
		const allItems = buildItems(org, { includeArchived: true });
		return {
			archivedFolders: org.folders.filter((f) => Boolean(f.archivedAt)),
			activeFolders: org.folders.filter((f) => !f.archivedAt),
			items: allItems.filter((item) => Boolean(item.archivedAt)),
		};
	}

	function change(raw: unknown): SharedDirectory & { createdFolderId?: string } {
		let action;
		try {
			action = parseOrganizationAction(raw);
		} catch (error) {
			throw new DirectoryInputError((error as Error).message);
		}

		const org = readOrganization();

		// Build the full set of known item keys (chats + workspaces): the
		// shared folder rules must account for every kind (R3/R4).
		const itemKeys = new Set<ItemKey>([
			...deps.chatStore.listChats().map((s) => chatKey(s.id)),
			...deps.workspaceStore.list().workspaces.map((w) => workspaceKey(w.id)),
		]);

		const fresh = freshFolder();
		let next: OrganizationV2;
		try {
			next = applyOrganizationAction(org, action, itemKeys, fresh);
		} catch (error) {
			throw new DirectoryInputError((error as Error).message);
		}

		deps.organizationStore.write(next);
		const createdFolderId = action.action === "create-folder" ? fresh.id : undefined;
		return { ...read(), ...(createdFolderId ? { createdFolderId } : {}) };
	}

	/**
	 * Remove the placement for a specific item key.
	 * Called when a chat or workspace record is permanently deleted; the
	 * record itself and every other placement stay untouched (R5).
	 */
	function removePlacement(key: ItemKey): void {
		const org = deps.organizationStore.read();
		if (Object.hasOwn(org.placements, key)) {
			const next = { ...org, placements: { ...org.placements } };
			delete next.placements[key];
			deps.organizationStore.write(next);
		}
	}

	return { read, readArchived, change, removePlacement };
}

// ─── Availability wiring ─────────────────────────────────────────────────────

/**
 * The live availability resolver, configured once the plugin host has
 * initialized (src/server/plugins.ts). Until then every workspace reports
 * "plugin-missing" — a conservative fallback that keeps the item visible.
 */
let availabilityResolver: WorkspaceAvailabilityResolver = () => "plugin-missing";

/** Replace the availability resolver (called once after host initialization). */
export function configureDirectoryAvailabilityResolver(
	resolver: WorkspaceAvailabilityResolver,
): void {
	availabilityResolver = resolver;
}

/** The singleton directory service, wired to the production stores. */
export const directoryService = createDirectoryService({
	chatStore: stores.chatStore,
	workspaceStore: stores.workspaceStore,
	organizationStore: stores.organizationV2Store,
	resolveAvailability: (workspace) => availabilityResolver(workspace),
});

/**
 * Bound actual JSON bytes as well as declared size; never buffer an unbounded
 * operation body. Reuse the same streaming logic as the chat organization route.
 */
export async function readDirectoryAction(request: Request): Promise<unknown> {
	const limit = 64 * 1024;
	if (Number(request.headers.get("content-length")) > limit) {
		void request.body?.cancel().catch(() => undefined);
		throw new DirectoryInputError("Directory request is too large.");
	}
	const reader = request.body?.getReader();
	if (!reader) throw new DirectoryInputError("Missing directory action.");
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		for (;;) {
			const { value, done } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > limit) {
				throw new DirectoryInputError("Directory request is too large.");
			}
			chunks.push(value);
		}
		const bytes = new Uint8Array(total);
		let offset = 0;
		for (const chunk of chunks) {
			bytes.set(chunk, offset);
			offset += chunk.byteLength;
		}
		return JSON.parse(new TextDecoder().decode(bytes));
	} catch (error) {
		if (error instanceof DirectoryInputError) throw error;
		throw new DirectoryInputError("Could not read directory action.");
	} finally {
		void reader.cancel().catch(() => undefined);
		reader.releaseLock();
	}
}
