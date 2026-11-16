import * as fs from "node:fs";
import * as path from "node:path";
import { PLUGIN_ID_PATTERN } from "../core/plugins.ts";

export interface CorePluginDataLocation { directory: string; ids: readonly string[] }

/** One origin-aware mapping shared by backend activation and crash recovery.
 * No package code, filesystem fallback, or old core data participates. */
export function safePluginDataDirectory(communityDirectory: string, id: string, core?: CorePluginDataLocation, create = false): string | null {
	if (!PLUGIN_ID_PATTERN.test(id)) throw new Error("Invalid plugin id");
	const isCore = core?.ids.includes(id) === true;
	const root = path.resolve(/* turbopackIgnore: true */ isCore ? core!.directory : communityDirectory);
	const plugin = path.join(/* turbopackIgnore: true */ root, id);
	if (!isCore) {
		// Community packages are removable code. Keep all writable records as a
		// sibling of the package directory so uninstalling plugins/<id> cannot
		// erase plugin-owned data.
		const packageRoot = plugin;
		const legacyData = path.join(/* turbopackIgnore: true */ packageRoot, "data");
		const dataRoot = path.join(/* turbopackIgnore: true */ path.dirname(root), "plugin-data");
		const dataDirectory = path.join(/* turbopackIgnore: true */ dataRoot, id);
		const ensureDirectory = (directory: string, shouldCreate: boolean) => {
			try {
				const stat = fs.lstatSync(directory);
				if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Unsafe plugin data directory: ${directory}`);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
				if (!shouldCreate) return false;
				fs.mkdirSync(directory);
				const stat = fs.lstatSync(directory);
				if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Unsafe plugin data directory: ${directory}`);
			}
			return true;
		};

		ensureDirectory(root, false);
		let packageExists = false;
		try { packageExists = ensureDirectory(packageRoot, false); }
		catch (error) { throw error; }
		let legacyExists = false;
		if (packageExists) legacyExists = ensureDirectory(legacyData, false);
		let dataRootExists = ensureDirectory(dataRoot, false);
		let dataExists = dataRootExists && ensureDirectory(dataDirectory, false);
		if (legacyExists && dataExists) throw new Error(`Both legacy and external plugin data exist for ${id}; refusing ambiguous migration`);
		if (legacyExists && create) {
			if (!dataRootExists) { ensureDirectory(path.dirname(dataRoot), false); ensureDirectory(dataRoot, true); dataRootExists = true; }
			if (!dataExists) { fs.renameSync(legacyData, dataDirectory); dataExists = true; }
		}
		if (!dataExists) {
			if (!create) return legacyExists ? legacyData : null;
			if (!dataRootExists) { ensureDirectory(path.dirname(dataRoot), false); ensureDirectory(dataRoot, true); }
			ensureDirectory(dataDirectory, true);
		}
		const realRoot = fs.realpathSync(dataRoot);
		const real = fs.realpathSync(dataDirectory);
		const relative = path.relative(realRoot, real);
		if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("Plugin data directory escapes root");
		return dataDirectory;
	}
	const directories = [root, plugin];
	let realRoot: string | undefined;
	for (const directory of directories) {
		let stat: fs.Stats;
		try { stat = fs.lstatSync(directory); }
		catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			if (!create) return null;
			fs.mkdirSync(directory, { recursive: directory === root }); stat = fs.lstatSync(directory);
		}
		if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Unsafe plugin data directory: ${directory}`);
		const real = fs.realpathSync(/* turbopackIgnore: true */ directory); realRoot ??= real;
		const relative = path.relative(realRoot, real);
		if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("Plugin data directory escapes root");
	}
	return directories.at(-1)!;
}
