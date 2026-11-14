import { randomUUID } from "node:crypto";
import { stores } from "./stores.ts";
import type { ChatStore, WorkspaceStore } from "../core/ports.ts";
import {
	parseChatOrganizationAction,
	type ChatDirectory,
	type ChatDirectoryItem,
	type ChatFolder,
	type ChatOrganization,
} from "../core/chat-organization.ts";
import {
	applyOrganizationAction,
	chatKey,
	workspaceKey,
	type ItemKey,
	type OrganizationV2,
} from "../core/organization.ts";
import type { OrganizationV2Store } from "../store/chat-organization.ts";

export class ChatOrganizationInputError extends Error {}

/**
 * The chat organization surface keeps its v1 wire contract (bare chat IDs,
 * `chats: ChatDirectoryItem[]`) while the persisted organization is v2 (typed
 * item keys). Workspace placements recorded in the organization are preserved
 * on every read and write — they are only ever expressed through the shared
 * /api/directory surface (risk R2).
 */
export interface ChatDirectoryDeps {
	chatStore: ChatStore;
	/** Known workspaces join the shared folder rules (empty checks, subtree
	 * archive/restore) even on this chat-only surface — risks R3/R4. */
	workspaceStore: WorkspaceStore;
	organizationStore: OrganizationV2Store;
}

export function createChatDirectory(deps: ChatDirectoryDeps) {
	const freshFolder = () => ({
		id: `folder_${randomUUID()}`,
		createdAt: new Date().toISOString(),
	});

	/** V1 wire projection of the v2 organization: bare chat IDs, no workspaces. */
	function toV1Organization(org: OrganizationV2): ChatOrganization {
		const placements: ChatOrganization["placements"] = {};
		for (const [key, placement] of Object.entries(org.placements)) {
			if (key.startsWith("chat:") && key.length > 5) placements[key.slice(5)] = placement;
		}
		return { version: 1, folders: org.folders, placements };
	}

	function chatItems(org: OrganizationV2, options?: { includeArchived?: boolean }): ChatDirectoryItem[] {
		const folderIds = new Set(org.folders.map((f) => f.id));

		const items: ChatDirectoryItem[] = deps.chatStore.listChats().map((s) => {
			const placement = org.placements[chatKey(s.id)];
			const isArchived = Boolean(placement?.archivedAt);
			const folderId = isArchived
				? (placement?.folderId ?? null)
				: (placement?.folderId && folderIds.has(placement.folderId) ? placement.folderId : null);
			return {
				id: s.id,
				title: s.title,
				kind: s.kind,
				createdAt: s.createdAt,
				updatedAt: s.updatedAt,
				messageCount: s.messageCount,
				pendingQuestion: s.pendingQuestion,
				pendingProblem: s.pendingProblem,
				folderId,
				order: placement?.order,
				archivedAt: placement?.archivedAt ?? null,
			};
		});

		// Sort items by sibling order if specified, else updatedAt descending
		items.sort((a, b) => {
			if (a.order !== undefined && b.order !== undefined) {
				return a.order - b.order;
			}
			if (a.order !== undefined) return -1;
			if (b.order !== undefined) return 1;
			return b.updatedAt.localeCompare(a.updatedAt);
		});

		return options?.includeArchived ? items : items.filter((c) => !c.archivedAt);
	}

	function read(options?: { includeArchived?: boolean }): ChatDirectory {
		const org = deps.organizationStore.read();
		return { organization: toV1Organization(org), chats: chatItems(org, options) };
	}

	function readArchived(): { folders: ChatFolder[]; chats: ChatDirectoryItem[]; activeFolders: ChatFolder[] } {
		const org = deps.organizationStore.read();
		const chats = chatItems(org, { includeArchived: true });
		return {
			folders: org.folders.filter((f) => Boolean(f.archivedAt)),
			chats: chats.filter((c) => Boolean(c.archivedAt)),
			activeFolders: org.folders.filter((f) => !f.archivedAt),
		};
	}

	function change(raw: unknown): ChatDirectory & { createdFolderId?: string } {
		let action;
		let createdFolderId: string | undefined;

		try {
			action = parseChatOrganizationAction(raw);
		} catch (error) {
			throw new ChatOrganizationInputError((error as Error).message);
		}

		const org = deps.organizationStore.read();
		const fresh = freshFolder();
		const itemKeys = new Set<ItemKey>([
			...deps.chatStore.listChats().map((s) => chatKey(s.id)),
			...deps.workspaceStore.list().workspaces.map((w) => workspaceKey(w.id)),
		]);

		let next: OrganizationV2;
		try {
			next = applyOrganizationAction(org, action, itemKeys, fresh);
		} catch (error) {
			throw new ChatOrganizationInputError((error as Error).message);
		}

		deps.organizationStore.write(next);
		if (action.action === "create-folder") {
			createdFolderId = fresh.id;
		}

		return { ...read(), ...(createdFolderId ? { createdFolderId } : {}) };
	}

	function removeChatPlacement(chatId: string): void {
		try {
			const org = deps.organizationStore.read();
			const key = chatKey(chatId);
			if (Object.hasOwn(org.placements, key)) {
				const next = { ...org, placements: { ...org.placements } };
				delete next.placements[key];
				deps.organizationStore.write(next);
			}
		} catch {
			// ignore cleanup errors on deletion
		}
	}

	return { read, readArchived, change, removeChatPlacement };
}

export const chatDirectory = createChatDirectory({
	chatStore: stores.chatStore,
	workspaceStore: stores.workspaceStore,
	organizationStore: stores.organizationV2Store,
});

/**
 * Bound actual JSON bytes as well as declared size; never buffer an unbounded operation body.
 */
export async function readChatOrganizationAction(request: Request): Promise<unknown> {
	const limit = 64 * 1024;
	if (Number(request.headers.get("content-length")) > limit) {
		void request.body?.cancel().catch(() => undefined);
		throw new ChatOrganizationInputError("Chat organization request is too large.");
	}
	const reader = request.body?.getReader();
	if (!reader) throw new ChatOrganizationInputError("Missing chat organization action.");
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		for (;;) {
			const { value, done } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > limit) {
				throw new ChatOrganizationInputError("Chat organization request is too large.");
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
		if (error instanceof ChatOrganizationInputError) throw error;
		throw new ChatOrganizationInputError("Could not read chat organization action.");
	} finally {
		void reader.cancel().catch(() => undefined);
		reader.releaseLock();
	}
}
