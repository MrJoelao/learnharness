/**
 * Shared directory model — the discriminated union of chats and workspaces
 * as they appear in the shared organizational tree.
 *
 * Browser-safe: no fs, no network, only pure types.
 */

import type { ChatFolder } from "./chat-organization.ts";
import type { ChatKind } from "./contracts/chat.ts";
import type { WorkspaceAvailability } from "./workspaces.ts";
import type { OrganizationV2 } from "./organization.ts";

export interface ChatDirectoryEntry {
	kind: "chat";
	id: string;
	title: string;
	chatKind?: ChatKind;
	createdAt: string;
	updatedAt: string;
	folderId: string | null;
	order?: number;
	archivedAt: string | null;
	messageCount?: number;
	busy?: boolean;
	compacting?: boolean;
	pendingQuestion?: boolean;
	pendingProblem?: boolean;
}

export interface WorkspaceDirectoryEntry {
	kind: "workspace";
	id: string;
	title: string;
	pluginId: string;
	modeId: string;
	createdAt: string;
	updatedAt: string;
	folderId: string | null;
	order?: number;
	archivedAt: string | null;
	availability: WorkspaceAvailability;
}

export type DirectoryEntry = ChatDirectoryEntry | WorkspaceDirectoryEntry;

export interface SharedDirectory {
	/** The raw organization state (v2). */
	organization: OrganizationV2;
	/** All folders from the organization. */
	folders: ChatFolder[];
	/** Merged, sorted items. Active-only by default; pass includeArchived for all. */
	items: DirectoryEntry[];
}

export interface ArchivedSharedDirectory {
	/** Folders that are themselves archived. */
	archivedFolders: ChatFolder[];
	/** Active (non-archived) folders, for the restore UI. */
	activeFolders: ChatFolder[];
	/** Only archived items. */
	items: DirectoryEntry[];
}
