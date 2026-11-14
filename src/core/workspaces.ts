import { PLUGIN_ID_PATTERN } from "./plugins.ts";

declare const workspaceIdBrand: unique symbol;
export type WorkspaceId = string & { readonly [workspaceIdBrand]: true };

export const WORKSPACE_ID_PATTERN = /^workspace_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MODE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const TITLE_MAX_LENGTH = 200;

export interface WorkspaceRecord {
	version: 1;
	id: WorkspaceId;
	pluginId: string;
	modeId: string;
	title: string;
	createdAt: string;
	updatedAt: string;
}

export interface WorkspaceIndex {
	version: 1;
	workspaceIds: WorkspaceId[];
}

export type WorkspaceDirectoryIssue =
	| { kind: "missing-record"; id: WorkspaceId }
	| { kind: "invalid-record"; id: WorkspaceId }
	| { kind: "unreadable-record"; id: WorkspaceId };

export interface WorkspaceDirectory {
	workspaces: WorkspaceRecord[];
	issues: WorkspaceDirectoryIssue[];
}

export interface WorkspaceReconciliation {
	orphanIds: WorkspaceId[];
	missingIds: WorkspaceId[];
	invalidOrphanIds: WorkspaceId[];
	invalidRecordIds: WorkspaceId[];
	unreadableRecordIds: WorkspaceId[];
}

export type WorkspaceAvailability = "available" | "plugin-disabled" | "plugin-missing" | "mode-missing";

export interface WorkspacePluginSnapshot {
	id: string;
	enabled: boolean;
	modeIds: readonly string[];
}

export function parseWorkspaceId(value: unknown): WorkspaceId {
	if (typeof value !== "string" || !WORKSPACE_ID_PATTERN.test(value)) {
		throw new Error("Invalid workspace ID.");
	}
	return value as WorkspaceId;
}

export function parseWorkspaceTitle(value: unknown): string {
	if (typeof value !== "string") throw new Error("Workspace title must be a string.");
	const title = value.trim();
	if (!title || title.length > TITLE_MAX_LENGTH) throw new Error(`Workspace title must contain 1 to ${TITLE_MAX_LENGTH} characters.`);
	return title;
}

export function parseWorkspaceRecord(value: unknown): WorkspaceRecord {
	if (!isPlainObject(value)) return invalidWorkspaceRecord();
	const keys = Object.keys(value).sort();
	const expectedKeys = ["createdAt", "id", "modeId", "pluginId", "title", "updatedAt", "version"];
	if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) return invalidWorkspaceRecord();
	if (value.version !== 1) return invalidWorkspaceRecord();

	let id: WorkspaceId;
	let title: string;
	try {
		id = parseWorkspaceId(value.id);
		title = parseWorkspaceTitle(value.title);
	} catch (error) {
		return invalidWorkspaceRecord(error);
	}
	if (typeof value.pluginId !== "string" || !PLUGIN_ID_PATTERN.test(value.pluginId)
		|| typeof value.modeId !== "string" || !MODE_ID_PATTERN.test(value.modeId)
		|| typeof value.createdAt !== "string" || !isIsoTimestamp(value.createdAt)
		|| typeof value.updatedAt !== "string" || !isIsoTimestamp(value.updatedAt)) {
		return invalidWorkspaceRecord();
	}
	return {
		version: 1,
		id,
		pluginId: value.pluginId,
		modeId: value.modeId,
		title,
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
	};
}

export function parseWorkspaceIndex(value: unknown): WorkspaceIndex {
	if (!isPlainObject(value)) {
		throw new Error("Could not read workspace index. Its data is invalid or newer than this app.");
	}
	const keys = Object.keys(value).sort();
	if (keys.length !== 2 || keys[0] !== "version" || keys[1] !== "workspaceIds"
		|| value.version !== 1 || !Array.isArray(value.workspaceIds)) {
		throw new Error("Could not read workspace index. Its data is invalid or newer than this app.");
	}
	try {
		const workspaceIds = value.workspaceIds.map(parseWorkspaceId);
		if (new Set(workspaceIds).size !== workspaceIds.length) throw new Error("Duplicate workspace ID.");
		return { version: 1, workspaceIds };
	} catch (error) {
		throw new Error("Could not read workspace index. Its data is invalid or newer than this app.", { cause: error });
	}
}

export function emptyWorkspaceIndex(): WorkspaceIndex {
	return { version: 1, workspaceIds: [] };
}

export function resolveWorkspaceAvailability(
	workspace: WorkspaceRecord,
	plugins: readonly WorkspacePluginSnapshot[],
): WorkspaceAvailability {
	const plugin = plugins.find((candidate) => candidate.id === workspace.pluginId);
	if (!plugin) return "plugin-missing";
	if (!plugin.enabled) return "plugin-disabled";
	if (!plugin.modeIds.includes(workspace.modeId)) return "mode-missing";
	return "available";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalidWorkspaceRecord(cause?: unknown): never {
	throw new Error("Could not read workspace record. Its data is invalid or newer than this app.", { cause });
}

function isIsoTimestamp(value: string): boolean {
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}
