import fs from "node:fs";
import * as path from "node:path";
import { WORKSPACE_INDEX_FILE } from "../../config.ts";
import {
	emptyWorkspaceIndex,
	parseWorkspaceId,
	parseWorkspaceIndex,
	parseWorkspaceRecord,
	WORKSPACE_ID_PATTERN,
	DeletionJournalError,
	DeletionJournalCorruptError,
	DeletionJournalUnreadableError,
	type WorkspaceDeletionJournalEntry,
	type WorkspaceDirectory,
	type WorkspaceDirectoryIssue,
	type WorkspaceId,
	type WorkspaceIndex,
	type WorkspaceRecord,
	type WorkspaceReconciliation,
} from "../core/workspaces.ts";
import type { WorkspaceStore } from "../core/ports.ts";
import { removeLeftoverTemps, writeFileAtomicSync } from "./atomic-write.ts";

type RecordRead =
	| { kind: "found"; record: WorkspaceRecord }
	| { kind: "missing" }
	| { kind: "invalid" }
	| { kind: "unreadable" };

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
	return typeof error === "object" && error !== null && "code" in error;
}

function isEnoent(error: unknown): boolean {
	return isErrnoException(error) && error.code === "ENOENT";
}

function isWorkspaceDeletionJournalEntry(e: unknown): e is WorkspaceDeletionJournalEntry {
	if (!e || typeof e !== "object" || Array.isArray(e)) return false;
	const obj = e as Record<string, unknown>;
	return (
		typeof obj.workspaceId === "string" &&
		WORKSPACE_ID_PATTERN.test(obj.workspaceId) &&
		typeof obj.pluginId === "string" &&
		obj.pluginId.trim().length > 0 &&
		(obj.stage === "started" || obj.stage === "state-deleted" || obj.stage === "metadata-deleted") &&
		typeof obj.startedAt === "string"
	);
}

