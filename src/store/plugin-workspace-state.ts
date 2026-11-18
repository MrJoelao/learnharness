import * as fs from "node:fs";
import * as path from "node:path";
import { parseWorkspaceId, type WorkspaceId } from "../core/workspaces.ts";
import type { PluginWorkspaceStateStore } from "../core/ports.ts";
import { writeFileAtomicSync } from "./atomic-write.ts";

const KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MAX_BYTES = 1_048_576;

/** Plugin-owned JSON values, physically scoped to one workspace instance. */
export function createPluginWorkspaceState(directory: string, workspaceIdValue: WorkspaceId) {
	const workspaceId = parseWorkspaceId(workspaceIdValue);
	const dataRoot = path.resolve(/* turbopackIgnore: true */ directory);
	const workspaceRoot = path.join(/* turbopackIgnore: true */ dataRoot, "workspaces");
	const root = path.join(/* turbopackIgnore: true */ workspaceRoot, workspaceId);
	function ensureRoot(create: boolean): boolean {
		for (const parent of [dataRoot, workspaceRoot]) {
			try {
				const stat = fs.lstatSync(/* turbopackIgnore: true */ parent);
				if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Unsafe workspace state parent directory");
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
				if (!create) return false;
				fs.mkdirSync(/* turbopackIgnore: true */ parent, { recursive: true });
				const stat = fs.lstatSync(/* turbopackIgnore: true */ parent);
				if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Unsafe workspace state parent directory");
			}
		}
		let stat: fs.Stats;
		try { stat = fs.lstatSync(/* turbopackIgnore: true */ root); }
		catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			if (!create) return false;
			fs.mkdirSync(/* turbopackIgnore: true */ root, { recursive: true }); stat = fs.lstatSync(/* turbopackIgnore: true */ root);
		}
		if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Unsafe workspace state directory");
		return true;
	}
	function fileFor(key: string): string {
		if (typeof key !== "string" || !KEY.test(key)) throw new Error("Invalid workspace state key");
		return path.join(/* turbopackIgnore: true */ root, `${key}.json`);
	}
	return {
		get<T = unknown>(key: string): T | undefined {
			const file = fileFor(key);
			if (!ensureRoot(false)) return undefined;
			let stat: fs.Stats;
			try { stat = fs.lstatSync(/* turbopackIgnore: true */ file); }
			catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
			if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Unsafe workspace state record");
			return JSON.parse(fs.readFileSync(/* turbopackIgnore: true */ file, "utf8")) as T;
		},
		set(key: string, value: unknown): void {
			const file = fileFor(key);
			let text: string;
			try { text = JSON.stringify(value); } catch { throw new Error("Workspace state must be JSON serializable"); }
			if (text === undefined || Buffer.byteLength(text) > MAX_BYTES) throw new Error("Workspace state value exceeds the 1 MiB limit");
			ensureRoot(true);
			try {
				const stat = fs.lstatSync(/* turbopackIgnore: true */ file);
				if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Unsafe workspace state record");
			} catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
			writeFileAtomicSync(file, `${text}\n`);
		},
		delete(key: string): void {
			const file = fileFor(key);
			if (!ensureRoot(false)) return;
			try {
				const stat = fs.lstatSync(/* turbopackIgnore: true */ file);
				if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Unsafe workspace state record");
				fs.unlinkSync(/* turbopackIgnore: true */ file);
			} catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
		},
	};
}

/** Store port adapter. Removal only targets the validated workspace namespace. */
export function createPluginWorkspaceStateStore(): PluginWorkspaceStateStore {
	return {
		open: (directory, id) => createPluginWorkspaceState(directory, id),
		remove(directory, idValue) {
			const id = parseWorkspaceId(idValue);
			const dataRoot = path.resolve(/* turbopackIgnore: true */ directory);
			const workspaces = path.join(/* turbopackIgnore: true */ dataRoot, "workspaces");
			const root = path.join(/* turbopackIgnore: true */ workspaces, id);
			for (const parent of [dataRoot, workspaces]) {
				try { const stat = fs.lstatSync(/* turbopackIgnore: true */ parent); if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Unsafe workspace state parent directory"); }
				catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
			}
			try { const stat = fs.lstatSync(/* turbopackIgnore: true */ root); if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Unsafe workspace state directory"); }
			catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
			fs.rmSync(/* turbopackIgnore: true */ root, { recursive: true });
		},
	};
}
