#!/usr/bin/env node
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// 1. Data directory isolation: ensure tests never touch or pollute repository data/
const ownTemp = !process.env.LH_DATA_DIR;
const dataDir = process.env.LH_DATA_DIR || fs.mkdtempSync(path.join(os.tmpdir(), "lh-test-data-"));
process.env.LH_DATA_DIR = dataDir;
process.env.NODE_ENV = "test";

// 2. Ensure reasonable heap size for V8 workers (2GB per worker prevents delayed GC ballooning)
const existingNodeOptions = process.env.NODE_OPTIONS || "";
if (!existingNodeOptions.includes("--max-old-space-size")) {
	process.env.NODE_OPTIONS = `${existingNodeOptions} --max-old-space-size=2048`.trim();
}

// 3. Concurrency control: default to 2 workers to prevent CPU fan noise and keep RAM usage under ~3GB
const DEFAULT_CONCURRENCY = 2;
const rawArgs = process.argv.slice(2);
const hasConcurrencyArg = rawArgs.some((arg) => arg.startsWith("--test-concurrency"));
const concurrency = process.env.TEST_CONCURRENCY || DEFAULT_CONCURRENCY;

const forwardArgs = [];
if (!hasConcurrencyArg) {
	forwardArgs.push(`--test-concurrency=${concurrency}`);
}

const fileArgs = [];
for (const arg of rawArgs) {
	if (arg.startsWith("-")) {
		forwardArgs.push(arg);
	} else {
		fileArgs.push(arg);
	}
}

if (fileArgs.length === 0) {
	const testDir = path.join(ROOT, "tests");
	const allTestFiles = fs
		.readdirSync(testDir)
		.filter((f) => f.endsWith(".test.ts") || f.endsWith(".test.tsx"))
		.sort()
		.map((f) => path.join("tests", f));
	forwardArgs.push(...allTestFiles);
} else {
	forwardArgs.push(...fileArgs);
}

const tsxBin = path.join(ROOT, "node_modules", ".bin", "tsx");

let cleanedUp = !ownTemp;
function cleanup() {
	if (cleanedUp) return;
	cleanedUp = true;
	try {
		fs.rmSync(dataDir, { recursive: true, force: true });
	} catch {
		/* ignore cleanup failures on shutdown */
	}
}

process.on("SIGINT", () => {
	cleanup();
	process.exit(130);
});

process.on("SIGTERM", () => {
	cleanup();
	process.exit(143);
});

process.on("exit", () => {
	cleanup();
});

const child = spawn(tsxBin, ["--test", ...forwardArgs], {
	cwd: ROOT,
	stdio: "inherit",
	env: process.env,
});

child.on("exit", (code, signal) => {
	cleanup();
	if (signal) {
		const sigCode = os.constants.signals[signal] ?? 1;
		process.exit(128 + sigCode);
	}
	process.exit(code ?? 0);
});