/** host metadata store. The index controls membership; each record owns its metadata. */
export function createWorkspaceStore(directory: string): WorkspaceStore {
	const root = path.resolve(/* turbopackIgnore: true */ directory);
	const indexFile = path.join(/* turbopackIgnore: true */ root, "index.json");

	function ensureRoot(create: boolean): boolean {
		let stat: fs.Stats;
		try {
			stat = fs.lstatSync(/* turbopackIgnore: true */ root);
		} catch (error) {
			if (!isEnoent(error)) throw error;
			if (!create) return false;
			fs.mkdirSync(/* turbopackIgnore: true */ root, { recursive: true });
			stat = fs.lstatSync(/* turbopackIgnore: true */ root);
		}
		if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Unsafe workspace data directory.");
		return true;
	}

	function fileFor(idValue: WorkspaceId): string {
		const id = parseWorkspaceId(idValue);
		return path.join(/* turbopackIgnore: true */ root, `${id}.json`);
	}

	function readIndex(): WorkspaceIndex {
		if (!ensureRoot(false)) return emptyWorkspaceIndex();
		assertRegularFile(indexFile, "Workspace index");
		let text: string;
		try {
			text = fs.readFileSync(/* turbopackIgnore: true */ indexFile, "utf8");
		} catch (error) {
			if (isEnoent(error)) return emptyWorkspaceIndex();
			throw error;
		}
		try {
			const parsed: unknown = JSON.parse(text);
			return parseWorkspaceIndex(parsed);
		} catch (error) {
			throw new Error("Could not read workspace index. Its data is invalid or newer than this app.", { cause: error });
		}
	}

	function readRecord(id: WorkspaceId): RecordRead {
		if (!ensureRoot(false)) return { kind: "missing" };
		const file = fileFor(id);
		try {
			const stat = fs.lstatSync(/* turbopackIgnore: true */ file);
			if (!stat.isFile() || stat.isSymbolicLink()) return { kind: "unreadable" };
		} catch (error) {
			if (isEnoent(error)) return { kind: "missing" };
			return { kind: "unreadable" };
		}

		let text: string;
		try {
			text = fs.readFileSync(/* turbopackIgnore: true */ file, "utf8");
		} catch {
			return { kind: "unreadable" };
		}
		try {
			const parsed: unknown = JSON.parse(text);
			const record = parseWorkspaceRecord(parsed);
			return record.id === id ? { kind: "found", record } : { kind: "invalid" };
		} catch {
			return { kind: "invalid" };
		}
	}

	function writeIndex(index: WorkspaceIndex): void {
		ensureRoot(true);
		const valid = parseWorkspaceIndex(index);
		writeFileAtomicSync(indexFile, `${JSON.stringify(valid, null, "\t")}\n`);
	}

	function writeRecord(recordValue: WorkspaceRecord): void {
		ensureRoot(true);
		const record = parseWorkspaceRecord(recordValue);
		const file = fileFor(record.id);
		assertRegularFileIfPresent(file, "Workspace record");
		writeFileAtomicSync(file, `${JSON.stringify(record, null, "\t")}\n`);
	}

	function list(): WorkspaceDirectory {
		const index = readIndex();
		const workspaces: WorkspaceRecord[] = [];
		const issues: WorkspaceDirectoryIssue[] = [];
		for (const id of index.workspaceIds) {
			const result = readRecord(id);
			if (result.kind === "found") workspaces.push(result.record);
			else issues.push({ kind: `${result.kind === "missing" ? "missing" : result.kind === "invalid" ? "invalid" : "unreadable"}-record`, id });
		}
		return { workspaces, issues };
	}

	function read(id: WorkspaceId): WorkspaceRecord | null {
		const index = readIndex();
		if (!index.workspaceIds.includes(id)) return null;
		const result = readRecord(id);
		if (result.kind === "found") return result.record;
		if (result.kind === "missing") return null;
		throw new Error(`Could not read workspace record ${id}: ${result.kind}.`);
	}

	function create(recordValue: WorkspaceRecord): void {
		const record = parseWorkspaceRecord(recordValue);
		const index = readIndex();
		if (index.workspaceIds.includes(record.id)) throw new Error(`Workspace already exists: ${record.id}.`);
		const file = fileFor(record.id);
		if (fileExists(file)) throw new Error(`Workspace record already exists: ${record.id}.`);

		writeRecord(record);
		writeIndex({ version: 1, workspaceIds: [...index.workspaceIds, record.id] });
	}

	function update(recordValue: WorkspaceRecord): void {
		const record = parseWorkspaceRecord(recordValue);
		const index = readIndex();
		if (!index.workspaceIds.includes(record.id)) throw new Error(`Workspace is not indexed: ${record.id}.`);
		const previous = readRecord(record.id);
		if (previous.kind === "invalid") throw new Error(`Cannot update workspace record ${record.id}: its data is invalid or newer than this app.`);
		if (previous.kind !== "found") throw new Error(`Cannot update workspace record ${record.id}: ${previous.kind}.`);
		if (record.pluginId !== previous.record.pluginId || record.modeId !== previous.record.modeId
			|| record.createdAt !== previous.record.createdAt) {
			throw new Error(`Workspace identity is immutable: ${record.id}.`);
		}
		writeRecord(record);
	}

	function remove(id: WorkspaceId): void {
		const index = readIndex();
		const result = readRecord(id);
		if (!index.workspaceIds.includes(id)) {
			// Idempotent delete: if already unindexed and file does not exist, succeed.
			if (result.kind === "missing") return;
			throw new Error(`Workspace is not indexed: ${id}.`);
		}
		if (result.kind === "invalid" || result.kind === "unreadable") {
			throw new Error(`Cannot delete workspace record ${id}: ${result.kind}.`);
		}
		if (result.kind === "found") {
			const file = fileFor(id);
			try {
				fs.unlinkSync(/* turbopackIgnore: true */ file);
				removeLeftoverTemps(file);
			} catch (error) {
				throw new Error(`Cannot delete workspace record ${id}: file could not be deleted.`, { cause: error });
			}
		}
		try {
			writeIndex({ version: 1, workspaceIds: index.workspaceIds.filter((workspaceId) => workspaceId !== id) });
		} catch (error) {
			throw new Error(`Workspace record ${id} was deleted, but index could not be updated.`, { cause: error });
		}
	}

	const journalFile = path.join(/* turbopackIgnore: true */ root, "deletions.json");

	function readDeletionJournal(): WorkspaceDeletionJournalEntry[] {
		if (!ensureRoot(false)) return [];
		let stat: fs.Stats;
		try {
			stat = fs.lstatSync(/* turbopackIgnore: true */ journalFile);
		} catch (error) {
			if (isEnoent(error)) return [];
			throw new DeletionJournalUnreadableError("Could not stat deletion journal.", { cause: error });
		}
		if (!stat.isFile() || stat.isSymbolicLink()) {
			throw new DeletionJournalCorruptError("Deletion journal is not a regular file.");
		}
		let text: string;
		try {
			text = fs.readFileSync(/* turbopackIgnore: true */ journalFile, "utf8");
		} catch (error) {
			if (isEnoent(error)) return [];
			throw new DeletionJournalUnreadableError("Could not read deletion journal file.", { cause: error });
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(text);
		} catch (error) {
			throw new DeletionJournalCorruptError("Deletion journal contains malformed JSON.", { cause: error });
		}
		if (!Array.isArray(parsed)) {
			throw new DeletionJournalCorruptError("Deletion journal must be an array.");
		}
		for (const e of parsed) {
			if (!isWorkspaceDeletionJournalEntry(e)) {
				throw new DeletionJournalCorruptError("Deletion journal contains invalid entries.");
			}
		}
		return parsed;
	}

	function writeDeletionJournal(entries: WorkspaceDeletionJournalEntry[]): void {
		ensureRoot(true);
		writeFileAtomicSync(journalFile, `${JSON.stringify(entries, null, "\t")}\n`);
	}

	function recordPendingDeletion(entry: WorkspaceDeletionJournalEntry): void {
		const current = readDeletionJournal().filter((e) => e.workspaceId !== entry.workspaceId);
		current.push(entry);
		writeDeletionJournal(current);
	}

	function clearPendingDeletion(id: WorkspaceId): void {
		const current = readDeletionJournal().filter((e) => e.workspaceId !== id);
		if (current.length === 0) {
			try {
				if (fileExists(journalFile)) {
					fs.unlinkSync(/* turbopackIgnore: true */ journalFile);
					removeLeftoverTemps(journalFile);
				}
			} catch {
				writeDeletionJournal([]);
			}
		} else {
			writeDeletionJournal(current);
		}
	}

	function inspect(): WorkspaceReconciliation {
		const directory = list();
		const index = readIndex();
		const indexed = new Set(index.workspaceIds);
		const orphanIds: WorkspaceId[] = [];
		const invalidOrphanIds: WorkspaceId[] = [];
		if (ensureRoot(false)) {
			const names = fs.readdirSync(/* turbopackIgnore: true */ root).sort();
			for (const name of names) {
				if (!name.endsWith(".json")) continue;
				if (name === "index.json" || name === "deletions.json") continue;
				const rawId = name.slice(0, -5);
				if (!WORKSPACE_ID_PATTERN.test(rawId)) continue;
				const id = parseWorkspaceId(rawId);
				if (indexed.has(id)) continue;
				const result = readRecord(id);
				if (result.kind === "found") orphanIds.push(id);
				else invalidOrphanIds.push(id);
			}
		}
		let journal: WorkspaceDeletionJournalEntry[] = [];
		let deletionJournalIssue: "corrupt" | "unreadable" | undefined;
		try {
			journal = readDeletionJournal();
		} catch (error) {
			if (error instanceof DeletionJournalUnreadableError) {
				deletionJournalIssue = "unreadable";
			} else {
				deletionJournalIssue = "corrupt";
			}
		}
		return {
			orphanIds,
			missingIds: directory.issues.filter((issue) => issue.kind === "missing-record").map((issue) => issue.id),
			invalidOrphanIds,
			invalidRecordIds: directory.issues.filter((issue) => issue.kind === "invalid-record").map((issue) => issue.id),
			unreadableRecordIds: directory.issues.filter((issue) => issue.kind === "unreadable-record").map((issue) => issue.id),
			...(journal.length > 0 ? { interruptedDeletionIds: journal.map((entry) => entry.workspaceId) } : {}),
			...(deletionJournalIssue ? { deletionJournalIssue } : {}),
		};
	}

	function recoverOrphan(id: WorkspaceId): void {
		const index = readIndex();
		if (index.workspaceIds.includes(id)) throw new Error(`Workspace is already indexed: ${id}.`);
		const result = readRecord(id);
		if (result.kind !== "found") throw new Error(`Cannot recover workspace record ${id}: ${result.kind}.`);
		writeIndex({ version: 1, workspaceIds: [...index.workspaceIds, id] });
	}

	function removeMissingReference(id: WorkspaceId): void {
		const index = readIndex();
		if (!index.workspaceIds.includes(id)) throw new Error(`Workspace is not indexed: ${id}.`);
		const result = readRecord(id);
		if (result.kind !== "missing") throw new Error(`Workspace record ${id} is not missing.`);
		writeIndex({ version: 1, workspaceIds: index.workspaceIds.filter((workspaceId) => workspaceId !== id) });
	}

	return {
		list,
		read,
		create,
		update,
		delete: remove,
		inspect,
		recoverOrphan,
		removeMissingReference,
		readDeletionJournal,
		recordPendingDeletion,
		clearPendingDeletion,
	};
}

export const workspaceStore = createWorkspaceStore(path.dirname(/* turbopackIgnore: true */ WORKSPACE_INDEX_FILE));

function fileExists(file: string): boolean {
	try {
		fs.lstatSync(/* turbopackIgnore: true */ file);
		return true;
	} catch (error) {
		if (isEnoent(error)) return false;
		throw error;
	}
}

function assertRegularFile(file: string, label: string): void {
	try {
		const stat = fs.lstatSync(/* turbopackIgnore: true */ file);
		if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Unsafe ${label.toLowerCase()} path.`);
	} catch (error) {
		if (isEnoent(error)) return;
		throw error;
	}
}

function assertRegularFileIfPresent(file: string, label: string): void {
	if (fileExists(file)) assertRegularFile(file, label);
}
