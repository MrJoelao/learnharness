import { randomUUID } from "node:crypto";
import { stores } from "./stores.ts";
import type { ChatStore, ChatOrganizationStore } from "../core/ports.ts";
import {
	applyChatOrganizationAction,
	parseChatOrganizationAction,
	chatPlacementOf,
	type ChatDirectory,
	type ChatDirectoryItem,
	type ChatFolder,
	type ChatOrganization,
} from "../core/chat-organization.ts";

export class ChatOrganizationInputError extends Error {}

export interface ChatDirectoryDeps {
	chatStore: ChatStore;
	chatOrganizationStore: ChatOrganizationStore;
}

export function createChatDirectory(deps: ChatDirectoryDeps) {
	const freshFolder = () => ({
		id: `folder_${randomUUID()}`,
		createdAt: new Date().toISOString(),
	});

	function read(options?: { includeArchived?: boolean }): ChatDirectory {
		const organization = deps.chatOrganizationStore.read();
		const summaries = deps.chatStore.listChats();
		const folderIds = new Set(organization.folders.map((f) => f.id));

		const allItems: ChatDirectoryItem[] = summaries.map((s) => {
			const placement = chatPlacementOf(organization, s.id);
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
		allItems.sort((a, b) => {
			if (a.order !== undefined && b.order !== undefined) {
				return a.order - b.order;
			}
			if (a.order !== undefined) return -1;
			if (b.order !== undefined) return 1;
			return b.updatedAt.localeCompare(a.updatedAt);
		});

		const chats = options?.includeArchived
			? allItems
			: allItems.filter((c) => !c.archivedAt);

		return { organization, chats };
	}

	function readArchived(): { folders: ChatFolder[]; chats: ChatDirectoryItem[]; activeFolders: ChatFolder[] } {
		const directory = read({ includeArchived: true });
		const archivedFolders = directory.organization.folders.filter((f) => Boolean(f.archivedAt));
		const archivedChats = directory.chats.filter((c) => Boolean(c.archivedAt));
		const activeFolders = directory.organization.folders.filter((f) => !f.archivedAt);
		return {
			folders: archivedFolders,
			chats: archivedChats,
			activeFolders,
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

		const directory = read({ includeArchived: true });
		const fresh = freshFolder();
		const chatIds = new Set(directory.chats.map((c) => c.id));

		let next: ChatOrganization;
		try {
			next = applyChatOrganizationAction(directory.organization, action, chatIds, fresh);
		} catch (error) {
			throw new ChatOrganizationInputError((error as Error).message);
		}

		deps.chatOrganizationStore.write(next);
		if (action.action === "create-folder") {
			createdFolderId = fresh.id;
		}

		return { ...read(), ...(createdFolderId ? { createdFolderId } : {}) };
	}

	function removeChatPlacement(chatId: string): void {
		try {
			const org = deps.chatOrganizationStore.read();
			if (Object.hasOwn(org.placements, chatId)) {
				const next = { ...org, placements: { ...org.placements } };
				delete next.placements[chatId];
				deps.chatOrganizationStore.write(next);
			}
		} catch {
			// ignore cleanup errors on deletion
		}
	}

	return { read, readArchived, change, removeChatPlacement };
}

export const chatDirectory = createChatDirectory(stores);

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
