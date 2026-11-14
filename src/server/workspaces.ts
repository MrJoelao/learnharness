import { randomUUID } from "node:crypto";
import {
	parseWorkspaceId,
	parseWorkspaceRecord,
	parseWorkspaceTitle,
	resolveWorkspaceAvailability,
	type WorkspaceDirectory,
	type WorkspaceId,
	type WorkspacePluginSnapshot,
	type WorkspaceRecord,
	type WorkspaceReconciliation,
} from "../core/workspaces.ts";
import type { WorkspaceStore } from "../core/ports.ts";
import { workspaceKey } from "../core/organization.ts";
import { stores } from "./stores.ts";
import { directoryService } from "./directory.ts";

export interface CreateWorkspaceInput {
	pluginId: string;
	modeId: string;
	title: string;
}

export interface WorkspaceServiceOptions {
	store: WorkspaceStore;
	now?: () => string;
	createId?: () => WorkspaceId;
	onDelete?: (id: WorkspaceId) => void;
}

export function createWorkspaceService({ store, now = () => new Date().toISOString(), createId = newWorkspaceId, onDelete }: WorkspaceServiceOptions) {
	function create(input: CreateWorkspaceInput): WorkspaceRecord {
		const timestamp = now();
		const workspace = parseWorkspaceRecord({
			version: 1,
			id: createId(),
			pluginId: input.pluginId,
			modeId: input.modeId,
			title: parseWorkspaceTitle(input.title),
			createdAt: timestamp,
			updatedAt: timestamp,
		});
		store.create(workspace);
		return workspace;
	}

	function read(id: WorkspaceId): WorkspaceRecord | null {
		return store.read(id);
	}

	function list(): WorkspaceDirectory {
		return store.list();
	}

	function rename(id: WorkspaceId, titleValue: string): WorkspaceRecord {
		const current = store.read(id);
		if (!current) throw new Error(`Workspace does not exist: ${id}.`);
		const workspace = parseWorkspaceRecord({ ...current, title: parseWorkspaceTitle(titleValue), updatedAt: now() });
		store.update(workspace);
		return workspace;
	}

	function remove(id: WorkspaceId): void {
		store.delete(id);
		onDelete?.(id);
	}

	function inspect(): WorkspaceReconciliation {
		return store.inspect();
	}

	function recoverOrphan(id: WorkspaceId): void {
		store.recoverOrphan(id);
	}

	function removeMissingReference(id: WorkspaceId): void {
		store.removeMissingReference(id);
	}

	function availability(workspace: WorkspaceRecord, plugins: readonly WorkspacePluginSnapshot[]) {
		return resolveWorkspaceAvailability(workspace, plugins);
	}

	return { create, read, list, rename, delete: remove, inspect, recoverOrphan, removeMissingReference, availability };
}

export const workspaceService = createWorkspaceService({
	store: stores.workspaceStore,
});

function newWorkspaceId(): WorkspaceId {
	return parseWorkspaceId(`workspace_${randomUUID()}`);
}
