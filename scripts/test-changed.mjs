#!/usr/bin/env node
import { execSync, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function getChangedFiles() {
	const files = new Set();

	// 1. Uncommitted changes (staged, unstaged, untracked)
	try {
		const status = execSync("git status --porcelain", { cwd: ROOT, encoding: "utf8" });
		for (const line of status.split("\n")) {
			if (!line.trim()) continue;
			const parts = line.slice(3).trim().split(" -> ");
			const filePath = parts[parts.length - 1];
			if (filePath) files.add(filePath);
		}
	} catch {
		/* git status failed */
	}

	// 2. Uncommitted diff against HEAD
	try {
		const diff = execSync("git diff --name-only HEAD", { cwd: ROOT, encoding: "utf8" });
		for (const line of diff.split("\n")) {
			if (line.trim()) files.add(line.trim());
		}
	} catch {
		/* git diff HEAD failed */
	}

	// 3. Committed branch changes against dev or origin/dev
	for (const base of ["origin/dev...HEAD", "dev...HEAD"]) {
		try {
			const branchDiff = execSync(`git diff --name-only ${base}`, { cwd: ROOT, encoding: "utf8" });
			for (const line of branchDiff.split("\n")) {
				if (line.trim()) files.add(line.trim());
			}
			break;
		} catch {
			/* try next base */
		}
	}

	return Array.from(files);
}

function findMatchingTests(changedFiles) {
	const testDir = path.join(ROOT, "tests");
	if (!fs.existsSync(testDir)) return [];

	const allTests = fs
		.readdirSync(testDir)
		.filter((f) => f.endsWith(".test.ts") || f.endsWith(".test.tsx"))
		.map((f) => path.join("tests", f));

	const matched = new Set();

	for (const file of changedFiles) {
		// If the changed file itself is a test file
		if (file.startsWith("tests/") && (file.endsWith(".test.ts") || file.endsWith(".test.tsx"))) {
			if (fs.existsSync(path.join(ROOT, file))) {
				matched.add(file);
			}
			continue;
		}

		const baseName = path.basename(file).replace(/\.(ts|tsx|js|mjs|jsx|json)$/, "");
		if (!baseName || baseName === "index" || baseName === "page" || baseName === "layout") {
			continue;
		}

		// Direct matching by filename conventions (e.g., sidebar.test.ts, sidebar-*.test.ts, *-sidebar.test.ts)
		for (const testFile of allTests) {
			const testBase = path.basename(testFile);
			if (
				testBase === `${baseName}.test.ts` ||
				testBase === `${baseName}.test.tsx` ||
				testBase.startsWith(`${baseName}-`) ||
				testBase.startsWith(`${baseName}.`) ||
				testBase.includes(`-${baseName}.test.`)
			) {
				matched.add(testFile);
			}
		}
	}

	return Array.from(matched).sort();
}

const changed = getChangedFiles();
if (changed.length === 0) {
	console.log("No modified or untracked files detected in working tree.");
	process.exit(0);
}

const matchedTests = findMatchingTests(changed);
if (matchedTests.length === 0) {
	console.log(`Changed files detected (${changed.length}), but no direct test files matched.`);
	console.log("Consider running a targeted slice (e.g. npm run test:workspaces, npm run test:settings) or pass specific files:");
	console.log("  node scripts/run-tests.mjs tests/<filename>.test.ts");
	process.exit(0);
}

const forwardArgs = process.argv.slice(2);

console.log(`\x1b[36mRunning ${matchedTests.length} test file(s) matching ${changed.length} changed file(s):\x1b[0m`);
for (const t of matchedTests) {
	console.log(`  - ${t}`);
}
console.log("");

const runner = path.join(ROOT, "scripts", "run-tests.mjs");
const child = spawn(process.execPath, [runner, ...matchedTests, ...forwardArgs], {
	cwd: ROOT,
	stdio: "inherit",
});

child.on("exit", (code, signal) => {
	if (signal) process.exit(1);
	process.exit(code ?? 0);
});
